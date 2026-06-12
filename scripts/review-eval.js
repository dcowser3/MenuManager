#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Review Eval Harness
 *
 * Replays historical menus (raw pre-review input) through the FULL review
 * pipeline -- deterministic pre-AI checks, prompt assembly, the AI call, and
 * the post-AI guard chain (the exact production code via lib/review-pipeline)
 * -- and scores the output against the human-approved final as ground truth.
 *
 * Dataset sources:
 *   - production: Supabase submissions (approved + approved_menu_content) joined
 *     to basic_ai_check_audits raw input via form_attempt_id (Phase A). Rows
 *     without an audit fall back to submissions.menu_content, marked degraded.
 *   - curated: paired DOCX files (Training Menus + Zengo samples), original vs
 *     redlined human-corrected.
 *
 * Usage:
 *   npm run review:eval -- --build-dataset --source all
 *   npm run review:eval -- --limit 5 --label baseline
 *   npm run review:eval -- --prompt tmp/candidate_prompt.txt --rules candidate:tmp/rules.json \
 *       --baseline tmp/review-eval/<ts>-baseline/report.json --label candidate
 *
 * Options:
 *   --build-dataset            Rebuild tmp/review-eval/dataset.jsonl before running
 *   --dataset <file>           Dataset file (default tmp/review-eval/dataset.jsonl)
 *   --source all|production|training-menus|zengo-samples   Sources for --build-dataset (default all)
 *   --dataset-only             Build the dataset and exit (no replay)
 *   --prompt <file>            Base prompt file (default sop-processor/qa_prompt.txt)
 *   --model <model>            OpenAI model (default REVIEW_EVAL_MODEL || AI_REVIEW_MODEL || gpt-4o-mini)
 *   --rules live|snapshot:<f>|candidate:<f>   Accepted correction-rules source (default live)
 *   --no-deterministic         Disable the deterministic pre/post passes
 *   --no-ai                    Skip the AI call (echo feedback); deterministic-only eval
 *   --limit <n>                Max cases
 *   --case <id>                Run only the case with this id (repeatable)
 *   --baseline <report.json>   Compare against a previous run's report
 *   --label <name>             Label for the output directory
 *   --temperature <t>          Sampling temperature (default 0)
 *   --json                     Print the report JSON to stdout
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(repoRoot, '.env') });

const defaultOutRoot = path.join(repoRoot, 'tmp', 'review-eval');
const defaultDatasetPath = path.join(defaultOutRoot, 'dataset.jsonl');
const cacheDir = path.join(defaultOutRoot, 'cache');

// ---------------------------------------------------------------------------
// Library loading (ts-node first, dist fallback) -- same pattern as ab-replay.
function requireLib(service, relPath) {
    const sourcePath = path.join(repoRoot, 'services', service, ...relPath.split('/')) + '.ts';
    try {
        const tsNodeRegister = require.resolve('ts-node/register/transpile-only', {
            paths: [repoRoot, path.join(repoRoot, 'services', service)],
        });
        require(tsNodeRegister);
        return require(sourcePath);
    } catch {
        // Fall back to build output in lean installs that do not include ts-node.
    }
    const distPath = path.join(repoRoot, 'services', service, 'dist', ...relPath.split('/')) + '.js';
    if (!fs.existsSync(distPath)) {
        throw new Error(`Could not load ${service}/${relPath}: run npm run build --workspace=services/${service}`);
    }
    return require(distPath);
}

// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const args = {
        buildDataset: false,
        datasetOnly: false,
        dataset: defaultDatasetPath,
        source: 'all',
        prompt: path.join(repoRoot, 'sop-processor', 'qa_prompt.txt'),
        model: process.env.REVIEW_EVAL_MODEL || process.env.AI_REVIEW_MODEL || 'gpt-4o-mini',
        rules: 'live',
        deterministic: true,
        ai: true,
        limit: Number.POSITIVE_INFINITY,
        cases: [],
        baseline: '',
        label: '',
        temperature: 0,
        seed: 42,
        json: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--build-dataset') args.buildDataset = true;
        else if (arg === '--dataset-only') { args.buildDataset = true; args.datasetOnly = true; }
        else if (arg === '--dataset') args.dataset = path.resolve(argv[++i] || args.dataset);
        else if (arg === '--source') args.source = argv[++i] || args.source;
        else if (arg === '--prompt') args.prompt = path.resolve(argv[++i] || args.prompt);
        else if (arg === '--model') args.model = argv[++i] || args.model;
        else if (arg === '--rules') args.rules = argv[++i] || args.rules;
        else if (arg === '--no-deterministic') args.deterministic = false;
        else if (arg === '--no-ai') args.ai = false;
        else if (arg === '--limit') args.limit = Number.parseInt(argv[++i] || '', 10);
        else if (arg === '--case') args.cases.push(argv[++i] || '');
        else if (arg === '--baseline') args.baseline = path.resolve(argv[++i] || '');
        else if (arg === '--label') args.label = (argv[++i] || '').replace(/[^a-zA-Z0-9_-]/g, '-');
        else if (arg === '--temperature') args.temperature = Number(argv[++i] || '0');
        else if (arg === '--json') args.json = true;
        else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = Number.POSITIVE_INFINITY;
    return args;
}

function printHelp() {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith(' *')).map((l) => l.slice(3)).join('\n'));
}

// ---------------------------------------------------------------------------
// Supabase helpers
function getSupabase() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const { createClient } = require('@supabase/supabase-js');
    return createClient(url, key);
}

async function fetchAcceptedRulesLive() {
    const supabase = getSupabase();
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('correction_rules')
        .select('*')
        .eq('status', 'accepted')
        .limit(1000);
    if (error) {
        console.warn(`Accepted correction rules unavailable (${error.message}); continuing with none.`);
        return [];
    }
    return data || [];
}

async function resolveCorrectionRules(rulesArg) {
    if (rulesArg === 'live') {
        return { rules: await fetchAcceptedRulesLive(), description: 'live accepted rules' };
    }
    const [mode, ...rest] = rulesArg.split(':');
    const filePath = rest.join(':');
    if (!filePath) throw new Error(`--rules ${mode} requires a file path, e.g. ${mode}:tmp/rules.json`);
    const parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
    const fileRules = Array.isArray(parsed) ? parsed : (parsed.rules || []);
    if (mode === 'snapshot') {
        return { rules: fileRules, description: `snapshot ${filePath} (${fileRules.length} rules)` };
    }
    if (mode === 'candidate') {
        const live = await fetchAcceptedRulesLive();
        return {
            rules: [...live, ...fileRules],
            description: `live accepted rules + candidate ${filePath} (${fileRules.length} proposed)`,
        };
    }
    throw new Error(`Unknown --rules mode "${mode}". Use live, snapshot:<file>, or candidate:<file>.`);
}

// ---------------------------------------------------------------------------
// Dataset assembly
function resolvePythonBin() {
    const venvPython = path.join(repoRoot, 'services', 'docx-redliner', 'venv', 'bin', 'python');
    return fs.existsSync(venvPython) ? venvPython : 'python3';
}

function extractCleanMenuText(pythonBin, docPath) {
    const scriptPath = path.join(repoRoot, 'services', 'docx-redliner', 'extract_clean_menu_text.py');
    const proc = spawnSync(pythonBin, [scriptPath, docPath], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
    if (proc.status !== 0) {
        throw new Error((proc.stderr || proc.stdout || `Failed extracting ${docPath}`).trim());
    }
    const parsed = JSON.parse((proc.stdout || '{}').trim() || '{}');
    if (parsed.error) throw new Error(parsed.error);
    return `${parsed.cleaned_menu_content || parsed.menu_content || ''}`.trim();
}

function listDocxFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((n) => /\.docx$/i.test(n)).map((n) => path.join(dir, n));
}

function normalizePairName(filePath) {
    return path.basename(filePath, path.extname(filePath))
        .replace(/\((?:redlined|redlned)\)$/i, '')
        .replace(/\s+/g, ' ')
        .normalize('NFC')
        .trim()
        .toLowerCase();
}

