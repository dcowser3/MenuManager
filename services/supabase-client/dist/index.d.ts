/**
 * Supabase Client for Menu Manager
 *
 * Shared database client used by all services
 */
import { SupabaseClient } from '@supabase/supabase-js';
/**
 * Get the Supabase client instance (singleton)
 */
export declare function getSupabaseClient(): SupabaseClient;
/**
 * Check if Supabase is configured
 */
export declare function isSupabaseConfigured(): boolean;
export * from './types';
export * from './submissions';
export * from './dishes';
export * from './dish-extractor';
//# sourceMappingURL=index.d.ts.map