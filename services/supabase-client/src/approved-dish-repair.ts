import {
    PreparedApprovedDish,
    prepareApprovedDishInputs,
    storePreparedApprovedDishes,
} from './dish-extractor';
import {
    ApprovedDishQualityInput,
    analyzeApprovedDishQuality,
    buildDishQualityContext,
} from './dish-quality';
import { getSupabaseClient } from './client';

const PAGE_SIZE = 1000;
const SUBMISSION_BATCH_SIZE = 75;
const DEFAULT_MAX_COUNT_DROP_RATIO = 0.7;

type ApprovedDishRepairRow = ApprovedDishQualityInput & {
    id?: string;
    is_active?: boolean;
    created_at?: string;
};

type ApprovedDishRepairSubmission = {
    id: string;
    legacy_id?: string;
    clickup_task_id?: string;
    project_name?: string;
    property?: string;
    service_period?: string;
    filename?: string;
    source?: string;
    status?: string;
    approved_menu_content?: string;
    menu_content?: string;
};

export type ApprovedDishRepairIssueSummary = {
    totalRows: number;
    highOrExcludeRows: number;
    reviewRows: number;
    blankDescriptionRows: number;
    exactDuplicateRows: number;
    pricingRows: number;
    categoryContaminationRows: number;
    instructionRows: number;
};

export type ApprovedDishRepairCandidate = {
    sourceSubmissionId: string;
    legacyId: string;
    clickupTaskId: string;
    filename: string;
    projectName: string;
    property: string;
    servicePeriod: string;
    sourceType: string;
    status: 'eligible' | 'skipped' | 'applied' | 'failed';
    reason: string;
    changed: boolean;
    improved: boolean;
    before: ApprovedDishRepairIssueSummary;
    after: ApprovedDishRepairIssueSummary;
    beforeCount: number;
    afterCount: number;
    countDelta: number;
    countDropRatio: number;
    warnings: string[];
    applied?: {
        added: number;
        extracted: number;
        skipped: number;
        qualityReviewCount: number;
        excludedByRuleCount: number;
    };
    error?: string;
};

export type ApprovedDishRepairReport = {
    generatedAt: string;
    mode: 'dry-run' | 'apply';
    options: {
        property?: string;
        brand?: string;
        sourceSubmissionIds: string[];
        legacyIds: string[];
        includeClean: boolean;
        maxCountDropRatio: number;
        limit: number;
    };
    summary: {
        scannedSubmissions: number;
        eligible: number;
        skipped: number;
        applied: number;
        failed: number;
        beforeRows: number;
        afterRows: number;
        beforeHighOrExcludeRows: number;
        afterHighOrExcludeRows: number;
        beforeBlankDescriptionRows: number;
        afterBlankDescriptionRows: number;
    };
    candidates: ApprovedDishRepairCandidate[];
};

export type ApprovedDishRepairOptions = {
    apply?: boolean;
    property?: string;
    brand?: string;
    sourceSubmissionIds?: string[];
    legacyIds?: string[];
    includeClean?: boolean;
    maxCountDropRatio?: number;
    limit?: number;
};

export function summarizeApprovedDishRows(rows: ApprovedDishQualityInput[]): ApprovedDishRepairIssueSummary {
    const context = buildDishQualityContext(rows);
    const summary: ApprovedDishRepairIssueSummary = {
        totalRows: rows.length,
        highOrExcludeRows: 0,
        reviewRows: 0,
        blankDescriptionRows: 0,
        exactDuplicateRows: 0,
        pricingRows: 0,
        categoryContaminationRows: 0,
        instructionRows: 0,
    };

    for (const row of rows) {
        const quality = analyzeApprovedDishQuality(row, context);
        const issueCodes = quality.issues.map((issue) => issue.code);

        if (quality.highestSeverity === 'high' || quality.disposition === 'exclude') {
            summary.highOrExcludeRows += 1;
        }
        if (quality.disposition === 'review') {
            summary.reviewRows += 1;
        }
        if (compactText(row.dish_name) && compactText(row.price) && !compactText(row.description)) {
            summary.blankDescriptionRows += 1;
        }
        if (issueCodes.includes('exact_duplicate_within_submission')) {
            summary.exactDuplicateRows += 1;
        }
        if (issueCodes.includes('pricing_grid_as_dish') || issueCodes.includes('description_contains_pricing_grid')) {
            summary.pricingRows += 1;
        }
        if (issueCodes.includes('category_description_contamination')) {
            summary.categoryContaminationRows += 1;
        }
        if (issueCodes.includes('instruction_text_name')) {
            summary.instructionRows += 1;
        }
    }

    return summary;
}

export function resolveApprovedDishRepairMenuText(submission: {
    approved_menu_content?: string;
    menu_content?: string;
}): string {
    return preserveSourceText(submission.approved_menu_content || submission.menu_content);
}

