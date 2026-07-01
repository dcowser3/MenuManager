/**
 * Shared tenant/business configuration for Menu Manager.
 *
 * Every business-specific value (branding, emails, allergen key, approval
 * roles, menu-template markers, and the rulebook/property *seed* locations)
 * lives in one place: the config bundle at `config/tenant.json`. Each
 * deployment ships its own bundle, so onboarding a new business never means
 * editing code.
 *
 * The runtime ruleset and property catalog are database-backed and become
 * per-business automatically (each instance has its own DB). The values here
 * are the compiled-in constants plus the *initial seeds* for a fresh DB.
 *
 * `DEFAULT_TENANT_CONFIG` below holds the current Richard Sandoval Hospitality
 * values so the app keeps behaving identically if the bundle is ever absent
 * (tests, minimal runtimes). `config/tenant.json` is the canonical override and
 * is deep-merged over these defaults.
 */
export interface TenantBrandingColors {
    primary: string;
    secondary: string;
    accent: string;
    text: string;
    textLight: string;
    textMuted: string;
    background: string;
    backgroundAlt: string;
    border: string;
    borderLight: string;
    success: string;
    warning: string;
    error: string;
}
export interface TenantBrandingFonts {
    heading: string;
    body: string;
    /** <link href> that loads the heading/body web fonts (may be empty). */
    googleFontsHref: string;
}
export interface TenantBranding {
    colors: TenantBrandingColors;
    fonts: TenantBrandingFonts;
    /** Optional logo image path served by the dashboard (empty = text only). */
    logo: string;
}
export interface TenantEmails {
    /** Outbound "from" address for notifications (env SMTP_FROM still wins). */
    from: string;
    /** Where operational alerts go. */
    alert: string;
    /** Where blocked-form-attempt alerts go. */
    formAttemptAlert: string;
    /** Public support address shown to submitters. */
    publicSupport: string;
    /** Extra CC recipients for post-submit confirmation emails. */
    submissionConfirmationCc: string[];
    /** Internal reviewer address (usually env-driven; empty by default). */
    internalReviewer: string;
    /** Submitter identity used by the ClickUp handoff rules. */
    clickupHandoffSubmitter: string;
    /** Synthetic submitter used by the ClickUp history importer. */
    historyImport: string;
}
export interface TenantApprovalRole {
    /** Stable key used in payloads (e.g. "culinary"). */
    key: string;
    /** Human label; rendered prefixed with shortName, e.g. "RSH Culinary". */
    label: string;
}
export interface TenantTemplateType {
    /** Substring that identifies this template type in an uploaded .docx. */
    detectMarker: string;
    /** File name of the downloadable template (lives beside the bundle/samples). */
    fileName: string;
}
export interface TenantTemplate {
    food: TenantTemplateType;
    beverage: TenantTemplateType;
    requiredHeaders: string[];
    requiredFields: string[];
    sopSections: string[];
    boundaryMarker: string;
    /** Brand label used in validator error copy, e.g. "RSH DESIGN BRIEF". */
    label: string;
}
export interface TenantRulebook {
    /** Seed prompt file, relative to the config dir. */
    seedFile: string;
    /** Heading the prompt-builder injects prix-fixe rules after. */
    guidelinesAnchor: string;
    /** Heading the prompt-builder injects the custom allergen key after. */
    allergensAnchor: string;
}
export interface TenantConfig {
    /** Full business name, e.g. "Richard Sandoval Hospitality". */
    name: string;
    /** Short brand code, e.g. "RSH". */
    shortName: string;
    /** Header subtitle, e.g. "Menu Management System". */
    tagline: string;
    /** App name used in page titles, e.g. "RSH Menu Manager". */
    appName: string;
    branding: TenantBranding;
    emails: TenantEmails;
    /** Default allergen legend used when a submission supplies none. */
    allergenKey: string;
    approvalRoles: TenantApprovalRole[];
    template: TenantTemplate;
    rulebook: TenantRulebook;
    /** Property catalog seed file, relative to the config dir. */
    propertiesSeedFile: string;
}
/**
 * Embedded Richard Sandoval Hospitality defaults — the safety-net fallback.
 * The canonical, editable values live in `config/tenant.json`, which is
 * deep-merged over these. Keep this in sync with `config.example/tenant.json`.
 */
export declare const DEFAULT_TENANT_CONFIG: TenantConfig;
/**
 * Resolve the config-bundle directory.
 * `TENANT_CONFIG_PATH` (absolute or relative to cwd) wins; otherwise default to
 * `<repoRoot>/config`.
 */
export declare function getTenantConfigDir(): string;
/** Resolve a bundle-relative path (e.g. the rulebook seed) to an absolute path. */
export declare function resolveTenantFile(relativePath: string): string;
/**
 * Return the loaded tenant config (cached). The cache invalidates if
 * `TENANT_CONFIG_PATH` changes, so tests can swap bundles at runtime.
 */
export declare function getTenantConfig(): TenantConfig;
/** Read the seed rulebook prompt from the bundle, or null if absent. */
export declare function readSeedRulebook(): string | null;
/** Clear the in-memory cache (test helper). */
export declare function clearTenantConfigCache(): void;
//# sourceMappingURL=index.d.ts.map