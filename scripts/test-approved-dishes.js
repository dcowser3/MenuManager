#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
    path: path.join(__dirname, '..', '.env'),
    quiet: true,
});

const {
    getSupabaseClient,
    previewDishExtraction,
    extractAndStoreDishes,
} = require('../services/supabase-client/dist/index.js');

function parseArgs(argv) {
    const options = {
        id: '',
        legacyId: '',
        write: false,
        approvedOnly: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--id') {
            options.id = `${argv[i + 1] || ''}`.trim();
            i += 1;
            continue;
        }
        if (arg === '--legacy-id') {
            options.legacyId = `${argv[i + 1] || ''}`.trim();
            i += 1;
            continue;
        }
        if (arg === '--write') {
            options.write = true;
            continue;
        }
        if (arg === '--approved-only') {
            options.approvedOnly = true;
        }
    }

    return options;
}

function usage() {
    console.error(
        'Usage: node scripts/test-approved-dishes.js (--id <uuid> | --legacy-id <legacy-id>) [--write] [--approved-only]'
    );
}

async function loadSubmission(supabase, options) {
    if (options.id) {
        const { data, error } = await supabase
            .from('submissions')
            .select('id, legacy_id, status, property, service_period, approved_menu_content, menu_content')
            .eq('id', options.id)
            .maybeSingle();
        if (error) throw new Error(`Failed to load submission by id: ${error.message}`);
        return data;
    }

    const { data, error } = await supabase
        .from('submissions')
        .select('id, legacy_id, status, property, service_period, approved_menu_content, menu_content')
        .eq('legacy_id', options.legacyId)
        .maybeSingle();
    if (error) throw new Error(`Failed to load submission by legacy id: ${error.message}`);
    return data;
}

function resolveMenuText(submission, approvedOnly) {
    const approvedText = `${submission?.approved_menu_content || ''}`.trim();
    if (approvedOnly) {
        return approvedText;
    }
    return approvedText || `${submission?.menu_content || ''}`.trim();
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if ((!options.id && !options.legacyId) || (options.id && options.legacyId)) {
        usage();
        process.exit(1);
    }

    const supabase = getSupabaseClient();
    const submission = await loadSubmission(supabase, options);
    if (!submission) {
        throw new Error('Submission not found');
    }

    const menuText = resolveMenuText(submission, options.approvedOnly);
    if (!menuText) {
        throw new Error('No menu content available for extraction');
    }

    const preview = previewDishExtraction(menuText);
    const before = await supabase
        .from('approved_dishes')
        .select('id', { count: 'exact', head: true })
        .eq('source_submission_id', submission.id);
    if (before.error) {
        throw new Error(`Failed to count approved dishes before test: ${before.error.message}`);
    }

    const summary = {
        submission_id: submission.id,
        legacy_id: submission.legacy_id || null,
        status: submission.status || null,
        property: submission.property || null,
        service_period: submission.service_period || null,
        approved_only: options.approvedOnly,
        write: options.write,
        text_length: menuText.length,
        extracted_count: preview.length,
        before_count: before.count || 0,
        preview: preview.slice(0, 10),
    };

    if (!options.write) {
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    const result = await extractAndStoreDishes(
        menuText,
        submission.property || 'Unknown',
        submission.id,
        { servicePeriod: submission.service_period || undefined }
    );

    const after = await supabase
        .from('approved_dishes')
        .select('id', { count: 'exact', head: true })
        .eq('source_submission_id', submission.id);
    if (after.error) {
        throw new Error(`Failed to count approved dishes after test: ${after.error.message}`);
    }

    console.log(JSON.stringify({
        ...summary,
        added: result.added,
        after_count: after.count || 0,
    }, null, 2));
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
