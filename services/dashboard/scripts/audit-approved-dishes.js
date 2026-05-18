#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { getSupabaseClient } = require('@menumanager/supabase-client');

dotenv.config({ path: path.resolve(__dirname, '../../..', '.env'), quiet: true });

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), '../../tmp/clickup-history-import');
const DEFAULT_SOURCE = 'clickup_history_import';
const PAGE_SIZE = 1000;
const SUBMISSION_BATCH_SIZE = 75;

const CATEGORY_WORDS = new Set([
    'a la carte',
    'appetizer',
    'appetizers',
    'beverage',
    'beverages',
    'breakfast',
    'brunch',
    'cocktail',
    'cocktails',
    'dessert',
    'desserts',
    'dinner',
    'entree',
    'entrees',
    'for the table',
    'happy hour',
    'kids',
    'lunch',
    'main',
    'mains',
    'raw bar',
    'salad',
    'salads',
    'side',
    'sides',
    'starter',
    'starters',
    'taco',
    'tacos',
    'wine',
    'wines',
    'signature cocktails',
    'specialty cocktails',
    'soup and salads',
]);

function parseArgs(argv) {
    const options = {
        source: DEFAULT_SOURCE,
        status: 'approved',
        outputDir: DEFAULT_OUTPUT_DIR,
        reportPath: '',
        limit: 0,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--source') {
            options.source = `${argv[index + 1] || ''}`.trim() || DEFAULT_SOURCE;
            index += 1;
        } else if (arg === '--status') {
            options.status = `${argv[index + 1] || ''}`.trim() || 'approved';
            index += 1;
        } else if (arg === '--output-dir') {
            options.outputDir = path.resolve(argv[index + 1] || DEFAULT_OUTPUT_DIR);
            index += 1;
        } else if (arg === '--report') {
            options.reportPath = path.resolve(argv[index + 1] || '');
            index += 1;
        } else if (arg === '--limit') {
            options.limit = Math.max(Number(argv[index + 1] || 0), 0);
            index += 1;
        } else if (arg === '--help' || arg === '-h') {
            usage();
            process.exit(0);
        }
    }

    if (!options.reportPath) {
        options.reportPath = path.join(options.outputDir, 'completed-dry-run.json');
    }

    return options;
}

function usage() {
    console.log(`Usage: node scripts/audit-approved-dishes.js [options]

Audits imported approved_dishes rows for likely extraction mistakes. This script is read-only.

Options:
  --source <source>       Submission source to audit (default: clickup_history_import)
  --status <status>       Submission status to audit (default: approved)
  --limit <n>             Limit submissions for a small probe (default: all)
  --output-dir <path>     Output directory (default: ../../tmp/clickup-history-import)
  --report <path>         Completed dry-run JSON for ClickUp context
`);
}