export function buildApprovedDishRepairCandidate(input: {
    submission: ApprovedDishRepairSubmission;
    beforeRows: ApprovedDishRepairRow[];
    prepared: PreparedApprovedDish[];
    includeClean?: boolean;
    maxCountDropRatio?: number;
}): ApprovedDishRepairCandidate {
    const beforeRows = input.beforeRows;
    const afterRows = input.prepared
        .filter((row) => !row.excludedByRule)
        .map((row) => row.input);
    const before = summarizeApprovedDishRows(beforeRows);
    const after = summarizeApprovedDishRows(afterRows);
    const beforeFingerprint = fingerprintRows(beforeRows);
    const afterFingerprint = fingerprintRows(afterRows);
    const changed = beforeFingerprint !== afterFingerprint;
    const countDelta = afterRows.length - beforeRows.length;
    const countDropRatio = beforeRows.length > 0 && countDelta < 0
        ? Math.abs(countDelta) / beforeRows.length
        : 0;
    const improved = (
        before.highOrExcludeRows > after.highOrExcludeRows ||
        before.blankDescriptionRows > after.blankDescriptionRows ||
        before.exactDuplicateRows > after.exactDuplicateRows ||
        before.pricingRows > after.pricingRows ||
        before.categoryContaminationRows > after.categoryContaminationRows ||
        before.instructionRows > after.instructionRows
    );
    const warnings: string[] = [];
    const maxCountDropRatio = input.maxCountDropRatio ?? DEFAULT_MAX_COUNT_DROP_RATIO;

    let status: ApprovedDishRepairCandidate['status'] = 'eligible';
    let reason = 'Eligible for repair.';

    if (afterRows.length === 0) {
        status = 'skipped';
        reason = 'Skipped because the new extraction produced no rows.';
    } else if (after.highOrExcludeRows > 0) {
        status = 'skipped';
        reason = 'Skipped because the new extraction still has high/exclude quality rows.';
    } else if (countDropRatio > maxCountDropRatio) {
        status = 'skipped';
        reason = `Skipped because row count would drop by ${(countDropRatio * 100).toFixed(1)}%.`;
    } else if (!changed) {
        status = 'skipped';
        reason = 'Skipped because the new extraction matches the active rows.';
    } else if (!improved && !input.includeClean) {
        status = 'skipped';
        reason = 'Skipped because the change is not an obvious quality improvement.';
    }

    if (after.reviewRows > before.reviewRows) {
        warnings.push('New extraction increases review-level quality flags.');
    }
    if (countDelta < 0) {
        warnings.push(`New extraction has ${Math.abs(countDelta)} fewer rows.`);
    }
    if (countDelta > 0) {
        warnings.push(`New extraction has ${countDelta} additional rows.`);
    }

    return {
        sourceSubmissionId: input.submission.id,
        legacyId: compactText(input.submission.legacy_id),
        clickupTaskId: compactText(input.submission.clickup_task_id),
        filename: compactText(input.submission.filename),
        projectName: compactText(input.submission.project_name),
        property: compactText(input.submission.property || beforeRows[0]?.property),
        servicePeriod: compactText(input.submission.service_period || beforeRows[0]?.service_period),
        sourceType: compactText(input.submission.source),
        status,
        reason,
        changed,
        improved,
        before,
        after,
        beforeCount: beforeRows.length,
        afterCount: afterRows.length,
        countDelta,
        countDropRatio,
        warnings,
    };
}

