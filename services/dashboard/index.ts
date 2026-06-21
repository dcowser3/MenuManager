import express from 'express';
import multer from 'multer';
import axios from 'axios';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

// Supabase client for dish extraction and alerting (optional - gracefully handles if not configured)
import {
    isSupabaseConfigured,
    buildDishNameFormattingAnchors,
    extractAndStoreDishes,
    logAlert,
    buildAlertEmailHtml,
    SystemAlert
} from '@menumanager/supabase-client';
import nodemailer from 'nodemailer';
import {
    loadApprovalBaselineFromSubmission,
    resolveApprovalSourceDocument,
    textToParagraphHtml,
} from './lib/approval-baseline';
import { buildSmtpRuntimeConfig } from './lib/smtp-config';
import {
    ALLOWED_DOCX_EXTENSIONS,
    ALLOWED_MENU_IMAGE_EXTENSIONS,
    ALLOWED_PDF_EXTENSIONS,
    MAX_LONG_TEXT_LENGTH,
    MAX_UPLOAD_BYTES,
    assertUploadedFileType,
    hasAllowedExtension,
    isClientInputError,
    resolveSafeStoredPath,
    sanitizePlainTextInput,
    sanitizeRichTextHtml,
    sanitizeStoredFileName,
} from './lib/upload-security';
import { createInternalApiClient } from '@menumanager/internal-auth';
import { createSubmissionWorkflowHandlers } from './lib/submission-workflow';
import {
    SubmissionConfirmationInput,
    buildSubmissionConfirmationRecipients,
    buildSubmissionEmailSubject,
    buildSubmissionReceiptHtml,
} from './lib/submission-confirmation-mail';
import { createApprovalWorkflowHandlers } from './lib/approval-workflow';
import { createDesignApprovalWorkflowHandlers } from './lib/design-approval-workflow';
import { getApprovedDishBrowseData, listApprovedDishBrands } from './lib/approved-dishes';
import { getApprovedMenuDownload, listApprovedMenus } from './lib/approved-menus';
import {
    buildClickUpTaskPayloadFromStoredSubmission,
    describeServiceError,
    mergeClickUpHandoffMetadata,
    normalizeRawPayload,
} from './lib/clickup-handoff';
import { logFormAttemptEvent } from './lib/form-attempt-logging';
import {
    buildErrorReportEmail,
    buildErrorReportTriageEmail,
    buildErrorReportTriagePrompt,
    decodeScreenshotDataUrl,
    normalizeErrorReport,
    shouldEmailErrorReport,
    shouldRunErrorReportAiTriage,
} from './lib/error-report';
import {
    buildGraphMailConfig,
    canSendAlertMail,
    sendAlertMail,
} from './lib/alert-mail';
import {
    buildFallbackPropertyCatalog,
    normalizePropertyCatalogRecord,
    PropertyCatalogRecord,
} from './lib/property-catalog';
import { applyHighConfidenceSuggestionsToMenu } from './lib/apply-high-confidence-suggestions';
import { guardAllergenAlphabetizationSuggestions } from './lib/allergen-suggestion-guard';
import { preserveLeadingMenuTitle } from './lib/menu-title-guard';
import {
    buildCorrectionRuleRecord,
    isCorrectionRuleValidationError,
} from './lib/learning-correction-rules';
import { listActionablePendingCorrectionRules } from './lib/learning-dashboard-rules';
import { decorateLearningSubmissionsWithMenuNames } from './lib/learning-submissions';
import {
    analyzeEmbeddedSetMenus,
    buildEmbeddedSetMenuPromptSection,
    guardEmbeddedSetMenuPrices,
} from './lib/embedded-set-menu-guard';
import { assessCorrectedMenuStructure } from './lib/corrected-menu-structure-guard';
import { guardCorrectedMenuPrices } from './lib/price-integrity-guard';
import {
    AcceptedCorrectionRule,
    BUILT_IN_REPLACEMENTS,
    getAcceptedCorrectionRulePreAiEligibility,
    runPreAiDeterministicChecks,
} from './lib/pre-ai-deterministic-rules';
import { logBasicAiCheckAudit, linkBasicAiCheckAuditsToSubmission } from './lib/basic-ai-check-audit';
import {
    isLikelyAllergenLegendHeader,
    isLikelyAllergenLegendLine,
    isLikelyRawNoticeLine,
    normalizeAllergenLegend,
    normalizeMenuFooter,
    normalizeWhitespace,
    parseParenthesizedAllergenLegend,
    stripManagedFooterText,
} from './lib/menu-footer';
import { buildFinalPrompt } from './lib/qa-prompt-builder';
import {
    parseAIResponse,
    reconcileCriticalSuggestionsAgainstCorrectedMenu,
    runPostAiPipeline,
} from './lib/review-pipeline';
import {
    buildCodeRecommendationIssue,
    evaluateSecretExpiry,
    mapProposedRuleToCorrectionRulePayload,
    pickEffectivePrompt,
    resolveDashboardPublicUrl,
} from './lib/improvement-cycle-core';

export {
    sanitizePlainTextInput,
    sanitizeRichTextHtml,
    sanitizeStoredFileName,
} from './lib/upload-security';

const execAsync = promisify(exec);
const DEFAULT_ALLERGEN_KEY = 'G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan';
// Which flow `/form` serves. Defaults to the proven legacy flow so the new
// upload-first flow can be piloted at `/form-new` before switching everyone
// over. Set NEW_SUBMISSION_FORM_DEFAULT=true (env) — or flip this default and
// redeploy — to make `/form` serve the new flow.
const NEW_SUBMISSION_FORM_DEFAULT = ['1', 'true', 'yes', 'on']
    .includes(`${process.env.NEW_SUBMISSION_FORM_DEFAULT || ''}`.trim().toLowerCase());
const DB_SERVICE_URL = process.env.DB_SERVICE_URL || 'http://localhost:3004';
const AI_REVIEW_URL = process.env.AI_REVIEW_URL || 'http://localhost:3002';
const DIFFER_SERVICE_URL = process.env.DIFFER_SERVICE_URL || 'http://localhost:3006';
const CLICKUP_SERVICE_URL = process.env.CLICKUP_SERVICE_URL || 'http://localhost:3007';
const ALERT_EMAIL = process.env.ALERT_EMAIL || '';
const FORM_ATTEMPT_ALERT_EMAIL = process.env.FORM_ATTEMPT_ALERT_EMAIL || 'dcowser@richardsandoval.com';
const PUBLIC_FORM_SUPPORT_EMAIL = process.env.PUBLIC_FORM_SUPPORT_EMAIL || 'dcowser@richardsandoval.com';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3005';
const LEARNING_DASHBOARD_TIME_ZONE = process.env.LEARNING_DASHBOARD_TIME_ZONE || 'America/New_York';
const JSON_BODY_LIMIT = process.env.DASHBOARD_JSON_BODY_LIMIT || process.env.JSON_BODY_LIMIT || '5mb';
const ERROR_REPORT_JSON_BODY_LIMIT = process.env.ERROR_REPORT_JSON_BODY_LIMIT || '15mb';
const ERROR_REPORT_BODY_SAFETY_BYTES = 512 * 1024;
const ERROR_REPORT_CLIENT_MAX_BODY_BYTES = Math.max(
    1024 * 1024,
    parseBodyLimitBytes(ERROR_REPORT_JSON_BODY_LIMIT, 15 * 1024 * 1024) - ERROR_REPORT_BODY_SAFETY_BYTES
);
const ERROR_REPORT_TRIAGE_MODEL = process.env.ERROR_REPORT_TRIAGE_MODEL || process.env.IMPROVE_MODEL || process.env.AI_REVIEW_MODEL || 'gpt-4o-mini';
const internalApi = createInternalApiClient(axios);

function parseBodyLimitBytes(value: string | undefined, fallback: number): number {
    const text = `${value || ''}`.trim().toLowerCase();
    if (!text) return fallback;
    const match = /^(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g)?$/.exec(text);
    if (!match) return fallback;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return fallback;
    const unit = match[2] || 'b';
    const multiplier = unit === 'gb' || unit === 'g'
        ? 1024 * 1024 * 1024
        : unit === 'mb' || unit === 'm'
            ? 1024 * 1024
            : unit === 'kb' || unit === 'k'
                ? 1024
                : 1;
    return Math.floor(amount * multiplier);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

function parseBooleanFlag(value: any): boolean {
    return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

const BASIC_AI_CHECK_TIMEOUT_MS = parsePositiveInteger(
    process.env.BASIC_AI_CHECK_TIMEOUT_MS || process.env.AI_REVIEW_QA_TIMEOUT_MS,
    120000
);
const AI_REVIEW_SUBMIT_TIMEOUT_MS = parsePositiveInteger(process.env.AI_REVIEW_SUBMIT_TIMEOUT_MS, BASIC_AI_CHECK_TIMEOUT_MS);
const BASIC_AI_PRECHECK_ENABLED = !parseBooleanFlag(process.env.BASIC_AI_PRECHECK_DISABLED);
const BASIC_AI_LEARNED_PRECHECK_ENABLED = !parseBooleanFlag(process.env.BASIC_AI_LEARNED_PRECHECK_DISABLED);
const BASIC_AI_LEARNED_RULE_FETCH_TIMEOUT_MS = parsePositiveInteger(
    process.env.BASIC_AI_LEARNED_RULE_FETCH_TIMEOUT_MS,
    2500
);
const CLICKUP_TASK_CREATE_TIMEOUT_MS = parsePositiveInteger(process.env.CLICKUP_TASK_CREATE_TIMEOUT_MS, 60000);
const BASIC_AI_CHECK_JOB_TTL_MS = parsePositiveInteger(process.env.BASIC_AI_CHECK_JOB_TTL_MS, 15 * 60 * 1000);
const CLICKUP_APPROVAL_FINALIZE_TIMEOUT_MS = parsePositiveInteger(
    process.env.CLICKUP_APPROVAL_FINALIZE_TIMEOUT_MS,
    CLICKUP_TASK_CREATE_TIMEOUT_MS
);
const BASIC_AI_CHECK_DEBUG_ENABLED = process.env.BASIC_AI_CHECK_DEBUG_ENABLED !== undefined
    ? parseBooleanFlag(process.env.BASIC_AI_CHECK_DEBUG_ENABLED)
    : process.env.NODE_ENV !== 'production';
const BASIC_AI_CHECK_DEBUG_MAX_CHARS = parsePositiveInteger(process.env.BASIC_AI_CHECK_DEBUG_MAX_CHARS, 60000);

type BasicCheckJob = {
    id: string;
    status: 'pending' | 'completed' | 'failed';
    createdAt: number;
    updatedAt: number;
    statusCode?: number;
    result?: any;
    error?: string;
};

const basicCheckJobs = new Map<string, BasicCheckJob>();

function truncateDiagnosticText(value: any): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
    if (text.length <= BASIC_AI_CHECK_DEBUG_MAX_CHARS) return text;
    return `${text.slice(0, BASIC_AI_CHECK_DEBUG_MAX_CHARS)}\n...[truncated ${text.length - BASIC_AI_CHECK_DEBUG_MAX_CHARS} chars]`;
}

function wantsBasicCheckDiagnostics(req: any): boolean {
    if (!BASIC_AI_CHECK_DEBUG_ENABLED) return false;
    return parseBooleanFlag(req.body?.debugBasicCheck)
        || parseBooleanFlag(req.query?.debugBasicCheck)
        || parseBooleanFlag(req.get?.('x-menumanager-debug-basic-check'));
}

function sanitizeBasicCheckFailure(errorDetails: ReturnType<typeof describeServiceError>): Record<string, any> {
    const status = errorDetails.status;
    const code = errorDetails.code;
    const message = `${errorDetails.message || ''}`.slice(0, 300);
    const combined = `${code || ''} ${message}`.toLowerCase();
    let reason = 'ai_review_failed';

    if (combined.includes('timeout') || code === 'ECONNABORTED') {
        reason = 'ai_review_timeout';
    } else if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') {
        reason = 'ai_review_unreachable';
    } else if (status === 401 || status === 403) {
        reason = 'ai_review_auth_failed';
    } else if (status === 429) {
        reason = 'ai_review_rate_limited';
    } else if (typeof status === 'number' && status >= 500) {
        reason = 'ai_review_service_error';
    }

    return Object.fromEntries(
        Object.entries({
            reason,
            code,
            status,
            statusText: errorDetails.statusText,
            message: message || undefined,
        }).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
}

function cleanupBasicCheckJobs(): void {
    const cutoff = Date.now() - BASIC_AI_CHECK_JOB_TTL_MS;
    for (const [id, job] of basicCheckJobs.entries()) {
        if (job.updatedAt < cutoff) {
            basicCheckJobs.delete(id);
        }
    }
}

// Alert email transports: Graph (HTTPS, preferred — Lightsail blocks outbound
// port 25) with SMTP fallback when only SMTP is configured.
const smtpConfig = buildSmtpRuntimeConfig();
const hasSmtpConfig = smtpConfig.enabled;
const smtpFromAddress = smtpConfig.fromAddress;
const alertTransporter = hasSmtpConfig ? nodemailer.createTransport(smtpConfig.transportOptions as any) : null;
const graphMailConfig = buildGraphMailConfig();
const alertMailDeps = {
    graphConfig: graphMailConfig,
    smtpTransporter: alertTransporter,
    smtpFromAddress,
};

// Alert dedup: 15-min cooldown per alert_type
const alertCooldowns = new Map<string, number>();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const formAttemptEmailCooldowns = new Map<string, number>();
const FORM_ATTEMPT_EMAIL_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Send an admin alert: logs to Supabase + sends email (both fire-and-forget).
 * Deduplicates by alert_type with a 15-minute cooldown.
 */
function sendAdminAlert(alert: SystemAlert): void {
    const lastSent = alertCooldowns.get(alert.alert_type) || 0;
    if (Date.now() - lastSent < ALERT_COOLDOWN_MS) return;
    alertCooldowns.set(alert.alert_type, Date.now());

    // Log to Supabase
    logAlert(alert);

    // Send email
    if (canSendAlertMail(alertMailDeps) && ALERT_EMAIL) {
        const severityLabel = alert.severity.toUpperCase();
        sendAlertMail({
            fromName: 'Menu Manager Alerts',
            to: ALERT_EMAIL,
            subject: `[${severityLabel}] ${alert.alert_type.replace(/_/g, ' ')} — Menu Manager`,
            html: buildAlertEmailHtml(alert, DASHBOARD_URL),
        }, alertMailDeps).catch((err: any) => console.error('Failed to send alert email:', err.message));
    }
}

export function shouldNotifyFormAttemptFailure(event: Record<string, any>): boolean {
    if (process.env.NODE_ENV !== 'production') return false;
    const eventType = `${event.eventType || event.event_type || ''}`;
    const statusCode = Number.parseInt(`${event.statusCode || event.status_code || ''}`, 10);
    return (
        /failed|exception|payload_too_large|too_large/i.test(eventType) ||
        statusCode >= 400
    );
}

function escapeEmailHtml(value: unknown): string {
    return `${value ?? ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formAttemptValue(event: Record<string, any>, camelKey: string, snakeKey: string = camelKey): any {
    return event[camelKey] ?? event[snakeKey] ?? '';
}

function sendFormAttemptFailureEmail(event: Record<string, any>): void {
    if (!shouldNotifyFormAttemptFailure(event)) return;
    if (!canSendAlertMail(alertMailDeps) || !FORM_ATTEMPT_ALERT_EMAIL) return;

    const attemptId = `${formAttemptValue(event, 'attemptId', 'attempt_id') || 'unknown'}`;
    const eventType = `${formAttemptValue(event, 'eventType', 'event_type') || 'form_attempt_failed'}`;
    const cooldownKey = `${attemptId}:${eventType}`;
    const lastSent = formAttemptEmailCooldowns.get(cooldownKey) || 0;
    if (Date.now() - lastSent < FORM_ATTEMPT_EMAIL_COOLDOWN_MS) return;
    formAttemptEmailCooldowns.set(cooldownKey, Date.now());

    const projectName = formAttemptValue(event, 'projectName', 'project_name') || 'Unknown project';
    const property = formAttemptValue(event, 'property') || 'Unknown property';
    const submitterEmail = formAttemptValue(event, 'submitterEmail', 'submitter_email') || 'Unknown submitter';
    const statusCode = formAttemptValue(event, 'statusCode', 'status_code') || '';
    const errorMessage = formAttemptValue(event, 'errorMessage', 'error_message') || '';
    const details = event.details || {};
    const subjectStatus = statusCode ? ` ${statusCode}` : '';
    const subject = `[Menu Manager] Form submit error${subjectStatus}: ${projectName}`;

    const rows = [
        ['Event', eventType],
        ['Attempt', attemptId],
        ['Submitter', submitterEmail],
        ['Property', property],
        ['Project', projectName],
        ['Mode', formAttemptValue(event, 'submissionMode', 'submission_mode')],
        ['Revision Source', formAttemptValue(event, 'revisionSource', 'revision_source')],
        ['Route', formAttemptValue(event, 'route')],
        ['Status', statusCode],
        ['Request Body Bytes', formAttemptValue(event, 'requestBodyLength', 'request_body_length')],
        ['Menu Text Length', formAttemptValue(event, 'menuTextLength', 'menu_text_length')],
        ['Menu HTML Length', formAttemptValue(event, 'menuHtmlLength', 'menu_html_length')],
        ['Persistent Diff HTML Length', formAttemptValue(event, 'persistentDiffHtmlLength', 'persistent_diff_html_length')],
        ['Critical Suggestions', formAttemptValue(event, 'criticalSuggestionsCount', 'critical_suggestions_count')],
    ];

    const htmlRows = rows
        .filter(([, value]) => value !== undefined && value !== null && `${value}` !== '')
        .map(([label, value]) => `<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold;width:190px">${escapeEmailHtml(label)}</td><td style="padding:6px 12px">${escapeEmailHtml(value)}</td></tr>`)
        .join('');

    const criticalSuggestions = formAttemptValue(event, 'criticalSuggestions', 'critical_suggestions');
    const criticalHtml = Array.isArray(criticalSuggestions) && criticalSuggestions.length
        ? `<h3>Critical Suggestions</h3><pre style="background:#f5f5f5;padding:12px;overflow:auto;font-size:12px">${escapeEmailHtml(JSON.stringify(criticalSuggestions, null, 2))}</pre>`
        : '';

    sendAlertMail({
        fromName: 'Menu Manager Alerts',
        to: FORM_ATTEMPT_ALERT_EMAIL,
        subject,
        html: `
            <div style="font-family:sans-serif;max-width:720px">
                <h2 style="color:#d32f2f;margin-bottom:4px">Production form submission error</h2>
                <p>A public form attempt failed before completion.</p>
                <table style="border-collapse:collapse;width:100%;margin:12px 0">${htmlRows}</table>
                ${errorMessage ? `<div style="background:#fff3e0;border-left:4px solid #e65100;padding:12px;margin:12px 0"><strong>Error:</strong><br>${escapeEmailHtml(errorMessage)}</div>` : ''}
                ${criticalHtml}
                <details style="margin:12px 0"><summary style="cursor:pointer;font-weight:bold">Details</summary><pre style="background:#f5f5f5;padding:12px;overflow:auto;font-size:12px">${escapeEmailHtml(JSON.stringify(details, null, 2))}</pre></details>
            </div>
        `,
    }, alertMailDeps).catch((err: any) => console.error('Failed to send form attempt alert email:', err.message));
}

const SUBMISSION_DOCX_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Email the submitter plus listed approvers one grouped copy of the submitted
 * menu document. Fire-and-forget — invoked after the submission record is
 * created, uses the same Graph/SMTP transport as admin alerts, and swallows all
 * errors so mail problems never affect the submission response.
 */
function sendSubmissionConfirmationEmails(input: SubmissionConfirmationInput): void {
    if (!canSendAlertMail(alertMailDeps)) {
        console.log(`Submission confirmation email skipped (no mail transport configured): ${input.submissionId}`);
        return;
    }

    const recipients = buildSubmissionConfirmationRecipients(input);
    if (!recipients.length) {
        console.log(`Submission confirmation email skipped (no valid recipients): ${input.submissionId}`);
        return;
    }

    void (async () => {
        let attachmentContent: Buffer | null = null;
        try {
            attachmentContent = await fs.readFile(input.docxPath);
        } catch (readError: any) {
            console.error(`Failed to read submitted docx for confirmation email (${input.submissionId}):`, readError.message);
        }
        const attachments = attachmentContent
            ? [{
                filename: input.filename || `${input.submissionId}.docx`,
                content: attachmentContent,
                contentType: SUBMISSION_DOCX_CONTENT_TYPE,
            }]
            : [];

        const [primaryRecipient, ...ccRecipients] = recipients;
        try {
            // sendAlertMail transparently strips an oversized attachment and
            // appends a notice, so a single send covers both cases.
            const result = await sendAlertMail({
                fromName: 'Menu Manager',
                to: primaryRecipient.email,
                cc: ccRecipients.map((recipient) => recipient.email),
                subject: buildSubmissionEmailSubject(input),
                html: buildSubmissionReceiptHtml(input, attachments.length === 0, DASHBOARD_URL),
                attachments,
            }, alertMailDeps);
            if (result.attachmentsDropped) {
                console.warn(`Submission confirmation attachment dropped (oversize) for ${input.submissionId}`);
            }
        } catch (mailError: any) {
            console.error(`Failed to send submission confirmation email (${input.submissionId}):`, mailError.message);
        }
    })();
}

function getRepoRoot(): string {
    const candidates = [
        path.resolve(__dirname, '..', '..'),      // ts-node from services/dashboard
        path.resolve(__dirname, '..', '..', '..') // compiled from services/dashboard/dist
    ];

    for (const candidate of candidates) {
        if (
            fsSync.existsSync(path.join(candidate, 'package.json')) &&
            fsSync.existsSync(path.join(candidate, 'services', 'dashboard')) &&
            fsSync.existsSync(path.join(candidate, 'services', 'docx-redliner'))
        ) {
            return candidate;
        }
    }

    return candidates[0];
}

function getDocxRedlinerDir(): string {
    return path.join(getRepoRoot(), 'services', 'docx-redliner');
}

function getDocumentStorageRoot(): string {
    return process.env.DOCUMENT_STORAGE_ROOT || path.join(getRepoRoot(), 'tmp', 'documents');
}

function getTrainingStorageRoot(): string {
    return path.join(getRepoRoot(), 'tmp', 'training');
}

function getTempUploadsDir(): string {
    return path.join(getRepoRoot(), 'tmp', 'uploads');
}

function getStoredPathCandidates(candidatePath: string): string[] {
    const trimmed = `${candidatePath || ''}`.trim();
    if (!trimmed) {
        return [];
    }

    const candidates = new Set<string>();
    const resolved = path.resolve(
        trimmed.startsWith('../')
            ? path.resolve(__dirname, trimmed)
            : trimmed
    );
    candidates.add(resolved);

    if (trimmed.startsWith('/app/tmp/')) {
        candidates.add(path.join(getRepoRoot(), 'tmp', trimmed.slice('/app/tmp/'.length)));
    }

    return Array.from(candidates);
}

function resolveDashboardStoredPath(candidatePath: string, label: string, allowedExtensions?: Set<string>): string {
    let lastError: Error | null = null;

    for (const candidate of getStoredPathCandidates(candidatePath)) {
        try {
            return resolveSafeStoredPath(
                candidate,
                label,
                [getDocumentStorageRoot(), path.join(getRepoRoot(), 'tmp')],
                allowedExtensions
            );
        } catch (error: any) {
            lastError = error;
        }
    }

    throw lastError || new Error(`${label} path is unavailable`);
}

type ExtractedProjectDetails = {
    projectName: string;
    property: string;
    outlet: string;
    hotel: string;
    city: string;
    orientation: string;
    dateNeeded: string;
    size: string;
};

const EMPTY_EXTRACTED_PROJECT: ExtractedProjectDetails = {
    projectName: '',
    property: '',
    outlet: '',
    hotel: '',
    city: '',
    orientation: '',
    dateNeeded: '',
    size: '',
};

// Menu footer helpers (normalizeMenuFooter, allergen legend parsing, raw-notice
// detection) moved to ./lib/menu-footer so the offline review pipeline shares them.

async function fetchAcceptedCorrectionRulesForPreAi(): Promise<AcceptedCorrectionRule[]> {
    if (!BASIC_AI_PRECHECK_ENABLED || !BASIC_AI_LEARNED_PRECHECK_ENABLED) {
        return [];
    }

    try {
        const response = await internalApi.get(
            `${DB_SERVICE_URL}/correction-rules?status=accepted&limit=500`,
            { timeout: BASIC_AI_LEARNED_RULE_FETCH_TIMEOUT_MS }
        );
        return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
        console.warn('Accepted correction rules unavailable for pre-AI deterministic checks:', error?.message || error);
        return [];
    }
}

function decodeHtmlText(html: string): string {
    return (html || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/<[^>]+>/g, ' ');
}

function stripManagedFooterFromHtml(html: string): string {
    if (!html) return html;
    const regex = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
    let match: RegExpExecArray | null;
    let stripped = '';
    let lastIndex = 0;
    while ((match = regex.exec(html)) !== null) {
        const text = normalizeWhitespace(decodeHtmlText(match[0]));
        const isPriceFooter = /^all\s+prices\b/i.test(text);
        const isWelcomeFooter = /^we\s+welcome\s+enquiries\b/i.test(text);
        if (
            isLikelyAllergenLegendLine(text) ||
            parseParenthesizedAllergenLegend(text) ||
            isLikelyAllergenLegendHeader(text) ||
            isPriceFooter ||
            isWelcomeFooter ||
            isLikelyRawNoticeLine(text)
        ) {
            stripped += html.substring(lastIndex, match.index);
            lastIndex = regex.lastIndex;
        }
    }
    return stripped ? `${stripped}${html.substring(lastIndex)}` : html;
}

function slugifyStorageSegment(value: string): string {
    const cleaned = (value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return cleaned || 'unknown';
}

function getSubmissionDocumentDir(projectName: string, property: string, submissionId: string): string {
    return path.join(
        getDocumentStorageRoot(),
        slugifyStorageSegment(property),
        slugifyStorageSegment(projectName),
        submissionId
    );
}

function coalesceString(...values: any[]): string {
    for (const value of values) {
        const normalized = `${value ?? ''}`.trim();
        if (normalized) return normalized;
    }
    return '';
}

function getSubmissionBoolean(submission: any, key: string, rawKey?: string): boolean {
    if (typeof submission?.[key] === 'boolean') return submission[key];
    const rawValue = submission?.raw_payload?.[rawKey || key];
    if (typeof rawValue === 'boolean') return rawValue;
    return `${rawValue || ''}`.toLowerCase() === 'true';
}

function escapeHtml(value: string): string {
    return `${value || ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function getPropertyCatalogFromDb(): Promise<PropertyCatalogRecord[]> {
    try {
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/properties`, { timeout: 3000 });
        const raw = Array.isArray(dbResponse?.data?.catalog) ? dbResponse.data.catalog : [];
        const catalog = raw
            .map((item: any) => normalizePropertyCatalogRecord(item))
            .filter((item: PropertyCatalogRecord) => !!item.name);
        if (catalog.length) return catalog;
        console.warn('DB property catalog was empty; using dashboard fallback catalog');
    } catch (error: any) {
        console.warn('Failed to load DB property catalog; using dashboard fallback catalog:', error?.message || error);
    }
    return buildFallbackPropertyCatalog();
}

