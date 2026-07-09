import { getSupabaseClient, isSupabaseConfigured } from '@menumanager/supabase-client';
import { sanitizePlainTextInput } from './upload-security';

const MAX_ATTEMPT_ID_LENGTH = 100;
const MAX_ERROR_LENGTH = 1000;
const MAX_DETAILS_STRING_LENGTH = 4000;

export type FormAttemptEvent = {
    attemptId?: unknown;
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
    draftSessionId?: unknown;
    menuTextLength?: unknown;
    menuHtmlLength?: unknown;
    persistentDiffHtmlLength?: unknown;
    baseMenuTextLength?: unknown;
    correctedMenuTextLength?: unknown;
    requestBodyLength?: unknown;
    suggestionsCount?: unknown;
    criticalSuggestionsCount?: unknown;
    criticalSuggestions?: unknown;
    errorMessage?: unknown;
    details?: unknown;
};

function numberOrNull(value: unknown): number | null {
    const parsed = Number.parseInt(`${value ?? ''}`, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function textOrNull(value: unknown, maxLength = 255): string | null {
    const sanitized = sanitizePlainTextInput(value, { maxLength });
    return sanitized || null;
}

function truncateDetails(value: unknown): any {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
        return value.slice(0, MAX_DETAILS_STRING_LENGTH);
    }
    if (Array.isArray(value)) {
        return value.slice(0, 25).map(truncateDetails);
    }
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .slice(0, 60)
                .map(([key, entryValue]) => [key, truncateDetails(entryValue)])
        );
    }
    return value;
}

function normalizeCriticalSuggestions(value: unknown): any[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 25).map((suggestion: any) => ({
        type: textOrNull(suggestion?.type, 120),
        menuItem: textOrNull(suggestion?.menuItem, 240),
        description: textOrNull(suggestion?.description, 500),
        recommendation: textOrNull(suggestion?.recommendation, 500),
        severity: textOrNull(suggestion?.severity, 40),
        confidence: textOrNull(suggestion?.confidence, 40),
    }));
}

export function normalizeFormAttemptEvent(event: FormAttemptEvent): Record<string, any> {
    const attemptId = textOrNull(event.attemptId, MAX_ATTEMPT_ID_LENGTH) || `server-${Date.now()}`;
    const eventType = textOrNull(event.eventType, 80) || 'unknown';
    const criticalSuggestions = normalizeCriticalSuggestions(event.criticalSuggestions);

    return {
        attempt_id: attemptId,
        event_type: eventType,
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
        draft_session_id: textOrNull(event.draftSessionId, 100),
        menu_text_length: numberOrNull(event.menuTextLength),
        menu_html_length: numberOrNull(event.menuHtmlLength),
        persistent_diff_html_length: numberOrNull(event.persistentDiffHtmlLength),
        base_menu_text_length: numberOrNull(event.baseMenuTextLength),
        corrected_menu_text_length: numberOrNull(event.correctedMenuTextLength),
        request_body_length: numberOrNull(event.requestBodyLength),
        suggestions_count: numberOrNull(event.suggestionsCount),
        critical_suggestions_count: numberOrNull(event.criticalSuggestionsCount) ?? criticalSuggestions.length,
        critical_suggestions: criticalSuggestions.length ? criticalSuggestions : null,
        error_message: textOrNull(event.errorMessage, MAX_ERROR_LENGTH),
        details: truncateDetails(event.details),
    };
}

export async function logFormAttemptEvent(event: FormAttemptEvent): Promise<void> {
    try {
        if (!isSupabaseConfigured()) return;
        const supabase = getSupabaseClient();
        const normalized = normalizeFormAttemptEvent(event);
        const { error } = await supabase
            .from('form_attempt_logs')
            .insert(normalized);
        if (error) {
            console.error('Failed to log form attempt:', error.message);
            if (isFailureEvent(normalized.event_type)) {
                await supabase.from('system_alerts').insert({
                    alert_type: 'form_attempt_failed',
                    severity: 'warning',
                    service: 'dashboard',
                    submission_id: null,
                    message: `Form attempt ${normalized.event_type} for ${normalized.project_name || normalized.property || normalized.attempt_id}`,
                    details: {
                        form_attempt_logs_error: error.message,
                        attempt: normalized,
                    },
                });
            }
        }
    } catch (error: any) {
        console.error('Form attempt logging failed:', error.message);
    }
}

function isFailureEvent(eventType: string): boolean {
    return /failed|exception|payload_too_large|too_large/i.test(eventType || '');
}
