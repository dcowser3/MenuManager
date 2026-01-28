/**
 * Approved Dishes CRUD operations
 */
import { ApprovedDish, CreateDishInput } from './types';
/**
 * Create a new approved dish
 */
export declare function createDish(input: CreateDishInput): Promise<ApprovedDish>;
/**
 * Create multiple dishes at once (batch insert)
 */
export declare function createDishes(inputs: CreateDishInput[]): Promise<ApprovedDish[]>;
/**
 * Get a dish by ID
 */
export declare function getDish(id: string): Promise<ApprovedDish | null>;
/**
 * Search dishes by name (partial match)
 */
export declare function searchDishes(query: string, limit?: number): Promise<ApprovedDish[]>;
/**
 * Get dishes by property
 */
export declare function getDishesByProperty(property: string, limit?: number): Promise<ApprovedDish[]>;
/**
 * Get dishes from a specific submission
 */
export declare function getDishesBySubmission(submissionId: string): Promise<ApprovedDish[]>;
/**
 * Check if a dish already exists (by normalized name and property)
 */
export declare function dishExists(dishName: string, property?: string): Promise<boolean>;
/**
 * Get all unique properties that have dishes
 */
export declare function getAllProperties(): Promise<string[]>;
/**
 * Get all dishes (paginated)
 */
export declare function getAllDishes(limit?: number, offset?: number): Promise<{
    dishes: ApprovedDish[];
    total: number;
}>;
/**
 * Soft delete a dish
 */
export declare function deleteDish(id: string): Promise<void>;
/**
 * Update a dish
 */
export declare function updateDish(id: string, input: Partial<CreateDishInput>): Promise<ApprovedDish>;
//# sourceMappingURL=dishes.d.ts.map