#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Daily Improvement Cycle (automated review-improvement loop, Phase D)
 *
 * Gated, human-approved evolution of the review process:
 *   1. Gate: exit quietly unless there are new annotated reviewer corrections
 *      (>= IMPROVE_MIN_NEW_CORRECTIONS, default 1) and no proposal is pending.
 *   2. Context: effective current prompt (latest approved proposal, else
 *      qa_prompt.txt), the full code-rules manifest, the new corrections with
 *      reviewer explanations, before/after document excerpts, and the latest
 *      eval summary.
 *   3. LLM proposes (JSON): a full prompt rewrite, deterministic replacement-rule
 *      candidates, and code recommendations for a human engineer.
 *   4. Auto-eval: runs the eval harness baseline (current config) vs candidate
 *      (proposed prompt + proposed rules) over the historical dataset; the
 *      proposal is marked passed/regressed (regressed proposals are stored and
 *      flagged, never dropped).
 *   5. Stores the proposal in prompt_proposals, marks corrections consumed, and
 *      emails the reviewer a link to /learning/prompt-proposal.
 *
 * Nothing is auto-applied: a human approves on the dashboard.
 *
 * Usage:
 *   npm run improve:cycle
 *   node scripts/improvement-cycle.js [--force] [--skip-eval] [--dry-run]
 *
 * Env:
 *   IMPROVE_MIN_NEW_CORRECTIONS  Gate threshold (default 1)
 *   IMPROVE_MODEL                Analysis model (default PROMPT_REWRITE_MODEL || o3 reasoning-class)
 *   IMPROVE_NOTIFY_EMAIL         Proposal-ready email (default FORM_ATTEMPT_ALERT_EMAIL)
 *   IMPROVE_SKIP_EVAL=1          Skip the auto-eval step (eval_status: skipped)
 *   IMPROVE_EVAL_LIMIT           Cap eval cases per run (default: all)
 *   DASHBOARD_PUBLIC_URL         Base URL used in the notification email link (falls back to DASHBOARD_URL)
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(repoRoot, '.env') });

const { createClient } = require('@supabase/supabase-js');

const LOCK_PATH = path.join(repoRoot, 'tmp', 'improvement-cycle', '.lock');
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

function requireDashboardLib(relPath) {
    const sourcePath = path.join(repoRoot, 'services', 'dashboard', 'lib', `${relPath}.ts`);
    try {
        const tsNodeRegister = require.resolve('ts-node/register/transpile-only', {
            paths: [repoRoot, path.join(repoRoot, 'services', 'dashboard')],
        });
        require(tsNodeRegister);
        return require(sourcePath);
    } catch {
        // Fall back to build output in lean installs that do not include ts-node.
    }
    const distPath = path.join(repoRoot, 'services', 'dashboard', 'dist', 'lib', `${relPath}.js`);
    if (!fs.existsSync(distPath)) {
        throw new Error(`Dashboard lib ${relPath} unavailable; run npm run build --workspace=services/dashboard`);
    }
    return require(distPath);
}

const { requireSupabaseServiceKey } = require('./lib/supabase-key');

function getSupabase() {
    const url = process.env.SUPABASE_URL;
    const key = requireSupabaseServiceKey(process.env);
    if (!url || !key) {
        throw new Error('SUPABASE_URL and a service key are required (SUPABASE_SERVICE_ROLE_KEY, legacy SUPABASE_SERVICE_KEY, or SUPABASE_ANON_KEY)');
    }
    return createClient(url, key);
}

function parseArgs(argv) {
    return {
        force: argv.includes('--force'),
        skipEval: argv.includes('--skip-eval') || /^(1|true|yes|on)$/i.test(process.env.IMPROVE_SKIP_EVAL || ''),
        dryRun: argv.includes('--dry-run'),
        consolidate: argv.includes('--consolidate'),
    };
}

function acquireLock() {
    fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
    if (fs.existsSync(LOCK_PATH)) {
        try {
            const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
            if (Date.now() - Date.parse(lock.acquiredAt || 0) < LOCK_STALE_MS) {
                throw new Error(`Another improvement cycle appears to be running (pid ${lock.pid}, since ${lock.acquiredAt}). Delete ${LOCK_PATH} if stale.`);
            }
            console.warn('Stale lock found; taking over.');
        } catch (error) {
            if (`${error.message}`.includes('appears to be running')) throw error;
        }
    }
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
}

function releaseLock() {
    try { fs.unlinkSync(LOCK_PATH); } catch { /* best effort */ }
}

// Minimal HTML escaper for values interpolated into notification emails.
function escapeHtmlLite(value) {
    return `${value ?? ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function resolvePythonBin() {
    const venvPython = path.join(repoRoot, 'services', 'docx-redliner', 'venv', 'bin', 'python');
    return fs.existsSync(venvPython) ? venvPython : 'python3';
}

function extractCleanMenuText(pythonBin, docxPath) {
    if (!docxPath || !fs.existsSync(docxPath)) return null;
    const scriptPath = path.join(repoRoot, 'services', 'docx-redliner', 'extract_clean_menu_text.py');
    const result = spawnSync(pythonBin, [scriptPath, docxPath], { encoding: 'utf8', timeout: 30000, maxBuffer: 30 * 1024 * 1024 });
    if (result.status !== 0) return null;
    try {
        const parsed = JSON.parse((result.stdout || '{}').trim() || '{}');
        return `${parsed.cleaned_menu_content || parsed.menu_content || ''}`.trim() || null;
    } catch {
        return null;
    }
}

// Low-level completion for a full messages array (C1: the retry controller grows the
// conversation across attempts, so the caller works from messages, not a fixed system+user pair).
async function postImprovementCompletion(messages) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your-openai-api-key-here') {
        throw new Error('OPENAI_API_KEY is required for the improvement cycle');
    }
    const model = process.env.IMPROVE_MODEL || process.env.PROMPT_REWRITE_MODEL || 'o3';
    const isR = /o[0-9]|reasoning/i.test(model);
    const payload = { model, messages, response_format: { type: 'json_object' } };
    if (!isR) { payload.max_tokens = 16000; payload.temperature = 0.2; } else { payload.max_completion_tokens = Number(process.env.IMPROVE_MAX_COMPLETION_TOKENS || 32000); }
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`OpenAI API error ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    const data = await response.json();
    if (data?.choices?.[0]?.finish_reason === 'length') {
        throw new Error('LLM output truncated — raise IMPROVE_MAX_COMPLETION_TOKENS (reasoning models charge hidden tokens against the budget)');
    }
    return {
        content: data.choices?.[0]?.message?.content || '',
        model: data.model,
        usage: data.usage,
    };
}

function runEvalHarness(args) {
    const result = spawnSync('node', [path.join(repoRoot, 'scripts', 'review-eval.js'), ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 50 * 1024 * 1024,
    });
    const stdout = result.stdout || '';
    const reportMatch = stdout.match(/Report: (.*report\.json)/);
    return {
        ok: result.status === 0 || result.status === 2, // 2 = regressions found, still a valid report
        status: result.status,
        reportPath: reportMatch ? reportMatch[1].trim() : null,
        stdout,
        stderr: result.stderr || '',
    };
}

function findLatestEvalReport() {
    const root = path.join(repoRoot, 'tmp', 'review-eval');
    if (!fs.existsSync(root)) return null;
    const dirs = fs.readdirSync(root)
        .filter((name) => fs.existsSync(path.join(root, name, 'report.json')))
        .sort()
        .reverse();
    return dirs.length ? path.join(root, dirs[0], 'report.json') : null;
}

