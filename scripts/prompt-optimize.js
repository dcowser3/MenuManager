#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function getRepoRoot() {
  return path.resolve(__dirname, '..');
}

function resolvePythonBin(repoRoot) {
  const venvPython = path.join(repoRoot, 'services', 'docx-redliner', 'venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;
  return 'python3';
}

function readJsonFile(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeToken(token) {
  return String(token || '').toLowerCase().replace(/[’'`]/g, "'").trim();
}

function stripDiacritics(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokenize(line) {
  const m = String(line || '').match(/[\p{L}\p{N}]+(?:[’'`-][\p{L}\p{N}]+)*/gu);
  return m || [];
}

function normalizeLine(line) {
  return normalizeWhitespace(stripDiacritics(String(line || '').toLowerCase()));
}

function diffLines(before, after) {
  const beforeNorm = before.map((l) => normalizeLine(l));
  const afterNorm = after.map((l) => normalizeLine(l));
  const m = beforeNorm.length;
  const n = afterNorm.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (beforeNorm[i] === afterNorm[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const edits = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (beforeNorm[i] === afterNorm[j]) {
      pushLineEdit(edits, 'equal', before[i], i);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushLineEdit(edits, 'delete', before[i], i);
      i += 1;
    } else {
      pushLineEdit(edits, 'insert', after[j], j);
      j += 1;
    }
  }
  while (i < m) {
    pushLineEdit(edits, 'delete', before[i], i);
    i += 1;
  }
  while (j < n) {
    pushLineEdit(edits, 'insert', after[j], j);
    j += 1;
  }
  return edits;
}

function pushLineEdit(edits, type, line, idx) {
  const last = edits[edits.length - 1];
  if (last && last.type === type) {
    last.lines.push(line);
    last.indices.push(idx);
    return;
  }
  edits.push({ type, lines: [line], indices: [idx] });
}

function diffTokens(beforeTokens, afterTokens) {
  const beforeNorm = beforeTokens.map((t) => normalizeToken(t));
  const afterNorm = afterTokens.map((t) => normalizeToken(t));
  const m = beforeNorm.length;
  const n = afterNorm.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (beforeNorm[i] === afterNorm[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const edits = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (beforeNorm[i] === afterNorm[j]) {
      pushTokenEdit(edits, 'equal', beforeTokens[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushTokenEdit(edits, 'delete', beforeTokens[i]);
      i += 1;
    } else {
      pushTokenEdit(edits, 'insert', afterTokens[j]);
      j += 1;
    }
  }
  while (i < m) {
    pushTokenEdit(edits, 'delete', beforeTokens[i]);
    i += 1;
  }
  while (j < n) {
    pushTokenEdit(edits, 'insert', afterTokens[j]);
    j += 1;
  }
  return edits;
}

function pushTokenEdit(edits, type, token) {
  const last = edits[edits.length - 1];
  if (last && last.type === type) {
    last.tokens.push(token);
    return;
  }
  edits.push({ type, tokens: [token] });
}

function lineSimilarity(a, b) {
  const t1 = tokenize(normalizeWhitespace(a)).map((t) => normalizeToken(stripDiacritics(t)));
  const t2 = tokenize(normalizeWhitespace(b)).map((t) => normalizeToken(stripDiacritics(t)));
  if (!t1.length && !t2.length) return 1;
  if (!t1.length || !t2.length) return 0;
  const m = t1.length;
  const n = t2.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (t1[i] === t2[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lcs = dp[0][0];
  return lcs / Math.max(m, n);
}

function applyRulesToLine(line, ruleMap) {
  const raw = String(line || '');
  return raw.replace(/[\p{L}\p{N}]+(?:[’'`-][\p{L}\p{N}]+)*/gu, (match) => {
    const norm = normalizeToken(match);
    const replacement = ruleMap.get(norm);
    if (!replacement) return match;
    return replacement.target;
  });
}

function applyRulesToText(text, selectedRules) {
  if (!selectedRules.length) return text;
  const ruleMap = new Map(selectedRules.map((r) => [r.source_norm, r]));
  const lines = String(text || '').split('\n');
  const transformed = lines.map((line) => applyRulesToLine(line, ruleMap));
  return transformed.join('\n');
}

function evaluateDataset(dataset, selectedRules) {
  let exactMatches = 0;
  let similaritySum = 0;
  for (const sample of dataset) {
    const predicted = applyRulesToText(sample.ai_text, selectedRules);
    const predNorm = normalizeWhitespace(predicted);
    const targetNorm = normalizeWhitespace(sample.final_text);
    if (predNorm === targetNorm) exactMatches += 1;
    similaritySum += lineSimilarity(predNorm, targetNorm);
  }
  const count = dataset.length || 1;
  return {
    exact_match_rate: exactMatches / count,
    avg_similarity: similaritySum / count,
    exact_matches: exactMatches,
    total: dataset.length,
  };
}

function extractReplacements(aiText, finalText) {
  const edits = diffLines(String(aiText || '').split('\n'), String(finalText || '').split('\n'));
  const replacements = [];
  for (let i = 0; i < edits.length; i += 1) {
    const current = edits[i];
    const next = edits[i + 1];
    if (!current || !next || current.type !== 'delete' || next.type !== 'insert') continue;
    const pairCount = Math.min(current.lines.length, next.lines.length);
    for (let j = 0; j < pairCount; j += 1) {
      const beforeLine = current.lines[j] || '';
      const afterLine = next.lines[j] || '';
      const tokenEdits = diffTokens(tokenize(beforeLine), tokenize(afterLine));
      for (let k = 0; k < tokenEdits.length; k += 1) {
        const e1 = tokenEdits[k];
        const e2 = tokenEdits[k + 1];
        if (!e1 || !e2 || e1.type !== 'delete' || e2.type !== 'insert') continue;
        const tokenPairs = Math.min(e1.tokens.length, e2.tokens.length);
        for (let x = 0; x < tokenPairs; x += 1) {
          const from = e1.tokens[x];
          const to = e2.tokens[x];
          const fromNorm = normalizeToken(from);
          const toNorm = normalizeToken(to);
          if (!fromNorm || !toNorm || fromNorm === toNorm) continue;
          replacements.push({
            source: from,
            target: to,
            source_norm: fromNorm,
            target_norm: toNorm,
            sample_line_before: beforeLine,
            sample_line_after: afterLine,
          });
        }
      }
    }
  }
  return replacements;
}

function splitDatasetDeterministic(dataset, holdoutRatio = 0.2) {
  const train = [];
  const holdout = [];
  for (const sample of dataset) {
    const hash = crypto.createHash('sha1').update(sample.submission_id || '').digest('hex');
    const value = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
    if (value < holdoutRatio) holdout.push(sample);
    else train.push(sample);
  }
  if (!train.length && holdout.length) train.push(holdout.pop());
  return { train, holdout };
}

function buildPromptAddendum(selectedRules, locationRules) {
  const header = [
    '### WEEKLY OPTIMIZED CORRECTION GUIDANCE (AUTO-GENERATED REPORT)',
    'Use this as a draft for manual prompt updates. Do not apply blindly.',
    '',
    'Global high-value replacements inferred from corrected menus:',
  ];
  const ruleLines = selectedRules.map(
    (r, idx) => `${idx + 1}. "${r.source}" -> "${r.target}" (occurrences: ${r.occurrences}, submissions: ${r.submission_count})`
  );
  const locationHeader = [
    '',
    'Location-specific reviewer annotations:',
  ];
  const locationLines = (locationRules || []).map((r, idx) => {
    const shared = Array.isArray(r.shared_locations) && r.shared_locations.length ? `; shared: ${r.shared_locations.join(', ')}` : '';
    return `${idx + 1}. [${r.restaurant_name} | ${r.location}] ${r.before_line} -> ${r.after_line}${shared}\n   Reason: ${r.explanation}`;
  });
  return [...header, ...(ruleLines.length ? ruleLines : ['(none selected)']), ...locationHeader, ...(locationLines.length ? locationLines : ['(none)'])].join('\n');
}

function buildRulePool(dataset) {
  const map = new Map();
  for (const sample of dataset) {
    const reps = extractReplacements(sample.ai_text, sample.final_text);
    const seenThisSample = new Set();
    for (const rep of reps) {
      const key = `${rep.source_norm}=>${rep.target_norm}`;
      if (!map.has(key)) {
        map.set(key, {
          ...rep,
          key,
          occurrences: 0,
          submission_ids: new Set(),
        });
      }
      const item = map.get(key);
      item.occurrences += 1;
      if (!seenThisSample.has(key)) {
        item.submission_ids.add(sample.submission_id);
        seenThisSample.add(key);
      }
    }
  }
  const pool = [];
  for (const item of map.values()) {
    pool.push({
      key: item.key,
      source: item.source,
      target: item.target,
      source_norm: item.source_norm,
      target_norm: item.target_norm,
      occurrences: item.occurrences,
      submission_count: item.submission_ids.size,
    });
  }
  return pool.sort((a, b) => b.occurrences - a.occurrences || b.submission_count - a.submission_count);
}

function optimizeRules(trainSet, pool, maxRules = 50) {
  const selected = [];
  let baseline = evaluateDataset(trainSet, selected);
  const used = new Set();
  while (selected.length < maxRules) {
    let best = null;
    let bestMetrics = baseline;
    for (const rule of pool) {
      if (used.has(rule.key)) continue;
      const metrics = evaluateDataset(trainSet, [...selected, rule]);
      const gain = (metrics.avg_similarity - baseline.avg_similarity) + (metrics.exact_match_rate - baseline.exact_match_rate);
      if (!best || gain > best.gain) {
        best = { rule, gain };
        bestMetrics = metrics;
      }
    }
    if (!best || best.gain <= 0) break;
    selected.push(best.rule);
    used.add(best.rule.key);
    baseline = bestMetrics;
  }
  return { selected, trainMetrics: baseline };
}

async function extractCleanMenuText(pythonBin, scriptPath, docPath) {
  const p = spawnSync(pythonBin, [scriptPath, docPath], { encoding: 'utf8' });
  if (p.status !== 0) {
    throw new Error(p.stderr || `Failed to extract text from ${docPath}`);
  }
  const parsed = JSON.parse((p.stdout || '{}').trim() || '{}');
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  return String(parsed.cleaned_menu_content || parsed.menu_content || '').trim();
}

async function run() {
  const repoRoot = getRepoRoot();
  const learningDir = path.join(repoRoot, 'tmp', 'learning');
  const trainingPath = path.join(learningDir, 'training_data.jsonl');
  const locationRulesPath = path.join(learningDir, 'location_specific_rules.json');
  const qaPromptPath = path.join(repoRoot, 'sop-processor', 'qa_prompt.txt');
  const extractScript = path.join(repoRoot, 'services', 'docx-redliner', 'extract_clean_menu_text.py');
  const pythonBin = resolvePythonBin(repoRoot);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(repoRoot, 'tmp', 'prompt-optimizer', timestamp);
  await fsp.mkdir(outDir, { recursive: true });

  const entries = parseJsonl(trainingPath);
  if (!entries.length) {
    throw new Error(`No learning data found at ${trainingPath}`);
  }

  const bySubmission = new Map();
  for (const entry of entries) {
    const prev = bySubmission.get(entry.submission_id);
    if (!prev || new Date(entry.timestamp || 0).getTime() >= new Date(prev.timestamp || 0).getTime()) {
      bySubmission.set(entry.submission_id, entry);
    }
  }
  const latestEntries = Array.from(bySubmission.values());
  const dataset = [];
  let skipped = 0;

  for (const entry of latestEntries) {
    try {
      if (!entry.ai_draft_path || !entry.final_path) {
        skipped += 1;
        continue;
      }
      if (!fs.existsSync(entry.ai_draft_path) || !fs.existsSync(entry.final_path)) {
        skipped += 1;
        continue;
      }
      const aiText = await extractCleanMenuText(pythonBin, extractScript, entry.ai_draft_path);
      const finalText = await extractCleanMenuText(pythonBin, extractScript, entry.final_path);
      dataset.push({
        submission_id: entry.submission_id,
        timestamp: entry.timestamp,
        ai_text: aiText,
        final_text: finalText,
      });
    } catch (error) {
      skipped += 1;
      console.warn(`Skipping ${entry.submission_id}: ${error.message}`);
    }
  }

  if (!dataset.length) {
    throw new Error('No usable submission pairs found after extracting clean menu text.');
  }

  const { train, holdout } = splitDatasetDeterministic(dataset, 0.2);
  const pool = buildRulePool(train);
  const { selected, trainMetrics } = optimizeRules(train, pool, 60);
  const holdoutMetrics = holdout.length ? evaluateDataset(holdout, selected) : null;
  const allMetrics = evaluateDataset(dataset, selected);

  const locationRules = readJsonFile(locationRulesPath, []);
  const prompt = await fsp.readFile(qaPromptPath, 'utf8');
  const addendum = buildPromptAddendum(selected, locationRules);
  const candidatePrompt = `${prompt}\n\n${addendum}\n`;

  const report = {
    generated_at: new Date().toISOString(),
    dataset: {
      total_training_entries: entries.length,
      unique_submissions: latestEntries.length,
      usable_pairs: dataset.length,
      skipped_pairs: skipped,
      train_size: train.length,
      holdout_size: holdout.length,
    },
    optimizer: {
      candidate_rules_considered: pool.length,
      selected_rule_count: selected.length,
      selected_rules: selected,
    },
    metrics: {
      train: trainMetrics,
      holdout: holdoutMetrics,
      full_dataset: allMetrics,
    },
    output_files: {
      prompt_addendum: path.join(outDir, 'prompt_addendum.txt'),
      candidate_prompt: path.join(outDir, 'candidate_prompt.txt'),
      report_json: path.join(outDir, 'report.json'),
      report_md: path.join(outDir, 'report.md'),
    },
    notes: [
      'This optimizer targets replay accuracy on known corrected menus and can overfit.',
      'Use holdout metrics + manual review before merging prompt changes.',
      'Location-specific rules are included as contextual notes and should be manually curated.',
    ],
  };

  const md = [
    '# Weekly Prompt Optimization Report',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## Dataset',
    `- Total training entries: ${report.dataset.total_training_entries}`,
    `- Unique submissions: ${report.dataset.unique_submissions}`,
    `- Usable pairs: ${report.dataset.usable_pairs}`,
    `- Skipped pairs: ${report.dataset.skipped_pairs}`,
    `- Train size: ${report.dataset.train_size}`,
    `- Holdout size: ${report.dataset.holdout_size}`,
    '',
    '## Metrics',
    `- Train exact match rate: ${(report.metrics.train.exact_match_rate * 100).toFixed(2)}%`,
    `- Train avg similarity: ${(report.metrics.train.avg_similarity * 100).toFixed(2)}%`,
    holdoutMetrics
      ? `- Holdout exact match rate: ${(holdoutMetrics.exact_match_rate * 100).toFixed(2)}%`
      : '- Holdout exact match rate: N/A',
    holdoutMetrics
      ? `- Holdout avg similarity: ${(holdoutMetrics.avg_similarity * 100).toFixed(2)}%`
      : '- Holdout avg similarity: N/A',
    `- Full dataset exact match rate: ${(report.metrics.full_dataset.exact_match_rate * 100).toFixed(2)}%`,
    `- Full dataset avg similarity: ${(report.metrics.full_dataset.avg_similarity * 100).toFixed(2)}%`,
    '',
    '## Selected Rules',
    ...(selected.length
      ? selected.map((r, i) => `${i + 1}. \`${r.source}\` -> \`${r.target}\` (occurrences: ${r.occurrences}, submissions: ${r.submission_count})`)
      : ['(none selected)']),
    '',
    '## Notes',
    ...report.notes.map((n) => `- ${n}`),
    '',
  ].join('\n');

  await fsp.writeFile(path.join(outDir, 'prompt_addendum.txt'), addendum);
  await fsp.writeFile(path.join(outDir, 'candidate_prompt.txt'), candidatePrompt);
  await fsp.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await fsp.writeFile(path.join(outDir, 'report.md'), md);

  console.log('Prompt optimization complete.');
  console.log(`Output directory: ${outDir}`);
  console.log(`Train exact match: ${(trainMetrics.exact_match_rate * 100).toFixed(2)}%`);
  console.log(`Full exact match: ${(allMetrics.exact_match_rate * 100).toFixed(2)}%`);
  if (holdoutMetrics) {
    console.log(`Holdout exact match: ${(holdoutMetrics.exact_match_rate * 100).toFixed(2)}%`);
  }
}

run().catch((error) => {
  console.error(`Prompt optimization failed: ${error.message}`);
  process.exit(1);
});
