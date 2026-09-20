import { createSubmissionWorkflowHandlers } from '../lib/submission-workflow';
// Use the built coordinator here so this workflow test exercises the same
// artifact loaded by the dashboard process without widening the legacy Jest
// ts-jest lib target for the source-only test harness.
const { completePreparedReview, prepareReview } = require('../dist/lib/review-pipeline');
const { policyHash } = require('../dist/lib/canonical-policy');
const { generateDocxFromForm, runSubmissionReviewThroughCoordinator } = require('../dist/index');
const nodeFs = require('fs').promises;
const nodeFsSync = require('fs');
const nodePath = require('path');
const mammoth = require('mammoth');

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
                    schemaVersion: payload.schemaVersion,
                    engineVersion: payload.engineVersion,
                    textHash: payload.textHash,
                    promptHash: payload.promptHash,
                    requestDigest: payload.requestDigest,
                    callerAttestations: payload.callerAttestations,
                    effectiveExecutionIdentity: payload.effectiveExecutionIdentity,
                    replayIdentity: payload.replayIdentity,
                    feedback: `=== CORRECTED MENU ===\n${payload.text}\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===`,
                    finishReason: 'stop',
                    requestedModel: payload.effectiveExecutionIdentity.model,
                    observedModel: payload.effectiveExecutionIdentity.model,
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
                    schemaVersion: payload.schemaVersion,
                    engineVersion: payload.engineVersion,
                    textHash: payload.textHash,
                    promptHash: payload.promptHash,
                    requestDigest: payload.requestDigest,
                    callerAttestations: payload.callerAttestations,
                    effectiveExecutionIdentity: payload.effectiveExecutionIdentity,
                    replayIdentity: payload.replayIdentity,
                    feedback: 'malformed but present',
                    finishReason: 'provider_changed_its_mind',
                    requestedModel: payload.effectiveExecutionIdentity.model,
                    observedModel: payload.effectiveExecutionIdentity.model,
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
            reason: 'coordinator_finish_reason_provider_changed_its_mind',
        }));
        expect(deps.generateDocxFromForm).toHaveBeenCalledTimes(1);
    });

    test.each([
        [null, 'coordinator_finish_reason_missing'],
        ['length', 'coordinator_finish_reason_length'],
    ])('null/missing or truncated finish reason is never a completed reviewed draft (%s)', async (finishReason, expectedReason) => {
        const transport = {
            post: jest.fn(async (_url: string, payload: any) => ({
                data: {
                    schemaVersion: payload.schemaVersion,
                    engineVersion: payload.engineVersion,
                    textHash: payload.textHash,
                    promptHash: payload.promptHash,
                    requestDigest: payload.requestDigest,
                    callerAttestations: payload.callerAttestations,
                    effectiveExecutionIdentity: payload.effectiveExecutionIdentity,
                    replayIdentity: payload.replayIdentity,
                    feedback: 'valid-looking feedback',
                    finishReason,
                    requestedModel: payload.effectiveExecutionIdentity.model,
                    observedModel: payload.effectiveExecutionIdentity.model,
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
            reusable: false,
            artifactProvenance: 'unreviewed_fallback',
            reason: expectedReason,
        }));
        expect(deps.generateDocxFromForm).toHaveBeenCalledTimes(1);
    });

    test('Docker-only real template/parser lifecycle persists authoritative DOCX bytes and preserves original', async () => {
        // The host test harness may not have python-docx installed. Docker has
        // the documented docx-redliner venv, so this exact lifecycle is proved
        // there rather than substituted with a text file.
        if (!nodeFsSync.existsSync(nodePath.join(__dirname, '../../docx-redliner/venv/bin/python'))) {
            expect(true).toBe(true);
            return;
        }
        const generatedPaths: string[] = [];
        const realGenerateDocxFromForm = jest.fn(async (submissionId: string, formData: any, options: any = {}) => {
            const outputPath = await generateDocxFromForm(submissionId, formData, options);
            generatedPaths.push(outputPath);
            return outputPath;
        });
        const transport = {
            post: jest.fn(async (_url: string, payload: any) => ({
                data: {
                    schemaVersion: payload.schemaVersion,
                    engineVersion: payload.engineVersion,
                    textHash: payload.textHash,
                    promptHash: payload.promptHash,
                    requestDigest: payload.requestDigest,
                    callerAttestations: payload.callerAttestations,
                    effectiveExecutionIdentity: payload.effectiveExecutionIdentity,
                    replayIdentity: payload.replayIdentity,
                    feedback: '=== CORRECTED MENU ===\nGUACAMOLE\nfresh avocado, lime 12\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===',
                    finishReason: 'stop',
                    requestedModel: payload.effectiveExecutionIdentity.model,
                    observedModel: payload.effectiveExecutionIdentity.model,
                },
            })),
        };
        const deps = buildDeps({
            generateDocxFromForm: realGenerateDocxFromForm,
            normalizeMenuFooter: (text: string, allergens: string) => ({
                body: text,
                normalizedAllergenLine: allergens,
                hadRawNotice: false,
                preservedFooterText: '',
            }),
            runSubmissionReview: (input: any) => runSubmissionReviewThroughCoordinator(input, {
                transport,
                readPrompt: async () => 'SUBMISSION QA',
                fetchAcceptedRules: async () => [],
                loadVocabulary: async () => [],
            }),
        });
        const handlers = createSubmissionWorkflowHandlers(deps as any);
        const req = buildRequest();
        req.body.menuContent = 'GUACAMOLE\nfresh avacado, lime 12';
        (req.body as any).allergens = 'G - Gluten | V - Vegetarian';
        req.body.skipAiReview = false;
        const res = buildResponse();

        await handlers.submitMenu(req, res);
        // The real Python generator is asynchronous and can take a second in
        // the isolated container; wait for the fire-and-forget review task.
        await new Promise((resolve) => setTimeout(resolve, 2000));

        expect(res.statusCode).toBe(200);
        expect(generatedPaths).toHaveLength(2);
        const originalText = (await mammoth.extractRawText({ path: generatedPaths[0] })).value;
        const draftText = (await mammoth.extractRawText({ path: generatedPaths[1] })).value;
        expect(originalText).toContain('GUACAMOLE');
        expect(originalText).toContain('fresh avacado, lime 12');
        expect(originalText).toContain('G - Gluten | V - Vegetarian');
        expect(originalText).not.toContain('fresh avocado, lime 12');
        expect(draftText).toContain('GUACAMOLE');
        expect(draftText).toContain('fresh avocado, lime 12');
        expect(draftText).toContain('G - Gluten | V - Vegetarian');
        expect(deps.axios.put).toHaveBeenCalledWith(
            expect.stringMatching(/\/submissions\/form-/),
            expect.objectContaining({ status: 'pending_human_review', ai_draft_path: generatedPaths[1] })
        );
    });

    test('Docker-only real DOCX failed review publishes no reviewed draft path', async () => {
        if (!nodeFsSync.existsSync(nodePath.join(__dirname, '../../docx-redliner/venv/bin/python'))) {
            expect(true).toBe(true);
            return;
        }
        const generatedPaths: string[] = [];
        const realGenerateDocxFromForm = jest.fn(async (submissionId: string, formData: any, options: any = {}) => {
            const outputPath = await generateDocxFromForm(submissionId, formData, options);
            generatedPaths.push(outputPath);
            return outputPath;
        });
        const transport = {
            post: jest.fn(async (_url: string, payload: any) => ({ data: {
                schemaVersion: payload.schemaVersion,
                engineVersion: payload.engineVersion,
                textHash: payload.textHash,
                promptHash: payload.promptHash,
                requestDigest: payload.requestDigest,
                callerAttestations: payload.callerAttestations,
                effectiveExecutionIdentity: payload.effectiveExecutionIdentity,
                replayIdentity: payload.replayIdentity,
                feedback: '=== CORRECTED MENU ===\nGUACAMOLE\nfresh avocado, lime 13\n=== END CORRECTED MENU ===',
                finishReason: 'length',
                requestedModel: payload.effectiveExecutionIdentity.model,
                observedModel: payload.effectiveExecutionIdentity.model,
            } })),
        };
        const audit = jest.fn();
        const deps = buildDeps({
            generateDocxFromForm: realGenerateDocxFromForm,
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
        req.body.menuContent = 'GUACAMOLE\nfresh avocado, lime 12';
        (req.body as any).allergens = 'G - Gluten | V - Vegetarian';
        req.body.skipAiReview = false;
        const res = buildResponse();

        await handlers.submitMenu(req, res);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        expect(res.statusCode).toBe(200);
        expect(generatedPaths).toHaveLength(1);
        const originalText = (await mammoth.extractRawText({ path: generatedPaths[0] })).value;
        expect(originalText).toContain('fresh avocado, lime 12');
        expect(originalText).not.toContain('fresh avocado, lime 13');
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            complete: false,
            artifactProvenance: 'unreviewed_fallback',
            reason: 'coordinator_finish_reason_length',
        }));
        expect(deps.axios.put).toHaveBeenCalledWith(
            expect.stringMatching(/\/submissions\/form-/),
            expect.objectContaining({ status: 'pending_human_review' })
        );
        expect(deps.axios.put.mock.calls.some(([, payload]: [string, any]) => payload.ai_draft_path)).toBe(false);
    });

    test('late-anchor rejection preserves delivered spelling and genuine critical state', async () => {
        const transport = {
            post: jest.fn(async (_url: string, payload: any) => ({
                data: {
                    schemaVersion: payload.schemaVersion,
                    engineVersion: payload.engineVersion,
                    textHash: payload.textHash,
                    promptHash: payload.promptHash,
                    requestDigest: payload.requestDigest,
                    callerAttestations: payload.callerAttestations,
                    effectiveExecutionIdentity: payload.effectiveExecutionIdentity,
                    replayIdentity: payload.replayIdentity,
                    feedback: '=== CORRECTED MENU ===\nDINNER\nFish 12\nFish 12\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[{"type":"Missing Price","severity":"critical","confidence":"high","menuItem":"candidate-only","description":"invent","recommendation":"invent"}]\n=== END SUGGESTIONS ===',
                    finishReason: 'stop',
                    requestedModel: payload.effectiveExecutionIdentity.model,
                    observedModel: payload.effectiveExecutionIdentity.model,
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
        req.body.menuContent = 'DINNER\nFishh 12\nFishh 12';
        req.body.skipAiReview = false;
        const res = buildResponse();

        // Exercise the same exported submission adapter directly first. The
        // duplicate near-miss rows survive the scoped precheck; the rejected
        // merge must return the immutable delivered bytes plus a genuine
        // source-derived critical allergen finding (not the candidate-only
        // critical suggestion supplied by the mocked provider).
        const direct = await runSubmissionReviewThroughCoordinator({
            submissionId: 'late-boundary-direct',
            text: req.body.menuContent,
            submitterEmail: 'chef@example.com',
            filename: 'late.docx',
            originalPath: '/tmp/late.docx',
            projectName: 'Spring Menu',
            property: 'Maya - New York',
            templateType: 'food',
            menuType: 'standard',
            allergens: 'V - Vegetarian',
            submissionMode: 'new',
            revisionSource: '',
        }, {
            transport,
            readPrompt: async () => 'SUBMISSION QA',
            fetchAcceptedRules: async () => [],
            loadVocabulary: async () => [],
        });
        expect(direct.correctedMenu).toBe(req.body.menuContent);
        expect(direct.reviewStatus).toEqual(expect.objectContaining({ complete: false, transportStatus: 'rejected' }));
        expect(direct.hasCriticalErrors).toBe(true);
        expect(direct.criticalSuggestions).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'Allergen Code', menuItem: 'Entire menu', severity: 'critical' }),
        ]));
        expect(direct.diagnostics.length).toBeGreaterThan(0);

        await handlers.submitMenu(req, res);
        await new Promise((resolve) => setTimeout(resolve, 25));

        expect(res.statusCode).toBe(200);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            complete: false,
            artifactProvenance: 'unreviewed_fallback',
            diagnostics: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('duplicate_row_fallback') })]),
        }));
        expect(deps.generateDocxFromForm).toHaveBeenCalledTimes(1);
        expect(transport.post).toHaveBeenCalledTimes(2);
    });

    test.each(['transport', 'response_identity'])('actual submit failure path is manual-only with no legacy fallback (%s)', async (kind) => {
        const transport = {
            post: kind === 'transport'
                ? jest.fn().mockRejectedValue(Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }))
                : jest.fn(async () => ({ data: { schemaVersion: 1, engineVersion: 'review-coordinator-v1', feedback: 'x' } })),
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
        await new Promise((resolve) => setTimeout(resolve, 25));

        expect(res.statusCode).toBe(200);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            complete: false,
            artifactProvenance: 'unreviewed_fallback',
            reason: kind === 'transport'
                ? 'coordinator_transport_failed:ECONNREFUSED'
                : 'coordinator_response_invalid:missing_response_identity',
        }));
        expect(deps.generateDocxFromForm).toHaveBeenCalledTimes(1);
        expect(deps.axios.post).not.toHaveBeenCalledWith('http://ai.test/ai-review', expect.anything(), expect.anything());
    });

    test.each([
        ['requestDigest', (response: any) => { response.requestDigest = 'wrong-digest'; }, 'coordinator_response_identity_mismatch'],
        ['textHash', (response: any) => { response.textHash = 'wrong-text-hash'; }, 'coordinator_response_identity_mismatch'],
        ['promptHash', (response: any) => { response.promptHash = 'wrong-prompt-hash'; }, 'coordinator_response_identity_mismatch'],
        ['execution settings', (response: any) => { response.effectiveExecutionIdentity = { ...response.effectiveExecutionIdentity, temperature: 0.7 }; }, 'coordinator_response_identity_mismatch'],
        ['replay identity', (response: any) => { response.replayIdentity = 'other-replay'; }, 'coordinator_response_identity_mismatch'],
        ['schema version', (response: any) => { response.schemaVersion = 2; }, 'coordinator_response_invalid:version_mismatch'],
        ['engine version', (response: any) => { response.engineVersion = 'other-engine'; }, 'coordinator_response_invalid:version_mismatch'],
        ['requested model alias', (response: any) => { response.requestedModel = `${response.requestedModel}-snapshot`; }, 'coordinator_response_identity_mismatch'],
        ['observed model alias', (response: any) => { response.observedModel = `${response.observedModel}-snapshot`; }, 'coordinator_response_identity_mismatch'],
    ])('valid-shaped coordinator response mutation fails closed without legacy retry (%s)', async (_label, mutate, expectedReason) => {
        const transport = {
            post: jest.fn(async (_url: string, payload: any) => {
                const response = {
                    schemaVersion: payload.schemaVersion,
                    engineVersion: payload.engineVersion,
                    textHash: payload.textHash,
                    promptHash: payload.promptHash,
                    requestDigest: payload.requestDigest,
                    callerAttestations: payload.callerAttestations,
                    effectiveExecutionIdentity: payload.effectiveExecutionIdentity,
                    replayIdentity: payload.replayIdentity,
                    feedback: '=== CORRECTED MENU ===\nGUACAMOLE\nfresh avocado, lime 13\n=== END CORRECTED MENU ===',
                    finishReason: 'stop',
                    requestedModel: payload.effectiveExecutionIdentity.model,
                    observedModel: payload.effectiveExecutionIdentity.model,
                };
                mutate(response);
                return { data: response };
            }),
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
        expect(transport.post).toHaveBeenCalledTimes(1);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            complete: false,
            transportStatus: 'rejected',
            artifactProvenance: 'unreviewed_fallback',
            reason: expectedReason,
        }));
        expect(deps.generateDocxFromForm).toHaveBeenCalledTimes(1);
        expect(deps.axios.post).not.toHaveBeenCalledWith('http://ai.test/ai-review', expect.anything(), expect.anything());
        expect(deps.axios.put.mock.calls.some(([, payload]: [string, any]) => payload.ai_draft_path)).toBe(false);
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
