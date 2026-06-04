import { PreparedApprovedDish } from './dish-extractor';
import { ApprovedDishQualityInput } from './dish-quality';
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
export declare function summarizeApprovedDishRows(rows: ApprovedDishQualityInput[]): ApprovedDishRepairIssueSummary;
export declare function resolveApprovedDishRepairMenuText(submission: {
    approved_menu_content?: string;
    menu_content?: string;
}): string;
export declare function buildApprovedDishRepairCandidate(input: {
    submission: ApprovedDishRepairSubmission;
    beforeRows: ApprovedDishRepairRow[];
    prepared: PreparedApprovedDish[];
    includeClean?: boolean;
    maxCountDropRatio?: number;
}): ApprovedDishRepairCandidate;
export declare function runApprovedDishRepair(options?: ApprovedDishRepairOptions): Promise<ApprovedDishRepairReport>;
export {};
//# sourceMappingURL=approved-dish-repair.d.ts.map