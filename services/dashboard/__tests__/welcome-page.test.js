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
