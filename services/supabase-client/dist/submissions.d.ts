/**
 * Submission CRUD operations
 */
import { Submission, CreateSubmissionInput, UpdateSubmissionInput, SubmissionStatus } from './types';
/**
 * Create a new submission
 */
export declare function createSubmission(input: CreateSubmissionInput): Promise<Submission>;
/**
 * Get a submission by ID
 */
export declare function getSubmission(id: string): Promise<Submission | null>;
/**
 * Get a submission by legacy ID (for migration)
 */
export declare function getSubmissionByLegacyId(legacyId: string): Promise<Submission | null>;
/**
 * Update a submission
 */
export declare function updateSubmission(id: string, input: UpdateSubmissionInput): Promise<Submission>;
/**
 * Get submissions by status
 */
export declare function getSubmissionsByStatus(status: SubmissionStatus): Promise<Submission[]>;
/**
 * Get pending human review submissions
 */
export declare function getPendingReviews(): Promise<Submission[]>;
/**
 * Get all submissions (paginated)
 */
export declare function getAllSubmissions(limit?: number, offset?: number): Promise<{
    submissions: Submission[];
    total: number;
}>;
/**
 * Mark submission as approved
 */
export declare function approveSubmission(id: string, finalPath: string, changesMade: boolean): Promise<Submission>;
/**
 * Delete a submission (soft delete by setting status)
 */
export declare function deleteSubmission(id: string): Promise<void>;
//# sourceMappingURL=submissions.d.ts.map