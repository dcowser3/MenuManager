/**
 * Dish Extractor
 *
 * Extracts individual dishes from approved menu content
 * and stores them in the approved_dishes table
 */
/**
 * Extracted dish from menu parsing
 */
interface ExtractedDish {
    name: string;
    description?: string;
    price?: string;
    allergens: string[];
    category?: string;
}
/**
 * Extract dishes from menu content text
 */
export declare function extractDishesFromText(menuContent: string): ExtractedDish[];
/**
 * Extract dishes from approved menu and store in database
 *
 * @param menuContent - The menu text content
 * @param property - The property/restaurant name
 * @param submissionId - The source submission ID
 * @returns Number of new dishes added
 */
export declare function extractAndStoreDishes(menuContent: string, property: string, submissionId: string): Promise<{
    added: number;
    skipped: number;
}>;
/**
 * Extract dishes without storing (for preview/testing)
 */
export declare function previewDishExtraction(menuContent: string): ExtractedDish[];
export {};
//# sourceMappingURL=dish-extractor.d.ts.map