function normalizeText(value) {
    return `${value || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[_/]+/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function compactText(value) {
    return `${value || ''}`.replace(/\s+/g, ' ').trim();
}

function csvEscape(value) {
    const text = Array.isArray(value) ? value.join('; ') : `${value ?? ''}`;
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

async function fetchAll(queryBuilder, limit = 0) {
    const rows = [];
    let from = 0;

    while (true) {
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await queryBuilder().range(from, to);
        if (error) {
            throw new Error(error.message);
        }

        const page = data || [];
        rows.push(...page);

        if (page.length < PAGE_SIZE || (limit > 0 && rows.length >= limit)) {
            break;
        }
        from += PAGE_SIZE;
    }

    return limit > 0 ? rows.slice(0, limit) : rows;
}

async function loadImportedSubmissions(supabase, options) {
    return fetchAll(
        () => supabase
            .from('submissions')
            .select([
                'id',
                'legacy_id',
                'clickup_task_id',
                'project_name',
                'property',
                'service_period',
                'filename',
                'source',
                'status',
                'approved_menu_content',
                'menu_content',
                'raw_payload',
            ].join(','))
            .eq('source', options.source)
            .eq('status', options.status)
            .order('property', { ascending: true })
            .order('service_period', { ascending: true }),
        options.limit
    );
}

async function loadApprovedDishes(supabase, submissionIds) {
    const rows = [];

    for (let index = 0; index < submissionIds.length; index += SUBMISSION_BATCH_SIZE) {
        const batch = submissionIds.slice(index, index + SUBMISSION_BATCH_SIZE);
        let from = 0;

        while (true) {
            const { data, error } = await supabase
                .from('approved_dishes')
                .select([
                    'id',
                    'dish_name',
                    'dish_name_normalized',
                    'property',
                    'service_period',
                    'menu_category',
                    'description',
                    'price',
                    'allergens',
                    'source_submission_id',
                    'created_at',
                ].join(','))
                .in('source_submission_id', batch)
                .order('property', { ascending: true })
                .order('service_period', { ascending: true })
                .order('menu_category', { ascending: true })
                .order('dish_name', { ascending: true })
                .range(from, from + PAGE_SIZE - 1);

            if (error) {
                throw new Error(`Failed to load approved_dishes: ${error.message}`);
            }

            const page = data || [];
            rows.push(...page);
            if (page.length < PAGE_SIZE) {
                break;
            }
            from += PAGE_SIZE;
        }
    }

    return rows;
}

async function loadDryRunRows(reportPath) {
    try {
        const raw = await fs.promises.readFile(reportPath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.rows) ? parsed.rows : [];
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw new Error(`Failed to read ${reportPath}: ${error.message}`);
    }
}

function buildSourceRowLookup(rows) {
    const lookup = new Map();

    for (const row of rows) {
        for (const key of [
            row.importedSubmissionId,
            row.taskId,
            row.taskId ? `clickup-${row.taskId}` : '',
        ]) {
            if (key) {
                lookup.set(key, row);
            }
        }
    }

    return lookup;
}

function sourceRowForSubmission(submission, lookup) {
    return lookup.get(submission.id)
        || lookup.get(submission.clickup_task_id)
        || lookup.get(submission.legacy_id)
        || null;
}

function getClickUpContext(submission, sourceRow) {
    const payload = submission.raw_payload?.clickupHistoryImport || {};
    return {
        taskId: sourceRow?.taskId || payload.taskId || submission.clickup_task_id || '',
        taskName: sourceRow?.taskName || payload.taskName || submission.project_name || '',
        taskUrl: sourceRow?.taskUrl || payload.taskUrl || '',
        docxAttachmentName: sourceRow?.docxAttachmentName || payload.docxAttachmentName || submission.filename || '',
    };
}

function addIssue(issues, code, severity, reason) {
    issues.push({ code, severity, reason });
}

function hasPriceToken(value) {
    return /(?:[$€£]\s*\d|\(\s*[$€£]?\d+(?:,\d{3})*(?:\.\d{2})?\s*\)|\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:pp|per person|per guest)\b)/i
        .test(`${value || ''}`);
}

function hasMenuPriceToken(value) {
    return /(?:[$€£]\s*)?\d+(?:,\d{3})*(?:\.\d{1,2})?\s*(?:pp|per person|per guest|@person|per table|minimum order)|(?:price|prix[-\s]*fix(?:e|ed)?)\s*(?:[$€£]\s*)?\d+(?:,\d{3})*(?:\.\d{1,2})?/i
        .test(`${value || ''}`);
}

function hasAnyPriceToken(value) {
    return /(?:[$€£]\s*)?\d+(?:,\d{3})*(?:\.\d{1,2})?(?:\s*\/\s*(?:[$€£]\s*)?\d+(?:,\d{3})*(?:\.\d{1,2})?)*\s*$|\b(?:GL|BTL)\s*\d/i
        .test(`${value || ''}`);
}

function isPriceOnlyLine(value) {
    const text = compactText(value);
    return /^\(?\s*\d+\s*(?:calories|cals?)?\s*\)?\s*(?:[$€£]?\s*)?\d+(?:,\d{3})*(?:\.\d{1,2})?\s*$/i.test(text)
        || /^(?:[$€£]\s*)?\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(text);
}

function isInstructionLike(value) {
    return /^(served for the table|host chooses?|choose \d+|select (?:one|two|three|\d+)|choice of|crafted by|created by|cocktails? creations? by|missing description|separate value|raw protein|allergen[-\s]|allergen key|chef'?s selection|please add to all menus|existing menu edits|new menu development)/i
        .test(compactText(value));
}

function isTimeOrSchedule(value) {
    const text = compactText(value);
    return /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(text)
        || /\b\d{1,2}\s*(?:-|–|—|to)\s*\d{1,2}\s*(?:am|pm)\b/i.test(text)
        || /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)
        || /\b(mon|tue|wed|thu|fri|sat|sun)(?:day)?\s*(?:-|–|—|to)\s*(mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/i.test(text);
}

function isPackageOrCourseLabel(value) {
    const text = compactText(value);
    return /^(?:\d+|one|two|three|four|five)\s+courses?\b/i.test(text)
        || /^\d+(?:st|nd|rd|th)\s+course\b/i.test(text)
        || /^\d+\s+tacos?\s+per\s+order\b/i.test(text)
        || /^\d+\s*(?:oz|gr)\s+with\s+\d+\s+sides?\b/i.test(text)
        || /^\d+\s*(?:piece|pc|pcs)\b/i.test(text);
}

function isModifierRow(value) {
    return /^(add|adds|additions?|enhancements?|option to add|substitute|make it)\b/i.test(compactText(value));
}

function looksLikeCategory(value) {
    const normalized = normalizeText(value);
    if (CATEGORY_WORDS.has(normalized)) {
        return true;
    }
    return /\bstation$/.test(normalized);
}

function looksIngredientLikeOneWord(name, description) {
    const trimmed = compactText(name);
    return /^[a-z][a-z-]+$/.test(trimmed)
        && !/[()]/.test(trimmed)
        && compactText(description).length > 0
        && trimmed.length <= 18;
}

function hasAllergenCluster(value) {
    return /(?:^|[\s,*])\*?(?:C|D|E|G|M|N|P|PN|S|SE|SL|SS|SY|TN|V|VG)(?:\s*,\s*(?:C|D|E|G|M|N|P|PN|S|SE|SL|SS|SY|TN|V|VG)){1,}(?:$|[\s,.])/i
        .test(`${value || ''}`);
}

function findContextDetails(menuText, dish) {
    const lines = `${menuText || ''}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
        return { context: '', line: '', previousLine: '', nextLine: '', index: -1, lines };
    }

    const candidates = [
        compactText(dish.dish_name),
        compactText(dish.description).split(/\s+/).slice(0, 5).join(' '),
    ].filter((candidate) => candidate.length >= 4);

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeText(candidate);
        const index = lines.findIndex((line) => normalizeText(line).includes(normalizedCandidate));
        if (index >= 0) {
            return {
                context: lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).join(' | '),
                line: lines[index] || '',
                previousLine: lines[index - 1] || '',
                nextLine: lines[index + 1] || '',
                index,
                lines,
            };
        }
    }

    return { context: '', line: '', previousLine: '', nextLine: '', index: -1, lines };
}