function resolveCityCountryFromCatalog(property: string, catalog: PropertyCatalogRecord[]): string {
    const match = catalog.find((item) => item.name.toLowerCase() === property.toLowerCase());
    if (!match) return '';
    return match.city_country || '';
}

/**
 * Extract dishes from approved menu and store in database
 * Fails silently if Supabase is not configured
 */
async function extractDishesAfterApproval(
    submissionId: string,
    menuContent: string | undefined,
    property: string,
    finalPath: string,
    servicePeriod?: string
): Promise<void> {
    if (!isSupabaseConfigured()) {
        console.log('Supabase not configured - skipping dish extraction');
        return;
    }

    try {
        // If we don't have menu content, try to extract from the final document
        let content = menuContent;
        if (!content && finalPath) {
            try {
                const mammoth = require('mammoth');
                const result = await mammoth.extractRawText({ path: finalPath });
                content = result.value;
            } catch (err) {
                console.error('Failed to extract text from final document:', err);
                return;
            }
        }

        if (!content) {
            console.log('No menu content available for dish extraction');
            return;
        }

        const result = await extractAndStoreDishes(content, property, submissionId, {
            servicePeriod,
        });
        console.log(`Dish extraction complete: ${result.added} dishes added`);
    } catch (error) {
        console.error('Error extracting dishes:', error);
        // Don't throw - dish extraction is not critical to approval
    }
}

const app = express();
const port = Number(process.env.PORT) || 3005;

// Configure multer for file uploads
const upload = multer({
    dest: getTempUploadsDir(),
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: 4,
    },
});

// Serve static files and use EJS for templates
app.get('/js/diff-core.js', (_req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(getRepoRoot(), 'services', 'diff-core', 'src', 'index.js'));
});
app.use(express.static(path.join(__dirname, 'public')));
// Problem reports intentionally carry screenshot data + client state. Keep this
// path-specific parser before the dashboard-wide 5mb form body limit.
app.use('/api/form/error-report', express.json({ limit: ERROR_REPORT_JSON_BODY_LIMIT }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT }));
app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error?.type === 'entity.too.large') {
        const req = _req as express.Request;
        const isErrorReportRoute = (req.originalUrl || req.url || '').startsWith('/api/form/error-report');
        const configuredLimit = isErrorReportRoute ? ERROR_REPORT_JSON_BODY_LIMIT : JSON_BODY_LIMIT;
        const attemptEvent = {
            attemptId: req.get('x-menumanager-attempt-id'),
            eventType: 'payload_too_large',
            route: req.originalUrl || req.url,
            statusCode: 413,
            requestBodyLength: req.get('content-length'),
            submitterEmail: req.get('x-menumanager-submitter-email'),
            projectName: req.get('x-menumanager-project'),
            property: req.get('x-menumanager-property'),
            submissionMode: req.get('x-menumanager-submit-mode'),
            revisionSource: req.get('x-menumanager-revision-source'),
            details: {
                configuredLimit,
                contentLength: req.get('content-length') || null,
                method: req.method,
            },
            errorMessage: `Request body exceeded ${configuredLimit}`,
        };
        void logFormAttemptEvent(attemptEvent);
        sendFormAttemptFailureEmail(attemptEvent);
        sendAdminAlert({
            alert_type: 'form_payload_too_large',
            severity: 'warning',
            service: 'dashboard',
            message: `Form request body exceeded ${configuredLimit} on ${req.originalUrl || req.url}`,
            details: {
                attemptId: req.get('x-menumanager-attempt-id') || null,
                route: req.originalUrl || req.url,
                contentLength: req.get('content-length') || null,
                submitterEmail: req.get('x-menumanager-submitter-email') || null,
                projectName: req.get('x-menumanager-project') || null,
                property: req.get('x-menumanager-property') || null,
                submissionMode: req.get('x-menumanager-submit-mode') || null,
                revisionSource: req.get('x-menumanager-revision-source') || null,
                configuredLimit,
            },
        });
        return res.status(413).json({
            error: isErrorReportRoute
                ? `Problem report payload is too large. Email ${PUBLIC_FORM_SUPPORT_EMAIL} with screenshots if this keeps blocking you.`
                : `Submission payload is too large. Reduce pasted rich formatting or email ${PUBLIC_FORM_SUPPORT_EMAIL} if the menu content must exceed ${JSON_BODY_LIMIT}.`,
        });
    }
    if (error instanceof SyntaxError && 'body' in error) {
        return res.status(400).json({ error: 'Request body must be valid JSON' });
    }
    return next(error);
});
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

export async function extractBaselineFromDocx(filePath: string): Promise<{
    approvedMenuContent: string;
    approvedMenuContentRaw: string;
    approvedMenuContentHtml: string;
    extractedAllergenKey: string;
    containsRawNotice: boolean;
    extractedProject: ExtractedProjectDetails;
}> {
    const docxRedlinerDir = getDocxRedlinerDir();
    const venvPython = path.join(docxRedlinerDir, 'venv', 'bin', 'python');
    const extractCleanScript = path.join(docxRedlinerDir, 'extract_clean_menu_text.py');
    const extractDetailsScript = path.join(docxRedlinerDir, 'extract_project_details.py');

    let pythonCmd = 'python3';
    try {
        await fs.access(venvPython);
        pythonCmd = `"${venvPython}"`;
    } catch {
        // use system python
    }

    const cleanCommand = `${pythonCmd} "${extractCleanScript}" "${filePath}"`;
    const detailsCommand = `${pythonCmd} "${extractDetailsScript}" "${filePath}"`;

    const [{ stdout: cleanStdout }, detailsResult] = await Promise.all([
        execAsync(cleanCommand, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }),
        execAsync(detailsCommand, { timeout: 8000, maxBuffer: 2 * 1024 * 1024 })
            .then(({ stdout }) => ({ stdout }))
            .catch((error: any) => {
                console.warn('Project details extraction failed during baseline upload:', error?.stderr || error?.message || error);
                return { stdout: '{}' };
            }),
    ]);

    const cleanData = JSON.parse((cleanStdout || '{}').trim() || '{}');
    const detailsData = JSON.parse((detailsResult.stdout || '{}').trim() || '{}');

    if (cleanData.error) {
        throw new Error(cleanData.error);
    }

    const projectDetails = detailsData.project_details || {};
    const rawCleanedText = cleanData.cleaned_menu_content || cleanData.menu_content || '';
    const rawCleanedHtml = cleanData.cleaned_menu_html || '';
    const footer = normalizeMenuFooter(rawCleanedText, detailsData.allergen_key || '');
    const approvedMenuContent = [footer.body, footer.preservedFooterText].filter(Boolean).join('\n');
    return {
        approvedMenuContent,
        approvedMenuContentRaw: cleanData.menu_content || '',
        approvedMenuContentHtml: stripManagedFooterFromHtml(rawCleanedHtml),
        extractedAllergenKey: footer.normalizedAllergenLine || detailsData.allergen_key || '',
        containsRawNotice: footer.hadRawNotice,
        extractedProject: {
            projectName: projectDetails.project_name || '',
            property: projectDetails.property || '',
            outlet: projectDetails.outlet || '',
            hotel: projectDetails.hotel || '',
            city: projectDetails.city || '',
            orientation: projectDetails.orientation || '',
            dateNeeded: projectDetails.date_needed || '',
            size: projectDetails.size || '',
        },
    };
}

export async function extractUnapprovedFromDocx(filePath: string): Promise<{
    visibleText: string;
    cleanVisibleText: string;
    unapprovedHtml: string;
    annotations: Array<Array<{ start: number; end: number; type: string }>>;
    extractedAllergenKey: string;
    extractedProject: ExtractedProjectDetails;
}> {
    const docxRedlinerDir = getDocxRedlinerDir();
    const venvPython = path.join(docxRedlinerDir, 'venv', 'bin', 'python');
    const extractCleanScript = path.join(docxRedlinerDir, 'extract_clean_menu_text.py');
    const extractDetailsScript = path.join(docxRedlinerDir, 'extract_project_details.py');

    let pythonCmd = 'python3';
    try {
        await fs.access(venvPython);
        pythonCmd = `"${venvPython}"`;
    } catch {
        // use system python
    }

    const unapprovedCommand = `${pythonCmd} "${extractCleanScript}" "${filePath}" --mode unapproved`;
    const detailsCommand = `${pythonCmd} "${extractDetailsScript}" "${filePath}"`;

    const [{ stdout: unapprovedStdout }, detailsResult] = await Promise.all([
        execAsync(unapprovedCommand, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }),
        execAsync(detailsCommand, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 })
            .then(({ stdout }) => ({ stdout }))
            .catch((error: any) => {
                console.warn('Project details extraction failed during unapproved upload:', error?.stderr || error?.message || error);
                return { stdout: '{}' };
            }),
    ]);

    const unapprovedData = JSON.parse((unapprovedStdout || '{}').trim() || '{}');
    const detailsData = JSON.parse((detailsResult.stdout || '{}').trim() || '{}');

    if (unapprovedData.error) {
        throw new Error(unapprovedData.error);
    }

    const projectDetails = detailsData.project_details || {};
    return {
        visibleText: unapprovedData.visible_text || '',
        cleanVisibleText: unapprovedData.clean_visible_text || unapprovedData.visible_text || '',
        unapprovedHtml: unapprovedData.unapproved_html || '',
        annotations: unapprovedData.annotations || [],
        extractedAllergenKey: detailsData.allergen_key || '',
        extractedProject: {
            ...EMPTY_EXTRACTED_PROJECT,
            projectName: projectDetails.project_name || '',
            property: projectDetails.property || '',
            outlet: projectDetails.outlet || '',
            hotel: projectDetails.hotel || '',
            city: projectDetails.city || '',
            orientation: projectDetails.orientation || '',
            dateNeeded: projectDetails.date_needed || '',
            size: projectDetails.size || '',
        },
    };
}

type CleanDocxUploadMode = 'baseline' | 'new_menu';

async function handleCleanDocxMenuUpload(
    req: any,
    res: any,
    options: {
        mode: CleanDocxUploadMode;
        missingFileMessage: string;
        defaultFileName: string;
        errorMessage: string;
    }
) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: options.missingFileMessage });
        }

        if (!hasAllowedExtension(req.file.originalname || req.file.path, ALLOWED_DOCX_EXTENSIONS)) {
            return res.status(400).json({ error: 'Only .docx files are accepted' });
        }
        await assertUploadedFileType(req.file.path, ['docx']);

        const extracted = await extractBaselineFromDocx(req.file.path);
        const fileName = sanitizeStoredFileName(req.file.originalname, options.defaultFileName);
        const sharedPayload = {
            success: true,
            extractedAllergenKey: extracted.extractedAllergenKey,
            containsRawNotice: extracted.containsRawNotice,
            extractedProject: extracted.extractedProject,
        };

        if (options.mode === 'baseline') {
            return res.json({
                ...sharedPayload,
                baselineDocPath: req.file.path,
                baselineFileName: fileName,
                approvedMenuContent: extracted.approvedMenuContent,
                approvedMenuContentRaw: extracted.approvedMenuContentRaw,
                approvedMenuContentHtml: extracted.approvedMenuContentHtml,
            });
        }

        return res.json({
            ...sharedPayload,
            menuDocPath: req.file.path,
            menuDocFileName: fileName,
            menuContent: extracted.approvedMenuContent,
            menuContentRaw: extracted.approvedMenuContentRaw,
            menuContentHtml: extracted.approvedMenuContentHtml,
        });
    } catch (error: any) {
        console.error(options.errorMessage, error);
        res.status(isClientInputError(error) ? 400 : 500).json({
            error: options.errorMessage,
            details: error.message,
        });
    }
}

/**
 * Dashboard Home
 */
app.get('/', (_req, res) => {
    res.render('welcome', {
        title: 'Welcome - RSH Menu Manager'
    });
});

app.get('/dashboard', (_req, res) => {
    res.redirect('/');
});

app.get('/review-queue', (_req, res) => {
    res.redirect('/reviews');
});

/**
 * Direct Isabella review queue.
 */
