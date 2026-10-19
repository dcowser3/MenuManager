import { formatLearningLoadLog, loadLearningComparison, LearningGet } from '../lib/learning-comparison-loader';

const httpError = (status: number, error = 'nope') => Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { error } },
});

function scripted(responses: Array<(url: string, timeout: number) => any>) {
    const calls: Array<{ url: string; timeout: number }> = [];
    const get: LearningGet = async (url, { timeout }) => {
        calls.push({ url, timeout });
        const next = responses.shift();
        if (!next) throw new Error(`unexpected call ${url}`);
        return { data: next(url, timeout) };
    };
    return { get, calls };
}

const base = { differUrl: 'http://differ', submissionId: 'sub-1', sleep: async () => {} };

describe('loadLearningComparison', () => {
    it('reads the revision then the detail with a generous timeout', async () => {
        const { get, calls } = scripted([
            () => ({ comparison_revision: 'rev-1' }),
            () => ({ dish_corrections: [{ correction_id: 'c1' }] }),
        ]);
        const result = await loadLearningComparison({ ...base, get });
        expect(result.ok).toBe(true);
        expect(result.revision).toBe('rev-1');
        expect(result.data.dish_corrections).toHaveLength(1);
        expect(calls[1].url).toBe('http://differ/learning/submissions/sub-1?comparison_revision=rev-1');
        expect(calls[1].timeout).toBeGreaterThanOrEqual(20000);
    });

    it('polls while the comparison has not been written yet', async () => {
        const { get, calls } = scripted([
            () => { throw httpError(404); },
            () => { throw httpError(404); },
            () => ({ comparison_revision: 'rev-2' }),
            () => ({ dish_corrections: [] }),
        ]);
        const result = await loadLearningComparison({ ...base, get });
        expect(result.ok).toBe(true);
        expect(result.revision).toBe('rev-2');
        expect(calls).toHaveLength(4);
    });

    it('does not retry a timed-out detail read (it would only add load)', async () => {
        const { get, calls } = scripted([
            () => ({ comparison_revision: 'rev-1' }),
            () => { throw Object.assign(new Error('timeout of 25000ms exceeded'), { code: 'ECONNABORTED' }); },
        ]);
        const result = await loadLearningComparison({ ...base, get });
        expect(result.ok).toBe(false);
        expect(calls).toHaveLength(2);
        expect(result.error).toContain('ECONNABORTED');
    });

    it('re-reads the revision once when the detail reports it was superseded', async () => {
        const { get } = scripted([
            () => ({ comparison_revision: 'rev-1' }),
            () => { throw httpError(409, 'The requested learning comparison revision is no longer available.'); },
            () => ({ comparison_revision: 'rev-2' }),
            () => ({ dish_corrections: [] }),
        ]);
        const result = await loadLearningComparison({ ...base, get });
        expect(result.ok).toBe(true);
        expect(result.revision).toBe('rev-2');
    });

    it('gives up after the poll budget when no comparison ever appears', async () => {
        const { get, calls } = scripted(Array.from({ length: 3 }, () => () => { throw httpError(404); }));
        const result = await loadLearningComparison({ ...base, get, revisionPollAttempts: 3 });
        expect(result.ok).toBe(false);
        expect(calls).toHaveLength(3);
    });

    it('formats a single log line with each step', async () => {
        const { get } = scripted([
            () => { throw httpError(404); },
            () => ({ comparison_revision: 'rev-1' }),
            () => ({ dish_corrections: [] }),
        ]);
        const line = formatLearningLoadLog('sub-1', await loadLearningComparison({ ...base, get }));
        expect(line).toMatch(/^\[learning-page\] submission=sub-1 outcome=ok .*steps=\[revision:fail\(404\):\d+ms,revision:ok:\d+ms,detail:ok:\d+ms\]$/);
    });
});
