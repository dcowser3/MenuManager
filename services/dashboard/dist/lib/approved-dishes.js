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
exports.deriveBrandFromProperty = deriveBrandFromProperty;
exports.slugifyApprovedDishBrand = slugifyApprovedDishBrand;
exports.listApprovedDishBrands = listApprovedDishBrands;
exports.getApprovedDishBrandDetail = getApprovedDishBrandDetail;
exports.getApprovedDishBrowseData = getApprovedDishBrowseData;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const supabase_client_1 = require("@menumanager/supabase-client");
const APPROVED_DISHES_TABLE = 'approved_dishes';
const LOCAL_APPROVED_DISHES_FILE = 'approved_dishes.json';
const MAX_DISH_ROWS = 10000;
const PAGE_SIZE = 1000;
function getLocalDbDir(repoRoot) {
    return path.join(repoRoot, 'tmp', 'db');
}
function deriveBrandFromProperty(property) {
    const normalized = `${property || ''}`.replace(/\s+/g, ' ').trim();
    if (!normalized)
        return 'Unknown Brand';
    const [brand] = normalized.split(' - ');
    return (brand || normalized).trim() || 'Unknown Brand';
}
function slugifyApprovedDishBrand(value) {
    const slug = `${value || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'unknown-brand';
}
function formatDateLabel(value) {
    if (!value)
        return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return '';
    return date.toISOString().slice(0, 10);
}
function extractClickUpTaskUrl(row) {
    const payload = row?.raw_payload || {};
    return `${payload?.clickupHistoryImport?.taskUrl || payload?.clickupTaskUrl || ''}`.trim();
}
function buildSourceInfo(sourceRow, sourceSubmissionId) {
    const id = `${sourceRow?.id || sourceSubmissionId || ''}`.trim();
    const filename = `${sourceRow?.filename || ''}`.trim();
    const projectName = `${sourceRow?.project_name || ''}`.trim();
    const legacyId = `${sourceRow?.legacy_id || ''}`.trim();
    const sourceType = `${sourceRow?.source || ''}`.trim();
    const clickupTaskId = `${sourceRow?.clickup_task_id || ''}`.trim();
    const reviewedAt = `${sourceRow?.reviewed_at || ''}`.trim();
    const updatedAt = `${sourceRow?.updated_at || ''}`.trim();
    const fallbackId = id ? id.slice(0, 8) : '';
    const label = filename || projectName || legacyId || fallbackId || 'Unknown source';
    const detailParts = [
        projectName && projectName !== label ? projectName : '',
        sourceType,
        clickupTaskId ? `ClickUp ${clickupTaskId}` : '',
        formatDateLabel(reviewedAt || updatedAt),
    ].filter(Boolean);
    return {
        id,
        legacyId,
        projectName,
        filename,
        sourceType,
        clickupTaskId,
        clickupTaskUrl: extractClickUpTaskUrl(sourceRow),
        reviewedAt,
        updatedAt,
        label,
        detail: detailParts.join(' | '),
    };
}
function normalizeSourceDish(row, options) {
    const property = `${row.property || ''}`.trim() || 'Unknown Property';
    const brand = deriveBrandFromProperty(property);
    const sourceSubmissionId = `${row.source_submission_id || ''}`.trim();
    const sourceRow = sourceSubmissionId ? options.sourceById.get(sourceSubmissionId) : undefined;
    const qualityInput = {
        id: row.id,
        dish_name: row.dish_name,
        property: row.property,
        service_period: row.service_period,
        menu_category: row.menu_category,
        description: row.description,
        price: row.price,
        allergens: row.allergens,
        source_submission_id: row.source_submission_id,
    };
    const quality = (0, supabase_client_1.analyzeApprovedDishQuality)(qualityInput, options.qualityContext);
    const sourceText = `${sourceRow?.approved_menu_content || sourceRow?.menu_content || ''}`;
    return {
        id: `${row.id || ''}`.trim(),
        dishName: `${row.dish_name || ''}`.trim(),
        property,
        brand,
        brandSlug: slugifyApprovedDishBrand(brand),
        location: property,
        servicePeriod: `${row.service_period || ''}`.trim(),
        menuCategory: `${row.menu_category || ''}`.trim(),
        description: `${row.description || ''}`.trim(),
        price: `${row.price || ''}`.trim(),
        allergens: Array.isArray(row.allergens)
            ? row.allergens.map((allergen) => `${allergen || ''}`.trim()).filter(Boolean)
            : [],
        sourceSubmissionId,
        source: buildSourceInfo(sourceRow, sourceSubmissionId),
        quality: {
            issues: quality.issues,
            highestSeverity: quality.highestSeverity || '',
            disposition: quality.disposition,
        },
        sourceContext: (0, supabase_client_1.findDishSourceContext)(sourceText, qualityInput),
        createdAt: `${row.created_at || ''}`.trim(),
    };
}
function matchesDishSearch(dish, query) {
    if (!query)
        return true;
    const haystack = [
        dish.dishName,
        dish.description,
        dish.property,
        dish.brand,
        dish.servicePeriod,
        dish.menuCategory,
        dish.source.label,
        dish.source.detail,
        dish.sourceSubmissionId,
        dish.quality.issues.map((issue) => issue.code).join(' '),
        dish.quality.issues.map((issue) => issue.reason).join(' '),
        dish.price,
        dish.allergens.join(' '),
    ].join(' ').toLowerCase();
    return haystack.includes(query);
}
function compareDishRows(a, b) {
    return (a.menuCategory.localeCompare(b.menuCategory) ||
        a.dishName.localeCompare(b.dishName) ||
        a.property.localeCompare(b.property));
}
function buildBrandSummaries(dishes) {
    const summaryBySlug = new Map();
    for (const dish of dishes) {
        const existing = summaryBySlug.get(dish.brandSlug);
        if (existing) {
            existing.dishCount += 1;
            if (!existing.locations.includes(dish.location)) {
                existing.locations.push(dish.location);
                existing.locations.sort((a, b) => a.localeCompare(b));
                existing.locationCount = existing.locations.length;
            }
            continue;
        }
        summaryBySlug.set(dish.brandSlug, {
            brand: dish.brand,
            slug: dish.brandSlug,
            dishCount: 1,
            locationCount: 1,
            locations: [dish.location],
        });
    }
    return Array.from(summaryBySlug.values()).sort((a, b) => a.brand.localeCompare(b.brand));
}
async function readLocalApprovedDishes(repoRoot) {
    const target = path.join(getLocalDbDir(repoRoot), LOCAL_APPROVED_DISHES_FILE);
    try {
        const raw = await fs_1.promises.readFile(target, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
            return parsed;
        if (parsed && typeof parsed === 'object')
            return Object.values(parsed);
        return [];
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return [];
        throw error;
    }
}
async function readLocalSubmissions(repoRoot) {
    const target = path.join(getLocalDbDir(repoRoot), 'submissions.json');
    try {
        const raw = await fs_1.promises.readFile(target, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
            return parsed;
        if (parsed && typeof parsed === 'object')
            return Object.values(parsed);
        return [];
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return [];
        throw error;
    }
}
async function loadSubmissionRows(repoRoot, sourceRows) {
    const submissionIds = Array.from(new Set(sourceRows.map((row) => `${row.source_submission_id || ''}`.trim()).filter(Boolean)));
    const sourceById = new Map();
    if (submissionIds.length === 0) {
        return sourceById;
    }
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        for (let offset = 0; offset < submissionIds.length; offset += PAGE_SIZE) {
            const batch = submissionIds.slice(offset, offset + PAGE_SIZE);
            const { data, error } = await supabase
                .from('submissions')
                .select('id, legacy_id, project_name, filename, clickup_task_id, source, service_period, reviewed_at, updated_at, approved_menu_content, menu_content, raw_payload')
                .in('id', batch);
            if (error) {
                throw new Error(`Failed to load approved dish source submissions: ${error.message}`);
            }
            for (const row of data || []) {
                if (row?.id) {
                    sourceById.set(`${row.id}`, row);
                }
            }
        }
    }
    else {
        const localSubmissions = await readLocalSubmissions(repoRoot);
        for (const row of localSubmissions) {
            if (row?.id) {
                sourceById.set(`${row.id}`, row);
            }
        }
    }
    return sourceById;
}
async function loadApprovedDishRows(repoRoot) {
    let sourceRows = [];
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        for (let offset = 0; offset < MAX_DISH_ROWS; offset += PAGE_SIZE) {
            const { data, error } = await supabase
                .from(APPROVED_DISHES_TABLE)
                .select('*')
                .eq('is_active', true)
                .order('property', { ascending: true })
                .order('menu_category', { ascending: true })
                .order('dish_name', { ascending: true })
                .range(offset, offset + PAGE_SIZE - 1);
            if (error) {
                throw new Error(`Failed to load approved dishes: ${error.message}`);
            }
            const page = data || [];
            sourceRows = sourceRows.concat(page);
            if (page.length < PAGE_SIZE)
                break;
        }
    }
    else {
        sourceRows = await readLocalApprovedDishes(repoRoot);
    }
    const activeRows = sourceRows.filter((row) => row.is_active !== false);
    const sourceById = await loadSubmissionRows(repoRoot, activeRows);
    const qualityContext = (0, supabase_client_1.buildDishQualityContext)(activeRows);
    return activeRows
        .map((row) => normalizeSourceDish(row, { sourceById, qualityContext }))
        .filter((dish) => !!dish.dishName);
}
async function listApprovedDishBrands(repoRoot, query = '') {
    const normalizedQuery = `${query || ''}`.trim().toLowerCase();
    const dishes = (await loadApprovedDishRows(repoRoot))
        .filter((dish) => matchesDishSearch(dish, normalizedQuery));
    return buildBrandSummaries(dishes);
}
async function getApprovedDishBrandDetail(repoRoot, brandSlug, options = {}) {
    const brandDishes = (await loadApprovedDishRows(repoRoot))
        .filter((dish) => dish.brandSlug === `${brandSlug || ''}`.trim());
    return buildBrandDetail(brandDishes, options);
}
async function getApprovedDishBrowseData(repoRoot, brandSlug, options = {}) {
    const normalizedSlug = `${brandSlug || ''}`.trim();
    const dishes = await loadApprovedDishRows(repoRoot);
    const brandDishes = dishes.filter((dish) => dish.brandSlug === normalizedSlug);
    return {
        brandSummaries: buildBrandSummaries(dishes),
        brandDetail: buildBrandDetail(brandDishes, options),
    };
}
function buildBrandDetail(brandDishes, options = {}) {
    if (brandDishes.length === 0)
        return null;
    const normalizedQuery = `${options.query || ''}`.trim().toLowerCase();
    const normalizedLocation = `${options.location || ''}`.trim();
    const filteredDishes = brandDishes
        .filter((dish) => !normalizedLocation || dish.location === normalizedLocation)
        .filter((dish) => matchesDishSearch(dish, normalizedQuery))
        .sort(compareDishRows);
    const summary = buildBrandSummaries(brandDishes)[0];
    const locationGroups = Array.from(filteredDishes.reduce((groups, dish) => {
        const existing = groups.get(dish.location) || [];
        existing.push(dish);
        groups.set(dish.location, existing);
        return groups;
    }, new Map()))
        .map(([location, dishes]) => ({ location, dishes }))
        .sort((a, b) => a.location.localeCompare(b.location));
    return {
        summary,
        dishes: filteredDishes,
        locationGroups,
    };
}
