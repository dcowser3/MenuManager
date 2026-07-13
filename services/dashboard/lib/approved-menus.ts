import { promises as fs } from 'fs';
import * as path from 'path';
import { getSupabaseClient, isSupabaseConfigured } from '@menumanager/supabase-client';

const SUBMISSIONS_TABLE = 'submissions';
const ASSETS_TABLE = 'assets';
const APPROVED_STATUSES = new Set(['approved', 'approved_override']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ApprovedMenuListItem = {
    id: string;
    projectName: string;
    property: string;
    filename: string;
    approvedFileName: string;
    reviewedAt: string;
    servicePeriod: string;
    submitterName: string;
    status: string;
    activeDraft: { token: string; lastSavedAt: string; lastEditedBy: string } | null;
    supersededBy: { id: string; projectName: string; approvedAt: string } | null;
};

export type ApprovedMenuDownloadRecord = {
    id: string;
    filename: string;
    finalPath: string;
    storagePath: string;
    sharePointStoragePath: string;
    sharePointDriveId: string;
    status: string;
    approvedFileName: string;
    projectName: string;
    property: string;
    servicePeriod: string;
    templateType: string;
    dateNeeded: string;
    menuType: string;
    orientation: string;
    size: string;
    allergens: string;
    approvedMenuContent: string;
    approvedMenuContentHtml: string;
    rawPayload: Record<string, any>;
};

export type ApprovedMenuFilters = {
    query?: string;
    restaurant?: string;
    servicePeriod?: string;
};

type ApprovedMenuSourceRow = {
    id?: string;
    legacy_id?: string;
    project_name?: string;
    property?: string;
    filename?: string;
    final_path?: string;
    reviewed_at?: string;
    updated_at?: string;
    service_period?: string;
    submitter_name?: string;
    status?: string;
    source?: string;
    template_type?: string;
    date_needed?: string;
    menu_type?: string;
    orientation?: string;
    size?: string;
    allergens?: string;
    approved_menu_content?: string;
    approved_menu_content_html?: string;
    raw_payload?: Record<string, any> | string | null;
};

type ApprovedAssetRow = {
    submission_id?: string;
    asset_type?: string;
    file_name?: string;
    storage_path?: string;
    created_at?: string;
    meta?: Record<string, any> | null;
};

function asObject(value: unknown): Record<string, any> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, any>;
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function getLocalDbDir(repoRoot: string): string {
    return path.join(repoRoot, 'tmp', 'db');
}

function matchesApprovedSearch(row: ApprovedMenuSourceRow, query: string): boolean {
    if (!query) return true;

    const haystack = [
        row.project_name,
        row.property,
        row.filename,
        row.submitter_name,
        row.service_period,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return haystack.includes(query);
}

function matchesRestaurant(row: ApprovedMenuSourceRow, restaurant: string): boolean {
    if (!restaurant) return true;

    const haystack = [
        row.property,
        row.project_name,
        row.filename,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return haystack.includes(restaurant);
}

function matchesServicePeriod(row: ApprovedMenuSourceRow, servicePeriod: string): boolean {
    if (!servicePeriod) return true;
    return `${row.service_period || ''}`.trim().toLowerCase().includes(servicePeriod);
}

function buildApprovedMenuList(
    sourceRows: ApprovedMenuSourceRow[],
    approvedAssetRows: ApprovedAssetRow[]
): ApprovedMenuListItem[] {
    const approvedAssetBySubmission = new Map<string, ApprovedAssetRow>();

    for (const asset of approvedAssetRows) {
        const submissionId = `${asset.submission_id || ''}`.trim();
        if (!submissionId || approvedAssetBySubmission.has(submissionId)) {
            continue;
        }
        approvedAssetBySubmission.set(submissionId, asset);
    }

    return sourceRows.map((row) => {
        const id = `${row.id || row.legacy_id || ''}`.trim();
        const approvedAsset = approvedAssetBySubmission.get(id);
        const submittedFileName = `${row.filename || ''}`.trim();
        return {
            id,
            projectName: `${row.project_name || ''}`.trim(),
            property: `${row.property || ''}`.trim(),
            filename: submittedFileName,
            approvedFileName: submittedFileName || `${approvedAsset?.file_name || 'approved-menu.docx'}`.trim(),
            reviewedAt: `${row.reviewed_at || row.updated_at || ''}`.trim(),
            servicePeriod: `${row.service_period || ''}`.trim(),
            submitterName: `${row.submitter_name || ''}`.trim(),
            status: `${row.status || ''}`.trim(),
            activeDraft: null,
            supersededBy: null,
        };
    });
}

/** Attach DB-service batch lookup results without changing how menus are fetched. */
export function enrichApprovedMenuList(
    menus: ApprovedMenuListItem[],
    drafts: any[] = [],
    lineage: Record<string, any> = {}
): ApprovedMenuListItem[] {
    const draftByBase = new Map((drafts || []).map((draft) => [`${draft.base_submission_id || draft.baseline?.id || ''}`, draft]));
    return menus.map((menu) => {
        const draft = draftByBase.get(menu.id);
        return {
            ...menu,
            activeDraft: draft ? {
                token: `${draft.token || ''}`,
                lastSavedAt: `${draft.updated_at || ''}`,
                lastEditedBy: `${draft.last_edited_by || ''}`,
            } : null,
            supersededBy: lineage[menu.id]?.supersededBy || null,
        };
    });
}

export async function listApprovedMenus(
    repoRoot: string,
    filtersOrQuery: ApprovedMenuFilters | string = '',
    limit = 100
): Promise<ApprovedMenuListItem[]> {
    const filters: ApprovedMenuFilters = typeof filtersOrQuery === 'string'
        ? { query: filtersOrQuery }
        : filtersOrQuery || {};
    const normalizedQuery = `${filters.query || ''}`.trim().toLowerCase();
    const normalizedRestaurant = `${filters.restaurant || ''}`.trim().toLowerCase();
    const normalizedServicePeriod = `${filters.servicePeriod || ''}`.trim().toLowerCase();
    const boundedLimit = Math.min(Math.max(limit, 1), 200);
    let sourceRows: ApprovedMenuSourceRow[] = [];
    let approvedAssetRows: ApprovedAssetRow[] = [];

    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        let submissionsQuery = supabase
            .from(SUBMISSIONS_TABLE)
            .select('*')
            .in('status', Array.from(APPROVED_STATUSES))
            .not('final_path', 'is', null)
            .order('reviewed_at', { ascending: false })
            .order('updated_at', { ascending: false })
            .limit(boundedLimit);

        const prefilterTerms: string[] = [];
        if (normalizedQuery) {
            const like = `%${normalizedQuery}%`;
            prefilterTerms.push(
                `project_name.ilike.${like}`,
                `property.ilike.${like}`,
                `filename.ilike.${like}`,
                `submitter_name.ilike.${like}`,
                `service_period.ilike.${like}`
            );
        }
        if (normalizedRestaurant) {
            const like = `%${normalizedRestaurant}%`;
            prefilterTerms.push(
                `property.ilike.${like}`,
                `project_name.ilike.${like}`,
                `filename.ilike.${like}`
            );
        }
        if (prefilterTerms.length > 0) {
            submissionsQuery = submissionsQuery.or(prefilterTerms.join(','));
        }

        if (normalizedServicePeriod) {
            submissionsQuery = submissionsQuery.ilike('service_period', `%${normalizedServicePeriod}%`);
        }

        const { data, error } = await submissionsQuery;
        if (error) {
            throw new Error(error.message);
        }

        sourceRows = (data || [])
            .filter((row: ApprovedMenuSourceRow) => !row.source || row.source === 'form')
            .filter((row: ApprovedMenuSourceRow) => matchesApprovedSearch(row, normalizedQuery))
            .filter((row: ApprovedMenuSourceRow) => matchesRestaurant(row, normalizedRestaurant))
            .filter((row: ApprovedMenuSourceRow) => matchesServicePeriod(row, normalizedServicePeriod));

        const submissionIds = sourceRows
            .map((row) => `${row.id || row.legacy_id || ''}`.trim())
            .filter(Boolean);

        if (submissionIds.length > 0) {
            const { data: assetData, error: assetError } = await supabase
                .from(ASSETS_TABLE)
                .select('*')
                .eq('asset_type', 'approved_docx')
                .in('submission_id', submissionIds)
                .order('created_at', { ascending: false });

            if (assetError) {
                console.warn('Failed to fetch approved menu assets:', assetError.message);
            } else {
                approvedAssetRows = assetData || [];
            }
        }
    } else {
        const dbDir = getLocalDbDir(repoRoot);
        const submissions = JSON.parse(await fs.readFile(path.join(dbDir, 'submissions.json'), 'utf-8'));
        sourceRows = (Object.values(submissions) as ApprovedMenuSourceRow[])
            .filter((row) => APPROVED_STATUSES.has(`${row.status || ''}`.trim().toLowerCase()))
            .filter((row) => !!row.final_path)
            .filter((row) => !row.source || row.source === 'form')
            .filter((row) => matchesApprovedSearch(row, normalizedQuery))
            .filter((row) => matchesRestaurant(row, normalizedRestaurant))
            .filter((row) => matchesServicePeriod(row, normalizedServicePeriod))
            .sort((a, b) => new Date(`${b.reviewed_at || b.updated_at || ''}`).getTime() - new Date(`${a.reviewed_at || a.updated_at || ''}`).getTime())
            .slice(0, boundedLimit);

        const assets = JSON.parse(await fs.readFile(path.join(dbDir, 'assets.json'), 'utf-8'));
        approvedAssetRows = (assets as ApprovedAssetRow[])
            .filter((asset) => asset.asset_type === 'approved_docx')
            .sort((a, b) => new Date(`${b.created_at || ''}`).getTime() - new Date(`${a.created_at || ''}`).getTime());
    }

    return buildApprovedMenuList(sourceRows, approvedAssetRows);
}

export async function getApprovedMenuDownload(
    repoRoot: string,
    submissionId: string
): Promise<ApprovedMenuDownloadRecord | null> {
    const normalizedSubmissionId = `${submissionId || ''}`.trim();
    if (!normalizedSubmissionId) {
        return null;
    }

    let submission: ApprovedMenuSourceRow | null = null;
    let approvedAsset: ApprovedAssetRow | null = null;
    let sharePointAsset: ApprovedAssetRow | null = null;

    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        const submissionIdColumn = UUID_PATTERN.test(normalizedSubmissionId) ? 'id' : 'legacy_id';
        const { data, error } = await supabase
            .from(SUBMISSIONS_TABLE)
            .select('*')
            .eq(submissionIdColumn, normalizedSubmissionId)
            .maybeSingle();

        if (error) {
            throw new Error(error.message);
        }
        submission = data || null;

        if (submission) {
            const { data: assetData, error: assetError } = await supabase
                .from(ASSETS_TABLE)
                .select('*')
                .eq('submission_id', normalizedSubmissionId)
                .in('asset_type', ['approved_docx', 'sharepoint_approved_docx'])
                .order('created_at', { ascending: false })
                .limit(1);

            if (assetError) {
                console.warn('Failed to fetch approved download asset:', assetError.message);
            } else {
                const assets = Array.isArray(assetData) ? assetData : [];
                approvedAsset = assets.find((asset: ApprovedAssetRow) => asset.asset_type === 'approved_docx') || null;
                sharePointAsset = assets.find((asset: ApprovedAssetRow) => asset.asset_type === 'sharepoint_approved_docx') || null;
            }
        }
    } else {
        const dbDir = getLocalDbDir(repoRoot);
        const submissions = JSON.parse(await fs.readFile(path.join(dbDir, 'submissions.json'), 'utf-8'));
        submission = submissions[normalizedSubmissionId] || null;

        if (submission) {
            const assets = JSON.parse(await fs.readFile(path.join(dbDir, 'assets.json'), 'utf-8'));
            approvedAsset = (assets as ApprovedAssetRow[])
                .filter((asset) => `${asset.submission_id || ''}`.trim() === normalizedSubmissionId)
                .filter((asset) => asset.asset_type === 'approved_docx')
                .sort((a, b) => new Date(`${b.created_at || ''}`).getTime() - new Date(`${a.created_at || ''}`).getTime())[0] || null;
            sharePointAsset = (assets as ApprovedAssetRow[])
                .filter((asset) => `${asset.submission_id || ''}`.trim() === normalizedSubmissionId)
                .filter((asset) => asset.asset_type === 'sharepoint_approved_docx')
                .sort((a, b) => new Date(`${b.created_at || ''}`).getTime() - new Date(`${a.created_at || ''}`).getTime())[0] || null;
        }
    }

    if (!submission) {
        return null;
    }

    const status = `${submission.status || ''}`.trim().toLowerCase();
    if (!APPROVED_STATUSES.has(status) || !submission.final_path || (submission.source && submission.source !== 'form')) {
        return null;
    }

    const rawPayload = asObject(submission.raw_payload);
    const sharePointMeta = asObject(sharePointAsset?.meta);
    return {
        id: normalizedSubmissionId,
        filename: `${submission.filename || ''}`.trim(),
        finalPath: `${submission.final_path || ''}`.trim(),
        storagePath: `${approvedAsset?.storage_path || ''}`.trim(),
        sharePointStoragePath: `${sharePointAsset?.storage_path || ''}`.trim(),
        sharePointDriveId: `${sharePointMeta.drive_id || ''}`.trim(),
        status,
        approvedFileName: `${submission.filename || approvedAsset?.file_name || 'approved-menu.docx'}`.trim(),
        projectName: `${submission.project_name || ''}`.trim(),
        property: `${submission.property || ''}`.trim(),
        servicePeriod: `${submission.service_period || rawPayload.servicePeriod || ''}`.trim(),
        templateType: `${submission.template_type || rawPayload.templateType || 'food'}`.trim(),
        dateNeeded: `${submission.date_needed || rawPayload.dateNeeded || ''}`.trim(),
        menuType: `${submission.menu_type || rawPayload.menuType || 'standard'}`.trim(),
        orientation: `${submission.orientation || rawPayload.orientation || ''}`.trim(),
        size: `${submission.size || rawPayload.size || ''}`.trim(),
        allergens: `${submission.allergens || rawPayload.allergens || ''}`.trim(),
        approvedMenuContent: `${submission.approved_menu_content || ''}`.trim(),
        approvedMenuContentHtml: `${submission.approved_menu_content_html || ''}`.trim(),
        rawPayload,
    };
}
