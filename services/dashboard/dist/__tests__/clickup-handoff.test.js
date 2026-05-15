"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const clickup_handoff_1 = require("../lib/clickup-handoff");
describe('ClickUp handoff helpers', () => {
    test('rebuilds create-task payload from saved submission and raw payload metadata', () => {
        const payload = (0, clickup_handoff_1.buildClickUpTaskPayloadFromStoredSubmission)({
            id: 'sub-123',
            submitter_email: 'chef@example.com',
            submitter_name: 'Chef Example',
            submitter_job_title: 'Chef',
            project_name: 'Ladies Night',
            property: 'Toro Toro - Grosvenor House - Dubai',
            width: 'A4',
            height: 'A4',
            menu_type: 'standard',
            service_period: 'dinner',
            template_type: 'food',
            date_needed: '2026-05-20',
            city_country: 'Dubai, UAE',
            asset_type: 'PRINT',
            original_path: '/app/tmp/documents/toro/ladies/sub-123/original.docx',
            filename: 'Toro_Toro_Dinner_5.20.26.docx',
            approvals: JSON.stringify([{ approved: true, name: 'GM', position: 'GM' }]),
            critical_overrides: JSON.stringify([{ type: 'price', menuItem: 'Taco' }]),
            raw_payload: {
                print_region: 'NON_US',
                print_size: 'A4',
                folded: false,
                turnaround_days: 5,
                crop_marks: false,
                bleed_marks: false,
                file_size_limit: false,
            },
        }, [{
                asset_type: 'menu_image',
                storage_path: '/app/tmp/documents/toro/ladies/sub-123/assets/reference.pdf',
                file_name: 'reference.pdf',
            }]);
        expect(payload).toMatchObject({
            submissionId: 'sub-123',
            submitterEmail: 'chef@example.com',
            projectName: 'Ladies Night',
            property: 'Toro Toro - Grosvenor House - Dubai',
            printRegion: 'NON_US',
            printSize: 'A4',
            turnaroundDays: 5,
            docxPath: '/app/tmp/documents/toro/ladies/sub-123/original.docx',
            menuImagePath: '/app/tmp/documents/toro/ladies/sub-123/assets/reference.pdf',
            filename: 'Toro_Toro_Dinner_5.20.26.docx',
        });
        expect(payload.approvals).toEqual([{ approved: true, name: 'GM', position: 'GM' }]);
        expect(payload.criticalOverrides).toEqual([{ type: 'price', menuItem: 'Taco' }]);
    });
    test('merges retry metadata without dropping existing raw payload fields', () => {
        const merged = (0, clickup_handoff_1.mergeClickUpHandoffMetadata)({
            project_name: 'Ladies Night',
            clickup_handoff: {
                status: 'failed',
                retry_count: 1,
            },
        }, {
            status: 'retrying',
            last_attempt_at: '2026-05-14T19:50:00.000Z',
        });
        expect(merged.project_name).toBe('Ladies Night');
        expect(merged.clickup_handoff).toEqual({
            status: 'retrying',
            retry_count: 1,
            last_attempt_at: '2026-05-14T19:50:00.000Z',
        });
    });
});
