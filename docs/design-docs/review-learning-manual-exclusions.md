# User-owned unresolved exclusions

The preparation inventory preserves every correction in the pending proposal.
Exactly three unresolved groups may be excluded from automatic drafting only
when a user-owned, proposal/cycle/fingerprint-bound artifact names the exact
correction IDs and the reason `user_owned_manual_unresolved`. The artifact is
not model output, does not resolve or retire a correction, and does not grant
approval or activation. Missing, stale, extra, duplicate, or ambiguous rows
fail closed; eligible code and non-code groups retain their original lanes.

Preparation-only operators must pass the private artifact explicitly with
`MENUMANAGER_MANUAL_EXCLUSION_ARTIFACT=/absolute/path/to/artifact.json` (or
`runPrepareOnly({ manualExclusionArtifactPath })`). The loader accepts only a
private regular JSON file no larger than 128 KiB; it never scans temporary
directories for artifacts.
