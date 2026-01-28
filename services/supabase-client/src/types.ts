/**
 * TypeScript interfaces for Menu Manager database tables
 */

// Submission status types
export type SubmissionStatus =
    | 'processing'
    | 'pending_ai_review'
    | 'pending_human_review'
    | 'approved'
    | 'rejected';

// Menu types
export type MenuType = 'standard' | 'prix_fixe';
export type TemplateType = 'food' | 'beverage';

// User roles
export type UserRole = 'chef' | 'reviewer' | 'admin';

// Workflow step status
export type WorkflowStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'skipped';

/**
 * Submission record
 */
export interface Submission {
    id: string;
    legacy_id?: string;

    // Form fields
    project_name: string;
    property: string;
    size?: string;
    orientation?: string;
    menu_type: MenuType;
    template_type: TemplateType;
    date_needed?: string;

    // Submitter
    submitter_email: string;

    // Content
    menu_content?: string;

    // File paths
    filename?: string;
    original_path?: string;
    ai_draft_path?: string;
    final_path?: string;

    // Status
    status: SubmissionStatus;
    changes_made: boolean;
    source: string;

    // Timestamps
    created_at: string;
    updated_at: string;
    reviewed_at?: string;
}

/**
 * Input for creating a new submission
 */
export interface CreateSubmissionInput {
    legacy_id?: string;
    project_name: string;
    property: string;
    size?: string;
    orientation?: string;
    menu_type?: MenuType;
    template_type?: TemplateType;
    date_needed?: string;
    submitter_email: string;
    menu_content?: string;
    filename?: string;
    original_path?: string;
    status?: SubmissionStatus;
    source?: string;
}

/**
 * Input for updating a submission
 */
export interface UpdateSubmissionInput {
    project_name?: string;
    property?: string;
    size?: string;
    orientation?: string;
    menu_type?: MenuType;
    template_type?: TemplateType;
    date_needed?: string;
    menu_content?: string;
    filename?: string;
    original_path?: string;
    ai_draft_path?: string;
    final_path?: string;
    status?: SubmissionStatus;
    changes_made?: boolean;
    reviewed_at?: string;
}

/**
 * Approved dish record
 */
export interface ApprovedDish {
    id: string;
    dish_name: string;
    dish_name_normalized: string;
    property?: string;
    menu_category?: string;
    description?: string;
    price?: string;
    allergens?: string[];
    source_submission_id?: string;
    is_active: boolean;
    created_at: string;
}

/**
 * Input for creating a new approved dish
 */
export interface CreateDishInput {
    dish_name: string;
    property?: string;
    menu_category?: string;
    description?: string;
    price?: string;
    allergens?: string[];
    source_submission_id?: string;
}

/**
 * User record
 */
export interface User {
    id: string;
    clerk_user_id?: string;
    email: string;
    name?: string;
    role: UserRole;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

/**
 * Approval workflow step
 */
export interface ApprovalWorkflowStep {
    id: string;
    submission_id: string;
    step_order: number;
    reviewer_id?: string;
    status: WorkflowStatus;
    notes?: string;
    assigned_at: string;
    completed_at?: string;
}
