"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
const supabase_client_1 = require("@menumanager/supabase-client");
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const app = (0, express_1.default)();
const port = 3004;
const DB_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'db');
const SUBMISSIONS_DB = path.join(DB_DIR, 'submissions.json');
const REPORTS_DB = path.join(DB_DIR, 'reports.json');
const PROFILES_DB = path.join(DB_DIR, 'submitter_profiles.json');
const ASSETS_DB = path.join(DB_DIR, 'assets.json');
const SUBMISSIONS_TABLE = 'submissions';
const SUBMITTER_PROFILES_TABLE = 'submitter_profiles';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPABASE_SUBMISSION_COLUMNS = new Set([
    'id',
    'legacy_id',
    'project_name',
    'property',
    'width',
    'height',
    'crop_marks',
    'bleed_marks',
    'file_size_limit',
    'file_size_limit_mb',
    'file_delivery_notes',
    'orientation',
    'menu_type',
    'template_type',
    'date_needed',
    'submitter_email',
    'submitter_name',
    'submitter_job_title',
    'hotel_name',
    'city_country',
    'asset_type',
    'menu_content',
    'menu_content_html',
    'approvals',
    'critical_overrides',
    'submission_mode',
    'revision_source',
    'revision_base_submission_id',
    'revision_baseline_doc_path',
    'revision_baseline_file_name',
    'base_approved_menu_content',
    'chef_persistent_diff',
    'approved_menu_content_raw',
    'approved_menu_content',
    'approved_text_extracted_at',
    'filename',
    'original_path',
    'ai_draft_path',
    'final_path',
    'clickup_task_id',
    'status',
    'changes_made',
    'source',
    'created_at',
    'updated_at',
    'reviewed_at',
    'raw_payload',
]);
function toSupabaseSubmissionRecord(payload) {
    const mapped = {};
    for (const [key, value] of Object.entries(payload || {})) {
        if (!SUPABASE_SUBMISSION_COLUMNS.has(key))
            continue;
        if (value === undefined)
            continue;
        mapped[key] = value;
    }
    const incomingId = (payload?.id || '').toString().trim();
    if (incomingId) {
        if (UUID_REGEX.test(incomingId)) {
            mapped.id = incomingId;
        }
        else {
            mapped.legacy_id = incomingId;
            delete mapped.id;
        }
    }
    // Preserve the complete submission payload for audit/debug parity.
    // This guarantees no field is lost even if schema evolves later.
    mapped.raw_payload = payload;
    return mapped;
}
async function mirrorSubmissionCreateToSupabase(localSubmission) {
    if (!(0, supabase_client_1.isSupabaseConfigured)())
        return;
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const record = toSupabaseSubmissionRecord(localSubmission);
    const legacyId = record.legacy_id;
    if (legacyId) {
        const { data: existing, error: lookupError } = await supabase
            .from(SUBMISSIONS_TABLE)
            .select('id')
            .eq('legacy_id', legacyId)
            .maybeSingle();
        if (lookupError) {
            throw new Error(`Supabase lookup failed: ${lookupError.message}`);
        }
        if (existing?.id) {
            const { error: updateError } = await supabase
                .from(SUBMISSIONS_TABLE)
                .update({ ...record, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
            if (updateError) {
                throw new Error(`Supabase update failed: ${updateError.message}`);
            }
            return;
        }
    }
    const { error } = await supabase.from(SUBMISSIONS_TABLE).insert(record);
    if (error) {
        throw new Error(`Supabase insert failed: ${error.message}`);
    }
}
async function mirrorSubmissionUpdateToSupabase(localId, updates) {
    if (!(0, supabase_client_1.isSupabaseConfigured)())
        return;
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const record = toSupabaseSubmissionRecord(updates);
    delete record.id;
    delete record.legacy_id;
    record.updated_at = new Date().toISOString();
    let matchId = localId;
    if (!UUID_REGEX.test(localId)) {
        const { data, error } = await supabase
            .from(SUBMISSIONS_TABLE)
            .select('id')
            .eq('legacy_id', localId)
            .maybeSingle();
        if (error) {
            throw new Error(`Supabase legacy lookup failed: ${error.message}`);
        }
        if (!data?.id) {
            // No Supabase row to update yet; caller can ignore.
            return;
        }
        matchId = data.id;
    }
    const { error } = await supabase
        .from(SUBMISSIONS_TABLE)
        .update(record)
        .eq('id', matchId);
    if (error) {
        throw new Error(`Supabase update failed: ${error.message}`);
    }
}
// Ensure DB directory and files exist
async function initDb() {
    try {
        await fs_1.promises.mkdir(DB_DIR, { recursive: true });
        await fs_1.promises.access(SUBMISSIONS_DB).catch(() => fs_1.promises.writeFile(SUBMISSIONS_DB, '{}')); // Now an object
        await fs_1.promises.access(REPORTS_DB).catch(() => fs_1.promises.writeFile(REPORTS_DB, '[]'));
        await fs_1.promises.access(PROFILES_DB).catch(() => fs_1.promises.writeFile(PROFILES_DB, '{}'));
        await fs_1.promises.access(ASSETS_DB).catch(() => fs_1.promises.writeFile(ASSETS_DB, '[]'));
    }
    catch (error) {
        console.error('Failed to initialize database:', error);
    }
}
app.use(express_1.default.json());
// Endpoint to create a new submission
app.post('/submissions', async (req, res) => {
    try {
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        const newId = req.body.id || `sub_${Date.now()}`;
        const newSubmission = {
            ...req.body,
            id: newId,
            status: req.body.status || 'processing',
            created_at: req.body.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        submissions[newId] = newSubmission;
        await fs_1.promises.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));
        try {
            await mirrorSubmissionCreateToSupabase(newSubmission);
        }
        catch (supabaseError) {
            console.error('Supabase mirror create failed (kept local JSON write):', supabaseError.message);
        }
        res.status(201).json(newSubmission);
    }
    catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).send('Error saving submission.');
    }
});
// Endpoint to get all pending submissions (for dashboard)
// IMPORTANT: This must come BEFORE the /:id route
app.get('/submissions/pending', async (req, res) => {
    try {
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq('status', 'pending_human_review')
                .order('created_at', { ascending: false });
            if (error) {
                throw new Error(error.message);
            }
            return res.status(200).json(data || []);
        }
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        const pending = Object.values(submissions).filter((sub) => sub.status === 'pending_human_review');
        res.status(200).json(pending);
    }
    catch (error) {
        console.error('Error getting pending submissions:', error);
        res.status(500).send('Error getting pending submissions.');
    }
});
// Endpoint to get recent projects (grouped by project_name)
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/recent-projects', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        let allSubs = [];
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq('source', 'form')
                .not('project_name', 'is', null)
                .order('created_at', { ascending: false })
                .limit(500);
            if (error) {
                throw new Error(error.message);
            }
            allSubs = data || [];
        }
        else {
            const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
            allSubs = Object.values(submissions);
        }
        // Filter to form submissions only
        const formSubs = allSubs.filter(s => s.source === 'form' && s.project_name);
        // Group by project_name (case-insensitive), keep most recent
        const projectMap = {};
        formSubs.forEach(s => {
            const key = (s.project_name || '').toLowerCase().trim();
            if (!key)
                return;
            if (!projectMap[key] || new Date(s.created_at) > new Date(projectMap[key].created_at)) {
                projectMap[key] = s;
            }
        });
        // Sort by most recent, return top N
        const projects = Object.values(projectMap)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit)
            .map((s) => ({
            projectName: s.project_name,
            property: s.property || '',
            width: s.width || '',
            height: s.height || '',
            cropMarks: s.crop_marks || '',
            bleedMarks: s.bleed_marks || '',
            fileSizeLimit: s.file_size_limit || '',
            fileSizeLimitMb: s.file_size_limit_mb || '',
            fileDeliveryNotes: s.file_delivery_notes || '',
            orientation: s.orientation || '',
            menuType: s.menu_type || 'standard',
            templateType: s.template_type || 'food',
            hotelName: s.hotel_name || '',
            cityCountry: s.city_country || '',
            assetType: s.asset_type || '',
        }));
        res.json(projects);
    }
    catch (error) {
        console.error('Error getting recent projects:', error);
        res.status(500).json([]);
    }
});
// Search approved submissions for "modification" flow.
// Query can match project/property/submitter and returns newest first.
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim().toLowerCase();
        const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
        if (q.length < 2) {
            return res.json([]);
        }
        let sourceRows = [];
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const like = `%${q}%`;
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq('status', 'approved')
                .or(`project_name.ilike.${like},property.ilike.${like},submitter_name.ilike.${like},submitter_email.ilike.${like},hotel_name.ilike.${like},city_country.ilike.${like}`)
                .order('updated_at', { ascending: false })
                .limit(limit);
            if (error) {
                throw new Error(error.message);
            }
            sourceRows = data || [];
        }
        else {
            const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
            const approvedStatuses = new Set(['approved']);
            sourceRows = Object.values(submissions)
                .filter((s) => approvedStatuses.has((s.status || '').toLowerCase()))
                .filter((s) => {
                const haystack = [
                    s.project_name,
                    s.property,
                    s.submitter_name,
                    s.submitter_email,
                    s.hotel_name,
                    s.city_country,
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                return haystack.includes(q);
            })
                .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
                .slice(0, limit);
        }
        const results = sourceRows.map((s) => ({
            id: s.legacy_id || s.id,
            projectName: s.project_name || '',
            property: s.property || '',
            submitterName: s.submitter_name || '',
            submitterEmail: s.submitter_email || '',
            dateNeeded: s.date_needed || '',
            updatedAt: s.updated_at || s.created_at,
            approvedMenuContent: s.approved_menu_content || s.menu_content || '',
            status: s.status,
        }));
        res.json(results);
    }
    catch (error) {
        console.error('Error searching submissions:', error);
        res.status(500).json([]);
    }
});
// Latest approved submission for a project/property pair.
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/latest-approved', async (req, res) => {
    try {
        const projectName = (req.query.projectName || '').trim().toLowerCase();
        const property = (req.query.property || '').trim().toLowerCase();
        if (!projectName || !property) {
            return res.status(400).json({ error: 'projectName and property are required' });
        }
        let match = null;
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq('status', 'approved')
                .ilike('project_name', projectName)
                .ilike('property', property)
                .order('updated_at', { ascending: false })
                .limit(1);
            if (error) {
                throw new Error(error.message);
            }
            match = (data || [])[0] || null;
        }
        else {
            const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
            match = Object.values(submissions)
                .filter((s) => (s.status || '').toLowerCase() === 'approved')
                .filter((s) => (s.project_name || '').trim().toLowerCase() === projectName &&
                (s.property || '').trim().toLowerCase() === property)
                .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())[0];
        }
        if (!match) {
            return res.status(404).json({ error: 'No approved submission found' });
        }
        res.json(match);
    }
    catch (error) {
        console.error('Error finding latest approved submission:', error);
        res.status(500).json({ error: 'Failed to find approved submission' });
    }
});
// Submitter profile search
app.get('/submitter-profiles/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim().toLowerCase();
        if (q.length < 2) {
            return res.json([]);
        }
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const like = `%${q}%`;
            const { data, error } = await supabase
                .from(SUBMITTER_PROFILES_TABLE)
                .select('*')
                .ilike('name', like)
                .order('last_used', { ascending: false })
                .limit(8);
            if (!error && data) {
                return res.json(data.map((p) => ({
                    name: p.name || '',
                    email: p.email || '',
                    jobTitle: p.job_title || '',
                    lastUsed: p.last_used || p.updated_at || p.created_at,
                })));
            }
        }
        const profiles = JSON.parse(await fs_1.promises.readFile(PROFILES_DB, 'utf-8'));
        const matches = Object.values(profiles)
            .filter((p) => p.name.toLowerCase().includes(q))
            .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
            .slice(0, 8);
        res.json(matches);
    }
    catch (error) {
        console.error('Error searching submitter profiles:', error);
        res.json([]);
    }
});
// Submitter profile upsert
app.post('/submitter-profiles', async (req, res) => {
    try {
        const { name, email, jobTitle } = req.body;
        if (!name || !email) {
            return res.status(400).json({ error: 'name and email are required' });
        }
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const now = new Date().toISOString();
            const { error } = await supabase
                .from(SUBMITTER_PROFILES_TABLE)
                .upsert({
                name: name.trim(),
                email: email.trim(),
                job_title: (jobTitle || '').trim(),
                last_used: now,
                updated_at: now,
            }, { onConflict: 'email' });
            if (error) {
                console.error('Supabase submitter profile upsert failed, falling back local:', error.message);
            }
        }
        const key = name.toLowerCase().trim();
        const profiles = JSON.parse(await fs_1.promises.readFile(PROFILES_DB, 'utf-8'));
        const now = new Date().toISOString();
        profiles[key] = {
            name: name.trim(),
            email: email.trim(),
            jobTitle: (jobTitle || '').trim(),
            lastUsed: now,
        };
        await fs_1.promises.writeFile(PROFILES_DB, JSON.stringify(profiles, null, 2));
        res.json(profiles[key]);
    }
    catch (error) {
        console.error('Error saving submitter profile:', error);
        res.status(500).json({ error: 'Failed to save profile' });
    }
});
// Lookup submission by ClickUp task ID
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/by-clickup-task/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq('clickup_task_id', taskId)
                .maybeSingle();
            if (!error && data) {
                return res.json(data);
            }
        }
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        const match = Object.values(submissions).find((sub) => sub.clickup_task_id === taskId);
        if (!match) {
            return res.status(404).json({ error: 'No submission found for this ClickUp task' });
        }
        res.json(match);
    }
    catch (error) {
        console.error('Error looking up submission by ClickUp task:', error);
        res.status(500).send('Error looking up submission.');
    }
});
// Endpoint to get a single submission by ID
app.get('/submissions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const idColumn = UUID_REGEX.test(id) ? 'id' : 'legacy_id';
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq(idColumn, id)
                .maybeSingle();
            if (!error && data) {
                return res.status(200).json(data);
            }
        }
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        if (!submissions[id]) {
            return res.status(404).send('Submission not found.');
        }
        res.status(200).json(submissions[id]);
    }
    catch (error) {
        console.error('Error getting submission:', error);
        res.status(500).send('Error getting submission.');
    }
});
// Endpoint to update a submission's status and paths
app.put('/submissions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        let resolvedId = id;
        // When Supabase is enabled, callers may pass UUID `id`, but local JSON
        // uses legacy form IDs as keys. Resolve UUID -> local key if needed.
        if (!submissions[resolvedId]) {
            const match = Object.entries(submissions).find(([, value]) => {
                return value?.id === id || value?.legacy_id === id;
            });
            if (match) {
                resolvedId = match[0];
            }
        }
        if (!submissions[resolvedId]) {
            if ((0, supabase_client_1.isSupabaseConfigured)()) {
                // Allow UUID/legacy-id updates even when local JSON entry is missing.
                try {
                    await mirrorSubmissionUpdateToSupabase(id, req.body || {});
                    const supabase = (0, supabase_client_1.getSupabaseClient)();
                    const idColumn = UUID_REGEX.test(id) ? 'id' : 'legacy_id';
                    const { data } = await supabase
                        .from(SUBMISSIONS_TABLE)
                        .select('*')
                        .eq(idColumn, id)
                        .maybeSingle();
                    return res.status(200).json(data || { id, ...req.body, updated_at: new Date().toISOString() });
                }
                catch (supabaseError) {
                    console.error('Supabase-only submission update failed:', supabaseError.message);
                }
            }
            return res.status(404).send('Submission not found.');
        }
        const updatedSubmission = { ...submissions[resolvedId], ...req.body, updated_at: new Date().toISOString() };
        submissions[resolvedId] = updatedSubmission;
        await fs_1.promises.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));
        try {
            await mirrorSubmissionUpdateToSupabase(id, updatedSubmission);
        }
        catch (supabaseError) {
            console.error('Supabase mirror update failed (kept local JSON write):', supabaseError.message);
        }
        res.status(200).json(updatedSubmission);
    }
    catch (error) {
        console.error('Error updating submission:', error);
        res.status(500).send('Error updating submission.');
    }
});
// Asset metadata for storage abstraction (local now, Teams later)
app.post('/assets', async (req, res) => {
    try {
        const { submission_id, revision_submission_id, asset_type, source, storage_provider, storage_path, file_name, meta } = req.body;
        if (!submission_id || !asset_type || !storage_path) {
            return res.status(400).json({ error: 'submission_id, asset_type, and storage_path are required' });
        }
        const assets = JSON.parse(await fs_1.promises.readFile(ASSETS_DB, 'utf-8'));
        const newAsset = {
            id: `asset_${Date.now()}`,
            submission_id,
            revision_submission_id: revision_submission_id || null,
            asset_type,
            source: source || 'system',
            storage_provider: storage_provider || 'local',
            storage_path,
            file_name: file_name || null,
            meta: meta || null,
            created_at: new Date().toISOString(),
        };
        assets.push(newAsset);
        await fs_1.promises.writeFile(ASSETS_DB, JSON.stringify(assets, null, 2));
        res.status(201).json(newAsset);
    }
    catch (error) {
        console.error('Error saving asset metadata:', error);
        res.status(500).json({ error: 'Failed to save asset metadata' });
    }
});
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/assets/by-submission/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const assets = JSON.parse(await fs_1.promises.readFile(ASSETS_DB, 'utf-8'));
        const matches = assets
            .filter((a) => a.submission_id === submissionId)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        res.json(matches);
    }
    catch (error) {
        console.error('Error getting submission assets:', error);
        res.status(500).json([]);
    }
});
// Endpoint to create a new report (can be deprecated or used for logging)
app.post('/reports', async (req, res) => {
    try {
        const { submission_id, report_json, ai_confidence } = req.body;
        const reports = JSON.parse(await fs_1.promises.readFile(REPORTS_DB, 'utf-8'));
        const newReport = {
            id: Date.now().toString(),
            submission_id,
            report_json,
            ai_confidence,
            created_at: new Date().toISOString()
        };
        reports.push(newReport);
        await fs_1.promises.writeFile(REPORTS_DB, JSON.stringify(reports, null, 2));
        res.status(201).json(newReport);
    }
    catch (error) {
        console.error('Error saving report:', error);
        res.status(500).send('Error saving report.');
    }
});
app.listen(port, () => {
    console.log(`db service listening at http://localhost:${port}`);
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        console.log('Supabase mirror: enabled');
    }
    else {
        console.log('Supabase mirror: disabled (missing SUPABASE_URL/SUPABASE_*_KEY)');
    }
    initDb();
});