// Ensure each trigger submission has a production:<key> case in the eval dataset so the
// harness will score it. Missing triggers are built on the fly using the same
// audit/raw/approved fallback as buildProductionCases in review-eval.js.
// Returns { built: string[], unavailable: string[] } (built may include already-present).
async function ensureTriggerCasesInDataset(supabaseClient, submissionIds, datasetPath) {
    const built = [];
    const unavailable = [];
    const distinct = [...new Set((submissionIds || []).filter(Boolean))];
    if (!distinct.length) return { built, unavailable };

    // Load currently present case_ids
    const present = new Set();
    if (fs.existsSync(datasetPath)) {
        const lines = fs.readFileSync(datasetPath, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
            try {
                const c = JSON.parse(line);
                if (c && c.case_id) present.add(c.case_id);
            } catch { /* ignore */ }
        }
    }

    // Resolve submission rows by id or legacy_id
    const rowBySid = new Map();
    async function fetchByColumn(col, vals) {
        if (!vals.length) return [];
        // Supabase .in accepts arrays
        const { data, error } = await supabaseClient
            .from('submissions')
            .select('id, legacy_id, project_name, property, template_type, menu_type, service_period, allergens:raw_payload->>allergens, menu_content, approved_menu_content, form_attempt_id')
            .in(col, vals)
            .limit(1000);
        if (error) {
            console.warn(`Trigger case lookup by ${col} failed: ${error.message}`);
            return [];
        }
        return data || [];
    }
    const byId = await fetchByColumn('id', distinct);
    const byLegacy = await fetchByColumn('legacy_id', distinct);
    for (const s of [...byId, ...byLegacy]) {
        if (distinct.includes(s.id)) rowBySid.set(s.id, s);
        if (s.legacy_id && distinct.includes(s.legacy_id)) rowBySid.set(s.legacy_id, s);
    }
    // Any still unresolved try direct id lookup (in case some ids are uuids not caught)
    const still = distinct.filter((sid) => !rowBySid.has(sid));
    if (still.length) {
        const more = await fetchByColumn('id', still);
        for (const s of more) rowBySid.set(s.id, s);
    }

    // Determine which need to be appended
    const toBuild = [];
    for (const sid of distinct) {
        const s = rowBySid.get(sid);
        if (!s) { unavailable.push(sid); continue; }
        const canonical = s.legacy_id || s.id;
        const caseId = `production:${canonical}`;
        if (present.has(caseId)) {
            built.push(caseId);
            continue;
        }
        if (!`${s.approved_menu_content || ''}`.trim()) {
            unavailable.push(sid);
            continue;
        }
        toBuild.push({ sid, s, caseId });
    }

    if (!toBuild.length) return { built, unavailable };

    // Fetch audits for the toBuild set
    const attemptIds = toBuild.map((n) => n.s.form_attempt_id).filter(Boolean);
    const auditByAttempt = new Map();
    if (attemptIds.length) {
        const { data: audits, error: auditErr } = await supabaseClient
            .from('basic_ai_check_audits')
            .select('attempt_id, event_type, menu_content_raw, ai_request, created_at')
            .in('attempt_id', attemptIds)
            .order('created_at', { ascending: true });
        if (auditErr) {
            console.warn(`Trigger audits unavailable (${auditErr.message}); falling back.`);
        } else {
            for (const a of audits || []) {
                if (a.event_type === 'completed' || !auditByAttempt.has(a.attempt_id)) {
                    auditByAttempt.set(a.attempt_id, a);
                }
            }
        }
    }

    let append = '';
    for (const { sid, s, caseId } of toBuild) {
        const audit = s.form_attempt_id ? auditByAttempt.get(s.form_attempt_id) : null;
        let rawInput = '';
        let degraded = null;
        if (audit && `${audit.menu_content_raw || ''}`.trim()) {
            rawInput = audit.menu_content_raw;
        } else if (audit && audit.ai_request && `${audit.ai_request.text || ''}`.trim()) {
            rawInput = audit.ai_request.text;
            degraded = 'audit_post_deterministic';
        } else {
            rawInput = s.menu_content;
            degraded = 'submitted_content';
        }
        if (!`${rawInput || ''}`.trim() || !`${s.approved_menu_content || ''}`.trim()) {
            unavailable.push(sid);
            continue;
        }
        const caseRow = {
            case_id: caseId,
            source: 'production',
            label: `${s.project_name || s.id} (${s.property || 'unknown property'})`,
            submission_id: s.legacy_id || s.id,
            attempt_id: s.form_attempt_id || null,
            raw_input: rawInput,
            ground_truth: s.approved_menu_content,
            degraded,
            context: {
                property: s.property || '',
                templateType: s.template_type || 'food',
                menuType: s.menu_type || 'standard',
                servicePeriod: s.service_period || '',
                allergens: s.allergens || '',
            },
        };
        append += JSON.stringify(caseRow) + '\n';
        built.push(caseId);
        present.add(caseId);
    }
    if (append) {
        fs.mkdirSync(path.dirname(datasetPath), { recursive: true });
        fs.appendFileSync(datasetPath, append);
    }
    return { built, unavailable };
}

function round8(v) {
    return Number(Number(v || 0).toFixed(8));
}

function requireDifferLib(relPath) {
    const sourcePath = path.join(repoRoot, 'services', 'differ', ...relPath.split('/')) + '.ts';
    try {
        const tsNodeRegister = require.resolve('ts-node/register/transpile-only', { paths: [repoRoot] });
        require(tsNodeRegister);
        return require(sourcePath);
    } catch {}
    const distPath = path.join(repoRoot, 'services', 'differ', 'dist', ...relPath.split('/')) + '.js';
    if (fs.existsSync(distPath)) return require(distPath);
    throw new Error(`Differ lib ${relPath} unavailable; run npm run build --workspace=services/differ`);
}

// Minimal cached AI caller mirroring review-eval's cache so replays are free on repeat.
function makeReplayAiCaller({ model, temperature, seed, cacheDir }) {
    const cryptoMod = require('crypto');
    return async (text, prompt) => {
        const key = cryptoMod.createHash('sha256').update([model, `${temperature}`, `${seed}`, prompt, text].join('\u0000')).digest('hex');
        const cachePath = path.join(cacheDir, `${key}.json`);
        if (fs.existsSync(cachePath)) {
            const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            return cached.feedback;
        }
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || apiKey === 'your-openai-api-key-here') {
            throw new Error('OPENAI_API_KEY required for replay');
        }
        const body = { model, temperature, seed, messages: [{ role: 'system', content: prompt }, { role: 'user', content: `Here is the menu text to review:\n\n---\n\n${text}` }] };
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify(body),
                });
                if (resp.status === 429 || resp.status >= 500) {
                    lastErr = new Error(`OpenAI ${resp.status}`);
                    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
                    continue;
                }
                if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
                const json = await resp.json();
                const feedback = json.choices?.[0]?.message?.content || '';
                await fsp.mkdir(cacheDir, { recursive: true });
                await fsp.writeFile(cachePath, JSON.stringify({ model, temperature, seed, feedback, usage: json.usage || {}, cachedAt: new Date().toISOString() }, null, 2));
                return feedback;
            } catch (e) {
                lastErr = e;
                await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
            }
        }
        throw lastErr || new Error('OpenAI replay call failed');
    };
}

async function runReplayForRaw(raw, basePrompt, acceptedCorrectionRules, ctx) {
    const { runFullReviewPipeline } = requireDashboardLib('review-pipeline');
    const model = process.env.REVIEW_EVAL_MODEL || process.env.AI_REVIEW_MODEL || 'gpt-4o-mini'; // B5: prefer pinned dated snapshot for stability vs production review model
    const aiCaller = makeReplayAiCaller({
        model,
        temperature: 0,
        seed: 42,
        cacheDir: path.join(repoRoot, 'tmp', 'review-eval', 'cache'),
    });
    const result = await runFullReviewPipeline(raw, {
        basePrompt,
        menuType: ctx.menuType || 'standard',
        templateType: ctx.templateType || 'food',
        property: ctx.property || '',
        allergens: ctx.allergens || '',
        acceptedCorrectionRules: acceptedCorrectionRules || [],
        precheckEnabled: true,
    }, aiCaller);
    return result.finalCorrectedMenu || '';
}

// Build the same Graph + SMTP mail deps the dashboard uses for alert email, so
// the cycle delivers through whatever transport is configured (previously it
// passed smtpTransporter:null and could only use Graph). On Lightsail, Graph
// (HTTPS) is the working transport since outbound port 25 is blocked.
function buildCycleMailDeps(alertMail) {
    const deps = { graphConfig: alertMail.buildGraphMailConfig(), smtpTransporter: null, smtpFromAddress: '' };
    try {
        const { buildSmtpRuntimeConfig } = requireDashboardLib('smtp-config');
        const smtpConfig = buildSmtpRuntimeConfig();
        if (smtpConfig.enabled && smtpConfig.transportOptions) {
            const nodemailer = require(require.resolve('nodemailer', {
                paths: [path.join(repoRoot, 'services', 'dashboard'), repoRoot],
            }));
            deps.smtpTransporter = nodemailer.createTransport(smtpConfig.transportOptions);
            deps.smtpFromAddress = smtpConfig.fromAddress;
        }
    } catch (error) {
        console.warn(`SMTP transport unavailable for cycle email: ${error.message}`);
    }
    return deps;
}

