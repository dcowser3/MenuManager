const fs = require('fs');
const path = require('path');

describe('welcome page options', () => {
    test('renders design approval as a disabled coming-soon card', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'welcome.ejs'),
            'utf8'
        );

        expect(template).toContain('<div class="option-card disabled" aria-disabled="true">');
        expect(template).toContain('Feature Coming Soon');
        expect(template).not.toContain('<a href="/design-approval" class="option-card">');
    });

    test('links to the Isabella review queue', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'welcome.ejs'),
            'utf8'
        );

        expect(template).toContain('<a href="/reviews" class="option-card">');
        expect(template).toContain('Review Queue');
    });
});
