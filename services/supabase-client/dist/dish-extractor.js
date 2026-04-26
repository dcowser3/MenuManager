"use strict";
/**
 * Dish Extractor
 *
 * Extracts individual dishes from approved menu content
 * and stores them in the approved_dishes table
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDishesFromText = extractDishesFromText;
exports.extractAndStoreDishes = extractAndStoreDishes;
exports.previewDishExtraction = previewDishExtraction;
const dishes_1 = require("./dishes");
// Common allergen codes
const ALLERGEN_CODES = ['VG', 'GF', 'DF', 'SF', 'C', 'D', 'E', 'F', 'G', 'N', 'V', 'S'];
const ALLERGEN_CODE_SET = new Set(ALLERGEN_CODES);
const NAME_DESCRIPTION_SEPARATORS = [' - ', ' – ', ' — ', ': '];
const TRAILING_CODE_PATTERN = ALLERGEN_CODES.join('|');
const TRAILING_CODE_GROUP = `(?:${TRAILING_CODE_PATTERN})`;
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
 * Extract dishes from menu content text
 */
function extractDishesFromText(menuContent) {
    const dishes = [];
    const lines = menuContent.split('\n').map(l => l.trim()).filter(Boolean);
    let currentCategory;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isFooterBoundary(line)) {
            break;
        }
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
            if (dish.usedNextLineAsDescription && lines[i + 1] && !extractPrice(lines[i + 1])) {
                i++;
            }
        }
    }
    return dishes;
}
/**
 * Detect if a line is a category header
 */
