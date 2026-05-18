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
function normalizeSourceDish(row) {
    const property = `${row.property || ''}`.trim() || 'Unknown Property';
    const brand = deriveBrandFromProperty(property);
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
        sourceSubmissionId: `${row.source_submission_id || ''}`.trim(),
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
    return sourceRows
        .filter((row) => row.is_active !== false)
        .map((row) => normalizeSourceDish(row))
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
