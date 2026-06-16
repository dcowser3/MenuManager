const {
    STAGES,
    stageIndex,
    atLeast,
    nonEmpty,
    hasMenu,
    assetFieldsFilled,
    requiredProjectFieldsFilled,
    approvalFieldsFilled,
    requiresAiReview,
    computeRevealState,
} = require('../public/js/form-stage');

// A fully-filled digital project (no print conditional fields required).
function digitalProject(overrides) {
    return Object.assign({
        menuUploaded: true,
        submitterName: 'Ada Chef',
        submitterEmail: 'ada@example.com',
        submitterJobTitle: 'Executive Chef',
        projectName: 'Spring Tasting',
        property: 'Grand Hotel',
        menuType: 'standard',
        servicePeriod: 'dinner',
        templateType: 'food',
        turnaroundDays: '5',
        dateNeeded: '2026-06-22',
        assetType: 'DIGITAL',
        orientation: 'Portrait',
        widthDigital: '1920',
        heightDigital: '1080',
    }, overrides || {});
}

function filledApproval(overrides) {
    return Object.assign({
        approval1: 'yes',
        approver1Name: 'Grace GM',
        approver1Position: 'General Manager',
    }, overrides || {});
}

describe('stage ordering', () => {
    test('STAGES are in flow order', () => {
        expect(STAGES).toEqual(['upload', 'menu', 'details', 'approval', 'ai', 'submit']);
    });

    test('stageIndex is monotonic and defaults unknown to 0', () => {
        expect(stageIndex('upload')).toBe(0);
        expect(stageIndex('ai')).toBe(4);
        expect(stageIndex('nope')).toBe(0);
    });

    test('atLeast compares by flow position', () => {
        expect(atLeast('approval', 'menu')).toBe(true);
        expect(atLeast('menu', 'approval')).toBe(false);
        expect(atLeast('ai', 'ai')).toBe(true);
    });
});

describe('nonEmpty', () => {
    test('trims strings and coerces truthiness', () => {
        expect(nonEmpty('  hi ')).toBe(true);
        expect(nonEmpty('   ')).toBe(false);
        expect(nonEmpty('')).toBe(false);
        expect(nonEmpty(undefined)).toBe(false);
        expect(nonEmpty(0)).toBe(false);
        expect(nonEmpty(5)).toBe(true);
    });
});

describe('hasMenu', () => {
    test('gates on the menuUploaded flag', () => {
        expect(hasMenu(null)).toBe(false);
        expect(hasMenu({})).toBe(false);
        expect(hasMenu({ menuUploaded: true })).toBe(true);
    });
});

describe('requiredProjectFieldsFilled', () => {
    test('true when all required digital fields are present', () => {
        expect(requiredProjectFieldsFilled(digitalProject())).toBe(true);
    });

    test('false when a required base field is blank', () => {
        expect(requiredProjectFieldsFilled(digitalProject({ projectName: '' }))).toBe(false);
        expect(requiredProjectFieldsFilled(digitalProject({ dateNeeded: '   ' }))).toBe(false);
    });

    test('digital requires width and height', () => {
        expect(requiredProjectFieldsFilled(digitalProject({ widthDigital: '' }))).toBe(false);
        expect(requiredProjectFieldsFilled(digitalProject({ heightDigital: '' }))).toBe(false);
    });
});

describe('assetFieldsFilled (print conditionals)', () => {
    function printProject(overrides) {
        return Object.assign(digitalProject({
            assetType: 'PRINT',
            printRegion: 'US',
            widthPrint: '8.5',
            heightPrint: '11',
            folded: 'no',
            cropMarks: 'yes',
            bleedMarks: 'yes',
            fileSizeLimit: 'no',
        }), overrides || {});
    }

    test('US print needs width/height plus marks', () => {
        expect(assetFieldsFilled(printProject())).toBe(true);
        expect(assetFieldsFilled(printProject({ widthPrint: '' }))).toBe(false);
        expect(assetFieldsFilled(printProject({ cropMarks: '' }))).toBe(false);
    });

    test('NON_US print needs a size instead of width/height', () => {
        expect(assetFieldsFilled(printProject({ printRegion: 'NON_US', widthPrint: '', heightPrint: '', printSize: 'A4' }))).toBe(true);
        expect(assetFieldsFilled(printProject({ printRegion: 'NON_US', widthPrint: '', heightPrint: '', printSize: '' }))).toBe(false);
    });

    test('file size limit yes requires the MB value', () => {
        expect(assetFieldsFilled(printProject({ fileSizeLimit: 'yes' }))).toBe(false);
        expect(assetFieldsFilled(printProject({ fileSizeLimit: 'yes', fileSizeLimitMb: '10' }))).toBe(true);
    });
});

describe('approvalFieldsFilled', () => {
    test('requires all three primary approver fields', () => {
        expect(approvalFieldsFilled(filledApproval())).toBe(true);
        expect(approvalFieldsFilled(filledApproval({ approver1Name: '' }))).toBe(false);
        expect(approvalFieldsFilled({})).toBe(false);
    });
});

describe('requiresAiReview', () => {
    test('non-beverage skips AI, everything else needs it', () => {
        expect(requiresAiReview('non_beverage')).toBe(false);
        expect(requiresAiReview('food')).toBe(true);
        expect(requiresAiReview('beverage')).toBe(true);
        expect(requiresAiReview('food_beverage')).toBe(true);
    });
});

describe('computeRevealState', () => {
    test('nothing past upload before a menu exists', () => {
        expect(computeRevealState({ menuUploaded: false })).toEqual({
            menu: false, details: false, approval: false, ai: false, submit: false,
        });
    });

    test('menu + details reveal immediately after upload', () => {
        const state = computeRevealState({ menuUploaded: true });
        expect(state.menu).toBe(true);
        expect(state.details).toBe(true);
        expect(state.approval).toBe(false);
        expect(state.ai).toBe(false);
    });

    test('approval reveals once required project fields are filled', () => {
        const state = computeRevealState(digitalProject());
        expect(state.approval).toBe(true);
        expect(state.ai).toBe(false);
    });

    test('AI button reveals once approval is filled (food)', () => {
        const state = computeRevealState(Object.assign(digitalProject(), filledApproval()));
        expect(state.ai).toBe(true);
        expect(state.submit).toBe(false);
    });

    test('submit reveals after the AI check has run', () => {
        const state = computeRevealState(Object.assign(digitalProject(), filledApproval(), { aiCheckHasRun: true }));
        expect(state.ai).toBe(true);
        expect(state.submit).toBe(true);
    });

    test('non-beverage skips AI and reveals submit straight after approval', () => {
        const state = computeRevealState(Object.assign(digitalProject({ templateType: 'non_beverage' }), filledApproval()));
        expect(state.ai).toBe(false);
        expect(state.submit).toBe(true);
    });
});