function findContext(menuText, dish) {
    return findContextDetails(menuText, dish).context;
}

function classifyMissingPrice(dish, submission, contextDetails) {
    if (compactText(dish.price)) {
        return { price_audit_class: 'has_price', nearby_price_text: '' };
    }

    const line = contextDetails.line || '';
    const nextLine = contextDetails.nextLine || '';
    const nearby = contextDetails.index >= 0
        ? contextDetails.lines.slice(Math.max(0, contextDetails.index - 4), Math.min(contextDetails.lines.length, contextDetails.index + 5))
        : [];

    if (line && hasAnyPriceToken(line)) {
        return { price_audit_class: 'price_visible_same_line', nearby_price_text: line };
    }

    if (nextLine && (hasAnyPriceToken(nextLine) || isPriceOnlyLine(nextLine))) {
        return { price_audit_class: 'price_visible_next_line', nearby_price_text: nextLine };
    }

    const menuPriceLine = nearby.find(hasMenuPriceToken);
    if (menuPriceLine) {
        return { price_audit_class: 'menu_or_package_price_nearby', nearby_price_text: menuPriceLine };
    }

    if (/\b(?:prix|fixe|package|event|half board|set menu|brunch|valentine|nye|new year|christmas|thanksgiving|ramadan|sakura|hanagasumi|hasakura)\b/i.test(`${submission?.service_period || ''} ${submission?.project_name || ''} ${dish.menu_category || ''}`)) {
        return { price_audit_class: 'likely_set_menu_no_item_price', nearby_price_text: '' };
    }

    if (!contextDetails.context) {
        return { price_audit_class: 'source_context_not_found', nearby_price_text: '' };
    }

    return { price_audit_class: 'no_price_visible_nearby', nearby_price_text: '' };
}

