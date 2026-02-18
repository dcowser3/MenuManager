"use strict";
/**
 * Dish Allergen Database
 * ======================
 *
 * Stores learned dish→allergen mappings from training data and human corrections.
 * The AI reviewer can query this database to quickly look up known allergens,
 * and fall back to ingredient-based inference for unknown dishes.
 *
 * Schema:
 * - dish_name: Normalized dish name (lowercase, trimmed)
 * - restaurant: Restaurant identifier (e.g., "toro_chicago", "dlena_bar")
 * - allergens: Array of allergen codes (D, N, G, V, S, E, F, C, SE, SY, M)
 * - ingredients: Known ingredients (helps with future inference)
 * - source: How this entry was created (training, manual, ai_inferred)
 * - confidence: 0-1 score (training data = high, AI inference = lower)
 * - created_at: When first added
 * - updated_at: Last modification
 * - correction_count: How many times this has been corrected (higher = more reliable)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLERGEN_CODES = void 0;
exports.loadDatabase = loadDatabase;
exports.saveDatabase = saveDatabase;
exports.normalizeDishName = normalizeDishName;
exports.extractRestaurant = extractRestaurant;
exports.upsertDish = upsertDish;
exports.lookupDish = lookupDish;
exports.searchDishes = searchDishes;
exports.getRestaurantDishes = getRestaurantDishes;
exports.getStatistics = getStatistics;
exports.importFromTraining = importFromTraining;
exports.exportDatabase = exportDatabase;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
// Allergen code definitions
exports.ALLERGEN_CODES = {
    D: 'Dairy',
    N: 'Nuts',
    G: 'Gluten',
    V: 'Vegetarian',
    S: 'Vegan',
    E: 'Eggs',
    F: 'Fish',
    C: 'Crustaceans',
    SE: 'Sesame',
    SY: 'Soy',
    M: 'Mustard',
};
const DB_PATH = path_1.default.join(__dirname, '..', '..', '..', 'data', 'dish-allergens.json');
/**
 * Initialize an empty database
 */
function createEmptyDatabase() {
    return {
        version: '1.0.0',
        last_updated: new Date().toISOString(),
        entries: [],
        statistics: {
            total_dishes: 0,
            by_restaurant: {},
            by_source: {},
        },
    };
}
/**
 * Load the dish allergen database
 */
async function loadDatabase() {
    try {
        const data = await fs_1.promises.readFile(DB_PATH, 'utf-8');
        return JSON.parse(data);
    }
    catch (error) {
        // Database doesn't exist yet, create empty one
        const db = createEmptyDatabase();
        await saveDatabase(db);
        return db;
    }
}
/**
 * Save the database to disk
 */
async function saveDatabase(db) {
    // Ensure directory exists
    const dir = path_1.default.dirname(DB_PATH);
    await fs_1.promises.mkdir(dir, { recursive: true });
    // Update statistics
    db.statistics.total_dishes = db.entries.length;
    db.statistics.by_restaurant = {};
    db.statistics.by_source = {};
    for (const entry of db.entries) {
        db.statistics.by_restaurant[entry.restaurant] =
            (db.statistics.by_restaurant[entry.restaurant] || 0) + 1;
        db.statistics.by_source[entry.source] =
            (db.statistics.by_source[entry.source] || 0) + 1;
    }
    db.last_updated = new Date().toISOString();
    await fs_1.promises.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}
/**
 * Normalize a dish name for consistent lookups
 */
function normalizeDishName(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s]/g, '') // Remove special characters
        .replace(/\s+/g, ' '); // Normalize whitespace
}
/**
 * Extract restaurant identifier from filename or path
 */
