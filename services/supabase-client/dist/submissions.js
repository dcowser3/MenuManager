"use strict";
/**
 * Submission CRUD operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSubmission = createSubmission;
exports.getSubmission = getSubmission;
exports.getSubmissionByLegacyId = getSubmissionByLegacyId;
exports.updateSubmission = updateSubmission;
exports.getSubmissionsByStatus = getSubmissionsByStatus;
exports.getPendingReviews = getPendingReviews;
exports.getAllSubmissions = getAllSubmissions;
exports.approveSubmission = approveSubmission;
exports.deleteSubmission = deleteSubmission;
const index_1 = require("./index");
const TABLE = 'submissions';
/**
 * Create a new submission
 */
async function createSubmission(input) {
    const supabase = (0, index_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from(TABLE)
        .insert({
        ...input,
        menu_type: input.menu_type || 'standard',
        template_type: input.template_type || 'food',
        status: input.status || 'processing',
        source: input.source || 'form'
    })
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to create submission: ${error.message}`);
    }
    return data;
}
/**
 * Get a submission by ID
 */
async function getSubmission(id) {
    const supabase = (0, index_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('id', id)
        .single();
    if (error) {
        if (error.code === 'PGRST116') {
            return null; // Not found
        }
        throw new Error(`Failed to get submission: ${error.message}`);
    }
    return data;
}
/**
 * Get a submission by legacy ID (for migration)
 */
async function getSubmissionByLegacyId(legacyId) {
    const supabase = (0, index_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('legacy_id', legacyId)
        .single();
    if (error) {
        if (error.code === 'PGRST116') {
            return null; // Not found
        }
        throw new Error(`Failed to get submission by legacy ID: ${error.message}`);
    }
    return data;
}
/**
 * Update a submission
 */
async function updateSubmission(id, input) {
    const supabase = (0, index_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from(TABLE)
        .update(input)
        .eq('id', id)
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to update submission: ${error.message}`);
    }
    return data;
}
/**
 * Get submissions by status
 */
async function getSubmissionsByStatus(status) {
    const supabase = (0, index_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false });
    if (error) {
        throw new Error(`Failed to get submissions by status: ${error.message}`);
    }
    return data;
}
/**
 * Get pending human review submissions
 */
async function getPendingReviews() {
    return getSubmissionsByStatus('pending_human_review');
}
/**
 * Get all submissions (paginated)
 */
async function getAllSubmissions(limit = 50, offset = 0) {
    const supabase = (0, index_1.getSupabaseClient)();
    // Get total count
    const { count, error: countError } = await supabase
        .from(TABLE)
        .select('*', { count: 'exact', head: true });
    if (countError) {
        throw new Error(`Failed to count submissions: ${countError.message}`);
    }
    // Get paginated data
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) {
        throw new Error(`Failed to get submissions: ${error.message}`);
    }
    return {
        submissions: data,
        total: count || 0
    };
}
/**
 * Mark submission as approved
 */
async function approveSubmission(id, finalPath, changesMade) {
    return updateSubmission(id, {
        status: 'approved',
        final_path: finalPath,
        changes_made: changesMade,
        reviewed_at: new Date().toISOString()
    });
}
/**
 * Delete a submission (soft delete by setting status)
 */
async function deleteSubmission(id) {
    const supabase = (0, index_1.getSupabaseClient)();
    const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq('id', id);
    if (error) {
        throw new Error(`Failed to delete submission: ${error.message}`);
    }
}
//# sourceMappingURL=submissions.js.map