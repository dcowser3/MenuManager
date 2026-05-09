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
exports.listApprovedMenus = listApprovedMenus;
exports.getApprovedMenuDownload = getApprovedMenuDownload;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const supabase_client_1 = require("@menumanager/supabase-client");
const SUBMISSIONS_TABLE = 'submissions';
const ASSETS_TABLE = 'assets';
const APPROVED_STATUSES = new Set(['approved', 'approved_override']);
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
        return {
            id,
            projectName: `${row.project_name || ''}`.trim(),
            property: `${row.property || ''}`.trim(),
            filename: `${row.filename || ''}`.trim(),
            approvedFileName: `${approvedAsset?.file_name || row.filename || 'approved-menu.docx'}`.trim(),
            reviewedAt: `${row.reviewed_at || row.updated_at || ''}`.trim(),
            servicePeriod: `${row.service_period || ''}`.trim(),
            submitterName: `${row.submitter_name || ''}`.trim(),
            status: `${row.status || ''}`.trim(),
        };
    });
}
async function listApprovedMenus(repoRoot, query = '', limit = 100) {
    const normalizedQuery = `${query || ''}`.trim().toLowerCase();
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
        if (normalizedQuery) {
            const like = `%${normalizedQuery}%`;
            submissionsQuery = submissionsQuery.or(`project_name.ilike.${like},property.ilike.${like},filename.ilike.${like},submitter_name.ilike.${like},service_period.ilike.${like}`);
        }
        const { data, error } = await submissionsQuery;
        if (error) {
            throw new Error(error.message);
        }
        sourceRows = (data || []).filter((row) => !row.source || row.source === 'form');
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
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const supabase = (0, supabase_client_1.getSupabaseClient)();
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
            }
            else {
                approvedAsset = Array.isArray(assetData) ? assetData[0] || null : null;
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
        approvedFileName: `${approvedAsset?.file_name || submission.filename || 'approved-menu.docx'}`.trim(),
    };
}
