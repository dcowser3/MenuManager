import { promises as fs } from 'fs';
import * as path from 'path';
import {
    DishQualityIssue,
    DishQualitySeverity,
    DishSourceContext,
    analyzeApprovedDishQuality,
    buildDishQualityContext,
    findDishSourceContext,
    getSupabaseClient,
    isSupabaseConfigured,
} from '@menumanager/supabase-client';

const APPROVED_DISHES_TABLE = 'approved_dishes';
const LOCAL_APPROVED_DISHES_FILE = 'approved_dishes.json';
const MAX_DISH_ROWS = 10000;
const PAGE_SIZE = 1000;

type ApprovedDishSourceRow = {
    id?: string;
    dish_name?: string;
    dish_name_normalized?: string;
    property?: string;
    service_period?: string;
    menu_category?: string;
    description?: string;
    price?: string;
    allergens?: string[];
    source_submission_id?: string;
    is_active?: boolean;
    created_at?: string;
};

type ApprovedDishSubmissionRow = {
    id?: string;
    legacy_id?: string;
    project_name?: string;
    filename?: string;
    clickup_task_id?: string;
    source?: string;
    service_period?: string;
    reviewed_at?: string;
    updated_at?: string;
    approved_menu_content?: string;
    menu_content?: string;
    raw_payload?: any;
};

export type ApprovedDishSourceInfo = {
    id: string;
    legacyId: string;
    projectName: string;
    filename: string;
    sourceType: string;
    clickupTaskId: string;
    clickupTaskUrl: string;
    reviewedAt: string;
    updatedAt: string;
    label: string;
    detail: string;
};

export type ApprovedDishQualityInfo = {
    issues: DishQualityIssue[];
    highestSeverity: DishQualitySeverity | '';
    disposition: 'keep' | 'review' | 'exclude';
};

export type ApprovedDishListItem = {
    id: string;
    dishName: string;
    property: string;
    brand: string;
    brandSlug: string;
    location: string;
    servicePeriod: string;
    menuCategory: string;
    description: string;
    price: string;
    allergens: string[];
    sourceSubmissionId: string;
    source: ApprovedDishSourceInfo;
    quality: ApprovedDishQualityInfo;
    sourceContext: DishSourceContext;
    createdAt: string;
};

export type ApprovedDishBrandSummary = {
    brand: string;
    slug: string;
    dishCount: number;
    locationCount: number;
    locations: string[];
};

export type ApprovedDishLocationGroup = {
    location: string;
    dishes: ApprovedDishListItem[];
};

export type ApprovedDishBrandDetail = {
    summary: ApprovedDishBrandSummary;
    dishes: ApprovedDishListItem[];
    locationGroups: ApprovedDishLocationGroup[];
};

export type ApprovedDishBrowseData = {
    brandSummaries: ApprovedDishBrandSummary[];
    brandDetail: ApprovedDishBrandDetail | null;
};

function getLocalDbDir(repoRoot: string): string {
    return path.join(repoRoot, 'tmp', 'db');
}

export function deriveBrandFromProperty(property: string): string {
    const normalized = `${property || ''}`.replace(/\s+/g, ' ').trim();
    if (!normalized) return 'Unknown Brand';

    const [brand] = normalized.split(' - ');
    return (brand || normalized).trim() || 'Unknown Brand';
}

