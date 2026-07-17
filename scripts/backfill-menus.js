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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localDbDir = path.join(__dirname, '..', 'tmp', 'db');
const SUBMISSIONS_JSON = path.join(localDbDir, 'submissions.json');
const MENUS_JSON = path.join(localDbDir, 'menus.json');
const DRAFT_SESSIONS_JSON = path.join(localDbDir, 'draft_sessions.json');
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

// A member's public id may be a UUID (id) or a legacy string (legacy_id, e.g.
// clickup_history_import). Filter the correct column so Postgres never tries to
// cast a legacy string against the uuid `id` column.
function submissionIdFilter(query, memberId) {
    return UUID_RE.test(memberId) ? query.eq('id', memberId) : query.eq('legacy_id', memberId);
}

async function applyMenus(plannedMenus, rows) {
    const now = new Date().toISOString();

    // Idempotency: reuse the menu a group is already linked to (from a prior
    // partial run) instead of minting a fresh UUID, so reruns don't duplicate.
    const existingMenuIdByMember = new Map();
    for (const row of rows) {
        const mid = `${row.menu_id || ''}`.trim();
        if (mid) existingMenuIdByMember.set(idFor(row), mid);
    }
    const menus = plannedMenus.map((m) => {
        let reused = null;
        for (const memberId of m.memberIds) {
            const existing = existingMenuIdByMember.get(memberId);
            if (existing) { reused = existing; break; }
        }
        return { id: reused || crypto.randomUUID(), reused: !!reused, ...m };
    });

    // --- Supabase first (source of truth in prod), one menu at a time so a
    // failure leaves a consistent applied prefix we then mirror locally. ---
    const applied = [];
    let remoteMenuRows = 0;
    let remoteLinks = 0;
    let failure = null;
    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        try {
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
                    if (existingMenuIdByMember.get(memberId) === menu.id) continue; // already linked
                    const { error, count } = await submissionIdFilter(
                        supabase.from('submissions').update({ menu_id: menu.id }, { count: 'exact' }),
                        memberId,
                    );
                    if (error) throw new Error(`link failed for ${memberId}: ${error.message}`);
                    remoteLinks += count || 0;
                }
                applied.push(menu);
            }
        } catch (error) {
            failure = error; // reconcile local to the applied prefix, then rethrow
        }
    } else {
        applied.push(...menus);
    }

    // --- Reconcile the local mirror to exactly the applied set (overwrite, not
    // merge) so a stale prior-run menus.json can't disagree with Supabase. ---
    const localSubs = await readJson(SUBMISSIONS_JSON, {});
    const localMenus = {};
    let localMenuRows = 0;
    let localLinks = 0;
    for (const menu of applied) {
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
    }
    // Drop dangling links (to menus no longer present), then set applied links.
    const validMenuIds = new Set(Object.keys(localMenus));
    for (const key of Object.keys(localSubs)) {
        const mid = localSubs[key].menu_id;
        if (mid && !validMenuIds.has(mid)) localSubs[key].menu_id = null;
    }
    for (const menu of applied) {
        for (const memberId of menu.memberIds) {
            if (localSubs[memberId]) { localSubs[memberId].menu_id = menu.id; localLinks++; }
        }
    }
    await fsp.writeFile(MENUS_JSON, JSON.stringify(localMenus, null, 2));
    await fsp.writeFile(SUBMISSIONS_JSON, JSON.stringify(localSubs, null, 2));

    if (failure) throw failure;
    const reused = menus.filter((m) => m.reused).length;
    return { menus: applied, localMenuRows, localLinks, remoteMenuRows, remoteLinks, reused };
}