function isRedlinedName(filePath) {
    return /\((?:redlined|redlned)\)\.docx$/i.test(path.basename(filePath));
}

function inferProperty(value) {
    const normalized = `${value || ''}`.toLowerCase();
    if (normalized.includes('zengo')) return 'Zengo - Doha';
    if (normalized.includes('tamayo')) return 'Tamayo';
    if (normalized.includes('toro toro') || /\btt\b/.test(normalized)) return 'Toro Toro';
    if (normalized.includes('toro')) return 'Toro';
    if (normalized.includes('maya')) return 'Maya';
    if (normalized.includes('tan')) return 'Tán';
    if (normalized.includes('dlena') || normalized.includes("d'lena") || normalized.includes('d’leña')) return "d'Leña";
    if (normalized.includes('aqimero')) return 'Aqimero';
    return '';
}

function collectCuratedPairs(source) {
    const pairs = [];
    if (source === 'all' || source === 'training-menus') {
        const dir = path.join(repoRoot, 'Training Menus');
        const groups = new Map();
        for (const filePath of listDocxFiles(dir)) {
            const key = normalizePairName(filePath);
            const group = groups.get(key) || { originals: [], finals: [] };
            (isRedlinedName(filePath) ? group.finals : group.originals).push(filePath);
            groups.set(key, group);
        }
        for (const [key, group] of groups) {
            if (!group.originals.length || !group.finals.length) continue;
            pairs.push({
                case_id: `training-menus:${key}`,
                source: 'training-menus',
                label: path.basename(group.originals[0], '.docx'),
                originalPath: group.originals[0],
                finalPath: group.finals[0],
                property: inferProperty(`${group.originals[0]} ${group.finals[0]}`),
            });
        }
    }
    if (source === 'all' || source === 'zengo-samples') {
        const dir = path.join(repoRoot, 'samples', 'FW_ Zengo Doha - Menu');
        for (const finalPath of listDocxFiles(path.join(dir, 'redlined'))) {
            const originalPath = path.join(dir, path.basename(finalPath));
            if (!fs.existsSync(originalPath)) continue;
            pairs.push({
                case_id: `zengo-samples:${normalizePairName(originalPath)}`,
                source: 'zengo-samples',
                label: path.basename(originalPath, '.docx'),
                originalPath,
                finalPath,
                property: 'Zengo - Doha',
            });
        }
    }
    return pairs;
}

