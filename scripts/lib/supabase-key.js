'use strict';

/**
 * Canonical Supabase service-role key resolution (F3). Prefer modern dashboard label.
 * The anon key is deliberately NOT a fallback: RLS (migration
 * 20260725_enable_row_level_security.sql) denies it on every table, so accepting
 * it would turn a misconfigured job into a silent no-op instead of a clear error.
 */
function resolveSupabaseServiceKey(env = process.env) {
    return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '';
}

function requireSupabaseServiceKey(env = process.env) {
    const url = `${env.SUPABASE_URL || ''}`.trim();
    const key = resolveSupabaseServiceKey(env);
    if (!url || !key) {
        throw new Error(
            'SUPABASE_URL and a service key are required (SUPABASE_SERVICE_ROLE_KEY or legacy SUPABASE_SERVICE_KEY)'
        );
    }
    return key;
}

module.exports = { resolveSupabaseServiceKey, requireSupabaseServiceKey };
