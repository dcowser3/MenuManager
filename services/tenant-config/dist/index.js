"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TENANT_CONFIG = void 0;
exports.getTenantConfigDir = getTenantConfigDir;
exports.resolveTenantFile = resolveTenantFile;
exports.getTenantConfig = getTenantConfig;
exports.readSeedRulebook = readSeedRulebook;
exports.clearTenantConfigCache = clearTenantConfigCache;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Embedded Richard Sandoval Hospitality defaults — the safety-net fallback.
 * The canonical, editable values live in `config/tenant.json`, which is
 * deep-merged over these. Keep this in sync with `config.example/tenant.json`.
 */
exports.DEFAULT_TENANT_CONFIG = {
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
            googleFontsHref: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Montserrat:wght@300;400;500;600&display=swap',
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
    propertiesSeedFile: 'properties.json',
};
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Deep-merge `override` over `base`. Arrays and scalars from override replace. */
function deepMerge(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return (override === undefined ? base : override);
    }
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (value === undefined)
            continue;
        const current = base[key];
        result[key] = isPlainObject(current) && isPlainObject(value)
            ? deepMerge(current, value)
            : value;
    }
    return result;
}
function findRepoRoot(startDir) {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'package.json')) &&
            fs.existsSync(path.join(dir, 'services'))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return startDir;
}
/**
 * Resolve the config-bundle directory.
 * `TENANT_CONFIG_PATH` (absolute or relative to cwd) wins; otherwise default to
 * `<repoRoot>/config`.
 */
function getTenantConfigDir() {
    const override = `${process.env.TENANT_CONFIG_PATH || ''}`.trim();
    if (override) {
        return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
    }
    return path.join(findRepoRoot(__dirname), 'config');
}
/** Resolve a bundle-relative path (e.g. the rulebook seed) to an absolute path. */
function resolveTenantFile(relativePath) {
    return path.join(getTenantConfigDir(), relativePath);
}
let cachedConfig = null;
let cachedDir = null;
function loadTenantConfig() {
    const dir = getTenantConfigDir();
    const file = path.join(dir, 'tenant.json');
    let parsed = undefined;
    try {
        if (fs.existsSync(file)) {
            parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
        }
        else {
            console.warn(`[tenant-config] No tenant.json at ${file}; using built-in defaults.`);
        }
    }
    catch (error) {
        console.warn(`[tenant-config] Failed to read ${file}; using built-in defaults:`, error?.message || error);
    }
    return deepMerge(exports.DEFAULT_TENANT_CONFIG, parsed);
}
/**
 * Return the loaded tenant config (cached). The cache invalidates if
 * `TENANT_CONFIG_PATH` changes, so tests can swap bundles at runtime.
 */
function getTenantConfig() {
    const dir = getTenantConfigDir();
    if (cachedConfig && cachedDir === dir)
        return cachedConfig;
    cachedConfig = loadTenantConfig();
    cachedDir = dir;
    return cachedConfig;
}
/** Read the seed rulebook prompt from the bundle, or null if absent. */
function readSeedRulebook() {
    try {
        const file = resolveTenantFile(getTenantConfig().rulebook.seedFile);
        if (fs.existsSync(file))
            return fs.readFileSync(file, 'utf-8');
    }
    catch {
        /* fall through */
    }
    return null;
}
/** Clear the in-memory cache (test helper). */
function clearTenantConfigCache() {
    cachedConfig = null;
    cachedDir = null;
}
//# sourceMappingURL=index.js.map