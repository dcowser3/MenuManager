import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

function loadEnvironment(): void {
    const candidates = [
        path.join(__dirname, '..', '..', '..', '.env'),
        path.join(process.cwd(), '.env'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            dotenv.config({ path: candidate });
            return;
        }
    }

    dotenv.config();
}

loadEnvironment();

// Singleton client instance
let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
    if (supabaseClient) {
        return supabaseClient;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    // Service-role only. The anon key was previously accepted as a last-resort
    // fallback, which meant a deploy missing the service key would come up
    // "working" and then fail every write once RLS is on (migration
    // 20260725_enable_row_level_security.sql). Fail loudly instead.
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error(
            'Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or legacy SUPABASE_SERVICE_KEY) in .env. '
            + 'The anon key is not accepted: RLS denies it on every table.'
        );
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey);
    return supabaseClient;
}

export function isSupabaseConfigured(): boolean {
    return !!(process.env.SUPABASE_URL && (
        process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_SERVICE_KEY
    ));
}
