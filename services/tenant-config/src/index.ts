import * as fs from 'fs';
import * as path from 'path';

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

export interface TenantDraftSessions {
    /** Number of idle days before shared menu-edit drafts expire. */
    expiryDays: number;
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
    /** Shared draft-session settings for approved-menu click-to-edit. */
    draftSessions: TenantDraftSessions;
    /** Property catalog seed file, relative to the config dir. */
    propertiesSeedFile: string;
}

/**
 * Embedded Richard Sandoval Hospitality defaults — the safety-net fallback.
 * The canonical, editable values live in `config/tenant.json`, which is
 * deep-merged over these. Keep this in sync with `config.example/tenant.json`.
 */
export const DEFAULT_TENANT_CONFIG: TenantConfig = {
    name: 'Richard Sandoval Hospitality',
    shortName: 'RSH',
    tagline: 'Menu Management System',
    appName: 'RSH Menu Manager',
    branding: {
        colors: {
            primary: '#2c2c2c',
            secondary: '#8b7355',
            accent: '#6b5344',
            text: '#333333',
            textLight: '#666666',
            textMuted: '#999999',
            background: '#ffffff',
            backgroundAlt: '#fafaf8',
            border: '#e8e4de',
            borderLight: '#f0ece6',
            success: '#4a7c59',
            warning: '#b8860b',
            error: '#8b3a3a',
        },
        fonts: {
            heading: "'Cormorant Garamond', Georgia, serif",
            body: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
            googleFontsHref:
                'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Montserrat:wght@300;400;500;600&display=swap',
        },
        logo: '',
    },
    emails: {
        from: 'no-reply@richardsandoval.com',
        alert: 'dcowser@richardsandoval.com',
        formAttemptAlert: 'dcowser@richardsandoval.com',
        publicSupport: 'dcowser@richardsandoval.com',
        submissionConfirmationCc: ['isabella@richardsandoval.com'],
        internalReviewer: '',
        clickupHandoffSubmitter: 'isabella@richardsandoval.com',
        historyImport: 'clickup-history@richardsandoval.com',
    },
    allergenKey: 'G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan',
    approvalRoles: [
        { key: 'culinary', label: 'Culinary' },
        { key: 'regional', label: 'Regional' },
    ],
    template: {
        food: {
            detectMarker: 'FOOD MENU DESIGN BRIEF REQUEST FORM',
            fileName: 'RSH_DESIGN BRIEF_FOOD_Menu_Template .docx',
        },
        beverage: {
            detectMarker: 'BEVERAGE MENU DESIGN BRIEF REQUEST FORM',
            fileName: 'RSH Design Brief Beverage Template.docx',
        },
        requiredHeaders: ['DESIGN BRIEF REQUEST FORM', 'PROJECT DESIGN DETAILS'],
        requiredFields: ['PROJECT NAME', 'PROPERTY', 'SIZE', 'ORIENTATION', 'DATE NEEDED'],
        sopSections: ['MENU SUBMITTAL SOP', 'STEP 1: OBTAIN APPROVALS', 'STEP 2: DESIGN DEVELOPMENT'],
        boundaryMarker: 'Please drop the menu content below on page 2',
        label: 'RSH DESIGN BRIEF',
    },
    rulebook: {
        seedFile: 'rulebook/qa_prompt.txt',
        guidelinesAnchor: '## RSH MENU GUIDELINES - COMPREHENSIVE RULES',
        allergensAnchor: '### 7. ALLERGENS',
    },
    draftSessions: {
        expiryDays: 30,
    },
    propertiesSeedFile: 'properties.json',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge `override` over `base`. Arrays and scalars from override replace. */
function deepMerge<T>(base: T, override: unknown): T {
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return (override === undefined ? base : (override as T));
    }
    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (value === undefined) continue;
        const current = (base as Record<string, unknown>)[key];
        result[key] = isPlainObject(current) && isPlainObject(value)
            ? deepMerge(current, value)
            : value;
    }
    return result as T;
}

function findRepoRoot(startDir: string): string {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
        if (
            fs.existsSync(path.join(dir, 'package.json')) &&
            fs.existsSync(path.join(dir, 'services'))
        ) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return startDir;
}

/**
 * Resolve the config-bundle directory.
 * `TENANT_CONFIG_PATH` (absolute or relative to cwd) wins; otherwise default to
 * `<repoRoot>/config`.
 */
export function getTenantConfigDir(): string {
    const override = `${process.env.TENANT_CONFIG_PATH || ''}`.trim();
    if (override) {
        return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
    }
    return path.join(findRepoRoot(__dirname), 'config');
}

/** Resolve a bundle-relative path (e.g. the rulebook seed) to an absolute path. */
export function resolveTenantFile(relativePath: string): string {
    return path.join(getTenantConfigDir(), relativePath);
}

let cachedConfig: TenantConfig | null = null;
let cachedDir: string | null = null;

function loadTenantConfig(): TenantConfig {
    const dir = getTenantConfigDir();
    const file = path.join(dir, 'tenant.json');
    let parsed: unknown = undefined;
    try {
        if (fs.existsSync(file)) {
            parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
        } else {
            console.warn(`[tenant-config] No tenant.json at ${file}; using built-in defaults.`);
        }
    } catch (error: any) {
        console.warn(`[tenant-config] Failed to read ${file}; using built-in defaults:`, error?.message || error);
    }
    return deepMerge(DEFAULT_TENANT_CONFIG, parsed);
}

/**
 * Return the loaded tenant config (cached). The cache invalidates if
 * `TENANT_CONFIG_PATH` changes, so tests can swap bundles at runtime.
 */
export function getTenantConfig(): TenantConfig {
    const dir = getTenantConfigDir();
    if (cachedConfig && cachedDir === dir) return cachedConfig;
    cachedConfig = loadTenantConfig();
    cachedDir = dir;
    return cachedConfig;
}

/** Read the seed rulebook prompt from the bundle, or null if absent. */
export function readSeedRulebook(): string | null {
    try {
        const file = resolveTenantFile(getTenantConfig().rulebook.seedFile);
        if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8');
    } catch {
        /* fall through */
    }
    return null;
}

/** Clear the in-memory cache (test helper). */
export function clearTenantConfigCache(): void {
    cachedConfig = null;
    cachedDir = null;
}
