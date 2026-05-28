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
exports.HUMAN_REVIEW_COMPARISON_SOURCE = void 0;
exports.assertValidLearningSubmissionId = assertValidLearningSubmissionId;
exports.buildLearningComparisonKey = buildLearningComparisonKey;
exports.isHumanReviewLearningEntry = isHumanReviewLearningEntry;
exports.upsertTrainingEntry = upsertTrainingEntry;
exports.dedupeTrainingEntries = dedupeTrainingEntries;
exports.getLearningAggregationEntries = getLearningAggregationEntries;
exports.deleteLearningSubmissionFromFiles = deleteLearningSubmissionFromFiles;
const fs_1 = require("fs");
const path = __importStar(require("path"));
exports.HUMAN_REVIEW_COMPARISON_SOURCE = 'human_review_final_approval';
function assertValidLearningSubmissionId(submissionId) {
    const normalized = `${submissionId || ''}`.trim();
    if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
        const error = new Error('submissionId must contain only letters, numbers, dashes, or underscores');
        error.code = 'INVALID_SUBMISSION_ID';
        throw error;
    }
    return normalized;
}
function normalizeKeyPart(value) {
    return `${value || ''}`.trim().toLowerCase();
}
function buildLearningComparisonKey(entry) {
    const submissionId = normalizeKeyPart(entry.submission_id);
    const comparisonSource = normalizeKeyPart(entry.comparison_source) || 'legacy';
    if (submissionId) {
        return JSON.stringify([submissionId, comparisonSource]);
    }
    return JSON.stringify([
        comparisonSource,
        `${entry.ai_draft_path || ''}`.trim(),
        `${entry.final_path || ''}`.trim(),
    ]);
}
function isHumanReviewLearningEntry(entry) {
    return entry.learning_eligible === true &&
        entry.changed_by_human === true &&
        normalizeKeyPart(entry.comparison_source) === exports.HUMAN_REVIEW_COMPARISON_SOURCE;
}
function upsertTrainingEntry(entries, nextEntry) {
    const nextKey = buildLearningComparisonKey(nextEntry);
    const retained = [];
    let replacedEntries = 0;
    for (const entry of entries) {
        if (buildLearningComparisonKey(entry) === nextKey) {
            replacedEntries += 1;
            continue;
        }
        retained.push(entry);
    }
    retained.push(nextEntry);
    return {
        entries: retained,
        replaced_entries: replacedEntries,
    };
}
function dedupeTrainingEntries(entries) {
    const latestByKey = new Map();
    for (const entry of entries) {
        const key = buildLearningComparisonKey(entry);
        const existing = latestByKey.get(key);
        if (!existing) {
            latestByKey.set(key, entry);
            continue;
        }
        const existingTs = new Date(existing.timestamp || 0).getTime();
        const entryTs = new Date(entry.timestamp || 0).getTime();
        if (entryTs >= existingTs) {
            latestByKey.set(key, entry);
        }
    }
    return Array.from(latestByKey.values());
}
function getLearningAggregationEntries(entries) {
    return dedupeTrainingEntries(entries.filter(isHumanReviewLearningEntry));
}
async function deleteLearningSubmissionFromFiles(input) {
    const normalizedId = assertValidLearningSubmissionId(input.submissionId);
    const content = await fs_1.promises.readFile(input.trainingDataFile, 'utf-8');
    const entries = content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        try {
            return JSON.parse(line);
        }
        catch {
            return null;
        }
    })
        .filter((entry) => entry !== null);
    const remaining = entries.filter((entry) => entry.submission_id !== normalizedId);
    const deletedEntries = entries.length - remaining.length;
    const lines = remaining.map((entry) => JSON.stringify(entry)).join('\n');
    await fs_1.promises.writeFile(input.trainingDataFile, lines ? `${lines}\n` : '');
    let deletedDetailFile = false;
    const detailPath = path.join(input.differencesDir, `${normalizedId}-comparison.json`);
    try {
        await fs_1.promises.unlink(detailPath);
        deletedDetailFile = true;
    }
    catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
    const snapshot = await input.rebuildSnapshot();
    return {
        submission_id: normalizedId,
        deleted_entries: deletedEntries,
        deleted_detail_file: deletedDetailFile,
        remaining_entries: remaining.length,
        total_rules: snapshot.total_rules,
    };
}
