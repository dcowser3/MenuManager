'use strict';

/** Canonical Supabase service-role key resolution (F3). Prefer modern dashboard label. */
function resolveSupabaseServiceKey(env = process.env) {
    return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || '';
}

function requireSupabaseServiceKey(env = process.env) {
    const url = `${env.SUPABASE_URL || ''}`.trim();
    const key = resolveSupabaseServiceKey(env);
    if (!url || !key) {
        throw new Error(
            'SUPABASE_URL and a service key are required (SUPABASE_SERVICE_ROLE_KEY, legacy SUPABASE_SERVICE_KEY, or SUPABASE_ANON_KEY)'
        );
    }
    return key;
}

module.exports = { resolveSupabaseServiceKey, requireSupabaseServiceKey };
