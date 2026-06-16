const {
    STAGES,
    stageIndex,
    atLeast,
    nonEmpty,
    hasMenu,
    assetFieldsFilled,
    requiredProjectFieldsFilled,
    approvalFieldsFilled,
    submitterFieldsFilled,
    requiresAiReview,
    computeRevealState,
} = require('../public/js/form-stage');

// A fully-filled digital project (no print conditional fields required).
// Submitter fields are gated separately now, so they are NOT part of this.
function digitalProject(overrides) {
    return Object.assign({
        menuUploaded: true,
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

function filledSubmitter(overrides) {
    return Object.assign({
        submitterName: 'Ada Chef',
        submitterEmail: 'ada@example.com',
        submitterJobTitle: 'Executive Chef',
    }, overrides || {});
}

describe('stage ordering', () => {
    test('STAGES are in flow order', () => {
        expect(STAGES).toEqual(['upload', 'menu', 'details', 'approval', 'ai', 'submit']);
    });

    test('stageIndex defaults unknown to 0', () => {
        expect(stageIndex('upload')).toBe(0);
        expect(stageIndex('ai')).toBe(4);
        expect(stageIndex('nope')).toBe(0);
    });

    test('atLeast compares by flow position', () => {
        expect(atLeast('approval', 'menu')).toBe(true);
        expect(atLeast('menu', 'approval')).toBe(false);
    });
});

describe('nonEmpty', () => {
    test('trims strings and coerces truthiness', () => {
        expect(nonEmpty('  hi ')).toBe(true);
        expect(nonEmpty('   ')).toBe(false);
        expect(nonEmpty(undefined)).toBe(false);
        expect(nonEmpty(5)).toBe(true);
    });
});

describe('hasMenu', () => {
    test('gates on the menuUploaded flag', () => {
        expect(hasMenu({})).toBe(false);
        expect(hasMenu({ menuUploaded: true })).toBe(true);
    });
});

describe('requiredProjectFieldsFilled', () => {
    test('true with all required digital fields — and does NOT require submitter info', () => {
        expect(requiredProjectFieldsFilled(digitalProject())).toBe(true);
    });

    test('false when a required base field is blank', () => {
        expect(requiredProjectFieldsFilled(digitalProject({ projectName: '' }))).toBe(false);
        expect(requiredProjectFieldsFilled(digitalProject({ dateNeeded: '   ' }))).toBe(false);
    });

    test('digital requires width and height', () => {
        expect(requiredProjectFieldsFilled(digitalProject({ widthDigital: '' }))).toBe(false);
    });
});

describe('assetFieldsFilled (print conditionals)', () => {
    function printProject(overrides) {
        return Object.assign(digitalProject({
            assetType: 'PRINT', printRegion: 'US', widthPrint: '8.5', heightPrint: '11',
            folded: 'no', cropMarks: 'yes', bleedMarks: 'yes', fileSizeLimit: 'no',
        }), overrides || {});
    }
    test('US print needs width/height plus marks', () => {
        expect(assetFieldsFilled(printProject())).toBe(true);
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
    });
});

describe('submitterFieldsFilled', () => {
    test('requires name, email, and job title', () => {
        expect(submitterFieldsFilled(filledSubmitter())).toBe(true);
        expect(submitterFieldsFilled(filledSubmitter({ submitterEmail: '' }))).toBe(false);
        expect(submitterFieldsFilled({})).toBe(false);
    });
});

describe('requiresAiReview', () => {
    test('non-beverage skips AI, everything else needs it', () => {
        expect(requiresAiReview('non_beverage')).toBe(false);
        expect(requiresAiReview('food')).toBe(true);
    });
});

describe('computeRevealState — order: details → approval → submitter → ai', () => {
    test('nothing past upload before a menu exists', () => {
        expect(computeRevealState({ menuUploaded: false })).toEqual({
            menu: false, details: false, approval: false, submitter: false, ai: false, submit: false,
        });
    });

    test('menu + details reveal immediately after upload', () => {
        const s = computeRevealState({ menuUploaded: true });
        expect(s.menu).toBe(true);
        expect(s.details).toBe(true);
        expect(s.approval).toBe(false);
    });

    test('approval reveals once project fields are filled (submitter NOT yet needed)', () => {
        const s = computeRevealState(digitalProject());
        expect(s.approval).toBe(true);
        expect(s.submitter).toBe(false);
        expect(s.ai).toBe(false);
    });

    test('submitter info reveals only after approval is filled', () => {
        const s = computeRevealState(Object.assign(digitalProject(), filledApproval()));
        expect(s.submitter).toBe(true);
        expect(s.ai).toBe(false);
    });

    test('AI button reveals only after submitter info is filled (food)', () => {
        const s = computeRevealState(Object.assign(digitalProject(), filledApproval(), filledSubmitter()));
        expect(s.ai).toBe(true);
        expect(s.submit).toBe(false);
    });

    test('submit reveals after the AI check has run', () => {
        const s = computeRevealState(Object.assign(digitalProject(), filledApproval(), filledSubmitter(), { aiCheckHasRun: true }));
        expect(s.submit).toBe(true);
    });

    test('non-beverage skips AI and reveals submit straight after submitter info', () => {
        const s = computeRevealState(Object.assign(digitalProject({ templateType: 'non_beverage' }), filledApproval(), filledSubmitter()));
        expect(s.ai).toBe(false);
        expect(s.submit).toBe(true);
    });
});
