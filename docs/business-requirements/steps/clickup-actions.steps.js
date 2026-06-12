const assert = require('assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const {
    isDirectIsabellaMarketingHandoff,
    normalizeClickUpLabel,
} = require('../../../services/clickup-integration/lib/clickup-handoff-rules');

const PASSIVE_STATUSES = new Set(['approved']);
const REVIEW_COMPLETE_STATUSES = new Set(['to do']);
const POST_APPROVAL_STATUS = 'to do';

function decideClickUpActions(submission, nextStatus) {
    const normalizedNextStatus = normalizeClickUpLabel(nextStatus);
    if (PASSIVE_STATUSES.has(normalizedNextStatus)) {
        return { skipped: true, reason: 'passive manual ClickUp status', actions: [] };
    }

    if (!REVIEW_COMPLETE_STATUSES.has(normalizedNextStatus)) {
        return { skipped: true, reason: 'not a review-complete status', actions: [] };
    }

    if (isDirectIsabellaMarketingHandoff(submission)) {
        return {
            skipped: true,
            reason: 'submission is already a direct Isabella-to-Marketing handoff',
            actions: [],
        };
    }

    const actions = ['finalize_corrected_docx', 'assign_marketing'];
    if (normalizedNextStatus !== POST_APPROVAL_STATUS) {
        actions.push('move_to_post_approval_status');
    }
    return { skipped: false, actions };
}

Given('a Menu Manager submission for {string} is waiting for reviewer corrections', function (email) {
    this.submission = {
        id: 'sub-business-review',
        status: 'pending_human_review',
        submitter_email: email,
        raw_payload: {},
    };
});

Given('a Menu Manager submission for {string} is already marked {string}', function (email, status) {
    this.submission = {
        id: 'sub-business-direct',
        status,
        submitter_email: email,
        raw_payload: {},
    };
});

When('the ClickUp task moves from {string} to {string}', function (_fromStatus, toStatus) {
    this.clickUpDecision = decideClickUpActions(this.submission, toStatus);
});

Then('the approval webhook finalizes the corrected DOCX', function () {
    assert.equal(this.clickUpDecision.skipped, false);
    assert.ok(this.clickUpDecision.actions.includes('finalize_corrected_docx'));
});

Then('ClickUp Marketing is assigned', function () {
    assert.ok(this.clickUpDecision.actions.includes('assign_marketing'));
});

Then('ClickUp task status is moved to {string}', function (status) {
    assert.equal(normalizeClickUpLabel(status), POST_APPROVAL_STATUS);
    assert.ok(this.clickUpDecision.actions.includes('move_to_post_approval_status'));
});

Then('ClickUp task status is not moved again', function () {
    assert.ok(!this.clickUpDecision.actions.includes('move_to_post_approval_status'));
});

Then('the approval webhook skips reprocessing the submission', function () {
    assert.equal(this.clickUpDecision.skipped, true);
    assert.match(this.clickUpDecision.reason, /direct Isabella-to-Marketing handoff/);
});

Then('the approval webhook ignores the status change', function () {
    assert.equal(this.clickUpDecision.skipped, true);
    assert.match(this.clickUpDecision.reason, /passive manual ClickUp status|not a review-complete status/);
});

Then('ClickUp task status and assignees are not mutated', function () {
    assert.deepEqual(this.clickUpDecision.actions, []);
});
