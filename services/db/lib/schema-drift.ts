// Pure Supabase schema-drift helpers, kept side-effect-free so they can be unit
// tested without loading the db service's Express app / Supabase client.

// Given the columns PostgREST marks `required` (NOT NULL with no default) and the
// columns we require to be nullable, return the ones in violation (a stale NOT
// NULL constraint). Order follows `mustBeNullable`.
export function detectNotNullDrift(requiredColumns: string[], mustBeNullable: string[]): string[] {
    const required = new Set(requiredColumns);
    return mustBeNullable.filter((col) => required.has(col));
}
