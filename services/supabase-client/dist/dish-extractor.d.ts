/**
 * Dish Extractor
 *
 * Extracts individual dishes from approved menu content
 * and stores them in the approved_dishes table
 */
import { CreateDishInput } from './types';
import { DishQualityResult, DishSourceContext } from './dish-quality';
/**
 * Extracted dish from menu parsing
 */
export interface ExtractedDish {
    name: string;
    description?: string;
    price?: string;
    allergens: string[];
    category?: string;
    usedNextLineAsDescription?: boolean;
}
export interface PreparedApprovedDish {
    index: number;
    extracted: ExtractedDish;
    input: CreateDishInput;
    quality: DishQualityResult;
    sourceContext: DishSourceContext;
    excludedByRule: boolean;
}
export interface StorePreparedDishesOptions {
    replaceExisting?: boolean;
    excludeIndexes?: Set<number>;
}
export interface ExtractAndStoreDishesOptions {
    servicePeriod?: string;
    replaceExisting?: boolean;
    excludeIndexes?: Set<number>;
}
export interface ExtractAndStoreDishesResult {
    added: number;
    extracted: number;
    skipped: number;
    qualityReviewCount: number;
    excludedByRuleCount: number;
}
export declare function normalizeDishPriceForProperty(price: string | undefined, property?: string): string | undefined;
export declare function isPrixFixeServicePeriod(servicePeriod: string | undefined): boolean;
export declare function normalizeDishPriceForStorage(price: string | undefined, property?: string, servicePeriod?: string): string | undefined;
/**
 * Extract dishes from menu content text
 */
export declare function extractDishesFromText(menuContent: string): ExtractedDish[];
/**
 * Extract dishes from approved menu and store in database
 *
 * Adds all dishes as a running list without deduplication.
 * Deduplication can be handled separately if needed.
 *
 * @param menuContent - The menu text content
 * @param property - The property/restaurant name
 * @param submissionId - The source submission ID
 * @returns Number of dishes added
 */
export declare function extractAndStoreDishes(menuContent: string, property: string, submissionId: string, options?: ExtractAndStoreDishesOptions): Promise<ExtractAndStoreDishesResult>;
export declare function prepareApprovedDishInputs(menuContent: string, property: string, submissionId: string, options?: {
    servicePeriod?: string;
}): PreparedApprovedDish[];
export declare function storePreparedApprovedDishes(prepared: PreparedApprovedDish[], submissionId: string, options?: StorePreparedDishesOptions): Promise<ExtractAndStoreDishesResult>;
/**
 * Extract dishes without storing (for preview/testing)
 */
export declare function previewDishExtraction(menuContent: string): ExtractedDish[];
//# sourceMappingURL=dish-extractor.d.ts.map