app.get('/reviews', async (_req, res) => {
    try {
        const pendingResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/pending`, { timeout: 5000 });
        const reviews = Array.isArray(pendingResponse.data) ? pendingResponse.data : [];

        res.render('index', {
            title: 'Pending Reviews - RSH Menu Manager',
            reviews,
        });
    } catch (error: any) {
        console.error('Error loading review dashboard:', error.response?.data || error.message);
        res.status(500).render('error', {
            message: 'Failed to load pending reviews',
        });
    }
});

/**
 * Welcome / Landing Page - Magic link entry point
 */
app.get('/submit/:token', (req, res) => {
    res.render('welcome', {
        title: 'Welcome - RSH Menu Manager'
    });
});

/**
 * Form Submission Page - New menu submission via form
 */
async function renderSubmissionForm(res: any, view: 'form' | 'form-legacy', title: string) {
    const propertyCatalog = await getPropertyCatalogFromDb();
    const propertyOptions = propertyCatalog.map((item) => item.name);
    res.render(view, {
        title,
        defaultAllergenKey: DEFAULT_ALLERGEN_KEY,
        propertyOptions,
        propertyCatalog,
        supportEmail: PUBLIC_FORM_SUPPORT_EMAIL,
        errorReportMaxBodyBytes: ERROR_REPORT_CLIENT_MAX_BODY_BYTES,
    });
}

/**
 * `/form` is the canonical submission URL the dashboard links to. It serves
 * whichever flow is the current default, controlled by `NEW_SUBMISSION_FORM_DEFAULT`
 * (see the constant near the top of this file). It defaults to the proven legacy
 * flow so the new upload-first flow can be piloted at `/form-new` in production
 * before everyone is switched over — flip the flag to make `/form` serve the new
 * flow, and all existing dashboard links/bookmarks follow automatically.
 */
app.get('/form', async (_req, res) => {
    const view = NEW_SUBMISSION_FORM_DEFAULT ? 'form' : 'form-legacy';
    await renderSubmissionForm(res, view, 'Submit New Menu');
});

// New upload-first flow — stable URL for piloting (hand this link to testers)
// regardless of which flow `/form` currently serves.
app.get('/form-new', async (_req, res) => {
    await renderSubmissionForm(res, 'form', 'Submit New Menu');
});

// Legacy multi-section flow — always available at a stable URL.
app.get('/form-legacy', async (_req, res) => {
    await renderSubmissionForm(res, 'form-legacy', 'Submit New Menu (Legacy)');
});

/**
 * Design Approval Page - Compare DOCX against PDF
 */
app.get('/design-approval', (req, res) => {
    res.render('design-approval', {
        title: 'Design Approval'
    });
});

app.get('/approved-menus', async (req, res) => {
    try {
        const q = sanitizePlainTextInput(req.query.q, { maxLength: 120 }).trim();
        const approvedMenus = await listApprovedMenus(getRepoRoot(), q, 150);

        res.render('approved-menus', {
            title: 'Approved Menus',
            approvedMenus,
            searchQuery: q,
        });
    } catch (error: any) {
        console.error('Error loading approved menus:', error.response?.data || error.message);
        res.status(500).render('error', {
            message: 'Failed to load approved menus',
        });
    }
});

app.get('/approved-dishes', async (req, res) => {
    try {
        const q = sanitizePlainTextInput(req.query.q, { maxLength: 120 }).trim();
        const brandSummaries = await listApprovedDishBrands(getRepoRoot(), q);

        res.render('approved-dishes', {
            title: 'Approved Dishes',
            brandSummaries,
            selectedBrand: null,
            locationGroups: [],
            dishes: [],
            locationOptions: [],
            selectedLocation: '',
            searchQuery: q,
        });
    } catch (error: any) {
        console.error('Error loading approved dishes:', error.response?.data || error.message);
        res.status(500).render('error', {
            message: 'Failed to load approved dishes',
        });
    }
});

app.get('/approved-dishes/:brandSlug', async (req, res) => {
    try {
        const q = sanitizePlainTextInput(req.query.q, { maxLength: 120 }).trim();
        const location = sanitizePlainTextInput(req.query.location, { maxLength: 255 }).trim();
        const { brandSummaries, brandDetail } = await getApprovedDishBrowseData(
            getRepoRoot(),
            req.params.brandSlug,
            { query: q, location }
        );

        if (!brandDetail) {
            return res.status(404).render('error', {
                message: 'Approved dish brand not found',
            });
        }

        const visibleBrandSummaries = brandSummaries
            .slice()
            .sort((a, b) => {
                if (a.slug === brandDetail.summary.slug) return -1;
                if (b.slug === brandDetail.summary.slug) return 1;
                return a.brand.localeCompare(b.brand);
            });

        res.render('approved-dishes', {
            title: `${brandDetail.summary.brand} Approved Dishes`,
            brandSummaries: visibleBrandSummaries,
            selectedBrand: brandDetail.summary,
            locationGroups: brandDetail.locationGroups,
            dishes: brandDetail.dishes,
            locationOptions: brandDetail.summary.locations,
            selectedLocation: location,
            searchQuery: q,
        });
    } catch (error: any) {
        console.error('Error loading approved dishes:', error.response?.data || error.message);
        res.status(500).render('error', {
            message: 'Failed to load approved dishes',
        });
    }
});

/**
 * Review Detail Page - View specific submission
 */
app.get('/review/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        // Get submission details from DB
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${submissionId}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).render('error', { 
                message: 'Submission not found' 
        });
        }

        const reviewableStatuses = new Set(['pending_human_review', 'submitted_no_ai_review']);
        if (!reviewableStatuses.has(submission.status)) {
            return res.render('error', { 
                message: 'This submission has already been reviewed' 
        });
        }

        const clickupHandoff = normalizeRawPayload(submission.raw_payload).clickup_handoff || {};
        res.render('review', { 
            submission,
            clickupHandoff,
            title: `Review: ${submission.filename}` 
        });
    } catch (error) {
        console.error('Error loading review:', error);
        res.status(500).render('error', { 
            message: 'Failed to load review details' 
        });
    }
});

app.post('/api/submissions/:submissionId/retry-clickup', async (req, res) => {
    const { submissionId } = req.params;
    try {
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        if (`${submission.clickup_task_id || ''}`.trim()) {
            return res.status(409).json({
                error: 'Submission already has a ClickUp task',
                taskId: submission.clickup_task_id,
            });
        }

        let assets: any[] = [];
        try {
            const assetResponse = await internalApi.get(`${DB_SERVICE_URL}/assets/by-submission/${encodeURIComponent(submission.id || submissionId)}`);
            assets = Array.isArray(assetResponse.data) ? assetResponse.data : [];
        } catch (assetError: any) {
            console.warn('Retry ClickUp could not load submission assets:', assetError.response?.data || assetError.message);
        }

        const clickupPayload = buildClickUpTaskPayloadFromStoredSubmission(submission, assets);
        if (!clickupPayload.docxPath) {
            return res.status(400).json({ error: 'Submission does not have an original DOCX path to send to ClickUp' });
        }

        const rawPayload = normalizeRawPayload(submission.raw_payload);
        const previousHandoff = normalizeRawPayload(rawPayload.clickup_handoff);
        const retryCount = Number(previousHandoff.retry_count || 0) + 1;
        const attemptedAt = new Date().toISOString();
        const retryRawPayload = mergeClickUpHandoffMetadata(rawPayload, {
            status: 'retrying',
            retry_count: retryCount,
            last_attempt_at: attemptedAt,
            last_payload: clickupPayload,
            triggered_by: 'dashboard_retry',
        });

        await internalApi.put(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submission.id || submissionId)}`, {
            raw_payload: retryRawPayload,
        });

        try {
            const clickupResponse = await internalApi.post(`${CLICKUP_SERVICE_URL}/create-task`, clickupPayload);
            const clickupData = clickupResponse.data || {};
            const taskId = clickupData.taskId;
            const completedRawPayload = mergeClickUpHandoffMetadata(retryRawPayload, {
                status: clickupData.skipped ? 'skipped_not_configured' : (clickupData.warning || clickupData.attachmentUploadFailed ? 'task_created_with_warning' : 'task_created'),
                retry_count: retryCount,
                task_id: taskId,
                last_response: clickupData,
                last_attempt_at: attemptedAt,
                last_payload: clickupPayload,
                triggered_by: 'dashboard_retry',
            });

            await internalApi.put(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submission.id || submissionId)}`, {
                raw_payload: completedRawPayload,
                ...(taskId ? { clickup_task_id: taskId } : {}),
            });

            return res.json({
                success: true,
                taskId,
                warning: clickupData.warning,
                attachmentUploadFailed: clickupData.attachmentUploadFailed,
                skipped: clickupData.skipped,
            });
        } catch (clickupError: any) {
            const errorDetails = describeServiceError(clickupError);
            const failedRawPayload = mergeClickUpHandoffMetadata(retryRawPayload, {
                status: 'failed',
                retry_count: retryCount,
                last_error: errorDetails,
                last_attempt_at: attemptedAt,
                last_payload: clickupPayload,
                triggered_by: 'dashboard_retry',
                diagnosticReference: submission.id || submissionId,
            });

            await internalApi.put(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submission.id || submissionId)}`, {
                raw_payload: failedRawPayload,
            }).catch((metadataError: any) => {
                console.error('Failed to save ClickUp retry failure metadata:', metadataError.response?.data || metadataError.message);
            });

            sendAdminAlert({
                alert_type: 'clickup_task_retry_failed',
                severity: 'error',
                service: 'dashboard',
                submission_id: submission.id || submissionId,
                message: `ClickUp task retry failed for "${submission.project_name}" (${submission.property})`,
                details: {
                    error: errorDetails,
                    submitter: submission.submitter_email,
                    projectName: submission.project_name,
                    property: submission.property,
                    filename: submission.filename,
                    diagnosticReference: submission.id || submissionId,
                },
            });

            return res.status(502).json({
                error: 'ClickUp task retry failed',
                details: errorDetails,
            });
        }
    } catch (error: any) {
        console.error('Error retrying ClickUp task creation:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to retry ClickUp task creation', details: error.message });
    }
});

app.get('/approval/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).render('error', {
                message: 'Submission not found'
            });
        }

        const baseline = await loadApprovalBaselineFromSubmission(submission, {
            extractApprovedFromDocx: extractBaselineFromDocx,
            extractUnapprovedFromDocx,
            resolveStoredPath: (storedPath) => resolveDashboardStoredPath(storedPath, 'Stored approval source document', ALLOWED_DOCX_EXTENSIONS),
        });
        const approvalUrl = `${DASHBOARD_URL.replace(/\/+$/, '')}/approval/${submission.id || submissionId}`;
        res.render('approval-editor', {
            title: `Approval Editor: ${submission.project_name || submission.filename || submissionId}`,
            submission,
            editorHtml: baseline.editorHtml,
            visibleText: baseline.visibleText,
            previewText: baseline.previewText,
            previewAnnotations: baseline.previewAnnotations,
            previewAnnotationsJson: JSON.stringify(baseline.previewAnnotations || []),
            sourceMode: baseline.sourceMode,
            sourceLabel: baseline.sourceLabel,
            approvalUrl,
        });
    } catch (error: any) {
        console.error('Error loading approval editor:', error);
        res.status(500).render('error', {
            message: `Failed to load approval editor: ${error.message}`
        });
    }
});

/**
 * Download Original Submission
 */
app.get('/download/original/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${submissionId}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).send('File not found');
        }

        const sourceDoc = await resolveApprovalSourceDocument(submission, {
            resolveStoredPath: (storedPath) => resolveDashboardStoredPath(storedPath, 'Original submission', ALLOWED_DOCX_EXTENSIONS),
        });
        if (!sourceDoc) {
            return res.status(404).send('File not found');
        }

        console.log(`Downloading original from: ${sourceDoc.absolutePath}`);
        res.download(sourceDoc.absolutePath, sourceDoc.fileName || submission.filename || path.basename(sourceDoc.absolutePath));
    } catch (error) {
        console.error('Error downloading original:', error);
        res.status(500).send('Error downloading file');
    }
});

app.get('/download/approved/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const approvedMenu = await getApprovedMenuDownload(getRepoRoot(), submissionId);
        if (!approvedMenu) {
            return res.status(404).send('Approved file not found');
        }
        const candidatePaths = [approvedMenu.storagePath, approvedMenu.finalPath].filter(Boolean);
        let absolutePath = '';

        for (const candidatePath of candidatePaths) {
            try {
                const resolvedPath = resolveDashboardStoredPath(candidatePath, 'Approved submission', ALLOWED_DOCX_EXTENSIONS);
                await fs.access(resolvedPath);
                absolutePath = resolvedPath;
                break;
            } catch {
                // Try the next candidate path.
            }
        }

        if (!absolutePath) {
            return res.status(404).send('Approved file not found');
        }

        const downloadName = sanitizeStoredFileName(
            approvedMenu.approvedFileName || approvedMenu.filename || path.basename(absolutePath),
            'approved-menu.docx'
        );

        console.log(`Downloading approved file from: ${absolutePath}`);
        res.download(absolutePath, downloadName);
    } catch (error) {
        console.error('Error downloading approved file:', error);
        res.status(500).send('Error downloading file');
    }
});

const submissionWorkflowHandlers = createSubmissionWorkflowHandlers({
    axios: internalApi,
    fs,
    DB_SERVICE_URL,
    AI_REVIEW_URL,
    CLICKUP_SERVICE_URL,
    DEFAULT_ALLERGEN_KEY,
    PUBLIC_FORM_SUPPORT_EMAIL,
    AI_REVIEW_SUBMIT_TIMEOUT_MS,
    CLICKUP_TASK_CREATE_TIMEOUT_MS,
    getTempUploadsDir,
    getSubmissionDocumentDir,
    getPropertyCatalogFromDb,
    resolveCityCountryFromCatalog,
    normalizeMenuFooter,
    stripManagedFooterFromHtml,
    detectRawUndercookedContent,
    generateDocxFromForm,
    sendAdminAlert,
    sendSubmissionConfirmationEmails,
    isClientInputError,
    linkBasicAiCheckAuditsToSubmission,
});

const approvalWorkflowHandlers = createApprovalWorkflowHandlers({
    axios: internalApi,
    fs,
    pathModule: path,
    DB_SERVICE_URL,
    DIFFER_SERVICE_URL,
    CLICKUP_SERVICE_URL,
    CLICKUP_APPROVAL_FINALIZE_TIMEOUT_MS,
    DEFAULT_ALLERGEN_KEY,
    getSubmissionDocumentDir,
    extractDishesAfterApproval,
    coalesceString,
    normalizeMenuFooter,
    stripManagedFooterText,
    stripManagedFooterFromHtml,
    normalizeAllergenLegend,
    detectRawUndercookedContent,
    textToParagraphHtml,
    generateDocxFromForm,
});

const designApprovalWorkflowHandlers = createDesignApprovalWorkflowHandlers({
    axios: internalApi,
    fs,
    pathModule: path,
    execAsync,
    DB_SERVICE_URL,
    getDocxRedlinerDir,
    resolveStoredPath: resolveDashboardStoredPath,
    compareMenuTexts,
    extractDishesAfterApproval,
    isClientInputError,
});

/**
 * Quick Approve - AI draft is perfect, no changes needed
 */
app.post('/approve/:submissionId', approvalWorkflowHandlers.quickApprove);

/**
 * Upload Corrected Version - Reviewer made additional corrections
 */
app.post('/upload/:submissionId', upload.single('finalDocument') as any, approvalWorkflowHandlers.uploadCorrectedVersion);

/**
 * API endpoint to get submission status (for AJAX polling)
 */
