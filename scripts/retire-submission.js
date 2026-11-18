#!/usr/bin/env node
/**
 * Supported way to retire a bad submission (status -> 'deleted') AND move its
 * menu's current-version pointer back in the same run. Setting status by hand
 * leaves menus.current_submission_id on a deleted row (2026-11-16 incident).
 *
 * Dry run by default: prints what would change and writes nothing.
 *
 * Usage:
 *   node scripts/retire-submission.js <submission id (legacy or uuid)> [more ids...]
 *   node scripts/retire-submission.js <ids...> --apply     # writes; backup saved to tmp/
 *
 * Writes are guarded (status / pointer must still match what was planned), so a
 * concurrent change makes the update a no-op instead of overwriting it.
 * See docs/design-docs/draft-concurrency-and-lineage.md ("Retiring a submission").
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const { requireSupabaseServiceKey } = require('./lib/supabase-key');
const { planRetirement, publicId } = require('./lib/submission-retirement');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadSubmission(supabase, id) {
    const column = UUID_REGEX.test(id) ? 'id' : 'legacy_id';
    const { data, error } = await supabase.from('submissions').select('*').eq(column, id).maybeSingle();
    if (error) throw new Error(`Failed to load ${id}: ${error.message}`);
    return data;
}

async function main() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const ids = args.filter((arg) => !arg.startsWith('--'));
    if (!ids.length) {
        console.error('Usage: node scripts/retire-submission.js <submission id> [more ids...] [--apply]');
        process.exit(2);
    }

    const supabase = createClient(process.env.SUPABASE_URL, requireSupabaseServiceKey(process.env));
    const plans = [];
    for (const id of ids) {
        const submission = await loadSubmission(supabase, id);
        if (!submission) throw new Error(`Submission ${id} not found. Nothing changed.`);
        let menu = null;
        let menuVersions = [];
        if (submission.menu_id) {
            const menuResult = await supabase.from('menus').select('*').eq('id', submission.menu_id).maybeSingle();
            if (menuResult.error) throw new Error(menuResult.error.message);
            menu = menuResult.data;
            const versions = await supabase.from('submissions').select('*').eq('menu_id', submission.menu_id);
            if (versions.error) throw new Error(versions.error.message);
            menuVersions = versions.data || [];
        }
        const plan = planRetirement({ submission, menu, menuVersions });
        plans.push({ submission, menu, plan });
        console.log(`\n${publicId(submission)} | ${submission.project_name || ''} | ${submission.property || ''} | status=${submission.status}`);
        console.log(`  submission: ${plan.submissionUpdate ? `status ${plan.submissionUpdate.expectedStatus} -> deleted` : 'no change'}`);
        plan.notes.forEach((note) => console.log(`  ${note}`));
    }

    if (!apply) {
        console.log('\nDry run only. Re-run with --apply to write the changes above.');
        return;
    }

    const backup = path.resolve(__dirname, '..', 'tmp', `retire-submission-backup-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.writeFileSync(backup, JSON.stringify(plans.map(({ submission, menu }) => ({ submission, menu })), null, 2));
    console.log(`\nBackup written to ${backup}`);

    for (const { submission, plan } of plans) {
        if (plan.submissionUpdate) {
            const { expectedStatus, ...update } = plan.submissionUpdate;
            const result = await supabase.from('submissions').update(update)
                .eq('id', submission.id).eq('status', submission.status).select('id,legacy_id,status');
            if (result.error) throw new Error(result.error.message);
            console.log(`${publicId(submission)}: ${result.data.length ? 'retired' : 'skipped (status changed concurrently)'}`);
        }
        if (plan.menuUpdate) {
            const { menuId, expectedPointer, ...update } = plan.menuUpdate;
            const result = await supabase.from('menus').update(update)
                .eq('id', menuId).eq('current_submission_id', expectedPointer).select('id,current_submission_id');
            if (result.error) throw new Error(result.error.message);
            console.log(`menu ${menuId}: ${result.data.length ? `pointer -> ${update.current_submission_id || 'none'}` : 'skipped (pointer changed concurrently)'}`);
        }
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
