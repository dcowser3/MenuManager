/**
 * Submission CRUD operations
 */

import { getSupabaseClient } from './index';
import {
    Submission,
    CreateSubmissionInput,
    UpdateSubmissionInput,
    SubmissionStatus
} from './types';

const TABLE = 'submissions';

/**
 * Create a new submission
 */
export async function createSubmission(input: CreateSubmissionInput): Promise<Submission> {
    const supabase = getSupabaseClient();

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

    return data as Submission;
}

/**
 * Get a submission by ID
 */
export async function getSubmission(id: string): Promise<Submission | null> {
    const supabase = getSupabaseClient();

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

    return data as Submission;
}

/**
 * Get a submission by legacy ID (for migration)
 */
export async function getSubmissionByLegacyId(legacyId: string): Promise<Submission | null> {
    const supabase = getSupabaseClient();

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

    return data as Submission;
}

/**
 * Update a submission
 */
export async function updateSubmission(
    id: string,
    input: UpdateSubmissionInput
): Promise<Submission> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
        .from(TABLE)
        .update(input)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        throw new Error(`Failed to update submission: ${error.message}`);
    }

    return data as Submission;
}

/**
 * Get submissions by status
 */
export async function getSubmissionsByStatus(
    status: SubmissionStatus
): Promise<Submission[]> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false });

    if (error) {
        throw new Error(`Failed to get submissions by status: ${error.message}`);
    }

    return data as Submission[];
}

/**
 * Get pending human review submissions
 */
export async function getPendingReviews(): Promise<Submission[]> {
    return getSubmissionsByStatus('pending_human_review');
}

/**
 * Get all submissions (paginated)
 */
export async function getAllSubmissions(
    limit = 50,
    offset = 0
): Promise<{ submissions: Submission[]; total: number }> {
    const supabase = getSupabaseClient();

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
        submissions: data as Submission[],
        total: count || 0
    };
}

/**
 * Mark submission as approved
 */
export async function approveSubmission(
    id: string,
    finalPath: string,
    changesMade: boolean
): Promise<Submission> {
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
export async function deleteSubmission(id: string): Promise<void> {
    const supabase = getSupabaseClient();

    const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq('id', id);

    if (error) {
        throw new Error(`Failed to delete submission: ${error.message}`);
    }
}