function analyzeDish(dish, submission, duplicateCounts) {
    const issues = [];
    const name = compactText(dish.dish_name);
    const category = compactText(dish.menu_category);
    const description = compactText(dish.description);
    const normalizedName = normalizeText(name);
    const normalizedCategory = normalizeText(category);

    if (hasPriceToken(name)) {
        addIssue(issues, 'name_contains_price', 'high', 'Price token is still part of dish_name.');
    }
    if (!compactText(dish.price)) {
        addIssue(issues, 'missing_price', 'medium', 'Dish has no extracted price.');
    }
    if (isInstructionLike(name)) {
        addIssue(issues, 'instruction_text_name', 'high', 'Dish name looks like menu instructions or attribution.');
    }
    if (isInstructionLike(category)) {
        addIssue(issues, 'instruction_text_category', 'medium', 'Menu category looks like instructions or placeholder text.');
    }
    if (isTimeOrSchedule(name)) {
        addIssue(issues, 'time_or_schedule_name', 'high', 'Dish name looks like service hours or a schedule.');
    }
    if (isPackageOrCourseLabel(name)) {
        addIssue(issues, 'package_or_course_label', 'high', 'Dish name looks like a package/course/count label.');
    }
    if (isModifierRow(name)) {
        addIssue(issues, 'modifier_row_name', 'medium', 'Dish name looks like a modifier rather than a standalone item.');
    }
    if (normalizedName && normalizedName === normalizedCategory) {
        addIssue(issues, 'name_equals_category', 'medium', 'Dish name is identical to menu_category.');
    } else if (looksLikeCategory(name)) {
        addIssue(issues, 'category_as_name', 'medium', 'Dish name looks like a section heading.');
    }
    if (/missing description/i.test(category)) {
        addIssue(issues, 'placeholder_category', 'medium', 'Menu category is placeholder text.');
    }
    if (looksIngredientLikeOneWord(name, description)) {
        addIssue(issues, 'ingredient_like_one_word', 'medium', 'One-word lowercase name with a description may be a wrapped ingredient.');
    }
    if (/^kale$/i.test(name) && /salads?/i.test(category)) {
        addIssue(issues, 'salad_name_missing_category_hint', 'medium', 'Terse salad name should usually be enriched as Kale (Salad).');
    }
    if (hasAllergenCluster(description)) {
        addIssue(issues, 'description_contains_allergen_cluster', 'medium', 'Description still appears to contain allergen codes.');
    }

    const duplicateKey = [
        dish.source_submission_id,
        normalizedName,
        normalizedCategory,
        normalizeText(description),
        compactText(dish.price),
    ].join('|');
    if ((duplicateCounts.get(duplicateKey) || 0) > 1) {
        addIssue(issues, 'duplicate_within_submission', 'info', 'Same dish/category/description appears more than once in this submission.');
    }

    if (!name) {
        addIssue(issues, 'missing_name', 'high', 'Dish row has no name.');
    }
    if (!submission?.id) {
        addIssue(issues, 'missing_source_submission', 'high', 'Dish row is not tied to a loaded imported submission.');
    }

    return issues;
}

