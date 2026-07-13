#!/usr/bin/env node
/**
 * Audit approved-menu artifact recoverability.
 *
 * Usage:
 *   node scripts/audit-approved-documents.js
 *   node scripts/audit-approved-documents.js --restore
 *
 * Reads Supabase when configured and otherwise the local JSON fallback. Restore
 * downloads only existing SharePoint approved copies through clickup-integration
 * and never attempts to recreate reviewer-original DOCX files from text.
 */
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const root = path.resolve(__dirname, '..');
const documentRoot = process.env.DOCUMENT_STORAGE_ROOT || path.join(root, 'tmp', 'documents');
const clickupUrl = (process.env.CLICKUP_SERVICE_URL || 'http://localhost:3007').replace(/\/$/, '');
const restore = process.argv.includes('--restore');
const approvedStatuses = new Set(['approved', 'approved_override']);

function isPresent(value) { return `${value || ''}`.trim().length > 0; }
function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}
function slug(value) {
  return `${value || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}
function localExists(filePath) {
  if (!isPresent(filePath)) return false;
  if (fsSync.existsSync(filePath)) return true;
  if (`${filePath}`.startsWith('/app/tmp/documents/')) {
    return fsSync.existsSync(path.join(documentRoot, `${filePath}`.slice('/app/tmp/documents/'.length)));
  }
  return false;
}
function restoredPath(submission) {
  return path.join(documentRoot, slug(submission.property), slug(submission.project_name), submission.id, 'approved', `${submission.id}-approved.docx`);
}

async function loadRecords() {
  if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)) {
    const { createClient } = require('@supabase/supabase-js');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(process.env.SUPABASE_URL, key);
    const { data: submissions, error } = await supabase.from('submissions').select('*').in('status', [...approvedStatuses]);
    if (error) throw new Error(`Failed to read submissions: ${error.message}`);
    const ids = (submissions || []).map((row) => row.id).filter(Boolean);
    const { data: assets, error: assetsError } = ids.length
      ? await supabase.from('assets').select('*').in('submission_id', ids).in('asset_type', ['approved_docx', 'sharepoint_approved_docx'])
      : { data: [], error: null };
    if (assetsError) throw new Error(`Failed to read assets: ${assetsError.message}`);
    return { mode: 'supabase', submissions: submissions || [], assets: assets || [], supabase };
  }

  const dbDir = path.join(root, 'tmp', 'db');
  const submissions = JSON.parse(await fs.readFile(path.join(dbDir, 'submissions.json'), 'utf8'));
  const assets = JSON.parse(await fs.readFile(path.join(dbDir, 'assets.json'), 'utf8'));
  return { mode: 'local-json', submissions: Object.values(submissions), assets, submissionMap: submissions, dbDir };
}

async function restoreSharePointCopy(submission, context, approvedAsset) {
  const response = await fetch(`${clickupUrl}/sharepoint/file?submissionId=${encodeURIComponent(submission.id)}`, {
    headers: { 'x-menumanager-internal-token': process.env.INTERNAL_API_TOKEN || '' },
  });
  if (!response.ok) throw new Error(`SharePoint proxy returned ${response.status}`);
  const target = restoredPath(submission);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));

  if (context.mode === 'supabase') {
    const { error: submissionError } = await context.supabase.from('submissions').update({ final_path: target }).eq('id', submission.id);
    if (submissionError) throw new Error(`submission update failed: ${submissionError.message}`);
    if (approvedAsset?.id) {
      const { error: assetError } = await context.supabase.from('assets').update({ storage_path: target }).eq('id', approvedAsset.id);
      if (assetError) throw new Error(`asset update failed: ${assetError.message}`);
    }
  } else {
    context.submissionMap[submission.id] = { ...context.submissionMap[submission.id], final_path: target };
    if (approvedAsset) approvedAsset.storage_path = target;
  }
  return target;
}

async function main() {
  const context = await loadRecords();
  const bySubmission = new Map();
  for (const asset of context.assets) {
    if (!bySubmission.has(asset.submission_id)) bySubmission.set(asset.submission_id, []);
    bySubmission.get(asset.submission_id).push(asset);
  }
  const totals = { local_ok: 0, sharepoint_copy_exists: 0, regenerable: 0, unrecoverable: 0, restored: 0, failed: 0 };
  console.log(`Auditing ${context.submissions.length} approved submission(s); storage root: ${documentRoot}; mode: ${context.mode}; restore: ${restore}`);

  for (const submission of context.submissions) {
    if (!approvedStatuses.has(`${submission.status || ''}`.toLowerCase())) continue;
    const assets = bySubmission.get(submission.id) || [];
    const approvedAsset = assets.filter((asset) => asset.asset_type === 'approved_docx').sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))[0];
    const sharepointAsset = assets.filter((asset) => asset.asset_type === 'sharepoint_approved_docx').sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))[0];
    const local = localExists(approvedAsset?.storage_path) || localExists(submission.final_path);
    const hasSharePoint = isPresent(sharepointAsset?.storage_path) && isPresent(asObject(sharepointAsset?.meta).drive_id);
    const regenerable = isPresent(submission.approved_menu_content_html) || isPresent(submission.approved_menu_content);
    let status = local ? 'local OK' : hasSharePoint ? 'SharePoint copy exists' : regenerable ? 'regenerable from stored HTML/text' : 'unrecoverable';

    if (local) totals.local_ok += 1;
    else if (hasSharePoint) {
      totals.sharepoint_copy_exists += 1;
      if (restore) {
        try {
          const target = await restoreSharePointCopy(submission, context, approvedAsset);
          totals.restored += 1;
          status += `; restored to ${target}`;
        } catch (error) {
          totals.failed += 1;
          status += `; RESTORE FAILED: ${error.message}`;
        }
      }
    } else if (regenerable) totals.regenerable += 1;
    else totals.unrecoverable += 1;
    console.log(`${submission.id}: ${status}`);
  }

  if (restore && context.mode === 'local-json') {
    await fs.writeFile(path.join(context.dbDir, 'submissions.json'), JSON.stringify(context.submissionMap, null, 2));
    await fs.writeFile(path.join(context.dbDir, 'assets.json'), JSON.stringify(context.assets, null, 2));
  }
  console.log(`Totals: local OK=${totals.local_ok}; SharePoint copy exists=${totals.sharepoint_copy_exists}; regenerable=${totals.regenerable}; unrecoverable=${totals.unrecoverable}; restored=${totals.restored}; failures=${totals.failed}`);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