function detectCategory(line) {
    // Remove common formatting
    const cleanLine = line.replace(/[*_#]/g, '').trim();
    if (isFooterBoundary(cleanLine) || isHeaderLine(cleanLine)) {
        return null;
    }
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
function isHeaderLine(line) {
    // Skip common header patterns
    const headerPatterns = [
        /^menu$/i,
        /^.+\s+menu$/i,
        /^dinner$/i,
        /^lunch$/i,
        /^breakfast$/i,
        /^brunch$/i,
        /^\d+\.\d+\s*pp$/i, // Prix fixe price like "85.00 PP"
        /^wine\s*pairing/i,
        /^chef['']?s/i,
        /^table\s*d['']?h[oô]te/i,
        /^prix\s*fixe/i,
        /^\d+$/, // Just a number (course number)
        /^course\s*\d+/i
    ];
    for (const pattern of headerPatterns) {
        if (pattern.test(line.trim())) {
            return true;
        }
    }
    return false;
}
function isFooterBoundary(line) {
    return isAllergenLegendLine(line) || isAllergenLegendHeader(line) || isRawNoticeLine(line);
}
function isAllergenLegendHeader(line) {
    return /^allergen\s+key$/i.test(line.trim());
}
function isAllergenLegendLine(line) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return false;
    }
    if (normalized.includes('|')) {
        const parts = normalized.split('|').map(part => part.trim()).filter(Boolean);
        const matches = parts.filter(part => /^[A-Z]{1,3}\s+.+/.test(part));
        return parts.length >= 3 && matches.length >= Math.max(2, Math.floor(parts.length * 0.6));
    }
    return /^[A-Z]{1,3}\s+[A-Za-z][A-Za-z\s]+$/i.test(normalized);
}
function isRawNoticeLine(line) {
    const normalized = line.replace(/\s+/g, ' ').trim().toLowerCase();
    return normalized.includes('consuming raw or undercooked') && normalized.includes('foodborne illness');
}
/**
 * Parse a line as a dish
 */
function parseDishLine(line, nextLine) {
    // Skip very short lines
    if (line.length < 3) {
        return null;
    }
    const normalizedLine = normalizeAttachedAllergenCodes(line);
    // Extract price if present
    const price = extractPrice(normalizedLine);
    // Clean the line before splitting out name/description
    let body = normalizedLine;
    // Remove price from line
    body = body.replace(/\$?\d+\.?\d*\s*$/g, '').trim();
    body = body.replace(/\d+\.?\d*\s*$/g, '').trim();
    // Extract allergens from the line tail
    const { cleanedText, allergens } = extractTrailingAllergens(body);
    body = cleanedText.replace(/[,|]+\s*$/, '').trim();
    const { name, description: inlineDescription } = splitNameAndDescription(body);
    const dishName = name.trim();
    // If dish name is too short after cleaning, skip
    if (dishName.length < 3 || !/[A-Za-z]/.test(dishName)) {
        return null;
    }
    // Check if next line might be a description
    let description = inlineDescription;
    let usedNextLineAsDescription = false;
    if (!description && nextLine && !extractPrice(nextLine) && !detectCategory(nextLine) && !isFooterBoundary(nextLine) && !isHeaderLine(nextLine)) {
        // Next line doesn't have a price and isn't a category - might be description
        if (nextLine.length > 10 && nextLine.length < 200) {
            description = nextLine;
            usedNextLineAsDescription = true;
        }
    }
    return {
        name: dishName,
        description,
        price,
        allergens,
        usedNextLineAsDescription,
    };
}
/**
 * Extract price from a line
 */
function extractPrice(line) {
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
 * Extract allergen codes from a line tail and return the cleaned line
 */
function extractTrailingAllergens(line) {
    const normalizedLine = normalizeAttachedAllergenCodes(line);
    const match = normalizedLine.match(new RegExp(`(?:^|[\\s([{])(${TRAILING_CODE_GROUP}(?:\\s*[,/|]\\s*${TRAILING_CODE_GROUP})*)\\s*$`, 'i'));
    if (!match) {
        return {
            cleanedText: normalizedLine.trim(),
            allergens: [],
        };
    }
    const matchedCluster = match[1];
    const clusterIndex = (match.index ?? 0) + match[0].lastIndexOf(matchedCluster);
    const allergens = [];
    for (const token of matchedCluster.split(/[\s,/|]+/).filter(Boolean)) {
        const upperToken = token.toUpperCase();
        if (ALLERGEN_CODE_SET.has(upperToken) && !allergens.includes(upperToken)) {
            allergens.push(upperToken);
        }
    }
    return {
        cleanedText: normalizedLine.slice(0, clusterIndex).trim(),
        allergens,
    };
}
function normalizeAttachedAllergenCodes(line) {
    return line.replace(new RegExp(`([A-Za-zÀ-ÿ)])(${TRAILING_CODE_GROUP}(?:\\s*[,/|]\\s*${TRAILING_CODE_GROUP})+)(\\s*)$`, 'i'), '$1 $2$3');
}
function splitNameAndDescription(line) {
    for (const separator of NAME_DESCRIPTION_SEPARATORS) {
        const separatorIndex = line.indexOf(separator);
        if (separatorIndex <= 0) {
            continue;
        }
        const name = line.slice(0, separatorIndex).trim();
        const description = line.slice(separatorIndex + separator.length).trim();
        if (name.length >= 3 && description.length >= 3) {
            return {
                name,
                description,
            };
        }
    }
    return { name: line.trim() };
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
async function extractAndStoreDishes(menuContent, property, submissionId, options) {
    // Extract dishes from text
    const extractedDishes = extractDishesFromText(menuContent);
    if (extractedDishes.length === 0) {
        return { added: 0 };
    }
    // Convert to database format
    const dishes = extractedDishes.map(dish => ({
        dish_name: dish.name,
        property,
        service_period: options?.servicePeriod || undefined,
        menu_category: dish.category,
        description: dish.description,
        price: dish.price,
        allergens: dish.allergens.length > 0 ? dish.allergens : undefined,
        source_submission_id: submissionId
    }));
    // Batch insert all dishes
    await (0, dishes_1.createDishes)(dishes);
    return { added: dishes.length };
}
/**
 * Extract dishes without storing (for preview/testing)
 */
function previewDishExtraction(menuContent) {
    return extractDishesFromText(menuContent);
}
//# sourceMappingURL=dish-extractor.js.map