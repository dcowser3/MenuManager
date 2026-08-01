import { getSupabaseClient, isSupabaseConfigured } from '@menumanager/supabase-client';
import { sanitizePlainTextInput } from './upload-security';

const DEFAULT_AUDIT_MAX_CHARS = 120000;
const MAX_AUDIT_ARRAY_ITEMS = 100;
const MAX_AUDIT_OBJECT_KEYS = 120;
const MAX_AUDIT_DEPTH = 8;

export type BasicAiCheckAuditEvent = {
    attemptId?: unknown;
    checkId?: unknown;
    eventType?: unknown;
    route?: unknown;
    statusCode?: unknown;
    submitterEmail?: unknown;
    submitterName?: unknown;
    projectName?: unknown;
    property?: unknown;
    servicePeriod?: unknown;
    templateType?: unknown;
    submissionMode?: unknown;
    revisionSource?: unknown;
    revisionBaselineFileName?: unknown;
    reviewMode?: unknown;
    changedLineCount?: unknown;
    menuTextLength?: unknown;
    preAiTextLength?: unknown;
    correctedMenuTextLength?: unknown;
    promptLength?: unknown;
    responseTextLength?: unknown;
    suggestionsCount?: unknown;
    criticalSuggestionsCount?: unknown;
    aiRequest?: unknown;
    aiResponse?: unknown;
    model?: unknown;
    systemFingerprint?: unknown;
    fenceMissing?: unknown;
    parsedResponse?: unknown;
    finalResult?: unknown;
    guardDiagnostics?: unknown;
    deterministicDiagnostics?: unknown;
    errorMessage?: unknown;
    menuContentRaw?: unknown;
    baselineMenuContentRaw?: unknown;
    submissionId?: unknown;
};

function parseBooleanFlag(value: unknown, fallback = false): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

export function isBasicAiCheckAuditEnabled(env: Record<string, string | undefined> = process.env): boolean {
    return parseBooleanFlag(env.BASIC_AI_CHECK_AUDIT_ENABLED, true);
}

function auditMaxChars(env: Record<string, string | undefined> = process.env): number {
    return parsePositiveInteger(env.BASIC_AI_CHECK_AUDIT_MAX_CHARS, DEFAULT_AUDIT_MAX_CHARS);
}

function textOrNull(value: unknown, maxLength = 255, multiline = false): string | null {
    const sanitized = sanitizePlainTextInput(value, { maxLength, multiline });
    return sanitized || null;
}

function numberOrNull(value: unknown): number | null {
    const parsed = Number.parseInt(`${value ?? ''}`, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function booleanOrNull(value: unknown): boolean | null {
    if (value === undefined || value === null || value === '') return null;
    return value === true || /^(1|true|yes|on)$/i.test(String(value).trim());
}

function truncateString(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function truncateJson(value: unknown, maxChars: number, depth = 0): unknown {
    if (value === null || value === undefined) return value ?? null;
    if (typeof value === 'string') return truncateString(value, maxChars);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= MAX_AUDIT_DEPTH) return '[max depth reached]';

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
        const entries = Object.entries(value as Record<string, unknown>);
        const truncatedEntries = entries
            .slice(0, MAX_AUDIT_OBJECT_KEYS)
            .map(([key, entryValue]) => [
                sanitizePlainTextInput(key, { maxLength: 200 }) || 'unknown',
                truncateJson(entryValue, maxChars, depth + 1),
            ]);
        if (entries.length > MAX_AUDIT_OBJECT_KEYS) {
            truncatedEntries.push(['_truncated_keys', entries.length - MAX_AUDIT_OBJECT_KEYS]);
        }
        return Object.fromEntries(truncatedEntries);
    }

    return truncateString(`${value}`, maxChars);
}

export function normalizeBasicAiCheckAuditEvent(
    event: BasicAiCheckAuditEvent,
    env: Record<string, string | undefined> = process.env
): Record<string, unknown> {
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
        model: textOrNull(event.model, 200),
        system_fingerprint: textOrNull(event.systemFingerprint, 200),
        fence_missing: booleanOrNull(event.fenceMissing),
        parsed_response: truncateJson(event.parsedResponse ?? null, maxChars),
        final_result: truncateJson(event.finalResult ?? null, maxChars),
        guard_diagnostics: truncateJson(event.guardDiagnostics ?? null, maxChars),
        deterministic_diagnostics: truncateJson(event.deterministicDiagnostics ?? null, maxChars),
        error_message: textOrNull(event.errorMessage, 1000, true),
        menu_content_raw: typeof event.menuContentRaw === 'string'
            ? truncateString(event.menuContentRaw, maxChars)
            : null,
        baseline_menu_content_raw: typeof event.baselineMenuContentRaw === 'string' && event.baselineMenuContentRaw
            ? truncateString(event.baselineMenuContentRaw, maxChars)
            : null,
        submission_id: textOrNull(event.submissionId, 100),
    };
}

