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
exports.ALLOWED_MENU_IMAGE_EXTENSIONS = exports.ALLOWED_PDF_EXTENSIONS = exports.ALLOWED_DOCX_EXTENSIONS = exports.MAX_UPLOAD_BYTES = exports.MAX_JSON_FIELD_LENGTH = exports.MAX_HTML_FIELD_LENGTH = exports.MAX_LONG_TEXT_LENGTH = exports.MAX_TEXT_FIELD_LENGTH = void 0;
exports.sanitizePlainTextInput = sanitizePlainTextInput;
exports.sanitizeRichTextHtml = sanitizeRichTextHtml;
exports.sanitizeStoredFileName = sanitizeStoredFileName;
exports.hasAllowedExtension = hasAllowedExtension;
exports.isPathInsideRoot = isPathInsideRoot;
exports.assertPathInRoot = assertPathInRoot;
exports.assertUploadedFileType = assertUploadedFileType;
exports.resolveSafeStoredPath = resolveSafeStoredPath;
exports.isClientInputError = isClientInputError;
const fs_1 = require("fs");
const path = __importStar(require("path"));
exports.MAX_TEXT_FIELD_LENGTH = 500;
exports.MAX_LONG_TEXT_LENGTH = 50000;
exports.MAX_HTML_FIELD_LENGTH = 250000;
exports.MAX_JSON_FIELD_LENGTH = 20000;
exports.MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
exports.ALLOWED_DOCX_EXTENSIONS = new Set(['.docx']);
exports.ALLOWED_PDF_EXTENSIONS = new Set(['.pdf']);
exports.ALLOWED_MENU_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']);
function normalizeLineEndings(value) {
    return `${value || ''}`.replace(/\r\n?/g, '\n');
}
function sanitizePlainTextInput(value, options) {
    const multiline = !!options?.multiline;
    const maxLength = options?.maxLength || exports.MAX_TEXT_FIELD_LENGTH;
    const trim = options?.trim !== false;
    const normalized = normalizeLineEndings(`${value ?? ''}`)
        .replace(/\u0000/g, '')
        .replace(multiline ? /[^\S\n\t]+/g : /\s+/g, ' ')
        .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .slice(0, maxLength);
    return trim ? normalized.trim() : normalized;
}
function sanitizeRichTextHtml(value, maxLength = exports.MAX_HTML_FIELD_LENGTH) {
    let html = normalizeLineEndings(`${value ?? ''}`).replace(/\u0000/g, '').slice(0, maxLength);
    html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
    html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, '');
    html = html.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '');
    html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
    html = html.replace(/javascript\s*:/gi, '');
    html = html.replace(/data:text\/html/gi, '');
    return html.trim();
}
function sanitizeStoredFileName(fileName, fallback = 'upload.bin') {
    const basename = path.basename(`${fileName || ''}`.trim() || fallback);
    const sanitized = basename
        .replace(/[^A-Za-z0-9._ -]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/^\.+/, '')
        .trim();
    return sanitized || fallback;
}
function hasAllowedExtension(fileName, allowedExtensions) {
    return allowedExtensions.has(path.extname(`${fileName || ''}`).toLowerCase());
}
function isPathInsideRoot(candidatePath, rootPath) {
    const resolvedCandidate = path.resolve(candidatePath);
    const resolvedRoot = path.resolve(rootPath);
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}
function assertPathInRoot(candidatePath, rootPath, label) {
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
async function readFileSignature(filePath, bytes = 16) {
    const handle = await fs_1.promises.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(bytes);
        const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
        return buffer.subarray(0, bytesRead);
    }
    finally {
        await handle.close();
    }
}
async function assertUploadedFileType(filePath, allowedKinds) {
    const signature = await readFileSignature(filePath, 16);
    const hex = signature.toString('hex');
    const ascii = signature.toString('ascii');
    const detectedKind = hex.startsWith('504b0304') ? 'docx' :
        ascii.startsWith('%PDF') ? 'pdf' :
            hex.startsWith('89504e470d0a1a0a') ? 'png' :
                hex.startsWith('ffd8ff') ? 'jpg' :
                    ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a') ? 'gif' :
                        ascii.substring(8, 12) === 'WEBP' ? 'webp' :
                            null;
    if (!detectedKind || !allowedKinds.includes(detectedKind)) {
        throw new Error(`Uploaded file signature is not an allowed ${allowedKinds.join(', ')} file`);
    }
}
function resolveSafeStoredPath(candidatePath, label, allowedRoots, allowedExtensions) {
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
function isClientInputError(error) {
    const message = `${error?.message || ''}`.toLowerCase();
    return (message.includes('allowed') ||
        message.includes('valid') ||
        message.includes('required') ||
        message.includes('upload directory') ||
        message.includes('storage roots') ||
        message.includes('file signature'));
}
