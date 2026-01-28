"use strict";
/**
 * Approved Dishes CRUD operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDish = createDish;
exports.createDishes = createDishes;
exports.getDish = getDish;
exports.searchDishes = searchDishes;
exports.getDishesByProperty = getDishesByProperty;
exports.getDishesBySubmission = getDishesBySubmission;
exports.dishExists = dishExists;
exports.getAllProperties = getAllProperties;
exports.getAllDishes = getAllDishes;
exports.deleteDish = deleteDish;
exports.updateDish = updateDish;
const index_1 = require("./index");
const TABLE = 'approved_dishes';
/**
 * Normalize dish name for deduplication
 * - Lowercase
 * - Trim whitespace
 * - Remove extra spaces
 */
function normalizeDishName(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}
/**
 * Create a new approved dish
 */
async function createDish(input) {
    const supabase = (0, index_1.getSupabaseClient)();
    const dishData = {
        ...input,
        dish_name_normalized: normalizeDishName(input.dish_name)
    };
    const { data, error } = await supabase
        .from(TABLE)
        .insert(dishData)
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to create dish: ${error.message}`);
    }
    return data;
}
/**
 * Create multiple dishes at once (batch insert)
 */
async function createDishes(inputs) {
    if (inputs.length === 0) {
        return [];
    }
    const supabase = (0, index_1.getSupabaseClient)();
    const dishData = inputs.map(input => ({
        ...input,
        dish_name_normalized: normalizeDishName(input.dish_name)
    }));
    const { data, error } = await supabase
        .from(TABLE)
        .insert(dishData)
        .select();
    if (error) {
        throw new Error(`Failed to create dishes: ${error.message}`);
    }
    return data;
}
/**
 * Get a dish by ID
 */
async function getDish(id) {
    const supabase = (0, index_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .single();
    if (error) {
        if (error.code === 'PGRST116') {
            return null; // Not found
        }
        throw new Error(`Failed to get dish: ${error.message}`);
    }
    return data;
}
/**
 * Search dishes by name (partial match)
 */
async function searchDishes(query, limit = 50) {
    const supabase = (0, index_1.getSupabaseClient)();
    const normalizedQuery = normalizeDishName(query);
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('is_active', true)
        .ilike('dish_name_normalized', `%${normalizedQuery}%`)
        .order('dish_name')
        .limit(limit);
    if (error) {
        throw new Error(`Failed to search dishes: ${error.message}`);
    }
    return data;
}
/**
 * Get dishes by property
 */
async function getDishesByProperty(property, limit = 100) {
    const supabase = (0, index_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('is_active', true)
        .eq('property', property)
        .order('menu_category')
        .order('dish_name')
        .limit(limit);
    if (error) {
        throw new Error(`Failed to get dishes by property: ${error.message}`);
    }
    return data;
}
/**
 * Get dishes from a specific submission
 */
async function getDishesBySubmission(submissionId) {
    const supabase = (0, index_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('source_submission_id', submissionId)
        .order('menu_category')
        .order('dish_name');
    if (error) {
        throw new Error(`Failed to get dishes by submission: ${error.message}`);
    }
    return data;
}
/**
 * Check if a dish already exists (by normalized name and property)
 */
async function dishExists(dishName, property) {
    const supabase = (0, index_1.getSupabaseClient)();
    const normalizedName = normalizeDishName(dishName);
    let query = supabase
        .from(TABLE)
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('dish_name_normalized', normalizedName);
    if (property) {
        query = query.eq('property', property);
    }
    const { count, error } = await query;
    if (error) {
        throw new Error(`Failed to check dish existence: ${error.message}`);
    }
    return (count || 0) > 0;
}
/**
 * Get all unique properties that have dishes
 */
async function getAllProperties() {
    const supabase = (0, index_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from(TABLE)
        .select('property')
        .eq('is_active', true)
        .not('property', 'is', null);
    if (error) {
        throw new Error(`Failed to get properties: ${error.message}`);
    }
    // Get unique properties
    const properties = [...new Set(data.map(d => d.property).filter(Boolean))];
    return properties.sort();
}
/**
 * Get all dishes (paginated)
 */
async function getAllDishes(limit = 100, offset = 0) {
    const supabase = (0, index_1.getSupabaseClient)();
    // Get total count
    const { count, error: countError } = await supabase
        .from(TABLE)
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
    if (countError) {
        throw new Error(`Failed to count dishes: ${countError.message}`);
    }
    // Get paginated data
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('is_active', true)
        .order('dish_name')
        .range(offset, offset + limit - 1);
    if (error) {
        throw new Error(`Failed to get dishes: ${error.message}`);
    }
    return {
        dishes: data,
        total: count || 0
    };
}
/**
 * Soft delete a dish
 */
async function deleteDish(id) {
    const supabase = (0, index_1.getSupabaseClient)();
    const { error } = await supabase
        .from(TABLE)
        .update({ is_active: false })
        .eq('id', id);
    if (error) {
        throw new Error(`Failed to delete dish: ${error.message}`);
    }
}
/**
 * Update a dish
 */
async function updateDish(id, input) {
    const supabase = (0, index_1.getSupabaseClient)();
    const updateData = { ...input };
    // Update normalized name if dish_name changed
    if (input.dish_name) {
        updateData.dish_name_normalized = normalizeDishName(input.dish_name);
    }
    const { data, error } = await supabase
        .from(TABLE)
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to update dish: ${error.message}`);
    }
    return data;
}
//# sourceMappingURL=dishes.js.map