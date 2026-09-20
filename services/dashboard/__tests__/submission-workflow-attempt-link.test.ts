import { createSubmissionWorkflowHandlers } from '../lib/submission-workflow';
// Use the built coordinator here so this workflow test exercises the same
// artifact loaded by the dashboard process without widening the legacy Jest
// ts-jest lib target for the source-only test harness.
const { completePreparedReview, prepareReview } = require('../dist/lib/review-pipeline');
const { policyHash } = require('../dist/lib/canonical-policy');
const { runSubmissionReviewThroughCoordinator } = require('../dist/index');

function buildDeps(overrides: Record<string, any> = {}) {
    const axios = {
        post: jest.fn().mockResolvedValue({ data: {} }),
        put: jest.fn().mockResolvedValue({ data: {} }),
    };
    return {
        axios,
        fs: {
            access: jest.fn().mockResolvedValue(undefined),
            mkdir: jest.fn().mockResolvedValue(undefined),
            copyFile: jest.fn().mockResolvedValue(undefined),
        } as any,
        DB_SERVICE_URL: 'http://db.test',
        AI_REVIEW_URL: 'http://ai.test',
        CLICKUP_SERVICE_URL: 'http://clickup.test',
        DEFAULT_ALLERGEN_KEY: 'V - Vegetarian',
        AI_REVIEW_SUBMIT_TIMEOUT_MS: 1000,
        CLICKUP_TASK_CREATE_TIMEOUT_MS: 1000,
        getTempUploadsDir: () => '/tmp/uploads',
        getSubmissionDocumentDir: () => '/tmp/docs',
        getPropertyCatalogFromDb: jest.fn().mockResolvedValue([{ name: 'Maya - New York' }]),
        resolveCityCountryFromCatalog: () => 'New York, USA',
        normalizeMenuFooter: (text: string) => ({
            body: text,
            normalizedAllergenLine: '',
            hadRawNotice: false,
            preservedFooterText: '',
        }),
        stripManagedFooterFromHtml: (html: string) => html,
        detectRawUndercookedContent: () => false,
        generateDocxFromForm: jest.fn().mockResolvedValue('/tmp/docs/test.docx'),
        sendAdminAlert: jest.fn(),
        isClientInputError: () => false,
        linkBasicAiCheckAuditsToSubmission: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function buildRequest(headers: Record<string, string> = {}) {
    return {
        hostname: 'localhost',
        get: (name: string) => headers[name.toLowerCase()] || '',
        body: {
            submitterName: 'Chef Test',
            submitterEmail: 'chef@example.com',
            submitterJobTitle: 'Executive Chef',
            projectName: 'Spring Menu',
            property: 'Maya - New York',
            orientation: 'portrait',
            menuType: 'standard',
            servicePeriod: 'dinner',
            templateType: 'food',
            dateNeeded: '2026-07-01',
            assetType: 'DIGITAL',
            digitalWidth: '1080',
            digitalHeight: '1920',
            turnaroundDays: '5',
            menuContent: 'GUACAMOLE\nfresh avocado, lime 12',
            approvals: [
                { approved: true, name: 'Grace GM', position: 'General Manager', email: 'grace@example.com' },
                { approved: true, name: 'Sam Ops', position: 'Operations', email: 'sam@example.com' },
            ],
            skipAiReview: true,
        },
    };
}

function buildResponse() {
    const res: any = {
        statusCode: 200,
        body: null,
        status(code: number) { this.statusCode = code; return this; },
        json(payload: any) { this.body = payload; return this; },
    };
    return res;
}

describe('submitMenu form attempt linkage', () => {
    test('routes a new full review through the injected coordinator and preserves legacy clients', async () => {
        const runSubmissionReview = jest.fn().mockResolvedValue({
            reviewStatus: { complete: true, transportStatus: 'complete', reusable: false },
            outputHash: 'out-hash',
            policyHash: 'policy-hash',
            contextHash: 'context-hash',
            engineVersion: 'review-coordinator-v1',
            correctedMenu: 'GUACAMOLE\nfresh avocado, lime 12',
            diagnostics: [],
        });
        const recordSubmissionReviewAudit = jest.fn();
        const deps = buildDeps({
            runSubmissionReview,
            recordSubmissionReviewAudit,
        });
        const handlers = createSubmissionWorkflowHandlers(deps as any);
        const req = buildRequest();
        req.body.skipAiReview = false;
        const res = buildResponse();

        await handlers.submitMenu(req, res);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(res.statusCode).toBe(200);
        expect(runSubmissionReview).toHaveBeenCalledTimes(1);
        expect(runSubmissionReview.mock.calls[0][0]).toEqual(expect.objectContaining({
            text: 'GUACAMOLE\nfresh avocado, lime 12',
            property: 'Maya - New York',
            templateType: 'food',
        }));
        expect(deps.axios.post).not.toHaveBeenCalledWith(
            'http://ai.test/ai-review',
            expect.anything(),
            expect.anything()
        );
        expect(recordSubmissionReviewAudit).toHaveBeenCalledWith(expect.objectContaining({
            status: 'complete',
            outputHash: 'out-hash',
            policyHash: 'policy-hash',
            contextHash: 'context-hash',
            engineVersion: 'review-coordinator-v1',
        }));
        expect(deps.axios.put).toHaveBeenCalledWith(
            expect.stringMatching(/\/submissions\/form-/),
            expect.objectContaining({ status: 'pending_human_review', ai_draft_path: expect.stringMatching(/-draft\.docx$/) })
        );
    });

    test('keeps an incomplete coordinator result fail-closed in manual review', async () => {
        const runSubmissionReview = jest.fn().mockResolvedValue({
            reviewStatus: { complete: false, transportStatus: 'rejected', reusable: false },
            outputHash: 'source-hash',
            policyHash: 'policy-hash',
            contextHash: 'context-hash',
            engineVersion: 'review-coordinator-v1',
            correctedMenu: 'GUACAMOLE\nfresh avocado, lime 12',
            diagnostics: [{ stage: 'submission_adapter', reason: 'coordinator_feedback_missing' }],
        });
        const recordSubmissionReviewAudit = jest.fn();
        const deps = buildDeps({ runSubmissionReview, recordSubmissionReviewAudit });
        const handlers = createSubmissionWorkflowHandlers(deps as any);
        const req = buildRequest();
        req.body.skipAiReview = false;
        const res = buildResponse();

        await handlers.submitMenu(req, res);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(res.statusCode).toBe(200);
        expect(recordSubmissionReviewAudit).toHaveBeenCalledWith(expect.objectContaining({
            status: 'rejected',
            complete: false,
            transportStatus: 'rejected',
            artifactProvenance: 'unreviewed_fallback',
            diagnostics: [{ stage: 'submission_adapter', reason: 'coordinator_feedback_missing' }],
        }));
        expect(deps.axios.put).toHaveBeenCalledWith(
            expect.stringMatching(/\/submissions\/form-/),
            expect.objectContaining({ status: 'pending_human_review' })
        );
        expect(deps.axios.put.mock.calls.some(([, payload]: [string, any]) => payload.ai_draft_path)).toBe(false);
    });

    test('runs the actual prepare/complete coordinator contract once at submission boundary', async () => {
        let modelCalls = 0;
        const runSubmissionReview = async (input: any) => {
            const prepared = await prepareReview(input.text, {
                basePrompt: 'SUBMISSION QA',
                property: input.property,
                templateType: input.templateType,
                menuType: input.menuType,
                allergens: input.allergens,
                precheckEnabled: false,
                contextProvenance: 'new_submission',
            });
            modelCalls += 1;
            const completed = completePreparedReview(
                prepared,
                `=== CORRECTED MENU ===\n${prepared.preCheckedReviewBody}\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===`,
                { finishReason: 'stop' }
            );
            return {
                reviewStatus: completed.reviewStatus,
                outputHash: completed.outputHash,
                policyHash: prepared.envelope.acceptedPolicyHash,
                contextHash: policyHash(prepared.envelope.context),
                engineVersion: prepared.envelope.engineVersion,
                correctedMenu: completed.authoritative.correctedMenu,
                diagnostics: completed.diagnostics,
            };
        };
        const deps = buildDeps({ runSubmissionReview });
        const handlers = createSubmissionWorkflowHandlers(deps as any);
        const req = buildRequest();
        req.body.skipAiReview = false;
        const res = buildResponse();

        await handlers.submitMenu(req, res);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(res.statusCode).toBe(200);
        expect(modelCalls).toBe(1);
        expect(deps.axios.post).not.toHaveBeenCalledWith('http://ai.test/ai-review', expect.anything(), expect.anything());
        expect(deps.generateDocxFromForm).toHaveBeenCalledTimes(2);
        expect(deps.generateDocxFromForm.mock.calls[1][1].menuContent).toBe('GUACAMOLE\nfresh avocado, lime 12');
    });

    test('submit handler invokes the actual dashboard coordinator adapter with mocked transport', async () => {
        const transport = {
            post: jest.fn(async (_url: string, payload: any) => ({
                data: {
                    ...payload,
                    feedback: `=== CORRECTED MENU ===\n${payload.text}\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===`,
                    finishReason: 'stop',
                    model: payload.effectiveExecutionIdentity.model,
                },
            })),
        };
        const deps = buildDeps({
            runSubmissionReview: (input: any) => runSubmissionReviewThroughCoordinator(input, {
                transport,
                readPrompt: async () => 'SUBMISSION QA',
                fetchAcceptedRules: async () => [],
                loadVocabulary: async () => [],
            }),
        });
        const handlers = createSubmissionWorkflowHandlers(deps as any);
        const req = buildRequest();
        req.body.skipAiReview = false;
        const res = buildResponse();

        await handlers.submitMenu(req, res);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(res.statusCode).toBe(200);
        expect(transport.post).toHaveBeenCalledTimes(1);
        expect(transport.post.mock.calls[0][1].textHash).toBeDefined();
        expect(transport.post.mock.calls[0][1].promptHash).toBeDefined();
        expect(transport.post.mock.calls[0][1].requestDigest).toBeDefined();
        expect(deps.generateDocxFromForm.mock.calls[1][1].menuContent).toBe('GUACAMOLE\nfresh avocado, lime 12');
    });

    test('unknown finish reason keeps the actual submission artifact unreviewed', async () => {
        const transport = {
            post: jest.fn(async (_url: string, payload: any) => ({
                data: {
                    ...payload,
                    feedback: 'malformed but present',
                    finishReason: 'provider_changed_its_mind',
                    model: payload.effectiveExecutionIdentity.model,
                },
            })),
        };
        const audit = jest.fn();
        const deps = buildDeps({
            recordSubmissionReviewAudit: audit,
            runSubmissionReview: (input: any) => runSubmissionReviewThroughCoordinator(input, {
                transport,
                readPrompt: async () => 'SUBMISSION QA',
                fetchAcceptedRules: async () => [],
                loadVocabulary: async () => [],
            }),
        });
        const handlers = createSubmissionWorkflowHandlers(deps as any);
        const req = buildRequest();
        req.body.skipAiReview = false;
        const res = buildResponse();

        await handlers.submitMenu(req, res);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(res.statusCode).toBe(200);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            complete: false,
            transportStatus: 'rejected',
            artifactProvenance: 'unreviewed_fallback',
            reason: 'coordinator_finish_reason_unknown',
        }));
        expect(deps.generateDocxFromForm).toHaveBeenCalledTimes(1);
    });

    test('stores form_attempt_id from the attempt header and links audits to the submission', async () => {
        const deps = buildDeps();
        const handlers = createSubmissionWorkflowHandlers(deps as any);
        const req = buildRequest({ 'x-menumanager-attempt-id': 'attempt-link-1' });
        const res = buildResponse();

        await handlers.submitMenu(req, res);

        expect(res.statusCode).toBe(200);
        const submissionPost = deps.axios.post.mock.calls.find(
            ([url]: [string]) => url === 'http://db.test/submissions'
        );
        expect(submissionPost).toBeDefined();
        expect(submissionPost![1].form_attempt_id).toBe('attempt-link-1');

        expect(deps.linkBasicAiCheckAuditsToSubmission).toHaveBeenCalledTimes(1);
        const [attemptId, submissionId] = (deps.linkBasicAiCheckAuditsToSubmission as jest.Mock).mock.calls[0];
        expect(attemptId).toBe('attempt-link-1');
        expect(submissionId).toBe(submissionPost![1].id);
    });

    test('omits the audit link when no attempt id is provided', async () => {
        const deps = buildDeps();
        const handlers = createSubmissionWorkflowHandlers(deps as any);
        const req = buildRequest();
        const res = buildResponse();

        await handlers.submitMenu(req, res);

        expect(res.statusCode).toBe(200);
        const submissionPost = deps.axios.post.mock.calls.find(
            ([url]: [string]) => url === 'http://db.test/submissions'
        );
        expect(submissionPost![1].form_attempt_id).toBeNull();
        expect(deps.linkBasicAiCheckAuditsToSubmission).not.toHaveBeenCalled();
    });

    test('queues confirmation email data with the generated docx for submitter and approvers', async () => {
        const sendSubmissionConfirmationEmails = jest.fn();
        const deps = buildDeps({ sendSubmissionConfirmationEmails });
        const handlers = createSubmissionWorkflowHandlers(deps as any);
        const req = buildRequest();
        const res = buildResponse();

        await handlers.submitMenu(req, res);

        expect(res.statusCode).toBe(200);
        expect(sendSubmissionConfirmationEmails).toHaveBeenCalledTimes(1);
        expect(sendSubmissionConfirmationEmails).toHaveBeenCalledWith(expect.objectContaining({
            projectName: 'Spring Menu',
            property: 'Maya - New York',
            submitterName: 'Chef Test',
            submitterEmail: 'chef@example.com',
            docxPath: '/tmp/docs/test.docx',
            filename: expect.stringMatching(/\.docx$/),
            approvals: [
                { approved: true, name: 'Grace GM', position: 'General Manager', email: 'grace@example.com' },
                { approved: true, name: 'Sam Ops', position: 'Operations', email: 'sam@example.com' },
            ],
        }));
    });
});
