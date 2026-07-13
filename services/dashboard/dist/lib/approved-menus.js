"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichApprovedMenuList = enrichApprovedMenuList;
exports.listApprovedMenus = listApprovedMenus;
exports.getApprovedMenuDownload = getApprovedMenuDownload;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const supabase_client_1 = require("@menumanager/supabase-client");
const SUBMISSIONS_TABLE = 'submissions';
const ASSETS_TABLE = 'assets';
const APPROVED_STATUSES = new Set(['approved', 'approved_override']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function asObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        }
        catch {
            return {};
        }
    }
    return {};
}
function getLocalDbDir(repoRoot) {
    return path.join(repoRoot, 'tmp', 'db');
}
function matchesApprovedSearch(row, query) {
    if (!query)
        return true;
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
function matchesRestaurant(row, restaurant) {
    if (!restaurant)
        return true;
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
function matchesServicePeriod(row, servicePeriod) {
    if (!servicePeriod)
        return true;
    return `${row.service_period || ''}`.trim().toLowerCase().includes(servicePeriod);
}
function buildApprovedMenuList(sourceRows, approvedAssetRows) {
    const approvedAssetBySubmission = new Map();
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
function enrichApprovedMenuList(menus, drafts = [], lineage = {}) {
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
async function listApprovedMenus(repoRoot, filtersOrQuery = '', limit = 100) {
    const filters = typeof filtersOrQuery === 'string'
        ? { query: filtersOrQuery }
        : filtersOrQuery || {};
    const normalizedQuery = `${filters.query || ''}`.trim().toLowerCase();
    const normalizedRestaurant = `${filters.restaurant || ''}`.trim().toLowerCase();
    const normalizedServicePeriod = `${filters.servicePeriod || ''}`.trim().toLowerCase();
    const boundedLimit = Math.min(Math.max(limit, 1), 200);
    let sourceRows = [];
    let approvedAssetRows = [];
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        let submissionsQuery = supabase
            .from(SUBMISSIONS_TABLE)
            .select('*')
            .in('status', Array.from(APPROVED_STATUSES))
            .not('final_path', 'is', null)
            .order('reviewed_at', { ascending: false })
            .order('updated_at', { ascending: false })
            .limit(boundedLimit);
        const prefilterTerms = [];
        if (normalizedQuery) {
            const like = `%${normalizedQuery}%`;
            prefilterTerms.push(`project_name.ilike.${like}`, `property.ilike.${like}`, `filename.ilike.${like}`, `submitter_name.ilike.${like}`, `service_period.ilike.${like}`);
        }
        if (normalizedRestaurant) {
            const like = `%${normalizedRestaurant}%`;
            prefilterTerms.push(`property.ilike.${like}`, `project_name.ilike.${like}`, `filename.ilike.${like}`);
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
            .filter((row) => !row.source || row.source === 'form')
            .filter((row) => matchesApprovedSearch(row, normalizedQuery))
            .filter((row) => matchesRestaurant(row, normalizedRestaurant))
            .filter((row) => matchesServicePeriod(row, normalizedServicePeriod));
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
            }
            else {
                approvedAssetRows = assetData || [];
            }
        }
    }
    else {
        const dbDir = getLocalDbDir(repoRoot);
        const submissions = JSON.parse(await fs_1.promises.readFile(path.join(dbDir, 'submissions.json'), 'utf-8'));
        sourceRows = Object.values(submissions)
            .filter((row) => APPROVED_STATUSES.has(`${row.status || ''}`.trim().toLowerCase()))
            .filter((row) => !!row.final_path)
            .filter((row) => !row.source || row.source === 'form')
            .filter((row) => matchesApprovedSearch(row, normalizedQuery))
            .filter((row) => matchesRestaurant(row, normalizedRestaurant))
            .filter((row) => matchesServicePeriod(row, normalizedServicePeriod))
            .sort((a, b) => new Date(`${b.reviewed_at || b.updated_at || ''}`).getTime() - new Date(`${a.reviewed_at || a.updated_at || ''}`).getTime())
            .slice(0, boundedLimit);
        const assets = JSON.parse(await fs_1.promises.readFile(path.join(dbDir, 'assets.json'), 'utf-8'));
        approvedAssetRows = assets
            .filter((asset) => asset.asset_type === 'approved_docx')
            .sort((a, b) => new Date(`${b.created_at || ''}`).getTime() - new Date(`${a.created_at || ''}`).getTime());
    }
    return buildApprovedMenuList(sourceRows, approvedAssetRows);
}
async function getApprovedMenuDownload(repoRoot, submissionId) {
    const normalizedSubmissionId = `${submissionId || ''}`.trim();
    if (!normalizedSubmissionId) {
        return null;
    }
    let submission = null;
    let approvedAsset = null;
    let sharePointAsset = null;
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const supabase = (0, supabase_client_1.getSupabaseClient)();
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
            }
            else {
                const assets = Array.isArray(assetData) ? assetData : [];
                approvedAsset = assets.find((asset) => asset.asset_type === 'approved_docx') || null;
                sharePointAsset = assets.find((asset) => asset.asset_type === 'sharepoint_approved_docx') || null;
            }
        }
    }
    else {
        const dbDir = getLocalDbDir(repoRoot);
        const submissions = JSON.parse(await fs_1.promises.readFile(path.join(dbDir, 'submissions.json'), 'utf-8'));
        submission = submissions[normalizedSubmissionId] || null;
        if (submission) {
            const assets = JSON.parse(await fs_1.promises.readFile(path.join(dbDir, 'assets.json'), 'utf-8'));
            approvedAsset = assets
                .filter((asset) => `${asset.submission_id || ''}`.trim() === normalizedSubmissionId)
                .filter((asset) => asset.asset_type === 'approved_docx')
                .sort((a, b) => new Date(`${b.created_at || ''}`).getTime() - new Date(`${a.created_at || ''}`).getTime())[0] || null;
            sharePointAsset = assets
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
