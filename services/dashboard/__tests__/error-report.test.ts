import {
    buildErrorReportEmail,
    buildErrorReportTriageEmail,
    buildErrorReportTriagePrompt,
    decodeScreenshotDataUrl,
    MAX_SCREENSHOT_BYTES,
    normalizeErrorReport,
    shouldEmailErrorReport,
    shouldRunErrorReportAiTriage,
    truncateStateForReport,
} from '../lib/error-report';

describe('user error reports', () => {
    describe('normalizeErrorReport', () => {
        test('sanitizes and bounds the report metadata', () => {
            const report = normalizeErrorReport({
                attemptId: '  attempt-42  ',
                trigger: 'error_alert',
                context: 'Error submitting menu: ClickUp task creation failed',
                pageUrl: 'http://localhost:3005/form',
                userAgent: 'Mozilla/5.0',
                viewport: '1440x900 @2x',
                submitterName: ' Chef Ana ',
                submitterEmail: 'CHEF@Example.com ',
                projectName: 'Tamayo Dinner 2026',
                property: 'Tamayo - Denver',
                submissionMode: 'modification',
                recentAlerts: [
                    { time: '2026-06-10T15:00:00Z', type: 'error', message: 'Please fill in all required fields' },
                    { time: 'not-a-date', type: 'info', message: '' },
                ],
                state: { fields: { projectName: 'Tamayo Dinner 2026' } },
            });

            expect(report.attemptId).toBe('attempt-42');
            expect(report.context).toContain('ClickUp task creation failed');
            expect(report.submitterEmail).toBe('chef@example.com');
            expect(report.submitterName).toBe('Chef Ana');
            expect(report.recentAlerts).toHaveLength(1);
            expect(report.recentAlerts[0].message).toBe('Please fill in all required fields');
            expect(report.state.fields.projectName).toBe('Tamayo Dinner 2026');
        });

        test('always produces an attempt id', () => {
            const report = normalizeErrorReport({});
            expect(report.attemptId).toBeTruthy();
        });
    });

    describe('truncateStateForReport', () => {
        test('truncates oversized strings but keeps menu-sized text intact', () => {
            const menuText = 'STARTERS\nGuacamole 14\n'.repeat(100);
            const huge = 'x'.repeat(300_000);
            const result = truncateStateForReport({ menuText, huge });
            expect(result.menuText).toBe(menuText);
            expect(result.huge.length).toBeLessThan(210_000);
            expect(result.huge).toContain('[truncated');
        });

        test('bounds arrays, keys, and depth', () => {
            const deep: any = { level: 1 };
            let cursor = deep;
            for (let i = 2; i < 12; i++) {
                cursor.next = { level: i };
                cursor = cursor.next;
            }
            const result = truncateStateForReport({
                deep,
                list: Array.from({ length: 500 }, (_, i) => i),
            });
            expect(result.list).toHaveLength(251);
            expect(result.list[250]).toContain('truncated');
            expect(JSON.stringify(result.deep)).toContain('[max depth reached]');
        });
    });

    describe('decodeScreenshotDataUrl', () => {
        const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

        test('decodes a png data url', () => {
            const decoded = decodeScreenshotDataUrl(`data:image/png;base64,${onePixelPng}`);
            expect(decoded).not.toBeNull();
            expect(decoded!.contentType).toBe('image/png');
            expect(decoded!.extension).toBe('png');
            expect(decoded!.buffer.length).toBeGreaterThan(0);
        });

        test('decodes a jpeg data url', () => {
            const decoded = decodeScreenshotDataUrl(`data:image/jpeg;base64,${onePixelPng}`);
            expect(decoded!.contentType).toBe('image/jpeg');
            expect(decoded!.extension).toBe('jpg');
        });

        test('rejects non-image and malformed payloads', () => {
            expect(decodeScreenshotDataUrl('data:text/html;base64,PGI+aGk8L2I+')).toBeNull();
            expect(decodeScreenshotDataUrl('data:image/svg+xml;base64,abcd')).toBeNull();
            expect(decodeScreenshotDataUrl('not a data url')).toBeNull();
            expect(decodeScreenshotDataUrl(null)).toBeNull();
            expect(decodeScreenshotDataUrl(12345)).toBeNull();
        });

        test('rejects oversized screenshots', () => {
            const oversized = `data:image/png;base64,${'A'.repeat(Math.ceil(MAX_SCREENSHOT_BYTES * 1.5))}`;
            expect(decodeScreenshotDataUrl(oversized)).toBeNull();
        });
    });

    describe('shouldEmailErrorReport', () => {
        test('emails in production', () => {
            expect(shouldEmailErrorReport({ NODE_ENV: 'production' })).toBe(true);
        });

        test('does not email outside production by default', () => {
            expect(shouldEmailErrorReport({ NODE_ENV: 'development' })).toBe(false);
            expect(shouldEmailErrorReport({})).toBe(false);
        });

        test('ERROR_REPORT_FORCE_EMAIL opts in outside production', () => {
            expect(shouldEmailErrorReport({ NODE_ENV: 'development', ERROR_REPORT_FORCE_EMAIL: 'true' })).toBe(true);
            expect(shouldEmailErrorReport({ ERROR_REPORT_FORCE_EMAIL: 'off' })).toBe(false);
        });
    });

    describe('shouldRunErrorReportAiTriage', () => {
        test('runs only with a real OpenAI key and production or force opt-in', () => {
            expect(shouldRunErrorReportAiTriage({ NODE_ENV: 'production', OPENAI_API_KEY: 'sk-test' })).toBe(true);
            expect(shouldRunErrorReportAiTriage({ NODE_ENV: 'development', OPENAI_API_KEY: 'sk-test' })).toBe(false);
            expect(shouldRunErrorReportAiTriage({ NODE_ENV: 'development', OPENAI_API_KEY: 'sk-test', ERROR_REPORT_AI_TRIAGE_FORCE: 'true' })).toBe(true);
            expect(shouldRunErrorReportAiTriage({ NODE_ENV: 'production', OPENAI_API_KEY: 'your-openai-api-key-here' })).toBe(false);
            expect(shouldRunErrorReportAiTriage({ NODE_ENV: 'production', OPENAI_API_KEY: 'sk-test', ERROR_REPORT_AI_TRIAGE_DISABLED: 'true' })).toBe(false);
        });
    });

    describe('buildErrorReportEmail', () => {
        test('builds a lightweight incident email with escaped html body', () => {
            const report = normalizeErrorReport({
                attemptId: 'attempt-42',
                trigger: 'error_alert',
                context: 'Error <script>alert(1)</script> submitting',
                submitterName: 'Chef Ana',
                submitterEmail: 'chef@example.com',
                projectName: 'Tamayo Dinner 2026',
                property: 'Tamayo - Denver',
                recentAlerts: [{ time: '2026-06-10T15:00:00Z', type: 'error', message: 'Boom & bust' }],
            });
            const { subject, html } = buildErrorReportEmail(report, {
                incidentId: 'err-20260615T120000Z-abcd1234',
                savedTo: '/app/tmp/error-reports/err-20260615T120000Z-abcd1234',
                stateJsonLength: 1234,
                screenshotBytes: 5678,
                hasScreenshot: true,
                dashboardUrl: 'http://localhost:3005',
            });

            expect(subject).toBe('[Menu Manager] Incident err-20260615T120000Z-abcd1234: Tamayo Dinner 2026');
            expect(html).toContain('Incident ID');
            expect(html).toContain('err-20260615T120000Z-abcd1234');
            expect(html).toContain('Chef Ana');
            expect(html).toContain('&lt;script&gt;');
            expect(html).not.toContain('<script>alert(1)</script>');
            expect(html).toContain('Boom &amp; bust');
            expect(html).toContain('5678 bytes saved on server');
            expect(html).toContain('Use the incident id');
        });

        test('explains a missing screenshot', () => {
            const report = normalizeErrorReport({ attemptId: 'a1', screenshotError: 'screenshot capture timed out' });
            const { html } = buildErrorReportEmail(report, {
                incidentId: 'err-1',
                savedTo: '/tmp/error-reports/err-1',
                hasScreenshot: false,
            });
            expect(html).toContain('Not captured (screenshot capture timed out)');
        });
    });

    describe('AI triage helpers', () => {
        test('builds an incident-aware triage prompt and escaped proposal email', () => {
            const report = normalizeErrorReport({
                attemptId: 'attempt-42',
                trigger: 'critical_error_banner',
                context: 'Resolve critical errors',
                projectName: 'Tamayo Dinner 2026',
                property: 'Tamayo - Denver',
                state: {
                    page: { url: 'http://localhost:3005/form' },
                    appState: { submissionMode: 'modification', revisionSource: 'uploaded_unapproved' },
                    aiCheck: { hasCriticalErrors: true },
                    menuEditor: { menuTextLength: 500000, menuHtmlLength: 900000, menuText: 'x'.repeat(10000), menuHtml: '<p>x</p>' },
                },
            });
            const incident = {
                incidentId: 'err-20260615T120000Z-abcd1234',
                savedTo: '/app/tmp/error-reports/err-20260615T120000Z-abcd1234',
                stateJsonLength: 9000,
                screenshotBytes: 1234,
            };

            const prompt = buildErrorReportTriagePrompt(report, incident);
            expect(prompt).toContain('production Menu Manager public-form incident');
            expect(prompt).toContain('err-20260615T120000Z-abcd1234');
            expect(prompt).toContain('uploaded_unapproved');
            expect(prompt.length).toBeLessThan(20000);

            const { subject, html } = buildErrorReportTriageEmail(
                report,
                incident,
                'Likely cause: <script>alert(1)</script>',
                { model: 'gpt-4o-mini', dashboardUrl: 'http://localhost:3005' }
            );
            expect(subject).toContain('AI triage for err-20260615T120000Z-abcd1234');
            expect(html).toContain('&lt;script&gt;');
            expect(html).not.toContain('<script>alert(1)</script>');
            expect(html).toContain('gpt-4o-mini');
        });
    });
});
