jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    getSupabaseClient: jest.fn(),
    isSupabaseConfigured: jest.fn(() => false),
}));

jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readFile: jest.fn(),
        },
    };
});

import { promises as fs } from 'fs';
import {
    getApprovedMenuDownload,
    listApprovedMenus,
} from '../lib/approved-menus';

const repoRoot = '/Users/deriancowser/Documents/MenuManager';
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('approved menu helpers', () => {
    beforeEach(() => {
        mockedFs.readFile.mockImplementation(async (target: any) => {
            const normalized = String(target);

            if (normalized.endsWith('/tmp/db/submissions.json')) {
                return JSON.stringify({
                    'form-200': {
                        id: 'form-200',
                        source: 'form',
                        status: 'approved',
                        project_name: 'Spring Dinner',
                        property: 'Test Property',
                        filename: 'Aqimero_Dinner_5.8.26.docx',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/Test Property/Spring Dinner/form-200/approved/form-200-approved.docx',
                        service_period: 'dinner',
                        reviewed_at: '2026-05-08T10:00:00.000Z',
                        submitter_name: 'Carlos',
                    },
                    'form-201': {
                        id: 'form-201',
                        source: 'form',
                        status: 'pending_human_review',
                        project_name: 'Pending Menu',
                        property: 'Test Property',
                        filename: 'Pending Menu.docx',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/pending.docx',
                    },
                    'design-1': {
                        id: 'design-1',
                        source: 'design_approval',
                        status: 'approved',
                        project_name: 'Design Only',
                        property: 'Test Property',
                        filename: 'Design Menu.docx',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/design.docx',
                        reviewed_at: '2026-05-09T10:00:00.000Z',
                    },
                });
            }

            if (normalized.endsWith('/tmp/db/assets.json')) {
                return JSON.stringify([
                    {
                        id: 'asset_1',
                        submission_id: 'form-200',
                        asset_type: 'approved_docx',
                        storage_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/Test Property/Spring Dinner/form-200/approved/form-200-approved.docx',
                        file_name: 'form-200-approved.docx',
                        created_at: '2026-05-08T10:05:00.000Z',
                    },
                ]);
            }

            throw new Error(`Unexpected read: ${normalized}`);
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('lists approved form submissions without relying on the DB service route', async () => {
        const approvedMenus = await listApprovedMenus(repoRoot, 'spring', 150);

        expect(approvedMenus).toEqual([
            expect.objectContaining({
                id: 'form-200',
                projectName: 'Spring Dinner',
                property: 'Test Property',
                approvedFileName: 'Aqimero_Dinner_5.8.26.docx',
                status: 'approved',
                servicePeriod: 'dinner',
                submitterName: 'Carlos',
            }),
        ]);
    });

    test('returns approved download metadata for a form submission', async () => {
        const approvedMenu = await getApprovedMenuDownload(repoRoot, 'form-200');

        expect(approvedMenu).toEqual({
            id: 'form-200',
            filename: 'Aqimero_Dinner_5.8.26.docx',
            finalPath: '/Users/deriancowser/Documents/MenuManager/tmp/documents/Test Property/Spring Dinner/form-200/approved/form-200-approved.docx',
            storagePath: '/Users/deriancowser/Documents/MenuManager/tmp/documents/Test Property/Spring Dinner/form-200/approved/form-200-approved.docx',
            status: 'approved',
            approvedFileName: 'Aqimero_Dinner_5.8.26.docx',
        });
    });

    test('ignores non-form or non-approved submissions for download', async () => {
        await expect(getApprovedMenuDownload(repoRoot, 'form-201')).resolves.toBeNull();
        await expect(getApprovedMenuDownload(repoRoot, 'design-1')).resolves.toBeNull();
    });
});