app.get('/api/submission/:submissionId/status', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${submissionId}`);
        res.json(dbResponse.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get status' });
    }
});

/**
 * Training Dashboard - Manage training data and sessions
 */
app.get('/training', async (req, res) => {
    try {
        // Read training sessions from tmp/training directory
        const trainingDir = getTrainingStorageRoot();
        await fs.mkdir(trainingDir, { recursive: true });

        const files = await fs.readdir(trainingDir);
        const sessionFiles = files.filter(f => f.startsWith('session_') && f.endsWith('.json'));

        const sessions = await Promise.all(
            sessionFiles.map(async (file) => {
                const content = await fs.readFile(path.join(trainingDir, file), 'utf-8');
                return JSON.parse(content);
        })
        );

        // Sort by session ID (timestamp) descending
        sessions.sort((a, b) => b.session_id.localeCompare(a.session_id));

        res.render('training', {
            title: 'Training Dashboard',
            sessions: sessions
        });
    } catch (error) {
        console.error('Error loading training dashboard:', error);
        res.status(500).render('error', {
            message: 'Failed to load training dashboard'
        });
    }
});

/**
 * Upload Training Pair - Add new document pair for training
 */
app.post('/training/upload-pair', upload.fields([
    { name: 'original', maxCount: 1 },
    { name: 'redlined', maxCount: 1 }
]) as any, async (req, res) => {
    try {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        
        if (!files.original || !files.redlined) {
            return res.status(400).json({ 
                error: 'Both original and redlined documents are required' 
        });
        }

        const originalFile = files.original[0];
        const redlinedFile = files.redlined[0];
        await assertUploadedFileType(originalFile.path, ['docx']);
        await assertUploadedFileType(redlinedFile.path, ['docx']);

        // Create pairs directory if it doesn't exist
        const pairsDir = path.join(getTrainingStorageRoot(), 'pairs');
        await fs.mkdir(pairsDir, { recursive: true });

        // Generate pair name
        const timestamp = Date.now();
        const pairName = sanitizeStoredFileName(req.body.pairName || `pair_${timestamp}`, `pair_${timestamp}`);

        // Move files to pairs directory with standard naming
        const originalDest = path.join(pairsDir, `${pairName}_original.docx`);
        const redlinedDest = path.join(pairsDir, `${pairName}_redlined.docx`);

        await fs.rename(originalFile.path, originalDest);
        await fs.rename(redlinedFile.path, redlinedDest);

        console.log(`Training pair added: ${pairName}`);

        res.json({
            success: true,
            message: 'Training pair uploaded successfully',
            pairName: pairName
        });

    } catch (error) {
        console.error('Error uploading training pair:', error);
        res.status(500).json({ error: 'Failed to upload training pair' });
    }
});

/**
 * Get Training Session Details
 */
app.get('/training/session/:sessionId', async (req, res) => {
    try {
        const sessionId = sanitizePlainTextInput(req.params.sessionId, { maxLength: 64 });
        if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
            return res.status(400).json({ error: 'Invalid session ID' });
        }
        const trainingDir = getTrainingStorageRoot();
        const sessionFile = path.join(trainingDir, `session_${sessionId}.json`);

        const content = await fs.readFile(sessionFile, 'utf-8');
        const session = JSON.parse(content);

        res.json(session);
    } catch (error) {
        console.error('Error loading session:', error);
        res.status(404).json({ error: 'Session not found' });
    }
});

/**
 * Download Training Rules
 */
app.get('/training/download-rules/:sessionId', async (req, res) => {
    try {
        const sessionId = sanitizePlainTextInput(req.params.sessionId, { maxLength: 64 });
        if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
            return res.status(400).send('Invalid session ID');
        }
        const trainingDir = getTrainingStorageRoot();
        const rulesFile = path.join(trainingDir, `learned_rules_${sessionId}.json`);

        res.download(rulesFile, `learned_rules_${sessionId}.json`);
    } catch (error) {
        console.error('Error downloading rules:', error);
        res.status(404).send('Rules file not found');
    }
});

/**
 * Download Optimized Prompt
 */
app.get('/training/download-prompt/:sessionId', async (req, res) => {
    try {
        const sessionId = sanitizePlainTextInput(req.params.sessionId, { maxLength: 64 });
        if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
            return res.status(400).send('Invalid session ID');
        }
        const trainingDir = getTrainingStorageRoot();
        const promptFile = path.join(trainingDir, `optimized_prompt_${sessionId}.txt`);

        res.download(promptFile, `optimized_prompt_${sessionId}.txt`);
    } catch (error) {
        console.error('Error downloading prompt:', error);
        res.status(404).send('Prompt file not found');
    }
});

/**
 * Learning Rules Dashboard
 */
function normalizeCorrectionRuleKeyPart(value: any): string {
    return `${value || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function correctionRulePairKey(original: any, corrected: any): string {
    return `${normalizeCorrectionRuleKeyPart(original)}=>${normalizeCorrectionRuleKeyPart(corrected)}`;
}

function isAcceptedRulePreAiEligible(rule: any): boolean {
    return getAcceptedCorrectionRulePreAiEligibility(rule).eligible;
}

function describeAcceptedRulePreAiStatus(rule: any): string {
    const original = `${rule.original_text || ''}`.trim();
    const corrected = `${rule.corrected_text || ''}`.trim();
    if (!original && !corrected) {
        return 'Manual guidance';
    }

    const eligibility = getAcceptedCorrectionRulePreAiEligibility(rule);
    if (!eligibility.eligible) {
        if (eligibility.reason === 'context_dependent') {
            return 'Context guidance only';
        }
        return 'Manual review only';
    }

    const ruleText = `${rule.rule || ''}`.toLowerCase();
    const originalLower = original.toLowerCase();
    const correctedLower = corrected.toLowerCase();
    if (
        ruleText.includes('veggies')
        || (originalLower.includes('veggies') && correctedLower.includes('vegetables'))
        || ruleText.includes('tres leches')
        || originalLower.includes('tres leches')
        || ruleText.includes('poached egg')
        || ruleText.includes('sunny side')
        || originalLower.includes('poached egg')
        || originalLower.includes('sunny side')
    ) {
        return 'Active code guard';
    }

    return 'Active exact rule';
}

function describeAcceptedRuleImplementation(rule: any): { status: string; detail: string } {
    const original = `${rule.original_text || ''}`.trim();
    const corrected = `${rule.corrected_text || ''}`.trim();
    const preAiStatus = describeAcceptedRulePreAiStatus(rule);
    const eligibility = getAcceptedCorrectionRulePreAiEligibility(rule);

    if (preAiStatus === 'Active exact rule') {
        return {
            status: 'Active exact replacement',
            detail: `Pre-AI replaces the exact phrase "${original}" with "${corrected}" when menu and property scope match.`,
        };
    }

    if (preAiStatus === 'Active code guard') {
        const haystack = `${rule.rule || ''} ${original} ${corrected}`.toLowerCase();
        let detail = 'Covered by a curated Pre-AI code guard; the accepted explanation is evidence, but code applies bounded logic instead of this row as a blind replacement.';
        if (haystack.includes('tres leches')) {
            detail = 'Pre-AI ensures Tres Leches rows include vegetarian code V while preserving existing allergen codes and price.';
        } else if (haystack.includes('veggies')) {
            detail = 'Pre-AI changes veggies to vegetables in safe contexts while avoiding protected phrases like veggie burger.';
        } else if (haystack.includes('poached egg')) {
            detail = 'Pre-AI adds or normalizes raw-marker asterisks for poached egg dishes when the line has dish context.';
        } else if (haystack.includes('sunny side')) {
            detail = 'Pre-AI adds or normalizes raw-marker asterisks for sunny-side-up egg dishes when the line has dish context.';
        }
        return { status: preAiStatus, detail };
    }

    if (preAiStatus === 'Context guidance only') {
        return {
            status: preAiStatus,
            detail: `Not automated as a blind replacement because ${eligibility.contextTerm || 'this term'} depends on usage; keep it as reviewer/prompt guidance.`,
        };
    }

    if (preAiStatus === 'Manual guidance') {
        return {
            status: preAiStatus,
            detail: 'No exact before/after replacement was supplied; this remains reviewer guidance and prompt-proposal material.',
        };
    }

    const reasonText = eligibility.reason.replace(/_/g, ' ');
    return {
        status: preAiStatus,
        detail: `Accepted explanation is not active in Pre-AI because it is ${reasonText}; use it for human review or prompt work.`,
    };
}

function describeDetectedPatternImplementation(pattern: any, correctionRules: any[]): { status: string; detail: string } {
    const source = `${pattern.source || ''}`.trim();
    const target = `${pattern.target || ''}`.trim();
    const pairKey = correctionRulePairKey(source, target);

    const builtInReplacement = BUILT_IN_REPLACEMENTS.find((replacement) =>
        correctionRulePairKey(replacement.from, replacement.to) === pairKey
    );
    if (builtInReplacement) {
        return {
            status: 'Covered by built-in Pre-AI',
            detail: `Pre-AI already replaces the exact phrase "${builtInReplacement.from}" with "${builtInReplacement.to}".`,
        };
    }

    const matchingRules = correctionRules.filter((rule: any) =>
        correctionRulePairKey(rule.original_text, rule.corrected_text) === pairKey
    );
    const acceptedMatch = matchingRules.find((rule: any) => rule.status === 'accepted');
    if (acceptedMatch) {
        return describeAcceptedRuleImplementation(acceptedMatch);
    }

    const pendingMatch = matchingRules.find((rule: any) => rule.status === 'pending');
    if (pendingMatch) {
        return {
            status: 'Pending review',
            detail: 'A matching correction-rule proposal exists, but it is not active until a reviewer accepts it.',
        };
    }

    const rejectedMatch = matchingRules.find((rule: any) => rule.status === 'rejected');
    if (rejectedMatch) {
        return {
            status: 'Rejected',
            detail: 'A matching correction-rule proposal was rejected; no Pre-AI adjustment is active for this pattern.',
        };
    }

    const eligibility = getAcceptedCorrectionRulePreAiEligibility({
        status: 'accepted',
        original_text: source,
        corrected_text: target,
        change_type: pattern.kind,
    });
    if (eligibility.reason === 'context_dependent') {
        return {
            status: 'Context guidance only',
            detail: `No blind replacement is active because ${eligibility.contextTerm || 'this term'} depends on usage; handle through reviewer judgment or prompt guidance.`,
        };
    }

    return {
        status: 'No implementation yet',
        detail: 'Auto-scanned evidence only; no matching built-in Pre-AI rule or accepted correction-rule implementation was found.',
    };
}

app.get('/learning', async (_req, res) => {
    try {
        const [rulesResult, trainingResult, submissionsResult, correctionRulesResult, propertiesResult] = await Promise.all([
            internalApi.get(`${DIFFER_SERVICE_URL}/learning/rules`, { timeout: 2500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: {}, error: e?.message || 'request failed' })),
            internalApi.get(`${DIFFER_SERVICE_URL}/training-data`, { timeout: 2500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: { count: 0, data: [] }, error: e?.message || 'request failed' })),
            internalApi.get(`${DIFFER_SERVICE_URL}/learning/submissions`, { timeout: 2500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: { submissions: [] }, error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/correction-rules`, { timeout: 2500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: [], error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/properties`, { timeout: 2500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: { properties: [] }, error: e?.message || 'request failed' })),
        ]);

        const rulesData = (rulesResult as any).data || {};
        const trainingData = (trainingResult as any).data || { count: 0, data: [] };
        const learningSubmissions = (submissionsResult as any).data?.submissions || [];
        const correctionRules: any[] = (correctionRulesResult as any).data || [];
        const propertyOptions: string[] = (propertiesResult as any).data?.properties || [];

        // v2: detected patterns from differ (read-only reference, not auto-injected)
        const detectedPatternStatusLabel = (category: string) => {
            if (category === 'active') return 'Candidate';
            if (category === 'weak') return 'Below threshold';
            if (category === 'conflicted') return 'Conflicted';
            return category;
        };
        const decorate = (category: string, items: any[]) =>
            (items || []).map((r: any) => ({
                ...r,
                key: `${r.source_norm}=>${r.target_norm}`,
                category,
                status_label: detectedPatternStatusLabel(category),
            }));

        const rawDetectedPatterns = [
            ...decorate('active', rulesData.active_rules || []),
            ...decorate('weak', rulesData.weak_rules || []),
            ...decorate('conflicted', rulesData.conflicted_rules || []),
        ];
        const activeDetectedPatternKeys = new Set(
            (rulesData.active_rules || []).map((rule: any) => correctionRulePairKey(rule.source, rule.target))
        );
        const learningSubmissionMetadata = new Map<string, any | null>();
        const fetchLearningSubmissionMetadata = async (submissionId: string) => {
            if (!learningSubmissionMetadata.has(submissionId)) {
                try {
                    const response = await internalApi.get(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`, { timeout: 1500 });
                    learningSubmissionMetadata.set(submissionId, response.data || null);
                } catch {
                    learningSubmissionMetadata.set(submissionId, null);
                }
            }
            return learningSubmissionMetadata.get(submissionId);
        };
        const recentSubmissions = await decorateLearningSubmissionsWithMenuNames(
            (trainingData.data || []).slice(-25).reverse(),
            fetchLearningSubmissionMetadata
        );
        const decoratedLearningSubmissions = await decorateLearningSubmissionsWithMenuNames(
            learningSubmissions,
            fetchLearningSubmissionMetadata
        );

        // Split correction rules by status for the dashboard
        const allPendingRules = listActionablePendingCorrectionRules(correctionRules);
        const canValidateSystemProposalEvidence = !!(rulesResult as any).ok;
        const ignoredSystemPendingRules = allPendingRules.filter((rule: any) =>
            rule.source === 'system'
            && canValidateSystemProposalEvidence
            && !activeDetectedPatternKeys.has(correctionRulePairKey(rule.original_text, rule.corrected_text))
        );
        const ignoredSystemPendingRuleIds = new Set(ignoredSystemPendingRules.map((rule: any) => rule.id));
        const pendingRules = allPendingRules.filter((rule: any) => !ignoredSystemPendingRuleIds.has(rule.id));
        const acceptedRules = correctionRules
            .filter((r: any) => r.status === 'accepted')
            .map((rule: any) => {
                const implementation = describeAcceptedRuleImplementation(rule);
                return {
                    ...rule,
                    pre_ai_status: implementation.status,
                    pre_ai_active: isAcceptedRulePreAiEligible(rule),
                    implementation_status: implementation.status,
                    implementation_detail: implementation.detail,
                };
            });
        const activeExactRules = acceptedRules.filter((rule: any) => rule.implementation_status === 'Active exact replacement');
        const manualGuidanceRules = acceptedRules.filter((rule: any) => rule.pre_ai_status === 'Manual guidance');
        const detectedPatterns = rawDetectedPatterns.map((pattern: any) => {
            const implementation = describeDetectedPatternImplementation(pattern, correctionRules);
            return {
                ...pattern,
                implementation_status: implementation.status,
                implementation_detail: implementation.detail,
            };
        });
        const curatedActiveRules = [
            {
                label: 'veggies -> vegetables',
                detail: 'Accepted human guidance, except veggie burger wording.',
                source: 'human',
                status: 'Active code guard',
                evidenceCount: acceptedRules.filter((rule: any) =>
                    `${rule.rule || ''} ${rule.original_text || ''} ${rule.corrected_text || ''}`.toLowerCase().includes('veggies')
                ).length,
            },
            {
                label: 'Tres Leches -> add V',
                detail: 'Accepted human guidance that Tres Leches needs vegetarian code V.',
                source: 'human',
                status: 'Active code guard',
                evidenceCount: acceptedRules.filter((rule: any) =>
                    `${rule.rule || ''} ${rule.original_text || ''}`.toLowerCase().includes('tres leches')
                ).length,
            },
            {
                label: 'poached egg -> raw marker',
                detail: 'Accepted human guidance for poached egg asterisks.',
                source: 'human',
                status: 'Active code guard',
                evidenceCount: acceptedRules.filter((rule: any) =>
                    `${rule.rule || ''} ${rule.original_text || ''}`.toLowerCase().includes('poached egg')
                ).length,
            },
            {
                label: 'sunny-side-up egg -> raw marker',
                detail: 'Accepted human guidance for sunny-side-up egg asterisks.',
                source: 'human',
                status: 'Active code guard',
                evidenceCount: acceptedRules.filter((rule: any) =>
                    `${rule.rule || ''} ${rule.original_text || ''}`.toLowerCase().includes('sunny side')
                ).length,
            },
        ];

        const differStatus = {
            rulesOk: !!(rulesResult as any).ok,
            trainingOk: !!(trainingResult as any).ok,
            submissionsOk: !!(submissionsResult as any).ok,
            rulesError: (rulesResult as any).error || '',
            trainingError: (trainingResult as any).error || '',
            submissionsError: (submissionsResult as any).error || '',
        };

        res.render('learning', {
            title: 'Learning Rules',
            generatedAt: rulesData.generated_at || null,
            minOccurrences: rulesData.min_occurrences || 2,
            totalEntries: rulesData.total_entries_analyzed || 0,
            totalRules: rulesData.total_rules || 0,
            detectedPatterns,
            pendingRules,
            ignoredSystemPendingRules,
            acceptedRules,
            activeExactRules,
            manualGuidanceRules,
            curatedActiveRules,
            recentSubmissions,
            learningSubmissions: decoratedLearningSubmissions,
            propertyOptions,
            differStatus,
            learningDashboardTimeZone: LEARNING_DASHBOARD_TIME_ZONE,
        });
    } catch (error: any) {
        console.error('Error loading learning dashboard:', error.message);
        res.status(500).render('error', {
            message: 'Failed to load learning dashboard'
        });
    }
});

app.get('/learning/submission/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const [learningDetailResult, submissionResult, correctionRulesResult, propertiesResult] = await Promise.all([
            internalApi.get(`${DIFFER_SERVICE_URL}/learning/submissions/${encodeURIComponent(submissionId)}`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: null, error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: null, error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/correction-rules?submission_id=${encodeURIComponent(submissionId)}`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: [], error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/properties`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: { properties: [] }, error: e?.message || 'request failed' })),
        ]);

        if (!(learningDetailResult as any).ok || !(learningDetailResult as any).data) {
            return res.status(404).render('error', { message: 'Learning details not found for this submission' });
        }

        const learningDetail = (learningDetailResult as any).data;
        const submissionMeta = (submissionResult as any).data || {};
        const savedCorrectionRules: any[] = (correctionRulesResult as any).data || [];
        const locationOptions: string[] = (propertiesResult as any).data?.properties || [];

        res.render('learning-submission', {
            title: `Learning Review: ${submissionId}`,
            submissionId,
            learningDetail,
            submissionMeta,
            savedCorrectionRules,
            locationOptions,
        });
    } catch (error: any) {
        console.error('Error loading learning submission detail page:', error.message);
        res.status(500).render('error', {
            message: 'Failed to load learning submission details'
        });
    }
});

/**
 * Correction rules: create (human-annotated or accept system proposal)
 */
app.post('/api/learning/correction-rules', async (req, res) => {
    try {
        const payload = req.body || {};
        const catalog = await getPropertyCatalogFromDb();
        const record = buildCorrectionRuleRecord(payload, catalog);

        const response = await internalApi.post(`${DB_SERVICE_URL}/correction-rules`, record, { timeout: 3000 });
        res.json(response.data);
    } catch (error: any) {
        if (isCorrectionRuleValidationError(error)) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        console.error('Error saving correction rule:', error.message);
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to save correction rule' });
    }
});

// On-demand trigger for the improvement cycle. The daily cron is the primary
// driver, but saved corrections are now proposals (born pending) that only go
// live once the cycle routes them and a reviewer approves — so a reviewer needs
// a way to generate that proposal immediately instead of waiting for the
// overnight run. Spawns the same script the cron runs, detached, with --force so
// it bypasses the daily gate (the script self-suffixes the cycle id when today
// already has a proposal). The script's own lock file prevents overlap.
app.post('/api/learning/run-improvement-cycle', async (_req, res) => {
    try {
        const repoRoot = getRepoRoot();
        const scriptPath = path.join(repoRoot, 'scripts', 'improvement-cycle.js');
        if (!fsSync.existsSync(scriptPath)) {
            return res.status(500).json({ error: 'improvement-cycle.js was not found on this host.' });
        }

        // Respect the script's lock so the button can't stack runs on top of an
        // in-flight cron run (lock is considered stale after 6h, matching acquireLock).
        const lockPath = path.join(repoRoot, 'tmp', 'improvement-cycle', '.lock');
        if (fsSync.existsSync(lockPath)) {
            try {
                const lock = JSON.parse(fsSync.readFileSync(lockPath, 'utf8'));
                const ageMs = Date.now() - Date.parse(lock.acquiredAt || 0);
                if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 6 * 60 * 60 * 1000) {
                    return res.status(409).json({ error: 'An improvement cycle is already running. Try again once it finishes.' });
                }
            } catch {
                // Unreadable lock — let the script's own staleness logic take over.
            }
        }

        const logDir = path.join(repoRoot, 'logs');
        await fs.mkdir(logDir, { recursive: true }).catch(() => {});
        const out = fsSync.openSync(path.join(logDir, 'improvement-cycle.log'), 'a');
        const child = spawn(process.execPath, [scriptPath, '--force'], {
            cwd: repoRoot,
            detached: true,
            stdio: ['ignore', out, out],
            env: process.env,
        });
        child.on('error', (err) => console.error('On-demand improvement cycle failed to spawn:', err.message));
        child.unref();
        console.log(`On-demand improvement cycle started (pid ${child.pid ?? 'unknown'}).`);

        res.json({
            started: true,
            message: 'Improvement cycle started. It runs the LLM and an eval pass, so give it a few minutes — the proposal will appear here and an email goes out when it is ready.',
        });
    } catch (error: any) {
        console.error('Failed to start on-demand improvement cycle:', error.message);
        res.status(500).json({ error: error.message || 'Failed to start improvement cycle' });
    }
});

function firstLearningQueryValue(value: any): string {
    if (Array.isArray(value)) {
        return `${value[0] || ''}`;
    }
    return `${value || ''}`;
}

function parseLearningSubmissionIds(value: any): string[] {
    const rawValues = Array.isArray(value) ? value : [value];
    const ids = rawValues
        .flatMap((item) => `${item || ''}`.split(','))
        .map((item) => item.trim())
        .filter((item) => item && /^[A-Za-z0-9_-]+$/.test(item));

    return Array.from(new Set(ids));
}

/**
 * Correction rule evidence examples: proxy differ before/after snippets and
 * enrich them with submission display metadata for the learning dashboard.
 */
app.get('/api/learning/rule-examples', async (req, res) => {
    try {
        const originalText = sanitizePlainTextInput(firstLearningQueryValue(req.query.original_text || req.query.from), { maxLength: 200 });
        const correctedText = sanitizePlainTextInput(firstLearningQueryValue(req.query.corrected_text || req.query.to), { maxLength: 200 });
        const submissionIds = parseLearningSubmissionIds(req.query.submission_ids || req.query.submission_id);
        const limitRaw = Number.parseInt(firstLearningQueryValue(req.query.limit), 10);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 20) : 8;

        if (!originalText || !correctedText) {
            return res.status(400).json({ error: 'original_text and corrected_text are required' });
        }

        const response = await internalApi.get(`${DIFFER_SERVICE_URL}/learning/rule-examples`, {
            timeout: 6000,
            params: {
                original_text: originalText,
                corrected_text: correctedText,
                submission_ids: submissionIds.join(','),
                limit,
            },
        });

        const metadataBySubmissionId = new Map<string, any | null>();
        const fetchSubmissionMetadata = async (submissionId: string) => {
            if (metadataBySubmissionId.has(submissionId)) {
                return metadataBySubmissionId.get(submissionId);
            }
            try {
                const metaResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`, { timeout: 1500 });
                const metadata = metaResponse.data || null;
                metadataBySubmissionId.set(submissionId, metadata);
                return metadata;
            } catch {
                metadataBySubmissionId.set(submissionId, null);
                return null;
            }
        };
        const decoratedExamples = await decorateLearningSubmissionsWithMenuNames(
            response.data?.examples || [],
            fetchSubmissionMetadata
        );
        const examples = decoratedExamples.map((example: any) => {
            const metadata = metadataBySubmissionId.get(`${example.submission_id || ''}`) || {};
            return {
                ...example,
                submission_status: metadata.status || '',
                submission_changes_made: metadata.changes_made,
                submission_reviewed_at: metadata.reviewed_at || '',
                approved_text_extracted_at: metadata.approved_text_extracted_at || '',
            };
        });

        res.json({
            ...(response.data || {}),
            examples,
        });
    } catch (error: any) {
        console.error('Error loading correction rule examples:', error.message);
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to load correction rule examples' });
    }
});

/**
 * Correction rules: update status (accept/reject/modify)
 */
app.put('/api/learning/correction-rules/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const response = await internalApi.put(`${DB_SERVICE_URL}/correction-rules/${encodeURIComponent(id)}`, req.body || {}, { timeout: 3000 });
        res.json(response.data);
    } catch (error: any) {
        console.error('Error updating correction rule:', error.message);
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to update correction rule' });
    }
});

/**
 * Learning submissions: delete one differ training entry and its comparison detail.
 */
app.delete('/api/learning/submissions/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const response = await internalApi.delete(`${DIFFER_SERVICE_URL}/learning/submissions/${encodeURIComponent(submissionId)}`, { timeout: 3500 });
        res.json(response.data);
    } catch (error: any) {
        console.error('Error deleting learning submission:', error.message);
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to delete learning submission' });
    }
});

/**
 * Prompt Proposal review page
 */
