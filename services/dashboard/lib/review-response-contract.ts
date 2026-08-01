/**
 * The response markers are part of the production/eval contract. Keep every
 * consumer on this single source so a prompt, parser, or echo fixture cannot
 * silently drift from the others.
 */
export const AI_REVIEW_FENCES = Object.freeze({
    correctedMenuStart: '=== CORRECTED MENU ===',
    correctedMenuEnd: '=== END CORRECTED MENU ===',
    suggestionsStart: '=== SUGGESTIONS ===',
    suggestionsEnd: '=== END SUGGESTIONS ===',
});
