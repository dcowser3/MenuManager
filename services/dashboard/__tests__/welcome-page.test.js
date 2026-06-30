const fs = require('fs');
const path = require('path');

describe('welcome page options', () => {
    test('renders the new submission card with a smaller legacy-form fallback', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'welcome.ejs'),
            'utf8'
        );

        expect(template).toContain('<a href="/form" class="option-card">');
        expect(template).toContain('New Menu Submission');
        expect(template).toContain('<a href="/form-legacy" class="legacy-form-link">');
        expect(template).toContain('Original Form');
        expect(template).not.toContain('Feature Coming Soon');
        expect(template).not.toContain('Design Approval');
        expect(template).not.toContain('<a href="/design-approval" class="option-card">');
    });

    test('keeps the Isabella review queue off the public welcome dashboard', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'welcome.ejs'),
            'utf8'
        );

        expect(template).not.toContain('<a href="/reviews" class="option-card">');
        expect(template).not.toContain('Review Queue');
        expect(template).not.toContain('Open Reviews');
    });
});
