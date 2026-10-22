#!/usr/bin/env node
/**
 * Replay the price integrity guard over completed Basic AI Check audits and
 * list every Missing Price critical the guard itself raises (an AI-added price
 * it stripped). A critical whose submitted line already contains the price's
 * numbers is a false block: the chef typed the price in a shape the shared
 * price grammar (services/dashboard/lib/price-shapes.ts) does not know.
 *
 * Input per row: the text the guard compared against in prod (ai_request.text,
 * the pre-checked review body; menu_content_raw for rows without it) and
 * deterministic_diagnostics.postAiDeterministic.correctedMenu (the AI's
 * corrected menu before the guard ran).
 *
 * Each critical is classified:
 *   same_line      the submitted line has the price's numbers -> false block
 *                  (price-shapes does not know the shape; fix there)
 *   neighbor_line  the numbers are on one of the next two submitted lines
 *                  (price typed on its own line / table cell; the AI merged it
 *                  onto the name line)
 *   absent         the numbers are nowhere near the item -> a real catch
 *
 * Usage:
 *   node scripts/replay-guard-criticals.js                     # since 2026-07-01
 *   node scripts/replay-guard-criticals.js --since 2026-10-01
 *   node scripts/replay-guard-criticals.js --json
 *
 * Exits 1 when any same_line or neighbor_line false block is found, so it
 * gates any change to price-shapes.ts or the guard. Baseline:
 * docs/design-docs/critical-error-blocking.md.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function loadEnv() {
  const dotenv = require('dotenv');
  const local = path.join(repoRoot, '.env');
  if (fs.existsSync(local)) {
    dotenv.config({ path: local, quiet: true });
    return;
  }
  // Worktrees have no .env; use the main checkout's.
  try {
    const commonDir = execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd: repoRoot }).toString().trim();
    dotenv.config({ path: path.join(path.dirname(commonDir), '.env'), quiet: true });
  } catch {
    // Fall through; getSupabase reports the missing keys.
  }
}

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
  const helperPath = path.join(repoRoot, 'services', 'dashboard', 'dist', 'lib', `${relPath}.js`);
  if (!fs.existsSync(helperPath)) {
    throw new Error(`Dashboard lib ${relPath} could not be loaded; run npm run build --workspace=@menumanager/dashboard first.`);
  }
  return require(helperPath);
}

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const { requireSupabaseServiceKey } = require('./lib/supabase-key');
  const url = process.env.SUPABASE_URL;
  const key = requireSupabaseServiceKey(process.env);
  if (!url || !key) {
    throw new Error('SUPABASE_URL and a service key are required (SUPABASE_SERVICE_ROLE_KEY or legacy SUPABASE_SERVICE_KEY)');
  }
  return createClient(url, key);
}

function parseArgs(argv) {
  const args = { since: '2026-07-01', json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--since') args.since = argv[++i];
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

async function fetchRows(supabase, since) {
  const pageSize = 200;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('basic_ai_check_audits')
      .select('id, attempt_id, created_at, project_name, property, menu_content_raw, ai_request, deterministic_diagnostics')
      .eq('event_type', 'completed')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to read basic_ai_check_audits: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

// A price typed on its own line or table cell follows the item, never precedes it.
const FOLLOWING_LINES = 2;

function normalizeText(value) {
  return `${value || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function classify(change, submittedLines, priceNumbers) {
  const numbers = priceNumbers(change.correctedPrice);
  const hasNumbers = (line) => {
    const present = new Set(priceNumbers(line));
    return numbers.length > 0 && numbers.every((n) => present.has(n));
  };
  if (hasNumbers(change.originalLine)) return 'same_line';

  const nonEmpty = submittedLines.map((line) => line.trim()).filter(Boolean);
  // Anchor on the submitted line the guard paired with, and on the submitted
  // line the AI line actually came from (the guard pairs by first segment, so
  // two "Cabernet Sauvignon, ..." wines can be crossed).
  const correctedText = normalizeText(change.correctedLine.slice(0, change.correctedLine.lastIndexOf(change.correctedPrice))).slice(0, 40);
  const anchors = new Set([nonEmpty.indexOf(change.originalLine.trim())]);
  if (correctedText) {
    nonEmpty.forEach((line, index) => {
      if (normalizeText(line).startsWith(correctedText)) anchors.add(index);
    });
  }
  for (const at of anchors) {
    if (at < 0) continue;
    if (nonEmpty.slice(at, at + FOLLOWING_LINES + 1).some(hasNumbers)) return 'neighbor_line';
  }
  return 'absent';
}

function replayRow(row, { guardCorrectedMenuPrices, priceNumbers }) {
  const submitted = row.ai_request?.text || row.menu_content_raw || '';
  const corrected = row.deterministic_diagnostics?.postAiDeterministic?.correctedMenu || '';
  if (!submitted || !corrected) return null;

  const submittedLines = submitted.split('\n');
  const result = guardCorrectedMenuPrices(submitted, corrected, []);
  return result.changes
    .filter((change) => change.reason === 'added_price')
    .map((change) => ({
      auditId: row.id,
      attemptId: row.attempt_id,
      createdAt: row.created_at,
      project: row.project_name,
      property: row.property,
      menuItem: change.menuItem,
      submittedLine: change.originalLine,
      correctedLine: change.correctedLine,
      strippedPrice: change.correctedPrice,
      kind: classify(change, submittedLines, priceNumbers),
    }));
}

async function main() {
  const args = parseArgs(process.argv);
  loadEnv();
  const { guardCorrectedMenuPrices } = requireDashboardLib('price-integrity-guard');
  const { priceNumbers } = requireDashboardLib('price-shapes');
  const rows = await fetchRows(getSupabase(), args.since);

  let replayed = 0;
  const criticals = [];
  for (const row of rows) {
    const found = replayRow(row, { guardCorrectedMenuPrices, priceNumbers });
    if (!found) continue;
    replayed += 1;
    criticals.push(...found);
  }
  const falseBlocks = criticals.filter((c) => c.kind !== 'absent');
  const countOf = (kind) => criticals.filter((c) => c.kind === kind).length;

  if (args.json) {
    console.log(JSON.stringify({ since: args.since, rows: rows.length, replayed, criticals }, null, 2));
  } else {
    console.log(`Completed audits since ${args.since}: ${rows.length} (${replayed} replayable)`);
    console.log(`Code-made Missing Price criticals: ${criticals.length} in ${new Set(criticals.map((c) => c.auditId)).size} audits`);
    console.log(`  same_line (false block, price shape unknown): ${countOf('same_line')}`);
    console.log(`  neighbor_line (false block, price typed on the line below): ${countOf('neighbor_line')}`);
    console.log(`  absent (real catch): ${countOf('absent')}`);
    for (const c of criticals) {
      console.log(`\n${c.kind}  ${c.createdAt.slice(0, 10)}  ${c.property || '-'} / ${c.project || '-'}  [${c.auditId}]`);
      console.log(`  item:      ${c.menuItem}`);
      console.log(`  submitted: ${c.submittedLine}`);
      console.log(`  AI:        ${c.correctedLine}`);
      console.log(`  stripped:  ${c.strippedPrice}`);
    }
  }
  process.exit(falseBlocks.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}

module.exports = { classify, replayRow };
