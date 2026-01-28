/**
 * Approved Dishes CRUD operations
 */

import { getSupabaseClient } from './index';
import { ApprovedDish, CreateDishInput } from './types';

const TABLE = 'approved_dishes';

/**
 * Normalize dish name for deduplication
 * - Lowercase
 * - Trim whitespace
 * - Remove extra spaces
 */
function normalizeDishName(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

/**
 * Create a new approved dish
 */
export async function createDish(input: CreateDishInput): Promise<ApprovedDish> {
    const supabase = getSupabaseClient();

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

    return data as ApprovedDish;
}

/**
 * Create multiple dishes at once (batch insert)
 */
export async function createDishes(inputs: CreateDishInput[]): Promise<ApprovedDish[]> {
    if (inputs.length === 0) {
        return [];
    }

    const supabase = getSupabaseClient();

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

    return data as ApprovedDish[];
}

/**
 * Get a dish by ID
 */
export async function getDish(id: string): Promise<ApprovedDish | null> {
    const supabase = getSupabaseClient();

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

    return data as ApprovedDish;
}

/**
 * Search dishes by name (partial match)
 */
export async function searchDishes(
    query: string,
    limit = 50
): Promise<ApprovedDish[]> {
    const supabase = getSupabaseClient();
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

    return data as ApprovedDish[];
}

/**
 * Get dishes by property
 */
export async function getDishesByProperty(
    property: string,
    limit = 100
): Promise<ApprovedDish[]> {
    const supabase = getSupabaseClient();

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

    return data as ApprovedDish[];
}

/**
 * Get dishes from a specific submission
 */
export async function getDishesBySubmission(
    submissionId: string
): Promise<ApprovedDish[]> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('source_submission_id', submissionId)
        .order('menu_category')
        .order('dish_name');

    if (error) {
        throw new Error(`Failed to get dishes by submission: ${error.message}`);
    }

    return data as ApprovedDish[];
}

/**
 * Check if a dish already exists (by normalized name and property)
 */
export async function dishExists(
    dishName: string,
    property?: string
): Promise<boolean> {
    const supabase = getSupabaseClient();
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
export async function getAllProperties(): Promise<string[]> {
    const supabase = getSupabaseClient();

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
    return properties.sort() as string[];
}

/**
 * Get all dishes (paginated)
 */
export async function getAllDishes(
    limit = 100,
    offset = 0
): Promise<{ dishes: ApprovedDish[]; total: number }> {
    const supabase = getSupabaseClient();

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
        dishes: data as ApprovedDish[],
        total: count || 0
    };
}

/**
 * Soft delete a dish
 */
export async function deleteDish(id: string): Promise<void> {
    const supabase = getSupabaseClient();

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
export async function updateDish(
    id: string,
    input: Partial<CreateDishInput>
): Promise<ApprovedDish> {
    const supabase = getSupabaseClient();

    const updateData: Record<string, unknown> = { ...input };

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

    return data as ApprovedDish;
}
