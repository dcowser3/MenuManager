"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasConfiguredDesignVisualReviewKey = hasConfiguredDesignVisualReviewKey;
exports.isDesignVisualReviewEnabled = isDesignVisualReviewEnabled;
exports.buildDesignVisualReviewPrompt = buildDesignVisualReviewPrompt;
exports.parseDesignVisualReviewResponse = parseDesignVisualReviewResponse;
exports.createDesignVisualReviewRunner = createDesignVisualReviewRunner;
exports.designVisualReviewDifferences = designVisualReviewDifferences;
const PLACEHOLDER_OPENAI_KEYS = new Set([
    'your-openai-api-key-here',
    'sk-your_openai_api_key_here',
]);
function envBoolean(value) {
    if (value === undefined || value.trim() === '')
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized))
        return true;
    if (['0', 'false', 'no', 'off'].includes(normalized))
        return false;
    return undefined;
}
function boundedInteger(value, fallback, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}
function hasConfiguredDesignVisualReviewKey(env = process.env) {
    const key = `${env.OPENAI_API_KEY || ''}`.trim();
    return !!key && !PLACEHOLDER_OPENAI_KEYS.has(key);
}
function isDesignVisualReviewEnabled(env = process.env) {
    const explicit = envBoolean(env.DESIGN_VISUAL_REVIEW_ENABLED);
    if (explicit !== undefined)
        return explicit;
    // Local development opts in automatically when a real key is present.
    // Production fails closed if the key was accidentally omitted.
    return env.NODE_ENV === 'production' || hasConfiguredDesignVisualReviewKey(env);
}
function buildDesignVisualReviewPrompt(tenantName, policies, pageNumbers) {
    const policyList = policies
        .map((policy) => `- ${policy.key}: ${policy.instruction}`)
        .join('\n');
    return [
        `Inspect PDF pages ${pageNumbers.join(', ')} for the configured design policies below.`,
        '',
        policyList,
        '',
        'Review rules:',
        '- Evaluate visible artwork, photography, logos, labels, packaging, and recognizable trade dress.',
        '- Ordinary menu text that merely names a brand is not a visual depiction and must not be flagged.',
        `- Do not flag ${tenantName || 'the submitting business'}'s own branding.`,
        '- Generic unbranded food, drink, bottle, can, or glass illustrations are allowed unless a configured policy says otherwise.',
        '- Use high confidence only when the prohibited visual is clearly recognizable. Use medium or low for a possible violation that needs human review.',
        '- Return one finding for each distinct prohibited visual and the exact PDF page number printed immediately before its image.',
        '- If no configured policy is violated, return an empty findings array.',
    ].join('\n');
}
function responseSchema(policies) {
    return {
        type: 'json_schema',
        json_schema: {
            name: 'design_visual_review',
            strict: true,
            schema: {
                type: 'object',
                properties: {
                    findings: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                policyKey: { type: 'string', enum: policies.map((policy) => policy.key) },
                                pageNumber: { type: 'integer', minimum: 1 },
                                evidence: { type: 'string' },
                                description: { type: 'string' },
                                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                            },
                            required: ['policyKey', 'pageNumber', 'evidence', 'description', 'confidence'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['findings'],
                additionalProperties: false,
            },
        },
    };
}
function parseJsonObject(content) {
    const trimmed = `${content || ''}`.trim();
    if (!trimmed)
        throw new Error('Visual review returned no data');
    try {
        return JSON.parse(trimmed);
    }
    catch {
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
        if (fenced)
            return JSON.parse(fenced);
        throw new Error('Visual review returned invalid JSON');
    }
}
function concise(value, maxLength) {
    return `${value || ''}`.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
function parseDesignVisualReviewResponse(content, policies, allowedPageNumbers) {
    const parsed = parseJsonObject(content);
    const policyByKey = new Map(policies.map((policy) => [policy.key, policy]));
    const allowedPages = new Set(allowedPageNumbers);
    if (!Array.isArray(parsed?.findings))
        throw new Error('Visual review response has no findings array');
    return parsed.findings.flatMap((raw) => {
        const policy = policyByKey.get(`${raw?.policyKey || ''}`);
        const pageNumber = Number(raw?.pageNumber);
        const confidence = `${raw?.confidence || ''}`;
        if (!policy || !allowedPages.has(pageNumber) || !['high', 'medium', 'low'].includes(confidence))
            return [];
        const evidence = concise(raw.evidence, 500);
        const description = concise(raw.description, 1000);
        if (!evidence || !description)
            return [];
        return [{
                policyKey: policy.key,
                title: policy.label,
                severity: confidence === 'high' ? policy.severity : 'warning',
                pageNumber,
                evidence,
                description,
                confidence,
            }];
    });
}
function parseRendererOutput(stdout) {
    const trimmed = `${stdout || ''}`.trim();
    if (!trimmed)
        throw new Error('PDF renderer returned no data');
    try {
        return JSON.parse(trimmed);
    }
    catch {
        const finalLine = trimmed.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'));
        if (finalLine)
            return JSON.parse(finalLine);
        throw new Error('PDF renderer returned invalid JSON');
    }
}
function shellQuoted(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
async function renderPages(pdfPath, outputDir, maxPages, dpi, deps) {
    const redlinerDir = deps.getDocxRedlinerDir();
    const venvPython = deps.pathModule.join(redlinerDir, 'venv', 'bin', 'python');
    let pythonCommand = 'python3';
    try {
        await deps.fs.access(venvPython);
        pythonCommand = shellQuoted(venvPython);
    }
    catch {
        // Fall back to the runtime's Python when the local venv is absent.
    }
    const script = deps.pathModule.join(redlinerDir, 'render_pdf_pages.py');
    const result = await deps.execAsync(`${pythonCommand} ${shellQuoted(script)} ${shellQuoted(pdfPath)} ${shellQuoted(outputDir)} ${maxPages} ${dpi}`, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    const parsed = parseRendererOutput(result.stdout);
    if (parsed?.error)
        throw new Error(`PDF visual rendering failed: ${parsed.error}`);
    const pages = Array.isArray(parsed?.pages)
        ? parsed.pages.flatMap((page) => {
            const pageNumber = Number(page?.page_number);
            const imagePath = `${page?.path || ''}`;
            return pageNumber > 0 && imagePath ? [{ pageNumber, path: imagePath }] : [];
        })
        : [];
    if (!pages.length)
        throw new Error('PDF visual rendering produced no pages');
    return {
        pages,
        totalPages: Number(parsed.page_count) || pages.length,
        truncated: !!parsed.truncated,
    };
}
function chunks(items, size) {
    const result = [];
    for (let index = 0; index < items.length; index += size)
        result.push(items.slice(index, index + size));
    return result;
}
function createDesignVisualReviewRunner(deps) {
    return async function reviewDesignPdfVisuals(input) {
        const env = deps.env || process.env;
        const policies = (input.policies || []).filter((policy) => policy?.key && policy?.instruction);
        if (!policies.length || !isDesignVisualReviewEnabled(env)) {
            return { status: 'disabled', pagesReviewed: 0, totalPages: 0, findings: [] };
        }
        if (!hasConfiguredDesignVisualReviewKey(env)) {
            return {
                status: 'unavailable',
                pagesReviewed: 0,
                totalPages: 0,
                findings: [],
                message: 'Visual AI review is enabled but OPENAI_API_KEY is not configured.',
            };
        }
        const model = `${env.DESIGN_VISUAL_REVIEW_MODEL || 'gpt-5.6-terra'}`.trim();
        const maxPages = boundedInteger(env.DESIGN_VISUAL_REVIEW_MAX_PAGES, 40, 1, 100);
        const dpi = boundedInteger(env.DESIGN_VISUAL_REVIEW_DPI, 120, 72, 200);
        const batchSize = boundedInteger(env.DESIGN_VISUAL_REVIEW_BATCH_SIZE, 4, 1, 8);
        const outputDir = await deps.fs.mkdtemp(deps.pathModule.join(deps.pathModule.dirname(input.pdfPath), 'design-visual-'));
        try {
            const rendered = await renderPages(input.pdfPath, outputDir, maxPages, dpi, deps);
            const findings = [];
            for (const batch of chunks(rendered.pages, batchSize)) {
                const pageNumbers = batch.map((page) => page.pageNumber);
                const content = [{
                        type: 'text',
                        text: buildDesignVisualReviewPrompt(input.tenantName, policies, pageNumbers),
                    }];
                for (const page of batch) {
                    const image = await deps.fs.readFile(page.path);
                    content.push({ type: 'text', text: `PDF page ${page.pageNumber}:` });
                    content.push({
                        type: 'image_url',
                        image_url: { url: `data:image/png;base64,${image.toString('base64')}`, detail: 'high' },
                    });
                }
                const response = await deps.callChat({ model, provider: 'openai' }, [
                    {
                        role: 'system',
                        content: 'You are a conservative menu-design compliance reviewer. Report only visible evidence for the configured policies. Return JSON matching the supplied schema.',
                    },
                    { role: 'user', content },
                ], {
                    provider: 'openai',
                    maxTokens: 2500,
                    responseFormat: responseSchema(policies),
                    retry: { maxTransientRetries: 2, maxRateLimitRetries: 2 },
                });
                findings.push(...parseDesignVisualReviewResponse(response.content, policies, pageNumbers));
            }
            const uniqueFindings = findings.filter((finding, index, all) => all.findIndex((candidate) => (candidate.policyKey === finding.policyKey
                && candidate.pageNumber === finding.pageNumber
                && candidate.evidence.toLowerCase() === finding.evidence.toLowerCase())) === index);
            return {
                status: rendered.truncated ? 'incomplete' : 'completed',
                model,
                pagesReviewed: rendered.pages.length,
                totalPages: rendered.totalPages,
                findings: uniqueFindings,
                message: rendered.truncated
                    ? `Only ${rendered.pages.length} of ${rendered.totalPages} PDF pages were visually reviewed.`
                    : undefined,
            };
        }
        catch (error) {
            console.error('Design visual review failed:', error?.message || error);
            return {
                status: 'unavailable',
                model,
                pagesReviewed: 0,
                totalPages: 0,
                findings: [],
                message: 'Visual AI review could not be completed. A human visual review or documented override is required.',
            };
        }
        finally {
            await deps.fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
        }
    };
}
function designVisualReviewDifferences(result) {
    const findings = result.findings.map((finding) => ({
        type: 'visual_policy',
        severity: finding.severity,
        description: `${finding.title}: ${finding.description}`,
        pdfValue: finding.evidence,
        pageNumber: finding.pageNumber,
        confidence: finding.confidence,
        policyKey: finding.policyKey,
        source: 'ai_visual',
    }));
    if (result.status === 'unavailable' || result.status === 'incomplete') {
        findings.push({
            type: 'visual_review_unavailable',
            severity: 'critical',
            description: result.message || 'Visual AI review was not completed. A human visual review or documented override is required.',
            source: 'ai_visual',
        });
    }
    return findings;
}
