#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const defaultOutRoot = path.join(repoRoot, 'tmp', 'pre-ai-ab-replay');

function parseArgs(argv) {
  const args = {
    source: 'training-menus',
    limit: Number.POSITIVE_INFINITY,
    outDir: '',
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--source') {
      args.source = argv[++i] || args.source;
    } else if (arg === '--limit') {
      args.limit = Number.parseInt(argv[++i] || '', 10);
    } else if (arg === '--out-dir') {
      args.outDir = argv[++i] || '';
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.limit) || args.limit <= 0) {
    args.limit = Number.POSITIVE_INFINITY;
  }
  return args;
}

function printHelp() {
  console.log([
    'Usage: node scripts/pre-ai-ab-replay.js [options]',
    '',
    'Runs an offline A/B replay of deterministic pre-AI checks against paired',
    'historical menu DOCX files.',
    '',
    'Options:',
    '  --source all|training-menus|zengo-samples  Pair source to replay (default: training-menus)',
    '  --limit <n>                               Max pairs to process',
    '  --out-dir <path>                          Report output directory',
    '  --json                                    Print report JSON to stdout',
  ].join('\n'));
}

function requirePreAiHelper() {
  const sourcePath = path.join(repoRoot, 'services', 'dashboard', 'lib', 'pre-ai-deterministic-rules.ts');
  try {
    const tsNodeRegister = require.resolve('ts-node/register/transpile-only', {
      paths: [repoRoot, path.join(repoRoot, 'services', 'dashboard')],
    });
    require(tsNodeRegister);
    return require(sourcePath);
  } catch {
    // Fall back to build output in lean installs that do not include ts-node.
  }

  const helperPath = path.join(repoRoot, 'services', 'dashboard', 'dist', 'lib', 'pre-ai-deterministic-rules.js');
  if (!fs.existsSync(helperPath)) {
    throw new Error(`Pre-AI helper source could not be loaded and build output was not found at ${helperPath}. Run npm install or npm run build --workspace=@menumanager/dashboard first.`);
  }
  return require(helperPath);
}

