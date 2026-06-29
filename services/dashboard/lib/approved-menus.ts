import { promises as fs } from 'fs';
import * as path from 'path';
import { getSupabaseClient, isSupabaseConfigured } from '@menumanager/supabase-client';

const SUBMISSIONS_TABLE = 'submissions';
const ASSETS_TABLE = 'assets';
const APPROVED_STATUSES = new Set(['approved', 'approved_override']);

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
};

export type ApprovedMenuDownloadRecord = {
    id: string;
    filename: string;
    finalPath: string;
    storagePath: string;
    status: string;
    approvedFileName: string;
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
};

type ApprovedAssetRow = {
    submission_id?: string;
    asset_type?: string;
    file_name?: string;
    storage_path?: string;
    created_at?: string;
};

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

    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from(SUBMISSIONS_TABLE)
            .select('*')
            .eq('id', normalizedSubmissionId)
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
                .eq('asset_type', 'approved_docx')
                .order('created_at', { ascending: false })
                .limit(1);

            if (assetError) {
                console.warn('Failed to fetch approved download asset:', assetError.message);
            } else {
                approvedAsset = Array.isArray(assetData) ? assetData[0] || null : null;
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
        }
    }

    if (!submission) {
        return null;
    }

    const status = `${submission.status || ''}`.trim().toLowerCase();
    if (!APPROVED_STATUSES.has(status) || !submission.final_path || (submission.source && submission.source !== 'form')) {
        return null;
    }

    return {
        id: normalizedSubmissionId,
        filename: `${submission.filename || ''}`.trim(),
        finalPath: `${submission.final_path || ''}`.trim(),
        storagePath: `${approvedAsset?.storage_path || ''}`.trim(),
        status,
        approvedFileName: `${submission.filename || approvedAsset?.file_name || 'approved-menu.docx'}`.trim(),
    };
}
