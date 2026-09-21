'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dashboardRoot = path.resolve(__dirname, '..');

function loadSubmission(fetchImpl) {
    const window = { fetch: fetchImpl };
    vm.runInNewContext(
        fs.readFileSync(path.join(dashboardRoot, 'public/js/form-submission.js'), 'utf8'),
        { window }
    );
    return window.MenuSubmission;
}

test('prepares and sends the exact JSON submission boundary once', async () => {
    const fetchImpl = jest.fn(async () => ({ status: 200, text: async () => '{"ok":true}' }));
    const submission = loadSubmission(fetchImpl);
    const captured = submission.captureMenuSubmission({ html: '<p>Dish</p>\n<p><br></p>', text: 'Dish' });
    const request = submission.prepareMenuSubmissionRequest(captured, { 'X-Attempt': 'attempt-1' });

    expect(request).toEqual({
        url: '/api/form/submit',
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Attempt': 'attempt-1' },
            body: JSON.stringify({ menuContent: 'Dish', menuContentHtml: '<p>Dish</p>' }),
        },
    });

    await submission.sendPreparedMenuSubmission(request);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(request.url, request.init);
});

test.each(['form.ejs', 'form-legacy.ejs'])('%s uses the shared capture and request boundary', (view) => {
    const source = fs.readFileSync(path.join(dashboardRoot, 'views', view), 'utf8');
    expect(source).toContain('<script src="/js/form-submission.js"></script>');
    expect(source).toContain('MenuSubmission.captureMenuSubmission(');
    expect(source).toContain('MenuSubmission.prepareMenuSubmissionRequest(formData, getAttemptHeaders())');
    expect(source).toContain('MenuSubmission.sendPreparedMenuSubmission(preparedSubmission)');
    expect(source).not.toContain("fetch('/api/form/submit'");
});

