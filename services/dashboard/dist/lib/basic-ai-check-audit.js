"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBasicAiCheckAuditEnabled = isBasicAiCheckAuditEnabled;
exports.normalizeBasicAiCheckAuditEvent = normalizeBasicAiCheckAuditEvent;
exports.logBasicAiCheckAudit = logBasicAiCheckAudit;
const supabase_client_1 = require("@menumanager/supabase-client");
const upload_security_1 = require("./upload-security");
const DEFAULT_AUDIT_MAX_CHARS = 120000;
const MAX_AUDIT_ARRAY_ITEMS = 100;
const MAX_AUDIT_OBJECT_KEYS = 120;
const MAX_AUDIT_DEPTH = 8;
function parseBooleanFlag(value, fallback = false) {
    if (value === undefined || value === null || value === '')
        return fallback;
    return /^(1|true|yes|on)$/i.test(String(value).trim());
}
function parsePositiveInteger(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.floor(parsed);
}
function isBasicAiCheckAuditEnabled(env = process.env) {
    return parseBooleanFlag(env.BASIC_AI_CHECK_AUDIT_ENABLED, true);
}
function auditMaxChars(env = process.env) {
    return parsePositiveInteger(env.BASIC_AI_CHECK_AUDIT_MAX_CHARS, DEFAULT_AUDIT_MAX_CHARS);
}
function textOrNull(value, maxLength = 255, multiline = false) {
    const sanitized = (0, upload_security_1.sanitizePlainTextInput)(value, { maxLength, multiline });
    return sanitized || null;
}
function numberOrNull(value) {
    const parsed = Number.parseInt(`${value ?? ''}`, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function truncateString(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}
function truncateJson(value, maxChars, depth = 0) {
    if (value === null || value === undefined)
        return value ?? null;
    if (typeof value === 'string')
        return truncateString(value, maxChars);
    if (typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (depth >= MAX_AUDIT_DEPTH)
        return '[max depth reached]';
    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_AUDIT_ARRAY_ITEMS)
            .map((item) => truncateJson(item, maxChars, depth + 1));
        if (value.length > MAX_AUDIT_ARRAY_ITEMS) {
            items.push(`[+${value.length - MAX_AUDIT_ARRAY_ITEMS} more items truncated]`);
        }
        return items;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value);
        const truncatedEntries = entries
            .slice(0, MAX_AUDIT_OBJECT_KEYS)
            .map(([key, entryValue]) => [
            (0, upload_security_1.sanitizePlainTextInput)(key, { maxLength: 200 }) || 'unknown',
            truncateJson(entryValue, maxChars, depth + 1),
        ]);
        if (entries.length > MAX_AUDIT_OBJECT_KEYS) {
            truncatedEntries.push(['_truncated_keys', entries.length - MAX_AUDIT_OBJECT_KEYS]);
        }
        return Object.fromEntries(truncatedEntries);
    }
    return truncateString(`${value}`, maxChars);
}
function normalizeBasicAiCheckAuditEvent(event, env = process.env) {
    const maxChars = auditMaxChars(env);
    const aiRequest = truncateJson(event.aiRequest ?? null, maxChars);
    const aiResponse = truncateJson(event.aiResponse ?? null, maxChars);
    return {
        attempt_id: textOrNull(event.attemptId, 100),
        check_id: textOrNull(event.checkId, 100),
        event_type: textOrNull(event.eventType, 80) || 'basic_check_audit',
        route: textOrNull(event.route, 160),
        status_code: numberOrNull(event.statusCode),
        submitter_email: textOrNull(event.submitterEmail, 255)?.toLowerCase() || null,
        submitter_name: textOrNull(event.submitterName, 255),
        project_name: textOrNull(event.projectName, 255),
        property: textOrNull(event.property, 255),
        service_period: textOrNull(event.servicePeriod, 100),
        template_type: textOrNull(event.templateType, 100),
        submission_mode: textOrNull(event.submissionMode, 50),
        revision_source: textOrNull(event.revisionSource, 100),
        revision_baseline_file_name: textOrNull(event.revisionBaselineFileName, 255),
        review_mode: textOrNull(event.reviewMode, 64),
        changed_line_count: numberOrNull(event.changedLineCount),
        menu_text_length: numberOrNull(event.menuTextLength),
        pre_ai_text_length: numberOrNull(event.preAiTextLength),
        corrected_menu_text_length: numberOrNull(event.correctedMenuTextLength),
        prompt_length: numberOrNull(event.promptLength),
        response_text_length: numberOrNull(event.responseTextLength),
        suggestions_count: numberOrNull(event.suggestionsCount),
        critical_suggestions_count: numberOrNull(event.criticalSuggestionsCount),
        ai_request: aiRequest,
        ai_response: aiResponse,
        parsed_response: truncateJson(event.parsedResponse ?? null, maxChars),
        final_result: truncateJson(event.finalResult ?? null, maxChars),
        guard_diagnostics: truncateJson(event.guardDiagnostics ?? null, maxChars),
        deterministic_diagnostics: truncateJson(event.deterministicDiagnostics ?? null, maxChars),
        error_message: textOrNull(event.errorMessage, 1000, true),
    };
}
async function logBasicAiCheckAudit(event) {
    try {
        if (!isBasicAiCheckAuditEnabled())
            return;
        if (!(0, supabase_client_1.isSupabaseConfigured)())
            return;
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { error } = await supabase
            .from('basic_ai_check_audits')
            .insert(normalizeBasicAiCheckAuditEvent(event));
        if (error) {
            console.error('Failed to log Basic AI Check audit:', error.message);
        }
    }
    catch (error) {
        console.error('Basic AI Check audit logging failed:', error.message);
    }
}
