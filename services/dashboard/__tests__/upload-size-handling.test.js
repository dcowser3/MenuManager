const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..', '..');

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('oversized upload handling', () => {
    test.each(['form.ejs', 'form-legacy.ejs'])(
        '%s rejects oversized files before sending and preserves 413 diagnostics',
        (viewName) => {
            const template = read(`services/dashboard/views/${viewName}`);

            expect(template).toContain('const MAX_MENU_UPLOAD_BYTES = <%= maxUploadBytes %>;');
            expect(template).toContain('function getUploadSizeError(file)');
            expect(template).toContain("error.code = 'REQUEST_ENTITY_TOO_LARGE';");
            expect(template).toContain("response.status === 413 ? 'REQUEST_ENTITY_TOO_LARGE' : 'HTTP_ERROR'");
            expect(template).toContain('statusCode: sizeError.statusCode');
            expect(template).toContain('errorCode: error && error.code ? error.code : \'UPLOAD_FAILED\'');
        }
    );

});