async function buildProductionCases() {
    const supabase = getSupabase();
    if (!supabase) {
        console.warn('SUPABASE_URL not configured; skipping production cases.');
        return [];
    }
    const { data: submissions, error } = await supabase
        .from('submissions')
        .select('id, legacy_id, project_name, property, template_type, menu_type, service_period, allergens, menu_content, approved_menu_content, form_attempt_id, created_at')
        .eq('status', 'approved')
        .not('approved_menu_content', 'is', null)
        .order('created_at', { ascending: true })
        .limit(2000);
    if (error) throw new Error(`Failed to load submissions: ${error.message}`);

    const eligible = (submissions || []).filter((s) => `${s.approved_menu_content || ''}`.trim() && `${s.menu_content || ''}`.trim());

    // Pull raw audit inputs for submissions that have a form_attempt_id (Phase A data).
    const attemptIds = eligible.map((s) => s.form_attempt_id).filter(Boolean);
    const auditByAttempt = new Map();
    if (attemptIds.length) {
        const { data: audits, error: auditError } = await supabase
            .from('basic_ai_check_audits')
            .select('attempt_id, event_type, menu_content_raw, ai_request, created_at')
            .in('attempt_id', attemptIds)
            .order('created_at', { ascending: true });
        if (auditError) {
            console.warn(`Audits unavailable (${auditError.message}); production cases fall back to submitted content.`);
        } else {
            for (const audit of audits || []) {
                // Last completed audit per attempt wins; earlier writes are overwritten.
                if (audit.event_type === 'completed' || !auditByAttempt.has(audit.attempt_id)) {
                    auditByAttempt.set(audit.attempt_id, audit);
                }
            }
        }
    }

    return eligible.map((s) => {
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
        return {
            case_id: `production:${s.legacy_id || s.id}`,
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
    });
}

async function buildDataset(args) {
    const cases = [];
    if (args.source === 'all' || args.source === 'production') {
        cases.push(...await buildProductionCases());
    }
    const curatedSource = args.source === 'production' ? null : args.source;
    if (curatedSource) {
        const pythonBin = resolvePythonBin();
        for (const pair of collectCuratedPairs(curatedSource)) {
            try {
                cases.push({
                    case_id: pair.case_id,
                    source: pair.source,
                    label: pair.label,
                    raw_input: extractCleanMenuText(pythonBin, pair.originalPath),
                    ground_truth: extractCleanMenuText(pythonBin, pair.finalPath),
                    degraded: null,
                    context: {
                        property: pair.property,
                        templateType: 'food',
                        menuType: 'standard',
                        servicePeriod: '',
                        allergens: '',
                    },
                });
            } catch (error) {
                console.warn(`Skipping curated pair ${pair.label}: ${error.message}`);
            }
        }
    }
    const usable = cases.filter((c) => `${c.raw_input || ''}`.trim() && `${c.ground_truth || ''}`.trim());
    await fsp.mkdir(path.dirname(args.dataset), { recursive: true });
    await fsp.writeFile(args.dataset, usable.map((c) => JSON.stringify(c)).join('\n') + (usable.length ? '\n' : ''));
    console.log(`Dataset built: ${usable.length} cases -> ${args.dataset}`);
    const bySource = usable.reduce((acc, c) => { acc[c.source] = (acc[c.source] || 0) + 1; return acc; }, {});
    console.log(`By source: ${JSON.stringify(bySource)}; degraded: ${usable.filter((c) => c.degraded).length}`);
    return usable;
}

function loadDataset(datasetPath) {
    if (!fs.existsSync(datasetPath)) return null;
    return fs.readFileSync(datasetPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// AI caller with response cache
function cacheKey(parts) {
    return crypto.createHash('sha256').update(parts.join(' ')).digest('hex');
}

async function callOpenAi({ model, temperature, seed, prompt, text }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your-openai-api-key-here') {
        throw new Error('OPENAI_API_KEY is required unless --no-ai is used');
    }
    const body = {
        model,
        temperature,
        seed,
        messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `Here is the menu text to review:\n\n---\n\n${text}` },
        ],
    };
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(body),
            });
            if (response.status === 429 || response.status >= 500) {
                lastError = new Error(`OpenAI ${response.status}: ${await response.text()}`);
                await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
                continue;
            }
            if (!response.ok) {
                throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 400)}`);
            }
            const json = await response.json();
            return {
                feedback: json.choices?.[0]?.message?.content || '',
                usage: json.usage || {},
            };
        } catch (error) {
            lastError = error;
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
    }
    throw lastError || new Error('OpenAI call failed');
}

function buildEchoFeedback(text) {
    return [
        '=== CORRECTED MENU ===',
        text,
        '=== END CORRECTED MENU ===',
        '',
        '=== SUGGESTIONS ===',
        '[]',
        '=== END SUGGESTIONS ===',
    ].join('\n');
}

function makeAiCaller(args, usageTotals) {
    return async (text, prompt) => {
        if (!args.ai) return buildEchoFeedback(text);
        const key = cacheKey([args.model, `${args.temperature}`, `${args.seed}`, prompt, text]);
        const cachePath = path.join(cacheDir, `${key}.json`);
        if (fs.existsSync(cachePath)) {
            const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            usageTotals.cacheHits += 1;
            return cached.feedback;
        }
        const result = await callOpenAi({
            model: args.model,
            temperature: args.temperature,
            seed: args.seed,
            prompt,
            text,
        });
        usageTotals.apiCalls += 1;
        usageTotals.promptTokens += result.usage.prompt_tokens || 0;
        usageTotals.completionTokens += result.usage.completion_tokens || 0;
        await fsp.mkdir(cacheDir, { recursive: true });
        await fsp.writeFile(cachePath, JSON.stringify({
            model: args.model,
            temperature: args.temperature,
            seed: args.seed,
            feedback: result.feedback,
            usage: result.usage,
            cachedAt: new Date().toISOString(),
        }, null, 2));
        return result.feedback;
    };
}

// ---------------------------------------------------------------------------
function round(value) {
    return Number(Number(value).toFixed(8));
}

function classifyDelta(delta) {
    const epsilon = 0.0005;
    if (delta > epsilon) return 'improved';
    if (delta < -epsilon) return 'regressed';
    return 'same';
}

async function runEval(args, dataset, rulesInfo, libs) {
    const { runFullReviewPipeline } = libs.reviewPipeline;
    const { normalizeComparable, boundedLevenshteinSimilarity } = libs.textSimilarity;
    const { scoreCorrections, compositeCaseScore } = libs.evalScoring;

    const basePrompt = fs.readFileSync(args.prompt, 'utf8');
    const usageTotals = { apiCalls: 0, cacheHits: 0, promptTokens: 0, completionTokens: 0 };
    const aiCaller = makeAiCaller(args, usageTotals);

    let cases = dataset;
    if (args.cases.length) {
        const wanted = new Set(args.cases);
        cases = cases.filter((c) => wanted.has(c.case_id));
    }
    cases = cases.slice(0, args.limit);

    console.log(`Evaluating ${cases.length} cases | model=${args.ai ? args.model : 'no-ai'} | rules=${rulesInfo.description} | deterministic=${args.deterministic}`);

    const caseReports = [];
    const errors = [];
    for (const [index, evalCase] of cases.entries()) {
        process.stdout.write(`  [${index + 1}/${cases.length}] ${evalCase.label.slice(0, 60)} ... `);
        try {
            const result = await runFullReviewPipeline(evalCase.raw_input, {
                basePrompt,
                menuType: evalCase.context.menuType,
                templateType: evalCase.context.templateType,
                property: evalCase.context.property,
                allergens: evalCase.context.allergens,
                acceptedCorrectionRules: rulesInfo.rules,
                precheckEnabled: args.deterministic,
            }, aiCaller);

            const candidate = result.finalCorrectedMenu;
            const truthStrict = normalizeComparable(evalCase.ground_truth);
            const candidateStrict = normalizeComparable(candidate);
            const inputStrict = normalizeComparable(evalCase.raw_input);
            const truthStyle = normalizeComparable(evalCase.ground_truth, { normalizeRawAsteriskStyle: true });
            const candidateStyle = normalizeComparable(candidate, { normalizeRawAsteriskStyle: true });
            const inputStyle = normalizeComparable(evalCase.raw_input, { normalizeRawAsteriskStyle: true });

            const inputSimilarity = boundedLevenshteinSimilarity(inputStrict, truthStrict);
            const candidateSimilarity = boundedLevenshteinSimilarity(candidateStrict, truthStrict);
            const inputStyleSimilarity = boundedLevenshteinSimilarity(inputStyle, truthStyle);
            const candidateStyleSimilarity = boundedLevenshteinSimilarity(candidateStyle, truthStyle);
            const corrections = scoreCorrections(evalCase.raw_input, candidate, evalCase.ground_truth);
            const composite = compositeCaseScore(candidateStyleSimilarity, corrections);

            caseReports.push({
                case_id: evalCase.case_id,
                source: evalCase.source,
                label: evalCase.label,
                degraded: evalCase.degraded || null,
                similarity: {
                    inputVsTruth: round(inputSimilarity),
                    candidateVsTruth: round(candidateSimilarity),
                    delta: round(candidateSimilarity - inputSimilarity),
                    outcome: classifyDelta(candidateSimilarity - inputSimilarity),
                },
                styleSimilarity: {
                    inputVsTruth: round(inputStyleSimilarity),
                    candidateVsTruth: round(candidateStyleSimilarity),
                    delta: round(candidateStyleSimilarity - inputStyleSimilarity),
                    outcome: classifyDelta(candidateStyleSimilarity - inputStyleSimilarity),
                },
                corrections: {
                    truePositives: corrections.truePositives,
                    falsePositives: corrections.falsePositives,
                    falseNegatives: corrections.falseNegatives,
                    precision: round(corrections.precision),
                    recall: round(corrections.recall),
                    f1: round(corrections.f1),
                    byKind: corrections.byKind,
                    remainingDiffCount: corrections.remainingDiffCount,
                    matched: corrections.matched.slice(0, 10),
                    missed: corrections.missed.slice(0, 10),
                    extra: corrections.extra.slice(0, 10),
                },
                composite: round(composite),
                exactMatch: candidateStrict === truthStrict,
                criticalSuggestionCount: result.post.criticalSuggestions.length,
                suggestionCount: result.finalSuggestions.length,
                deterministicCorrections: result.preAiDeterministic.appliedCorrections.length,
            });
            console.log(`composite ${round(composite).toFixed(4)}`);
        } catch (error) {
            errors.push({ case_id: evalCase.case_id, label: evalCase.label, error: error.message });
            console.log(`ERROR: ${error.message.slice(0, 120)}`);
        }
    }

    return { caseReports, errors, usageTotals };
}

function aggregate(caseReports) {
    const count = caseReports.length || 1;
    const sum = (selector) => caseReports.reduce((acc, c) => acc + selector(c), 0);
    const totals = {
        casesEvaluated: caseReports.length,
        exactMatches: caseReports.filter((c) => c.exactMatch).length,
        avgComposite: round(sum((c) => c.composite) / count),
        avgSimilarity: round(sum((c) => c.similarity.candidateVsTruth) / count),
        avgStyleSimilarity: round(sum((c) => c.styleSimilarity.candidateVsTruth) / count),
        avgInputSimilarity: round(sum((c) => c.similarity.inputVsTruth) / count),
        avgDeltaVsInput: round(sum((c) => c.similarity.delta) / count),
        corrections: {
            truePositives: sum((c) => c.corrections.truePositives),
            falsePositives: sum((c) => c.corrections.falsePositives),
            falseNegatives: sum((c) => c.corrections.falseNegatives),
            remainingDiffs: sum((c) => c.corrections.remainingDiffCount),
        },
        outcomesVsInput: caseReports.reduce((acc, c) => {
            acc[c.similarity.outcome] = (acc[c.similarity.outcome] || 0) + 1;
            return acc;
        }, { improved: 0, same: 0, regressed: 0 }),
    };
    const tp = totals.corrections.truePositives;
    const fp = totals.corrections.falsePositives;
    const fn = totals.corrections.falseNegatives;
    totals.corrections.precision = round(tp + fp > 0 ? tp / (tp + fp) : 0);
    totals.corrections.recall = round(tp + fn > 0 ? tp / (tp + fn) : 0);
    totals.corrections.f1 = round(
        totals.corrections.precision + totals.corrections.recall > 0
            ? (2 * totals.corrections.precision * totals.corrections.recall) / (totals.corrections.precision + totals.corrections.recall)
            : 0
    );
    return totals;
}

function compareWithBaseline(baselineReport, caseReports) {
    const baselineByCase = new Map((baselineReport.cases || []).map((c) => [c.case_id, c]));
    const comparisons = [];
    for (const current of caseReports) {
        const baseline = baselineByCase.get(current.case_id);
        if (!baseline) continue;
        const delta = round(current.composite - baseline.composite);
        comparisons.push({
            case_id: current.case_id,
            label: current.label,
            baselineComposite: baseline.composite,
            candidateComposite: current.composite,
            delta,
            outcome: classifyDelta(delta),
        });
    }
    const regressions = comparisons.filter((c) => c.outcome === 'regressed').sort((a, b) => a.delta - b.delta);
    const improvements = comparisons.filter((c) => c.outcome === 'improved').sort((a, b) => b.delta - a.delta);
    return {
        baselineGeneratedAt: baselineReport.generatedAt,
        baselineLabel: baselineReport.config?.label || '',
        comparedCases: comparisons.length,
        avgDelta: round(comparisons.reduce((acc, c) => acc + c.delta, 0) / Math.max(1, comparisons.length)),
        regressed: regressions.length,
        improved: improvements.length,
        same: comparisons.length - regressions.length - improvements.length,
        regressions: regressions.slice(0, 20),
        improvements: improvements.slice(0, 20),
    };
}

function buildMarkdown(report) {
    const s = report.summary;
    const lines = [
        '# Review Eval Report',
        '',
        `Generated: ${report.generatedAt}`,
        `Label: ${report.config.label || '(none)'}`,
        `Model: ${report.config.ai ? report.config.model : 'no-ai (deterministic only)'} | temp ${report.config.temperature} | seed ${report.config.seed}`,
        `Prompt: ${report.config.prompt}`,
        `Rules: ${report.config.rulesDescription}`,
        `Deterministic pre/post passes: ${report.config.deterministic}`,
        '',
        '## Summary',
        `- Cases evaluated: ${s.casesEvaluated} (errors: ${report.errors.length})`,
        `- Exact matches with human final: ${s.exactMatches}`,
        `- Avg composite score: ${(s.avgComposite * 100).toFixed(3)}%`,
        `- Avg similarity (candidate vs human final): ${(s.avgSimilarity * 100).toFixed(3)}%`,
        `- Avg similarity (raw input vs human final): ${(s.avgInputSimilarity * 100).toFixed(3)}% (what similarity would be with NO review)`,
        `- Avg improvement over raw input: ${(s.avgDeltaVsInput * 100).toFixed(4)} pp (improved ${s.outcomesVsInput.improved}, same ${s.outcomesVsInput.same}, regressed ${s.outcomesVsInput.regressed})`,
        `- Correction-level: TP ${s.corrections.truePositives}, FP ${s.corrections.falsePositives}, FN ${s.corrections.falseNegatives} | precision ${(s.corrections.precision * 100).toFixed(2)}%, recall ${(s.corrections.recall * 100).toFixed(2)}%, F1 ${(s.corrections.f1 * 100).toFixed(2)}%`,
        `- Residual word-level diffs vs human final: ${s.corrections.remainingDiffs}`,
        `- AI usage: ${report.usage.apiCalls} calls, ${report.usage.cacheHits} cache hits, ${report.usage.promptTokens + report.usage.completionTokens} tokens`,
        '',
    ];

    if (report.baselineComparison) {
        const b = report.baselineComparison;
        lines.push(
            '## Baseline Comparison',
            `- Baseline: ${b.baselineLabel || b.baselineGeneratedAt}`,
            `- Compared cases: ${b.comparedCases}`,
            `- Avg composite delta: ${(b.avgDelta * 100).toFixed(4)} pp`,
            `- Improved ${b.improved}, same ${b.same}, regressed ${b.regressed}`,
            ''
        );
        if (b.regressions.length) {
            lines.push('### Regressions');
            for (const r of b.regressions) {
                lines.push(`- ${r.label}: ${(r.baselineComposite * 100).toFixed(3)}% -> ${(r.candidateComposite * 100).toFixed(3)}% (${(r.delta * 100).toFixed(4)} pp)`);
            }
            lines.push('');
        }
    }

    lines.push('## Worst Cases (by composite)');
    const worst = [...report.cases].sort((a, b) => a.composite - b.composite).slice(0, 10);
    for (const c of worst) {
        lines.push(`- ${c.label} [${c.source}${c.degraded ? `, degraded:${c.degraded}` : ''}]: composite ${(c.composite * 100).toFixed(3)}%, missed ${c.corrections.falseNegatives}, extra ${c.corrections.falsePositives}, residual diffs ${c.corrections.remainingDiffCount}`);
        for (const miss of c.corrections.missed.slice(0, 3)) {
            lines.push(`  - missed ${miss.kind}: \`${miss.from}\` -> \`${miss.to}\``);
        }
        for (const extra of c.corrections.extra.slice(0, 3)) {
            lines.push(`  - overcorrected ${extra.kind}: \`${extra.from}\` -> \`${extra.to}\``);
        }
    }

    if (report.errors.length) {
        lines.push('', '## Errors');
        for (const e of report.errors) lines.push(`- ${e.label}: ${e.error}`);
    }

    lines.push('', '## Notes');
    lines.push('- Composite = style-normalized similarity when no word-level corrections exist; otherwise 0.6 * similarity + 0.4 * correction F1.');
    lines.push('- Word-level scoring uses the differ learning-signal extractor; dish-name identity changes and whole-word swaps surface in similarity/residual diffs instead of TP/FP/FN.');
    lines.push('- Eval AI calls use temperature 0 + a fixed seed for repeatability; production uses the API default temperature.');
    lines.push('');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