function resolvePythonBin() {
  const venvPython = path.join(repoRoot, 'services', 'docx-redliner', 'venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return 'python3';
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function loadAcceptedCorrectionRules() {
  const candidatePaths = [
    path.join(repoRoot, 'tmp', 'db', 'correction_rules.json'),
    path.join(repoRoot, 'tmp', 'production-cleanup-backups', '20260511-150222', 'supabase', 'correction_rules.json'),
  ];
  const byId = new Map();
  for (const filePath of candidatePaths) {
    for (const rule of asArray(readJsonFile(filePath, []))) {
      if (`${rule.status || ''}`.toLowerCase() !== 'accepted') {
        continue;
      }
      const key = rule.id || `${rule.original_text || ''}\u0000${rule.corrected_text || ''}\u0000${rule.location || ''}`;
      byId.set(key, rule);
    }
  }
  return Array.from(byId.values());
}

function listDocxFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /\.docx$/i.test(name))
    .map((name) => path.join(dir, name));
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

function collectTrainingMenuPairs() {
  const dir = path.join(repoRoot, 'Training Menus');
  const groups = new Map();
  for (const filePath of listDocxFiles(dir)) {
    const key = normalizePairName(filePath);
    const group = groups.get(key) || { originals: [], finals: [] };
    if (isRedlinedName(filePath)) {
      group.finals.push(filePath);
    } else {
      group.originals.push(filePath);
    }
    groups.set(key, group);
  }

  const pairs = [];
  for (const [key, group] of groups) {
    if (!group.originals.length || !group.finals.length) continue;
    pairs.push({
      id: `training-menus:${key}`,
      source: 'training-menus',
      label: path.basename(group.originals[0], '.docx'),
      originalPath: group.originals[0],
      finalPath: group.finals[0],
      property: inferProperty(`${group.originals[0]} ${group.finals[0]}`),
    });
  }
  return pairs;
}

function collectZengoSamplePairs() {
  const dir = path.join(repoRoot, 'samples', 'FW_ Zengo Doha - Menu');
  const redlinedDir = path.join(dir, 'redlined');
  const pairs = [];
  for (const finalPath of listDocxFiles(redlinedDir)) {
    const originalPath = path.join(dir, path.basename(finalPath));
    if (!fs.existsSync(originalPath)) continue;
    pairs.push({
      id: `zengo-samples:${normalizePairName(originalPath)}`,
      source: 'zengo-samples',
      label: path.basename(originalPath, '.docx'),
      originalPath,
      finalPath,
      property: 'Zengo - Doha',
    });
  }
  return pairs;
}

function collectPairs(source) {
  const collectors = {
    'training-menus': collectTrainingMenuPairs,
    'zengo-samples': collectZengoSamplePairs,
  };
  if (source !== 'all') {
    if (!collectors[source]) {
      throw new Error(`Unknown source "${source}". Use all, training-menus, or zengo-samples.`);
    }
    return collectors[source]();
  }

  const seen = new Set();
  const pairs = [];
  for (const collect of Object.values(collectors)) {
    for (const pair of collect()) {
      const key = `${pair.originalPath}\u0000${pair.finalPath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(pair);
    }
  }
  return pairs;
}

function inferProperty(value) {
  const normalized = `${value || ''}`.toLowerCase();
  if (normalized.includes('zengo')) return 'Zengo - Doha';
  if (normalized.includes('tamayo')) return 'Tamayo';
  if (normalized.includes('toro toro') || /\btt\b/.test(normalized)) return 'Toro Toro';
  if (normalized.includes('toro')) return 'Toro';
  if (normalized.includes('maya')) return 'Maya';
  if (normalized.includes('tan')) return 'Tán';
  if (normalized.includes('dlena') || normalized.includes("d'lena") || normalized.includes('d’leña')) return "d'Leña";
  if (normalized.includes('aqimero')) return 'Aqimero';
  return '';
}

function extractCleanMenuText(pythonBin, docPath) {
  const scriptPath = path.join(repoRoot, 'services', 'docx-redliner', 'extract_clean_menu_text.py');
  const proc = spawnSync(pythonBin, [scriptPath, docPath], {
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    throw new Error((proc.stderr || proc.stdout || `Failed extracting ${docPath}`).trim());
  }
  const parsed = JSON.parse((proc.stdout || '{}').trim() || '{}');
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  return `${parsed.cleaned_menu_content || parsed.menu_content || ''}`.trim();
}

function normalizeComparable(text, options = {}) {
  let value = `${text || ''}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  value = value
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (options.normalizeRawAsteriskStyle) {
    value = value.split('\n').map(normalizeRawAsteriskStyleOnLine).join('\n');
  }

  return value;
}

function normalizeRawAsteriskStyleOnLine(line) {
  if (/^\s*\*CONSUMING RAW OR UNDERCOOKED/i.test(line)) {
    return line;
  }
  return line
    .replace(/(\S)\s+\*(?=\s|[A-Za-z]{1,3}(?:,|\s|$))/g, '$1*')
    .replace(/(\S)\*(?=([A-Za-z]{1,3})(?:,|\s|$))/g, '$1* $2');
}

function boundedLevenshteinSimilarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const maxLength = Math.max(a.length, b.length);
  if (maxLength > 20000) {
    return tokenDiceSimilarity(a, b);
  }
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return 1 - (prev[b.length] / maxLength);
}

function tokenDiceSimilarity(a, b) {
  const aCounts = tokenCounts(a);
  const bCounts = tokenCounts(b);
  let overlap = 0;
  let aTotal = 0;
  let bTotal = 0;
  for (const count of aCounts.values()) aTotal += count;
  for (const count of bCounts.values()) bTotal += count;
  for (const [token, count] of aCounts) {
    overlap += Math.min(count, bCounts.get(token) || 0);
  }
  return (2 * overlap) / Math.max(1, aTotal + bTotal);
}

function tokenCounts(text) {
  const counts = new Map();
  const tokens = `${text || ''}`.toLowerCase().match(/[\p{L}\p{N}*,$.]+/gu) || [];
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

function classifyDelta(delta) {
  const epsilon = 0.0000001;
  if (delta > epsilon) return 'improved';
  if (delta < -epsilon) return 'regressed';
  return 'same';
}

function summarizeCorrections(corrections) {
  return corrections.reduce((acc, correction) => {
    acc[correction.type] = (acc[correction.type] || 0) + 1;
    return acc;
  }, {});
}

function createPairReport(pair, sourceText, targetText, treatmentText, corrections) {
  const baselineStrict = normalizeComparable(sourceText);
  const treatmentStrict = normalizeComparable(treatmentText);
  const targetStrict = normalizeComparable(targetText);
  const baselineStyle = normalizeComparable(sourceText, { normalizeRawAsteriskStyle: true });
  const treatmentStyle = normalizeComparable(treatmentText, { normalizeRawAsteriskStyle: true });
  const targetStyle = normalizeComparable(targetText, { normalizeRawAsteriskStyle: true });

  const baselineSimilarity = boundedLevenshteinSimilarity(baselineStrict, targetStrict);
  const treatmentSimilarity = boundedLevenshteinSimilarity(treatmentStrict, targetStrict);
  const baselineStyleSimilarity = boundedLevenshteinSimilarity(baselineStyle, targetStyle);
  const treatmentStyleSimilarity = boundedLevenshteinSimilarity(treatmentStyle, targetStyle);

  return {
    id: pair.id,
    source: pair.source,
    label: pair.label,
    property: pair.property,
    originalPath: pair.originalPath,
    finalPath: pair.finalPath,
    correctionsApplied: corrections.length,
    correctionsByType: summarizeCorrections(corrections),
    exact: {
      baseline: baselineStrict === targetStrict,
      treatment: treatmentStrict === targetStrict,
    },
    similarity: {
      baseline: round(baselineSimilarity),
      treatment: round(treatmentSimilarity),
      delta: round(treatmentSimilarity - baselineSimilarity),
      outcome: classifyDelta(treatmentSimilarity - baselineSimilarity),
    },
    rawAsteriskStyleNormalizedSimilarity: {
      baseline: round(baselineStyleSimilarity),
      treatment: round(treatmentStyleSimilarity),
      delta: round(treatmentStyleSimilarity - baselineStyleSimilarity),
      outcome: classifyDelta(treatmentStyleSimilarity - baselineStyleSimilarity),
    },
    sampleCorrections: corrections.slice(0, 8).map((correction) => ({
      type: correction.type,
      original: correction.original,
      corrected: correction.corrected,
      lineIndex: correction.lineIndex,
      source: correction.source,
      ruleId: correction.ruleId,
    })),
  };
}

function round(value) {
  return Number(value.toFixed(8));
}

function aggregatePairReports(pairReports) {
  const totalsByType = {};
  const outcomes = { improved: 0, same: 0, regressed: 0 };
  const styleOutcomes = { improved: 0, same: 0, regressed: 0 };
  let exactBaseline = 0;
  let exactTreatment = 0;
  let pairsWithPreAiChanges = 0;
  let totalCorrections = 0;
  let baselineSimilaritySum = 0;
  let treatmentSimilaritySum = 0;
  let baselineStyleSimilaritySum = 0;
  let treatmentStyleSimilaritySum = 0;

  for (const pair of pairReports) {
    if (pair.exact.baseline) exactBaseline += 1;
    if (pair.exact.treatment) exactTreatment += 1;
    if (pair.correctionsApplied > 0) pairsWithPreAiChanges += 1;
    totalCorrections += pair.correctionsApplied;
    baselineSimilaritySum += pair.similarity.baseline;
    treatmentSimilaritySum += pair.similarity.treatment;
    baselineStyleSimilaritySum += pair.rawAsteriskStyleNormalizedSimilarity.baseline;
    treatmentStyleSimilaritySum += pair.rawAsteriskStyleNormalizedSimilarity.treatment;
    outcomes[pair.similarity.outcome] += 1;
    styleOutcomes[pair.rawAsteriskStyleNormalizedSimilarity.outcome] += 1;
    for (const [type, count] of Object.entries(pair.correctionsByType)) {
      totalsByType[type] = (totalsByType[type] || 0) + count;
    }
  }

  const count = pairReports.length || 1;
  return {
    pairsEvaluated: pairReports.length,
    pairsWithPreAiChanges,
    totalCorrections,
    correctionsByType: totalsByType,
    strict: {
      exactBaseline,
      exactTreatment,
      avgBaselineSimilarity: round(baselineSimilaritySum / count),
      avgTreatmentSimilarity: round(treatmentSimilaritySum / count),
      avgDelta: round((treatmentSimilaritySum - baselineSimilaritySum) / count),
      outcomes,
    },
    rawAsteriskStyleNormalized: {
      avgBaselineSimilarity: round(baselineStyleSimilaritySum / count),
      avgTreatmentSimilarity: round(treatmentStyleSimilaritySum / count),
      avgDelta: round((treatmentStyleSimilaritySum - baselineStyleSimilaritySum) / count),
      outcomes: styleOutcomes,
    },
  };
}

function buildMarkdown(report) {
  const summary = report.summary;
  const lines = [
    '# Pre-AI Deterministic A/B Replay',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Dataset',
    `- Pairs discovered: ${report.dataset.pairsDiscovered}`,
    `- Pairs evaluated: ${summary.pairsEvaluated}`,
    `- Pairs skipped: ${report.dataset.pairsSkipped}`,
    `- Accepted learned rules loaded: ${report.dataset.acceptedCorrectionRulesLoaded}`,
    '',
    '## Summary',
    `- Pairs with pre-AI changes: ${summary.pairsWithPreAiChanges}`,
    `- Total deterministic corrections: ${summary.totalCorrections}`,
    `- Corrections by type: ${Object.keys(summary.correctionsByType).length ? Object.entries(summary.correctionsByType).map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}`,
    '',
    '## Strict Text Comparison',
    `- Exact matches, baseline: ${summary.strict.exactBaseline}`,
    `- Exact matches, treatment: ${summary.strict.exactTreatment}`,
    `- Avg baseline similarity: ${(summary.strict.avgBaselineSimilarity * 100).toFixed(4)}%`,
    `- Avg treatment similarity: ${(summary.strict.avgTreatmentSimilarity * 100).toFixed(4)}%`,
    `- Avg delta: ${(summary.strict.avgDelta * 100).toFixed(6)} percentage points`,
    `- Outcomes: ${formatOutcomes(summary.strict.outcomes)}`,
    '',
    '## Raw-Asterisk-Style-Normalized Comparison',
    `- Avg baseline similarity: ${(summary.rawAsteriskStyleNormalized.avgBaselineSimilarity * 100).toFixed(4)}%`,
    `- Avg treatment similarity: ${(summary.rawAsteriskStyleNormalized.avgTreatmentSimilarity * 100).toFixed(4)}%`,
    `- Avg delta: ${(summary.rawAsteriskStyleNormalized.avgDelta * 100).toFixed(6)} percentage points`,
    `- Outcomes: ${formatOutcomes(summary.rawAsteriskStyleNormalized.outcomes)}`,
    '',
    '## Regressions',
  ];

  const regressions = report.pairs
    .filter((pair) => pair.similarity.outcome === 'regressed')
    .sort((a, b) => a.similarity.delta - b.similarity.delta)
    .slice(0, 12);
  if (!regressions.length) {
    lines.push('- None');
  } else {
    for (const pair of regressions) {
      lines.push(`- ${pair.label}: strict delta ${(pair.similarity.delta * 100).toFixed(6)} pp; style-normalized delta ${(pair.rawAsteriskStyleNormalizedSimilarity.delta * 100).toFixed(6)} pp; corrections ${pair.correctionsApplied}`);
      for (const correction of pair.sampleCorrections.slice(0, 4)) {
        lines.push(`  - ${correction.type}: \`${correction.original}\` -> \`${correction.corrected}\``);
      }
    }
  }

  lines.push('', '## Notes');
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatOutcomes(outcomes) {
  return `improved ${outcomes.improved}, same ${outcomes.same}, regressed ${outcomes.regressed}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { runPreAiDeterministicChecks } = requirePreAiHelper();
  const pythonBin = resolvePythonBin();
  const acceptedCorrectionRules = loadAcceptedCorrectionRules();
  const discoveredPairs = collectPairs(args.source);
  const pairs = discoveredPairs.slice(0, args.limit);
  const pairReports = [];
  const skipped = [];

  for (const pair of pairs) {
    try {
      const sourceText = extractCleanMenuText(pythonBin, pair.originalPath);
      const targetText = extractCleanMenuText(pythonBin, pair.finalPath);
      const treatment = runPreAiDeterministicChecks(sourceText, {
        property: pair.property,
        acceptedCorrectionRules,
      });
      pairReports.push(createPairReport(
        pair,
        sourceText,
        targetText,
        treatment.menuText,
        treatment.appliedCorrections
      ));
    } catch (error) {
      skipped.push({
        id: pair.id,
        label: pair.label,
        originalPath: pair.originalPath,
        finalPath: pair.finalPath,
        reason: error.message,
      });
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = args.outDir
    ? path.resolve(args.outDir)
    : path.join(defaultOutRoot, timestamp);
  await fsp.mkdir(outDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'offline_docx_replay',
    dataset: {
      source: args.source,
      pairsDiscovered: discoveredPairs.length,
      pairsEvaluated: pairReports.length,
      pairsSkipped: skipped.length,
      acceptedCorrectionRulesLoaded: acceptedCorrectionRules.length,
      pythonBin,
    },
    summary: aggregatePairReports(pairReports),
    pairs: pairReports.sort((a, b) => a.label.localeCompare(b.label)),
    skipped,
    outputFiles: {
      reportJson: path.join(outDir, 'report.json'),
      reportMd: path.join(outDir, 'report.md'),
    },
    notes: [
      'This is an offline replay: baseline is extracted historical source DOCX text, treatment is that same text after deterministic pre-AI checks, and target is the paired human/redlined DOCX text.',
      'It does not re-run the language model, so it validates deterministic guard impact rather than stochastic AI response quality.',
      'Raw-asterisk-style-normalized metrics collapse old `description *` spacing into the newly required `description*` style before comparison.',
    ],
  };

  await fsp.writeFile(report.outputFiles.reportJson, JSON.stringify(report, null, 2));
  await fsp.writeFile(report.outputFiles.reportMd, buildMarkdown(report));

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Pre-AI A/B replay complete: ${report.outputFiles.reportMd}`);
    console.log(`Pairs evaluated: ${report.summary.pairsEvaluated}/${report.dataset.pairsDiscovered}`);
    console.log(`Pre-AI changes: ${report.summary.pairsWithPreAiChanges} pairs, ${report.summary.totalCorrections} corrections`);
    console.log(`Strict outcomes: ${formatOutcomes(report.summary.strict.outcomes)}`);
    console.log(`Style-normalized outcomes: ${formatOutcomes(report.summary.rawAsteriskStyleNormalized.outcomes)}`);
    console.log(`Avg strict delta: ${(report.summary.strict.avgDelta * 100).toFixed(6)} pp`);
    console.log(`Avg style-normalized delta: ${(report.summary.rawAsteriskStyleNormalized.avgDelta * 100).toFixed(6)} pp`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
