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
        menuCards: [],
        hasSearch: false,
        searchQuery: '',
        restaurantQuery: '',
        servicePeriodQuery: '',
        submissionId: '',
        propertyCatalog: [],
        tenant,
        ...overrides,
    }, { filename: viewPath });
}

function version(over: Record<string, unknown> = {}) {
    return {
        submissionId: 'form-abc123',
        legacyId: '',
        approvedFileName: 'Test_Dinner_6.1.26.docx',
        reviewedAt: '2026-06-01T12:00:00.000Z',
        status: 'approved',
        isCurrent: true,
        ...over,
    };
}

function sampleCard(over: Record<string, unknown> = {}) {
    const current = version();
    return {
        menuId: 'menu-1',
        hasMenuEntity: true,
        name: 'Dinner',
        property: 'Test Property',
        servicePeriod: 'Dinner',
        submitterName: 'Chef Test',
        current,
        versions: [current],
        versionCount: 1,
        activeDraft: null,
        ...over,
    };
}

describe('approved menus view (menu-centric)', () => {
    test('renders one card per menu with edit + downloads targeting the current version', () => {
        const html = renderApprovedMenus({ hasSearch: true, menuCards: [sampleCard()] });

        expect(html).toContain('action="/api/drafts"');
        expect(html).toContain('name="baseSubmissionId" value="form-abc123"');
        expect(html).toContain('Edit This Menu');
        expect(html).toContain('/download/approved-clean/form-abc123');
        expect(html).toContain('/download/approved/form-abc123');
        expect(html).toContain('Dinner'); // menu name
    });

    test('renders version history with per-version downloads and no edit on old versions', () => {
        const current = version({ submissionId: 'form-new', reviewedAt: '2026-07-01T00:00:00Z', isCurrent: true });
        const old = version({ submissionId: 'form-old', reviewedAt: '2026-05-01T00:00:00Z', isCurrent: false });
        const html = renderApprovedMenus({
            hasSearch: true,
            menuCards: [sampleCard({ current, versions: [current, old], versionCount: 2 })],
        });

        expect(html).toContain('View version history');
        expect(html).toContain('/download/approved-clean/form-old');
        expect(html).toContain('/download/approved/form-old');
        // The old version must not offer an edit affordance.
        expect(html).not.toContain('name="baseSubmissionId" value="form-old"');
        expect(html).toContain('view/download only');
    });

    test('renders resume/discard for an in-progress menu, keyed to the current version', () => {
        const html = renderApprovedMenus({
            hasSearch: true,
            menuCards: [sampleCard({ activeDraft: { token: 'draft-token', lastSavedAt: '2026-07-12T00:00:00Z', lastEditedBy: 'Chef Mina', staleBaseline: false } })],
        });
        expect(html).toContain('In progress — last saved');
        expect(html).toContain('by Chef Mina');
        expect(html).toContain('Resume Editing');
        expect(html).toContain('Discard and start over');
        expect(html).toContain('value="draft-token"');
        expect(html).not.toContain('Draft started from an older version');
    });

    test('hints when an in-progress draft started from an older version', () => {
        const html = renderApprovedMenus({
            hasSearch: true,
            menuCards: [sampleCard({ activeDraft: { token: 'draft-token', lastSavedAt: '2026-07-12T00:00:00Z', lastEditedBy: 'Derian Cowser', staleBaseline: true } })],
        });
        expect(html).toContain('Draft started from an older version');
        expect(html).toContain('badge-warn');
    });

    test('action buttons get uniform full-width treatment in the actions column', () => {
        const html = renderApprovedMenus({ hasSearch: true, menuCards: [sampleCard()] });
        expect(html).toContain('.menu-actions .btn');
        expect(html).toMatch(/\.menu-actions \.btn\s*\{[^}]*width:\s*100%/);
    });

    test('renders empty state when no search has been performed', () => {
        const html = renderApprovedMenus({ hasSearch: false, menuCards: [] });
        expect(html).toContain('Find the latest approved starting point');
    });

    test('renders no results message when search yields nothing', () => {
        const html = renderApprovedMenus({ hasSearch: true, menuCards: [] });
        expect(html).toContain('No approved menus found');
    });
});
