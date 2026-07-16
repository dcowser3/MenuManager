#!/usr/bin/env node
/*
 * One-time backfill: group approved submissions into first-class `menus` rows
 * (Phase 1 of the menu-as-an-entity work). Ships dark — running --apply only
 * populates the new `menus` table and `submissions.menu_id`; no read path uses
 * them until Phase 3.
 *
 * Grouping logic lives in services/db/dist/lib/menu-backfill.js (pure, unit
 * tested). This script is the IO shell: read submissions, plan, and — for
 * --apply — write menus + menu_id into Supabase and/or the JSON fallback.
 *
 * Usage:
 *   node scripts/backfill-menus.js                 # dry-run (default): CSV + summary, writes no menu links
 *   node scripts/backfill-menus.js --apply         # create menus + set submissions.menu_id
 *   node scripts/backfill-menus.js --apply-review tmp/menu-backfill-review.csv   # apply human decisions
 *
 * Never auto-links an ambiguous group (invariant 2): ambiguity is emitted to
 * tmp/menu-backfill-review.csv for a human pass. Unmatched submissions become
 * single-version menus.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { isSupabaseConfigured, getSupabaseClient } = require('../services/supabase-client/dist');
const { planMenuBackfill } = require('../services/db/dist/lib/menu-backfill');

const APPROVED = new Set(['approved', 'approved_override']);
const localDbDir = path.join(__dirname, '..', 'tmp', 'db');
const SUBMISSIONS_JSON = path.join(localDbDir, 'submissions.json');
const MENUS_JSON = path.join(localDbDir, 'menus.json');
const REVIEW_CSV = path.join(__dirname, '..', 'tmp', 'menu-backfill-review.csv');

function idFor(row) { return `${row.legacy_id || row.id || ''}`.trim(); }

// Mirror db service isApprovedBaselineSource: form + historical imports count.
function isApprovedBaselineSource(row) {
    const source = `${row.source || ''}`.trim();
    return !source || source === 'form' || source === 'clickup_history_import';
}
function isApproved(row) { return APPROVED.has(`${row.status || ''}`.trim().toLowerCase()); }
function eligible(row) { return isApproved(row) && isApprovedBaselineSource(row); }

function csvCell(value) {
    const s = `${value == null ? '' : value}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function readJson(file, fallback) {
    try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

async function loadSourceRows() {
    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase.from('submissions').select('*').in('status', [...APPROVED]);
        if (error) throw new Error(error.message);
        return { rows: (data || []).filter(eligible), source: 'supabase' };
    }
    const local = await readJson(SUBMISSIONS_JSON, {});
    return { rows: Object.values(local).filter(eligible), source: 'json' };
}

function summarize(plan) {
    const multi = plan.menus.filter((m) => m.memberIds.length > 1).length;
    const single = plan.menus.filter((m) => m.memberIds.length === 1).length;
    return { totalMenus: plan.menus.length, multiVersion: multi, singleVersion: single, ambiguous: plan.ambiguous.length };
}

async function writeReviewCsv(plan) {
    const header = ['submission_id', 'property', 'service_period', 'name', 'reason', 'candidate_current_ids', 'decision'];
    const lines = [header.join(',')];
    for (const a of plan.ambiguous) {
        lines.push([
            a.submissionId, a.property, a.servicePeriod, a.name, a.reason,
            a.candidateCurrentIds.join('|'),
            '', // decision: human fills "new_menu" or a candidate current id to link to
        ].map(csvCell).join(','));
    }
    await fsp.mkdir(path.dirname(REVIEW_CSV), { recursive: true });
    await fsp.writeFile(REVIEW_CSV, `${lines.join('\n')}\n`);
}

async function applyMenus(plannedMenus) {
    // Assign a stable UUID per menu, shared across both stores.
    const menus = plannedMenus.map((m) => ({ id: crypto.randomUUID(), ...m }));
    const now = new Date().toISOString();

    // --- JSON fallback (always) ---
    const localSubs = await readJson(SUBMISSIONS_JSON, {});
    const localMenus = await readJson(MENUS_JSON, {});
    let localMenuRows = 0;
    let localLinks = 0;
    for (const menu of menus) {
        localMenus[menu.id] = {
            id: menu.id,
            property: menu.property,
            service_period: menu.servicePeriod,
            name: menu.name,
            current_submission_id: menu.currentSubmissionId,
            status: 'active',
            created_at: now,
            updated_at: now,
        };
        localMenuRows++;
        for (const memberId of menu.memberIds) {
            if (localSubs[memberId]) { localSubs[memberId].menu_id = menu.id; localLinks++; }
        }
    }
    if (Object.keys(localMenus).length) await fsp.writeFile(MENUS_JSON, JSON.stringify(localMenus, null, 2));
    await fsp.writeFile(SUBMISSIONS_JSON, JSON.stringify(localSubs, null, 2));

    // --- Supabase (when configured) ---
    let remoteMenuRows = 0;
    let remoteLinks = 0;
    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        for (const menu of menus) {
            const { error: menuErr } = await supabase.from('menus').upsert({
                id: menu.id,
                property: menu.property,
                service_period: menu.servicePeriod,
                name: menu.name,
                current_submission_id: menu.currentSubmissionId,
                status: 'active',
                created_at: now,
                updated_at: now,
            }, { onConflict: 'id' });
            if (menuErr) throw new Error(`menu upsert failed: ${menuErr.message}`);
            remoteMenuRows++;
            for (const memberId of menu.memberIds) {
                // memberId is the public id (legacy_id||id); match either column.
                const { error, count } = await supabase
                    .from('submissions')
                    .update({ menu_id: menu.id }, { count: 'exact' })
                    .or(`id.eq.${memberId},legacy_id.eq.${memberId}`);
                if (error) throw new Error(`link failed for ${memberId}: ${error.message}`);
                remoteLinks += count || 0;
            }
        }
    }
    return { menus, localMenuRows, localLinks, remoteMenuRows, remoteLinks };
}

async function applyReview(csvPath) {
    const text = await fsp.readFile(csvPath, 'utf8');
    const [headerLine, ...rows] = text.split(/\r?\n/).filter((l) => l.trim().length);
    const header = headerLine.split(',');
    const decisionIdx = header.indexOf('decision');
    const subIdx = header.indexOf('submission_id');
    if (decisionIdx < 0 || subIdx < 0) throw new Error('review CSV missing submission_id/decision columns');

    const localSubs = await readJson(SUBMISSIONS_JSON, {});
    const localMenus = await readJson(MENUS_JSON, {});
    const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
    const now = new Date().toISOString();
    let linked = 0;
    let created = 0;

    // Build lookup: candidate current id -> menu id (from already-applied menus).
    const menuByCurrent = new Map();
    for (const menu of Object.values(localMenus)) menuByCurrent.set(`${menu.current_submission_id}`, menu.id);

    const parseCells = (line) => {
        // Minimal CSV parse honoring double-quoted cells.
        const out = []; let cur = ''; let q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
            else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
        }
        out.push(cur); return out;
    };

    const setMenuId = async (submissionId, menuId) => {
        if (localSubs[submissionId]) localSubs[submissionId].menu_id = menuId;
        if (supabase) {
            const { error } = await supabase.from('submissions').update({ menu_id: menuId })
                .or(`id.eq.${submissionId},legacy_id.eq.${submissionId}`);
            if (error) throw new Error(`link failed for ${submissionId}: ${error.message}`);
        }
    };

    for (const line of rows) {
        const cells = parseCells(line);
        const submissionId = `${cells[subIdx] || ''}`.trim();
        const decision = `${cells[decisionIdx] || ''}`.trim();
        if (!submissionId || !decision) continue;
        if (decision.toLowerCase() === 'new_menu' || decision.toLowerCase() === 'separate') {
            const sub = localSubs[submissionId];
            const menuId = crypto.randomUUID();
            const menuRow = {
                id: menuId,
                property: sub?.property || '',
                service_period: sub?.service_period || '',
                name: sub?.project_name || '',
                current_submission_id: submissionId,
                status: 'active', created_at: now, updated_at: now,
            };
            localMenus[menuId] = menuRow;
            if (supabase) {
                const { error } = await supabase.from('menus').upsert(menuRow, { onConflict: 'id' });
                if (error) throw new Error(`menu create failed: ${error.message}`);
            }
            await setMenuId(submissionId, menuId);
            created++;
        } else {
            // decision is a candidate current id → link into that menu.
            const menuId = menuByCurrent.get(decision);
            if (!menuId) { console.warn(`No menu for decision "${decision}" (submission ${submissionId}) — skipped`); continue; }
            await setMenuId(submissionId, menuId);
            linked++;
        }
    }
    await fsp.writeFile(SUBMISSIONS_JSON, JSON.stringify(localSubs, null, 2));
    await fsp.writeFile(MENUS_JSON, JSON.stringify(localMenus, null, 2));
    return { linked, created };
}

(async () => {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const reviewFlagIdx = args.indexOf('--apply-review');

    if (reviewFlagIdx >= 0) {
        const csvPath = args[reviewFlagIdx + 1];
        if (!csvPath) throw new Error('--apply-review requires a CSV path');
        const result = await applyReview(csvPath);
        console.log(`Applied review decisions: linked=${result.linked}, new single-version menus=${result.created}.`);
        return;
    }

    const { rows, source } = await loadSourceRows();
    const plan = planMenuBackfill(rows);
    const summary = summarize(plan);
    await writeReviewCsv(plan);

    console.log(`Source: ${source} (${rows.length} approved baseline submissions)`);
    console.log(`Planned menus: ${summary.totalMenus} (multi-version=${summary.multiVersion}, single-version=${summary.singleVersion})`);
    console.log(`Ambiguous (needs human review): ${summary.ambiguous} → ${path.relative(process.cwd(), REVIEW_CSV)}`);

    if (!apply) {
        console.log('Dry-run: no menus written. Re-run with --apply after reviewing the CSV.');
        return;
    }
    const result = await applyMenus(plan.menus);
    console.log(`Applied: JSON menus=${result.localMenuRows}, JSON links=${result.localLinks}; Supabase menus=${result.remoteMenuRows}, Supabase links=${result.remoteLinks}.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