export function slugifyApprovedDishBrand(value: string): string {
    const slug = `${value || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return slug || 'unknown-brand';
}

function formatDateLabel(value: string | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
}

function extractClickUpTaskUrl(row: ApprovedDishSubmissionRow | undefined): string {
    const payload = row?.raw_payload || {};
    return `${payload?.clickupHistoryImport?.taskUrl || payload?.clickupTaskUrl || ''}`.trim();
}

function buildSourceInfo(sourceRow: ApprovedDishSubmissionRow | undefined, sourceSubmissionId: string): ApprovedDishSourceInfo {
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

function normalizeSourceDish(
    row: ApprovedDishSourceRow,
    options: {
        sourceById: Map<string, ApprovedDishSubmissionRow>;
        qualityContext: ReturnType<typeof buildDishQualityContext>;
    }
): ApprovedDishListItem {
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
    const quality = analyzeApprovedDishQuality(qualityInput, options.qualityContext);
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
        sourceContext: findDishSourceContext(sourceText, qualityInput),
        createdAt: `${row.created_at || ''}`.trim(),
    };
}

function matchesDishSearch(dish: ApprovedDishListItem, query: string): boolean {
    if (!query) return true;

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

function compareDishRows(a: ApprovedDishListItem, b: ApprovedDishListItem): number {
    return (
        a.menuCategory.localeCompare(b.menuCategory) ||
        a.dishName.localeCompare(b.dishName) ||
        a.property.localeCompare(b.property)
    );
}

function buildBrandSummaries(dishes: ApprovedDishListItem[]): ApprovedDishBrandSummary[] {
    const summaryBySlug = new Map<string, ApprovedDishBrandSummary>();

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

async function readLocalApprovedDishes(repoRoot: string): Promise<ApprovedDishSourceRow[]> {
    const target = path.join(getLocalDbDir(repoRoot), LOCAL_APPROVED_DISHES_FILE);
    try {
        const raw = await fs.readFile(target, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') return Object.values(parsed);
        return [];
    } catch (error: any) {
        if (error?.code === 'ENOENT') return [];
        throw error;
    }
}

async function readLocalSubmissions(repoRoot: string): Promise<ApprovedDishSubmissionRow[]> {
    const target = path.join(getLocalDbDir(repoRoot), 'submissions.json');
    try {
        const raw = await fs.readFile(target, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') return Object.values(parsed);
        return [];
    } catch (error: any) {
        if (error?.code === 'ENOENT') return [];
        throw error;
    }
}

async function loadSubmissionRows(
    repoRoot: string,
    sourceRows: ApprovedDishSourceRow[]
): Promise<Map<string, ApprovedDishSubmissionRow>> {
    const submissionIds = Array.from(new Set(
        sourceRows.map((row) => `${row.source_submission_id || ''}`.trim()).filter(Boolean)
    ));
    const sourceById = new Map<string, ApprovedDishSubmissionRow>();

    if (submissionIds.length === 0) {
        return sourceById;
    }

    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
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
                    sourceById.set(`${row.id}`, row as ApprovedDishSubmissionRow);
                }
            }
        }
    } else {
        const localSubmissions = await readLocalSubmissions(repoRoot);
        for (const row of localSubmissions) {
            if (row?.id) {
                sourceById.set(`${row.id}`, row);
            }
        }
    }

    return sourceById;
}

async function loadApprovedDishRows(repoRoot: string): Promise<ApprovedDishListItem[]> {
    let sourceRows: ApprovedDishSourceRow[] = [];

    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();

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
            if (page.length < PAGE_SIZE) break;
        }
    } else {
        sourceRows = await readLocalApprovedDishes(repoRoot);
    }

    const activeRows = sourceRows.filter((row) => row.is_active !== false);
    const sourceById = await loadSubmissionRows(repoRoot, activeRows);
    const qualityContext = buildDishQualityContext(activeRows);

    return activeRows
        .map((row) => normalizeSourceDish(row, { sourceById, qualityContext }))
        .filter((dish) => !!dish.dishName);
}

export async function listApprovedDishBrands(
    repoRoot: string,
    query = ''
): Promise<ApprovedDishBrandSummary[]> {
    const normalizedQuery = `${query || ''}`.trim().toLowerCase();
    const dishes = (await loadApprovedDishRows(repoRoot))
        .filter((dish) => matchesDishSearch(dish, normalizedQuery));

    return buildBrandSummaries(dishes);
}

export async function getApprovedDishBrandDetail(
    repoRoot: string,
    brandSlug: string,
    options: {
        query?: string;
        location?: string;
    } = {}
): Promise<ApprovedDishBrandDetail | null> {
    const brandDishes = (await loadApprovedDishRows(repoRoot))
        .filter((dish) => dish.brandSlug === `${brandSlug || ''}`.trim());

    return buildBrandDetail(brandDishes, options);
}

export async function getApprovedDishBrowseData(
    repoRoot: string,
    brandSlug: string,
    options: {
        query?: string;
        location?: string;
    } = {}
): Promise<ApprovedDishBrowseData> {
    const normalizedSlug = `${brandSlug || ''}`.trim();
    const dishes = await loadApprovedDishRows(repoRoot);
    const brandDishes = dishes.filter((dish) => dish.brandSlug === normalizedSlug);

    return {
        brandSummaries: buildBrandSummaries(dishes),
        brandDetail: buildBrandDetail(brandDishes, options),
    };
}

function buildBrandDetail(
    brandDishes: ApprovedDishListItem[],
    options: {
        query?: string;
        location?: string;
    } = {}
): ApprovedDishBrandDetail | null {
    if (brandDishes.length === 0) return null;

    const normalizedQuery = `${options.query || ''}`.trim().toLowerCase();
    const normalizedLocation = `${options.location || ''}`.trim();

    const filteredDishes = brandDishes
        .filter((dish) => !normalizedLocation || dish.location === normalizedLocation)
        .filter((dish) => matchesDishSearch(dish, normalizedQuery))
        .sort(compareDishRows);

    const summary = buildBrandSummaries(brandDishes)[0];
    const locationGroups = Array.from(
        filteredDishes.reduce((groups, dish) => {
            const existing = groups.get(dish.location) || [];
            existing.push(dish);
            groups.set(dish.location, existing);
            return groups;
        }, new Map<string, ApprovedDishListItem[]>())
    )
        .map(([location, dishes]) => ({ location, dishes }))
        .sort((a, b) => a.location.localeCompare(b.location));

    return {
        summary,
        dishes: filteredDishes,
        locationGroups,
    };
}
