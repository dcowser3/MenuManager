import fs from 'fs';
import path from 'path';

const ejs = require('ejs');
const { getTenantConfig } = require('@menumanager/tenant-config');

const viewPath = path.resolve(__dirname, '../views/approved-menus.ejs');

function renderApprovedMenus(overrides: Record<string, unknown> = {}) {
    const template = fs.readFileSync(viewPath, 'utf8');
    const tenant = getTenantConfig();
    return ejs.render(template, {
        title: 'Approved Menus',
        approvedMenus: [],
        hasSearch: false,
        searchQuery: '',
        restaurantQuery: '',
        servicePeriodQuery: '',
        propertyCatalog: [],
        tenant,
        ...overrides,
    }, { filename: viewPath });
}

const sampleMenu = {
    id: 'form-abc123',
    projectName: 'Spring Dinner',
    property: 'Test Property',
    filename: 'Test_Dinner_6.1.26.docx',
    approvedFileName: 'Test_Dinner_6.1.26.docx',
    reviewedAt: '2026-06-01T12:00:00.000Z',
    servicePeriod: 'Dinner',
    submitterName: 'Chef Test',
    status: 'approved',
};

describe('approved menus view', () => {
    test('renders edit and download actions when results are present', () => {
        const html = renderApprovedMenus({
            hasSearch: true,
            approvedMenus: [sampleMenu],
        });

        expect(html).toContain('action="/api/drafts"');
        expect(html).toContain('name="baseSubmissionId" value="form-abc123"');
        expect(html).toContain('Edit This Menu');

        // Clean download (primary)
        expect(html).toContain('/download/approved-clean/form-abc123');
        expect(html).toContain('Download Clean Word Doc');

        // Original approved download (secondary)
        expect(html).toContain('/download/approved/form-abc123');
        expect(html).toContain('Download Original Approved');
    });

    test('renders empty state when no search has been performed', () => {
        const html = renderApprovedMenus({ hasSearch: false, approvedMenus: [] });

        expect(html).toContain('Find the latest approved starting point');
    });

    test('renders no results message when search yields nothing', () => {
        const html = renderApprovedMenus({ hasSearch: true, approvedMenus: [] });

        expect(html).toContain('No approved menus found');
    });
});
