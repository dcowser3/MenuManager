const { createLearningSubmissionController } = require('../public/js/learning-submission');

function createElement(overrides = {}) {
    const listeners = {};
    return {
        value: '',
        checked: false,
        disabled: false,
        textContent: '',
        className: '',
        selectedOptions: [],
        options: [],
        classList: { toggle: jest.fn() },
        addEventListener: jest.fn((name, handler) => { listeners[name] = handler; }),
        getAttribute: jest.fn(),
        focus: jest.fn(),
        listeners,
        ...overrides,
    };
}

function createFixture(fetchImpl) {
    const elements = new Map();
    const buttons = [0, 1].map((idx) => createElement({
        textContent: 'Save Explanation',
        getAttribute: jest.fn(() => `${idx}`),
    }));

    elements.set('bulk-reviewer-name', createElement());
    elements.set('save-all-explanations', createElement({ textContent: 'Save All Explanations' }));
    elements.set('bulk-save-status', createElement());
    for (let idx = 0; idx < 2; idx++) {
        elements.set(`rule-${idx}`, createElement());
        elements.set(`menu-update-only-${idx}`, createElement());
        elements.set(`learning-from-${idx}`, createElement());
        elements.set(`learning-to-${idx}`, createElement());
        elements.set(`learning-scope-${idx}`, createElement());
        elements.set(`menu-scope-${idx}`, createElement({ value: 'all' }));
        elements.set(`change-type-${idx}`, createElement());
        elements.set(`loc-specific-${idx}`, createElement());
        elements.set(`loc-fields-${idx}`, createElement());
        elements.set(`location-${idx}`, createElement());
        elements.set(`shared-${idx}`, createElement());
        elements.set(`save-status-${idx}`, createElement());
    }

    const document = {
        getElementById: (id) => elements.get(id) || null,
        querySelectorAll: (selector) => selector === '.save-rule-btn' ? buttons : [],
        querySelector: (selector) => {
            const match = selector.match(/data-dish-index="(\d+)"/);
            return match ? buttons[Number(match[1])] : null;
        },
    };
    const values = new Map();
    const storage = {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
    };
    const controller = createLearningSubmissionController({
        document,
        storage,
        fetch: fetchImpl,
        dishCorrections: [
            { correction_id: 'c1', before_line: 'Old one', after_line: 'New one' },
            { correction_id: 'c2', before_line: 'Old two', after_line: 'New two' },
        ],
        submissionContext: { submissionId: 'sub-1', comparisonRevision: 'comparison-revision-1', projectName: 'Dinner', restaurantName: 'Dinner' },
        savedCorrectionIds: [],
    });
    controller.init();
    return { controller, elements, buttons, values };
}

describe('learning submission explanation controller', () => {
    test('keeps every explanation draft when reviewer name validation fails', async () => {
        const fetchImpl = jest.fn();
        const { controller, elements, values } = createFixture(fetchImpl);
        elements.get('rule-0').value = 'First unfinished explanation';
        elements.get('rule-1').value = 'Second explanation';

        await expect(controller.saveDishRule(1)).resolves.toBe(false);

        expect(fetchImpl).not.toHaveBeenCalled();
        const savedDraft = JSON.parse(Array.from(values.values())[0]);
        expect(savedDraft.entries['0'].rule).toBe('First unfinished explanation');
        expect(savedDraft.entries['1'].rule).toBe('Second explanation');
        expect(elements.get('save-status-1').textContent).toContain('Save All section');
    });

    test('bulk saves completed explanations with one reviewer name and no page reload', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
        const { controller, elements, buttons } = createFixture(fetchImpl);
        elements.get('rule-0').value = 'Explanation one';
        elements.get('rule-1').value = 'Explanation two';
        elements.get('bulk-reviewer-name').value = 'Reviewer A';

        await expect(controller.saveAll()).resolves.toEqual({ saved: 2, failed: 0 });

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const payloads = fetchImpl.mock.calls.map((call) => JSON.parse(call[1].body));
        expect(payloads.map((payload) => payload.reviewer_name)).toEqual(['Reviewer A', 'Reviewer A']);
        expect(payloads.map((payload) => payload.comparison_revision)).toEqual(['comparison-revision-1', 'comparison-revision-1']);
        expect(payloads.map((payload) => payload.rule)).toEqual(['Explanation one', 'Explanation two']);
        expect(buttons.every((button) => button.disabled)).toBe(true);
        expect(elements.get('bulk-save-status').textContent).toBe('2 explanations saved.');
    });

    test('a partial bulk failure retains only the failed explanation draft', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
            .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Temporary failure' }) });
        const { controller, elements, values } = createFixture(fetchImpl);
        elements.get('rule-0').value = 'Saved explanation';
        elements.get('rule-1').value = 'Keep this draft';
        elements.get('bulk-reviewer-name').value = 'Reviewer A';

        await expect(controller.saveAll()).resolves.toEqual({ saved: 1, failed: 1 });

        const savedDraft = JSON.parse(Array.from(values.values())[0]);
        expect(savedDraft.entries['0']).toBeUndefined();
        expect(savedDraft.entries['1'].rule).toBe('Keep this draft');
        expect(elements.get('bulk-save-status').textContent).toContain('1 failed');
    });

    test('scopes a mixed line to only the exact replacement explained by the reviewer', () => {
        const { controller, elements } = createFixture(jest.fn());
        elements.get('rule-0').value = 'Salsa macha is the correct order.';
        elements.get('learning-from-0').value = 'macha salsa';
        elements.get('learning-to-0').value = 'salsa macha';

        expect(controller.buildPayload(0, 'Reviewer A')).toMatchObject({
            learning_intent: 'review_correction',
            learning_original_text: 'macha salsa',
            learning_corrected_text: 'salsa macha',
            rule: 'Salsa macha is the correct order.',
        });
    });

    test('saves a menu-only decision without sending it to learning', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
        const { controller, elements } = createFixture(fetchImpl);
        elements.get('bulk-reviewer-name').value = 'Reviewer A';
        elements.get('menu-update-only-0').checked = true;

        await expect(controller.saveDishRule(0)).resolves.toBe(true);

        const payload = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(payload).toMatchObject({
            learning_intent: 'menu_update_only',
            learning_original_text: null,
            learning_corrected_text: null,
            rule: 'Menu/content update only — excluded from learning.',
        });
    });

    test('requires both exact replacement fields', async () => {
        const fetchImpl = jest.fn();
        const { controller, elements } = createFixture(fetchImpl);
        elements.get('bulk-reviewer-name').value = 'Reviewer A';
        elements.get('rule-0').value = 'Salsa order.';
        elements.get('learning-from-0').value = 'macha salsa';

        await expect(controller.saveDishRule(0)).resolves.toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(elements.get('save-status-0').textContent).toContain('both From and To');
    });
});
