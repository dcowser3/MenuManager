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
 *   IMPROVE_MODEL                Analysis model (default PROMPT_REWRITE_MODEL || gpt-4o)
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

function getSupabase() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) are required');
    }
    return createClient(url, key);
}

function parseArgs(argv) {
    return {
        force: argv.includes('--force'),
        skipEval: argv.includes('--skip-eval') || /^(1|true|yes|on)$/i.test(process.env.IMPROVE_SKIP_EVAL || ''),
        dryRun: argv.includes('--dry-run'),
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

async function callImprovementLlm(systemPrompt, userPrompt) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your-openai-api-key-here') {
        throw new Error('OPENAI_API_KEY is required for the improvement cycle');
    }
    const model = process.env.IMPROVE_MODEL || process.env.PROMPT_REWRITE_MODEL || 'gpt-4o';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 16000,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        }),
    });
    if (!response.ok) {
        throw new Error(`OpenAI API error ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    const data = await response.json();
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

async function sendProposalEmail(supabase, { cycleId, evalStatus, evalSummary, correctionCount, ruleCount, recommendationCount }) {
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
        const verdict = evalStatus === 'passed'
            ? `Eval PASSED: avg delta ${(100 * (evalSummary?.avgDelta || 0)).toFixed(3)} pp, ${evalSummary?.improved || 0} improved, 0 regressed`
            : evalStatus === 'regressed'
                ? `Eval REGRESSED on ${evalSummary?.regressed} case(s) — review carefully`
                : `Eval ${evalStatus}`;
        await alertMail.sendAlertMail({
            subject: `Review-improvement proposal ready (${cycleId}) — ${evalStatus}`,
            to,
            html: [
                `<p>A new review-improvement proposal is ready for cycle <strong>${cycleId}</strong>.</p>`,
                `<ul>`,
                `<li>${correctionCount} reviewer correction(s) analyzed</li>`,
                `<li>${ruleCount} deterministic replacement rule(s) proposed</li>`,
                `<li>${recommendationCount} code recommendation(s)</li>`,
                `<li>${verdict}</li>`,
                `</ul>`,
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

    // Idempotency: one proposal per day.
    const { data: existing } = await supabase
        .from('prompt_proposals')
        .select('id, status')
        .eq('cycle_id', baseCycleId)
        .maybeSingle();
    if (existing && !args.force) {
        console.log(`Proposal already exists for ${baseCycleId} (status: ${existing.status}); exiting.`);
        return;
    }
    if (existing && args.force) {
        // cycle_id is NOT NULL UNIQUE, so a forced manual re-run on a day that
        // already has a proposal (e.g. the on-demand button after the nightly
        // cron) needs a distinct id to avoid colliding on insert.
        cycleId = `${baseCycleId}-manual-${Date.now()}`;
        console.log(`Forced re-run; ${baseCycleId} already has a proposal — using cycle id ${cycleId}.`);
    }

    // Gate (the cheap daily path).
    const [{ count: unconsumedCount }, { data: pendingProposals }] = await Promise.all([
        supabase.from('correction_rules').select('*', { count: 'exact', head: true })
            .is('prompt_cycle_id', null).in('status', ['accepted', 'pending']),
        supabase.from('prompt_proposals').select('id').eq('status', 'pending').limit(1),
    ]);
    const gate = core.shouldRunCycle({
        unconsumedCorrectionCount: unconsumedCount || 0,
        pendingProposalExists: !!(pendingProposals || []).length,
        minNewCorrections: Number.parseInt(process.env.IMPROVE_MIN_NEW_CORRECTIONS || '1', 10),
    });
    if (!gate.run && !args.force) {
        console.log(`Gate: skipping — ${gate.reason}.`);
        return;
    }
    console.log(`Gate: running — ${gate.reason}${args.force ? ' (forced)' : ''}.`);

    acquireLock();
    try {
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

        // 2. Unconsumed corrections with reviewer explanations.
        const { data: rules, error: rulesError } = await supabase
            .from('correction_rules')
            .select('*')
            .is('prompt_cycle_id', null)
            .in('status', ['accepted', 'pending'])
            .order('created_at', { ascending: true });
        if (rulesError) throw new Error(`Failed to fetch correction rules: ${rulesError.message}`);
        const correctionRules = rules || [];
        console.log(`Corrections to analyze: ${correctionRules.length}`);

        // 3. Code-rules manifest (code + currently accepted rules).
        const { data: acceptedRules } = await supabase
            .from('correction_rules').select('*').eq('status', 'accepted').limit(1000);
        const manifest = manifestLib.buildReviewRulesManifest({ acceptedCorrectionRules: acceptedRules || [] });
        const manifestMarkdown = manifestLib.renderRulesManifestMarkdown(manifest, { includeDynamic: true });

        // 4. Document excerpts for the corrections' submissions.
        const pythonBin = resolvePythonBin();
        const submissionIds = [...new Set(correctionRules.map((r) => r.submission_id))].filter(Boolean);
        const documentExcerpts = [];
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
            if (aiText || finalText) {
                documentExcerpts.push({
                    submission_id: submissionId,
                    ai_excerpt: aiText ? aiText.slice(0, 600) : '(not available)',
                    final_excerpt: finalText ? finalText.slice(0, 600) : '(not available)',
                });
            }
        }
        console.log(`Document excerpts: ${documentExcerpts.length}`);

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

        // 6. Build the user prompt.
        const correctionLines = correctionRules.map((r, i) => {
            const scope = r.is_location_specific
                ? `Location-specific: ${r.location}${r.other_applicable_locations?.length ? ` (also: ${r.other_applicable_locations.join(', ')})` : ''}`
                : 'Universal (all properties)';
            return [
                `${i + 1}. Correction:`,
                `   Original: "${r.original_text || '(freeform guidance)'}"`,
                `   Corrected: "${r.corrected_text || '(freeform guidance)'}"`,
                `   Reviewer explanation: "${r.rule}"`,
                `   Type: ${r.change_type || 'unspecified'} | Menu scope: ${r.applies_to_menu_type || 'all'} | ${scope}`,
                `   Restaurant: ${r.restaurant_name || 'N/A'} | Source: ${r.source}${r.source === 'system' ? ` (seen ${r.occurrences}x)` : ''} | Status: ${r.status}`,
            ].join('\n');
        });
        const docLines = documentExcerpts.map((d) => [
            `### Submission ${d.submission_id}`,
            '**AI Draft (excerpt):**', d.ai_excerpt,
            '**Human-Corrected (excerpt):**', d.final_excerpt, '',
        ].join('\n'));
        const userPrompt = [
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
        ].join('\n');
        console.log(`LLM context size: ~${(core.IMPROVEMENT_SYSTEM_PROMPT.length + userPrompt.length).toLocaleString()} chars`);

        if (args.dryRun) {
            const dryDir = path.join(repoRoot, 'tmp', 'improvement-cycle', `${cycleId}-dry-run`);
            await fsp.mkdir(dryDir, { recursive: true });
            await fsp.writeFile(path.join(dryDir, 'user_prompt.txt'), userPrompt);
            console.log(`Dry run: context written to ${dryDir}; no LLM call, no proposal.`);
            return;
        }

        // 7. LLM analysis.
        console.log('Calling improvement LLM...');
        const llmResult = await callImprovementLlm(core.IMPROVEMENT_SYSTEM_PROMPT, userPrompt);
        console.log(`Model: ${llmResult.model}, tokens: ${llmResult.usage?.total_tokens || 'n/a'}`);
        let parsedOutput;
        try {
            parsedOutput = JSON.parse(llmResult.content);
        } catch (error) {
            throw new Error(`LLM returned non-JSON output: ${llmResult.content.slice(0, 300)}`);
        }
        const validated = core.validateImprovementLlmOutput(parsedOutput, { currentPrompt: effective.prompt });
        for (const warning of validated.warnings) console.warn(`LLM output warning: ${warning}`);
        console.log(`Proposed prompt: ${validated.promptUnchanged ? 'UNCHANGED (current prompt kept)' : `${validated.proposed_prompt.length} chars`}; rules: ${validated.proposed_replacement_rules.length}; code recommendations: ${validated.code_recommendations.length}`);

        // 8. Auto-eval baseline vs candidate.
        const artifactsDir = path.join(repoRoot, 'tmp', 'improvement-cycle', cycleId);
        await fsp.mkdir(artifactsDir, { recursive: true });
        const currentPromptPath = path.join(artifactsDir, 'current_prompt.txt');
        const candidatePromptPath = path.join(artifactsDir, 'proposed_prompt.txt');
        const candidateRulesPath = path.join(artifactsDir, 'proposed_rules.json');
        await fsp.writeFile(currentPromptPath, effective.prompt);
        await fsp.writeFile(candidatePromptPath, validated.proposed_prompt);
        await fsp.writeFile(candidateRulesPath, JSON.stringify({ rules: validated.proposed_replacement_rules }, null, 2));

        let evalSummary = null;
        let evalStatus = 'skipped';
        if (!args.skipEval) {
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
                    evalStatus = core.evalStatusFromSummary(evalSummary);
                }
            }
            console.log(`Eval status: ${evalStatus}${evalSummary?.error ? ` (${evalSummary.error.slice(0, 160)})` : ''}`);
        } else {
            console.log('Eval skipped (--skip-eval / IMPROVE_SKIP_EVAL).');
        }

        // 9. Store the proposal.
        const dates = correctionRules.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
        const proposalRow = {
            cycle_id: cycleId,
            current_prompt: effective.prompt,
            proposed_prompt: validated.proposed_prompt,
            prompt_diff: null,
            correction_rule_count: correctionRules.length,
            submission_count: submissionIds.length,
            date_range_start: dates.length ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : null,
            date_range_end: dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : null,
            llm_analysis: validated.analysis,
            llm_model: llmResult.model,
            status: 'pending',
            proposed_rules: validated.proposed_replacement_rules,
            code_recommendations: validated.code_recommendations,
            eval_summary: evalSummary,
            eval_status: evalStatus,
            source: 'improvement_cycle',
        };
        const { error: insertError } = await supabase.from('prompt_proposals').insert(proposalRow);
        if (insertError) throw new Error(`Failed to store proposal: ${insertError.message}`);

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