// Clean slate in both stores so --apply can run fresh after a bad partial run.
async function resetMenus() {
    let remoteMenus = 0;
    let remoteUnlinked = 0;
    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        const { error: unlinkErr, count: unlinked } = await supabase
            .from('submissions').update({ menu_id: null }, { count: 'exact' }).not('menu_id', 'is', null);
        if (unlinkErr) throw new Error(`reset unlink failed: ${unlinkErr.message}`);
        remoteUnlinked = unlinked || 0;
        const { error: delErr, count: deleted } = await supabase
            .from('menus').delete({ count: 'exact' }).not('id', 'is', null);
        if (delErr) throw new Error(`reset delete menus failed: ${delErr.message}`);
        remoteMenus = deleted || 0;
    }
    const localSubs = await readJson(SUBMISSIONS_JSON, {});
    let localUnlinked = 0;
    for (const key of Object.keys(localSubs)) {
        if (localSubs[key].menu_id) { localSubs[key].menu_id = null; localUnlinked++; }
    }
    await fsp.writeFile(SUBMISSIONS_JSON, JSON.stringify(localSubs, null, 2));
    await fsp.writeFile(MENUS_JSON, JSON.stringify({}, null, 2));
    return { remoteMenus, remoteUnlinked, localUnlinked };
}

// Re-link active drafts to their menu from the baseline's (now-populated)
// menu_id. The Phase 3 rekey backfilled draft_sessions.menu_id while `menus`
// was still empty, so pre-existing active drafts have menu_id = null and don't
// show on menu cards. Idempotent; run standalone (--relink-drafts) and at the
// end of every --apply / --apply-review so the ordering can't bite again.
async function relinkDrafts() {
    // public submission id (legacy_id || id) -> menu_id
    const menuBySubmission = new Map();
    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase.from('submissions').select('id,legacy_id,menu_id').not('menu_id', 'is', null);
        if (error) throw new Error(`relink: load submissions failed: ${error.message}`);
        for (const row of data || []) menuBySubmission.set(idFor(row), `${row.menu_id}`);
    }
    const localSubs = await readJson(SUBMISSIONS_JSON, {});
    for (const row of Object.values(localSubs)) {
        if (row.menu_id) menuBySubmission.set(idFor(row), `${row.menu_id}`);
    }

    let remoteUpdated = 0;
    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from('draft_sessions').select('id,base_submission_id,menu_id,status').eq('status', 'active');
        if (error) throw new Error(`relink: load drafts failed: ${error.message}`);
        for (const draft of data || []) {
            const menuId = menuBySubmission.get(`${draft.base_submission_id || ''}`.trim());
            if (menuId && `${draft.menu_id || ''}` !== menuId) {
                const { error: updErr } = await supabase.from('draft_sessions').update({ menu_id: menuId }).eq('id', draft.id);
                if (updErr) throw new Error(`relink: update draft ${draft.id} failed: ${updErr.message}`);
                remoteUpdated++;
            }
        }
    }

    const localDrafts = await readJson(DRAFT_SESSIONS_JSON, {});
    let localUpdated = 0;
    for (const key of Object.keys(localDrafts)) {
        const draft = localDrafts[key];
        if (`${draft.status || ''}` !== 'active') continue;
        const menuId = menuBySubmission.get(`${draft.base_submission_id || ''}`.trim());
        if (menuId && `${draft.menu_id || ''}` !== menuId) { draft.menu_id = menuId; localUpdated++; }
    }
    await fsp.writeFile(DRAFT_SESSIONS_JSON, JSON.stringify(localDrafts, null, 2));
    return { remoteUpdated, localUpdated };
}