export async function runApprovedDishRepair(options: ApprovedDishRepairOptions = {}): Promise<ApprovedDishRepairReport> {
    const supabase = getSupabaseClient();
    const activeRows = await loadActiveApprovedDishRows(supabase);
    const rowsBySubmission = groupRowsBySubmission(filterRowsByScope(activeRows, options));
    const explicitSubmissionIds = new Set((options.sourceSubmissionIds || []).map(compactText).filter(Boolean));
    const legacySubmissionIds = await loadSubmissionIdsByLegacyIds(supabase, options.legacyIds || []);
    for (const id of legacySubmissionIds) explicitSubmissionIds.add(id);
    for (const id of explicitSubmissionIds) {
        if (!rowsBySubmission.has(id)) {
            rowsBySubmission.set(id, []);
        }
    }

    let submissionIds = Array.from(rowsBySubmission.keys()).filter(Boolean).sort();
    if ((options.limit || 0) > 0) {
        submissionIds = submissionIds.slice(0, options.limit);
    }

    const submissionsById = await loadSubmissionsByIds(supabase, submissionIds);
    const candidates: ApprovedDishRepairCandidate[] = [];

    for (const submissionId of submissionIds) {
        const submission = submissionsById.get(submissionId);
        const beforeRows = rowsBySubmission.get(submissionId) || [];
        if (!submission) {
            candidates.push(missingSubmissionCandidate(submissionId, beforeRows));
            continue;
        }

        const menuText = resolveApprovedDishRepairMenuText(submission);
        if (!menuText) {
            candidates.push(missingMenuTextCandidate(submission, beforeRows));
            continue;
        }

        const property = compactText(submission.property || beforeRows[0]?.property) || 'Unknown';
        const servicePeriod = compactText(submission.service_period || beforeRows[0]?.service_period) || undefined;
        const prepared = prepareApprovedDishInputs(menuText, property, submission.id, { servicePeriod });
        const candidate = buildApprovedDishRepairCandidate({
            submission,
            beforeRows,
            prepared,
            includeClean: options.includeClean,
            maxCountDropRatio: options.maxCountDropRatio,
        });

        if (options.apply && candidate.status === 'eligible') {
            try {
                candidate.applied = await storePreparedApprovedDishes(prepared, submission.id, { replaceExisting: true });
                candidate.status = 'applied';
                candidate.reason = 'Applied repair.';
            } catch (error: any) {
                candidate.status = 'failed';
                candidate.reason = 'Failed while applying repair.';
                candidate.error = error?.message || `${error}`;
            }
        }

        candidates.push(candidate);
    }

    return buildReport(options, candidates);
}

function missingSubmissionCandidate(
    submissionId: string,
    beforeRows: ApprovedDishRepairRow[]
): ApprovedDishRepairCandidate {
    const before = summarizeApprovedDishRows(beforeRows);
    const after = summarizeApprovedDishRows([]);
    return {
        sourceSubmissionId: submissionId,
        legacyId: '',
        clickupTaskId: '',
        filename: '',
        projectName: '',
        property: compactText(beforeRows[0]?.property),
        servicePeriod: compactText(beforeRows[0]?.service_period),
        sourceType: '',
        status: 'skipped',
        reason: 'Skipped because source submission metadata was not found.',
        changed: false,
        improved: false,
        before,
        after,
        beforeCount: beforeRows.length,
        afterCount: 0,
        countDelta: -beforeRows.length,
        countDropRatio: beforeRows.length > 0 ? 1 : 0,
        warnings: [],
    };
}

function missingMenuTextCandidate(
    submission: ApprovedDishRepairSubmission,
    beforeRows: ApprovedDishRepairRow[]
): ApprovedDishRepairCandidate {
    const before = summarizeApprovedDishRows(beforeRows);
    const after = summarizeApprovedDishRows([]);
    return {
        sourceSubmissionId: submission.id,
        legacyId: compactText(submission.legacy_id),
        clickupTaskId: compactText(submission.clickup_task_id),
        filename: compactText(submission.filename),
        projectName: compactText(submission.project_name),
        property: compactText(submission.property || beforeRows[0]?.property),
        servicePeriod: compactText(submission.service_period || beforeRows[0]?.service_period),
        sourceType: compactText(submission.source),
        status: 'skipped',
        reason: 'Skipped because source submission has no approved menu content.',
        changed: false,
        improved: false,
        before,
        after,
        beforeCount: beforeRows.length,
        afterCount: 0,
        countDelta: -beforeRows.length,
        countDropRatio: beforeRows.length > 0 ? 1 : 0,
        warnings: [],
    };
}

function buildReport(
    options: ApprovedDishRepairOptions,
    candidates: ApprovedDishRepairCandidate[]
): ApprovedDishRepairReport {
    const summary = candidates.reduce((acc, candidate) => {
        acc.scannedSubmissions += 1;
        acc.beforeRows += candidate.beforeCount;
        acc.afterRows += candidate.afterCount;
        acc.beforeHighOrExcludeRows += candidate.before.highOrExcludeRows;
        acc.afterHighOrExcludeRows += candidate.after.highOrExcludeRows;
        acc.beforeBlankDescriptionRows += candidate.before.blankDescriptionRows;
        acc.afterBlankDescriptionRows += candidate.after.blankDescriptionRows;
        if (candidate.status === 'eligible') acc.eligible += 1;
        if (candidate.status === 'skipped') acc.skipped += 1;
        if (candidate.status === 'applied') acc.applied += 1;
        if (candidate.status === 'failed') acc.failed += 1;
        return acc;
    }, {
        scannedSubmissions: 0,
        eligible: 0,
        skipped: 0,
        applied: 0,
        failed: 0,
        beforeRows: 0,
        afterRows: 0,
        beforeHighOrExcludeRows: 0,
        afterHighOrExcludeRows: 0,
        beforeBlankDescriptionRows: 0,
        afterBlankDescriptionRows: 0,
    });

    return {
        generatedAt: new Date().toISOString(),
        mode: options.apply ? 'apply' : 'dry-run',
        options: {
            property: options.property,
            brand: options.brand,
            sourceSubmissionIds: options.sourceSubmissionIds || [],
            legacyIds: options.legacyIds || [],
            includeClean: options.includeClean === true,
            maxCountDropRatio: options.maxCountDropRatio ?? DEFAULT_MAX_COUNT_DROP_RATIO,
            limit: options.limit || 0,
        },
        summary,
        candidates,
    };
}