export async function linkBasicAiCheckAuditsToSubmission(
    attemptId: string,
    submissionId: string
): Promise<void> {
    try {
        if (!isBasicAiCheckAuditEnabled()) return;
        if (!isSupabaseConfigured()) return;

        const attempt = sanitizePlainTextInput(attemptId, { maxLength: 100 });
        const submission = sanitizePlainTextInput(submissionId, { maxLength: 100 });
        if (!attempt || !submission) return;

        const supabase = getSupabaseClient();
        const { error } = await supabase
            .from('basic_ai_check_audits')
            .update({ submission_id: submission })
            .eq('attempt_id', attempt)
            .is('submission_id', null);

        if (error) {
            console.error('Failed to link Basic AI Check audits to submission:', error.message);
        }
    } catch (error: any) {
        console.error('Basic AI Check audit submission link failed:', error.message);
    }
}

// Optional audit columns are added by migrations over time. If a deployment
// has not applied one yet, retry without it so the pre-existing audit stream
// keeps flowing instead of dropping the whole row.
const OPTIONAL_AUDIT_COLUMNS = [
    'menu_content_raw',
    'baseline_menu_content_raw',
    'submission_id',
    'model',
    'system_fingerprint',
    'fence_missing',
] as const;

function isMissingOptionalAuditColumnError(message: string): boolean {
    return OPTIONAL_AUDIT_COLUMNS.some((column) => `${message || ''}`.includes(column));
}

function auditFailureContext(event: BasicAiCheckAuditEvent): Record<string, unknown> {
    return {
        attemptId: textOrNull(event.attemptId, 100),
        checkId: textOrNull(event.checkId, 100),
        eventType: textOrNull(event.eventType, 80),
        route: textOrNull(event.route, 160),
    };
}

export async function logBasicAiCheckAudit(event: BasicAiCheckAuditEvent): Promise<void> {
    try {
        if (!isBasicAiCheckAuditEnabled()) return;
        if (!isSupabaseConfigured()) return;

        const supabase = getSupabaseClient();
        const normalized = normalizeBasicAiCheckAuditEvent(event);
        const { error } = await supabase
            .from('basic_ai_check_audits')
            .insert(normalized);

        if (error && isMissingOptionalAuditColumnError(error.message)) {
            const legacyRecord = { ...normalized };
            for (const column of OPTIONAL_AUDIT_COLUMNS) {
                delete legacyRecord[column];
            }
            const { error: retryError } = await supabase
                .from('basic_ai_check_audits')
                .insert(legacyRecord);
            if (retryError) {
                console.error('[basic-ai-check-audit] INSERT FAILED after legacy retry', {
                    ...auditFailureContext(event),
                    originalError: error.message,
                    retryError: retryError.message,
                });
            } else {
                console.warn('Basic AI Check audit stored without one or more optional columns; apply the corresponding audit migrations');
            }
            return;
        }

        if (error) {
            console.error('[basic-ai-check-audit] INSERT FAILED', {
                ...auditFailureContext(event),
                error: error.message,
            });
        }
    } catch (error: any) {
        console.error('[basic-ai-check-audit] LOGGER EXCEPTION', {
            ...auditFailureContext(event),
            error: error?.message || `${error}`,
            stack: error?.stack,
        });
    }
}
