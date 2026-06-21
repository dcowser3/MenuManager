import fs from 'fs';
import path from 'path';

const ejs = require('ejs');
const { getTenantConfig } = require('@menumanager/tenant-config');

const viewPath = path.resolve(__dirname, '../views/index.ejs');

function renderReviewDashboard(reviews: any[]) {
    const template = fs.readFileSync(viewPath, 'utf8');
    const tenant = getTenantConfig();
    return ejs.render(template, {
        title: `Pending Reviews - ${tenant.appName}`,
        reviews,
        tenant,
    }, { filename: viewPath });
}

describe('review dashboard view', () => {
    test('renders pending reviews with approval editor links', () => {
        const html = renderReviewDashboard([
            {
                id: 'form-123',
                project_name: 'Aqimero Brunch Menu',
                property: 'Aqimero',
                service_period: 'brunch',
                filename: 'Aqimero_Brunch_5.22.26.docx',
                submitter_name: 'Chef Maya',
                created_at: '2026-05-22T20:18:43.000Z',
                status: 'pending_human_review',
            },
            {
                id: 'form-manual',
                project_name: 'Manual Review Menu',
                submitter_email: 'chef@example.com',
                status: 'submitted_no_ai_review',
            },
        ]);

        expect(html).toContain('Isabella Review Queue');
        expect(html).toContain('Aqimero Brunch Menu');
        expect(html).toContain('/approval/form-123');
        expect(html).toContain('/review/form-123');
        expect(html).toContain('/download/original/form-123');
        expect(html).toContain('Manual Review');
        expect(html).not.toContain('Already Perfect');
        expect(html).not.toContain('Upload Corrected');
    });

    test('renders empty state when no reviews are pending', () => {
        const html = renderReviewDashboard([]);

        expect(html).toContain('No Pending Reviews');
        expect(html).toContain('All submissions have been reviewed.');
    });
});