function countDuplicates(dishes) {
    const counts = new Map();
    for (const dish of dishes) {
        const key = [
            dish.source_submission_id,
            normalizeText(dish.dish_name),
            normalizeText(dish.menu_category),
            normalizeText(dish.description),
            compactText(dish.price),
        ].join('|');
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function highestSeverity(issues) {
    const order = new Map([['high', 3], ['medium', 2], ['info', 1]]);
    return issues.reduce((highest, issue) => {
        return (order.get(issue.severity) || 0) > (order.get(highest) || 0) ? issue.severity : highest;
    }, 'info');
}

function summarize(flaggedRows, submissions, dishes) {
    const bySeverity = {};
    const byIssueCode = {};
    const byPriceAuditClass = {};

    for (const row of flaggedRows) {
        bySeverity[row.severity] = (bySeverity[row.severity] || 0) + 1;
        for (const code of row.issue_codes) {
            byIssueCode[code] = (byIssueCode[code] || 0) + 1;
        }
        if (row.issue_codes.includes('missing_price')) {
            byPriceAuditClass[row.price_audit_class] = (byPriceAuditClass[row.price_audit_class] || 0) + 1;
        }
    }

    return {
        generatedAt: new Date().toISOString(),
        auditedSubmissions: submissions.length,
        auditedDishes: dishes.length,
        flaggedRows: flaggedRows.length,
        bySeverity,
        byIssueCode,
        byPriceAuditClass,
    };
}

async function writeOutputs(outputDir, flaggedRows, summary) {
    await fs.promises.mkdir(outputDir, { recursive: true });
    const jsonPath = path.join(outputDir, 'dish-extraction-audit.json');
    const csvPath = path.join(outputDir, 'dish-extraction-audit.csv');

    await fs.promises.writeFile(jsonPath, JSON.stringify({ summary, flaggedRows }, null, 2));

    const columns = [
        'severity',
        'issue_codes',
        'issue_reasons',
        'price_audit_class',
        'nearby_price_text',
        'property',
        'service_period',
        'dish_name',
        'menu_category',
        'description',
        'price',
        'source_submission_id',
        'clickup_task_id',
        'task_name',
        'task_url',
        'docx_attachment_name',
        'source_line',
        'previous_line',
        'next_line',
        'context',
    ];

    const csv = [
        columns.join(','),
        ...flaggedRows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
    ].join('\n');

    await fs.promises.writeFile(csvPath, csv);
    return { jsonPath, csvPath };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const supabase = getSupabaseClient();
    const dryRunRows = await loadDryRunRows(options.reportPath);
    const sourceLookup = buildSourceRowLookup(dryRunRows);

    console.log(`Loading ${options.source} submissions from Supabase...`);
    const submissions = await loadImportedSubmissions(supabase, options);
    const submissionsById = new Map(submissions.map((submission) => [submission.id, submission]));
    console.log(`Loaded ${submissions.length} submission(s).`);

    const dishes = submissions.length > 0
        ? await loadApprovedDishes(supabase, submissions.map((submission) => submission.id))
        : [];
    console.log(`Loaded ${dishes.length} approved dish row(s).`);

    const duplicateCounts = countDuplicates(dishes);
    const flaggedRows = [];

    for (const dish of dishes) {
        const submission = submissionsById.get(dish.source_submission_id);
        const sourceRow = submission ? sourceRowForSubmission(submission, sourceLookup) : null;
        const issues = analyzeDish(dish, submission, duplicateCounts);
        if (issues.length === 0) {
            continue;
        }

        const clickup = submission ? getClickUpContext(submission, sourceRow) : {};
        const sourceMenuText = sourceRow?.approvedMenuContent || submission?.approved_menu_content || submission?.menu_content || '';
        const contextDetails = findContextDetails(sourceMenuText, dish);
        const priceAudit = classifyMissingPrice(dish, submission, contextDetails);
        flaggedRows.push({
            severity: highestSeverity(issues),
            issue_codes: issues.map((issue) => issue.code),
            issue_reasons: issues.map((issue) => issue.reason),
            price_audit_class: priceAudit.price_audit_class,
            nearby_price_text: priceAudit.nearby_price_text,
            property: dish.property || submission?.property || '',
            service_period: dish.service_period || submission?.service_period || '',
            dish_name: dish.dish_name || '',
            menu_category: dish.menu_category || '',
            description: dish.description || '',
            price: dish.price || '',
            source_submission_id: dish.source_submission_id || '',
            clickup_task_id: clickup.taskId || '',
            task_name: clickup.taskName || '',
            task_url: clickup.taskUrl || '',
            docx_attachment_name: clickup.docxAttachmentName || '',
            source_line: contextDetails.line,
            previous_line: contextDetails.previousLine,
            next_line: contextDetails.nextLine,
            context: contextDetails.context,
        });
    }

    flaggedRows.sort((a, b) => {
        const order = { high: 0, medium: 1, info: 2 };
        return (order[a.severity] - order[b.severity])
            || a.property.localeCompare(b.property)
            || a.service_period.localeCompare(b.service_period)
            || a.dish_name.localeCompare(b.dish_name);
    });

    const summary = summarize(flaggedRows, submissions, dishes);
    const outputs = await writeOutputs(options.outputDir, flaggedRows, summary);

    console.log(JSON.stringify(summary, null, 2));
    console.log(`Wrote ${outputs.jsonPath}`);
    console.log(`Wrote ${outputs.csvPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
