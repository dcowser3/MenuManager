"use strict";
// Pure Supabase schema-drift helpers, kept side-effect-free so they can be unit
// tested without loading the db service's Express app / Supabase client.
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectNotNullDrift = detectNotNullDrift;
// Given the columns PostgREST marks `required` (NOT NULL with no default) and the
// columns we require to be nullable, return the ones in violation (a stale NOT
// NULL constraint). Order follows `mustBeNullable`.
function detectNotNullDrift(requiredColumns, mustBeNullable) {
    const required = new Set(requiredColumns);
    return mustBeNullable.filter((col) => required.has(col));
}