function extractRestaurant(filename) {
    // Common patterns: "Toro Chicago Menu.docx", "d'Lena Bar Revisions.docx"
    const name = path_1.default.basename(filename, path_1.default.extname(filename));
    // Try to extract restaurant name
    const patterns = [
        /^([\w\s']+?)[\s_-]*(menu|revision|brief|submission)/i,
        /^([\w\s']+?)[\s_-]*\d/i,
        /^([\w\s']+)/i,
    ];
    for (const pattern of patterns) {
        const match = name.match(pattern);
        if (match) {
            return match[1]
                .toLowerCase()
                .trim()
                .replace(/[^\w]/g, '_')
                .replace(/_+/g, '_');
        }
    }
    return 'unknown';
}
/**
 * Add or update a dish in the database
 */
async function upsertDish(dishName, allergens, options = {}) {
    const db = await loadDatabase();
    const normalized = normalizeDishName(dishName);
    const restaurant = options.restaurant || 'global';
    // Check if entry exists
    let entry = db.entries.find(e => e.dish_name_normalized === normalized && e.restaurant === restaurant);
    if (entry) {
        // Update existing entry
        entry.allergens = allergens;
        entry.updated_at = new Date().toISOString();
        entry.correction_count += 1;
        // Increase confidence with more corrections
        entry.confidence = Math.min(1.0, entry.confidence + 0.1);
        if (options.ingredients) {
            entry.ingredients = [...new Set([...entry.ingredients, ...options.ingredients])];
        }
        if (options.description)
            entry.description = options.description;
        if (options.price)
            entry.price = options.price;
        if (options.notes)
            entry.notes = options.notes;
    }
    else {
        // Create new entry
        entry = {
            id: `dish_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            dish_name: dishName,
            dish_name_normalized: normalized,
            restaurant,
            allergens,
            ingredients: options.ingredients || [],
            description: options.description,
            price: options.price,
            source: options.source || 'training',
            confidence: options.confidence || 0.5,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            correction_count: 1,
            notes: options.notes,
        };
        db.entries.push(entry);
    }
    await saveDatabase(db);
    return entry;
}
/**
 * Look up allergens for a dish
 */
async function lookupDish(dishName, restaurant) {
    const db = await loadDatabase();
    const normalized = normalizeDishName(dishName);
    // First try exact match with restaurant
    if (restaurant) {
        const exact = db.entries.find(e => e.dish_name_normalized === normalized && e.restaurant === restaurant);
        if (exact)
            return exact;
    }
    // Then try global/any restaurant
    const global = db.entries.find(e => e.dish_name_normalized === normalized);
    return global || null;
}
/**
 * Search for similar dishes (fuzzy matching)
 */
async function searchDishes(query, options = {}) {
    const db = await loadDatabase();
    const normalized = normalizeDishName(query);
    const limit = options.limit || 10;
    // Simple fuzzy search: find entries containing the query words
    const queryWords = normalized.split(' ');
    let results = db.entries.filter(entry => {
        if (options.restaurant && entry.restaurant !== options.restaurant) {
            return false;
        }
        // Check if any query word is in the dish name
        return queryWords.some(word => entry.dish_name_normalized.includes(word));
    });
    // Sort by relevance (number of matching words, then confidence)
    results.sort((a, b) => {
        const aMatches = queryWords.filter(w => a.dish_name_normalized.includes(w)).length;
        const bMatches = queryWords.filter(w => b.dish_name_normalized.includes(w)).length;
        if (bMatches !== aMatches)
            return bMatches - aMatches;
        return b.confidence - a.confidence;
    });
    return results.slice(0, limit);
}
/**
 * Get all dishes for a restaurant
 */
async function getRestaurantDishes(restaurant) {
    const db = await loadDatabase();
    return db.entries.filter(e => e.restaurant === restaurant);
}
/**
 * Get database statistics
 */
async function getStatistics() {
    const db = await loadDatabase();
    return db.statistics;
}
/**
 * Bulk import dishes from training corrections
 */
async function importFromTraining(corrections) {
    let imported = 0;
    let updated = 0;
    for (const correction of corrections) {
        // Parse allergen codes
        const allergens = correction.corrected_allergens
            .toUpperCase()
            .split(',')
            .map(a => a.trim())
            .filter(a => a in exports.ALLERGEN_CODES);
        const existing = await lookupDish(correction.dish_name, correction.restaurant);
        await upsertDish(correction.dish_name, allergens, {
            restaurant: correction.restaurant,
            ingredients: correction.ingredients,
            source: 'training',
            notes: `Learned from correction: ${correction.original_allergens} → ${correction.corrected_allergens}`,
        });
        if (existing) {
            updated++;
        }
        else {
            imported++;
        }
    }
    return { imported, updated };
}
/**
 * Export database for backup or analysis
 */
async function exportDatabase() {
    return loadDatabase();
}
// CLI interface for testing
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args[0] === 'stats') {
        getStatistics().then(stats => {
            console.log('Dish Allergen Database Statistics:');
            console.log(JSON.stringify(stats, null, 2));
        });
    }
    else if (args[0] === 'search' && args[1]) {
        searchDishes(args[1]).then(results => {
            console.log(`Search results for "${args[1]}":`);
            results.forEach(r => {
                console.log(`  - ${r.dish_name} (${r.restaurant}): ${r.allergens.join(',')}`);
            });
        });
    }
    else if (args[0] === 'add') {
        // Example: npx ts-node dish-allergens.ts add "Guacamole" "D,N,V" "toro_chicago"
        const [, dish, allergens, restaurant] = args;
        const codes = allergens.split(',');
        upsertDish(dish, codes, { restaurant, source: 'manual' }).then(entry => {
            console.log('Added:', entry);
        });
    }
    else {
        console.log('Usage:');
        console.log('  stats              - Show database statistics');
        console.log('  search <query>     - Search for dishes');
        console.log('  add <dish> <codes> <restaurant> - Add a dish manually');
    }
}