app.get('/learning/prompt-proposal', async (_req, res) => {
    try {
        const [proposalResult, historyResult] = await Promise.all([
            internalApi.get(`${DB_SERVICE_URL}/prompt-proposals/latest`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: null, error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/prompt-proposals`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: [], error: e?.message || 'request failed' })),
        ]);

        const proposal = (proposalResult as any).data;
        const history: any[] = (historyResult as any).data || [];

        res.render('prompt-proposal', {
            title: 'Prompt Proposal Review',
            proposal,
            history,
        });
    } catch (error: any) {
        console.error('Error loading prompt proposal page:', error.message);
        res.status(500).render('error', { message: 'Failed to load prompt proposal page' });
    }
});

// Files approved code recommendations as GitHub issues. Best-effort: requires
// GITHUB_TOKEN (a PAT with issues:write on GITHUB_REPO); skips with a log when
// unconfigured so approval never blocks on GitHub availability.
async function createCodeRecommendationIssues(
    recommendations: any[],
    proposal: { id: string; cycle_id?: string }
): Promise<Array<{ title: string; ok: boolean; url?: string; error?: string }>> {
    if (!recommendations.length) return [];
    const token = `${process.env.GITHUB_TOKEN || ''}`.trim();
    const repo = `${process.env.GITHUB_REPO || 'dcowser3/MenuManager'}`.trim();
    if (!token) {
        console.log(`GITHUB_TOKEN not configured; skipped filing ${recommendations.length} code recommendation issue(s).`);
        return recommendations.map((rec) => ({ title: rec.title, ok: false, error: 'GITHUB_TOKEN not configured' }));
    }

    const results: Array<{ title: string; ok: boolean; url?: string; error?: string }> = [];
    for (const recommendation of recommendations) {
        try {
            const issue = buildCodeRecommendationIssue(recommendation, proposal, resolveDashboardPublicUrl(process.env));
            const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(issue),
            });
            if (!response.ok) {
                throw new Error(`GitHub ${response.status}: ${(await response.text()).slice(0, 200)}`);
            }
            const created: any = await response.json();
            console.log(`Filed code recommendation issue: ${created.html_url}`);
            results.push({ title: recommendation.title, ok: true, url: created.html_url });
        } catch (error: any) {
            console.error(`Failed to file code recommendation issue "${recommendation.title}":`, error.message);
            results.push({ title: recommendation.title, ok: false, error: error.message });
        }
    }
    return results;
}

/**
 * Approve or reject a prompt proposal
 */
app.post('/api/learning/prompt-proposal/:id/review', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, reviewer_name, reviewer_notes, final_prompt, accepted_rule_indexes } = req.body || {};

        if (!status || !['approved', 'approved_modified', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'status must be approved, approved_modified, or rejected' });
        }

        // Fetch the proposal first so accepted proposed_rules can be inserted.
        let proposalRecord: any = null;
        try {
            const proposalResponse = await internalApi.get(`${DB_SERVICE_URL}/prompt-proposals/${encodeURIComponent(id)}`, { timeout: 5000 });
            proposalRecord = proposalResponse.data;
        } catch (fetchError: any) {
            console.warn('Could not load proposal before review (proposed rules will be skipped):', fetchError.message);
        }

        const approved = status === 'approved' || status === 'approved_modified';
        const proposedRules: any[] = Array.isArray(proposalRecord?.proposed_rules) ? proposalRecord.proposed_rules : [];
        const selectedIndexes: number[] = Array.isArray(accepted_rule_indexes)
            ? accepted_rule_indexes.map((value: any) => Number.parseInt(`${value}`, 10)).filter((value: number) => Number.isInteger(value) && value >= 0 && value < proposedRules.length)
            : [];
        const acceptedRules = approved ? selectedIndexes.map((index) => proposedRules[index]) : [];

        // Update proposal status (+ record which rules the reviewer accepted)
        const response = await internalApi.put(`${DB_SERVICE_URL}/prompt-proposals/${encodeURIComponent(id)}`, {
            status,
            reviewer_name: reviewer_name || null,
            reviewer_notes: reviewer_notes || null,
            final_prompt: final_prompt || null,
            reviewed_at: new Date().toISOString(),
            accepted_rules: acceptedRules.length ? acceptedRules : null,
        }, { timeout: 5000 });

        // If approved, write the new prompt to qa_prompt.txt
        if (approved) {
            const promptToWrite = final_prompt || response.data?.proposed_prompt;
            if (promptToWrite) {
                const qaPromptPath = path.join(getRepoRoot(), 'sop-processor', 'qa_prompt.txt');
                await fs.writeFile(qaPromptPath, promptToWrite, 'utf-8');
                console.log(`Base prompt updated from proposal ${id} (status: ${status})`);
            }
        }

        // Insert accepted deterministic replacement rules as accepted correction_rules
        // so the pre-AI pass starts applying them immediately.
        const ruleResults: Array<{ index: number; ok: boolean; error?: string }> = [];
        for (const [position, rule] of acceptedRules.entries()) {
            const index = selectedIndexes[position];
            try {
                const payload = mapProposedRuleToCorrectionRulePayload(rule, id, index, reviewer_name || null, {
                    cycleId: proposalRecord?.cycle_id || `proposal-${id}`,
                    consumedAt: new Date().toISOString(),
                });
                await internalApi.post(`${DB_SERVICE_URL}/correction-rules`, payload, { timeout: 5000 });
                ruleResults.push({ index, ok: true });
            } catch (ruleError: any) {
                console.error(`Failed to save accepted proposal rule ${index}:`, ruleError.message);
                ruleResults.push({ index, ok: false, error: ruleError.message });
            }
        }

        // File each code recommendation as a GitHub issue so it becomes a
        // trackable engineering task (requires GITHUB_TOKEN; skipped otherwise).
        const codeRecommendations: any[] = approved && Array.isArray(proposalRecord?.code_recommendations)
            ? proposalRecord.code_recommendations
            : [];
        const issueResults = await createCodeRecommendationIssues(codeRecommendations, {
            id,
            cycle_id: proposalRecord?.cycle_id,
        });

        res.json({
            success: true,
            proposal: response.data,
            acceptedRuleCount: ruleResults.filter((r) => r.ok).length,
            failedRules: ruleResults.filter((r) => !r.ok),
            issues: issueResults,
        });
    } catch (error: any) {
        console.error('Error reviewing prompt proposal:', error.message);
        res.status(500).json({ error: 'Failed to review prompt proposal' });
    }
});

/**
 * System Alerts page
 */
app.get('/alerts', async (_req, res) => {
    try {
        let alerts: any[] = [];
        if (isSupabaseConfigured()) {
            const supabase = (await import('@menumanager/supabase-client')).getSupabaseClient();
            const { data, error } = await supabase
                .from('system_alerts')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);
            if (!error && data) alerts = data;
        }
        res.render('alerts', { title: 'System Alerts', alerts });
    } catch (error: any) {
        console.error('Error loading alerts page:', error.message);
        res.status(500).render('error', { message: 'Failed to load alerts page' });
    }
});

app.put('/api/alerts/:id/acknowledge', async (req, res) => {
    try {
        const { id } = req.params;
        const { acknowledged_by } = req.body || {};
        if (!isSupabaseConfigured()) {
            return res.status(503).json({ error: 'Supabase not configured' });
        }
        const supabase = (await import('@menumanager/supabase-client')).getSupabaseClient();
        const { error } = await supabase
            .from('system_alerts')
            .update({
                acknowledged: true,
                acknowledged_by: acknowledged_by || 'admin',
                acknowledged_at: new Date().toISOString(),
            })
            .eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/learning/location-rules', async (req, res) => {
    try {
        const payload = req.body || {};
        const catalog = await getPropertyCatalogFromDb();
        const propertyNames = new Set(catalog.map((item) => item.name.toLowerCase()));
        const location = `${payload.location || ''}`.trim();
        const sharedLocations = Array.isArray(payload.shared_locations)
            ? payload.shared_locations.map((item: any) => `${item || ''}`.trim()).filter((item: string) => !!item)
            : [];

        if (!location || !propertyNames.has(location.toLowerCase())) {
            return res.status(400).json({ error: 'location must be one of the configured properties' });
        }
        const invalidShared = sharedLocations.find((item: string) => !propertyNames.has(item.toLowerCase()));
        if (invalidShared) {
            return res.status(400).json({ error: `shared location "${invalidShared}" is not in configured properties` });
        }

        const response = await internalApi.post(`${DIFFER_SERVICE_URL}/learning/location-rules`, {
            ...payload,
            location,
            shared_locations: sharedLocations,
        }, { timeout: 3000 });
        res.json(response.data);
    } catch (error: any) {
        console.error('Error saving location-specific rule:', error.message);
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to save location-specific rule' });
    }
});

/**
 * Proxy: Submitter profile search
 */
app.get('/api/submitter-profiles/search', async (req, res) => {
    try {
        const q = req.query.q || '';
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submitter-profiles/search`, {
            params: { q }
        });
        res.json(dbResponse.data);
    } catch (error) {
        res.json([]);
    }
});

/**
 * Proxy: Recent projects
 */
app.get('/api/recent-projects', async (req, res) => {
    try {
        const limit = req.query.limit || 20;
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/recent-projects`, {
            params: { limit }
        });
        res.json(dbResponse.data);
    } catch (error) {
        res.json([]);
    }
});

/**
 * Proxy: Canonical properties catalog
 */
app.get('/api/properties', async (_req, res) => {
    const catalog = await getPropertyCatalogFromDb();
    res.json({
        properties: catalog.map((item) => item.name),
        catalog,
    });
});

/**
 * Proxy: Search approved submissions for modification flow
 */
app.get('/api/submissions/search', async (req, res) => {
    try {
        const q = req.query.q || '';
        const limit = req.query.limit || 20;
        const property = req.query.property || '';
        const servicePeriod = req.query.servicePeriod || '';
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/search`, {
            params: { q, limit, property, servicePeriod }
        });
        res.json(dbResponse.data);
    } catch (error: any) {
        console.error('Failed to search approved submissions:', error?.response?.data || error.message);
        res.status(error?.response?.status || 500).json({
            error: 'Failed to search approved submissions'
        });
    }
});

/**
 * Proxy: Get latest approved submission for a project/property pair
 */
app.get('/api/submissions/latest-approved', async (req, res) => {
    try {
        const { projectName, property, servicePeriod } = req.query;
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/latest-approved`, {
            params: { projectName, property, servicePeriod }
        });
        res.json(dbResponse.data);
    } catch (error: any) {
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to fetch approved submission' });
    }
});

/**
 * Modification Flow: Upload approved baseline DOCX when no prior record exists in DB.
 * Extracts cleaned menu text + project details to prefill the form.
 */
app.post('/api/modification/baseline-upload', upload.single('baselineDoc') as any, async (req, res) => {
    return handleCleanDocxMenuUpload(req, res, {
        mode: 'baseline',
        missingFileMessage: 'No baseline document uploaded',
        defaultFileName: 'baseline.docx',
        errorMessage: 'Failed to process baseline document',
    });
});

/**
 * New Submission Flow: Upload menu DOCX and import its menu text into the form.
 * Uses the same clean DOCX extraction path as uploaded approved baselines.
 */
app.post('/api/form/menu-doc-upload', upload.single('menuDoc') as any, async (req, res) => {
    return handleCleanDocxMenuUpload(req, res, {
        mode: 'new_menu',
        missingFileMessage: 'No menu document uploaded',
        defaultFileName: 'menu.docx',
        errorMessage: 'Failed to process menu document',
    });
});

/**
 * Modification Flow: Upload unapproved DOCX — preserves existing redlines/highlights.
 * Returns visible text (including deletions), HTML with existing-del/existing-ins spans,
 * and per-paragraph annotation ranges for the persistent preview.
 */
app.post('/api/modification/unapproved-upload', upload.single('baselineDoc') as any, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No document uploaded' });
        }

        if (!hasAllowedExtension(req.file.originalname || req.file.path, ALLOWED_DOCX_EXTENSIONS)) {
            return res.status(400).json({ error: 'Only .docx files are accepted' });
        }
        await assertUploadedFileType(req.file.path, ['docx']);

        const extracted = await extractUnapprovedFromDocx(req.file.path);
        res.json({
            success: true,
            baselineDocPath: req.file.path,
            baselineFileName: sanitizeStoredFileName(req.file.originalname, 'baseline.docx'),
            visibleText: extracted.visibleText,
            cleanVisibleText: extracted.cleanVisibleText,
            unapprovedHtml: extracted.unapprovedHtml,
            annotations: extracted.annotations,
            extractedAllergenKey: extracted.extractedAllergenKey,
            extractedProject: extracted.extractedProject,
        });
    } catch (error: any) {
        console.error('Error extracting unapproved document:', error);
        res.status(isClientInputError(error) ? 400 : 500).json({ error: 'Failed to process unapproved document', details: error.message });
    }
});

/**
 * Form API: Lightweight telemetry for multi-step form attempts.
 * This captures client-side failures that happen after Basic AI Check but before
 * a final submission row exists.
 */
app.post('/api/form/attempt-log', async (req, res) => {
    try {
        const attemptEvent = {
            ...(req.body || {}),
            attemptId: req.body?.attemptId || req.get('x-menumanager-attempt-id'),
            route: req.body?.route || req.get('referer') || '/form',
        };
        await logFormAttemptEvent(attemptEvent);
        sendFormAttemptFailureEmail(attemptEvent);
        res.json({ success: true });
    } catch (error: any) {
        console.error('Error logging form attempt:', error.message);
        res.status(500).json({ error: 'Failed to log form attempt' });
    }
});

/**
 * Form API: user-initiated problem report ("Report this problem" button).
 * Receives a full-page screenshot + JSON snapshot of the client form state,
 * saves both under tmp/error-reports/, logs to form_attempt_logs, and emails
 * the support inbox with the screenshot and state attached.
 */
const errorReportCooldowns = new Map<string, number>();
const ERROR_REPORT_COOLDOWN_MS = 15 * 1000;

function getErrorReportsDir(): string {
    return path.join(getRepoRoot(), 'tmp', 'error-reports');
}

function generateErrorReportIncidentId(): string {
    const timestamp = new Date().toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
    return `err-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
}

async function requestErrorReportAiTriage(report: ReturnType<typeof normalizeErrorReport>, incident: {
    incidentId: string;
    savedTo: string | null;
    stateJsonLength: number;
    screenshotBytes: number;
}): Promise<string> {
    if (!shouldRunErrorReportAiTriage()) {
        return '';
    }
    const apiKey = process.env.OPENAI_API_KEY;
    const prompt = buildErrorReportTriagePrompt(report, incident);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: ERROR_REPORT_TRIAGE_MODEL,
            temperature: 0.2,
            messages: [
                {
                    role: 'system',
                    content: 'You are a senior production support engineer for Menu Manager. Be concise, practical, and explicit about uncertainty.',
                },
                { role: 'user', content: prompt },
            ],
        }),
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OpenAI triage request failed (${response.status}): ${body.slice(0, 400)}`);
    }
    const data: any = await response.json();
    return data?.choices?.[0]?.message?.content || '';
}

async function sendErrorReportAiTriageEmail(report: ReturnType<typeof normalizeErrorReport>, incident: {
    incidentId: string;
    savedTo: string | null;
    stateJsonLength: number;
    screenshotBytes: number;
}): Promise<void> {
    if (!canSendAlertMail(alertMailDeps) || !FORM_ATTEMPT_ALERT_EMAIL || !shouldRunErrorReportAiTriage()) {
        return;
    }
    const proposal = await requestErrorReportAiTriage(report, incident);
    if (!proposal.trim()) {
        return;
    }
    const { subject, html } = buildErrorReportTriageEmail(report, incident, proposal, {
        model: ERROR_REPORT_TRIAGE_MODEL,
        dashboardUrl: DASHBOARD_URL,
    });
    const result = await sendAlertMail({
        fromName: 'Menu Manager Alerts',
        to: FORM_ATTEMPT_ALERT_EMAIL,
        subject,
        html,
    }, alertMailDeps);
    console.log(`AI triage for error report ${incident.incidentId} emailed to ${FORM_ATTEMPT_ALERT_EMAIL} via ${result.transport}`);
}

app.post('/api/form/error-report', async (req, res) => {
    try {
        const report = normalizeErrorReport(req.body);
        const incidentId = generateErrorReportIncidentId();

        const cooldownKey = report.attemptId || req.ip || 'unknown';
        const lastReport = errorReportCooldowns.get(cooldownKey) || 0;
        if (Date.now() - lastReport < ERROR_REPORT_COOLDOWN_MS) {
            return res.status(429).json({ error: 'A report was just sent. Please wait a few seconds before sending another.' });
        }
        errorReportCooldowns.set(cooldownKey, Date.now());

        const screenshot = decodeScreenshotDataUrl(req.body?.screenshotDataUrl);
        const stateJson = JSON.stringify(report.state ?? {}, null, 2);

        // Disk copy first so the report survives even when SMTP/Supabase are unavailable.
        const reportDir = path.join(getErrorReportsDir(), incidentId);
        let savedTo: string | null = null;
        try {
            await fs.mkdir(reportDir, { recursive: true });
            const { state, ...summary } = report;
            await fs.writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
                incidentId,
                savedAt: new Date().toISOString(),
                ...summary,
            }, null, 2));
            await fs.writeFile(path.join(reportDir, 'client-state.json'), stateJson);
            if (screenshot) {
                await fs.writeFile(path.join(reportDir, `screenshot.${screenshot.extension}`), screenshot.buffer);
            }
            savedTo = reportDir;
        } catch (saveError: any) {
            console.error('Failed to save error report to disk:', saveError.message);
        }

        void logFormAttemptEvent({
            attemptId: report.attemptId,
            eventType: 'user_error_report',
            route: '/api/form/error-report',
            submitterEmail: report.submitterEmail,
            submitterName: report.submitterName,
            projectName: report.projectName,
            property: report.property,
            submissionMode: report.submissionMode,
            errorMessage: report.context || 'User clicked Report this problem',
            details: {
                incidentId,
                trigger: report.trigger,
                pageUrl: report.pageUrl,
                userAgent: report.userAgent,
                viewport: report.viewport,
                hasScreenshot: !!screenshot,
                screenshotBytes: screenshot?.buffer.length || 0,
                screenshotError: report.screenshotError || null,
                stateJsonLength: stateJson.length,
                savedTo,
                recentAlerts: report.recentAlerts,
            },
        });

        // Fire-and-forget: the email must never block (or 504) the chef's
        // request. The report is already safe on disk + in form_attempt_logs.
        let emailQueued = false;
        if (canSendAlertMail(alertMailDeps) && FORM_ATTEMPT_ALERT_EMAIL && shouldEmailErrorReport()) {
            const { subject, html } = buildErrorReportEmail(report, {
                incidentId,
                savedTo,
                stateJsonLength: stateJson.length,
                screenshotBytes: screenshot?.buffer.length || 0,
                hasScreenshot: !!screenshot,
                dashboardUrl: DASHBOARD_URL,
            });
            emailQueued = true;
            sendAlertMail({
                fromName: 'Menu Manager Alerts',
                to: FORM_ATTEMPT_ALERT_EMAIL,
                subject,
                html,
            }, alertMailDeps).then((result) => {
                console.log(`Error report ${incidentId} emailed to ${FORM_ATTEMPT_ALERT_EMAIL} via ${result.transport}`);
            }).catch((mailError: any) => {
                console.error('Failed to email error report:', mailError.message);
                logAlert({
                    alert_type: 'error_report_email_failed',
                    severity: 'warning',
                    service: 'dashboard',
                    message: `Could not email user problem report ${incidentId} (saved at ${savedTo || 'disk save failed'})`,
                    details: {
                        incidentId,
                        attemptId: report.attemptId,
                        smtpError: mailError.message,
                        savedTo,
                        submitterEmail: report.submitterEmail || null,
                    },
                });
            });
        }
        void sendErrorReportAiTriageEmail(report, {
            incidentId,
            savedTo,
            stateJsonLength: stateJson.length,
            screenshotBytes: screenshot?.buffer.length || 0,
        }).catch((triageError: any) => {
            console.error('Failed to generate/email AI triage for problem report:', triageError.message);
            logAlert({
                alert_type: 'error_report_ai_triage_failed',
                severity: 'warning',
                service: 'dashboard',
                message: `Could not generate AI triage proposal for user problem report ${incidentId}`,
                details: {
                    incidentId,
                    attemptId: report.attemptId,
                    error: triageError.message,
                    savedTo,
                },
            });
        });

        res.json({ success: true, incidentId, emailQueued });
    } catch (error: any) {
        console.error('Error handling problem report:', error.message);
        res.status(500).json({ error: 'Failed to send problem report' });
    }
});

/**
 * Form API: Basic AI Check - Run QA check on menu content
 */
async function handleBasicCheck(req: any, res: any) {
    const attemptId = req.body?.attemptId || req.get('x-menumanager-attempt-id');
    const basicCheckId = sanitizePlainTextInput(req.get?.('x-menumanager-basic-check-id'), { maxLength: 100 }) || crypto.randomUUID();
    const diagnosticsRequested = wantsBasicCheckDiagnostics(req);
    try {
        const menuContent = sanitizePlainTextInput(req.body?.menuContent, { multiline: true, maxLength: MAX_LONG_TEXT_LENGTH });
        const allergens = sanitizePlainTextInput(req.body?.allergens, { multiline: true, maxLength: 2000 });
        const menuType = sanitizePlainTextInput(req.body?.menuType, { maxLength: 64 });
        const templateType = sanitizePlainTextInput(req.body?.templateType, { maxLength: 64 }) || 'food';
        const property = sanitizePlainTextInput(req.body?.property, { maxLength: 255 });
        const servicePeriod = sanitizePlainTextInput(req.body?.servicePeriod, { maxLength: 64 });
        const baselineMenuContent = sanitizePlainTextInput(req.body?.baselineMenuContent, { multiline: true, maxLength: MAX_LONG_TEXT_LENGTH });
        const reviewMode = sanitizePlainTextInput(req.body?.reviewMode, { maxLength: 64 });

        if (!menuContent || !menuContent.trim()) {
            return res.status(400).json({ error: 'Menu content is required' });
        }

        const changedOnlyMode = reviewMode === 'changed_only' && !!baselineMenuContent;
        let textForReview = menuContent;
        let changedLineCount = 0;

        if (changedOnlyMode) {
            const changedOnlyText = extractChangedLinesForReview(baselineMenuContent, menuContent);
            changedLineCount = changedOnlyText.changedLineCount;

            if (changedLineCount === 0) {
                const dishNameFormatting = buildBasicCheckDishNameFormatting(menuContent, { property, servicePeriod });
                void logFormAttemptEvent({
                    attemptId,
                    eventType: 'basic_check_completed',
                    route: '/api/form/basic-check',
                    statusCode: 200,
                    submitterEmail: req.body?.submitterEmail,
                    submitterName: req.body?.submitterName,
                    projectName: req.body?.projectName,
                    property: req.body?.property,
                    servicePeriod: req.body?.servicePeriod,
                    templateType: req.body?.templateType,
                    submissionMode: req.body?.submissionMode,
                    revisionSource: req.body?.revisionSource,
                    revisionBaselineFileName: req.body?.revisionBaselineFileName,
                    menuTextLength: menuContent.length,
                    menuHtmlLength: req.body?.menuHtmlLength,
                    persistentDiffHtmlLength: req.body?.persistentDiffHtmlLength,
                    baseMenuTextLength: baselineMenuContent.length,
                    correctedMenuTextLength: menuContent.length,
                    requestBodyLength: req.get('content-length'),
                    suggestionsCount: 0,
                    criticalSuggestionsCount: 0,
                    details: { reviewMode: 'changed_only', changedLineCount: 0 },
                });
                return res.json({
                    success: true,
                    originalMenu: menuContent,
                    correctedMenu: menuContent,
                    suggestions: [],
                    hasChanges: false,
                    hasCriticalErrors: false,
                    reviewMode: 'changed_only',
                    changedLineCount: 0,
                    dishNameFormatting,
                    ...(diagnosticsRequested ? {
                        basicCheckDiagnostics: {
                            checkId: basicCheckId,
                            reviewMode: 'changed_only',
                            changedLineCount: 0,
                            skippedAiCall: true,
                            reason: 'no_changed_lines',
                            comparedTextLength: menuContent.length,
                            baselineTextLength: baselineMenuContent.length,
                            dishNameFormatting: {
                                anchorCount: dishNameFormatting.length,
                                anchors: dishNameFormatting,
                            },
                        }
                    } : {}),
                });
            }

            textForReview = changedOnlyText.text;
        }

        const reviewFooterMetadata = normalizeMenuFooter(textForReview, allergens || '');
        const sanitizedMenuContent = normalizeMenuFooter(menuContent, allergens || '');
        const effectiveReviewAllergens = allergens || reviewFooterMetadata.normalizedAllergenLine;
        const acceptedCorrectionRules = await fetchAcceptedCorrectionRulesForPreAi();
        const preAiDeterministic = runPreAiDeterministicChecks(reviewFooterMetadata.body, {
            enabled: BASIC_AI_PRECHECK_ENABLED,
            property,
            templateType,
            allergenLegend: effectiveReviewAllergens,
            acceptedCorrectionRules,
        });
        const preCheckedReviewBody = preAiDeterministic.menuText;
        const embeddedSetMenuAnalysis = menuType === 'prix_fixe'
            ? { sections: [], issues: [] }
            : analyzeEmbeddedSetMenus(preCheckedReviewBody);
        const diagnosticsPromptSections: string[] = [];

        // Debug logging
        console.log('=== BASIC CHECK REQUEST ===');
        console.log('Menu content length:', menuContent.length);
        console.log('First 200 chars:', menuContent.substring(0, 200));
        console.log('Menu type:', menuType || 'standard');
        console.log('Custom allergens:', allergens ? 'Yes' : 'No (using defaults)');
        console.log('Pre-AI deterministic corrections:', preAiDeterministic.appliedCorrections.length);
        console.log('===========================');

        // Load QA prompt
        const qaPromptPath = path.join(getRepoRoot(), 'sop-processor', 'qa_prompt.txt');
        const qaPrompt = await fs.readFile(qaPromptPath, 'utf-8');

        const promptInfo = buildFinalPrompt(qaPrompt, {
            menuType,
            effectiveAllergens: effectiveReviewAllergens,
            changedOnlyMode,
            precheckEnabled: BASIC_AI_PRECHECK_ENABLED,
            embeddedSetMenuAnalysis,
        });
        const finalPrompt = promptInfo.prompt;
        diagnosticsPromptSections.push(...promptInfo.sections);

        const buildAiRequestAudit = () => ({
            url: `${AI_REVIEW_URL}/run-qa-check`,
            timeoutMs: BASIC_AI_CHECK_TIMEOUT_MS,
            textLength: preCheckedReviewBody.length,
            promptLength: finalPrompt.length,
            text: preCheckedReviewBody,
            prompt: finalPrompt,
            promptSections: diagnosticsPromptSections,
        });
        const buildBasicCheckAuditEvent = (eventType: string, statusCode: number, extra: Record<string, unknown> = {}) => ({
            attemptId,
            checkId: basicCheckId,
            eventType,
            route: '/api/form/basic-check',
            statusCode,
            submitterEmail: req.body?.submitterEmail,
            submitterName: req.body?.submitterName,
            projectName: req.body?.projectName,
            property: req.body?.property,
            servicePeriod: req.body?.servicePeriod,
            templateType: req.body?.templateType,
            submissionMode: req.body?.submissionMode,
            revisionSource: req.body?.revisionSource,
            revisionBaselineFileName: req.body?.revisionBaselineFileName,
            reviewMode: changedOnlyMode ? 'changed_only' : 'full',
            changedLineCount,
            menuTextLength: menuContent.length,
            preAiTextLength: preCheckedReviewBody.length,
            promptLength: finalPrompt.length,
            menuContentRaw: menuContent,
            baselineMenuContentRaw: changedOnlyMode ? baselineMenuContent : undefined,
            ...extra,
        });

        const getDeterministicFallbackMenu = () => {
            if (preAiDeterministic.appliedCorrections.length === 0) {
                return menuContent;
            }
            if (changedOnlyMode) {
                return mergeChangedLineCorrections(
                    menuContent,
                    baselineMenuContent,
                    preCheckedReviewBody
                ).merged;
            }
            return preCheckedReviewBody;
        };

        let qaResponse;
        try {
            qaResponse = await internalApi.post(`${AI_REVIEW_URL}/run-qa-check`, {
                text: preCheckedReviewBody,
                prompt: finalPrompt
            }, {
                timeout: BASIC_AI_CHECK_TIMEOUT_MS
            });
        } catch (aiError: any) {
            const errorDetails = describeServiceError(aiError);
            const aiFailure = sanitizeBasicCheckFailure(errorDetails);
            const deterministicFallbackMenu = getDeterministicFallbackMenu();
            const fallbackMessage = preAiDeterministic.appliedCorrections.length > 0
                ? 'AI check is temporarily unavailable. Deterministic pre-check corrections were applied, and you can still submit this menu for manual review.'
                : 'AI check is temporarily unavailable. No automated suggestions were applied, but you can still submit this menu for manual review.';
            console.error('AI basic check unavailable:', { checkId: basicCheckId, ...aiFailure });

            void logFormAttemptEvent({
                attemptId,
                eventType: 'basic_check_ai_unavailable',
                route: '/api/form/basic-check',
                statusCode: 200,
                submitterEmail: req.body?.submitterEmail,
                submitterName: req.body?.submitterName,
                projectName: req.body?.projectName,
                property: req.body?.property,
                servicePeriod: req.body?.servicePeriod,
                templateType: req.body?.templateType,
                submissionMode: req.body?.submissionMode,
                revisionSource: req.body?.revisionSource,
                revisionBaselineFileName: req.body?.revisionBaselineFileName,
                menuTextLength: menuContent.length,
                menuHtmlLength: req.body?.menuHtmlLength,
                persistentDiffHtmlLength: req.body?.persistentDiffHtmlLength,
                baseMenuTextLength: baselineMenuContent.length,
                correctedMenuTextLength: deterministicFallbackMenu.length,
                requestBodyLength: req.get('content-length'),
                suggestionsCount: 0,
                criticalSuggestionsCount: 0,
                errorMessage: errorDetails.message || 'AI call failed',
                details: {
                    checkId: basicCheckId,
                    reviewMode: changedOnlyMode ? 'changed_only' : 'full',
                    changedLineCount,
                    aiFailure,
                },
            });

            await logBasicAiCheckAudit(buildBasicCheckAuditEvent('ai_unavailable', 200, {
                correctedMenuTextLength: deterministicFallbackMenu.length,
                suggestionsCount: 0,
                criticalSuggestionsCount: 0,
                aiRequest: buildAiRequestAudit(),
                aiResponse: {
                    aiFailure,
                },
                deterministicDiagnostics: {
                    preAiDeterministic: {
                        enabled: BASIC_AI_PRECHECK_ENABLED,
                        appliedCorrectionCount: preAiDeterministic.appliedCorrections.length,
                        learnedRulesConsidered: preAiDeterministic.learnedRulesConsidered,
                        learnedRulesApplied: preAiDeterministic.learnedRulesApplied,
                        appliedCorrections: preAiDeterministic.appliedCorrections,
                    },
                },
                finalResult: {
                    correctedMenu: deterministicFallbackMenu,
                    hasChanges: deterministicFallbackMenu !== menuContent,
                    hasCriticalErrors: false,
                    aiUnavailable: true,
                    manualReviewRequired: true,
                    reviewSkippedReason: fallbackMessage,
                },
                errorMessage: errorDetails.message || 'AI call failed',
            }));

            const basicCheckDiagnostics = diagnosticsRequested ? {
                checkId: basicCheckId,
                reviewMode: changedOnlyMode ? 'changed_only' : 'full',
                changedLineCount,
                promptSections: diagnosticsPromptSections,
                aiRequest: {
                    url: `${AI_REVIEW_URL}/run-qa-check`,
                    timeoutMs: BASIC_AI_CHECK_TIMEOUT_MS,
                    textLength: preCheckedReviewBody.length,
                    promptLength: finalPrompt.length,
                    text: truncateDiagnosticText(preCheckedReviewBody),
                    prompt: truncateDiagnosticText(finalPrompt),
                },
                preAiDeterministic: {
                    enabled: BASIC_AI_PRECHECK_ENABLED,
                    appliedCorrectionCount: preAiDeterministic.appliedCorrections.length,
                    learnedRulesConsidered: preAiDeterministic.learnedRulesConsidered,
                    learnedRulesApplied: preAiDeterministic.learnedRulesApplied,
                    appliedCorrections: preAiDeterministic.appliedCorrections,
                },
                aiFailure,
            } : undefined;
            const dishNameFormatting = buildBasicCheckDishNameFormatting(deterministicFallbackMenu, { property, servicePeriod });
            if (basicCheckDiagnostics) {
                (basicCheckDiagnostics as any).dishNameFormatting = {
                    anchorCount: dishNameFormatting.length,
                    anchors: dishNameFormatting,
                };
            }

            return res.json({
                success: true,
                checkId: basicCheckId,
                originalMenu: menuContent,
                correctedMenu: deterministicFallbackMenu,
                suggestions: [],
                hasChanges: deterministicFallbackMenu !== menuContent,
                hasCriticalErrors: false,
                reviewMode: changedOnlyMode ? 'changed_only' : 'full',
                changedLineCount,
                aiUnavailable: true,
                manualReviewRequired: true,
                aiFailure,
                reviewSkippedReason: fallbackMessage,
                dishNameFormatting,
                ...(basicCheckDiagnostics ? { basicCheckDiagnostics } : {}),
            });
        }

        const feedback = qaResponse?.data?.feedback;
        if (typeof feedback !== 'string' || !feedback.trim()) {
            const deterministicFallbackMenu = getDeterministicFallbackMenu();
            const aiFailure = {
                reason: 'ai_review_malformed_response',
                status: qaResponse?.status,
                statusText: qaResponse?.statusText,
                message: 'AI review service returned no feedback text',
            };
            const fallbackMessage = preAiDeterministic.appliedCorrections.length > 0
                ? 'AI check is temporarily unavailable. Deterministic pre-check corrections were applied, and you can still submit this menu for manual review.'
                : 'AI check is temporarily unavailable. No automated suggestions were applied, but you can still submit this menu for manual review.';
            console.error('AI basic check malformed response:', { checkId: basicCheckId, ...aiFailure });

            void logFormAttemptEvent({
                attemptId,
                eventType: 'basic_check_ai_unavailable',
                route: '/api/form/basic-check',
                statusCode: 200,
                submitterEmail: req.body?.submitterEmail,
                submitterName: req.body?.submitterName,
                projectName: req.body?.projectName,
                property: req.body?.property,
                servicePeriod: req.body?.servicePeriod,
                templateType: req.body?.templateType,
                submissionMode: req.body?.submissionMode,
                revisionSource: req.body?.revisionSource,
                revisionBaselineFileName: req.body?.revisionBaselineFileName,
                menuTextLength: menuContent.length,
                menuHtmlLength: req.body?.menuHtmlLength,
                persistentDiffHtmlLength: req.body?.persistentDiffHtmlLength,
                baseMenuTextLength: baselineMenuContent.length,
                correctedMenuTextLength: deterministicFallbackMenu.length,
                requestBodyLength: req.get('content-length'),
                suggestionsCount: 0,
                criticalSuggestionsCount: 0,
                errorMessage: aiFailure.message,
                details: {
                    checkId: basicCheckId,
                    reviewMode: changedOnlyMode ? 'changed_only' : 'full',
                    changedLineCount,
                    aiFailure,
                },
            });

            await logBasicAiCheckAudit(buildBasicCheckAuditEvent('malformed_response', 200, {
                correctedMenuTextLength: deterministicFallbackMenu.length,
                suggestionsCount: 0,
                criticalSuggestionsCount: 0,
                aiRequest: buildAiRequestAudit(),
                aiResponse: {
                    status: qaResponse?.status,
                    statusText: qaResponse?.statusText,
                    body: qaResponse?.data,
                    aiFailure,
                },
                deterministicDiagnostics: {
                    preAiDeterministic: {
                        enabled: BASIC_AI_PRECHECK_ENABLED,
                        appliedCorrectionCount: preAiDeterministic.appliedCorrections.length,
                        learnedRulesConsidered: preAiDeterministic.learnedRulesConsidered,
                        learnedRulesApplied: preAiDeterministic.learnedRulesApplied,
                        appliedCorrections: preAiDeterministic.appliedCorrections,
                    },
                },
                finalResult: {
                    correctedMenu: deterministicFallbackMenu,
                    hasChanges: deterministicFallbackMenu !== menuContent,
                    hasCriticalErrors: false,
                    aiUnavailable: true,
                    manualReviewRequired: true,
                    reviewSkippedReason: fallbackMessage,
                },
                errorMessage: aiFailure.message,
            }));

            const basicCheckDiagnostics = diagnosticsRequested ? {
                checkId: basicCheckId,
                reviewMode: changedOnlyMode ? 'changed_only' : 'full',
                changedLineCount,
                promptSections: diagnosticsPromptSections,
                aiRequest: {
                    url: `${AI_REVIEW_URL}/run-qa-check`,
                    timeoutMs: BASIC_AI_CHECK_TIMEOUT_MS,
                    textLength: preCheckedReviewBody.length,
                    promptLength: finalPrompt.length,
                    text: truncateDiagnosticText(preCheckedReviewBody),
                    prompt: truncateDiagnosticText(finalPrompt),
                },
                preAiDeterministic: {
                    enabled: BASIC_AI_PRECHECK_ENABLED,
                    appliedCorrectionCount: preAiDeterministic.appliedCorrections.length,
                    learnedRulesConsidered: preAiDeterministic.learnedRulesConsidered,
                    learnedRulesApplied: preAiDeterministic.learnedRulesApplied,
                    appliedCorrections: preAiDeterministic.appliedCorrections,
                },
                aiResponse: {
                    status: qaResponse?.status,
                    statusText: qaResponse?.statusText,
                    body: truncateDiagnosticText(qaResponse?.data),
                },
                aiFailure,
            } : undefined;
            const dishNameFormatting = buildBasicCheckDishNameFormatting(deterministicFallbackMenu, { property, servicePeriod });
            if (basicCheckDiagnostics) {
                (basicCheckDiagnostics as any).dishNameFormatting = {
                    anchorCount: dishNameFormatting.length,
                    anchors: dishNameFormatting,
                };
            }

            return res.json({
                success: true,
                checkId: basicCheckId,
                originalMenu: menuContent,
                correctedMenu: deterministicFallbackMenu,
                suggestions: [],
                hasChanges: deterministicFallbackMenu !== menuContent,
                hasCriticalErrors: false,
                reviewMode: changedOnlyMode ? 'changed_only' : 'full',
                changedLineCount,
                aiUnavailable: true,
                manualReviewRequired: true,
                aiFailure,
                reviewSkippedReason: fallbackMessage,
                dishNameFormatting,
                ...(basicCheckDiagnostics ? { basicCheckDiagnostics } : {}),
            });
        }

        // Debug: Log raw feedback to see format
        console.log('=== RAW AI FEEDBACK ===');
        if (diagnosticsRequested) {
            console.log(feedback);
        } else {
            console.log('Raw feedback length:', `${feedback || ''}`.length);
        }
        console.log('=== END RAW FEEDBACK ===');

        // Parse + post-AI pipeline: deterministic cleanup, guard chain, reconciliation,
        // and prix-fixe critical enforcement (shared with the offline eval harness).
        const postPipeline = runPostAiPipeline({
            feedback,
            preCheckedReviewBody,
            menuType,
            property,
            templateType,
            effectiveReviewAllergens,
            acceptedCorrectionRules,
            embeddedSetMenuAnalysis,
            precheckEnabled: BASIC_AI_PRECHECK_ENABLED,
            checkId: basicCheckId,
        });
        const {
            parsed,
            postAiDeterministic,
            titleGuard,
            structureGuard,
            guardedCorrectedMenu,
            allergenGuard,
            appliedHc,
            setMenuGuard,
            priceIntegrityGuard,
            correctedAfterHighConfidence,
            correctedMenuSanitized,
            reconciliation,
            reconciledSuggestions,
            finalSuggestions,
            hasCriticalErrors,
            criticalSuggestions,
        } = postPipeline;
        const originalMenuSanitized = sanitizedMenuContent.body;

        console.log('=== PARSED RESPONSE ===');
        console.log('Corrected menu length:', correctedMenuSanitized.length);
        console.log('Suggestions count:', parsed.suggestions.length);
        console.log('Leading Menu title restored:', titleGuard.restored);
        console.log('Structure guard safe:', structureGuard.safe);
        console.log('Allergen order guard dropped:', allergenGuard.droppedSuggestions.length);
        console.log('Embedded set sections detected:', embeddedSetMenuAnalysis.sections.length);
        console.log('Embedded set price suggestions added:', setMenuGuard.synthesizedSuggestions.length);
        console.log('Embedded set prices restored:', setMenuGuard.restoredPrices.length);
        console.log('Price integrity guard changes:', priceIntegrityGuard.changes.length);
        console.log('Reconciled suggestions count:', reconciledSuggestions.length);
        console.log('Has changes:', correctedMenuSanitized !== originalMenuSanitized);
        console.log('===========================');

        let changedOnlyMergedMenu = menuContent;
        if (changedOnlyMode) {
            const mergeResult = mergeChangedLineCorrections(
                menuContent,
                baselineMenuContent,
                correctedAfterHighConfidence
            );
            changedOnlyMergedMenu = mergeResult.merged;
            if (mergeResult.bailed) {
                console.warn('changed_only merge bailed: AI corrected line count did not match extracted changed line count; falling back to original menu text');
            } else {
                console.log(`changed_only merge applied ${mergeResult.correctionsApplied} line correction(s)`);
            }
        }

        const finalCorrectedMenu = changedOnlyMode ? changedOnlyMergedMenu : correctedMenuSanitized;
        const finalHasChanges = changedOnlyMode
            ? changedOnlyMergedMenu !== menuContent
            : correctedMenuSanitized !== originalMenuSanitized;
        const dishNameFormatting = buildBasicCheckDishNameFormatting(finalCorrectedMenu, { property, servicePeriod });

        void logFormAttemptEvent({
            attemptId,
            eventType: 'basic_check_completed',
            route: '/api/form/basic-check',
            statusCode: 200,
            submitterEmail: req.body?.submitterEmail,
            submitterName: req.body?.submitterName,
            projectName: req.body?.projectName,
            property: req.body?.property,
            servicePeriod: req.body?.servicePeriod,
            templateType: req.body?.templateType,
            submissionMode: req.body?.submissionMode,
            revisionSource: req.body?.revisionSource,
            revisionBaselineFileName: req.body?.revisionBaselineFileName,
            menuTextLength: menuContent.length,
            menuHtmlLength: req.body?.menuHtmlLength,
            persistentDiffHtmlLength: req.body?.persistentDiffHtmlLength,
            baseMenuTextLength: baselineMenuContent.length,
            correctedMenuTextLength: finalCorrectedMenu.length,
            requestBodyLength: req.get('content-length'),
            suggestionsCount: finalSuggestions.length,
            criticalSuggestionsCount: criticalSuggestions.length,
            criticalSuggestions,
            details: {
                reviewMode: changedOnlyMode ? 'changed_only' : 'full',
                changedLineCount,
                hasChanges: finalHasChanges,
                dishNameFormattingAnchorCount: dishNameFormatting.length,
                correctedMenuStructureGuard: {
                    safe: structureGuard.safe,
                    reasons: structureGuard.reasons,
                    metrics: structureGuard.metrics,
                },
                preAiDeterministic: {
                    enabled: BASIC_AI_PRECHECK_ENABLED,
                    appliedCorrectionCount: preAiDeterministic.appliedCorrections.length,
                    learnedRulesConsidered: preAiDeterministic.learnedRulesConsidered,
                    learnedRulesApplied: preAiDeterministic.learnedRulesApplied,
                },
                postAiDeterministic: {
                    enabled: BASIC_AI_PRECHECK_ENABLED,
                    appliedCorrectionCount: postAiDeterministic.appliedCorrections.length,
                    learnedRulesConsidered: postAiDeterministic.learnedRulesConsidered,
                    learnedRulesApplied: postAiDeterministic.learnedRulesApplied,
                },
                priceIntegrityGuard: {
                    changedPriceCount: priceIntegrityGuard.changes.length,
                    changes: priceIntegrityGuard.changes,
                },
            },
        });

        await logBasicAiCheckAudit(buildBasicCheckAuditEvent('completed', 200, {
            correctedMenuTextLength: finalCorrectedMenu.length,
            responseTextLength: `${feedback || ''}`.length,
            suggestionsCount: finalSuggestions.length,
            criticalSuggestionsCount: criticalSuggestions.length,
            aiRequest: buildAiRequestAudit(),
            aiResponse: {
                status: qaResponse?.status,
                statusText: qaResponse?.statusText,
                rawFeedbackLength: `${feedback || ''}`.length,
                rawFeedback: feedback || '',
            },
            parsedResponse: {
                correctedMenuLength: parsed.correctedMenu.length,
                correctedMenu: parsed.correctedMenu,
                suggestions: parsed.suggestions,
            },
            deterministicDiagnostics: {
                preAiDeterministic: {
                    enabled: BASIC_AI_PRECHECK_ENABLED,
                    appliedCorrectionCount: preAiDeterministic.appliedCorrections.length,
                    learnedRulesConsidered: preAiDeterministic.learnedRulesConsidered,
                    learnedRulesApplied: preAiDeterministic.learnedRulesApplied,
                    appliedCorrections: preAiDeterministic.appliedCorrections,
                },
                postAiDeterministic: {
                    enabled: BASIC_AI_PRECHECK_ENABLED,
                    appliedCorrectionCount: postAiDeterministic.appliedCorrections.length,
                    learnedRulesConsidered: postAiDeterministic.learnedRulesConsidered,
                    learnedRulesApplied: postAiDeterministic.learnedRulesApplied,
                    appliedCorrections: postAiDeterministic.appliedCorrections,
                    correctedMenu: postAiDeterministic.menuText,
                },
            },
            guardDiagnostics: {
                titleGuard,
                structureGuard,
                allergenGuard: {
                    droppedSuggestions: allergenGuard.droppedSuggestions,
                    correctedMenuChanged: allergenGuard.correctedMenu !== guardedCorrectedMenu,
                },
                autoApply: {
                    suggestionsBeforeCount: allergenGuard.suggestions.length,
                    suggestionsAfterCount: appliedHc.suggestions.length,
                    correctedMenuChanged: appliedHc.menuText !== allergenGuard.correctedMenu,
                    remainingSuggestions: appliedHc.suggestions,
                },
                embeddedSetMenu: {
                    sections: embeddedSetMenuAnalysis.sections,
                    issues: embeddedSetMenuAnalysis.issues,
                    restoredPrices: setMenuGuard.restoredPrices,
                    synthesizedSuggestions: setMenuGuard.synthesizedSuggestions,
                    droppedSuggestions: setMenuGuard.droppedSuggestions,
                    correctedMenuChanged: setMenuGuard.correctedMenu !== appliedHc.menuText,
                    suggestionsAfterGuard: setMenuGuard.suggestions,
                },
                priceIntegrityGuard: {
                    changes: priceIntegrityGuard.changes,
                    correctedMenuChanged: priceIntegrityGuard.correctedMenu !== setMenuGuard.correctedMenu,
                    suggestionsAfterGuard: priceIntegrityGuard.suggestions,
                },
                reconciliation: {
                    droppedSuggestions: reconciliation.droppedSuggestions,
                    suggestionsAfterReconciliation: reconciledSuggestions,
                },
            },
            finalResult: {
                correctedMenu: finalCorrectedMenu,
                suggestions: finalSuggestions,
                hasChanges: finalHasChanges,
                hasCriticalErrors,
                dishNameFormatting: {
                    anchorCount: dishNameFormatting.length,
                    anchors: dishNameFormatting,
                },
            },
        }));

        const basicCheckDiagnostics = diagnosticsRequested ? {
            checkId: basicCheckId,
            reviewMode: changedOnlyMode ? 'changed_only' : 'full',
            changedLineCount,
            promptSections: diagnosticsPromptSections,
            aiRequest: {
                url: `${AI_REVIEW_URL}/run-qa-check`,
                timeoutMs: BASIC_AI_CHECK_TIMEOUT_MS,
                textLength: preCheckedReviewBody.length,
                promptLength: finalPrompt.length,
                text: truncateDiagnosticText(preCheckedReviewBody),
                prompt: truncateDiagnosticText(finalPrompt),
            },
            preAiDeterministic: {
                enabled: BASIC_AI_PRECHECK_ENABLED,
                appliedCorrectionCount: preAiDeterministic.appliedCorrections.length,
                learnedRulesConsidered: preAiDeterministic.learnedRulesConsidered,
                learnedRulesApplied: preAiDeterministic.learnedRulesApplied,
                appliedCorrections: preAiDeterministic.appliedCorrections,
            },
            aiResponse: {
                rawFeedbackLength: `${feedback || ''}`.length,
                rawFeedback: truncateDiagnosticText(feedback || ''),
            },
            parsed: {
                correctedMenuLength: parsed.correctedMenu.length,
                correctedMenu: truncateDiagnosticText(parsed.correctedMenu),
                suggestions: parsed.suggestions,
            },
            postAiDeterministic: {
                enabled: BASIC_AI_PRECHECK_ENABLED,
                appliedCorrectionCount: postAiDeterministic.appliedCorrections.length,
                learnedRulesConsidered: postAiDeterministic.learnedRulesConsidered,
                learnedRulesApplied: postAiDeterministic.learnedRulesApplied,
                appliedCorrections: postAiDeterministic.appliedCorrections,
                correctedMenu: truncateDiagnosticText(postAiDeterministic.menuText),
            },
            autoApply: {
                suggestionsBeforeCount: allergenGuard.suggestions.length,
                suggestionsAfterCount: appliedHc.suggestions.length,
                correctedMenuChanged: appliedHc.menuText !== allergenGuard.correctedMenu,
                remainingSuggestions: appliedHc.suggestions,
            },
            embeddedSetMenu: {
                sections: embeddedSetMenuAnalysis.sections,
                issues: embeddedSetMenuAnalysis.issues,
                restoredPrices: setMenuGuard.restoredPrices,
                synthesizedSuggestions: setMenuGuard.synthesizedSuggestions,
                droppedSuggestions: setMenuGuard.droppedSuggestions,
                correctedMenuChanged: setMenuGuard.correctedMenu !== appliedHc.menuText,
                suggestionsAfterGuard: setMenuGuard.suggestions,
            },
            priceIntegrityGuard: {
                changes: priceIntegrityGuard.changes,
                correctedMenuChanged: priceIntegrityGuard.correctedMenu !== setMenuGuard.correctedMenu,
                suggestionsAfterGuard: priceIntegrityGuard.suggestions,
            },
            titleGuard: {
                restored: titleGuard.restored,
                originalTitleLine: titleGuard.originalTitleLine,
                correctedMenuChanged: titleGuard.correctedMenu !== parsed.correctedMenu,
            },
            allergenGuard: {
                droppedSuggestions: allergenGuard.droppedSuggestions,
                correctedMenuChanged: allergenGuard.correctedMenu !== guardedCorrectedMenu,
            },
            structureGuard: {
                safe: structureGuard.safe,
                reasons: structureGuard.reasons,
                metrics: structureGuard.metrics,
                correctedMenuChanged: guardedCorrectedMenu !== titleGuard.correctedMenu,
            },
            reconciliation: {
                droppedSuggestions: reconciliation.droppedSuggestions,
                suggestionsAfterReconciliation: reconciledSuggestions,
            },
            final: {
                suggestions: finalSuggestions,
                hasCriticalErrors,
                hasChanges: finalHasChanges,
                correctedMenu: truncateDiagnosticText(finalCorrectedMenu),
                dishNameFormatting: {
                    anchorCount: dishNameFormatting.length,
                    anchors: dishNameFormatting,
                },
            },
        } : undefined;

        if (basicCheckDiagnostics) {
            console.log('=== BASIC CHECK DIAGNOSTICS ENABLED ===');
            console.log(JSON.stringify({
                checkId: basicCheckDiagnostics.checkId,
                reviewMode: basicCheckDiagnostics.reviewMode,
                changedLineCount: basicCheckDiagnostics.changedLineCount,
                promptSections: basicCheckDiagnostics.promptSections,
                rawFeedbackLength: basicCheckDiagnostics.aiResponse.rawFeedbackLength,
                parsedSuggestions: basicCheckDiagnostics.parsed.suggestions.length,
                droppedSuggestions: basicCheckDiagnostics.reconciliation.droppedSuggestions.length,
                finalSuggestions: basicCheckDiagnostics.final.suggestions.length,
            }, null, 2));
            console.log('=======================================');
        }

        res.json({
            success: true,
            originalMenu: menuContent,
            correctedMenu: finalCorrectedMenu,
            suggestions: finalSuggestions,
            hasChanges: finalHasChanges,
            hasCriticalErrors,
            reviewMode: changedOnlyMode ? 'changed_only' : 'full',
            changedLineCount,
            dishNameFormatting,
            ...(basicCheckDiagnostics ? { basicCheckDiagnostics } : {}),
        });

    } catch (error: any) {
        console.error('Error running basic check:', error);
        void logFormAttemptEvent({
            attemptId,
            eventType: 'basic_check_failed',
            route: '/api/form/basic-check',
            statusCode: 500,
            submitterEmail: req.body?.submitterEmail,
            submitterName: req.body?.submitterName,
            projectName: req.body?.projectName,
            property: req.body?.property,
            servicePeriod: req.body?.servicePeriod,
            templateType: req.body?.templateType,
            submissionMode: req.body?.submissionMode,
            revisionSource: req.body?.revisionSource,
            revisionBaselineFileName: req.body?.revisionBaselineFileName,
            menuTextLength: `${req.body?.menuContent || ''}`.length,
            menuHtmlLength: req.body?.menuHtmlLength,
            persistentDiffHtmlLength: req.body?.persistentDiffHtmlLength,
            baseMenuTextLength: `${req.body?.baselineMenuContent || ''}`.length,
            requestBodyLength: req.get('content-length'),
            errorMessage: error.message,
        });
        res.status(500).json({
            error: 'Failed to run basic AI check',
            details: error.message
        });
    }
}

async function runBasicCheckJob(checkId: string, body: any, headers: Record<string, any>): Promise<void> {
    const started = Date.now();
    const job = basicCheckJobs.get(checkId);
    if (!job) return;

    const req = {
        body,
        headers,
        get(name: string) {
            const lower = String(name || '').toLowerCase();
            return headers[lower] || headers[name] || '';
        },
    };
    const res = {
        statusCode: 200,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: any) {
            const current = basicCheckJobs.get(checkId);
            if (!current) return this;
            current.status = this.statusCode >= 400 ? 'failed' : 'completed';
            current.statusCode = this.statusCode;
            current.result = payload;
            current.error = this.statusCode >= 400 ? (payload?.error || 'Basic AI check failed') : undefined;
            current.updatedAt = Date.now();
            return this;
        },
    };

    try {
        await handleBasicCheck(req, res);
    } catch (error: any) {
        const current = basicCheckJobs.get(checkId);
        if (!current) return;
        current.status = 'failed';
        current.statusCode = 500;
        current.error = error?.message || 'Basic AI check failed';
        current.result = { error: current.error };
        current.updatedAt = Date.now();
    } finally {
        const current = basicCheckJobs.get(checkId);
        if (current?.status === 'pending' && Date.now() - started > BASIC_AI_CHECK_TIMEOUT_MS) {
            current.status = 'failed';
            current.statusCode = 504;
            current.error = 'Basic AI check timed out';
            current.result = { error: current.error };
            current.updatedAt = Date.now();
        }
    }
}

app.post('/api/form/basic-check', handleBasicCheck);

app.post('/api/form/basic-check/start', (req, res) => {
    cleanupBasicCheckJobs();
    const checkId = crypto.randomUUID();
    const now = Date.now();
    basicCheckJobs.set(checkId, {
        id: checkId,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
    });

    const headers = {
        'x-menumanager-attempt-id': req.get('x-menumanager-attempt-id') || req.body?.attemptId || '',
        'x-menumanager-basic-check-id': checkId,
        'x-menumanager-debug-basic-check': req.get('x-menumanager-debug-basic-check') || '',
        'content-length': req.get('content-length') || '',
    };

    void runBasicCheckJob(checkId, req.body || {}, headers);

    res.status(202).json({
        success: true,
        checkId,
        status: 'pending',
        pollUrl: `/api/form/basic-check/status/${checkId}`,
    });
});

app.get('/api/form/basic-check/status/:checkId', (req, res) => {
    cleanupBasicCheckJobs();
    const checkId = sanitizePlainTextInput(req.params.checkId, { maxLength: 100 });
    const job = basicCheckJobs.get(checkId);
    if (!job) {
        return res.status(404).json({ error: 'Basic AI check not found or expired' });
    }

    if (job.status === 'pending') {
        return res.json({
            success: true,
            checkId,
            status: 'pending',
        });
    }

    res.json({
        success: job.status === 'completed',
        checkId,
        status: job.status,
        statusCode: job.statusCode || (job.status === 'completed' ? 200 : 500),
        result: job.result,
        error: job.error,
    });
});

// enforcePrixFixeCriticalChecks moved to ./lib/review-pipeline.

function extractChangedLinesForReview(baselineText: string, currentText: string): { text: string; changedLineCount: number } {
    const baseLines = baselineText.split('\n').map(l => l.trim()).filter(Boolean);
    const currLines = currentText.split('\n').map(l => l.trim()).filter(Boolean);

    const baseSet = new Set(baseLines.map(normalizeReviewLine));
    const changedLines: string[] = [];

    for (const line of currLines) {
        const norm = normalizeReviewLine(line);
        if (!baseSet.has(norm)) {
            changedLines.push(line);
        }
    }

    return {
        text: changedLines.join('\n'),
        changedLineCount: changedLines.length
    };
}

function mergeChangedLineCorrections(
    fullText: string,
    baselineText: string,
    correctedChangedText: string
): { merged: string; correctionsApplied: number; bailed: boolean } {
    const baseLines = baselineText.split('\n').map(l => l.trim()).filter(Boolean);
    const baseSet = new Set(baseLines.map(normalizeReviewLine));
    const correctedChangedLines = (correctedChangedText || '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

    const fullLines = fullText.split('\n');
    const changedIndices: number[] = [];
    for (let i = 0; i < fullLines.length; i++) {
        const trimmed = fullLines[i].trim();
        if (!trimmed) continue;
        if (!baseSet.has(normalizeReviewLine(trimmed))) {
            changedIndices.push(i);
        }
    }

    if (changedIndices.length !== correctedChangedLines.length) {
        return { merged: fullText, correctionsApplied: 0, bailed: true };
    }

    let correctionsApplied = 0;
    const mergedLines = [...fullLines];
    for (let k = 0; k < changedIndices.length; k++) {
        const idx = changedIndices[k];
        const original = mergedLines[idx];
        const leadingWs = original.match(/^\s*/)?.[0] ?? '';
        const trailingWs = original.match(/\s*$/)?.[0] ?? '';
        const corrected = correctedChangedLines[k];
        if (original.trim() !== corrected) {
            mergedLines[idx] = leadingWs + corrected + trailingWs;
            correctionsApplied++;
        }
    }

    return { merged: mergedLines.join('\n'), correctionsApplied, bailed: false };
}

function normalizeReviewLine(line: string): string {
    return (line || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[“”"]/g, '"')
        .replace(/[’']/g, "'")
        .trim();
}

function buildBasicCheckDishNameFormatting(
    menuContent: string,
    options: { property?: string; servicePeriod?: string }
) {
    try {
        return buildDishNameFormattingAnchors(menuContent, options);
    } catch (error: any) {
        console.warn('Dish name formatting anchor generation failed:', error?.message || error);
        return [];
    }
}

// stripDiacritics / normalizeForSuggestionMatch / price-line and continuation helpers /
// findCorrectedLineForMenuItem / isCriticalResolvedByCorrectedMenu moved to ./lib/review-pipeline.

// reconcileCriticalSuggestionsAgainstCorrectedMenu(+WithDiagnostics) moved to ./lib/review-pipeline.


/**
 * Form API: Menu image upload (optional)
 */
app.post('/api/form/menu-image-upload', upload.single('menuImage') as any, submissionWorkflowHandlers.uploadMenuImage);

/**
 * Form API: Submit Menu - Create docx from form and trigger review workflow
 */
app.post('/api/form/submit', submissionWorkflowHandlers.submitMenu);

app.post('/api/approval/:submissionId/submit', approvalWorkflowHandlers.submitBrowserApproval);

// parseAIResponse, raw-asterisk normalization, and stripManagedFooterText moved
// to ./lib/review-pipeline and ./lib/menu-footer.

function stripRawNoticeFromHtml(html: string): string {
    return stripManagedFooterFromHtml(html);
}

function detectRawUndercookedContent(text: string): boolean {
    const normalized = (text || '').toLowerCase();
    if (!normalized.trim()) return false;
    if (/\*/.test(normalized)) return true;
    const terms = [
        'raw',
        'undercooked',
        'carpaccio',
        'tartare',
        'ceviche',
        'tiradito',
        'crudo',
        'sashimi',
        'oyster',
        'oysters',
        'rare'
    ];
    return terms.some((term) => normalized.includes(term));
}

/**
 * OLD: Parse AI feedback into structured suggestions with confidence levels (DEPRECATED - keeping for fallback)
 */
function parseFeedbackToSuggestions(feedback: string): Array<{
    type: string,
    description: string,
    change?: string,
    confidence?: 'high' | 'medium' | 'low',
    menuItem?: string,
    recommendation?: string,
    originalText?: string,
    correctedText?: string
}> {
    const suggestions: Array<any> = [];

    // Extract each item block that has Menu Item + Description + Recommendation
    // Pattern: look for "- **Menu Item:" or "- **Menu Item:**" followed by description and recommendation
    // Match until we hit another Menu Item, Menu Category, or end of feedback
    const itemBlocks = feedback.match(/- \*\*Menu Item:?\*\*[^]*?(?=(?:\n\s*- \*\*Menu (?:Item|Category):?|$))/gi);

    if (!itemBlocks || itemBlocks.length === 0) {
        console.log('⚠️  No structured suggestions found in feedback');
        console.log('First 500 chars of feedback:', feedback.substring(0, 500));
        return [];
    }

    console.log(`Found ${itemBlocks.length} suggestion blocks`);

    itemBlocks.forEach((block, blockIdx) => {
        console.log(`\nParsing block ${blockIdx + 1}:`);
        console.log(block.substring(0, 200));

        // Extract components from each block (handle both "Item:" and "Item:**" formats)
        const menuItemMatch = block.match(/- \*\*Menu Item:?\*\*\s*(.+?)(?=\n|$)/i);
        const descriptionMatch = block.match(/- \*\*Description of Issue:?\*\*\s*(.+?)(?=\n\s*- \*\*Recommendation:|$)/is);
        const recommendationMatch = block.match(/- \*\*Recommendation:?\*\*\s*(.+?)(?=\n\s*(?:-|\n)|$)/is);

        const menuItem = menuItemMatch ? menuItemMatch[1].trim() : '';

        if (!descriptionMatch) {
            console.log('⚠️  No description found in block');
            return;
        }

        const description = descriptionMatch[1].trim();
        const recommendation = recommendationMatch ? recommendationMatch[1].trim() : '';

        // Determine confidence level based on keywords
        let confidence: 'high' | 'medium' | 'low' = 'medium';

        // High confidence: spelling errors, typos, missing commas, clear factual errors
        if (description.match(/spelling|misspell|typo|incorrect spelling|correct spelling/i)) {
            confidence = 'high';
        } else if (description.match(/missing comma|missing punctuation/i)) {
            confidence = 'high';
        } else if (recommendation.match(/correct\s+(?:spelling\s+)?to/i) && description.match(/should\s+(?:be|likely be)/i)) {
            confidence = 'high';
        }
        // Low confidence: suggestions, could, might, consider
        else if (description.match(/consider|could|might|suggest|may want|unclear|ensure/i)) {
            confidence = 'low';
        }

        // Try to extract original and corrected text from recommendation and description
        let originalText = '';
        let correctedText = '';

        // Pattern 1: Correct to "X"  or Correct spelling to "X"
        const correctToPattern = recommendation.match(/correct(?:\s+(?:to|spelling\s+to))?\s+["']([^"']+)["']/i);
        if (correctToPattern) {
                correctedText = correctToPattern[1];
                // Try to find the incorrect word in the description
                const incorrectMatch = description.match(/["']([^"']+)["']\s+(?:is|should be|appears)/i);
                if (incorrectMatch) {
                    originalText = incorrectMatch[1];
                }
        }

        // Pattern 2: "X" should be "Y"
        if (!correctedText) {
                const shouldBePattern = recommendation.match(/["']([^"']+)["']\s+should be\s+["']([^"']+)["']/i);
                if (shouldBePattern) {
                    originalText = shouldBePattern[1];
                    correctedText = shouldBePattern[2];
                }
        }

        // Pattern 3: Look in description for misspelling patterns
        if (!correctedText && description.match(/misspell/i)) {
                // "Hibik" is a likely misspelling of "Hibiki"
                const misspellPattern = description.match(/["']([^"']+)["']\s+is\s+a\s+(?:likely\s+)?misspelling/i);
                if (misspellPattern) {
                    originalText = misspellPattern[1];
                }
                // Look for correct spelling in recommendation
                const correctPattern = recommendation.match(/correct\s+(?:to|spelling\s+to)?\s*["']([^"']+)["']/i);
                if (correctPattern) {
                    correctedText = correctPattern[1];
                }
        }

        // Pattern 4: Correct spelling to "X" (extract from description)
        if (!correctedText) {
                const correctSpellingPattern = recommendation.match(/correct\s+spelling\s+to\s+["']([^"']+)["']/i);
                if (correctSpellingPattern) {
                    correctedText = correctSpellingPattern[1];
                    // Extract the misspelled word from description
                    // Look for quoted words that appear multiple times or standalone
                    const quotedWords = description.match(/["']([^"']+)["']/g);
                    if (quotedWords && quotedWords.length > 0) {
                        // Get the first quoted word (usually the incorrect one)
                        const firstWord = quotedWords[0].replace(/["']/g, '');
                        // Check if it's similar to the correction (edit distance)
                        if (firstWord.toLowerCase().replace(/s$/, '') === correctedText.toLowerCase().replace(/s$/, '').replace(/\.$/, '')) {
                            originalText = firstWord.split(',')[0].trim(); // Handle "biters" in "biters, orange biters"
                        }
                    }
                }
        }

        // Pattern 5: "X" is likely a typo for "Y"
        if (!originalText || !correctedText) {
                const typoPattern = description.match(/["']([^"']+)["']\s+is\s+likely\s+a\s+typo\s+for\s+["']([^"']+)["']/i);
                if (typoPattern) {
                    originalText = typoPattern[1];
                    correctedText = typoPattern[2];
                }
        }

        // Pattern 6: "X" should be "Y" in description
        if (!originalText || !correctedText) {
                const descShouldBePattern = description.match(/["']([^"']+)["']\s+should\s+(?:be|likely be)\s+["']([^"']+)["']/i);
                if (descShouldBePattern) {
                    originalText = descShouldBePattern[1];
                    correctedText = descShouldBePattern[2];
                }
        }

        // Pattern 7: Extract word pairs when correctedText is a phrase like "mole bitters, orange bitters"
        // and description mentions the incorrect version
        if (correctedText && !originalText && correctedText.includes(',')) {
                // Try to find common misspelling in description
                const descQuoted = description.match(/["']([^"']+)["']/);
                if (descQuoted) {
                    const descText = descQuoted[1];
                    // Extract the repeated incorrect word (e.g., "biters" from "mole biters, orange biters")
                    const correctedWords = correctedText.split(/,\s*/);
                    const descWords = descText.split(/,\s*/);
                    // Find the differing word between original and corrected
                    if (correctedWords[0] && descWords[0]) {
                        const corrParts = correctedWords[0].split(' ');
                        const descParts = descWords[0].split(' ');
                        // Find the word that differs (e.g., "biters" vs "bitters")
                        for (let i = 0; i < Math.min(corrParts.length, descParts.length); i++) {
                            if (corrParts[i] !== descParts[i]) {
                                originalText = descParts[i];
                                correctedText = corrParts[i];
                                break;
                            }
                        }
                    }
                }
        }

            // Try to identify the type based on content
        let type = 'General';
        if (description.toLowerCase().includes('diacritic') || description.toLowerCase().includes('accent')) {
                type = 'Diacritics';
        } else if (description.toLowerCase().includes('allergen')) {
                type = 'Allergen Code';
        } else if (description.toLowerCase().includes('spelling')) {
                type = 'Spelling';
        } else if (description.toLowerCase().includes('format')) {
                type = 'Formatting';
        } else if (description.toLowerCase().includes('raw') || description.toLowerCase().includes('asterisk')) {
                type = 'Raw Item Marker';
        } else if (description.toLowerCase().includes('comma') || description.toLowerCase().includes('punctuation')) {
                type = 'Punctuation';
        }

        suggestions.push({
                type: type,
                description: description,
                recommendation: recommendation,
                confidence: confidence,
                menuItem: menuItem,
                originalText: originalText || undefined,
                correctedText: correctedText || undefined
        });
    });

    // If no structured issues found, create general feedback
    if (suggestions.length === 0 && feedback && !feedback.includes('No feedback generated')) {
        const lines = feedback.split('\n').filter(line =>
            line.trim() &&
            !line.includes('---') &&
            !line.startsWith('Here is') &&
            line.length > 20
        );

        lines.slice(0, 5).forEach(line => {
        suggestions.push({
                type: 'Suggestion',
                description: line.trim(),
                confidence: 'low'
        });
        });
    }

    return suggestions;
}

/**
 * Helper: Generate Word document from form data using Python
 */
async function generateDocxFromForm(
    submissionId: string,
    formData: any,
    options?: { outputPath?: string }
): Promise<string> {
    const tempUploadsDir = path.join(__dirname, '..', '..', '..', 'tmp', 'uploads');
    await fs.mkdir(tempUploadsDir, { recursive: true });

    let outputPath = options?.outputPath || '';
    if (!outputPath) {
        const submissionDir = getSubmissionDocumentDir(formData.projectName || '', formData.property || '', submissionId);
        const originalDir = path.join(submissionDir, 'original');
        await fs.mkdir(originalDir, { recursive: true });
        outputPath = path.join(originalDir, `${submissionId}.docx`);
    } else {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
    }

    // Create Python script to generate docx
    const repoRoot = getRepoRoot();
    const docxRedlinerDir = getDocxRedlinerDir();
    const pythonScript = path.join(docxRedlinerDir, 'generate_from_form.py');

    // Select template based on templateType (food or beverage)
    const templateType = formData.templateType || 'food';
    const templatePath = templateType === 'beverage'
        ? path.join(repoRoot, 'samples', 'RSH Design Brief Beverage Template.docx')
        : path.join(repoRoot, 'samples', 'RSH_DESIGN BRIEF_FOOD_Menu_Template .docx');

    console.log(`Using ${templateType} template: ${templatePath}`);

    const venvPython = path.join(docxRedlinerDir, 'venv', 'bin', 'python');

    // Create a temp JSON file with form data
    const formDataPath = path.join(tempUploadsDir, `${submissionId}_formdata.json`);
    await fs.writeFile(formDataPath, JSON.stringify(formData, null, 2));

    // Try venv python first, fallback to system python3
    let command = `"${venvPython}" "${pythonScript}" "${templatePath}" "${formDataPath}" "${outputPath}"`;

    try {
        await fs.access(venvPython);
    } catch {
        command = `python3 "${pythonScript}" "${templatePath}" "${formDataPath}" "${outputPath}"`;
    }

    console.log(`Executing: ${command}`);

    const { stdout, stderr } = await execAsync(command, {
        env: { ...process.env },
        timeout: 60000
    });

    if (stdout) console.log('Document generation output:', stdout);
    if (stderr) console.error('Document generation stderr:', stderr);

    // Clean up temp file
    await fs.unlink(formDataPath).catch(() => {});

    return outputPath;
}

/**
 * Design Approval API: Compare DOCX against PDF
 */
app.post('/api/design-approval/compare', upload.fields([
    { name: 'docxFile', maxCount: 1 },
    { name: 'pdfFile', maxCount: 1 }
]) as any, designApprovalWorkflowHandlers.compare);

app.post('/api/design-approval/:submissionId/override', designApprovalWorkflowHandlers.saveOverride);

// ---- Design Approval comparison helpers ----

// Load design comparison rules
const designRulesPath = path.join(__dirname, 'design-comparison-rules.json');
let designComparisonRules: any = {};
try {
    designComparisonRules = JSON.parse(require('fs').readFileSync(designRulesPath, 'utf8')).rules || {};
} catch { /* use defaults */ }

interface Difference {
    type: string;
    severity: string;
    description: string;
    docxValue?: string;
    pdfValue?: string;
    docxLineNum?: number;
    pdfLineNum?: number;
}

interface AlignmentEntry {
    type: 'match' | 'docx_only' | 'pdf_only';
    docxLine?: string;
    pdfLine?: string;
    docxIdx?: number;
    pdfIdx?: number;
    wordDiffs?: WordDiff[];
}

interface WordDiff {
    type: 'same' | 'changed' | 'missing' | 'added';
    text?: string;
    docxText?: string;
    pdfText?: string;
    classification?: { type: string; severity: string };
}

const PRICE_REGEX = /\$?\d+\.?\d*/g;
const ALLERGEN_CODES = new Set(['GF', 'V', 'VG', 'DF', 'N', 'SF', 'S', 'G', 'C', 'D', 'E', 'F']);

function stripAccents(str: string): string {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function classifyWordDiff(docxWord: string, pdfWord: string): { type: string; severity: string } {
    // Price difference
    if (PRICE_REGEX.test(docxWord) || PRICE_REGEX.test(pdfWord)) {
        // Reset regex lastIndex
        PRICE_REGEX.lastIndex = 0;
        const docxPrices = docxWord.match(PRICE_REGEX) || [];
        const pdfPrices = pdfWord.match(PRICE_REGEX) || [];
        if (docxPrices.join() !== pdfPrices.join()) {
            return { type: 'price', severity: 'critical' };
        }
    }
    PRICE_REGEX.lastIndex = 0;

    // Allergen code
    const docxUpper = docxWord.replace(/[^A-Za-z]/g, '').toUpperCase();
    const pdfUpper = pdfWord.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (ALLERGEN_CODES.has(docxUpper) || ALLERGEN_CODES.has(pdfUpper)) {
        if (docxUpper !== pdfUpper) {
            return { type: 'allergen', severity: 'critical' };
        }
    }

    // Case-only difference — treat as info if rules say so
    if (docxWord.toLowerCase() === pdfWord.toLowerCase()) {
        if (designComparisonRules.treatCaseOnlyAsInfo) {
            return { type: 'formatting', severity: 'info' };
        }
        return { type: 'formatting', severity: 'warning' };
    }

    // Diacritical difference
    if (stripAccents(docxWord).toLowerCase() === stripAccents(pdfWord).toLowerCase() &&
        docxWord.toLowerCase() !== pdfWord.toLowerCase()) {
        return { type: 'diacritical', severity: 'warning' };
    }

    // Punctuation-only difference (e.g., trailing comma vs none)
    if (designComparisonRules.ignorePunctuationDifferences) {
        const docxStripped = docxWord.replace(/[^\w]/g, '').toLowerCase();
        const pdfStripped = pdfWord.replace(/[^\w]/g, '').toLowerCase();
        if (docxStripped === pdfStripped && docxStripped.length > 0) {
            return { type: 'formatting', severity: 'info' };
        }
    }

    // Spelling
    return { type: 'spelling', severity: 'warning' };
}

function compareMenuTexts(docxText: string, pdfText: string): { differences: Difference[]; alignments: AlignmentEntry[] } {
    const differences: Difference[] = [];
    const alignments: AlignmentEntry[] = [];

    const docxLines = docxText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const pdfLines = pdfText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Build LCS alignment between lines
    const m = docxLines.length;
    const n = pdfLines.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (linesMatchFuzzy(docxLines[i - 1], pdfLines[j - 1])) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to find alignment
    type Alignment = { type: 'match' | 'docx_only' | 'pdf_only'; docxIdx?: number; pdfIdx?: number };
    const aligned: Alignment[] = [];
    let i = m, j = n;

    while (i > 0 && j > 0) {
        if (linesMatchFuzzy(docxLines[i - 1], pdfLines[j - 1])) {
            aligned.unshift({ type: 'match', docxIdx: i - 1, pdfIdx: j - 1 });
            i--; j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            aligned.unshift({ type: 'docx_only', docxIdx: i - 1 });
            i--;
        } else {
            aligned.unshift({ type: 'pdf_only', pdfIdx: j - 1 });
            j--;
        }
    }
    while (i > 0) {
        aligned.unshift({ type: 'docx_only', docxIdx: i - 1 });
        i--;
    }
    while (j > 0) {
        aligned.unshift({ type: 'pdf_only', pdfIdx: j - 1 });
        j--;
    }

    // Reordering detection: try to match docx_only lines with pdf_only lines
    if (designComparisonRules.reorderingTolerance) {
        const docxOnlyIndices = aligned
            .map((a, idx) => a.type === 'docx_only' ? idx : -1)
            .filter(idx => idx >= 0);
        const pdfOnlyIndices = aligned
            .map((a, idx) => a.type === 'pdf_only' ? idx : -1)
            .filter(idx => idx >= 0);

        const matchedPdfIndices = new Set<number>();
        for (const dIdx of docxOnlyIndices) {
            const docxLine = docxLines[aligned[dIdx].docxIdx!];
            for (const pIdx of pdfOnlyIndices) {
                if (matchedPdfIndices.has(pIdx)) continue;
                const pdfLine = pdfLines[aligned[pIdx].pdfIdx!];
                if (linesMatchFuzzy(docxLine, pdfLine)) {
                    // Convert both to a match pair
                    aligned[dIdx] = {
                        type: 'match',
                        docxIdx: aligned[dIdx].docxIdx,
                        pdfIdx: aligned[pIdx].pdfIdx
                    };
                    aligned[pIdx] = { type: 'match', docxIdx: -1, pdfIdx: -1 }; // mark for removal
                    matchedPdfIndices.add(pIdx);
                    break;
                }
            }
        }
        // Remove the placeholder entries (matched pdf_only that became redundant)
        const filteredAligned = aligned.filter(a => !(a.type === 'match' && a.docxIdx === -1 && a.pdfIdx === -1));
        aligned.length = 0;
        aligned.push(...filteredAligned);
    }

    // Pre-process: merge price-only docx lines into adjacent match pairs
    // e.g., DOCX has "BOTTOMLESS ENHANCEMENTS" + "+ 10" on separate lines,
    // PDF has "BOTTOMLESS ENHANCEMENTS +10" on one line — merge the DOCX lines
    if (designComparisonRules.ignoreWhitespaceInPrices) {
        const mergedIndices = new Set<number>();
        for (let ai = 0; ai < aligned.length; ai++) {
            if (aligned[ai].type !== 'docx_only') continue;
            const docxLine = docxLines[aligned[ai].docxIdx!];
            const isPriceLine = /^[\+\$\s]*\d+\.?\d*$/.test(docxLine.trim());
            if (!isPriceLine) continue;

            // Find adjacent match pair and merge the price into it
            for (let adj = ai - 1; adj <= ai + 1; adj += 2) {
                if (adj < 0 || adj >= aligned.length) continue;
                if (aligned[adj].type !== 'match') continue;
                const pdfLine = pdfLines[aligned[adj].pdfIdx!];
                const priceVal = docxLine.trim().replace(/[\s\+\$]/g, '').replace(/^0+/, '');
                const pPrices = (pdfLine.match(/[\+\$]?\d+\.?\d*/g) || []).map(p => p.replace(/[\$\+\s]/g, '').replace(/^0+/, ''));
                if (pPrices.includes(priceVal)) {
                    // Merge: update the DOCX line in the match to include the price
                    const origDocxLine = docxLines[aligned[adj].docxIdx!];
                    // Normalize price format to match PDF (e.g., "+ 10" → "+10")
                    const normalizedPrice = docxLine.trim().replace(/\s+/g, '');
                    docxLines[aligned[adj].docxIdx!] = origDocxLine + ' ' + normalizedPrice;
                    mergedIndices.add(ai);
                    break;
                }
            }
        }
        // Remove merged price lines from alignment
        const filtered = aligned.filter((_, idx) => !mergedIndices.has(idx));
        aligned.length = 0;
        aligned.push(...filtered);
    }

    // Process aligned pairs
    const ignorableWords = new Set((designComparisonRules.ignorableWords || []).map((w: string) => w.toLowerCase()));
    const minWordLen = designComparisonRules.minWordLengthForMissing || 0;

    for (const pair of aligned) {
        if (pair.type === 'docx_only') {
            const docxLine = docxLines[pair.docxIdx!];
            // Check if this is just a leading phrase that got stripped
            const stripped = stripLeadingPhrases(docxLine).trim();
            if (stripped.length === 0) {
                // Entire line was just a leading phrase — info level
                alignments.push({ type: 'docx_only', docxLine, docxIdx: pair.docxIdx });
                differences.push({
                    type: 'missing',
                    severity: 'info',
                    description: `Line missing in PDF (ignorable prefix only)`,
                    docxValue: docxLine,
                    docxLineNum: pair.docxIdx
                });
                continue;
            }

            // Check if line is only short ignorable words
            const words = docxLine.split(/\s+/);
            const allIgnorable = words.every(w =>
                ignorableWords.has(w.toLowerCase().replace(/[^\w]/g, '')) || w.replace(/[^\w]/g, '').length < minWordLen
            );

            alignments.push({ type: 'docx_only', docxLine, docxIdx: pair.docxIdx });
            differences.push({
                type: 'missing',
                severity: allIgnorable ? 'info' : 'critical',
                description: `Line missing in PDF`,
                docxValue: docxLine,
                docxLineNum: pair.docxIdx
            });
        } else if (pair.type === 'pdf_only') {
            const pdfLine = pdfLines[pair.pdfIdx!];

            // Check if it's just a price that was on the previous line in docx
            const isPriceOnly = /^[\+\$\s]*\d+\.?\d*$/.test(pdfLine.trim());

            alignments.push({ type: 'pdf_only', pdfLine, pdfIdx: pair.pdfIdx });
            differences.push({
                type: 'extra',
                severity: isPriceOnly ? 'info' : 'warning',
                description: isPriceOnly ? `Price on separate line in PDF` : `Extra line in PDF`,
                pdfValue: pdfLine,
                pdfLineNum: pair.pdfIdx
            });
        } else if (pair.type === 'match') {
            const docxLine = docxLines[pair.docxIdx!];
            const pdfLine = pdfLines[pair.pdfIdx!];

            // Even if lines "match" fuzzy, check word-by-word for differences
            if (docxLine !== pdfLine) {
                const { diffs: wordDiffs, wordAlignments } = compareWords(docxLine, pdfLine);
                for (const wd of wordDiffs) {
                    differences.push({
                        ...wd,
                        docxLineNum: pair.docxIdx,
                        pdfLineNum: pair.pdfIdx
                    });
                }
                alignments.push({
                    type: 'match',
                    docxLine,
                    pdfLine,
                    docxIdx: pair.docxIdx,
                    pdfIdx: pair.pdfIdx,
                    wordDiffs: wordAlignments
                });
            } else {
                alignments.push({
                    type: 'match',
                    docxLine,
                    pdfLine,
                    docxIdx: pair.docxIdx,
                    pdfIdx: pair.pdfIdx
                });
            }
        }
    }

    return { differences, alignments };
}

function stripLeadingPhrases(line: string): string {
    const phrases = designComparisonRules.ignoreLeadingPhrases || [];
    let result = line;
    for (const phrase of phrases) {
        if (result.toLowerCase().startsWith(phrase.toLowerCase())) {
            result = result.slice(phrase.length).trim();
        }
    }
    return result;
}

function stripPricesFromLine(line: string): string {
    // Remove standalone prices like "29", "$29", "+10", "+ 10", "$29.00"
    return line.replace(/[\+]?\s*\$?\d+\.?\d*/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeLine(line: string): string {
    let norm = stripAccents(line).toLowerCase().replace(/\s+/g, ' ').trim();
    norm = stripLeadingPhrases(norm);
    // Remove ignorable conjunction words for matching purposes
    if (designComparisonRules.ignoreConjunctionChanges) {
        const ignorable = new Set(designComparisonRules.ignorableWords || []);
        norm = norm.split(/\s+/).filter((w: string) => !ignorable.has(w.replace(/[^\w]/g, ''))).join(' ');
    }
    if (designComparisonRules.ignorePunctuationDifferences) {
        norm = norm.replace(/[,;:.\-–—]/g, '').replace(/\s+/g, ' ').trim();
    }
    return norm;
}

function linesMatchFuzzy(a: string, b: string): boolean {
    if (a === b) return true;
    // Normalize: strip accents, lowercase, collapse whitespace
    const normA = stripAccents(a).toLowerCase().replace(/\s+/g, ' ').trim();
    const normB = stripAccents(b).toLowerCase().replace(/\s+/g, ' ').trim();
    if (normA === normB) return true;

    // Try matching after stripping leading phrases and applying rules
    const deepNormA = normalizeLine(a);
    const deepNormB = normalizeLine(b);
    if (deepNormA === deepNormB) return true;

    // Try matching with prices stripped (price on different line)
    if (designComparisonRules.ignoreWhitespaceInPrices) {
        const noPriceA = stripPricesFromLine(deepNormA);
        const noPriceB = stripPricesFromLine(deepNormB);
        if (noPriceA.length > 0 && noPriceA === noPriceB) return true;
    }

    // Similarity based on common words
    const wordsA = deepNormA.split(/\s+/);
    const wordsB = deepNormB.split(/\s+/);
    if (wordsA.length === 0 || wordsB.length === 0) return false;

    let common = 0;
    const setB = new Set(wordsB);
    for (const w of wordsA) {
        if (setB.has(w)) common++;
    }

    return common / Math.max(wordsA.length, wordsB.length) > 0.5;
}

function compareWords(docxLine: string, pdfLine: string): { diffs: Difference[]; wordAlignments: WordDiff[] } {
    const diffs: Difference[] = [];
    const wordAlignments: WordDiff[] = [];
    const ignorableWords = new Set((designComparisonRules.ignorableWords || []).map((w: string) => w.toLowerCase()));
    const minWordLen = designComparisonRules.minWordLengthForMissing || 0;

    // Strip leading phrases before comparing words
    let processedDocx = docxLine;
    let processedPdf = pdfLine;
    if (designComparisonRules.ignoreLeadingPhrases) {
        processedDocx = stripLeadingPhrases(processedDocx);
        processedPdf = stripLeadingPhrases(processedPdf);
    }

    const docxWords = processedDocx.split(/\s+/).filter(w => w.length > 0);
    const pdfWords = processedPdf.split(/\s+/).filter(w => w.length > 0);

    // LCS on words — use case-insensitive matching for alignment
    const m = docxWords.length;
    const n = pdfWords.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    const wordsMatch = (a: string, b: string): boolean => {
        if (a === b) return true;
        if (designComparisonRules.ignoreCaseDifferences && a.toLowerCase() === b.toLowerCase()) return true;
        if (designComparisonRules.ignorePunctuationDifferences) {
            const aStripped = a.replace(/[^\w]/g, '').toLowerCase();
            const bStripped = b.replace(/[^\w]/g, '').toLowerCase();
            if (aStripped === bStripped && aStripped.length > 0) return true;
        }
        return false;
    };

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (wordsMatch(docxWords[i - 1], pdfWords[j - 1])) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack
    type WAlign = { type: 'same' | 'docx' | 'pdf' | 'changed'; dIdx?: number; pIdx?: number };
    const waligned: WAlign[] = [];
    let wi = m, wj = n;

    while (wi > 0 && wj > 0) {
        if (wordsMatch(docxWords[wi - 1], pdfWords[wj - 1])) {
            waligned.unshift({ type: 'same', dIdx: wi - 1, pIdx: wj - 1 });
            wi--; wj--;
        } else if (dp[wi - 1][wj] > dp[wi][wj - 1]) {
            waligned.unshift({ type: 'docx', dIdx: wi - 1 });
            wi--;
        } else {
            waligned.unshift({ type: 'pdf', pIdx: wj - 1 });
            wj--;
        }
    }
    while (wi > 0) { waligned.unshift({ type: 'docx', dIdx: wi - 1 }); wi--; }
    while (wj > 0) { waligned.unshift({ type: 'pdf', pIdx: wj - 1 }); wj--; }

    // Pair up adjacent docx/pdf removals/additions as changes
    let idx = 0;
    while (idx < waligned.length) {
        const cur = waligned[idx];
        if (cur.type === 'docx' && idx + 1 < waligned.length && waligned[idx + 1].type === 'pdf') {
            // This is a word change
            const docxW = docxWords[cur.dIdx!];
            const pdfW = pdfWords[waligned[idx + 1].pIdx!];
            const classification = classifyWordDiff(docxW, pdfW);
            diffs.push({
                type: classification.type,
                severity: classification.severity,
                description: `"${docxW}" changed to "${pdfW}"`,
                docxValue: docxW,
                pdfValue: pdfW
            });
            wordAlignments.push({
                type: 'changed',
                docxText: docxW,
                pdfText: pdfW,
                classification
            });
            idx += 2;
        } else if (cur.type === 'pdf' && idx + 1 < waligned.length && waligned[idx + 1].type === 'docx') {
            const docxW = docxWords[waligned[idx + 1].dIdx!];
            const pdfW = pdfWords[cur.pIdx!];
            const classification = classifyWordDiff(docxW, pdfW);
            diffs.push({
                type: classification.type,
                severity: classification.severity,
                description: `"${docxW}" changed to "${pdfW}"`,
                docxValue: docxW,
                pdfValue: pdfW
            });
            wordAlignments.push({
                type: 'changed',
                docxText: docxW,
                pdfText: pdfW,
                classification
            });
            idx += 2;
        } else if (cur.type === 'docx') {
            const word = docxWords[cur.dIdx!];
            const cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
            const isIgnorable = ignorableWords.has(cleanWord) || cleanWord.length < minWordLen;
            diffs.push({
                type: 'missing',
                severity: isIgnorable ? 'info' : 'critical',
                description: `Word missing in PDF: "${word}"`,
                docxValue: word
            });
            wordAlignments.push({ type: 'missing', text: word });
            idx++;
        } else if (cur.type === 'pdf') {
            const word = pdfWords[cur.pIdx!];
            const cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
            const isIgnorable = ignorableWords.has(cleanWord) || (designComparisonRules.ignoreConjunctionChanges && ['and', 'or', '&'].includes(cleanWord));
            diffs.push({
                type: 'extra',
                severity: isIgnorable ? 'info' : 'info',
                description: `Extra word in PDF: "${word}"`,
                pdfValue: word
            });
            wordAlignments.push({ type: 'added', text: word });
            idx++;
        } else {
            // 'same' type — but if the actual strings differ (case only), emit formatting info
            if (cur.type === 'same' && cur.dIdx !== undefined && cur.pIdx !== undefined) {
                const docxW = docxWords[cur.dIdx];
                const pdfW = pdfWords[cur.pIdx];
                if (docxW !== pdfW) {
                    const classification = classifyWordDiff(docxW, pdfW);
                    diffs.push({
                        type: classification.type,
                        severity: classification.severity,
                        description: `"${docxW}" changed to "${pdfW}"`,
                        docxValue: docxW,
                        pdfValue: pdfW
                    });
                    wordAlignments.push({
                        type: 'changed',
                        docxText: docxW,
                        pdfText: pdfW,
                        classification
                    });
                } else {
                    wordAlignments.push({ type: 'same', text: docxW });
                }
            } else {
                idx++;
                continue;
            }
            idx++;
        }
    }

    return { diffs, wordAlignments };
}

// The runtime prompt file is baked into the Docker image, so a prompt approved
// through the dashboard would be silently reverted by the next redeploy. On
// startup, restore the latest approved proposal from the DB when it differs.
async function syncEffectivePromptFromDb(): Promise<void> {
    try {
        if (!isSupabaseConfigured()) return;
        const supabase = (await import('@menumanager/supabase-client')).getSupabaseClient();
        const { data: approvedProposals, error } = await supabase
            .from('prompt_proposals')
            .select('status, final_prompt, proposed_prompt, reviewed_at')
            .in('status', ['approved', 'approved_modified'])
            .order('reviewed_at', { ascending: false })
            .limit(5);
        if (error || !approvedProposals?.length) return;

        const qaPromptPath = path.join(getRepoRoot(), 'sop-processor', 'qa_prompt.txt');
        const filePrompt = await fs.readFile(qaPromptPath, 'utf-8');
        const effective = pickEffectivePrompt(approvedProposals, filePrompt);
        if (effective.source === 'approved_proposal' && effective.prompt !== filePrompt) {
            await fs.writeFile(qaPromptPath, effective.prompt, 'utf-8');
            console.log('Restored approved QA prompt from prompt_proposals (file was stale after redeploy).');
        }
    } catch (error: any) {
        console.warn('Effective-prompt sync skipped:', error?.message || error);
    }
}

if (require.main === module) {
    void syncEffectivePromptFromDb();
    app.listen(port, () => {
        console.log(`📊 Dashboard service listening at http://localhost:${port}`);
        console.log(`   Access dashboard: http://localhost:${port}`);
        console.log(`   Form submission: http://localhost:${port}/form (${NEW_SUBMISSION_FORM_DEFAULT ? 'new upload-first flow' : 'legacy flow'})`);
        console.log(`   New-flow pilot:  http://localhost:${port}/form-new`);
        console.log(`   Design approval: http://localhost:${port}/design-approval`);
        console.log(`   Training dashboard: http://localhost:${port}/training`);
        // Surface alert-mail transport state so a misconfigured prod env (the
        // reason cron/proposal emails silently don't send) is visible in logs.
        const graphReady = graphMailConfig.enabled;
        const smtpReady = !!alertTransporter;
        if (graphReady) {
            console.log(`   Alert mail: Graph enabled (sends as ${graphMailConfig.mailboxAddress})${smtpReady ? ' + SMTP fallback' : ''}`);
        } else if (smtpReady) {
            console.log('   Alert mail: SMTP only (Graph disabled — set GRAPH_MAILBOX_ADDRESS; note Lightsail blocks outbound port 25)');
        } else {
            console.log('   Alert mail: NO transport configured — emails will not send. Set GRAPH_MAILBOX_ADDRESS + GRAPH_CLIENT_ID/TENANT_ID/CLIENT_SECRET (Graph) for Lightsail.');
        }
        // Submission confirmation emails reuse the alert-mail transport, so they
        // send wherever incident alerts do. Report it explicitly with the same gate.
        console.log(
            canSendAlertMail(alertMailDeps)
                ? '   Submission confirmation emails: ON — submitter + each approver get the submitted DOCX on submit'
                : '   Submission confirmation emails: OFF — no mail transport; submissions still succeed but no copies are sent'
        );
        const secretExpiry = evaluateSecretExpiry(process.env.GRAPH_CLIENT_SECRET_EXPIRES, Date.now());
        console.log(`   Graph secret: ${secretExpiry.message}`);
    });
}

export default app;
