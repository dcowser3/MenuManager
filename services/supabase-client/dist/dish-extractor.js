"use strict";
/**
 * Dish Extractor
 *
 * Extracts individual dishes from approved menu content
 * and stores them in the approved_dishes table
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDishPriceForProperty = normalizeDishPriceForProperty;
exports.isPrixFixeServicePeriod = isPrixFixeServicePeriod;
exports.normalizeDishPriceForStorage = normalizeDishPriceForStorage;
exports.extractDishesFromText = extractDishesFromText;
exports.extractAndStoreDishes = extractAndStoreDishes;
exports.previewDishExtraction = previewDishExtraction;
const dishes_1 = require("./dishes");
// Common allergen codes
const ALLERGEN_CODES = ['VG', 'GF', 'DF', 'SF', 'PN', 'TN', 'SE', 'SL', 'SS', 'SY', 'CE', 'ET', 'MO', 'MU', 'A', 'C', 'D', 'E', 'F', 'G', 'M', 'N', 'P', 'V', 'S', 'T'];
const ALLERGEN_CODE_SET = new Set(ALLERGEN_CODES);
const NAME_DESCRIPTION_SEPARATORS = [' - ', ' – ', ' — ', ': '];
const TRAILING_CODE_PATTERN = ALLERGEN_CODES.join('|');
const TRAILING_CODE_GROUP = `(?:${TRAILING_CODE_PATTERN})`;
const PRICE_NUMBER_PATTERN = '\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?';
const CURRENCY_CODE_PATTERN = '(?:AED|QAR|USD|MXN)';
const PRICE_TAIL_REGEX = new RegExp(`(?:(?:${CURRENCY_CODE_PATTERN})\\s*)?(?:[$€£]\\s*)?${PRICE_NUMBER_PATTERN}(?:\\s*\\/\\s*(?:(?:${CURRENCY_CODE_PATTERN})\\s*)?(?:[$€£]\\s*)?${PRICE_NUMBER_PATTERN})*\\s*(?:${CURRENCY_CODE_PATTERN})?\\s*$`, 'i');
const PAREN_PRICE_TAIL_REGEX = new RegExp(`\\(\\s*((?:[$€£]\\s*)?${PRICE_NUMBER_PATTERN}(?:\\s*\\/\\s*(?:[$€£]\\s*)?${PRICE_NUMBER_PATTERN})*)\\s*\\)\\s*$`, 'i');
const PRIX_FIXE_PRICE_LABEL = 'prix fixe';
const ALLERGEN_CLUSTER_SEQUENCE = `${TRAILING_CODE_GROUP}(?:\\s*[,/.\\s]\\s*${TRAILING_CODE_GROUP})*`;
const TRAILING_ALLERGEN_CLUSTER_REGEX = new RegExp(`(?:(?:\\s+|\\*)[(]?\\s*${ALLERGEN_CLUSTER_SEQUENCE}\\s*[)]?\\s*\\*?\\s*)+$`, 'i');
const GEOGRAPHIC_HEADINGS = new Set([
    'argentina',
    'australia',
    'california',
    'chile',
    'france',
    'italy',
    'mexico',
    'new zealand',
    'oregon',
    'portugal',
    'sicily',
    'spain',
    'usa',
    'washington',
]);
const SHORT_SECTION_HEADINGS = new Set([
    'gin',
    'mas',
    'red',
    'rosé',
    'rose',
    'rum',
    'tea',
    'wok',
]);
// Category detection patterns
const CATEGORY_PATTERNS = [
    /^(a\s+la\s+carte)/i,
    /^(for\s+the\s+table)/i,
    /^(appetizers?|starters?|antojitos|entradas?|first\s*course)/i,
    /^(salads?)/i,
    /^(soups?)/i,
    /^(tacos?)/i,
    /^(suviche\s+bar|ceviche|sushi|rolls?)/i,
    /^(entr[eé]es?|mains?|main\s*course)/i,
    /^(chef['’]?s\s+specialt(?:y|ies))/i,
    /^(seafood|fish)/i,
    /^(meats?|poultry|beef|chicken|pork|lamb)/i,
    /^(churrasco|grill|halal)/i,
    /^(pasta|risotto)/i,
    /^(sides?|side\s*dishes?|accompaniments?)/i,
    /^(desserts?|sweets?|postres)/i,
    /^(beverages?|drinks?)/i,
    /^(cocktails?)/i,
    /^(wines?)/i,
    /^(beers?)/i,
    /^(spirits?)/i
];
function normalizeDishPriceForProperty(price, property) {
    const cleanPrice = `${price || ''}`.replace(/\s+/g, ' ').trim();
    if (!cleanPrice) {
        return undefined;
    }
    const glassBottleMatch = cleanPrice.match(/^GL\s*(\d+(?:\.\d{1,2})?)\s*\/\s*BTL\s*(\d+(?:\.\d{1,2})?)$/i);
    if (glassBottleMatch) {
        return `${glassBottleMatch[1]}/${glassBottleMatch[2]}`;
    }
    return cleanPrice
        .replace(/[$€£]/g, '')
        .replace(/,/g, '')
        .replace(/\b(?:USD|MXN|QAR|AED)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function isPrixFixeServicePeriod(servicePeriod) {
    const normalized = `${servicePeriod || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    return /\b(?:prix|set|half\s*board|event|new\s*year|nye|valentine|restaurant\s*week|private\s*group|sushi\s*&\s*bubbly|buffet|brunch|mother|easter|hanagasumi|hasakura|sakura|orthodox\s*christmas|cinco\s*de\s*mayo|ladies)\b/.test(normalized);
}
function normalizeDishPriceForStorage(price, property, servicePeriod) {
    const fallbackPrice = price || (isPrixFixeServicePeriod(servicePeriod) ? PRIX_FIXE_PRICE_LABEL : undefined);
    return normalizeDishPriceForProperty(fallbackPrice, property);
}
/**
 * Extract dishes from menu content text
 */
