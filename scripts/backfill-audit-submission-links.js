#!/usr/bin/env node
/**
 * Backfill submissions.form_attempt_id and basic_ai_check_audits.submission_id
 * for rows created before the review-training links migration (20260611).
 *
 * Matching heuristic (fuzzy join, conservative):
 *   - submission has no form_attempt_id
 *   - audit has the same submitter_email + project_name (+ property when both set)
 *   - audit.created_at falls within --window hours BEFORE submission.created_at
 *   - the latest matching event_type='completed' audit wins
 * Ambiguous candidates that tie across different attempt_ids are reported, not written.
 *
 * Usage:
 *   node scripts/backfill-audit-submission-links.js            # dry run (default)
 *   node scripts/backfill-audit-submission-links.js --apply    # write links
 *   node scripts/backfill-audit-submission-links.js --window 12
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) are required');
  }
  return createClient(url, key);
}

function parseArgs(argv) {
  const args = { apply: false, windowHours: 6 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--dry-run') args.apply = false;
    else if (argv[i] === '--window') args.windowHours = Number(argv[++i]) || 6;
  }
  return args;
}

function normalizeKeyPart(value) {
  return `${value || ''}`.trim().toLowerCase();
}

async function fetchAll(supabase, table, select, filter) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = getSupabase();
  const windowMs = args.windowHours * 3600 * 1000;

  const submissions = await fetchAll(
    supabase,
    'submissions',
    'id, submitter_email, project_name, property, created_at, form_attempt_id',
    (q) => q.is('form_attempt_id', null)
  );
  const audits = await fetchAll(
    supabase,
    'basic_ai_check_audits',
    'id, attempt_id, event_type, submitter_email, project_name, property, created_at, submission_id'
  );

  console.log(`Unlinked submissions: ${submissions.length}; audit rows: ${audits.length}; window: ${args.windowHours}h; mode: ${args.apply ? 'APPLY' : 'dry-run'}`);

  const auditsByKey = new Map();
  for (const audit of audits) {
    if (!audit.attempt_id) continue;
    const key = `${normalizeKeyPart(audit.submitter_email)}|${normalizeKeyPart(audit.project_name)}`;
    if (!auditsByKey.has(key)) auditsByKey.set(key, []);
    auditsByKey.get(key).push(audit);
  }

  let linked = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const submission of submissions) {
    const key = `${normalizeKeyPart(submission.submitter_email)}|${normalizeKeyPart(submission.project_name)}`;
    const submittedAt = Date.parse(submission.created_at);
    const candidates = (auditsByKey.get(key) || []).filter((audit) => {
      const auditAt = Date.parse(audit.created_at);
      if (!Number.isFinite(auditAt) || !Number.isFinite(submittedAt)) return false;
      if (auditAt > submittedAt || submittedAt - auditAt > windowMs) return false;
      if (submission.property && audit.property
        && normalizeKeyPart(submission.property) !== normalizeKeyPart(audit.property)) return false;
      return true;
    });

    if (!candidates.length) {
      unmatched++;
      continue;
    }

    const completed = candidates.filter((audit) => audit.event_type === 'completed');
    const pool = completed.length ? completed : candidates;
    pool.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const best = pool[0];
    const tied = pool.filter((audit) => audit.created_at === best.created_at && audit.attempt_id !== best.attempt_id);
    if (tied.length) {
      ambiguous++;
      console.log(`AMBIGUOUS ${submission.id}: attempts ${[best, ...tied].map((a) => a.attempt_id).join(', ')}`);
      continue;
    }

    console.log(`${args.apply ? 'LINK' : 'WOULD LINK'} ${submission.id} -> attempt ${best.attempt_id} (${best.event_type}, ${best.created_at})`);
    linked++;

    if (args.apply) {
      const { error: submissionError } = await supabase
        .from('submissions')
        .update({ form_attempt_id: best.attempt_id })
        .eq('id', submission.id);
      if (submissionError) {
        console.error(`Failed to set form_attempt_id for ${submission.id}: ${submissionError.message}`);
        continue;
      }
      const { error: auditError } = await supabase
        .from('basic_ai_check_audits')
        .update({ submission_id: submission.id })
        .eq('attempt_id', best.attempt_id)
        .is('submission_id', null);
      if (auditError) {
        console.error(`Failed to set submission_id on audits for attempt ${best.attempt_id}: ${auditError.message}`);
      }
    }
  }

  console.log(`Done. linked=${linked} ambiguous=${ambiguous} unmatched=${unmatched}${args.apply ? '' : ' (dry run; use --apply to write)'}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
