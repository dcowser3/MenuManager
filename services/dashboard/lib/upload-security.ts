import { promises as fs } from 'fs';
import * as path from 'path';

export const MAX_TEXT_FIELD_LENGTH = 500;
export const MAX_LONG_TEXT_LENGTH = 50000;
export const MAX_HTML_FIELD_LENGTH = 250000;
export const MAX_JSON_FIELD_LENGTH = 20000;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_DOCX_EXTENSIONS = new Set(['.docx']);
export const ALLOWED_PDF_EXTENSIONS = new Set(['.pdf']);
export const ALLOWED_MENU_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']);

function normalizeLineEndings(value: string): string {
    return `${value || ''}`.replace(/\r\n?/g, '\n');
}

export function sanitizePlainTextInput(
    value: unknown,
    options?: { multiline?: boolean; maxLength?: number; trim?: boolean }
): string {
    const multiline = !!options?.multiline;
    const maxLength = options?.maxLength || MAX_TEXT_FIELD_LENGTH;
    const trim = options?.trim !== false;
    const normalized = normalizeLineEndings(`${value ?? ''}`)
        .replace(/\u0000/g, '')
        .replace(multiline ? /[^\S\n\t]+/g : /\s+/g, ' ')
        .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .slice(0, maxLength);
    return trim ? normalized.trim() : normalized;
}

export function sanitizeRichTextHtml(value: unknown, maxLength = MAX_HTML_FIELD_LENGTH): string {
    let html = normalizeLineEndings(`${value ?? ''}`).replace(/\u0000/g, '').slice(0, maxLength);
    html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
    html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, '');
    html = html.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '');
    html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
    html = html.replace(/javascript\s*:/gi, '');
    html = html.replace(/data:text\/html/gi, '');
    return html.trim();
}

function extractRestaurantName(projectName: string, property?: string): string {
    const propertyName = `${property || ''}`.trim();
    const projectLabel = `${projectName || ''}`.trim();
    const source = propertyName || projectLabel || 'Menu';
    return source.split(' - ')[0].trim() || source || 'Menu';
}

function sanitizeFilenameSegment(value: string): string {
    return `${value || ''}`
        .trim()
        .replace(/[\\/:*?"<>|#%]+/g, ' ')
        .replace(/[^A-Za-z0-9._ -]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function toFilenameTitleCase(value: string): string {
    return value
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
}

function formatMenuDateSegment(value?: string): string {
    const candidate = `${value || ''}`.trim();
    const isoDate = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDate) {
        const month = Number.parseInt(isoDate[2], 10);
        const day = Number.parseInt(isoDate[3], 10);
        const year = isoDate[1].slice(-2);
        return `${month}.${day}.${year}`;
    }

    const parsed = candidate ? new Date(candidate) : new Date();
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    return `${date.getMonth() + 1}.${date.getDate()}.${String(date.getFullYear()).slice(-2)}`;
}

export function buildMenuFilename(
    projectName: string,
    property?: string,
    servicePeriod?: string,
    dateNeeded?: string,
    extension = '.docx'
): string {
    if (servicePeriod || dateNeeded) {
        const restaurant = sanitizeFilenameSegment(extractRestaurantName(projectName, property)) || 'Menu';
        const service = sanitizeFilenameSegment(toFilenameTitleCase(`${servicePeriod || 'Other'}`.replace(/_/g, ' '))) || 'Other';
        const date = formatMenuDateSegment(dateNeeded);
        const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
        return `${restaurant}_${service}_${date}${normalizedExtension}`;
    }

    const name = `${projectName || ''}`.trim() || 'Menu';
    const propertyName = `${property || ''}`.trim();
    if (propertyName) {
        return `${propertyName} - ${name}.docx`;
    }
    // No property: avoid duplicated "Menu" when projectName already contains it.
    if (/\bmenu\b/i.test(name)) {
        return `${name}.docx`;
    }
    return `${name} Menu.docx`;
}

export function sanitizeStoredFileName(fileName: unknown, fallback = 'upload.bin'): string {
    const basename = path.basename(`${fileName || ''}`.trim() || fallback);
    const sanitized = basename
        .replace(/[^A-Za-z0-9._ -]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/^\.+/, '')
        .trim();
    return sanitized || fallback;
}

export function hasAllowedExtension(fileName: string, allowedExtensions: Set<string>): boolean {
    return allowedExtensions.has(path.extname(`${fileName || ''}`).toLowerCase());
}

export function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
    const resolvedCandidate = path.resolve(candidatePath);
    const resolvedRoot = path.resolve(rootPath);
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

export function assertPathInRoot(candidatePath: string, rootPath: string, label: string): string {
    const normalized = `${candidatePath || ''}`.trim();
    if (!normalized) {
        throw new Error(`${label} path is required`);
    }
    const resolved = path.resolve(normalized);
    if (!isPathInsideRoot(resolved, rootPath)) {
        throw new Error(`${label} path is not in an allowed upload directory`);
    }
    return resolved;
}

async function readFileSignature(filePath: string, bytes = 16): Promise<Buffer> {
    const handle = await fs.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(bytes);
        const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
        return buffer.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
}

export async function assertUploadedFileType(
    filePath: string,
    allowedKinds: Array<'docx' | 'pdf' | 'png' | 'jpg' | 'gif' | 'webp'>
): Promise<void> {
    const signature = await readFileSignature(filePath, 16);
    const hex = signature.toString('hex');
    const ascii = signature.toString('ascii');

    const detectedKind =
        hex.startsWith('504b0304') ? 'docx' :
        ascii.startsWith('%PDF') ? 'pdf' :
        hex.startsWith('89504e470d0a1a0a') ? 'png' :
        hex.startsWith('ffd8ff') ? 'jpg' :
        ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a') ? 'gif' :
        ascii.substring(8, 12) === 'WEBP' ? 'webp' :
        null;

    if (!detectedKind || !allowedKinds.includes(detectedKind as any)) {
        throw new Error(`Uploaded file signature is not an allowed ${allowedKinds.join(', ')} file`);
    }
}

export function resolveSafeStoredPath(candidatePath: string, label: string, allowedRoots: string[], allowedExtensions?: Set<string>): string {
    const normalized = `${candidatePath || ''}`.trim();
    if (!normalized) {
        throw new Error(`${label} path is required`);
    }

    const resolved = path.resolve(normalized);
    if (!allowedRoots.some((root) => isPathInsideRoot(resolved, root))) {
        throw new Error(`${label} path is outside the allowed storage roots`);
    }
    if (allowedExtensions && !hasAllowedExtension(resolved, allowedExtensions)) {
        throw new Error(`${label} must use an allowed file extension`);
    }
    return resolved;
}

export function isClientInputError(error: any): boolean {
    const message = `${error?.message || ''}`.toLowerCase();
    return (
        message.includes('allowed') ||
        message.includes('valid') ||
        message.includes('required') ||
        message.includes('upload directory') ||
        message.includes('storage roots') ||
        message.includes('file signature')
    );
}