async function recordEmailAlert(supabase, severity, message, details) {
    try {
        await supabase.from('system_alerts').insert({
            alert_type: 'improvement_cycle_email_failed',
            severity,
            service: 'improvement-cycle',
            message,
            details,
        });
    } catch (error) {
        console.warn(`Could not record email alert: ${error.message}`);
    }
}

async function sendProposalEmail(supabase, { cycleId, evalStatus, evalSummary, correctionCount, ruleCount, recommendationCount, supersede, disposition, correctionRouting }) {
    const to = process.env.IMPROVE_NOTIFY_EMAIL || process.env.FORM_ATTEMPT_ALERT_EMAIL || 'dcowser@richardsandoval.com';
    try {
        const core = requireDashboardLib('improvement-cycle-core');
        const alertMail = requireDashboardLib('alert-mail');
        const deps = buildCycleMailDeps(alertMail);
        if (!alertMail.canSendAlertMail(deps)) {
            const msg = `Proposal ${cycleId} is ready but no mail transport is configured (Graph needs GRAPH_MAILBOX_ADDRESS + Mail.Send consent; SMTP port 25 is blocked on Lightsail). Review it at /learning/prompt-proposal.`;
            console.log(msg);
            await recordEmailAlert(supabase, 'warning', msg, { cycleId, recipient: to, reason: 'no_transport' });
            return;
        }
        const baseUrl = core.resolveDashboardPublicUrl(process.env);
        const tImp = evalSummary?.triggers_improved || 0;
        const tTot = (evalSummary?.triggers || []).length || (evalSummary?.triggers_improved || 0) + (evalSummary?.triggers_unchanged || 0) + (evalSummary?.triggers_regressed || 0);
        const verdict = evalStatus === 'passed'
            ? `Eval PASSED: triggers improved ${tImp}/${tTot || '?'}`
            : evalStatus === 'regressed'
                ? `Eval REGRESSED on ${evalSummary?.regressed} case(s) — review carefully`
                : evalStatus === 'no_effect'
                    ? `Eval NO_EFFECT (no regressions; triggers improved ${tImp}/${tTot || 0})`
                    : `Eval ${evalStatus}`;
        const supersedeLine = supersede && supersede.fromCycleId
            ? `<li>Supersedes cycle <strong>${supersede.fromCycleId}</strong> (${supersede.carriedCount} carried-over + ${supersede.newCount} new correction(s))</li>`
            : '';
        // C2: lead with the plain-language disposition (what the proposal actually concluded).
        const headline = disposition
            ? core.describeDisposition(disposition, { ruleCount, recCount: recommendationCount })
            : '';
        // C3: compact per-correction routing table so the reviewer sees the conclusion in the email.
        const routing = Array.isArray(correctionRouting) ? correctionRouting : [];
        const routingTable = routing.length
            ? [
                `<p><strong>What happened to each correction:</strong></p>`,
                `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:13px">`,
                `<tr><th>correction</th><th>replay</th><th>lane</th><th>target</th></tr>`,
                ...routing.map((r) => `<tr><td>${escapeHtmlLite(r.correction_id)}</td><td>${escapeHtmlLite(r.replay_status || '')}</td><td>${escapeHtmlLite(r.lane)}</td><td>${escapeHtmlLite(r.target || '')}</td></tr>`),
                `</table>`,
              ].join('\n')
            : '';
        await alertMail.sendAlertMail({
            subject: `Review-improvement proposal ready (${cycleId}) — ${evalStatus}`,
            to,
            html: [
                `<p>A new review-improvement proposal is ready for cycle <strong>${cycleId}</strong>.</p>`,
                headline ? `<p style="font-size:15px"><strong>${escapeHtmlLite(headline)}</strong></p>` : '',
                `<ul>`,
                supersedeLine,
                `<li>${correctionCount} reviewer correction(s) analyzed</li>`,
                `<li>${ruleCount} deterministic replacement rule(s) proposed</li>`,
                `<li>${recommendationCount} code recommendation(s)</li>`,
                `<li>${verdict}</li>`,
                `</ul>`,
                routingTable,
                `<p><a href="${baseUrl}/learning/prompt-proposal">Review the proposal</a></p>`,
            ].join('\n'),
        }, deps);
        console.log(`Notification email sent to ${to}.`);
    } catch (error) {
        const looksLikeSecretExpiry = /AADSTS7000222|AADSTS700024|invalid_client|expired|invalid client secret/i.test(error.message || '');
        const hint = looksLikeSecretExpiry
            ? ' This looks like an expired/invalid Graph client secret — create a new one in Azure and update GRAPH_CLIENT_SECRET + GRAPH_CLIENT_SECRET_EXPIRES.'
            : '';
        const msg = `Proposal ${cycleId} email failed to send to ${to}: ${error.message}.${hint} Review it at /learning/prompt-proposal.`;
        console.warn(msg);
        await recordEmailAlert(supabase, looksLikeSecretExpiry ? 'error' : 'warning', msg, { cycleId, recipient: to, error: error.message, likelySecretExpiry: looksLikeSecretExpiry });
    }
}

async function sendPendingProposalReminderEmail(supabase, { proposal, unconsumedCorrectionCount }) {
    const to = process.env.IMPROVE_NOTIFY_EMAIL || process.env.FORM_ATTEMPT_ALERT_EMAIL || 'dcowser@richardsandoval.com';
    const cycleId = proposal?.cycle_id || proposal?.id || 'unknown-cycle';
    try {
        const core = requireDashboardLib('improvement-cycle-core');
        const alertMail = requireDashboardLib('alert-mail');
        const deps = buildCycleMailDeps(alertMail);
        if (!alertMail.canSendAlertMail(deps)) {
            const msg = `Pending proposal ${cycleId} is still awaiting review but no mail transport is configured. Review it at /learning/prompt-proposal.`;
            console.log(msg);
            await recordEmailAlert(supabase, 'warning', msg, {
                cycleId,
                recipient: to,
                reason: 'no_transport',
                reminder: true,
            });
            return;
        }

        const baseUrl = core.resolveDashboardPublicUrl(process.env);
        const message = core.buildPendingProposalReminderEmail({
            proposal,
            dashboardUrl: baseUrl,
            unconsumedCorrectionCount,
        });
        await alertMail.sendAlertMail({
            subject: message.subject,
            to,
            html: message.html,
        }, deps);
        console.log(`Pending proposal reminder sent to ${to} for ${cycleId}.`);
    } catch (error) {
        const looksLikeSecretExpiry = /AADSTS7000222|AADSTS700024|invalid_client|expired|invalid client secret/i.test(error.message || '');
        const hint = looksLikeSecretExpiry
            ? ' This looks like an expired/invalid Graph client secret — create a new one in Azure and update GRAPH_CLIENT_SECRET + GRAPH_CLIENT_SECRET_EXPIRES.'
            : '';
        const msg = `Pending proposal ${cycleId} reminder email failed to send to ${to}: ${error.message}.${hint} Review it at /learning/prompt-proposal.`;
        console.warn(msg);
        await recordEmailAlert(supabase, looksLikeSecretExpiry ? 'error' : 'warning', msg, {
            cycleId,
            recipient: to,
            error: error.message,
            likelySecretExpiry: looksLikeSecretExpiry,
            reminder: true,
        });
    }
}

