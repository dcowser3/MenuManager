/**
 * form-stage.js — pure stage/reveal logic for the upload-first submission form.
 *
 * The submission page reveals its sections one at a time as the chef makes
 * progress: upload the menu DOCX, then the side-by-side menu + project details
 * appear, then the required approval, then the AI review button, then submit.
 *
 * This module holds ONLY the pure decision logic ("given this snapshot of the
 * form, which sections should be visible?") so it can be unit-tested without a
 * DOM. The form.ejs view owns the actual DOM toggling, animation, and the
 * FLIP float-down. Mirrors the IIFE/export pattern of form-helpers.js so it is
 * both browser-global (window.MenuFormStage) and require()-able in Jest.
 */
(function (global) {
    // Ordered stages of the flow. Each later stage is gated on the earlier ones.
    var STAGES = ['upload', 'menu', 'details', 'approval', 'ai', 'submit'];

    function stageIndex(stage) {
        var idx = STAGES.indexOf(stage);
        return idx === -1 ? 0 : idx;
    }

    // Has the flow reached at least `stage`?
    function atLeast(current, stage) {
        return stageIndex(current) >= stageIndex(stage);
    }

    // A value counts as "filled" when it is a non-empty trimmed string (or truthy).
    function nonEmpty(value) {
        return typeof value === 'string' ? value.trim().length > 0 : !!value;
    }

    // A menu DOCX has been uploaded and extracted.
    function hasMenu(formState) {
        return !!(formState && formState.menuUploaded);
    }

    // Asset-type-conditional dimension fields (print vs digital) are filled.
    function assetFieldsFilled(formState) {
        if (!formState) return false;
        var assetType = formState.assetType;
        var isPrint = assetType === 'PRINT' || assetType === 'BOTH';
        var isDigital = assetType === 'DIGITAL' || assetType === 'BOTH';

        if (isPrint) {
            var nonUs = formState.printRegion === 'NON_US';
            var sizeOk = nonUs
                ? nonEmpty(formState.printSize)
                : (nonEmpty(formState.widthPrint) && nonEmpty(formState.heightPrint));
            if (!sizeOk) return false;
            if (!nonEmpty(formState.printRegion)) return false;
            if (!nonEmpty(formState.folded)) return false;
            if (!nonEmpty(formState.cropMarks)) return false;
            if (!nonEmpty(formState.bleedMarks)) return false;
            if (!nonEmpty(formState.fileSizeLimit)) return false;
            if (formState.fileSizeLimit === 'yes' && !nonEmpty(formState.fileSizeLimitMb)) return false;
        }
        if (isDigital) {
            if (!nonEmpty(formState.widthDigital) || !nonEmpty(formState.heightDigital)) return false;
        }
        return true;
    }

    // All required project-detail fields are filled (submitter info is gated
    // separately and revealed later in the flow).
    function requiredProjectFieldsFilled(formState) {
        if (!formState) return false;
        var required = [
            'projectName', 'property', 'menuType', 'servicePeriod',
            'templateType', 'turnaroundDays', 'dateNeeded', 'assetType', 'orientation'
        ];
        var allFilled = required.every(function (key) { return nonEmpty(formState[key]); });
        if (!allFilled) return false;
        return assetFieldsFilled(formState);
    }

    // The single required approver block is filled.
    function approvalFieldsFilled(formState) {
        if (!formState) return false;
        return nonEmpty(formState.approval1)
            && nonEmpty(formState.approver1Name)
            && nonEmpty(formState.approver1Position);
    }

    // Submitter identity fields are filled (revealed after approval).
    function submitterFieldsFilled(formState) {
        if (!formState) return false;
        return nonEmpty(formState.submitterName)
            && nonEmpty(formState.submitterEmail)
            && nonEmpty(formState.submitterJobTitle);
    }

    // Non-beverage submissions skip AI review and go straight to submit.
    function requiresAiReview(templateType) {
        return templateType !== 'non_beverage';
    }

    /**
     * Given a snapshot of the form, decide which sections are revealed.
     * Order: menu + project details → approval → submitter info → AI button.
     * Returns booleans for each progressively-disclosed section. `submit` is
     * true once the flow is far enough that the submit button should show:
     * after the AI check has run (AI flow), or right after submitter info is
     * filled (non-beverage, no-AI flow).
     */
    function computeRevealState(formState) {
        var reveal = { menu: false, details: false, approval: false, submitter: false, ai: false, submit: false };
        if (!hasMenu(formState)) return reveal;

        reveal.menu = true;
        reveal.details = true;

        if (!requiredProjectFieldsFilled(formState)) return reveal;
        reveal.approval = true;

        if (!approvalFieldsFilled(formState)) return reveal;
        reveal.submitter = true;

        if (!submitterFieldsFilled(formState)) return reveal;

        if (requiresAiReview(formState.templateType)) {
            reveal.ai = true;
            reveal.submit = !!formState.aiCheckHasRun;
        } else {
            reveal.ai = false;
            reveal.submit = true;
        }
        return reveal;
    }

    var api = {
        STAGES: STAGES,
        stageIndex: stageIndex,
        atLeast: atLeast,
        nonEmpty: nonEmpty,
        hasMenu: hasMenu,
        assetFieldsFilled: assetFieldsFilled,
        requiredProjectFieldsFilled: requiredProjectFieldsFilled,
        approvalFieldsFilled: approvalFieldsFilled,
        submitterFieldsFilled: submitterFieldsFilled,
        requiresAiReview: requiresAiReview,
        computeRevealState: computeRevealState
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.MenuFormStage = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