async function loadActiveApprovedDishRows(supabase: any): Promise<ApprovedDishRepairRow[]> {
    const rows: ApprovedDishRepairRow[] = [];
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
                'is_active',
                'created_at',
            ].join(','))
            .eq('is_active', true)
            .order('property', { ascending: true })
            .order('service_period', { ascending: true })
            .order('menu_category', { ascending: true })
            .order('dish_name', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            throw new Error(`Failed to load active approved dishes: ${error.message}`);
        }

        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) {
            break;
        }
        from += PAGE_SIZE;
    }

    return rows;
}

async function loadSubmissionIdsByLegacyIds(supabase: any, legacyIds: string[]): Promise<string[]> {
    const normalizedLegacyIds = legacyIds.map(compactText).filter(Boolean);
    if (normalizedLegacyIds.length === 0) {
        return [];
    }

    const { data, error } = await supabase
        .from('submissions')
        .select('id')
        .in('legacy_id', normalizedLegacyIds);

    if (error) {
        throw new Error(`Failed to load submissions by legacy id: ${error.message}`);
    }

    return (data || []).map((row: any) => compactText(row.id)).filter(Boolean);
}

async function loadSubmissionsByIds(
    supabase: any,
    submissionIds: string[]
): Promise<Map<string, ApprovedDishRepairSubmission>> {
    const submissionsById = new Map<string, ApprovedDishRepairSubmission>();

    for (let index = 0; index < submissionIds.length; index += SUBMISSION_BATCH_SIZE) {
        const batch = submissionIds.slice(index, index + SUBMISSION_BATCH_SIZE);
        if (batch.length === 0) continue;

        const { data, error } = await supabase
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
            ].join(','))
            .in('id', batch);

        if (error) {
            throw new Error(`Failed to load source submissions: ${error.message}`);
        }

        for (const row of data || []) {
            if (row?.id) {
                submissionsById.set(compactText(row.id), row as ApprovedDishRepairSubmission);
            }
        }
    }

    return submissionsById;
}

function filterRowsByScope(
    rows: ApprovedDishRepairRow[],
    options: ApprovedDishRepairOptions
): ApprovedDishRepairRow[] {
    const sourceSubmissionIds = new Set((options.sourceSubmissionIds || []).map(compactText).filter(Boolean));
    const property = compactText(options.property);
    const brand = normalizeBrand(options.brand);

    return rows.filter((row) => {
        if (sourceSubmissionIds.size > 0 && !sourceSubmissionIds.has(compactText(row.source_submission_id))) {
            return false;
        }
        if (property && compactText(row.property) !== property) {
            return false;
        }
        if (brand && normalizeBrand(deriveBrandFromProperty(compactText(row.property))) !== brand) {
            return false;
        }
        return true;
    });
}

function groupRowsBySubmission(rows: ApprovedDishRepairRow[]): Map<string, ApprovedDishRepairRow[]> {
    const grouped = new Map<string, ApprovedDishRepairRow[]>();
    for (const row of rows) {
        const sourceSubmissionId = compactText(row.source_submission_id);
        if (!sourceSubmissionId) continue;
        const existing = grouped.get(sourceSubmissionId) || [];
        existing.push(row);
        grouped.set(sourceSubmissionId, existing);
    }
    return grouped;
}

function fingerprintRows(rows: ApprovedDishQualityInput[]): string {
    return rows
        .map((row) => [
            compactText(row.dish_name).toLowerCase(),
            compactText(row.property).toLowerCase(),
            compactText(row.service_period).toLowerCase(),
            compactText(row.menu_category).toLowerCase(),
            compactText(row.description).toLowerCase(),
            compactText(row.price).toLowerCase(),
            Array.isArray(row.allergens) ? row.allergens.map(compactText).sort().join('|').toLowerCase() : '',
            compactText(row.source_submission_id).toLowerCase(),
        ].join('||'))
        .sort()
        .join('\n');
}

function deriveBrandFromProperty(property: string): string {
    const normalized = compactText(property);
    if (!normalized) return '';
    return compactText(normalized.split(' - ')[0] || normalized);
}

function normalizeBrand(value: string | undefined): string {
    return compactText(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function preserveSourceText(value: unknown): string {
    return `${value || ''}`.replace(/\r\n/g, '\n').trim();
}

function compactText(value: unknown): string {
    return `${value || ''}`.replace(/\s+/g, ' ').trim();
}