// Daily Graph client-secret expiry check. Runs before the gate so it fires
// every day regardless of whether a proposal is generated. Secrets fail
// silently on expiry and take down all Graph features (email + SharePoint).
async function checkGraphSecretExpiry(supabase, core) {
    const result = core.evaluateSecretExpiry(process.env.GRAPH_CLIENT_SECRET_EXPIRES, Date.now());
    if (result.status === 'ok') {
        console.log(result.message);
        return;
    }
    if (result.status === 'unknown') {
        console.warn(result.message);
        return;
    }
    console.warn(`GRAPH SECRET ${result.status.toUpperCase()}: ${result.message}`);
    try {
        await supabase.from('system_alerts').insert({
            alert_type: `graph_secret_${result.status}`,
            severity: result.status === 'expired' ? 'error' : 'warning',
            service: 'improvement-cycle',
            message: result.message,
            details: { daysLeft: result.daysLeft, expires: process.env.GRAPH_CLIENT_SECRET_EXPIRES || null },
        });
    } catch (error) {
        console.warn(`Could not record secret-expiry alert: ${error.message}`);
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const core = requireDashboardLib('improvement-cycle-core');
    const manifestLib = requireDashboardLib('review-rules-manifest');
    const supabase = getSupabase();
    const baseCycleId = new Date().toISOString().slice(0, 10);
    let cycleId = baseCycleId;

    console.log(`Improvement Cycle — ${baseCycleId}`);
    console.log('='.repeat(50));

    // Daily health check (runs even when the gate below skips the cycle).
    await checkGraphSecretExpiry(supabase, core);

    // Idempotency: one proposal per calendar day (cycle_id = YYYY-MM-DD).
    const [{ count: unconsumedCount }, { data: pendingProposals }, { data: existing }] = await Promise.all([
        supabase.from('correction_rules').select('*', { count: 'exact', head: true })
            .is('prompt_cycle_id', null).in('status', ['accepted', 'pending']),
        supabase.from('prompt_proposals')
            .select('id, cycle_id, created_at, correction_rule_count, submission_count, eval_status, llm_model')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(1),
        supabase.from('prompt_proposals')
            .select('id, status')
            .eq('cycle_id', baseCycleId)
            .maybeSingle(),
    ]);
    const pendingProposal = (pendingProposals || [])[0] || null;
    const minNewCorrections = Number.parseInt(process.env.IMPROVE_MIN_NEW_CORRECTIONS || '1', 10);
    const gate = core.shouldRunCycle({
        unconsumedCorrectionCount: unconsumedCount || 0,
        pendingProposal,
        minNewCorrections,
        force: !!args.force,
    });
    const supersedePending = gate.run && gate.mode === 'supersede' ? gate.pendingProposal : null;

    if (existing && !args.force && existing.status === 'pending') {
        console.log(`Proposal already exists for ${baseCycleId} (status: pending); exiting.`);
        return;
    }
    if (existing && args.force) {
        // cycle_id is NOT NULL UNIQUE, so a forced manual re-run on a day that
        // already has a proposal (e.g. the on-demand button after the nightly
        // cron) needs a distinct id to avoid colliding on insert.
        cycleId = `${baseCycleId}-manual-${Date.now()}`;
        console.log(`Forced re-run; ${baseCycleId} already has a proposal — using cycle id ${cycleId}.`);
    } else if (existing && ['rejected', 'superseded'].includes(`${existing.status || ''}`) && (gate.run || args.consolidate)) {
        // Rejected/superseded rows still occupy the calendar cycle_id slot.
        cycleId = `${baseCycleId}-manual-${Date.now()}`;
        console.log(`${baseCycleId} has a ${existing.status} proposal — using cycle id ${cycleId}.`);
    }

    if (!gate.run && !args.consolidate) {
        console.log(`Gate: skipping — ${gate.reason}.`);
        if (pendingProposal) {
            await sendPendingProposalReminderEmail(supabase, {
                proposal: pendingProposal,
                unconsumedCorrectionCount: unconsumedCount || 0,
            });
        }
        return;
    }
    console.log(`Gate: running — ${gate.reason}${args.force ? ' (forced)' : ''}${args.consolidate ? ' [consolidate]' : ''}${supersedePending ? ' [supersede]' : ''}.`);
    if (args.consolidate) {
        console.log('Consolidate mode: bypassing normal correction threshold; proposal will be labeled source=consolidation and evaluated for zero regressions.');
    }

    acquireLock();
    try {
        // Compute artifacts dir once; create early so Fix 2 can write replay evidence before the LLM step.
        const artifactsDir = path.join(repoRoot, 'tmp', 'improvement-cycle', cycleId);
        await fsp.mkdir(artifactsDir, { recursive: true });

        // 1. Effective current prompt (DB approval beats the baked-in file).
        const filePrompt = await fsp.readFile(path.join(repoRoot, 'sop-processor', 'qa_prompt.txt'), 'utf8');
        const { data: approvedProposals } = await supabase
            .from('prompt_proposals')
            .select('status, final_prompt, proposed_prompt, reviewed_at')
            .in('status', ['approved', 'approved_modified'])
            .order('reviewed_at', { ascending: false })
            .limit(5);
        const effective = core.pickEffectivePrompt(approvedProposals || [], filePrompt);
        console.log(`Effective prompt source: ${effective.source} (${effective.prompt.length} chars)`);
        const PROMPT_BUDGET = Number(process.env.IMPROVE_PROMPT_BUDGET_CHARS || 24000);
        if (effective.prompt.length > PROMPT_BUDGET) {
            console.warn(`IMPROVE_PROMPT_BUDGET_CHARS: effective prompt ${effective.prompt.length} > ${PROMPT_BUDGET}; run with --consolidate to produce a concision proposal.`);
        }

        // 2. Unconsumed corrections (skipped entirely in consolidate mode).
        let correctionRules = [];
        let supersedeMeta = null;
        if (!args.consolidate) {
            const { data: unconsumedRules, error: rulesError } = await supabase
                .from('correction_rules')
                .select('*')
                .is('prompt_cycle_id', null)
                .in('status', ['accepted', 'pending'])
                .order('created_at', { ascending: true });
            if (rulesError) throw new Error(`Failed to fetch correction rules: ${rulesError.message}`);

            if (supersedePending && supersedePending.cycle_id) {
                const { data: carriedRules, error: carriedErr } = await supabase
                    .from('correction_rules')
                    .select('*')
                    .eq('prompt_cycle_id', supersedePending.cycle_id)
                    .in('status', ['accepted', 'pending'])
                    .order('created_at', { ascending: true });
                if (carriedErr) throw new Error(`Failed to fetch carried-over corrections: ${carriedErr.message}`);
                const assembled = core.assembleSupersedeCorrectionSet(unconsumedRules || [], carriedRules || []);
                correctionRules = assembled.combined;
                supersedeMeta = {
                    fromCycleId: supersedePending.cycle_id,
                    pendingProposalId: supersedePending.id,
                    carriedCount: assembled.carriedCount,
                    newCount: assembled.newCount,
                };
                console.log(`Supersede corrections: ${assembled.carriedCount} carried-over + ${assembled.newCount} new (${correctionRules.length} total)`);
            } else {
                correctionRules = unconsumedRules || [];
            }
            console.log(`Corrections to analyze: ${correctionRules.length}`);
        } else {
            console.log('Consolidate mode: skipping correction fetch, replay, excerpts, and prior-rejection context.');
        }

        // 3. Code-rules manifest (code + currently accepted rules).
        const { data: acceptedRules } = await supabase
            .from('correction_rules').select('*').eq('status', 'accepted').limit(1000);
        const manifest = manifestLib.buildReviewRulesManifest({ acceptedCorrectionRules: acceptedRules || [] });
        const manifestMarkdown = manifestLib.renderRulesManifestMarkdown(manifest, { includeDynamic: true });

        // Distinct trigger submissions for this cycle's corrections. Declared BEFORE the
        // Fix 2 replay block (which iterates it) — a later declaration puts the replay loop
        // in the temporal dead zone, and the resulting ReferenceError is swallowed by the
        // replay try/catch, silently disabling replay evidence on every run.
        const submissionIds = [...new Set(correctionRules.map((r) => r.submission_id))].filter(Boolean);

        // Fix 2: pre-analysis replay on trigger submissions (using effective prompt + live accepted rules)
        // to tag each correction as still_missed / now_correct / replay_unavailable.
        // Skipped for consolidate (no corrections, different goal).
        let replayEvidence = [];
        let replayEnvironmentWarning = null;
        if (!args.consolidate) {
        try {
            const { extractReplacementSignals } = requireDifferLib('lib/learning-signals');
            const dsPath = path.join(repoRoot, 'tmp', 'review-eval', 'dataset.jsonl');
            const dsByCase = new Map();
            if (fs.existsSync(dsPath)) {
                for (const line of fs.readFileSync(dsPath, 'utf8').split('\n').filter(Boolean)) {
                    try { const c = JSON.parse(line); if (c && c.case_id) dsByCase.set(c.case_id, c); } catch {}
                }
            }
            const acceptedForReplay = (acceptedRules || []).filter((r) => r.status === 'accepted');
            const replayOutForSid = new Map();
            for (const sid of submissionIds) {
                let row = null;
                for (const [cid, c] of dsByCase.entries()) {
                    if (cid === `production:${sid}` || cid.endsWith(`:${sid}`)) { row = c; break; }
                }
                if (!row || !row.raw_input) {
                    // light fallback query
                    const { data: srows } = await supabase.from('submissions').select('id,legacy_id,menu_content,approved_menu_content,form_attempt_id,property,template_type,menu_type,service_period,allergens:raw_payload->>allergens').or(`id.eq.${sid},legacy_id.eq.${sid}`).limit(1);
                    const s = (srows || [])[0];
                    if (s && `${s.approved_menu_content || ''}`.trim()) {
                        let raw = s.menu_content || '';
                        if (s.form_attempt_id) {
                            const { data: auds } = await supabase.from('basic_ai_check_audits').select('menu_content_raw,ai_request').eq('attempt_id', s.form_attempt_id).order('created_at', { ascending: false }).limit(1);
                            const a = (auds || [])[0];
                            if (a && a.menu_content_raw) raw = a.menu_content_raw;
                            else if (a && a.ai_request && a.ai_request.text) raw = a.ai_request.text;
                        }
                        row = { raw_input: raw, context: { property: s.property || '', templateType: s.template_type || 'food', menuType: s.menu_type || 'standard', allergens: s.allergens || '' } };
                    }
                }
                const raw = row && row.raw_input;
                for (const r of correctionRules) {
                    if (r.submission_id !== sid) continue;
                    // C4b: a freeform rule with no exact pair becomes replay-verifiable when the human
                    // supplied an example (example_original/example_corrected) — match on that instead.
                    const o = r.original_text || r.example_original || '';
                    const c = r.corrected_text || r.example_corrected || '';
                    if (!`${o}`.trim() && !`${c}`.trim()) {
                        replayEvidence.push({ correction_id: r.id, submission_id: sid, original_text: o, corrected_text: c, status: 'not_verifiable' });
                        continue;
                    }
                    if (!raw) {
                        replayEvidence.push({ correction_id: r.id, submission_id: sid, original_text: o, corrected_text: c, status: 'replay_unavailable' });
                        continue;
                    }
                    let replayOut = '';
                    try {
                        // run once per sid (memoize if multiple corrections per sid)
                        if (!replayOutForSid.has(sid)) {
                            replayOutForSid.set(sid, await runReplayForRaw(raw, effective.prompt, acceptedForReplay, (row && row.context) || {}));
                        }
                        replayOut = replayOutForSid.get(sid) || '';
                    } catch (re) {
                        console.warn(`Replay run failed for submission ${sid}: ${re.message}`);
                    }
                    const signals = replayOut ? extractReplacementSignals(raw, replayOut) : [];
                    const st = core.decideReplayStatus(o, c, replayOut, signals);
                    replayEvidence.push({ correction_id: r.id, submission_id: sid, original_text: o, corrected_text: c, status: st });
                }
            }
            await fsp.writeFile(path.join(artifactsDir, 'replay_evidence.json'), JSON.stringify(replayEvidence, null, 2));
            console.log(`Replay evidence: ${replayEvidence.length} corrections tagged`);
        } catch (replayErr) {
            console.warn(`Pre-analysis replay skipped: ${replayErr.message}`);
            const fallback = core.buildReplayUnavailableForCorrections(correctionRules, replayErr.message);
            replayEvidence = fallback.evidence;
            replayEnvironmentWarning = fallback.warning;
            console.warn(replayEnvironmentWarning);
        }
        } // end consolidate skip for replay

        // 4. Document excerpts for the corrections' submissions (Fix 6 / B3: centered windows).
        // Skipped for consolidate (no corrections).
        const pythonBin = resolvePythonBin();
        const correctionsBySid = new Map();
        for (const r of correctionRules) {
            if (!r.submission_id) continue;
            const list = correctionsBySid.get(r.submission_id) || [];
            list.push({ id: r.id, original_text: r.original_text || '', corrected_text: r.corrected_text || '', submission_id: r.submission_id });
            correctionsBySid.set(r.submission_id, list);
        }
        const documentExcerpts = []; // now richer: per-correction windows when available
        let cycleExcerptBudget = 0;
        const CYCLE_BUDGET = 40000;
        if (!args.consolidate) {
        for (const submissionId of submissionIds.slice(0, 10)) {
            const { data: assets } = await supabase
                .from('assets')
                .select('asset_type, storage_path')
                .eq('submission_id', submissionId)
                .in('asset_type', ['ai_draft_docx', 'original_docx', 'approved_docx']);
            const aiDraft = (assets || []).find((a) => a.asset_type === 'ai_draft_docx')
                || (assets || []).find((a) => a.asset_type === 'original_docx');
            const approved = (assets || []).find((a) => a.asset_type === 'approved_docx');
            const aiText = extractCleanMenuText(pythonBin, aiDraft?.storage_path);
            const finalText = extractCleanMenuText(pythonBin, approved?.storage_path);
            const corrs = correctionsBySid.get(submissionId) || [];
            if ((aiText || finalText) && corrs.length) {
                const built = core.buildCorrectionExcerptWindows(aiText || '', finalText || '', corrs, { perSubBudgetChars: 4000 });
                for (const w of built.windows) {
                    const cost = (w.ai_window || '').length + (w.final_window || '').length;
                    if (cycleExcerptBudget + cost > CYCLE_BUDGET) break;
                    documentExcerpts.push({
                        submission_id: submissionId,
                        correction_id: w.correction_id,
                        ai_excerpt: w.ai_window,
                        final_excerpt: w.final_window,
                    });
                    cycleExcerptBudget += cost;
                }
            } else if (aiText || finalText) {
                // fallback for subs without paired corrections (orientation)
                const headAi = (aiText || '').slice(0, 200) + ((aiText || '').length > 200 ? ' …' : '');
                const headFin = (finalText || '').slice(0, 200) + ((finalText || '').length > 200 ? ' …' : '');
                const cost = headAi.length + headFin.length;
                if (cycleExcerptBudget + cost <= CYCLE_BUDGET) {
                    documentExcerpts.push({ submission_id: submissionId, ai_excerpt: headAi, final_excerpt: headFin });
                    cycleExcerptBudget += cost;
                }
            }
        }
        console.log(`Document excerpts: ${documentExcerpts.length}`);
        } // end consolidate skip for excerpts

        // 4b. (Fix 1) Ensure trigger submissions are present in the eval dataset so progression can be measured.
        const datasetPath = path.join(repoRoot, 'tmp', 'review-eval', 'dataset.jsonl');
        let triggerInfo = { built: [], unavailable: [] };
        try {
            triggerInfo = await ensureTriggerCasesInDataset(supabase, submissionIds, datasetPath);
            console.log(`Trigger cases ensured — built ${triggerInfo.built.length}, unavailable ${triggerInfo.unavailable.length}`);
        } catch (e) {
            console.warn(`Failed to ensure trigger cases: ${e.message}`);
        }

        // 5. Latest eval summary as context (optional).
        let priorEvalContext = '';
        const latestReportPath = findLatestEvalReport();
        if (latestReportPath) {
            try {
                const latest = JSON.parse(fs.readFileSync(latestReportPath, 'utf8'));
                priorEvalContext = [
                    '## Latest Eval Snapshot',
                    `- Cases: ${latest.summary.casesEvaluated}, exact matches ${latest.summary.exactMatches}`,
                    `- Avg composite ${(latest.summary.avgComposite * 100).toFixed(2)}%, correction F1 ${(latest.summary.corrections.f1 * 100).toFixed(2)}%`,
                    `- Top misses: ${(latest.cases || []).flatMap((c) => c.corrections.missed).slice(0, 10).map((m) => `${m.from}->${m.to}`).join(', ') || 'none'}`,
                ].join('\n');
            } catch { /* optional context */ }
        }

        // Fix 3: carry forward prior rejection notes for overlapping corrections (feedback channel).
        // Improved (Follow-up 3): match on submission id intersection when possible by querying
        // the consumed correction_rules for that rejected proposal's cycle. Fall back to date
        // overlap only for older rows without linked corrections.
        // Skipped for consolidate.
        let priorRejectionContext = '';
        if (!args.consolidate) {
        try {
            const corrDates = correctionRules.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
            const cMin = corrDates.length ? Math.min(...corrDates) : 0;
            const cMax = corrDates.length ? Math.max(...corrDates) : 0;
            const { data: rejectedPros } = await supabase
                .from('prompt_proposals')
                .select('cycle_id, llm_analysis, reviewer_notes, date_range_start, date_range_end, created_at')
                .eq('status', 'rejected')
                .order('reviewed_at', { ascending: false })
                .limit(30);
            const overlaps = (aStart, aEnd, bStart, bEnd) => {
                if (!aStart || !bStart) return true;
                return !(aEnd < bStart || bEnd < aStart);
            };
            const relevant = [];
            for (const p of (rejectedPros || [])) {
                // Fetch linked corrections' submission ids for this rejected proposal
                let linkedSids = [];
                try {
                    const { data: cons } = await supabase
                        .from('correction_rules')
                        .select('submission_id')
                        .eq('prompt_cycle_id', p.cycle_id)
                        .limit(200);
                    linkedSids = (cons || []).map((c) => c.submission_id).filter(Boolean);
                } catch { /* ignore per-proposal */ }
                const hasIdOverlap = linkedSids.length > 0 && linkedSids.some((s) => submissionIds.includes(s));
                const pStart = p.date_range_start ? Date.parse(p.date_range_start) : Date.parse(p.created_at || 0);
                const pEnd = p.date_range_end ? Date.parse(p.date_range_end) : pStart;
                const dateOk = overlaps(pStart, pEnd || pStart, cMin, cMax);
                if (hasIdOverlap || (linkedSids.length === 0 && dateOk)) {
                    relevant.push(p);
                }
            }
            if (relevant.length) {
                priorRejectionContext = relevant.slice(0, 3).map((p) => [
                    `## Prior Rejected Proposal ${p.cycle_id}`,
                    p.reviewer_notes ? `Reviewer notes: ${p.reviewer_notes}` : '',
                    p.llm_analysis ? `Analysis summary: ${String(p.llm_analysis).slice(0, 600)}` : '',
                ].filter(Boolean).join('\n')).join('\n\n');
            }
        } catch (rejCtxErr) {
            console.warn(`Prior rejection context unavailable: ${rejCtxErr.message}`);
        }
        } // end consolidate skip for prior rejection

        // 6. Build the user prompt.
        let userPrompt;
        let systemPromptToUse;
        if (args.consolidate) {
            // Minimal context for consolidation: prompt + manifest only. No corrections, no replay, no excerpts.
            userPrompt = [
                '## Current QA Prompt',
                core.CURRENT_PROMPT_BEGIN_MARKER,
                effective.prompt,
                core.CURRENT_PROMPT_END_MARKER,
                '',
                '## Code Rules Manifest (deterministic layers — you cannot edit these, but propose changes against them)',
                manifestMarkdown,
            ].join('\n');
            systemPromptToUse = core.CONSOLIDATION_SYSTEM_PROMPT;
            console.log(`LLM context size (consolidation): ~${(systemPromptToUse.length + userPrompt.length).toLocaleString()} chars`);
        } else {
            const replayByCorrId = new Map(replayEvidence.map((e) => [e.correction_id, e]));
            const correctionLines = correctionRules.map((r, i) => {
                const scope = r.is_location_specific
                    ? `Location-specific: ${r.location}${r.other_applicable_locations?.length ? ` (also: ${r.other_applicable_locations.join(', ')})` : ''}`
                    : 'Universal (all properties)';
                const ev = replayByCorrId.get(r.id);
                let replayTag = '';
                if (ev) {
                    if (ev.status === 'still_missed') replayTag = `   REPLAY EVIDENCE: still_missed — the current pipeline reproduces this mistake as of this run.`;
                    else if (ev.status === 'now_correct') replayTag = `   REPLAY EVIDENCE: now_correct — the current pipeline already produces the human correction.`;
                    else if (ev.status === 'not_verifiable') replayTag = `   REPLAY EVIDENCE: not_verifiable — freeform guidance, not mechanically checkable.`;
                    else replayTag = `   REPLAY EVIDENCE: ${ev.status} — replay unavailable for this submission.`;
                }
                const exampleLine = (!r.original_text && !r.corrected_text && (r.example_original || r.example_corrected))
                    ? `   Human-supplied example (prefer these exact strings if you synthesize a rule): "${r.example_original || ''}" -> "${r.example_corrected || ''}"`
                    : '';
                return [
                    `${i + 1}. Correction (correction_id: ${r.id}):`,
                    `   Original: "${r.original_text || '(freeform guidance)'}"`,
                    `   Corrected: "${r.corrected_text || '(freeform guidance)'}"`,
                    exampleLine,
                    `   Reviewer explanation: "${r.rule}"`,
                    `   Type: ${r.change_type || 'unspecified'} | Menu scope: ${r.applies_to_menu_type || 'all'} | ${scope}`,
                    `   Restaurant: ${r.restaurant_name || 'N/A'} | Source: ${r.source}${r.source === 'system' ? ` (seen ${r.occurrences}x)` : ''} | Status: ${r.status}`,
                    replayTag,
                ].filter(Boolean).join('\n');
            });
            const docLines = documentExcerpts.map((d) => [
                `### Submission ${d.submission_id}${d.correction_id ? ` · Correction ${d.correction_id}` : ''}`,
                '**AI Draft (excerpt):**', d.ai_excerpt,
                '**Human-Corrected (excerpt):**', d.final_excerpt, '',
            ].join('\n'));
            userPrompt = [
                '## Current QA Prompt',
                core.CURRENT_PROMPT_BEGIN_MARKER,
                effective.prompt,
                core.CURRENT_PROMPT_END_MARKER,
                '',
                '## Code Rules Manifest (deterministic layers — you cannot edit these, but propose replacement rules and code recommendations against them)',
                manifestMarkdown,
                '',
                `## New Reviewer Corrections (${correctionRules.length})`,
                ...correctionLines,
                '',
                documentExcerpts.length ? '## Sample Before/After Documents' : '',
                ...docLines,
                priorEvalContext,
                priorRejectionContext ? `\n## Prior Rejected Attempts (feedback for this cycle)\n${priorRejectionContext}` : '',
            ].join('\n');
            systemPromptToUse = core.IMPROVEMENT_SYSTEM_PROMPT;
            console.log(`LLM context size: ~${(systemPromptToUse.length + userPrompt.length).toLocaleString()} chars`);
        }

        // C1: inject the exact fence count to preserve (computed at assembly time) so the model
        // is told, up front and on every retry, exactly how many fenced blocks must survive.
        const currentPromptFenceCount = core.countFencedCodeDelimiters(effective.prompt);
        userPrompt += core.buildFencePreservationNote(currentPromptFenceCount);

        if (args.dryRun) {
            const dryDir = path.join(repoRoot, 'tmp', 'improvement-cycle', `${cycleId}-dry-run`);
            await fsp.mkdir(dryDir, { recursive: true });
            await fsp.writeFile(path.join(dryDir, 'user_prompt.txt'), userPrompt);
            console.log(`Dry run: context written to ${dryDir}; no LLM call, no proposal.`);
            return;
        }

        // 7. LLM analysis (C1: retry-with-feedback when a prompt-shape guard discards the rewrite).
        console.log('Calling improvement LLM...');
        const maxRetries = Number.isFinite(Number(process.env.IMPROVE_MAX_RETRIES))
            ? Math.max(0, Number(process.env.IMPROVE_MAX_RETRIES))
            : 2;
        const proposalResult = await core.runImprovementProposalWithRetry({
            systemPrompt: systemPromptToUse,
            userPrompt,
            currentPromptFenceCount,
            maxRetries,
            validateOpts: {
                currentPrompt: effective.prompt,
                replayEvidence: args.consolidate ? [] : replayEvidence,
                sourceCorrections: args.consolidate ? [] : correctionRules,
                consolidation: !!args.consolidate,
            },
            callLlm: postImprovementCompletion,
        });
        const validated = proposalResult.validated;
        const llmResult = { model: proposalResult.model, usage: proposalResult.usage };
        if (proposalResult.attempts.length > 1) {
            console.log(`LLM took ${proposalResult.attempts.length} attempt(s); guard discards: ${proposalResult.discardedPrompts.length}${proposalResult.guardRetriesExhausted ? ' (retries exhausted — rewrite discarded)' : ''}.`);
        }
        console.log(`Model: ${llmResult.model}, tokens: ${llmResult.usage?.total_tokens || 'n/a'}`);
        if (replayEnvironmentWarning) {
            validated.warnings.unshift(replayEnvironmentWarning);
        }
        for (const warning of validated.warnings) console.warn(`LLM output warning: ${warning}`);
        console.log(`Proposed prompt: ${validated.promptUnchanged ? `UNCHANGED (${validated.promptUnchangedReason || 'kept'})` : `${validated.proposed_prompt.length} chars`}; rules: ${validated.proposed_replacement_rules.length}; code recommendations: ${validated.code_recommendations.length}; coverage claims: ${(validated.coverage_claims || []).length}; routing rows: ${(validated.correction_routing || []).length}`);

        // C2: keep discarded rewrites as forensics artifacts (never in the DB).
        for (let i = 0; i < proposalResult.discardedPrompts.length; i++) {
            await fsp.writeFile(path.join(artifactsDir, `discarded_prompt_attempt${i + 1}.txt`), proposalResult.discardedPrompts[i] || '');
        }

        // C2: honest, code-computed disposition — what this proposal actually concluded.
        const disposition = core.computeDisposition({
            promptUnchanged: validated.promptUnchanged,
            promptUnchangedReason: validated.promptUnchangedReason,
            guardRetriesExhausted: proposalResult.guardRetriesExhausted,
            proposedRuleCount: validated.proposed_replacement_rules.length,
            codeRecommendationCount: validated.code_recommendations.length,
        });
        console.log(`Disposition: ${disposition} — ${core.describeDisposition(disposition, { ruleCount: validated.proposed_replacement_rules.length, recCount: validated.code_recommendations.length, guardAttempts: proposalResult.attempts.length })}`);

        // 8. Auto-eval baseline vs candidate.
        // (artifactsDir created early for replay evidence; reuse the same path)
        const currentPromptPath = path.join(artifactsDir, 'current_prompt.txt');
        const candidatePromptPath = path.join(artifactsDir, 'proposed_prompt.txt');
        const candidateRulesPath = path.join(artifactsDir, 'proposed_rules.json');
        await fsp.writeFile(currentPromptPath, effective.prompt);
        await fsp.writeFile(candidatePromptPath, validated.proposed_prompt);
        await fsp.writeFile(candidateRulesPath, JSON.stringify({ rules: validated.proposed_replacement_rules }, null, 2));
        if (validated.coverage_claims && validated.coverage_claims.length) {
            await fsp.writeFile(path.join(artifactsDir, 'coverage_claims.json'), JSON.stringify(validated.coverage_claims, null, 2));
        }

        let evalSummary = null;
        let evalStatus = 'skipped';
        // C2: when the candidate is byte-identical to baseline AND has no replacement rules, a full
        // eval run is pure waste (the candidate output cannot differ). Skip it and record no_effect.
        const skipCandidateEval = !args.consolidate && core.shouldSkipCandidateEval({
            promptUnchanged: validated.promptUnchanged,
            proposedRuleCount: validated.proposed_replacement_rules.length,
        });
        if (args.skipEval) {
            console.log('Eval skipped (--skip-eval / IMPROVE_SKIP_EVAL).');
        } else if (skipCandidateEval) {
            console.log(`Candidate identical to baseline with no replacement rules — ${core.IDENTICAL_CANDIDATE_EVAL_NOTE} (C2).`);
            evalStatus = 'no_effect';
            evalSummary = {
                baseline: null, candidate: null, comparedCases: 0, avgDelta: 0,
                improved: 0, regressed: 0, same: 0, regressions: [],
                note: core.IDENTICAL_CANDIDATE_EVAL_NOTE,
            };
        } else {
            console.log('Running eval harness: baseline...');
            const limitArgs = process.env.IMPROVE_EVAL_LIMIT ? ['--limit', process.env.IMPROVE_EVAL_LIMIT] : [];
            const baselineRun = runEvalHarness([
                '--prompt', currentPromptPath, '--rules', 'live',
                '--label', `improve-${cycleId}-baseline`, ...limitArgs,
            ]);
            if (!baselineRun.ok || !baselineRun.reportPath) {
                evalSummary = { baseline: null, candidate: null, comparedCases: 0, avgDelta: 0, improved: 0, regressed: 0, same: 0, regressions: [], error: `baseline eval failed: ${(baselineRun.stderr || baselineRun.stdout).slice(-400)}` };
                evalStatus = 'failed';
            } else {
                console.log('Running eval harness: candidate...');
                const candidateRun = runEvalHarness([
                    '--prompt', candidatePromptPath, '--rules', `candidate:${candidateRulesPath}`,
                    '--baseline', baselineRun.reportPath,
                    // Back-to-back regression confirmation: re-run the baseline config
                    // (current prompt + live rules) alongside the candidate so OpenAI's
                    // temporal temp-0 drift cancels and only real regressions count.
                    '--baseline-prompt', currentPromptPath, '--baseline-rules', 'live',
                    '--label', `improve-${cycleId}-candidate`, ...limitArgs,
                ]);
                if (!candidateRun.ok || !candidateRun.reportPath) {
                    evalSummary = { baseline: null, candidate: null, comparedCases: 0, avgDelta: 0, improved: 0, regressed: 0, same: 0, regressions: [], error: `candidate eval failed: ${(candidateRun.stderr || candidateRun.stdout).slice(-400)}` };
                    evalStatus = 'failed';
                } else {
                    const baselineReport = JSON.parse(fs.readFileSync(baselineRun.reportPath, 'utf8'));
                    const candidateReport = JSON.parse(fs.readFileSync(candidateRun.reportPath, 'utf8'));
                    evalSummary = core.buildProposalEvalSummary(
                        core.summarizeEvalReport('baseline', baselineReport, baselineRun.reportPath),
                        core.summarizeEvalReport('candidate', candidateReport, candidateRun.reportPath),
                        candidateReport
                    );

                    // Fix 1: supplement any trigger cases missed due to --limit, then attach trigger progression block.
                    try {
                        const bMap = new Map((baselineReport.cases || []).map((c) => [c.case_id, c]));
                        const cMap = new Map((candidateReport.cases || []).map((c) => [c.case_id, c]));
                        // Collect comparison entries (with possible freshDelta after confirmation) for trigger classification.
                        const compDeltaByCase = new Map();
                        const mainBc = candidateReport && candidateReport.baselineComparison;
                        if (mainBc) {
                            for (const list of [mainBc.improvements || [], mainBc.regressions || [], mainBc.noiseRegressions || []]) {
                                for (const e of list) if (e && e.case_id) compDeltaByCase.set(e.case_id, e);
                            }
                        }
                        function findCase(m, sid) {
                            for (const [k, v] of m.entries()) {
                                if (k === `production:${sid}` || k.endsWith(`:${sid}`)) return v;
                            }
                            return null;
                        }
                        const allSids = [...new Set(submissionIds)];
                        const missingSids = allSids.filter((sid) => !findCase(cMap, sid));
                        if (missingSids.length) {
                            console.log(`  Supplementing ${missingSids.length} trigger case(s) for progression scoring...`);
                            const suppBase = runEvalHarness([
                                '--prompt', currentPromptPath, '--rules', 'live',
                                '--label', `improve-${cycleId}-triggers-base`,
                                ...missingSids.flatMap((s) => ['--case', `production:${s}`]),
                            ]);
                            const suppBCases = (suppBase.ok && suppBase.reportPath)
                                ? JSON.parse(fs.readFileSync(suppBase.reportPath, 'utf8')).cases || []
                                : [];
                            for (const c of suppBCases) bMap.set(c.case_id, c);
                            if (suppBase.ok && suppBase.reportPath) {
                                const suppCand = runEvalHarness([
                                    '--prompt', candidatePromptPath, '--rules', `candidate:${candidateRulesPath}`,
                                    '--baseline', suppBase.reportPath,
                                    '--baseline-prompt', currentPromptPath, '--baseline-rules', 'live',
                                    '--label', `improve-${cycleId}-triggers-cand`,
                                    ...missingSids.flatMap((s) => ['--case', `production:${s}`]),
                                ]);
                                const suppFull = (suppCand.ok && suppCand.reportPath)
                                    ? JSON.parse(fs.readFileSync(suppCand.reportPath, 'utf8'))
                                    : null;
                                const suppCCases = (suppFull && suppFull.cases) || [];
                                for (const c of suppCCases) cMap.set(c.case_id, c);
                                // Also harvest comparison deltas from the supp report (same-window pair for these triggers)
                                const sbc = suppFull && suppFull.baselineComparison;
                                if (sbc) {
                                    for (const list of [sbc.improvements || [], sbc.regressions || [], sbc.noiseRegressions || []]) {
                                        for (const e of list) if (e && e.case_id) compDeltaByCase.set(e.case_id, e);
                                    }
                                }
                            }
                        }
                        // Build triggers block using (possibly supplemented) maps.
                        // Follow-up 1: prefer deltas from baselineComparison entries (these are the
                        // ones computed under the --baseline run, and for re-checked cases include
                        // freshDelta from back-to-back confirmation). This prevents temporal drift
                        // from creating false "improved" on triggers.
                        const EPS = 0.02;
                        const trigs = [];
                        let ti = 0, tu = 0, tr = 0, tna = 0;
                        const unavSet = new Set((triggerInfo && triggerInfo.unavailable) || []);
                        for (const sid of allSids) {
                            const cand = findCase(cMap, sid);
                            if (!cand) {
                                tna++;
                                trigs.push({
                                    case_id: `production:${sid}`,
                                    submission_id: sid,
                                    baseline_composite: null,
                                    candidate_composite: null,
                                    delta: null,
                                    status: 'unavailable',
                                });
                                continue;
                            }
                            const base = findCase(bMap, sid);
                            const bComp = base ? round8(base.composite) : null;
                            const cComp = round8(cand.composite);
                            // Prefer confirmed_delta (B0 / Follow-up 1: the fresh back-to-back when confirmation ran).
                            // Fall back to freshDelta (older reports) then raw delta.
                            const entry = compDeltaByCase.get(cand.case_id) || compDeltaByCase.get(`production:${sid}`);
                            let delta = null;
                            if (entry) {
                                if (entry.confirmed_delta != null) delta = round8(entry.confirmed_delta);
                                else if (entry.freshDelta != null) delta = round8(entry.freshDelta);
                                else if (entry.delta != null) delta = round8(entry.delta);
                            }
                            if (delta == null && bComp != null) {
                                delta = round8(cComp - bComp);
                            }
                            const st = core.classifyTriggerFromComparisonEntry(entry || (delta != null ? { delta } : null), EPS);
                            if (st === 'improved') ti++;
                            else if (st === 'regressed') tr++;
                            else if (st === 'unchanged') tu++;
                            trigs.push({
                                case_id: cand.case_id,
                                submission_id: sid,
                                baseline_composite: bComp,
                                candidate_composite: cComp,
                                delta,
                                status: st,
                            });
                        }
                        evalSummary.triggers = trigs;
                        evalSummary.triggers_improved = ti;
                        evalSummary.triggers_unchanged = tu;
                        evalSummary.triggers_regressed = tr;
                        evalSummary.triggers_unavailable = tna;
                        // Recompute status now that triggers are known
                        evalStatus = core.evalStatusFromSummary(evalSummary, { consolidation: !!args.consolidate });
                    } catch (trigErr) {
                        console.warn(`Trigger progression extraction failed: ${trigErr.message}`);
                    }
                }
            }
            console.log(`Eval status: ${evalStatus}${evalSummary?.error ? ` (${evalSummary.error.slice(0, 160)})` : ''}`);
        }

        // 9. Store the proposal.
        const dates = correctionRules.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
        let proposalRow = {
            cycle_id: cycleId,
            current_prompt: effective.prompt,
            proposed_prompt: validated.proposed_prompt,
            prompt_diff: null,
            correction_rule_count: correctionRules.length,
            submission_count: submissionIds.length,
            date_range_start: dates.length ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : null,
            date_range_end: dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : null,
            llm_analysis: validated.analysis,
            llm_warnings: validated.warnings,
            llm_model: llmResult.model,
            status: 'pending',
            proposed_rules: validated.proposed_replacement_rules,
            code_recommendations: validated.code_recommendations,
            eval_summary: evalSummary,
            eval_status: evalStatus,
            source: args.consolidate ? 'consolidation' : 'improvement_cycle',
            replay_evidence: replayEvidence && replayEvidence.length ? replayEvidence : null,
            unresolved_still_missed: !!validated.unresolved_still_missed,
            coverage_claims: validated.coverage_claims && validated.coverage_claims.length ? validated.coverage_claims : null,
            prompt_length: (validated.proposed_prompt || effective.prompt || '').length,
            disposition,
            correction_routing: validated.correction_routing && validated.correction_routing.length ? validated.correction_routing : null,
        };
        if (supersedeMeta) {
            proposalRow.superseded_from_cycle_id = supersedeMeta.fromCycleId;
            proposalRow.supersede_carried_correction_count = supersedeMeta.carriedCount;
            proposalRow.supersede_new_correction_count = supersedeMeta.newCount;
        } else if (args.consolidate && pendingProposal && pendingProposal.cycle_id) {
            proposalRow.superseded_from_cycle_id = pendingProposal.cycle_id;
        }
        let { error: insertError } = await supabase.from('prompt_proposals').insert(proposalRow);
        if (insertError && /llm_warnings/i.test(insertError.message || '')) {
            console.warn(`prompt_proposals.llm_warnings is unavailable; storing proposal without validation notes. Apply supabase/migrations/20260626_add_prompt_proposal_llm_warnings.sql. (${insertError.message})`);
            const { llm_warnings: _llmWarnings, ...fallbackProposalRow } = proposalRow;
            proposalRow = fallbackProposalRow;
            ({ error: insertError } = await supabase.from('prompt_proposals').insert(proposalRow));
        }
        if (insertError && /(replay_evidence|unresolved_still_missed|coverage_claims|prompt_length|superseded_from_cycle_id|supersede_carried_correction_count|supersede_new_correction_count|disposition|correction_routing)/i.test(insertError.message || '')) {
            console.warn('prompt_proposals extra column(s) missing; storing without. Apply recent migrations. (degrade gracefully)');
            const {
                replay_evidence: _re, unresolved_still_missed: _um, coverage_claims: _cc, prompt_length: _pl,
                superseded_from_cycle_id: _sfc, supersede_carried_correction_count: _scc, supersede_new_correction_count: _snc,
                disposition: _disp, correction_routing: _croute,
                ...fb
            } = proposalRow;
            proposalRow = fb;
            ({ error: insertError } = await supabase.from('prompt_proposals').insert(proposalRow));
        }
        if (insertError) throw new Error(`Failed to store proposal: ${insertError.message}`);

        // Supersede: mark the prior pending proposal only after the new row lands.
        const supersedeTargetId = supersedeMeta?.pendingProposalId
            || (args.consolidate && pendingProposal?.id ? pendingProposal.id : null);
        if (supersedeTargetId) {
            const supersedePatch = { status: 'superseded', superseded_by_cycle_id: cycleId };
            let { error: supersedeErr } = await supabase
                .from('prompt_proposals')
                .update(supersedePatch)
                .eq('id', supersedeTargetId)
                .eq('status', 'pending');
            if (supersedeErr && /superseded_by_cycle_id/i.test(supersedeErr.message || '')) {
                ({ error: supersedeErr } = await supabase
                    .from('prompt_proposals')
                    .update({ status: 'superseded' })
                    .eq('id', supersedeTargetId)
                    .eq('status', 'pending'));
            }
            if (supersedeErr) {
                console.warn(`Failed to mark prior proposal superseded (new proposal ${cycleId} is pending): ${supersedeErr.message}`);
            } else {
                const oldCycle = supersedeMeta?.fromCycleId || pendingProposal?.cycle_id || supersedeTargetId;
                console.log(`Marked prior proposal ${oldCycle} as superseded by ${cycleId}.`);
            }
        }

        // 10. Mark corrections consumed.
        const ruleIds = correctionRules.map((r) => r.id).filter(Boolean);
        if (ruleIds.length) {
            const { error: consumeError } = await supabase
                .from('correction_rules')
                .update({ prompt_cycle_id: cycleId, consumed_at: new Date().toISOString() })
                .in('id', ruleIds);
            if (consumeError) console.warn(`Failed to mark corrections consumed: ${consumeError.message}`);
        }

        // 11. Artifacts + notification.
        await fsp.writeFile(path.join(artifactsDir, 'analysis.txt'), validated.analysis);
        await fsp.writeFile(path.join(artifactsDir, 'warnings.json'), JSON.stringify(validated.warnings, null, 2));
        await fsp.writeFile(path.join(artifactsDir, 'code_recommendations.json'), JSON.stringify(validated.code_recommendations, null, 2));
        if (evalSummary) {
            await fsp.writeFile(path.join(artifactsDir, 'eval_summary.json'), JSON.stringify(evalSummary, null, 2));
        }
        await sendProposalEmail(supabase, {
            cycleId,
            evalStatus,
            evalSummary,
            correctionCount: correctionRules.length,
            ruleCount: validated.proposed_replacement_rules.length,
            recommendationCount: validated.code_recommendations.length,
            supersede: supersedeMeta,
            disposition,
            correctionRouting: validated.correction_routing || [],
        });

        console.log(`\nDone. Proposal ${cycleId} stored (eval: ${evalStatus}). Review at /learning/prompt-proposal`);
    } finally {
        releaseLock();
    }
}

main().catch((error) => {
    console.error(`Improvement cycle failed: ${error.message}`);
    releaseLock();
    process.exit(1);
});
