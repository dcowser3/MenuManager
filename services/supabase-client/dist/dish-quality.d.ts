export type DishQualitySeverity = 'high' | 'medium' | 'info';
export type DishQualityDisposition = 'keep' | 'review' | 'exclude';
export interface ApprovedDishQualityInput {
    id?: string;
    dish_name?: string;
    property?: string;
    service_period?: string;
    menu_category?: string;
    description?: string;
    price?: string;
    allergens?: string[];
    source_submission_id?: string;
}
export interface DishQualityIssue {
    code: string;
    severity: DishQualitySeverity;
    reason: string;
}
export interface DishQualityContext {
    exactDuplicateCounts?: Map<string, number>;
    sameNameCategoryCounts?: Map<string, number>;
}
export interface DishSourceContext {
    sourceLine: string;
    previousLine: string;
    nextLine: string;
    context: string;
    lineNumber?: number;
}
export interface DishQualityResult {
    issues: DishQualityIssue[];
    disposition: DishQualityDisposition;
    highestSeverity?: DishQualitySeverity;
}
export declare function normalizeDishQualityText(value: unknown): string;
export declare function buildExactDuplicateKey(dish: ApprovedDishQualityInput): string;
export declare function buildSameNameCategoryKey(dish: ApprovedDishQualityInput): string;
export declare function buildDishQualityContext(dishes: ApprovedDishQualityInput[]): DishQualityContext;
export declare function analyzeApprovedDishQuality(dish: ApprovedDishQualityInput, context?: DishQualityContext): DishQualityResult;
export declare function findDishSourceContext(menuText: string | undefined, dish: ApprovedDishQualityInput): DishSourceContext;
//# sourceMappingURL=dish-quality.d.ts.map