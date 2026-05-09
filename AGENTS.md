# AGENTS.md

## Required Post-Change Documentation

For any code, config, schema, API, or workflow change:
1. Update relevant docs in `docs/`.
2. Update `README.md` when user-facing behavior, setup, or usage changes.
3. Include documentation updates in the same set of changes as implementation updates.
4. If no documentation update is needed, explicitly state why in the final response.

See [docs/feature-delivery-workflow.md](/Users/deriancowser/Documents/MenuManager/docs/feature-delivery-workflow.md) for the required feature workflow around tests, live verification, `dist/` artifacts, and restart/reset steps.

## Required Verification

For any feature, bug fix, route, API, UI, or workflow change:
1. Add or update automated tests that cover the changed behavior when the codebase has a reasonable place to do so.
2. Run focused verification for the changed area before reporting completion.
3. For any new or changed page, route, download flow, or form submission path, verify the running app behavior directly with a live request or browser check, not only by static code inspection.
4. If verification cannot be completed, explicitly say what was not verified, why, and what risk remains before marking the work done.
