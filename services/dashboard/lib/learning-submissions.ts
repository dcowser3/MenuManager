export type LearningSubmissionSummary = {
    submission_id?: unknown;
    ai_draft_path?: unknown;
    final_path?: unknown;
    [key: string]: unknown;
};

export type SubmissionMetadata = {
    id?: unknown;
    project_name?: unknown;
    property?: unknown;
    service_period?: unknown;
    filename?: unknown;
    raw_payload?: unknown;
    [key: string]: unknown;
};

export type DecoratedLearningSubmission<T extends LearningSubmissionSummary> = T & {
    submission_display_name: string;
    submission_display_detail: string;
    submission_short_id: string;
};

type FetchSubmissionMetadata = (submissionId: string) => Promise<SubmissionMetadata | null | undefined>;

function text(value: unknown): string {
    return `${value ?? ''}`.trim();
}

function parseRawPayload(rawPayload: unknown): Record<string, unknown> {
    if (!rawPayload) return {};
    if (typeof rawPayload === 'object') return rawPayload as Record<string, unknown>;
    if (typeof rawPayload !== 'string') return {};

    try {
        const parsed = JSON.parse(rawPayload);
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function stripDocxExtension(value: string): string {
    return value.replace(/\.docx$/i, '').trim();
}

function basenameFromPath(value: unknown): string {
    const normalized = text(value);
    if (!normalized) return '';
    return normalized.split(/[\\/]/).pop() || '';
}

function filenameLabel(value: unknown): string {
    const filename = basenameFromPath(value);
    if (!filename) return '';
    if (/^(form-\d+|[0-9a-f-]{20,})(?:-(?:approved|draft|final|corrected))?\.docx$/i.test(filename)) {
        return '';
    }
    return stripDocxExtension(filename).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstNonEmpty(...values: string[]): string {
    return values.find((value) => text(value)) || '';
}

export function shortSubmissionId(submissionId: unknown): string {
    const normalized = text(submissionId);
    if (!normalized) return '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
        return normalized.split('-')[0];
    }
    return normalized.slice(0, 12);
}

export function formatLearningSubmissionDisplay<T extends LearningSubmissionSummary>(
    item: T,
    metadata?: SubmissionMetadata | null
): DecoratedLearningSubmission<T> {
    const submissionId = text(item.submission_id);
    const rawPayload = parseRawPayload(metadata?.raw_payload);
    const menuName = firstNonEmpty(
        text(metadata?.project_name),
        text(rawPayload.projectName),
        text(rawPayload.project_name),
        filenameLabel(metadata?.filename),
        filenameLabel(rawPayload.filename),
        filenameLabel(item.final_path),
        filenameLabel(item.ai_draft_path),
        submissionId
    );

    const property = firstNonEmpty(text(metadata?.property), text(rawPayload.property));
    const servicePeriod = firstNonEmpty(text(metadata?.service_period), text(rawPayload.servicePeriod), text(rawPayload.service_period));
    const filename = firstNonEmpty(filenameLabel(metadata?.filename), filenameLabel(rawPayload.filename));
    const shortId = shortSubmissionId(submissionId);
    const detailParts = [property, servicePeriod, filename]
        .map((part) => part.trim())
        .filter((part, index, parts) => part && parts.indexOf(part) === index && part !== menuName);

    if (shortId) {
        detailParts.push(shortId);
    }

    return {
        ...item,
        submission_display_name: menuName || submissionId || 'Unknown menu',
        submission_display_detail: detailParts.join(' | '),
        submission_short_id: shortId,
    };
}

export async function decorateLearningSubmissionsWithMenuNames<T extends LearningSubmissionSummary>(
    items: T[],
    fetchSubmissionMetadata: FetchSubmissionMetadata
): Promise<Array<DecoratedLearningSubmission<T>>> {
    const metadataById = new Map<string, SubmissionMetadata | null>();
    const submissionIds = Array.from(new Set(
        (items || [])
            .map((item) => text(item.submission_id))
            .filter(Boolean)
    ));

    await Promise.all(submissionIds.map(async (submissionId) => {
        try {
            metadataById.set(submissionId, await fetchSubmissionMetadata(submissionId) || null);
        } catch {
            metadataById.set(submissionId, null);
        }
    }));

    return (items || []).map((item) => {
        const submissionId = text(item.submission_id);
        return formatLearningSubmissionDisplay(item, metadataById.get(submissionId));
    });
}