function extractDishesFromText(menuContent) {
    const dishes = [];
    const lines = menuContent.split('\n').map(l => l.trim()).filter(Boolean);
    let currentCategory;
    let currentCategoryPrice;
    let currentMenuPrice = inferMenuPriceLabel(lines);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isFooterBoundary(line)) {
            break;
        }
        if (isPrixFixeMenuMarker(line)) {
            currentMenuPrice = PRIX_FIXE_PRICE_LABEL;
            const markerCategory = cleanSectionCategoryName(line);
            if (markerCategory && isMenuTitleCategory(markerCategory)) {
                currentCategory = markerCategory;
            }
            continue;
        }
        if (currentCategory && isReusableSectionPriceOnlyLine(line, currentCategory)) {
            currentCategoryPrice = extractPrice(line);
            continue;
        }
        const sectionPrice = extractSectionPrice(line);
        if (sectionPrice && isSectionPriceLine(line)) {
            const sectionCategory = cleanSectionCategoryName(line);
            if (sectionCategory) {
                currentCategory = sectionCategory;
            }
            if (isPersistentSectionPriceLine(line)) {
                currentMenuPrice = PRIX_FIXE_PRICE_LABEL;
                currentCategoryPrice = undefined;
            }
            else {
                currentCategoryPrice = sectionPrice;
            }
            continue;
        }
        const twoLineDish = parseTwoLineDish(line, lines[i + 1]);
        if (twoLineDish) {
            twoLineDish.category = currentCategory;
            if (!twoLineDish.price) {
                twoLineDish.price = currentCategoryPrice || currentMenuPrice;
            }
            twoLineDish.name = normalizeDishNameForCategory(twoLineDish.name, currentCategory);
            const isLowercaseFragment = isLowercaseOneWordFragment(twoLineDish.name, twoLineDish.description) ||
                isLowercaseIngredientFragment(twoLineDish.name, twoLineDish.description, undefined);
            if (isLowercaseFragment) {
                continue;
            }
            if (isNonDishLine(twoLineDish.name) || isSameCategoryName(twoLineDish.name, currentCategory)) {
                i++;
                continue;
            }
            dishes.push(twoLineDish);
            i++;
            continue;
        }
        // Check if this line is a category header
        const categoryMatch = detectCategory(line);
        if (categoryMatch) {
            currentCategory = categoryMatch;
            currentCategoryPrice = undefined;
            continue;
        }
        // Skip lines that are clearly headers or metadata
        if (isHeaderLine(line)) {
            continue;
        }
        const wrappedLine = joinWrappedDishContinuation(line, lines[i + 1]);
        const followingLine = lines[i + wrappedLine.consumedLines + 1];
        const lineAfterFollowing = lines[i + wrappedLine.consumedLines + 2];
        const protectedFollowingLine = (extractPrice(normalizeAttachedAllergenCodes(wrappedLine.line)) &&
            followingLine &&
            lineAfterFollowing &&
            isPotentialTwoLineDishName(followingLine, lineAfterFollowing) &&
            isPotentialDescriptionLine(lineAfterFollowing)) ? undefined : followingLine;
        // Try to parse as a dish
        const dish = parseDishLine(wrappedLine.line, protectedFollowingLine);
        if (dish) {
            dish.category = currentCategory;
            if (!dish.price) {
                dish.price = currentCategoryPrice || currentMenuPrice;
            }
            dish.name = normalizeDishNameForCategory(dish.name, currentCategory);
            if (isNonDishLine(dish.name) || isSameCategoryName(dish.name, currentCategory)) {
                i += wrappedLine.consumedLines;
                continue;
            }
            dishes.push(dish);
            i += wrappedLine.consumedLines;
            // If we used the next line as description, skip it
            if (dish.usedNextLineAsDescription && lines[i + 1] && !extractPrice(lines[i + 1])) {
                i++;
            }
        }
    }
    return dedupeExtractedDishes(dishes);
}
function parseTwoLineDish(nameLine, descriptionLine) {
    if (!descriptionLine || !isPotentialTwoLineDishName(nameLine, descriptionLine) || !isPotentialDescriptionLine(descriptionLine)) {
        return null;
    }
    if (isEventTitleLine(nameLine) && /\|/.test(descriptionLine)) {
        return parseDishLine(descriptionLine.replace(/\s*\|\s*/g, ', '));
    }
    const normalizedName = normalizeAttachedAllergenCodes(nameLine);
    const namePrice = extractPrice(normalizedName);
    const nameWithoutPrice = removeTrailingPrice(normalizedName);
    const nameAllergenPass = extractTrailingAllergens(nameWithoutPrice);
    const normalizedDescription = normalizeAttachedAllergenCodes(descriptionLine);
    const firstAllergenPass = extractTrailingAllergens(normalizedDescription);
    let descriptionBody = firstAllergenPass.cleanedText;
    const price = namePrice || extractPrice(descriptionBody);
    descriptionBody = removeTrailingPrice(descriptionBody);
    const secondAllergenPass = extractTrailingAllergens(descriptionBody);
    const allergens = uniqueAllergens([...nameAllergenPass.allergens, ...firstAllergenPass.allergens, ...secondAllergenPass.allergens]);
    const description = cleanDescriptionText(secondAllergenPass.cleanedText);
    if (!description || description.length < 3) {
        return null;
    }
    return {
        name: cleanDishNameText(nameAllergenPass.cleanedText),
        description,
        price,
        allergens,
        usedNextLineAsDescription: true,
    };
}
function isPotentialTwoLineDishName(nameLine, descriptionLine) {
    if (isPotentialStandaloneDishName(nameLine)) {
        return true;
    }
    const cleanName = nameLine.replace(/[*_#]/g, '').trim();
    const namePrice = extractPrice(cleanName);
    const withoutPrice = removeTrailingPrice(normalizeAttachedAllergenCodes(cleanName));
    const allergenPass = extractTrailingAllergens(withoutPrice);
    if (cleanName.length < 3 ||
        cleanName.length > 100 ||
        /[,|/]/.test(allergenPass.cleanedText) ||
        /:\s*$/.test(cleanName) ||
        (namePrice && !/\+/.test(cleanName)) ||
        isFooterBoundary(cleanName) ||
        isHeaderLine(cleanName) ||
        isNonDishLine(cleanName) ||
        isMenuTitleCategory(cleanName)) {
        return false;
    }
    const hasNameAllergens = allergenPass.allergens.length > 0;
    const descriptionLooksLikeIngredients = /^[a-zà-ÿ]/.test(descriptionLine.trim()) || /[/,]/.test(descriptionLine);
    return hasNameAllergens && descriptionLooksLikeIngredients;
}
function isPotentialStandaloneDishName(line) {
    const cleanLine = line.replace(/[*_#]/g, '').trim();
    if (cleanLine.length < 3 ||
        cleanLine.length > 80 ||
        /[,|/]/.test(cleanLine) ||
        /:\s*$/.test(cleanLine) ||
        extractPrice(cleanLine) ||
        isFooterBoundary(cleanLine) ||
        isHeaderLine(cleanLine) ||
        isNonDishLine(cleanLine) ||
        isMenuTitleCategory(cleanLine) ||
        isSectionLabelName(cleanLine) ||
        isDefiniteCategoryHeading(cleanLine)) {
        return false;
    }
    if (cleanLine === cleanLine.toUpperCase()) {
        return false;
    }
    return true;
}
function isPotentialDescriptionLine(line) {
    const cleanLine = line.trim();
    if (cleanLine.length < 5 ||
        cleanLine.length > 220 ||
        isFooterBoundary(cleanLine) ||
        isHeaderLine(cleanLine) ||
        isNonDishLine(cleanLine) ||
        isDefiniteCategoryHeading(cleanLine)) {
        return false;
    }
    const allergenPass = extractTrailingAllergens(normalizeAttachedAllergenCodes(cleanLine));
    return /^[a-zà-ÿ]/.test(cleanLine) || /[,/]/.test(cleanLine) || !!extractPrice(cleanLine) || allergenPass.allergens.length > 0;
}
function joinWrappedDishContinuation(line, nextLine) {
    if (!nextLine || extractPrice(line) || !extractPrice(nextLine)) {
        return { line, consumedLines: 0 };
    }
    const cleanNextLine = nextLine.trim();
    const nextLineIsPriceOnly = isPriceOnlyLine(cleanNextLine);
    if (!nextLineIsPriceOnly && (isFooterBoundary(cleanNextLine) ||
        detectCategory(cleanNextLine) ||
        isHeaderLine(cleanNextLine) ||
        isNonDishLine(cleanNextLine))) {
        return { line, consumedLines: 0 };
    }
    const looksLikeContinuation = /,\s*$/.test(line)
        || /^[a-zà-ÿ(]/.test(cleanNextLine)
        || isPriceOnlyLine(cleanNextLine)
        || isAllergenPriceOnlyLine(cleanNextLine)
        || isShortPriceContinuation(cleanNextLine);
    const startsLikeDish = line.includes(',') && line.slice(0, line.indexOf(',')).trim().length >= 3;
    if (!looksLikeContinuation || !startsLikeDish) {
        return { line, consumedLines: 0 };
    }
    return {
        line: `${line.replace(/\s+$/, '')} ${cleanNextLine}`,
        consumedLines: 1,
    };
}
/**
 * Detect if a line is a category header
 */
function detectCategory(line) {
    // Remove common formatting
    const cleanLine = line.replace(/[*_#]/g, '').trim();
    if (isFooterBoundary(cleanLine)) {
        return null;
    }
    if (isNonDishLine(cleanLine)) {
        return null;
    }
    if (extractPrice(cleanLine)) {
        return null;
    }
    if (isMenuTitleCategory(cleanLine)) {
        return cleanLine;
    }
    if (isGeographicHeading(cleanLine)) {
        return cleanLine;
    }
    if (isSectionLabelName(cleanLine)) {
        return cleanLine;
    }
    // Check against known category patterns
    for (const pattern of CATEGORY_PATTERNS) {
        if (pattern.test(cleanLine)) {
            return cleanLine;
        }
    }
    if (isHeaderLine(cleanLine)) {
        return null;
    }
    // Check if line is all caps (common for category headers)
    if (cleanLine === cleanLine.toUpperCase() && cleanLine.length > 3 && cleanLine.length < 30) {
        // Make sure it's not a dish name with a price
        if (!extractPrice(cleanLine)) {
            return cleanLine;
        }
    }
    if (isShortCategoryHeading(cleanLine)) {
        return cleanLine;
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
function isDefiniteCategoryHeading(line) {
    return /^(?:a\s+la\s+carte|for\s+the\s+table|appetizers?|starters?|antojitos|entradas?|first\s*course|salads?(?:\s*&\s*bowls?)?|salad\s*&\s*cold\s+starters?|cold\s+starters?|soups?|tacos?|suviche\s+bar|ceviche|sushi|rolls?|entr[eé]es?|mains?|main\s*course|chef['’]?s\s+specialt(?:y|ies)|especiales|seafood|fish|meats?|poultry|beef|chicken|pork|lamb|churrasco|grill|halal|pasta|risotto|sides?|side\s*dishes?|accompaniments?|desserts?|sweets?|postres|beverages?|drinks?|cocktails?|wines?|beers?|spirits?|raw\s+bar|shared|hot\s+appetizer|main\s+entr[eé]e|specialty\s+drinks):?$/i.test(line.trim())
        || isGeographicHeading(line);
}
function isSectionLabelName(line) {
    return isDefiniteCategoryHeading(line)
        || isShortBeverageOrServiceHeading(line)
        || /^(?:signature\s+cocktails?|specialty\s+cocktails?|classic\s+cocktails?|bar\s+raya\s+exclusives|classics\s+with\s+a\s+twist|dessert\s+cocktails?|soup\s*&\s*salads?|ensaladas\s+y\s+sopa|guacamoles?\s*&\s*salsas?|m[aá]s\s*\|\s*sides|raw\s+bar|bubbles|by\s+the\s+glass|wine\s+by\s+the\s+glass|by\s+the\s+bottle|spirits?\s+list|bourbon,\s*whiskey\s*&\s*rye|wine\s+pairing|maki(?:\s+rolls?|\s+selection)?|nigiri|sashimi|fajitas|maya\s+signature\s+fajitas|de\s+la\s+parrilla\s*\|\s*from\s+the\s+grill|wood\s+fire\s+grill|from\s+the\s+(?:wood|grill)(?:\s*[-–—]\s*burning\s+grill)?|other\s+varietals\s*\/\s*unique\s+whites|(?:red|ros[ée])\s+wine\s*\(.+\)|signature\s+margaritas\s+glass\s*\/\s*pitcher|antojitos\s*\|\s*starters|especiales\s*\|\s*specialt(?:y|ies)|postres\s*\|\s*desserts?|.+\s+station)$/i.test(line.trim());
}
function isShortBeverageOrServiceHeading(line) {
    const normalized = line
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return SHORT_SECTION_HEADINGS.has(normalized);
}
function isEventTitleLine(line) {
    return /\b(?:feast|thanksgiving|christmas|valentine|new\s+year|story)\b/i.test(line.trim());
}
function isGeographicHeading(line) {
    const normalized = line
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return GEOGRAPHIC_HEADINGS.has(normalized);
}
function isMenuTitleCategory(line) {
    const cleanLine = line.trim();
    return (cleanLine.length > 5 &&
        cleanLine.length < 80 &&
        /^.+\s+menu$/i.test(cleanLine) &&
        !/^menu$/i.test(cleanLine));
}
function isShortCategoryHeading(line) {
    if (line.length < 4 || line.length > 40 || /[,|/]/.test(line) || extractPrice(line)) {
        return false;
    }
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length > 5) {
        return false;
    }
    return words.every(word => {
        const stripped = word.replace(/[&'’()-]/g, '');
        return !stripped || /^[A-ZÀ-Þ0-9]/.test(stripped);
    });
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
        const matches = parts.filter(isAllergenLegendPart);
        return parts.length >= 3 && matches.length >= Math.max(2, Math.floor(parts.length * 0.6));
    }
    return isAllergenLegendPart(normalized);
}
function isAllergenLegendPart(part) {
    const match = part.match(/^\(?\s*([A-Z]{1,3})\s*\)?\s*(?:=|\s)\s*(.+)$/);
    if (!match || !ALLERGEN_CODE_SET.has(match[1].toUpperCase())) {
        return false;
    }
    return /\b(?:contains?|crustaceans?|dairy|egg|fish|gluten|mustard|nuts?|peanuts?|tree\s+nuts?|sesame|shellfish|soy|sulphites?|sulfites?|vegan|vegetarian|alcohol)\b/i.test(match[2]);
}
function isRawNoticeLine(line) {
    const normalized = line.replace(/\s+/g, ' ').trim().toLowerCase();
    return (normalized.includes('consuming raw or undercooked') && normalized.includes('foodborne illness'))
        || (normalized.includes('wish to know whether any dishes contain') && normalized.includes('allergy'));
}
/**
 * Parse a line as a dish
 */
function parseDishLine(line, nextLine) {
    // Skip very short lines
    if (line.length < 3) {
        return null;
    }
    if (isNonDishLine(line)) {
        return null;
    }
    const normalizedLine = normalizeAttachedAllergenCodes(line);
    // Clean the line before splitting out name/description
    let body = normalizedLine;
    const firstAllergenPass = extractTrailingAllergens(body);
    body = firstAllergenPass.cleanedText;
    // Extract and remove price after a first allergen pass so lines like
    // "Prime Beef ... €30.00 G" and "Guacamole ... V €14.00" both work.
    let price = extractPrice(body);
    body = removeTrailingPrice(body);
    // Extract allergens from the line tail
    const { cleanedText, allergens: secondPassAllergens } = extractTrailingAllergens(body);
    const allergens = uniqueAllergens([...firstAllergenPass.allergens, ...secondPassAllergens]);
    body = cleanedText.replace(/[,|]+\s*$/, '').trim();
    const { name, description: inlineDescription } = splitNameAndDescription(body);
    const dishName = cleanDishNameText(name);
    // If dish name is too short after cleaning, skip
    if (dishName.length < 3 || !/[A-Za-z]/.test(dishName)) {
        return null;
    }
    // Check if next line might be a description
    let description = cleanDescriptionText(inlineDescription);
    let usedNextLineAsDescription = false;
    if (!price && nextLine && isPriceOnlyLine(nextLine)) {
        price = extractPrice(nextLine);
        usedNextLineAsDescription = true;
    }
    if (!description && nextLine && !extractPrice(nextLine) && !detectCategory(nextLine) && !isFooterBoundary(nextLine) && !isHeaderLine(nextLine) && !isNonDishLine(nextLine)) {
        // Next line doesn't have a price and isn't a category - might be description
        if (nextLine.length > 10 && nextLine.length < 200) {
            description = cleanDescriptionText(nextLine);
            usedNextLineAsDescription = true;
        }
    }
    if (isNonDishLine(dishName) || (!price && !description && isSectionLabelName(dishName)) || isLowercaseOneWordFragment(dishName, description) || isLowercaseIngredientFragment(dishName, description, price)) {
        return null;
    }
    return {
        name: dishName,
        description,
        price,
        allergens,
        usedNextLineAsDescription,
    };
}
function isNonDishLine(line) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return true;
    }
    const metadataText = removeWrappingParens(removeTrailingPrice(normalized).replace(/[,|:]+\s*$/, '').trim());
    const lower = metadataText.toLowerCase();
    if (/^missing\s+description$/i.test(metadataText)) {
        return true;
    }
    if (/^(?:served\s+for\s+the\s+table|host\s+chooses?.*|choose\b.*|choice\s+of\b.*|select\b.*|served\s+by\s+\d+\s+pieces?)$/i.test(metadataText)) {
        return true;
    }
    if (/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs)?|fri|sat|sun)$/i.test(metadataText)) {
        return true;
    }
    if (!extractPrice(normalized) && /^(?:brown\s+sugar|agave\s+syrup|golden\s+raisins|mixed\s+berries)\b/i.test(metadataText)) {
        return true;
    }
    if (!extractPrice(normalized) && /^all\s+steaks\s+are\s+served\b/i.test(metadataText)) {
        return true;
    }
    if (!extractPrice(normalized) && /^vegan\s+option\s+available\b/i.test(metadataText)) {
        return true;
    }
    if (/^(?:crafted\s+by|chef\s+.+|cocktails?\s+creations?\s+by|existing\s+menu\s+edits|new\s+menu\s+development|design\s+queue\s+workflow|please\s+(?:add|incorporate)\b|please\s+add\s+to\s+all\s+menus|raw\s+protein|separate\s+value|allergens?|allergen\s+key|top\s+of\s+form|bottom\s+of\s+form)\b/i.test(metadataText)) {
        return true;
    }
    if (/^(?:an\s+extra\s+charge|not\s+to\s+exceed|price\s+(?:per\b|\d)|savor\s+our\b|bottomless\b|on\s+the\s+bottom\s+of\s+the\s+menu)\b/i.test(metadataText)) {
        return true;
    }
    if (/\b(?:all-you-can-eat|à\s+la\s+carte\s+pricing|a\s+la\s+carte\s+pricing|on\s+the\s+last\s+page|below\s+enhancements?\s+not\s+next|prepared\s+by\s+our\s+specialized\s+chef)\b/i.test(metadataText)) {
        return true;
    }
    if (isDateOrEventTimeLine(normalized) || isDateOrEventTimeLine(metadataText) || /\bdesign@richardsandoval\.com\b/i.test(metadataText)) {
        return true;
    }
    if (/^(?:[A-Z]{1,3}\s*=\s*[A-Za-z].*){2,}$/i.test(metadataText)) {
        return true;
    }
    if (/^\(?\s*\d+\s*(?:calories|cals?)\s*\)?\s*(?:[$€£]?\s*)?\d+(?:\.\d{1,2})?\s*$/i.test(metadataText)) {
        return true;
    }
    if (/\bprix[-\s]*fixe\b.*\bmenu\b/i.test(metadataText)) {
        return true;
    }
    if (/:\s*.+\s+[A-Z]{1,3}\s*[–—-]\s*.+\s+[A-Z]{1,3}\b/.test(metadataText)) {
        return true;
    }
    if (/\b(?:per|pp)\s+(?:guest|person|pax)\b/.test(lower) || /\bmax\s+\d+\s+guests?\b/.test(lower)) {
        return true;
    }
    if (/^\$?\d+(?:\.\d{1,2})?\s*(?:pp|per\s+(?:guest|person|pax))\b/i.test(normalized)) {
        return true;
    }
    if (/^\$?\d+(?:\.\d{1,2})?\s+per\b/i.test(normalized)) {
        return true;
    }
    if (/^\d{1,2}(?::\d{2})?\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(metadataText)) {
        return true;
    }
    if (/^\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*(?:to|[-–—])\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)$/i.test(metadataText)) {
        return true;
    }
    if (/^served\s+from\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*(?:to|[-–—])\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)$/i.test(metadataText)) {
        return true;
    }
    if (/^available\b.*\b\d{1,2}\s*(?:am|pm)\b/i.test(metadataText)) {
        return true;
    }
    if (/^(?:mon|tues?|wed|thu(?:rs)?|fri|sat|sun)(?:day)?\s*[-–—]\s*(?:mon|tues?|wed|thu(?:rs)?|fri|sat|sun)(?:day)?(?:\s*\|\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)?$/i.test(metadataText)) {
        return true;
    }
    if (/^\d+(?:st|nd|rd|th)\s+course\b/i.test(metadataText)) {
        return true;
    }
    if (/^(?:(?:\d+|one|two|three|four|five)\s+(?:courses?|course meal|course\s+prix\s+fixe)|(?:three|four|five)\s+course\s+prix\s+fixe|four\s+course\b|three\s+course\b|\d+\s+tacos per order|\d+\s*pcs?)$/i.test(metadataText)) {
        return true;
    }
    if (/^\d+\s+calories\s+or\s+less$/i.test(metadataText)) {
        return true;
    }
    if (/^\d+(?:oz|gr)\s+with\s+\d+\s+sides?$/i.test(metadataText)) {
        return true;
    }
    if (/^(?:add|enhancements?|option\s+to\s+add|make\s+it)\b/i.test(metadataText)) {
        return true;
    }
    return false;
}
function isSectionPriceLine(line) {
    return /^(?:enhancements?|wine\s+pairing|pairing|prix\s*fixe|price\b|suggested\s+pric(?:e|ing)\b|bottomless\b)/i.test(line.trim())
        || /(?:^|[^a-z])(?:pp|per\s+(?:person|guest|table|couple)|@person)\b/i.test(line)
        || /\bprix[-\s]*fix(?:e|ed)?(?:\s+price)?\b/i.test(line);
}
function isPersistentSectionPriceLine(line) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (/^(?:enhancements?|wine\s+pairing|pairing)\b/i.test(normalized)) {
        return false;
    }
    return /(?:^|[^a-z])(?:pp|per\s+(?:person|guest|couple)|@person)\b/i.test(normalized)
        || /\bprix[-\s]*fix(?:e|ed)?\b/i.test(normalized)
        || /\b(?:set|course|package)\s+menu\b/i.test(normalized)
        || /^price\b/i.test(normalized);
}
function isPrixFixeMenuMarker(line) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    return /\b(?:prix[-\s]*fix(?:e|ed)?|half\s+board|set\s+menu|course\s+prix\s+fixe|course\s+meal|choose\s+any\s+1|choose\s+\d|sharing\s+style|buffet|priced\s+per\s+person|per\s+person|per\s+couple)\b/i.test(normalized)
        && !/^(?:enhancements?|wine\s+pairing|pairing)\b/i.test(normalized);
}
function inferMenuPriceLabel(lines) {
    const searchable = lines.slice(0, 80).join('\n');
    if (/(?:prix[-\s]*fix(?:e|ed)?|half\s+board|set\s+menu|course\s+prix\s+fixe|course\s+meal|choose\s+any\s+1|choose\s+\d|sharing\s+style|buffet|priced\s+per\s+person|per\s+person|per\s+couple|restaurant\s+week|new\s+year|valentine|sushi\s*&\s*bubbly)/i.test(searchable)) {
        return PRIX_FIXE_PRICE_LABEL;
    }
    if (lines.slice(0, 8).some(line => /^\s*\d+(?:\.\d{1,2})?\s*(?:AED|QAR)\s*$/i.test(line))) {
        return PRIX_FIXE_PRICE_LABEL;
    }
    return undefined;
}
function extractSectionPrice(line) {
    const text = line.replace(/\s+/g, ' ').trim();
    if (!text) {
        return undefined;
    }
    const plusPrice = text.match(new RegExp(`\\+\\s*(?:${CURRENCY_CODE_PATTERN}\\s*)?([$€£]?\\s*\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)`, 'i'));
    if (plusPrice) {
        return plusPrice[1].replace(/\s+/g, '');
    }
    const parenPrice = text.match(new RegExp(`\\(\\s*\\+?\\s*(?:${CURRENCY_CODE_PATTERN}\\s*)?([$€£]?\\s*\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)\\s*(?:${CURRENCY_CODE_PATTERN})?\\s*(?:pp|per\\s+(?:person|guest|table|couple)|@person)?[^)]*\\)`, 'i'));
    if (parenPrice) {
        return parenPrice[1].replace(/\s+/g, '');
    }
    const perPrice = text.match(new RegExp(`(?:price\\s*)?(?:${CURRENCY_CODE_PATTERN}\\s*)?([$€£]?\\s*\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)\\s*(?:${CURRENCY_CODE_PATTERN})?\\s*(?:pp|per\\s+(?:person|guest|table|couple)|@person)\\b`, 'i'));
    if (perPrice) {
        return perPrice[1].replace(/\s+/g, '');
    }
    const trailingPrice = extractPrice(text);
    if (trailingPrice && isSectionPriceLine(text)) {
        return trailingPrice;
    }
    return undefined;
}
function cleanSectionCategoryName(line) {
    const cleaned = line
        .replace(/\([^)]*(?:[$€£]?\s*\d+(?:,\d{3})*(?:\.\d{1,2})?|pp|per\s+(?:person|guest|table|couple)|@person)[^)]*\)/ig, '')
        .replace(/\+\s*(?:AED\s*)?[$€£]?\s*\d+(?:,\d{3})*(?:\.\d{1,2})?/ig, '')
        .replace(/\bpp\b/ig, '')
        .replace(/(?:price\s*)?(?:AED\s*)?[$€£]?\s*\d+(?:,\d{3})*(?:\.\d{1,2})?\s*(?:pp|per\s+(?:person|guest|table|couple)|@person)\b/ig, '')
        .replace(PRICE_TAIL_REGEX, '')
        .replace(/[,|:]+\s*$/, '')
        .trim();
    if (!cleaned || /^[\/|:-]/.test(cleaned) || /^(?:adults?|children|kids?)\b/i.test(cleaned)) {
        return '';
    }
    return cleaned;
}
function cleanDescriptionText(description) {
    const allergenClusterBeforePrice = new RegExp(`(?:\\s+|\\*)\\(?\\s*${ALLERGEN_CLUSTER_SEQUENCE}\\s*\\)?\\s*\\*?\\s+(?:[$€£]?\\d+(?:\\.\\d{1,2})?|\\d+\\s*cup\\s*/\\s*\\d+\\s*bowl)\\b.*$`, 'i');
    const allergenClusterBeforeNextDish = new RegExp(`(?:\\s+|\\*)\\s*${ALLERGEN_CLUSTER_SEQUENCE}\\s+[A-ZÀ-Þ].*$`, 'i');
    const cleaned = `${description || ''}`
        .replace(/\s*\(?\s*\d+\s*(?:calories|cals?)\s*\)?\s*$/i, '')
        .replace(/\s*\((?:suggested|prix[-\s]*fix(?:e|ed)?\s+price)[^)]*[$€£]\s*\d+(?:\.\d{1,2})?[^)]*\)\s*$/i, '')
        .replace(/\s*\|\s*add\b.*$/i, '')
        .replace(/,\s*,/g, ',')
        .replace(/\b(PN|TN|SE|SL|SS|SY|CE|ET|MO|MU|VG|GF|DF|SF|[ACDEFGMNPSTV])\.(?=\s|$)/gi, '$1')
        .replace(allergenClusterBeforePrice, '')
        .replace(allergenClusterBeforeNextDish, '')
        .replace(new RegExp(`^(?:\\(?\\s*${ALLERGEN_CLUSTER_SEQUENCE}\\s*\\)?\\s*)\\+AED$`, 'i'), '')
        .replace(TRAILING_ALLERGEN_CLUSTER_REGEX, '')
        .replace(/[,|]+\s*$/, '')
        .trim();
    return cleaned || undefined;
}
function isPriceOnlyLine(line) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return false;
    }
    return new RegExp(`^\\(?\\s*\\d+\\s*(?:calories|cals?)?\\s*\\)?\\s*(?:[$€£]?\\s*)?${PRICE_NUMBER_PATTERN}\\s*(?:AED|QAR|USD|MXN)?\\s*$`, 'i').test(normalized)
        || new RegExp(`^(?:[$€£]\\s*)?${PRICE_NUMBER_PATTERN}\\s*(?:AED|QAR|USD|MXN)?$`, 'i').test(normalized);
}
function isReusableSectionPriceOnlyLine(line, category) {
    const price = extractPrice(line);
    if (!price) {
        return false;
    }
    const compact = line.replace(/\s+/g, '').trim();
    return isPriceOnlyLine(line) && (!/^\d{1,2}$/.test(compact) || isBeveragePriceCategory(category));
}
function isBeveragePriceCategory(category) {
    return /\b(?:bar|beverage|cocktails?|drink|fresca|happy\s+hour|icons?|locally\s+inspired|mocktails?|sin\s+culpa|specia(?:l|les)|spritz|zero\s+proof|wines?)\b/i.test(`${category || ''}`);
}
function isAllergenPriceOnlyLine(line) {
    return new RegExp(`^${ALLERGEN_CLUSTER_SEQUENCE}\\s+${PRICE_NUMBER_PATTERN}\\s*(?:AED|QAR|USD|MXN)?$`, 'i')
        .test(line.replace(/\s+/g, ' ').trim());
}
function isShortPriceContinuation(line) {
    const withoutPrice = removeTrailingPrice(line).trim();
    const words = withoutPrice.split(/\s+/).filter(Boolean);
    return words.length > 0 && words.length <= 5 && !/[,|]/.test(withoutPrice);
}
function cleanDishNameText(name) {
    const cleanedName = name
        .replace(/\s*[-–—]\s*[$€£]\s*\d+(?:\.\d{1,2})?(?:\s*[A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*)?\s*$/i, '')
        .replace(/\s*\((?:suggested|prix[-\s]*fix(?:e|ed)?\s+price)[^)]*[$€£]\s*\d+(?:\.\d{1,2})?[^)]*\)\s*$/i, '')
        .replace(/\s*\([^)]*\)\s*[$€£]\s*\d+(?:\.\d{1,2})?/gi, '')
        .replace(/\s*\(\s*\d+\s*oz\s*\)\s*$/i, '')
        .trim();
    const trailingToken = cleanedName.match(/\s+([A-Z]{1,3})$/)?.[1];
    if (trailingToken && ALLERGEN_CODE_SET.has(trailingToken)) {
        return cleanedName.replace(/\s+[A-Z]{1,3}$/, '').trim();
    }
    return cleanedName;
}
function isLowercaseOneWordFragment(name, description) {
    return /^[a-z][a-z-]{2,}$/.test(name.trim()) && !!description?.trim();
}
function isLowercaseIngredientFragment(name, description, price) {
    const cleanName = name.trim();
    return !price
        && /^[a-zà-ÿ]/.test(cleanName)
        && (!!description?.trim() || /[/,]/.test(cleanName) || isShortLowercaseIngredientPhrase(cleanName));
}
function isShortLowercaseIngredientPhrase(name) {
    if (!/^[a-zà-ÿ][a-zà-ÿ\s'’.-]+$/.test(name)) {
        return false;
    }
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 5) {
        return false;
    }
    return /\b(?:aioli|brine|butter|caviar|cream|dressing|foam|garlic|gochujang|herbs?|lime|mint|olives?|onion|pickles?|potatoes|raisins?|salsa|sauce|syrup|tomato|vinaigrette)\b/i.test(name);
}
function isSameCategoryName(name, category) {
    if (!category) {
        return false;
    }
    return normalizeForDedupe(name) === normalizeForDedupe(category);
}
function dedupeExtractedDishes(dishes) {
    const seen = new Set();
    const unique = [];
    for (const dish of dishes) {
        const key = [
            normalizeForDedupe(dish.name),
            normalizeForDedupe(dish.category),
            normalizeForDedupe(dish.description),
            `${dish.price || ''}`.trim(),
        ].join('|');
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push(dish);
    }
    return unique;
}
function normalizeForDedupe(value) {
    return `${value || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/**
 * Extract price from a line
 */
function extractPrice(line) {
    const plusPriceMatch = line.match(new RegExp(`\\+\\s*(?:${CURRENCY_CODE_PATTERN}\\s*)?([$€£]?\\s*${PRICE_NUMBER_PATTERN})\\s*(?:${CURRENCY_CODE_PATTERN})?\\s*$`, 'i'));
    if (plusPriceMatch) {
        const price = plusPriceMatch[1].replace(/\s+/g, '').trim();
        const numericPrice = parseFloat(price.replace(/[$€£,\s]|AED|QAR|USD|MXN/gi, ''));
        if (isReasonableMenuPrice(numericPrice, price)) {
            return price;
        }
    }
    const glassBottleMatch = line.match(new RegExp(`\\bGL\\s*(${PRICE_NUMBER_PATTERN})\\s*\\/\\s*BTL\\s*(${PRICE_NUMBER_PATTERN})\\s*$`, 'i'));
    if (glassBottleMatch) {
        return `GL ${glassBottleMatch[1]}/BTL ${glassBottleMatch[2]}`;
    }
    const cupBowlMatch = line.match(new RegExp(`\\b(${PRICE_NUMBER_PATTERN})\\s*cup\\s*\\/\\s*(${PRICE_NUMBER_PATTERN})\\s*bowl\\s*$`, 'i'));
    if (cupBowlMatch) {
        return `${cupBowlMatch[1]}/${cupBowlMatch[2]}`;
    }
    const priceBeforeModifierMatch = line.match(new RegExp(`(?:^|\\s)((?:(?:${CURRENCY_CODE_PATTERN})\\s*)?(?:[$€£]\\s*)?${PRICE_NUMBER_PATTERN})\\s+(?:add|enhancements?)\\b`, 'i'));
    if (priceBeforeModifierMatch) {
        const price = priceBeforeModifierMatch[1].replace(/\s+/g, '').trim();
        const numericPrice = parseFloat(price.replace(/[$€£,\s]|AED|QAR|USD|MXN/gi, ''));
        if (isReasonableMenuPrice(numericPrice, price)) {
            return price;
        }
    }
    const parenPriceMatch = line.match(PAREN_PRICE_TAIL_REGEX);
    if (parenPriceMatch) {
        const price = parenPriceMatch[1].replace(/\s+/g, '').trim();
        const numericPrice = parseFloat(price.replace(/[$€£,\s]/g, '').split('/')[0]);
        if (isReasonableMenuPrice(numericPrice, price)) {
            return price;
        }
    }
    // Match common trailing formats: 12, 12.00, $12, €14.00, £12, €48.00/€90.00
    const priceMatch = line.match(PRICE_TAIL_REGEX);
    if (priceMatch) {
        const price = priceMatch[0].trim();
        // Only return if it looks like a reasonable price (not a year, etc.)
        const numericPrice = parseFloat(price.replace(/[$€£,\s]|AED|QAR|USD|MXN/gi, '').split('/')[0]);
        if (isReasonableMenuPrice(numericPrice, price)) {
            return price;
        }
    }
    return undefined;
}
function removeTrailingPrice(line) {
    return line
        .replace(new RegExp(`\\+\\s*(?:${CURRENCY_CODE_PATTERN}\\s*)?[$€£]?\\s*${PRICE_NUMBER_PATTERN}\\s*(?:${CURRENCY_CODE_PATTERN})?\\s*$`, 'i'), '')
        .replace(new RegExp(`\\bGL\\s*${PRICE_NUMBER_PATTERN}\\s*\\/\\s*BTL\\s*${PRICE_NUMBER_PATTERN}\\s*$`, 'i'), '')
        .replace(new RegExp(`\\b${PRICE_NUMBER_PATTERN}\\s*cup\\s*\\/\\s*${PRICE_NUMBER_PATTERN}\\s*bowl\\s*$`, 'i'), '')
        .replace(new RegExp(`\\s+(?:(?:${CURRENCY_CODE_PATTERN})\\s*)?(?:[$€£]\\s*)?${PRICE_NUMBER_PATTERN}\\s+(?:add|enhancements?)\\b.*$`, 'i'), '')
        .replace(PAREN_PRICE_TAIL_REGEX, '')
        .replace(PRICE_TAIL_REGEX, '')
        .trim();
}
function isDateOrEventTimeLine(line) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    return /^(?:date\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:am|pm))?(?:\s*[-–—]\s*\d{1,2}:\d{2}\s*(?:am|pm))?$/i.test(normalized)
        || /^[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*)?\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:am|pm))?(?:\s*[-–—]\s*\d{1,2}:\d{2}\s*(?:am|pm))?$/i.test(normalized)
        || /^[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s+\d{1,2}:\d{2}\s*(?:am|pm)(?:\s*[-–—]\s*\d{1,2}:\d{2}\s*(?:am|pm))?$/i.test(normalized)
        || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(normalized);
}
function removeWrappingParens(line) {
    return line.replace(/^\((.*)\)$/, '$1').trim();
}
function normalizeDishNameForCategory(name, category) {
    if (!category || !isSaladCategory(category)) {
        return name;
    }
    if (/^kale$/i.test(name.trim())) {
        return 'Kale (Salad)';
    }
    return name;
}
function isSaladCategory(category) {
    return /\b(?:salads?|ensaladas?)\b/i.test(category);
}
function uniqueAllergens(allergens) {
    const unique = [];
    for (const allergen of allergens) {
        const upperAllergen = allergen.toUpperCase();
        if (ALLERGEN_CODE_SET.has(upperAllergen) && !unique.includes(upperAllergen)) {
            unique.push(upperAllergen);
        }
    }
    return unique;
}
/**
 * Extract allergen codes from a line tail and return the cleaned line
 */
function extractTrailingAllergens(line) {
    const normalizedLine = normalizeAttachedAllergenCodes(line);
    const match = normalizedLine.match(new RegExp(`(?:^|[\\s([{])(${TRAILING_CODE_GROUP}(?:(?:(?:\\s*[,/.|]\\s*)|\\s+)${TRAILING_CODE_GROUP})*)\\s*$`, 'i'));
    if (!match) {
        return {
            cleanedText: normalizedLine.trim(),
            allergens: [],
        };
    }
    const matchedCluster = match[1];
    const clusterIndex = match.index ?? 0;
    const allergens = [];
    for (const token of matchedCluster.split(/[\s,/.|]+/).filter(Boolean)) {
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
    return line.replace(new RegExp(`(?<![\\s,/|])([A-Za-zÀ-ÿ)])(${TRAILING_CODE_GROUP}(?:[,/|]${TRAILING_CODE_GROUP})+)(\\s*)$`, 'i'), '$1 $2$3');
}
function splitNameAndDescription(line) {
    for (const separator of NAME_DESCRIPTION_SEPARATORS) {
        const separatorIndex = line.indexOf(separator);
        if (separatorIndex <= 0) {
            continue;
        }
        const name = line.slice(0, separatorIndex).trim();
        const description = line.slice(separatorIndex + separator.length).trim();
        if (/[,|/]/.test(name)) {
            continue;
        }
        if (name.length >= 3 && description.length >= 3) {
            return {
                name,
                description,
            };
        }
    }
    const commaSplit = splitCommaDelimitedNameAndDescription(line);
    if (commaSplit) {
        return commaSplit;
    }
    return { name: line.trim() };
}
function splitCommaDelimitedNameAndDescription(line) {
    const separatorIndex = line.indexOf(',');
    if (separatorIndex <= 0) {
        return null;
    }
    const name = line.slice(0, separatorIndex).trim();
    const description = line.slice(separatorIndex + 1).trim().replace(/\s*,\s*/g, ', ');
    if (isSectionLabelName(name)) {
        if (/^[A-ZÀ-Þ]/.test(description)) {
            return splitCommaDelimitedNameAndDescription(description);
        }
        return null;
    }
    if (name.length < 3 || name.length > 80 || description.length < 5 || description.length > 200) {
        return null;
    }
    const nameWords = name.split(/\s+/).filter(Boolean);
    if (nameWords.length > 8 || /[,|/]/.test(name)) {
        return null;
    }
    const hasIngredientListDelimiter = /[,/]/.test(description);
    const startsLikeIngredient = /^[a-zà-ÿ]/.test(description);
    const hasIngredientPhrase = /\b(?:with|served|catch|avocado|tomato|onion|cilantro|pepper|cheese|rice|beans|salsa|crema|prawns?|fish|tuna|chicken|pork|beef|watermelon|jocoque|\d+\s*oz)\b/i.test(description);
    const isShortTitlePair = /^[A-Z][A-Za-zÀ-ÿ'’-]*(?:\s+[A-Z][A-Za-zÀ-ÿ'’-]*)?$/.test(description);
    if (isShortTitlePair && !hasIngredientListDelimiter && !startsLikeIngredient && !hasIngredientPhrase) {
        return null;
    }
    if (!startsLikeIngredient && !hasIngredientListDelimiter && !hasIngredientPhrase) {
        return null;
    }
    return {
        name,
        description,
    };
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
        price: normalizeDishPriceForStorage(dish.price, property, options?.servicePeriod),
        allergens: dish.allergens.length > 0 ? dish.allergens : undefined,
        source_submission_id: submissionId
    }));
    // Batch insert all dishes
    await (0, dishes_1.createDishes)(dishes);
    return { added: dishes.length };
}
function isReasonableMenuPrice(numericPrice, rawPrice) {
    if (!(numericPrice > 0)) {
        return false;
    }
    if (numericPrice >= 10000 && (!/,/.test(rawPrice) || numericPrice >= 100000)) {
        return false;
    }
    if (!/[$€£,\/]/.test(rawPrice) && numericPrice >= 1900 && numericPrice <= 2099) {
        return false;
    }
    return true;
}
/**
 * Extract dishes without storing (for preview/testing)
 */
function previewDishExtraction(menuContent) {
    return extractDishesFromText(menuContent);
}
//# sourceMappingURL=dish-extractor.js.map