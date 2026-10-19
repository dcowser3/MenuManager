// Loads the frozen learning comparison shown on /learning/submission/:id.
//
// The detail read is expensive: the differ re-extracts both the AI draft and the
// approved DOCX through Python on every request. Right after a browser approval the
// server is still busy with the finalize tail, so a short timeout here made the first
// page load fail (and each retry piled more Python work onto the differ) while a
// refresh a few seconds later succeeded. Wait for the revision to exist, then give the
// detail read one generous attempt instead of several short ones.

export type LearningGet = (url: string, options: { timeout: number }) => Promise<{ data: any }>;

export type LearningLoadStep = {
    step: 'revision' | 'detail';
    ms: number;
    ok: boolean;
    status?: number;
    error?: string;
};

export type LearningLoadResult = {
    ok: boolean;
    data: any;
    error: string;
    revision: string | null;
    steps: LearningLoadStep[];
    totalMs: number;
};

export type LearningLoadOptions = {
    differUrl: string;
    submissionId: string;
    get: LearningGet;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    revisionTimeoutMs?: number;
    detailTimeoutMs?: number;
    revisionPollAttempts?: number;
    revisionPollDelayMs?: number;
};

const describeError = (error: any): { status?: number; error: string } => {
    const status = error?.response?.status;
    const body = error?.response?.data?.error;
    const code = error?.code ? `${error.code}: ` : '';
    return {
        ...(typeof status === 'number' ? { status } : {}),
        error: `${code}${body || error?.message || 'request failed'}`,
    };
};

export async function loadLearningComparison(options: LearningLoadOptions): Promise<LearningLoadResult> {
    const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const now = options.now || (() => Date.now());
    const revisionTimeoutMs = options.revisionTimeoutMs ?? 5000;
    const detailTimeoutMs = options.detailTimeoutMs ?? 20000;
    const revisionPollAttempts = options.revisionPollAttempts ?? 8;
    const revisionPollDelayMs = options.revisionPollDelayMs ?? 500;
    const base = `${options.differUrl}/learning/submissions/${encodeURIComponent(options.submissionId)}`;
    const steps: LearningLoadStep[] = [];
    const startedAt = now();

    const timed = async (step: LearningLoadStep['step'], url: string, timeout: number) => {
        const t0 = now();
        try {
            const response = await options.get(url, { timeout });
            steps.push({ step, ms: now() - t0, ok: true });
            return { ok: true as const, data: response.data };
        } catch (error: any) {
            const described = describeError(error);
            steps.push({ step, ms: now() - t0, ok: false, ...described });
            return { ok: false as const, data: null, ...described };
        }
    };

    const finish = (ok: boolean, data: any, error: string, revision: string | null): LearningLoadResult => ({
        ok, data, error, revision, steps, totalMs: now() - startedAt,
    });

    // A 404 means the comparison hasn't been written yet (or the reviewer made no
    // changes); poll briefly. Any other failure is not something waiting will fix.
    const readRevision = async (): Promise<{ revision: string | null; error: string }> => {
        for (let attempt = 0; attempt < revisionPollAttempts; attempt++) {
            if (attempt > 0) await sleep(revisionPollDelayMs);
            const result = await timed('revision', `${base}/revision`, revisionTimeoutMs);
            const revision = result.ok ? `${result.data?.comparison_revision || ''}`.trim() : '';
            if (revision) return { revision, error: '' };
            if (!result.ok && result.status !== 404) return { revision: null, error: result.error };
            if (attempt === revisionPollAttempts - 1) {
                return { revision: null, error: result.ok ? 'comparison revision unavailable' : result.error };
            }
        }
        return { revision: null, error: 'comparison revision unavailable' };
    };

    let { revision, error } = await readRevision();
    if (!revision) return finish(false, null, error, null);

    let detail = await timed('detail', `${base}?comparison_revision=${encodeURIComponent(revision)}`, detailTimeoutMs);
    // 409: a newer comparison replaced the one we just looked up. Re-read once.
    if (!detail.ok && detail.status === 409) {
        ({ revision, error } = await readRevision());
        if (!revision) return finish(false, null, error, null);
        detail = await timed('detail', `${base}?comparison_revision=${encodeURIComponent(revision)}`, detailTimeoutMs);
    }
    if (!detail.ok) return finish(false, null, detail.error, revision);
    return finish(true, detail.data, '', revision);
}

export function formatLearningLoadLog(submissionId: string, result: LearningLoadResult): string {
    const steps = result.steps
        .map((s) => `${s.step}:${s.ok ? 'ok' : `fail${s.status ? `(${s.status})` : ''}`}:${s.ms}ms`)
        .join(',');
    return `[learning-page] submission=${submissionId} outcome=${result.ok ? 'ok' : 'unavailable'}`
        + ` total=${result.totalMs}ms revision=${result.revision || '-'} steps=[${steps}]`
        + (result.ok ? '' : ` error=${JSON.stringify(result.error)}`);
}
