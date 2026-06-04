#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
    path: path.join(__dirname, '..', '..', '..', '.env'),
    quiet: true,
});

const {
    runApprovedDishRepair,
} = require('@menumanager/supabase-client');

function parseListValue(value) {
    return `${value || ''}`
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseArgs(argv) {
    const options = {
        apply: false,
        all: false,
        property: '',
        brand: '',
        sourceSubmissionIds: [],
        legacyIds: [],
        includeClean: false,
        maxCountDropRatio: undefined,
        limit: 0,
        report: '',
        help: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--apply') {
            options.apply = true;
            continue;
        }
        if (arg === '--all') {
            options.all = true;
            continue;
        }
        if (arg === '--include-clean') {
            options.includeClean = true;
            continue;
        }
        if (arg === '--property') {
            options.property = `${argv[index + 1] || ''}`.trim();
            index += 1;
            continue;
        }
        if (arg === '--brand') {
            options.brand = `${argv[index + 1] || ''}`.trim();
            index += 1;
            continue;
        }
        if (arg === '--source-submission-id' || arg === '--id') {
            options.sourceSubmissionIds.push(...parseListValue(argv[index + 1]));
            index += 1;
            continue;
        }
        if (arg === '--legacy-id') {
            options.legacyIds.push(...parseListValue(argv[index + 1]));
            index += 1;
            continue;
        }
        if (arg === '--limit') {
            options.limit = Number.parseInt(argv[index + 1], 10) || 0;
            index += 1;
            continue;
        }
        if (arg === '--max-count-drop-ratio') {
            const parsed = Number.parseFloat(argv[index + 1]);
            options.maxCountDropRatio = Number.isFinite(parsed) ? parsed : undefined;
            index += 1;
            continue;
        }
        if (arg === '--report') {
            options.report = `${argv[index + 1] || ''}`.trim();
            index += 1;
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    options.sourceSubmissionIds = Array.from(new Set(options.sourceSubmissionIds));
    options.legacyIds = Array.from(new Set(options.legacyIds));

    return options;
}

function usage() {
    console.error([
        'Usage: npm run repair:approved-dishes -- (--all | --brand <name> | --property <name> | --source-submission-id <uuid> | --legacy-id <id>) [options]',
        '',
        'Options:',
        '  --apply                         Write eligible repairs. Default is dry-run only.',
        '  --all                           Scan every active source submission with approved dishes.',
        '  --brand <name>                   Limit by derived brand, e.g. "Tamayo" or "Toro".',
        '  --property <name>                Limit by full property, e.g. "Tamayo - Denver".',
        '  --source-submission-id <uuid>    Limit to one or more submission UUIDs. Comma-separated is allowed.',
        '  --legacy-id <id>                 Limit to one or more legacy submission ids. Comma-separated is allowed.',
        '  --include-clean                  Allow changed clean rows even when no quality metric improves.',
        '  --max-count-drop-ratio <number>  Safety cap for row-count drops. Default: 0.7.',
        '  --limit <n>                      Scan only the first n matching source submissions.',
        '  --report <path>                  Write JSON report to this path.',
    ].join('\n'));
}

function hasScope(options) {
    return options.all ||
        Boolean(options.property) ||
        Boolean(options.brand) ||
        options.sourceSubmissionIds.length > 0 ||
        options.legacyIds.length > 0;
}

function defaultReportPath() {
    return path.join(
        __dirname,
        '..',
        '..',
        '..',
        'tmp',
        'reports',
        `approved-dish-repair-${Date.now()}.json`
    );
}

function buildRunOptions(options) {
    const runOptions = {
        apply: options.apply,
        includeClean: options.includeClean,
        sourceSubmissionIds: options.sourceSubmissionIds,
        legacyIds: options.legacyIds,
        limit: options.limit,
    };
    if (options.property) runOptions.property = options.property;
    if (options.brand) runOptions.brand = options.brand;
    if (options.maxCountDropRatio !== undefined) {
        runOptions.maxCountDropRatio = options.maxCountDropRatio;
    }
    return runOptions;
}

function logSummary(report, reportPath) {
    const summary = report.summary;
    console.log(JSON.stringify({
        mode: report.mode,
        scanned_submissions: summary.scannedSubmissions,
        eligible: summary.eligible,
        applied: summary.applied,
        skipped: summary.skipped,
        failed: summary.failed,
        before_rows: summary.beforeRows,
        after_rows: summary.afterRows,
        before_high_or_exclude_rows: summary.beforeHighOrExcludeRows,
        after_high_or_exclude_rows: summary.afterHighOrExcludeRows,
        before_blank_description_rows: summary.beforeBlankDescriptionRows,
        after_blank_description_rows: summary.afterBlankDescriptionRows,
        report: reportPath,
    }, null, 2));

    const interesting = report.candidates
        .filter((candidate) => candidate.status === 'eligible' || candidate.status === 'applied' || candidate.status === 'failed')
        .slice(0, 20)
        .map((candidate) => ({
            status: candidate.status,
            property: candidate.property,
            service_period: candidate.servicePeriod,
            filename: candidate.filename,
            source_submission_id: candidate.sourceSubmissionId,
            before_rows: candidate.beforeCount,
            after_rows: candidate.afterCount,
            before_high_or_exclude_rows: candidate.before.highOrExcludeRows,
            after_high_or_exclude_rows: candidate.after.highOrExcludeRows,
            reason: candidate.reason,
        }));

    if (interesting.length > 0) {
        console.log('\nFirst eligible/applied/failed candidates:');
        console.log(JSON.stringify(interesting, null, 2));
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        usage();
        return;
    }
    if (!hasScope(options)) {
        usage();
        process.exitCode = 1;
        return;
    }

    const report = await runApprovedDishRepair(buildRunOptions(options));
    const reportPath = path.resolve(options.report || defaultReportPath());
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    logSummary(report, reportPath);
}

main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
});
