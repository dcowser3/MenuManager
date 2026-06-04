/**
 * Supabase Client for Menu Manager
 *
 * Shared database client used by all services
 */

export * from './client';

// Re-export types
export * from './types';

// Re-export service modules
export * from './submissions';
export * from './dishes';
export * from './dish-extractor';
export * from './dish-quality';
export * from './approved-dish-repair';
export * from './alerts';
