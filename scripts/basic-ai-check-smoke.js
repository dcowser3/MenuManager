#!/usr/bin/env node

const dashboardUrl = (process.env.DASHBOARD_URL || 'http://localhost:3005').replace(/\/+$/, '');
const timeoutMs = Number.parseInt(process.env.BASIC_AI_SMOKE_TIMEOUT_MS || '180000', 10);
const pollIntervalMs = Number.parseInt(process.env.BASIC_AI_SMOKE_POLL_INTERVAL_MS || '1500', 10);
const expectAiUnavailable = /^(1|true|yes|on)$/i.test(process.env.BASIC_AI_SMOKE_EXPECT_AI_UNAVAILABLE || '');
const failOnAiUnavailable = /^(1|true|yes|on)$/i.test(process.env.BASIC_AI_SMOKE_FAIL_ON_AI_UNAVAILABLE || '');
const debugBasicCheck = /^(1|true|yes|on)$/i.test(process.env.BASIC_AI_SMOKE_DEBUG || '');

const menuContent = process.env.BASIC_AI_SMOKE_MENU || 'Smoke Test Menu\nGuacamole, avocado, lime G,V 12';
const baselineMenuContent = process.env.BASIC_AI_SMOKE_BASELINE_MENU || '';
const reviewMode = process.env.BASIC_AI_SMOKE_REVIEW_MODE || 'full';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Expected JSON from ${response.url}, got: ${text.slice(0, 200)}`);
    }
}

async function main() {
    const payload = {
        menuContent,
        baselineMenuContent,
        reviewMode,
        allergens: '',
        menuType: 'standard',
        debugBasicCheck,
    };

    const headers = {
        'content-type': 'application/json',
        'x-menumanager-attempt-id': `smoke-${Date.now()}`,
    };
    if (debugBasicCheck) {
        headers['x-menumanager-debug-basic-check'] = '1';
    }

    const startResponse = await fetch(`${dashboardUrl}/api/form/basic-check/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    const startData = await readJson(startResponse);
    if (startResponse.status !== 202 || !startData.checkId) {
        throw new Error(`Basic AI Check did not start cleanly: HTTP ${startResponse.status} ${JSON.stringify(startData)}`);
    }

    const pollUrl = startData.pollUrl || `/api/form/basic-check/status/${encodeURIComponent(startData.checkId)}`;
    const deadline = Date.now() + timeoutMs;
    let finalData = null;

    while (Date.now() < deadline) {
        await sleep(pollIntervalMs);
        const statusResponse = await fetch(`${dashboardUrl}${pollUrl}`, { headers });
        const statusData = await readJson(statusResponse);
        if (!statusResponse.ok) {
            throw new Error(`Basic AI Check status failed: HTTP ${statusResponse.status} ${JSON.stringify(statusData)}`);
        }
        if (statusData.status === 'pending') {
            continue;
        }
        finalData = statusData;
        break;
    }

    if (!finalData) {
        throw new Error(`Basic AI Check did not finish within ${timeoutMs}ms`);
    }
    if (finalData.status !== 'completed' || !finalData.result?.success) {
        throw new Error(`Basic AI Check did not complete successfully: ${JSON.stringify(finalData)}`);
    }

    const result = finalData.result;
    if (expectAiUnavailable && !result.aiUnavailable) {
        throw new Error('Expected manual-review fallback, but AI check completed without aiUnavailable=true');
    }
    if (failOnAiUnavailable && result.aiUnavailable) {
        throw new Error(`AI check fell back to manual review: ${result.aiFailure?.reason || 'unknown reason'}`);
    }
    if (!result.aiUnavailable && result.hasCriticalErrors) {
        throw new Error(`Smoke menu produced critical AI errors: ${JSON.stringify(result.suggestions || [])}`);
    }

    console.log(JSON.stringify({
        ok: true,
        dashboardUrl,
        checkId: finalData.checkId,
        status: finalData.status,
        aiUnavailable: !!result.aiUnavailable,
        manualReviewRequired: !!result.manualReviewRequired,
        aiFailure: result.aiFailure || null,
        suggestionsCount: (result.suggestions || []).length,
        hasDiagnostics: !!result.basicCheckDiagnostics,
    }, null, 2));
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