async function applyReview(csvPath) {
    const text = await fsp.readFile(csvPath, 'utf8');
    const [headerLine, ...rows] = text.split(/\r?\n/).filter((l) => l.trim().length);
    const header = headerLine.split(',');
    const decisionIdx = header.indexOf('decision');
    const subIdx = header.indexOf('submission_id');
    const propIdx = header.indexOf('property');
    const serviceIdx = header.indexOf('service_period');
    const nameIdx = header.indexOf('name');
    if (decisionIdx < 0 || subIdx < 0) throw new Error('review CSV missing submission_id/decision columns');

    const localSubs = await readJson(SUBMISSIONS_JSON, {});
    const localMenus = await readJson(MENUS_JSON, {});
    const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
    const now = new Date().toISOString();
    let linked = 0;
    let created = 0;

    // current_submission_id -> menu id (already-applied menus + any we create here).
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
            const { error } = await submissionIdFilter(
                supabase.from('submissions').update({ menu_id: menuId }),
                submissionId,
            );
            if (error) throw new Error(`link failed for ${submissionId}: ${error.message}`);
        }
    };

    // Parse rows once so an anchor's own row fields are available when its menu
    // is created (rows in a cluster all point at the same anchor id).
    const records = rows.map((line) => {
        const cells = parseCells(line);
        return {
            submissionId: `${cells[subIdx] || ''}`.trim(),
            decision: `${cells[decisionIdx] || ''}`.trim(),
            property: propIdx >= 0 ? `${cells[propIdx] || ''}`.trim() : '',
            servicePeriod: serviceIdx >= 0 ? `${cells[serviceIdx] || ''}`.trim() : '',
            name: nameIdx >= 0 ? `${cells[nameIdx] || ''}`.trim() : '',
        };
    }).filter((r) => r.submissionId && r.decision);
    const fieldsById = new Map(records.map((r) => [r.submissionId, r]));

    const createMenu = async (currentSubmissionId, fields) => {
        const menuId = crypto.randomUUID();
        const menuRow = {
            id: menuId,
            property: fields.property || localSubs[currentSubmissionId]?.property || '',
            service_period: fields.servicePeriod || localSubs[currentSubmissionId]?.service_period || '',
            name: fields.name || localSubs[currentSubmissionId]?.project_name || '',
            current_submission_id: currentSubmissionId,
            status: 'active', created_at: now, updated_at: now,
        };
        localMenus[menuId] = menuRow;
        if (supabase) {
            const { error } = await supabase.from('menus').upsert(menuRow, { onConflict: 'id' });
            if (error) throw new Error(`menu create failed: ${error.message}`);
        }
        menuByCurrent.set(currentSubmissionId, menuId);
        return menuId;
    };

    for (const rec of records) {
        const { submissionId, decision } = rec;
        if (decision.toLowerCase() === 'new_menu' || decision.toLowerCase() === 'separate') {
            const menuId = await createMenu(submissionId, rec);
            await setMenuId(submissionId, menuId);
            created++;
        } else {
            // decision is an anchor submission id: this submission is a version of
            // the menu whose CURRENT version is <anchor>. Reuse the menu if it
            // exists (from --apply or an earlier row in this batch), else create it
            // anchored there. Point every row in a cluster at the same anchor to
            // merge them into one menu.
            let menuId = menuByCurrent.get(decision);
            if (!menuId) {
                menuId = await createMenu(decision, fieldsById.get(decision) || rec);
                created++;
            }
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

    if (args.includes('--reset')) {
        const result = await resetMenus();
        console.log(`Reset: deleted Supabase menus=${result.remoteMenus}, unlinked Supabase submissions=${result.remoteUnlinked}, unlinked local submissions=${result.localUnlinked}. Local menus.json cleared.`);
        return;
    }

    if (args.includes('--relink-drafts')) {
        const result = await relinkDrafts();
        console.log(`Re-linked active drafts to their menu: Supabase=${result.remoteUpdated}, local=${result.localUpdated}.`);
        return;
    }

    if (reviewFlagIdx >= 0) {
        const csvPath = args[reviewFlagIdx + 1];
        if (!csvPath) throw new Error('--apply-review requires a CSV path');
        const result = await applyReview(csvPath);
        const relink = await relinkDrafts();
        console.log(`Applied review decisions: linked=${result.linked}, new single-version menus=${result.created}. Re-linked drafts: Supabase=${relink.remoteUpdated}, local=${relink.localUpdated}.`);
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
        console.log('Dry-run: no menus written. Re-run with --apply after reviewing the CSV. (Use --reset to clear a bad partial run first.)');
        // npm strips flags without a `--` separator, which silently lands here.
        if (args.length === 0) {
            console.log('Note: no flags received. With npm, pass them after `--`, e.g.  npm run backfill:menus -- --apply   (or -- --relink-drafts).');
        }
        return;
    }
    const result = await applyMenus(plan.menus, rows);
    const relink = await relinkDrafts();
    console.log(`Applied: JSON menus=${result.localMenuRows}, JSON links=${result.localLinks}; Supabase menus=${result.remoteMenuRows}, Supabase links=${result.remoteLinks}; reused existing menus=${result.reused}. Re-linked drafts: Supabase=${relink.remoteUpdated}, local=${relink.localUpdated}.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
