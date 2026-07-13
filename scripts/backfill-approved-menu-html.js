#!/usr/bin/env node
/* Populate clean, post-approval HTML for existing approved submissions when
 * their approved DOCX is available locally. Per-record failures are skipped. */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { isSupabaseConfigured, getSupabaseClient } = require('../services/supabase-client/dist');
const { extractCleanMenuFromDocx } = require('../services/docx-redliner/clean-menu-extraction');

const APPROVED = new Set(['approved', 'approved_override']);
const localDbDir = path.join(__dirname, '..', 'tmp', 'db');

function idFor(row) { return `${row.legacy_id || row.id || ''}`.trim(); }
function findApprovedPath(row, assets) {
  const candidates = [row.final_path];
  for (const asset of assets) {
    if (`${asset.submission_id || ''}` === idFor(row) && asset.asset_type === 'approved_docx') candidates.push(asset.storage_path);
  }
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function populate(rows, assets, save) {
  const summary = { updated: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    if (!APPROVED.has(`${row.status || ''}`.toLowerCase()) || row.approved_menu_content_html) { summary.skipped++; continue; }
    const approvedPath = findApprovedPath(row, assets);
    if (!approvedPath) { summary.skipped++; continue; }
    try {
      const extracted = await extractCleanMenuFromDocx(approvedPath, { acceptChanges: true });
      const html = `${extracted.cleaned_menu_html || ''}`.trim();
      if (!html) { summary.skipped++; continue; }
      await save(row, html);
      summary.updated++;
    } catch (error) {
      summary.failed++;
      console.warn(`Skipped ${idFor(row) || 'unknown'}: ${error.message}`);
    }
  }
  return summary;
}

(async () => {
  let localRows = [];
  let localSubmissions = {};
  let localAssets = [];
  try {
    localSubmissions = JSON.parse(await fsp.readFile(path.join(localDbDir, 'submissions.json'), 'utf8'));
    localAssets = JSON.parse(await fsp.readFile(path.join(localDbDir, 'assets.json'), 'utf8'));
    localRows = Object.values(localSubmissions);
  } catch { /* JSON fallback may not exist on Supabase-only deployments. */ }
  const local = await populate(localRows, localAssets, async (row, html) => {
    localSubmissions[idFor(row)].approved_menu_content_html = html;
  });
  if (local.updated) await fsp.writeFile(path.join(localDbDir, 'submissions.json'), JSON.stringify(localSubmissions, null, 2));

  let remote = { updated: 0, skipped: 0, failed: 0 };
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    const [{ data: submissions, error: submissionsError }, { data: assets, error: assetsError }] = await Promise.all([
      supabase.from('submissions').select('*').in('status', [...APPROVED]),
      supabase.from('assets').select('submission_id, asset_type, storage_path').eq('asset_type', 'approved_docx'),
    ]);
    if (submissionsError) throw new Error(submissionsError.message);
    if (assetsError) throw new Error(assetsError.message);
    remote = await populate(submissions || [], assets || [], async (row, html) => {
      const column = row.legacy_id ? 'legacy_id' : 'id';
      const { error } = await supabase.from('submissions').update({ approved_menu_content_html: html }).eq(column, row[column]);
      if (error) throw new Error(error.message);
    });
  }
  console.log(`Backfill complete: local updated=${local.updated}, skipped=${local.skipped}, failed=${local.failed}; Supabase updated=${remote.updated}, skipped=${remote.skipped}, failed=${remote.failed}.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
