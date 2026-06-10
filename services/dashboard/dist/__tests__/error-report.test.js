"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const error_report_1 = require("../lib/error-report");
describe('user error reports', () => {
    describe('normalizeErrorReport', () => {
        test('sanitizes and bounds the report metadata', () => {
            const report = (0, error_report_1.normalizeErrorReport)({
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
            const report = (0, error_report_1.normalizeErrorReport)({});
            expect(report.attemptId).toBeTruthy();
        });
    });
    describe('truncateStateForReport', () => {
        test('truncates oversized strings but keeps menu-sized text intact', () => {
            const menuText = 'STARTERS\nGuacamole 14\n'.repeat(100);
            const huge = 'x'.repeat(300000);
            const result = (0, error_report_1.truncateStateForReport)({ menuText, huge });
            expect(result.menuText).toBe(menuText);
            expect(result.huge.length).toBeLessThan(210000);
            expect(result.huge).toContain('[truncated');
        });
        test('bounds arrays, keys, and depth', () => {
            const deep = { level: 1 };
            let cursor = deep;
            for (let i = 2; i < 12; i++) {
                cursor.next = { level: i };
                cursor = cursor.next;
            }
            const result = (0, error_report_1.truncateStateForReport)({
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
            const decoded = (0, error_report_1.decodeScreenshotDataUrl)(`data:image/png;base64,${onePixelPng}`);
            expect(decoded).not.toBeNull();
            expect(decoded.contentType).toBe('image/png');
            expect(decoded.extension).toBe('png');
            expect(decoded.buffer.length).toBeGreaterThan(0);
        });
        test('decodes a jpeg data url', () => {
            const decoded = (0, error_report_1.decodeScreenshotDataUrl)(`data:image/jpeg;base64,${onePixelPng}`);
            expect(decoded.contentType).toBe('image/jpeg');
            expect(decoded.extension).toBe('jpg');
        });
        test('rejects non-image and malformed payloads', () => {
            expect((0, error_report_1.decodeScreenshotDataUrl)('data:text/html;base64,PGI+aGk8L2I+')).toBeNull();
            expect((0, error_report_1.decodeScreenshotDataUrl)('data:image/svg+xml;base64,abcd')).toBeNull();
            expect((0, error_report_1.decodeScreenshotDataUrl)('not a data url')).toBeNull();
            expect((0, error_report_1.decodeScreenshotDataUrl)(null)).toBeNull();
            expect((0, error_report_1.decodeScreenshotDataUrl)(12345)).toBeNull();
        });
        test('rejects oversized screenshots', () => {
            const oversized = `data:image/png;base64,${'A'.repeat(Math.ceil(error_report_1.MAX_SCREENSHOT_BYTES * 1.5))}`;
            expect((0, error_report_1.decodeScreenshotDataUrl)(oversized)).toBeNull();
        });
    });
    describe('shouldEmailErrorReport', () => {
        test('emails in production', () => {
            expect((0, error_report_1.shouldEmailErrorReport)({ NODE_ENV: 'production' })).toBe(true);
        });
        test('does not email outside production by default', () => {
            expect((0, error_report_1.shouldEmailErrorReport)({ NODE_ENV: 'development' })).toBe(false);
            expect((0, error_report_1.shouldEmailErrorReport)({})).toBe(false);
        });
        test('ERROR_REPORT_FORCE_EMAIL opts in outside production', () => {
            expect((0, error_report_1.shouldEmailErrorReport)({ NODE_ENV: 'development', ERROR_REPORT_FORCE_EMAIL: 'true' })).toBe(true);
            expect((0, error_report_1.shouldEmailErrorReport)({ ERROR_REPORT_FORCE_EMAIL: 'off' })).toBe(false);
        });
    });
    describe('buildErrorReportEmail', () => {
        test('builds a subject and escaped html body', () => {
            const report = (0, error_report_1.normalizeErrorReport)({
                attemptId: 'attempt-42',
                trigger: 'error_alert',
                context: 'Error <script>alert(1)</script> submitting',
                submitterName: 'Chef Ana',
                submitterEmail: 'chef@example.com',
                projectName: 'Tamayo Dinner 2026',
                property: 'Tamayo - Denver',
                recentAlerts: [{ time: '2026-06-10T15:00:00Z', type: 'error', message: 'Boom & bust' }],
            });
            const { subject, html } = (0, error_report_1.buildErrorReportEmail)(report, { hasScreenshot: true, dashboardUrl: 'http://localhost:3005' });
            expect(subject).toBe('[Menu Manager] User problem report: Tamayo Dinner 2026');
            expect(html).toContain('Chef Ana');
            expect(html).toContain('&lt;script&gt;');
            expect(html).not.toContain('<script>alert(1)</script>');
            expect(html).toContain('Boom &amp; bust');
            expect(html).toContain('Attached');
            expect(html).toContain('client-state.json');
        });
        test('explains a missing screenshot', () => {
            const report = (0, error_report_1.normalizeErrorReport)({ attemptId: 'a1', screenshotError: 'screenshot capture timed out' });
            const { html } = (0, error_report_1.buildErrorReportEmail)(report, { hasScreenshot: false });
            expect(html).toContain('Not captured (screenshot capture timed out)');
        });
    });
});
