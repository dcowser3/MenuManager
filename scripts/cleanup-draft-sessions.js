#!/usr/bin/env node
/* Keep the newest active draft per baseline before applying the partial unique index.
 * Uses the local JSON fallback and, when configured, performs the same update in Supabase. */
const fs = require('fs/promises');
const path = require('path');
const { isSupabaseConfigured, getSupabaseClient } = require('../services/supabase-client/dist');

function newestFirst(a, b) {
  return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
}
function cleanup(rows) {
  const byBase = new Map();
  for (const row of rows) {
    if (row.status !== 'active' || !row.base_submission_id) continue;
    const list = byBase.get(row.base_submission_id) || [];
    list.push(row); byBase.set(row.base_submission_id, list);
  }
  return [...byBase.values()].flatMap((group) => group.sort(newestFirst).slice(1));
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const localPath = path.join(root, 'tmp', 'db', 'draft_sessions.json');
  let local = {};
  try { local = JSON.parse(await fs.readFile(localPath, 'utf8')); } catch { /* no local fallback yet */ }
  const localDiscarded = cleanup(Object.values(local));
  for (const draft of localDiscarded) local[draft.id].status = 'discarded';
  if (localDiscarded.length) await fs.writeFile(localPath, JSON.stringify(local, null, 2));

  let remoteCount = 0;
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('draft_sessions').select('*').eq('status', 'active');
    if (error) throw new Error(error.message);
    const discarded = cleanup(data || []);
    for (const draft of discarded) {
      const { error: updateError } = await supabase.from('draft_sessions')
        .update({ status: 'discarded', updated_at: new Date().toISOString() }).eq('id', draft.id);
      if (updateError) throw new Error(updateError.message);
    }
    remoteCount = discarded.length;
  }
  console.log(`Discarded ${localDiscarded.length} local and ${remoteCount} Supabase duplicate active draft(s).`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
