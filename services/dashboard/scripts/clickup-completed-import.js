#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const { promisify } = require('util');
const axios = require('axios');
const dotenv = require('dotenv');
const {
    createDishes,
    getSupabaseClient,
    normalizeDishPriceForStorage,
    previewDishExtraction,
} = require('@menumanager/supabase-client');

dotenv.config({ path: path.resolve(__dirname, '../../..', '.env'), quiet: true });

const execFileAsync = promisify(execFile);

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), '../../tmp/clickup-history-import');
const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';
const DESIGN_WORDS = [
    'rsh',
    'design',
    'development',
    'develop',
    'update',
    'updates',
    'brief',
    'food',
    'beverage',
    'drink',
    'drinks',
    'bar',
    'menu',
    'menus',
    'approved',
    'final',
    'docx',
    'pdf',
];

const SERVICE_PATTERNS = [
    { pattern: /\bladies?\s+night\b/i, label: 'Ladies Night' },
    { pattern: /\bbreakfast\b/i, label: 'Breakfast' },
    { pattern: /\bbrunch\b/i, label: 'Brunch' },
    { pattern: /\blunch\b/i, label: 'Lunch' },
    { pattern: /\bdinner\b/i, label: 'Dinner' },
    { pattern: /\bdesserts?\b/i, label: 'Dessert' },
    { pattern: /\bkids?\b/i, label: 'Kids' },
    { pattern: /\bhappy\s+hour\b/i, label: 'Happy Hour' },
    { pattern: /\bwine\b/i, label: 'Wine' },
    { pattern: /\bcocktails?\b/i, label: 'Cocktail' },
    { pattern: /\bbeverages?\b/i, label: 'Beverage' },
    { pattern: /\bset\s+menu\b/i, label: 'Set Menu' },
    { pattern: /\btaco\s+tuesday\b/i, label: 'Taco Tuesday' },
    { pattern: /\bmother'?s\s+day\b/i, label: "Mother's Day" },
    { pattern: /\beaster\b/i, label: 'Easter' },
    { pattern: /\bcinco\s+de\s+mayo\b/i, label: 'Cinco de Mayo' },
    { pattern: /\bvalentine'?s?\b/i, label: "Valentine's" },
];
const SERVICE_CONFLICT_PATTERNS = [
    { pattern: /\bbreakfast\b/i, family: 'breakfast' },
    { pattern: /\bbrunch\b/i, family: 'brunch' },
    { pattern: /\blunch\b/i, family: 'lunch' },
    { pattern: /\bdinner\b/i, family: 'dinner' },
    { pattern: /\bdesserts?\b/i, family: 'dessert' },
    { pattern: /\bkids?\b/i, family: 'kids' },
    { pattern: /\bhappy\s+hour\b/i, family: 'happy_hour' },
    { pattern: /\b(?:wine|cocktails?|beverages?|drinks?|bar)\b/i, family: 'drinks' },
];

const CITY_ALIASES = new Map([
    ['washington d c', ['dc', 'd c', 'washington dc']],
    ['new york', ['nyc', 'new york']],
    ['dubai', ['dxb', 'dubai']],
    ['fort worth', ['fw', 'fort worth']],
    ['los cabos', ['cabo', 'los cabos']],
]);
const HISTORICAL_INACTIVE_PROPERTY_MATCHES = [
    {
        property: 'dLeña - Washington, D.C.',
        matches: (source) => /\bdlena\b/.test(source) && !/\bhouston\b/.test(source),
        matchedAlias: 'dlena',
    },
];

function parseArgs(argv) {
    const options = {
        status: 'complete',
        limit: 0,
        outputDir: DEFAULT_OUTPUT_DIR,
        extract: true,
        download: true,
        apply: false,
        onlyClean: false,
        includeAllPages: true,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--status') {
            options.status = `${argv[i + 1] || ''}`.trim() || options.status;
            i += 1;
        } else if (arg === '--limit') {
            options.limit = Math.max(Number(argv[i + 1] || 0), 0);
            i += 1;
        } else if (arg === '--output-dir') {
            options.outputDir = path.resolve(argv[i + 1] || options.outputDir);
            i += 1;
        } else if (arg === '--no-extract') {
            options.extract = false;
        } else if (arg === '--no-download') {
            options.download = false;
            options.extract = false;
        } else if (arg === '--apply') {
            options.apply = true;
        } else if (arg === '--only-clean') {
            options.onlyClean = true;
        } else if (arg === '--help' || arg === '-h') {
            usage();
            process.exit(0);
        }
    }

    return options;
}

function usage() {
    console.log(`Usage: node scripts/clickup-completed-import.js [options]

Dry-runs completed ClickUp task import by default. Use --apply --only-clean to write clean rows.

Options:
  --status <name>       ClickUp status to scan (default: complete)
  --limit <n>           Limit tasks for a small probe (default: all pages)
  --output-dir <path>   Output directory (default: ../../tmp/clickup-history-import)
  --apply               Import eligible rows to Supabase
  --only-clean          Required with --apply; imports rows with no warnings only
  --no-extract          Do not download/extract DOCX text
  --no-download         Do not download DOCX attachments
`);
}

function requireEnv(name) {
    const value = `${process.env[name] || ''}`.trim();
    if (!value) {
        throw new Error(`Missing ${name} in environment`);
    }
    return value;
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

function titleCase(value) {
    return `${value || ''}`
        .trim()
        .toLowerCase()
        .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
        .replace(/(['’])S\b/g, '$1s')
        .replace(/\bNye\b/g, 'NYE')
        .replace(/\bDdlm\b/g, 'DDLM')
        .replace(/\bDc\b/g, 'DC')
        .replace(/\bDxb\b/g, 'DXB');
}

function cleanServiceCandidate(value) {
    let text = `${value || ''}`
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/\bRSH\b/gi, '')
        .replace(/\bDESIGN\s+BRIEF\b/gi, '')
        .replace(/\bDesign\s+(Development|Develop|Update|Updates)\b/gi, '')
        .replace(/\b(Food|Beverage|Drink|Drinks|Bar)\s+Menu\b/gi, 'Menu')
        .replace(/\bMenu\s+(Update|Updates|Development|Develop)\b/gi, 'Menu')
        .replace(/\b(Update|Updates|Development|Develop)\b/gi, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    text = text.replace(/\s+Menu$/i, '').trim();
    return titleCase(text);
}

function detectServiceFamilies(value) {
    return [...new Set(
        SERVICE_CONFLICT_PATTERNS
            .filter((item) => item.pattern.test(`${value || ''}`))
            .map((item) => item.family)
    )];
}

function toTimestamp(value) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(`${value || ''}`);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function attachmentTimestamp(attachment) {
    return Math.max(
        toTimestamp(attachment?.date),
        toTimestamp(attachment?.date_created),
        toTimestamp(attachment?.date_added),
        toTimestamp(attachment?.created_at)
    );
}

function getAttachmentName(attachment) {
    return `${attachment?.title || attachment?.filename || attachment?.name || ''}`.trim();
}

function isDocxAttachment(attachment) {
    const name = getAttachmentName(attachment).toLowerCase();
    const extension = `${attachment?.extension || attachment?.mime_type || ''}`.toLowerCase();
    const url = `${attachment?.url || ''}`.toLowerCase();
    return name.endsWith('.docx') || extension === 'docx' || extension.includes('wordprocessingml') || url.includes('.docx');
}

function pickNewestDocxAttachment(attachments) {
    return (attachments || [])
        .filter(isDocxAttachment)
        .sort((a, b) => attachmentTimestamp(b) - attachmentTimestamp(a))[0] || null;
}

function safeFilename(value) {
    return `${value || 'menu.docx'}`
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

function buildPropertyAliases(property) {
    const name = `${property?.name || property || ''}`.trim();
    const parts = name.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
    const aliases = new Set([name]);

    if (parts.length > 0) {
        aliases.add(parts[0]);
    }
    if (parts.length >= 2) {
        const city = parts[parts.length - 1];
        aliases.add(`${parts[0]} ${city}`);
        aliases.add(`${parts[0]} - ${city}`);
        for (const cityAlias of CITY_ALIASES.get(normalizeText(city)) || []) {
            aliases.add(`${parts[0]} ${cityAlias}`);
        }

        if (/^toro\s+toro$/i.test(parts[0])) {
            aliases.add(`TT ${city}`);
            for (const cityAlias of CITY_ALIASES.get(normalizeText(city)) || []) {
                aliases.add(`TT ${cityAlias}`);
            }
            if (/fort\s+worth/i.test(city)) {
                aliases.add('TTFW');
            }
        }
    }
    if (parts.length >= 3) {
        aliases.add(`${parts[0]} ${parts[1]} ${parts[parts.length - 1]}`);
    }

    return Array.from(aliases)
        .map((alias) => normalizeText(alias))
        .filter((alias) => alias.length >= 3);
}

function inferProperty(task, attachmentName, propertyCatalog) {
    const source = normalizeText(`${task.name || ''} ${attachmentName || ''}`);
    const historicalMatch = HISTORICAL_INACTIVE_PROPERTY_MATCHES.find((item) => item.matches(source));
    if (historicalMatch) {
        return {
            property: historicalMatch.property,
            confidence: 'historical',
            matchedAlias: historicalMatch.matchedAlias,
            alternatives: [],
        };
    }

    const candidates = [];

    for (const property of propertyCatalog) {
        const aliases = buildPropertyAliases(property);
        let bestAlias = '';
        for (const alias of aliases) {
            if (source.includes(alias) && alias.length > bestAlias.length) {
                bestAlias = alias;
            }
        }

        if (bestAlias) {
            candidates.push({
                property: property.name,
                score: bestAlias.length,
                matchedAlias: bestAlias,
                confidence: bestAlias.length >= 10 ? 'high' : 'medium',
            });
            continue;
        }

        const tokens = normalizeText(property.name)
            .split(' ')
            .filter((token) => token.length > 2 && !DESIGN_WORDS.includes(token));
        const uniqueTokens = Array.from(new Set(tokens));
        const hits = uniqueTokens.filter((token) => source.includes(token));
        if (hits.length >= Math.min(3, uniqueTokens.length) && hits.length > 0) {
            candidates.push({
                property: property.name,
                score: hits.length,
                matchedAlias: hits.join(' '),
                confidence: 'low',
            });
        }
    }

    candidates.sort((a, b) => b.score - a.score);
    const winner = candidates[0] || null;
    if (!winner) {
        return {
            property: '',
            confidence: 'missing',
            matchedAlias: '',
            alternatives: [],
        };
    }

    const alternatives = candidates
        .slice(1, 4)
        .filter((candidate) => candidate.score >= winner.score - 2)
        .map((candidate) => candidate.property);

    return {
        property: winner.property,
        confidence: alternatives.length ? 'ambiguous' : normalizePropertyConfidence(winner),
        matchedAlias: winner.matchedAlias,
        alternatives,
    };
}

function normalizePropertyConfidence(candidate) {
    if (candidate.confidence !== 'medium') {
        return candidate.confidence;
    }

    // A short brand-only match is still strong when no competing property matched.
    return 'high';
}

function inferServicePeriod(task, attachmentName, propertyConfig) {
    const taskName = `${task.name || ''}`.trim();
    const filename = `${attachmentName || ''}`.trim();
    const source = `${taskName} ${filename}`;
    const normalizedSource = normalizeText(source);
    const taskServiceFamilies = detectServiceFamilies(taskName);
    const filenameServiceFamilies = detectServiceFamilies(filename);
    const serviceConflict = taskServiceFamilies.length > 0
        && filenameServiceFamilies.length > 0
        && !taskServiceFamilies.some((family) => filenameServiceFamilies.includes(family));
    const folders = Array.isArray(propertyConfig?.sharepoint_service_folders)
        ? propertyConfig.sharepoint_service_folders
        : [];

    const buildResult = (servicePeriod, confidence, sourceName) => ({
        servicePeriod,
        confidence,
        source: sourceName,
        conflict: serviceConflict,
        taskServiceFamilies,
        filenameServiceFamilies,
    });

    const folderMatch = folders
        .map((folder) => ({ folder, normalized: normalizeText(folder) }))
        .filter((item) => item.normalized && normalizedSource.includes(item.normalized))
        .sort((a, b) => b.normalized.length - a.normalized.length)[0];

    if (folderMatch) {
        return buildResult(folderMatch.folder, 'high', 'property_folder');
    }

    const structuredSegments = taskName
        .split(/\s+-\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => !/^rsh$/i.test(part))
        .filter((part) => !/^design\s+(development|develop|update|updates)$/i.test(part));

    for (const segment of structuredSegments.slice(1)) {
        if (/\bmenu\b/i.test(segment)) {
            const cleaned = cleanServiceCandidate(segment);
            if (cleaned && normalizeText(cleaned).length > 2) {
                return buildResult(cleaned, 'high', 'task_segment');
            }
        }
    }

    const filenameMenuMatch = filename.match(/(?:^|[_\s-])([^_/-]{3,80}?)\s*[_\s-]+Menu(?:[_\s-]|\.|$)/i);
    if (filenameMenuMatch) {
        const cleaned = cleanServiceCandidate(filenameMenuMatch[1]);
        if (cleaned && normalizeText(cleaned).length > 2) {
            return buildResult(cleaned, 'medium', 'filename_menu');
        }
    }

    for (const item of SERVICE_PATTERNS) {
        if (item.pattern.test(source)) {
            return buildResult(item.label, 'medium', 'pattern');
        }
    }

    return buildResult('', 'missing', '');
}

function findPythonExecutable() {
    const candidates = [
        '/app/services/docx-redliner/venv/bin/python',
        path.resolve(process.cwd(), '../../services/docx-redliner/venv/bin/python'),
        path.resolve(process.cwd(), 'services/docx-redliner/venv/bin/python'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return 'python3';
}

function findExtractorScript() {
    const candidates = [
        '/app/services/docx-redliner/extract_clean_menu_text.py',
        path.resolve(process.cwd(), '../../services/docx-redliner/extract_clean_menu_text.py'),
        path.resolve(process.cwd(), 'services/docx-redliner/extract_clean_menu_text.py'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error('Could not find services/docx-redliner/extract_clean_menu_text.py');
}

async function extractMenuText(docxPath) {
    const python = findPythonExecutable();
    const script = findExtractorScript();
    const { stdout } = await execFileAsync(python, [script, docxPath], {
        timeout: 45000,
        maxBuffer: 20 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout || '{}');
    return {
        raw: `${parsed.menu_content || ''}`,
        cleaned: `${parsed.cleaned_menu_content || parsed.menu_content || ''}`,
    };
}

async function fetchCompletedTasks({ token, listId, status, limit }) {
    const tasks = [];
    for (let page = 0; ; page += 1) {
        const params = new URLSearchParams();
        params.set('include_closed', 'true');
        params.set('subtasks', 'true');
        params.set('page', `${page}`);
        params.append('statuses[]', status);

        const response = await axios.get(`${CLICKUP_API_BASE}/list/${listId}/task?${params.toString()}`, {
            headers: { Authorization: token },
            timeout: 30000,
        });

        const pageTasks = response.data?.tasks || [];
        tasks.push(...pageTasks);
        if (limit && tasks.length >= limit) {
            return tasks.slice(0, limit);
        }
        if (pageTasks.length === 0 || pageTasks.length < 100) {
            return tasks;
        }
    }
}

async function fetchTaskDetail(token, taskId) {
    const response = await axios.get(`${CLICKUP_API_BASE}/task/${taskId}`, {
        headers: { Authorization: token },
        timeout: 30000,
    });
    return response.data;
}

async function downloadAttachment(token, attachment, targetPath) {
    if (!attachment?.url) {
        throw new Error('Attachment has no download URL');
    }
    const response = await axios.get(attachment.url, {
        responseType: 'arraybuffer',
        headers: { Authorization: token },
        timeout: 60000,
    });
    await fs.promises.writeFile(targetPath, response.data);
}

async function loadPropertyCatalog() {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('properties')
        .select('name, sharepoint_service_folders')
        .eq('is_active', true)
        .order('name', { ascending: true });

    if (error) {
        throw new Error(`Failed to load property catalog: ${error.message}`);
    }
    return data || [];
}

function buildWarnings(row) {
    const warnings = [];
    if (!row.docxAttachmentName) warnings.push('no_docx');
    if (row.propertyConfidence !== 'high') warnings.push(`property_${row.propertyConfidence}`);
    if (row.serviceConfidence === 'missing') warnings.push('service_missing');
    if (row.serviceConfidence === 'medium') warnings.push('service_medium');
    if (row.serviceConflict) warnings.push('service_task_filename_conflict');
    if (row.propertyAlternatives.length) warnings.push('property_ambiguous');
    if (row.extractionError) warnings.push('extraction_failed');
    if (row.extractionAttempted && row.extractedDishCount === 0 && row.docxAttachmentName) warnings.push('zero_dishes');
    if (!row.isNewestForPropertyService && row.property && row.servicePeriod) warnings.push('not_newest_for_property_service');
    return warnings;
}

function isCleanImportCandidate(row) {
    return (
        row.warnings.length === 0 &&
        row.isNewestForPropertyService === true &&
        !!row.docxAttachmentName &&
        !!row.approvedMenuContent &&
        row.extractionAttempted === true &&
        row.extractedDishCount > 0 &&
        row.propertyConfidence === 'high' &&
        row.serviceConfidence === 'high'
    );
}

function clickUpLegacyId(taskId) {
    return `clickup-${taskId}`;
}

function normalizeSubmissionDate(row) {
    const source = row.attachmentDate || row.taskUpdatedAt || new Date().toISOString();
    const parsed = Date.parse(source);
    return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

async function findExistingImportedSubmission(supabase, row) {
    const legacyId = clickUpLegacyId(row.taskId);
    const { data: legacyMatch, error: legacyError } = await supabase
        .from('submissions')
        .select('id')
        .eq('legacy_id', legacyId)
        .maybeSingle();

    if (legacyError) {
        throw new Error(`Failed to look up existing ${legacyId}: ${legacyError.message}`);
    }
    if (legacyMatch?.id) {
        return legacyMatch.id;
    }

    const { data: clickupMatch, error: clickupError } = await supabase
        .from('submissions')
        .select('id')
        .eq('clickup_task_id', row.taskId)
        .maybeSingle();

    if (clickupError) {
        throw new Error(`Failed to look up ClickUp task ${row.taskId}: ${clickupError.message}`);
    }
    return clickupMatch?.id || '';
}

function buildSubmissionPayload(row, submissionId) {
    const timestamp = normalizeSubmissionDate(row);
    const legacyId = clickUpLegacyId(row.taskId);
    const rawPayload = {
        clickupHistoryImport: {
            taskId: row.taskId,
            taskName: row.taskName,
            taskUrl: row.taskUrl,
            taskStatus: row.taskStatus,
            taskUpdatedAt: row.taskUpdatedAt,
            attachmentId: row.attachmentId,
            attachmentDate: row.attachmentDate,
            docxAttachmentName: row.docxAttachmentName,
            propertyMatchedAlias: row.propertyMatchedAlias,
            serviceSource: row.serviceSource,
            serviceConflict: row.serviceConflict,
            taskServiceFamilies: row.taskServiceFamilies,
            filenameServiceFamilies: row.filenameServiceFamilies,
            importedFromCompletedHistory: true,
        },
    };

    return {
        id: submissionId,
        legacy_id: legacyId,
        project_name: row.taskName || `${row.property} ${row.servicePeriod}`,
        property: row.property,
        menu_type: 'standard',
        service_period: row.servicePeriod,
        template_type: 'food',
        submitter_email: 'clickup-history@richardsandoval.com',
        menu_content: row.approvedMenuContent,
        approved_menu_content: row.approvedMenuContent,
        approved_menu_content_raw: row.approvedMenuContent,
        approved_text_extracted_at: new Date().toISOString(),
        filename: row.docxAttachmentName,
        original_path: row.downloadedPath || null,
        final_path: row.downloadedPath || null,
        clickup_task_id: row.taskId,
        status: 'approved',
        changes_made: false,
        source: 'clickup_history_import',
        created_at: timestamp,
        updated_at: timestamp,
        reviewed_at: timestamp,
        raw_payload: rawPayload,
    };
}

async function upsertImportedSubmission(supabase, row) {
    const existingId = await findExistingImportedSubmission(supabase, row);
    const submissionId = existingId || crypto.randomUUID();
    const payload = buildSubmissionPayload(row, submissionId);

    if (existingId) {
        const { data, error } = await supabase
            .from('submissions')
            .update(payload)
            .eq('id', existingId)
            .select('id')
            .single();
        if (error) {
            throw new Error(`Failed to update submission for ${row.taskId}: ${error.message}`);
        }
        return data.id;
    }

    const { data, error } = await supabase
        .from('submissions')
        .insert(payload)
        .select('id')
        .single();

    if (error) {
        throw new Error(`Failed to insert submission for ${row.taskId}: ${error.message}`);
    }
    return data.id;
}

async function replaceImportedDishes(supabase, row, submissionId) {
    const { error: deleteError } = await supabase
        .from('approved_dishes')
        .delete()
        .eq('source_submission_id', submissionId);

    if (deleteError) {
        throw new Error(`Failed to clear existing dishes for ${row.taskId}: ${deleteError.message}`);
    }

    const dishes = row.extractedDishes.map((dish) => ({
        dish_name: dish.name,
        property: row.property,
        service_period: row.servicePeriod,
        menu_category: dish.category,
        description: dish.description,
        price: normalizeDishPriceForStorage(dish.price, row.property, row.servicePeriod),
        allergens: dish.allergens?.length ? dish.allergens : undefined,
        source_submission_id: submissionId,
    }));

    await createDishes(dishes);
    return dishes.length;
}

async function applyCleanImports(rows) {
    const candidates = rows.filter(isCleanImportCandidate);
    const supabase = getSupabaseClient();
    const summary = {
        attempted: candidates.length,
        imported: 0,
        failed: 0,
        dishesAdded: 0,
        details: [],
    };

    for (const row of candidates) {
        try {
            const submissionId = await upsertImportedSubmission(supabase, row);
            const dishCount = await replaceImportedDishes(supabase, row, submissionId);
            row.importStatus = 'imported';
            row.importedSubmissionId = submissionId;
            row.importedDishCount = dishCount;
            summary.imported += 1;
            summary.dishesAdded += dishCount;
            summary.details.push({
                taskId: row.taskId,
                submissionId,
                property: row.property,
                servicePeriod: row.servicePeriod,
                dishesAdded: dishCount,
                status: 'imported',
            });
        } catch (error) {
            row.importStatus = 'failed';
            row.importError = error.message;
            summary.failed += 1;
            summary.details.push({
                taskId: row.taskId,
                property: row.property,
                servicePeriod: row.servicePeriod,
                status: 'failed',
                reason: error.message,
            });
        }
    }

    return summary;
}

function markNewestRows(rows) {
    const groups = new Map();
    for (const row of rows) {
        if (!row.property || !row.servicePeriod) continue;
        if (row.serviceConflict) continue;
        const key = `${normalizeText(row.property)}|${normalizeText(row.servicePeriod)}`;
        const current = groups.get(key) || [];
        current.push(row);
        groups.set(key, current);
    }

    for (const groupRows of groups.values()) {
        groupRows.sort((a, b) => b.attachmentTimestamp - a.attachmentTimestamp);
        groupRows.forEach((row, index) => {
            row.propertyServiceGroupSize = groupRows.length;
            row.isNewestForPropertyService = index === 0;
            row.newestTaskIdForPropertyService = groupRows[0].taskId;
        });
    }
}

function csvEscape(value) {
    const text = Array.isArray(value) ? value.join('; ') : `${value ?? ''}`;
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

async function writeOutputs(outputDir, rows, summary) {
    await fs.promises.mkdir(outputDir, { recursive: true });
    const jsonPath = path.join(outputDir, 'completed-dry-run.json');
    const csvPath = path.join(outputDir, 'completed-dry-run.csv');

    await fs.promises.writeFile(jsonPath, JSON.stringify({ summary, rows }, null, 2));

    const columns = [
        'taskId',
        'taskName',
        'taskUrl',
        'taskUpdatedAt',
        'docxAttachmentName',
        'attachmentDate',
        'property',
        'propertyConfidence',
        'servicePeriod',
        'serviceConfidence',
        'serviceSource',
        'serviceConflict',
        'taskServiceFamilies',
        'filenameServiceFamilies',
        'isNewestForPropertyService',
        'propertyServiceGroupSize',
        'extractedDishCount',
        'warnings',
    ];

    const csv = [
        columns.join(','),
        ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
    ].join('\n');

    await fs.promises.writeFile(csvPath, csv);
    return { jsonPath, csvPath };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.apply) {
        if (!options.onlyClean) {
            throw new Error('--apply requires --only-clean so warning rows are not imported accidentally');
        }
        if (!options.download || !options.extract) {
            throw new Error('--apply requires download and extraction; remove --no-download/--no-extract');
        }
    }

    const token = requireEnv('CLICKUP_API_TOKEN');
    const listId = requireEnv('CLICKUP_LIST_ID');
    const propertyCatalog = await loadPropertyCatalog();
    const propertyByName = new Map(propertyCatalog.map((item) => [item.name, item]));

    await fs.promises.mkdir(options.outputDir, { recursive: true });
    const downloadDir = path.join(options.outputDir, 'downloads');
    if (options.download) {
        await fs.promises.mkdir(downloadDir, { recursive: true });
    }

    console.log(`Loading ClickUp tasks in status "${options.status}"...`);
    const tasks = await fetchCompletedTasks({
        token,
        listId,
        status: options.status,
        limit: options.limit,
    });
    console.log(`Found ${tasks.length} task(s).`);

    const rows = [];
    for (let index = 0; index < tasks.length; index += 1) {
        const taskSummary = tasks[index];
        process.stdout.write(`[${index + 1}/${tasks.length}] ${taskSummary.id} ${taskSummary.name}\n`);

        const row = {
            taskId: taskSummary.id,
            taskName: taskSummary.name || '',
            taskUrl: taskSummary.url || '',
            taskStatus: taskSummary.status?.status || '',
            taskUpdatedAt: taskSummary.date_updated ? new Date(Number(taskSummary.date_updated)).toISOString() : '',
            docxAttachmentName: '',
            attachmentId: '',
            attachmentDate: '',
            attachmentTimestamp: 0,
            property: '',
            propertyConfidence: 'missing',
            propertyMatchedAlias: '',
            propertyAlternatives: [],
            servicePeriod: '',
            serviceConfidence: 'missing',
            serviceSource: '',
            serviceConflict: false,
            taskServiceFamilies: [],
            filenameServiceFamilies: [],
            downloadedPath: '',
            extractionAttempted: false,
            extractedTextLength: 0,
            extractedDishCount: 0,
            extractedDishes: [],
            extractedDishPreview: [],
            approvedMenuContent: '',
            extractionError: '',
            warnings: [],
            isNewestForPropertyService: null,
            propertyServiceGroupSize: 0,
            newestTaskIdForPropertyService: '',
        };

        try {
            const task = await fetchTaskDetail(token, taskSummary.id);
            const attachment = pickNewestDocxAttachment(task.attachments || []);
            if (attachment) {
                row.docxAttachmentName = getAttachmentName(attachment);
                row.attachmentId = `${attachment.id || ''}`;
                row.attachmentTimestamp = attachmentTimestamp(attachment);
                row.attachmentDate = row.attachmentTimestamp ? new Date(row.attachmentTimestamp).toISOString() : '';
            }

            const propertyInference = inferProperty(task, row.docxAttachmentName, propertyCatalog);
            row.property = propertyInference.property;
            row.propertyConfidence = propertyInference.confidence;
            row.propertyMatchedAlias = propertyInference.matchedAlias;
            row.propertyAlternatives = propertyInference.alternatives || [];

            const serviceInference = inferServicePeriod(task, row.docxAttachmentName, propertyByName.get(row.property));
            row.servicePeriod = serviceInference.servicePeriod;
            row.serviceConfidence = serviceInference.confidence;
            row.serviceSource = serviceInference.source;
            row.serviceConflict = serviceInference.conflict;
            row.taskServiceFamilies = serviceInference.taskServiceFamilies || [];
            row.filenameServiceFamilies = serviceInference.filenameServiceFamilies || [];

            if (options.download && attachment?.url) {
                const filename = `${task.id}-${safeFilename(row.docxAttachmentName)}`;
                const targetPath = path.join(downloadDir, filename);
                row.downloadedPath = targetPath;
                await downloadAttachment(token, attachment, targetPath);

                if (options.extract) {
                    row.extractionAttempted = true;
                    try {
                        const extracted = await extractMenuText(targetPath);
                        const text = `${extracted.cleaned || extracted.raw || ''}`.trim();
                        row.approvedMenuContent = text;
                        row.extractedTextLength = text.length;
                        const preview = previewDishExtraction(text);
                        row.extractedDishCount = preview.length;
                        row.extractedDishes = preview;
                        row.extractedDishPreview = preview.slice(0, 10);
                    } catch (error) {
                        row.extractionError = error.message;
                    }
                }
            }
        } catch (error) {
            row.extractionError = error.message;
        }

        rows.push(row);
    }

    markNewestRows(rows);
    for (const row of rows) {
        row.warnings = buildWarnings(row);
    }

    const summary = {
        generatedAt: new Date().toISOString(),
        status: options.status,
        mode: options.apply ? 'apply' : 'dry-run',
        taskCount: rows.length,
        withDocx: rows.filter((row) => !!row.docxAttachmentName).length,
        missingDocx: rows.filter((row) => !row.docxAttachmentName).length,
        highConfidenceProperty: rows.filter((row) => row.propertyConfidence === 'high').length,
        missingProperty: rows.filter((row) => row.propertyConfidence === 'missing').length,
        highConfidenceService: rows.filter((row) => row.serviceConfidence === 'high').length,
        missingService: rows.filter((row) => row.serviceConfidence === 'missing').length,
        zeroDishExtractions: rows.filter((row) => row.extractionAttempted && row.docxAttachmentName && row.extractedDishCount === 0).length,
        newestWinners: rows.filter((row) => row.isNewestForPropertyService === true).length,
        needsReview: rows.filter((row) => row.warnings.length > 0).length,
        cleanImportCandidates: rows.filter(isCleanImportCandidate).length,
    };

    if (options.apply) {
        summary.import = await applyCleanImports(rows);
    }

    const outputs = await writeOutputs(options.outputDir, rows, summary);
    console.log(JSON.stringify({ summary, outputs }, null, 2));
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
