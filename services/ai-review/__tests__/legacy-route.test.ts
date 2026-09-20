import http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readFile: jest.fn(async (file: any, ...args: any[]) => {
                if (`${file}`.endsWith('/sop-processor/qa_prompt.txt')) return 'LEGACY QA PROMPT';
                return actual.promises.readFile(file, ...args);
            }),
        },
    };
});

const mockPut = jest.fn().mockResolvedValue({ data: {} });
const mockClient = {
    put: mockPut,
    interceptors: { request: { use: jest.fn() } },
};

jest.mock('axios', () => ({
    __esModule: true,
    default: { create: jest.fn(() => mockClient) },
}));

function postJson(app: any, body: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address() as { port: number };
            const payload = JSON.stringify(body);
            const request = http.request({
                hostname: '127.0.0.1',
                port: address.port,
                path: '/ai-review',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'x-menumanager-internal-token': 'legacy-test-token',
                },
            }, (response) => {
                let text = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => { text += chunk; });
                response.on('end', () => {
                    server.close();
                    let parsed: any = text;
                    try { parsed = JSON.parse(text); } catch { /* legacy text responses are valid */ }
                    resolve({ status: response.statusCode || 0, body: parsed });
                });
            });
            request.on('error', (error) => { server.close(); reject(error); });
            request.write(payload);
            request.end();
        });
    });
}

test('legacy /ai-review still completes a mocked successful review with configured seed wire behavior', async () => {
    process.env.INTERNAL_API_TOKEN = 'legacy-test-token';
    process.env.OPENAI_API_KEY = 'legacy-openai-key';
    process.env.AI_REVIEW_MODEL = 'gpt-5.6-luna';
    process.env.AI_REVIEW_SEED = '12345';
    const fetchMock = jest.fn(async (_url: string, init: any) => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
            model: 'gpt-5.6-luna',
            choices: [{ message: { content: 'legacy feedback' }, finish_reason: 'stop' }],
        }),
    } as any));
    global.fetch = fetchMock as any;
    const { app } = await import('../index');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'menumanager-legacy-review-'));
    const originalPath = path.join(tempDir, 'original.docx');
    await fs.writeFile(originalPath, 'placeholder');
    try {
        const result = await postJson(app, {
            text: 'GUACAMOLE 12',
            submission_id: 'legacy-success-1',
            submitter_email: 'chef@example.com',
            filename: 'menu.docx',
            original_path: originalPath,
        });
        expect(result.status).toBe(200);
        expect(result.body).toEqual(expect.objectContaining({ status: 'pending_human_review' }));
        expect(mockPut).toHaveBeenCalledWith(
            expect.stringContaining('/submissions/legacy-success-1'),
            expect.objectContaining({ status: 'pending_human_review', ai_draft_path: expect.stringContaining('legacy-success-1-draft.docx') })
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const request = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(request).toEqual(expect.objectContaining({ model: 'gpt-5.6-luna', seed: 12345 }));
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
        delete process.env.INTERNAL_API_TOKEN;
        delete process.env.OPENAI_API_KEY;
        delete process.env.AI_REVIEW_MODEL;
        delete process.env.AI_REVIEW_SEED;
    }
});
