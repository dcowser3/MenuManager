/**
 * Dish Extractor
 *
 * Extracts individual dishes from approved menu content
 * and stores them in the approved_dishes table
 */

import { createDishes } from './dishes';
import { CreateDishInput } from './types';

// Common allergen codes
const ALLERGEN_CODES = ['GF', 'V', 'VG', 'DF', 'N', 'SF', 'S', '*'];

// Category detection patterns
const CATEGORY_PATTERNS = [
    /^(appetizers?|starters?|first\s*course)/i,
    /^(salads?)/i,
    /^(soups?)/i,
    /^(entr[eé]es?|mains?|main\s*course)/i,
    /^(seafood|fish)/i,
    /^(meats?|poultry|beef|chicken|pork|lamb)/i,
    /^(pasta|risotto)/i,
    /^(sides?|side\s*dishes?|accompaniments?)/i,
    /^(desserts?|sweets?)/i,
    /^(beverages?|drinks?)/i,
    /^(cocktails?)/i,
    /^(wines?)/i,
    /^(beers?)/i,
    /^(spirits?)/i
];

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
export function extractDishesFromText(menuContent: string): ExtractedDish[] {
    const dishes: ExtractedDish[] = [];
    const lines = menuContent.split('\n').map(l => l.trim()).filter(Boolean);

    let currentCategory: string | undefined;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check if this line is a category header
        const categoryMatch = detectCategory(line);
        if (categoryMatch) {
            currentCategory = categoryMatch;
            continue;
        }

        // Skip lines that are clearly headers or metadata
        if (isHeaderLine(line)) {
            continue;
        }

        // Try to parse as a dish
        const dish = parseDishLine(line, lines[i + 1]);
        if (dish) {
            dish.category = currentCategory;
            dishes.push(dish);

            // If we used the next line as description, skip it
            if (dish.description && lines[i + 1] && !extractPrice(lines[i + 1])) {
                i++;
            }
        }
    }

    return dishes;
}

/**
 * Detect if a line is a category header
 */
function detectCategory(line: string): string | null {
    // Remove common formatting
    const cleanLine = line.replace(/[*_#]/g, '').trim();

    // Check against known category patterns
    for (const pattern of CATEGORY_PATTERNS) {
        if (pattern.test(cleanLine)) {
            return cleanLine;
        }
    }

    // Check if line is all caps (common for category headers)
    if (cleanLine === cleanLine.toUpperCase() && cleanLine.length > 3 && cleanLine.length < 30) {
        // Make sure it's not a dish name with a price
        if (!extractPrice(cleanLine)) {
            return cleanLine;
        }
    }

    return null;
}

/**
 * Check if line is a header/metadata (not a dish)
 */
function isHeaderLine(line: string): boolean {
    const lowerLine = line.toLowerCase();

    // Skip common header patterns
    const headerPatterns = [
        /^menu$/i,
        /^dinner$/i,
        /^lunch$/i,
        /^breakfast$/i,
        /^brunch$/i,
        /^\d+\.\d+\s*pp$/i,  // Prix fixe price like "85.00 PP"
        /^wine\s*pairing/i,
        /^chef['']?s/i,
        /^table\s*d['']?h[oô]te/i,
        /^prix\s*fixe/i,
        /^\d+$/,  // Just a number (course number)
        /^course\s*\d+/i
    ];

    for (const pattern of headerPatterns) {
        if (pattern.test(line.trim())) {
            return true;
        }
    }

    return false;
}

/**
 * Parse a line as a dish
 */
function parseDishLine(line: string, nextLine?: string): ExtractedDish | null {
    // Skip very short lines
    if (line.length < 3) {
        return null;
    }

    // Extract price if present
    const price = extractPrice(line);

    // Extract allergens
    const allergens = extractAllergens(line);

    // Clean the line to get dish name
    let dishName = line;

    // Remove price from line
    dishName = dishName.replace(/\$?\d+\.?\d*\s*$/g, '').trim();
    dishName = dishName.replace(/\d+\.?\d*\s*$/g, '').trim();

    // Remove allergen codes
    for (const code of ALLERGEN_CODES) {
        dishName = dishName.replace(new RegExp(`\\b${code}\\b`, 'gi'), '').trim();
    }

    // Remove trailing punctuation and pipes
    dishName = dishName.replace(/[,|]+\s*$/, '').trim();

    // If dish name is too short after cleaning, skip
    if (dishName.length < 3) {
        return null;
    }

    // Check if next line might be a description
    let description: string | undefined;
    if (nextLine && !extractPrice(nextLine) && !detectCategory(nextLine)) {
        // Next line doesn't have a price and isn't a category - might be description
        if (nextLine.length > 10 && nextLine.length < 200) {
            description = nextLine;
        }
    }

    return {
        name: dishName,
        description,
        price,
        allergens
    };
}

/**
 * Extract price from a line
 */
function extractPrice(line: string): string | undefined {
    // Match various price formats: $12, $12.00, 12, 12.00
    const priceMatch = line.match(/\$?\d+\.?\d{0,2}\s*$/);
    if (priceMatch) {
        const price = priceMatch[0].trim();
        // Only return if it looks like a reasonable price (not a year, etc.)
        const numericPrice = parseFloat(price.replace('$', ''));
        if (numericPrice > 0 && numericPrice < 1000) {
            return price;
        }
    }
    return undefined;
}

/**
 * Extract allergen codes from a line
 */
function extractAllergens(line: string): string[] {
    const allergens: string[] = [];

    for (const code of ALLERGEN_CODES) {
        // Match allergen code as standalone word
        const pattern = new RegExp(`\\b${code}\\b`, 'gi');
        if (pattern.test(line)) {
            allergens.push(code.toUpperCase());
        }
    }

    return [...new Set(allergens)]; // Remove duplicates
}

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
export async function extractAndStoreDishes(
    menuContent: string,
    property: string,
    submissionId: string
): Promise<{ added: number }> {
    // Extract dishes from text
    const extractedDishes = extractDishesFromText(menuContent);

    if (extractedDishes.length === 0) {
        return { added: 0 };
    }

    // Convert to database format
    const dishes: CreateDishInput[] = extractedDishes.map(dish => ({
        dish_name: dish.name,
        property,
        menu_category: dish.category,
        description: dish.description,
        price: dish.price,
        allergens: dish.allergens.length > 0 ? dish.allergens : undefined,
        source_submission_id: submissionId
    }));

    // Batch insert all dishes
    await createDishes(dishes);

    return { added: dishes.length };
}

/**
 * Extract dishes without storing (for preview/testing)
 */
export function previewDishExtraction(menuContent: string): ExtractedDish[] {
    return extractDishesFromText(menuContent);
}
