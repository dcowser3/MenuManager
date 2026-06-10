"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mockInsert = jest.fn();
const mockFrom = jest.fn(() => ({ insert: mockInsert }));
const mockIsSupabaseConfigured = jest.fn(() => true);
jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    isSupabaseConfigured: mockIsSupabaseConfigured,
    getSupabaseClient: jest.fn(() => ({ from: mockFrom })),
}));
const basic_ai_check_audit_1 = require("../lib/basic-ai-check-audit");
describe('Basic AI Check audit logging', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockInsert.mockResolvedValue({ error: null });
        mockIsSupabaseConfigured.mockReturnValue(true);
        delete process.env.BASIC_AI_CHECK_AUDIT_ENABLED;
        delete process.env.BASIC_AI_CHECK_AUDIT_MAX_CHARS;
    });
    test('normalizes metadata and truncates large request and response bodies', () => {
        const normalized = (0, basic_ai_check_audit_1.normalizeBasicAiCheckAuditEvent)({
            attemptId: ' attempt-123 ',
            checkId: ' check-456 ',
            eventType: 'completed',
            submitterEmail: 'CHEF@EXAMPLE.COM ',
            projectName: 'FIFA Menu',
            property: 'Maya - New York',
            reviewMode: 'full',
            changedLineCount: '0',
            menuTextLength: '20',
            promptLength: 200,
            aiRequest: {
                text: 'Lagunitas N/A',
                prompt: 'x'.repeat(12),
            },
            aiResponse: {
                rawFeedback: 'y'.repeat(12),
            },
        }, {
            BASIC_AI_CHECK_AUDIT_MAX_CHARS: '5',
        });
        expect(normalized).toMatchObject({
            attempt_id: 'attempt-123',
            check_id: 'check-456',
            event_type: 'completed',
            submitter_email: 'chef@example.com',
            project_name: 'FIFA Menu',
            property: 'Maya - New York',
            review_mode: 'full',
            changed_line_count: 0,
            menu_text_length: 20,
            prompt_length: 200,
        });
        expect(normalized.ai_request.text).toContain('...[truncated');
        expect(normalized.ai_request.prompt).toBe('xxxxx\n...[truncated 7 chars]');
        expect(normalized.ai_response.rawFeedback).toBe('yyyyy\n...[truncated 7 chars]');
    });
    test('inserts an audit row when Supabase is configured', async () => {
        await (0, basic_ai_check_audit_1.logBasicAiCheckAudit)({
            attemptId: 'attempt-456',
            checkId: 'check-789',
            eventType: 'completed',
            aiRequest: { text: 'Athletic N/A\nLagunitas N/A' },
            finalResult: { correctedMenu: 'Athletic N/A\nLagunitas N/A' },
        });
        expect(mockFrom).toHaveBeenCalledWith('basic_ai_check_audits');
        expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
            attempt_id: 'attempt-456',
            check_id: 'check-789',
            event_type: 'completed',
            ai_request: expect.objectContaining({
                text: 'Athletic N/A\nLagunitas N/A',
            }),
            final_result: expect.objectContaining({
                correctedMenu: 'Athletic N/A\nLagunitas N/A',
            }),
        }));
    });
    test('can be disabled with BASIC_AI_CHECK_AUDIT_ENABLED=false', async () => {
        process.env.BASIC_AI_CHECK_AUDIT_ENABLED = 'false';
        expect((0, basic_ai_check_audit_1.isBasicAiCheckAuditEnabled)()).toBe(false);
        await (0, basic_ai_check_audit_1.logBasicAiCheckAudit)({
            attemptId: 'attempt-disabled',
            eventType: 'completed',
        });
        expect(mockFrom).not.toHaveBeenCalled();
    });
});