async function main() {
    const args = parseArgs(process.argv.slice(2));

    let dataset = null;
    if (args.buildDataset) {
        dataset = await buildDataset(args);
        if (args.datasetOnly) return;
    } else {
        dataset = loadDataset(args.dataset);
        if (!dataset) {
            console.log('No dataset found; building it first (use --source to control sources).');
            dataset = await buildDataset(args);
        }
    }
    if (!dataset.length) throw new Error('Dataset is empty.');

    const libs = {
        reviewPipeline: requireLib('dashboard', 'lib/review-pipeline'),
        textSimilarity: requireLib('dashboard', 'lib/text-similarity'),
        evalScoring: requireLib('differ', 'lib/eval-scoring'),
    };
    const rulesInfo = await resolveCorrectionRules(args.rules);

    const { caseReports, errors, usageTotals } = await runEval(args, dataset, rulesInfo, libs);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.join(defaultOutRoot, args.label ? `${timestamp}-${args.label}` : timestamp);
    await fsp.mkdir(outDir, { recursive: true });

    let baselineComparison = null;
    if (args.baseline) {
        const baselinePath = fs.statSync(args.baseline).isDirectory()
            ? path.join(args.baseline, 'report.json')
            : args.baseline;
        baselineComparison = compareWithBaseline(JSON.parse(fs.readFileSync(baselinePath, 'utf8')), caseReports);
    }

    const report = {
        generatedAt: new Date().toISOString(),
        config: {
            label: args.label,
            prompt: args.prompt,
            model: args.model,
            ai: args.ai,
            temperature: args.temperature,
            seed: args.seed,
            deterministic: args.deterministic,
            rules: args.rules,
            rulesDescription: rulesInfo.description,
            rulesCount: rulesInfo.rules.length,
            dataset: args.dataset,
        },
        summary: aggregate(caseReports),
        usage: usageTotals,
        baselineComparison,
        cases: caseReports.sort((a, b) => a.label.localeCompare(b.label)),
        errors,
    };

    const reportJsonPath = path.join(outDir, 'report.json');
    await fsp.writeFile(reportJsonPath, JSON.stringify(report, null, 2));
    await fsp.writeFile(path.join(outDir, 'report.md'), buildMarkdown(report));

    if (args.json) {
        console.log(JSON.stringify(report.summary, null, 2));
    }
    console.log('');
    console.log(`Report: ${reportJsonPath}`);
    console.log(`Cases: ${report.summary.casesEvaluated}, exact ${report.summary.exactMatches}, avg composite ${(report.summary.avgComposite * 100).toFixed(3)}%`);
    console.log(`Corrections: P ${(report.summary.corrections.precision * 100).toFixed(1)}% R ${(report.summary.corrections.recall * 100).toFixed(1)}% F1 ${(report.summary.corrections.f1 * 100).toFixed(1)}%`);
    if (baselineComparison) {
        console.log(`Baseline delta: ${(baselineComparison.avgDelta * 100).toFixed(4)} pp (improved ${baselineComparison.improved}, regressed ${baselineComparison.regressed})`);
        if (baselineComparison.regressed > 0) process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
});
