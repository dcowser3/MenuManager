import * as fs from 'fs';
import * as path from 'path';

describe('design approval view', () => {
    test('shows visual AI status and page-level visual findings', () => {
        const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'design-approval.ejs'), 'utf8');
        expect(template).toContain('Visual AI Check');
        expect(template).toContain('renderVisualReviewStatus(data.visualReview)');
        expect(template).toContain('PDF page ${escapeHtml(String(d.pageNumber))}');
    });

    test('uses the current approved menu picker and accepts only the design PDF', () => {
        const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'design-approval.ejs'), 'utf8');
        expect(template).toContain('Choose Approved Menu');
        expect(template).toContain('id="designRestaurant"');
        expect(template).toContain('id="designServicePeriod"');
        expect(template).toContain('id="designMenuKeyword"');
        expect(template).toContain('Search by restaurant to show approved menus');
        expect(template).toContain('Choose This Menu');
        expect(template).toContain('class="menu-card"');
        expect(template).toContain('/api/design-approval/menus');
        expect(template).toContain("formData.append('menuId', selectedMenu.menuId || '')");
        expect(template).toContain('ClickUp Handoff');
        expect(template).not.toContain('prefillSubmitterProfile();\n            loadDesignMenus();');
        expect(template).not.toContain('id="docxFile"');
        expect(template).not.toContain('id="approvalCulinary"');
        expect(template).not.toContain('id="approvalRegional"');
    });
});
