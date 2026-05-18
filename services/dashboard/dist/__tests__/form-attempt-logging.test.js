"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const insertMock = jest.fn();
const fromMock = jest.fn(() => ({ insert: insertMock }));
jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    isSupabaseConfigured: jest.fn(() => true),
    getSupabaseClient: jest.fn(() => ({ from: fromMock })),
}));
const form_attempt_logging_1 = require("../lib/form-attempt-logging");
describe('form attempt logging', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        insertMock.mockResolvedValue({ error: null });
    });
    test('normalizes compact form attempt telemetry', () => {
        const normalized = (0, form_attempt_logging_1.normalizeFormAttemptEvent)({
            attemptId: ' attempt-123 ',
            eventType: 'submit_failed',
            submitterEmail: 'CHEF@EXAMPLE.COM ',
            projectName: 'Tamayo Beverage Menu 2026',
            property: 'Tamayo - Denver',
            submissionMode: 'modification',
            revisionSource: 'uploaded_unapproved',
            menuTextLength: '7204',
            menuHtmlLength: 30570,
            persistentDiffHtmlLength: '250000',
            requestBodyLength: '300001',
            criticalSuggestions: [
                {
                    type: 'Missing Price',
                    menuItem: 'Ritual Sauvignon Blanc',
                    description: 'No price listed',
                    recommendation: 'Add price',
                    severity: 'critical',
                },
            ],
        });
        expect(normalized).toMatchObject({
            attempt_id: 'attempt-123',
            event_type: 'submit_failed',
            submitter_email: 'chef@example.com',
            project_name: 'Tamayo Beverage Menu 2026',
            property: 'Tamayo - Denver',
            submission_mode: 'modification',
            revision_source: 'uploaded_unapproved',
            menu_text_length: 7204,
            menu_html_length: 30570,
            persistent_diff_html_length: 250000,
            request_body_length: 300001,
            critical_suggestions_count: 1,
        });
        expect(normalized.critical_suggestions[0]).toMatchObject({
            type: 'Missing Price',
            menuItem: 'Ritual Sauvignon Blanc',
        });
    });
    test('inserts telemetry into form_attempt_logs when Supabase is configured', async () => {
        await (0, form_attempt_logging_1.logFormAttemptEvent)({
            attemptId: 'attempt-456',
            eventType: 'basic_check_completed',
            suggestionsCount: 3,
        });
        expect(fromMock).toHaveBeenCalledWith('form_attempt_logs');
        expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
            attempt_id: 'attempt-456',
            event_type: 'basic_check_completed',
            suggestions_count: 3,
        }));
    });
    test('falls back to system alerts for failed events when attempt table is unavailable', async () => {
        insertMock
            .mockResolvedValueOnce({ error: { message: 'table not found' } })
            .mockResolvedValueOnce({ error: null });
        await (0, form_attempt_logging_1.logFormAttemptEvent)({
            attemptId: 'attempt-789',
            eventType: 'submit_failed',
            projectName: 'Tamayo Beverage Menu 2026',
            errorMessage: '413 Payload Too Large',
        });
        expect(fromMock).toHaveBeenNthCalledWith(1, 'form_attempt_logs');
        expect(fromMock).toHaveBeenNthCalledWith(2, 'system_alerts');
        expect(insertMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            alert_type: 'form_attempt_failed',
            service: 'dashboard',
        }));
    });
});
