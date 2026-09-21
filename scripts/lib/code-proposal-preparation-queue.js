'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { prepareCodeProposalAttempt, bindHistoricalDataset, readFrozenDataset } = require('./code-proposal-preparation');
const { runningClaimIsFresh } = require('./proposal-verification-store');

const MAX_GROUPS = 500;
const MAX_BYTES = 8 * 1024 * 1024;
const CODE_LANE = 'code_recommendation';
const ROUTED_LANES = new Set([CODE_LANE, 'replacement_rule', 'prompt', 'existing_rule', 'already_correct', 'dismissed', 'unrouted']);
const DIGEST = /^[a-f0-9]{64}$/;

async function enumerateCompletePages(fetchPage, options = {}) {
    if (typeof fetchPage !== 'function') throw new Error('Preparation queue page reader is required.');
    const maxPages = Math.min(Math.max(Number(options.maxPages) || 100, 1), 1000);
    const rows = [];
    let cursor = options.cursor || null;
    for (let page = 0; page < maxPages; page += 1) {
        const result = await fetchPage(cursor);
        if (!result || !Array.isArray(result.rows)) throw new Error('Preparation queue page is malformed.');
        rows.push(...result.rows);
        if (result.complete === true) return { rows, pages: page + 1, cursor: result.nextCursor || cursor, complete: true };
        if (!result.nextCursor || result.nextCursor === cursor) throw new Error('Preparation queue pagination is incomplete.');
        cursor = result.nextCursor;
    }
    throw new Error('Preparation queue pagination exceeded its bounded page limit.');
}

async function loadPendingProposalRows(client, options = {}) {
    return (await enumerateCompletePages(async (cursor) => {
        const offset = cursor ? Number(cursor) : 0;
        const pageSize = Math.min(Math.max(Number(options.pageSize) || 100, 1), 100);
        const query = client.from('prompt_proposals').select('*').eq('status', 'pending').order('created_at', { ascending: true }).range(offset, offset + pageSize - 1);
        const result = await query;
        if (result?.error) throw new Error(`Pending proposal enumeration failed: ${result.error.message}`);
        const rows = Array.isArray(result?.data) ? result.data : [];
        return { rows, nextCursor: `${offset + rows.length}`, complete: rows.length < pageSize };
    })).rows;
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
}

function sha256(value) {
    return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(canonical(value)))).digest('hex');
}

function atomicWrite(file, bytes) {
    if (bytes.length > MAX_BYTES) throw new Error('Preparation queue artifact exceeds the bounded size.');
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
}

function readBoundedJson(file, label) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_BYTES) throw new Error(`${label} is not a bounded regular file.`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function routeRows(proposal) {
    const rows = Array.isArray(proposal?.correction_routing) ? proposal.correction_routing : [];
    if (rows.length > MAX_GROUPS) throw new Error('Preparation queue has too many explanation groups.');
    return rows.filter((row) => row);
}

function buildPreparationInventory(proposal, options = {}) {
    if (!proposal?.id || proposal.status !== 'pending') throw new Error('Preparation queue requires one pending proposal.');
    const routes = routeRows(proposal);
    if (!routes.length) throw new Error('Preparation queue requires a complete correction-routing snapshot.');
    const priorGroups = new Set((options.previousInventories || []).flatMap((snapshot) => (snapshot?.groups || []).map((group) => `${group.correction_id || ''}`)).filter(Boolean));
    if (priorGroups.size && !proposal.superseded_from_cycle_id && routes.some((route) => priorGroups.has(`${route.correction_id || ''}`))) {
        throw new Error('Cross-cycle explanation binding requires an explicit supersession link.');
    }
    const seen = new Set();
    const evidence = Array.isArray(proposal.replay_evidence) ? proposal.replay_evidence : [];
    const behavior = proposal.eval_summary?.behavior_tests;
    const records = Array.isArray(behavior?.records) ? behavior.records : [];
    const groups = routes.slice().sort((a, b) => `${a.correction_id}`.localeCompare(`${b.correction_id}`)).map((route) => {
        const correctionId = `${route.correction_id || ''}`.trim();
        if (!correctionId || seen.has(correctionId)) throw new Error(`Preparation queue has duplicate correction binding: ${correctionId || '(missing)'}.`);
        seen.add(correctionId);
        const matches = evidence.filter((entry) => `${entry?.correction_id || ''}` === correctionId);
        if (matches.length !== 1) throw new Error(`Preparation queue requires one replay binding for ${correctionId}.`);
        const replay = matches[0];
        const record = records.find((entry) => `${entry?.correctionId || ''}` === correctionId);
        const hasTextPair = typeof route.original_text === 'string' && route.original_text.trim()
            && typeof route.corrected_text === 'string' && route.corrected_text.trim();
        const group = {
            correction_id: correctionId,
            lane: route.lane,
            status: route.lane === CODE_LANE ? 'awaiting_code_candidate_authorization' : route.lane === 'dismissed' ? 'excluded' : ROUTED_LANES.has(route.lane) ? 'not_code_candidate' : 'blocked',
            reason: route.lane === CODE_LANE ? 'code_candidate_authorization_required' : route.lane === 'dismissed' ? 'dismissed_by_routing' : ROUTED_LANES.has(route.lane) ? 'lane_not_owned_by_code_candidate' : 'unknown_routing_lane',
            route: canonical(route),
            replay: canonical({ correction_id: replay.correction_id, submission_id: replay.submission_id || null, case_id: replay.case_id || route.case_id || null, audit_id: replay.audit_id || null, attempt_id: replay.attempt_id || null, status: replay.status || null, original_text: replay.original_text || null, corrected_text: replay.corrected_text || null }),
            human_explanation: record ? canonical({ correctionId: record.correctionId, submissionId: record.submissionId || null, reason: record.reason || '', inputSpan: record.inputSpan || null, expectedSpan: record.expectedSpan || null, provenance: record.provenance || null, expectationAuthority: record.expectationAuthority || null, disposition: record.disposition || null }) : null,
            route_sha256: sha256(route),
            replay_sha256: sha256(replay),
            behavior_sha256: record ? sha256(record) : null,
            source_binding: { submission_id: replay.submission_id || null, case_id: replay.case_id || route.case_id || null, audit_id: replay.audit_id || null, attempt_id: replay.attempt_id || null },
        };
        if (route.replay_status === 'delivery_mismatch' || replay.status === 'delivery_mismatch') {
            group.status = 'blocked';
            group.reason = 'delivery_verification_required';
        }
        if (!replay.submission_id || !group.source_binding.case_id || !hasTextPair || !record || record.expectationAuthority !== 'human_explanation') {
            group.status = 'blocked';
            group.reason = !replay.submission_id ? 'missing_replay_submission_mapping' : !group.source_binding.case_id ? 'missing_case_mapping' : !hasTextPair ? 'missing_human_text_pair' : !record ? 'missing_behavior_binding' : 'behavior_authority_not_human';
        }
        return group;
    });
    const body = {
        schema_version: 1,
        source: 'prompt_proposals',
        query: canonical(options.query || { table: 'prompt_proposals', status: 'pending', proposal_id: proposal.id }),
        enumeration: canonical(options.enumeration || { complete: true, order: 'correction_id ascending', count: groups.length }),
        proposal_id: proposal.id,
        cycle_id: proposal.cycle_id || null,
        superseded_from_cycle_id: proposal.superseded_from_cycle_id || null,
        proposal_fingerprint: options.proposalFingerprint || null,
        replay_policy_version: proposal.eval_summary?.replay_retirement_policy_version ?? null,
        behavior_tests_sha256: behavior?.sha256 || null,
        groups,
        excluded_groups: groups.filter((group) => group.status === 'excluded').map((group) => group.correction_id),
        blocked_groups: groups.filter((group) => group.status === 'blocked').map((group) => ({ correction_id: group.correction_id, reason: group.reason })),
        advisory_cursor: options.advisoryCursor || null,
    };
    if (body.enumeration.complete !== true) throw new Error('Preparation queue enumeration is incomplete.');
    const snapshot_sha256 = sha256(body);
    return Object.freeze({ ...body, snapshot_sha256 });
}

function finalizePreparationInventory(inventory, hashes = {}) {
    const { snapshot_sha256: _old, frozen_hashes: _previous, ...body } = inventory;
    const frozen_hashes = { behavior_tests_sha256: hashes.behavior_tests_sha256 || body.behavior_tests_sha256, dataset_sha256: hashes.dataset_sha256, source_sha256: hashes.source_sha256, prompt_sha256: hashes.prompt_sha256, accepted_rules_sha256: hashes.accepted_rules_sha256 };
    if (Object.values(frozen_hashes).some((hash) => !DIGEST.test(hash || ''))) throw new Error('Preparation inventory requires five valid frozen identity hashes.');
    const finalized = { ...body, frozen_hashes };
    return Object.freeze({ ...finalized, snapshot_sha256: sha256(finalized) });
}

function writeSummary(file, summary) {
    atomicWrite(file, Buffer.from(`${JSON.stringify(canonical(summary), null, 2)}\n`));
}

function summaryFor(inventory, attemptId, artifactDirectory, groups, reason = null) {
    return { schema_version: 1, snapshot_sha256: inventory.snapshot_sha256, proposal_id: inventory.proposal_id, cycle_id: inventory.cycle_id, attempt_id: attemptId || null, artifact_directory: artifactDirectory || null, provider_calls: 0, advisory_cursor: inventory.advisory_cursor, groups: groups.map((group) => ({ correction_id: group.correction_id, lane: group.lane, status: group.status, reason: group.reason })), status: 'blocked', reason: reason || 'code_candidate_authorization_required' };
}

function inventoryBoundaryHash(inventory) {
    const { snapshot_sha256: _snapshot, frozen_hashes: _hashes, ...boundary } = inventory || {};
    return sha256(boundary);
}

async function readDurableProposal(options, proposal) {
    if (typeof options.readCurrentProposal === 'function') return options.readCurrentProposal(options.client, proposal.id);
    if (options.client?.from) {
        const result = await options.client.from('prompt_proposals').select('*').eq('id', proposal.id).single();
        if (result?.error) throw new Error(`Durable proposal read failed: ${result.error.message}`);
        return result?.data;
    }
    throw new Error('Durable proposal re-read is required when resuming an owner.');
}

async function acceptedRulesHash(options, verification) {
    if (!options.client?.from || typeof verification?.hashAcceptedRules !== 'function') throw new Error('Accepted-rule revalidation is unavailable.');
    const query = options.client.from('correction_rules').select('*').eq('status', 'accepted').order('id');
    const result = await query;
    if (result?.error) throw new Error(`Accepted-rule revalidation failed: ${result.error.message}`);
    return verification.hashAcceptedRules(Array.isArray(result?.data) ? result.data : []);
}

async function preparePendingCodeProposalQueue(options = {}) {
    const proposals = (options.proposals || []).slice().sort((a, b) => `${a.created_at || ''}\u0000${a.id || ''}`.localeCompare(`${b.created_at || ''}\u0000${b.id || ''}`));
    if (!proposals.length) return { status: 'empty', providerCalls: 0, snapshot: { schema_version: 1, rows: [], snapshot_sha256: sha256({ schema_version: 1, rows: [] }) }, results: [] };
    if (proposals.length > MAX_GROUPS) throw new Error('Pending proposal inventory exceeds the bounded size.');
    const body = { schema_version: 1, source: 'prompt_proposals', query: { table: 'prompt_proposals', status: 'pending', order: ['created_at', 'id'], pagination_complete: true }, enumeration: { complete: true, count: proposals.length, order: 'created_at ascending, id ascending' }, rows: proposals.map((proposal) => ({ id: proposal.id, cycle_id: proposal.cycle_id || null, superseded_from_cycle_id: proposal.superseded_from_cycle_id || null, status: proposal.status, correction_ids: (proposal.correction_routing || []).map((row) => row.correction_id).sort(), proposal_fingerprint: options.verification?.codeProposalVerificationFingerprint ? options.verification.codeProposalVerificationFingerprint(proposal) : null })) };
    const snapshot = Object.freeze({ ...body, snapshot_sha256: sha256(body) });
    if (options.inventoryPath) { fs.mkdirSync(path.dirname(options.inventoryPath), { recursive: true, mode: 0o700 }); atomicWrite(options.inventoryPath, Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`)); }
    const results = [];
    for (const proposal of proposals) {
        try {
            results.push(await prepareCodeProposalQueue({ ...options, proposal, query: snapshot.query, enumeration: { ...snapshot.enumeration, global_snapshot_sha256: snapshot.snapshot_sha256 } }));
        } catch (error) {
            results.push({ status: 'blocked', reason: `${error.message || error}`.slice(0, 500), providerCalls: 0, proposal_id: proposal.id });
        }
    }
    return { status: 'completed', providerCalls: results.reduce((sum, result) => sum + (result.providerCalls || 0), 0), snapshot, results };
}

async function prepareCodeProposalQueue(options = {}) {
    const proposal = options.proposal;
    const verification = options.verification || require('./proposal-verification-store').loadVerificationModule(options.repoRoot);
    const proposalFingerprint = verification?.codeProposalVerificationFingerprint ? verification.codeProposalVerificationFingerprint(proposal) : null;
    const inventory = buildPreparationInventory(proposal, { ...options, proposalFingerprint });
    const codeGroups = inventory.groups.filter((group) => group.lane === CODE_LANE);
    if (!codeGroups.length) return { status: 'blocked', reason: 'no_code_recommendation_groups', providerCalls: 0, inventory };
    if (inventory.groups.some((group) => group.status === 'blocked' && group.reason !== 'delivery_verification_required')) return { status: 'blocked', reason: 'preparation_binding_incomplete', providerCalls: 0, inventory };
    const existing = proposal.eval_summary?.code_candidate;
    if (existing?.attempt_id) {
        if (options.client?.from || typeof options.readCurrentProposal === 'function') {
            const live = await readDurableProposal(options, proposal);
            if (!live || live.status !== 'pending') throw new Error('Existing code-candidate owner proposal is no longer pending.');
            const liveFingerprint = verification?.codeProposalVerificationFingerprint ? verification.codeProposalVerificationFingerprint(live) : null;
            if (liveFingerprint !== proposalFingerprint) throw new Error('Existing code-candidate owner proposal changed.');
            const liveInventory = buildPreparationInventory(live, { ...options, proposalFingerprint: liveFingerprint });
            if (liveInventory.snapshot_sha256 !== inventory.snapshot_sha256) throw new Error('Existing code-candidate owner routing or authority changed.');
        } else if (proposal.status !== 'pending') throw new Error('Existing code-candidate owner proposal is no longer pending.');
        if (!runningClaimIsFresh(existing) || existing.status !== 'running') return { status: 'blocked', reason: 'terminal_owner_history_preserved', providerCalls: 0, inventory, attemptId: existing.attempt_id, artifactDirectory: existing.artifact_directory };
        const artifactDirectory = existing.artifact_directory;
        if (!artifactDirectory || !fs.existsSync(path.join(artifactDirectory, 'preparation-inventory.json'))) throw new Error('Existing owner inventory is missing; ownership is unknown and cannot be replaced.');
        const stored = readBoundedJson(path.join(artifactDirectory, 'preparation-inventory.json'), 'Existing owner inventory');
        if (!stored.frozen_hashes || Object.values(stored.frozen_hashes).some((hash) => !DIGEST.test(hash || ''))) throw new Error('Existing owner inventory frozen hashes are missing or malformed.');
        if (inventoryBoundaryHash(stored) !== inventoryBoundaryHash(inventory)) throw new Error('Existing owner inventory changed.');
        if (existing.preparation_inventory_sha256 && sha256(Buffer.from(`${JSON.stringify(stored, null, 2)}\n`)) !== existing.preparation_inventory_sha256) throw new Error('Existing owner inventory digest changed.');
        const datasetFile = path.join(artifactDirectory, 'dataset.jsonl');
        const dataset = readFrozenDataset(datasetFile);
        if (existing.expected_dataset_sha256 && sha256(dataset.bytes) !== existing.expected_dataset_sha256) throw new Error('Existing owner dataset changed.');
        const revalidatedFile = path.join(artifactDirectory, `.revalidated-${process.pid}.jsonl`);
        try {
            const revalidated = await bindHistoricalDataset(options.client, proposal, options.datasetPath, revalidatedFile);
            if (existing.expected_dataset_sha256 && revalidated.sha256 !== existing.expected_dataset_sha256) throw new Error('Existing owner submission or full-audit binding changed.');
        } finally { try { fs.unlinkSync(revalidatedFile); } catch { /* best effort */ } }
        const sourceHash = options.verification?.hashCodeImplementation ? options.verification.hashCodeImplementation(options.repoRoot) : null;
        const promptHash = sha256(Buffer.from(proposal.proposed_prompt || proposal.current_prompt || ''));
        const rulesHash = await acceptedRulesHash(options, options.verification);
        const behaviorHash = proposal.eval_summary?.behavior_tests?.sha256;
        const expectedHashes = { behavior_tests_sha256: behaviorHash, dataset_sha256: existing.expected_dataset_sha256, source_sha256: sourceHash, prompt_sha256: promptHash, accepted_rules_sha256: rulesHash };
        for (const [key, value] of Object.entries(expectedHashes)) if (value !== stored.frozen_hashes[key]) throw new Error(`Existing owner ${key} changed.`);
        const summaryFile = path.join(artifactDirectory, 'preparation-summary.json');
        let summary;
        try { summary = readBoundedJson(summaryFile, 'Preparation summary'); } catch {
            summary = summaryFor(stored, existing.attempt_id, artifactDirectory, stored.groups);
            writeSummary(summaryFile, summary);
        }
        if (summary.snapshot_sha256 !== stored.snapshot_sha256) throw new Error('Existing owner summary changed.');
        return { status: 'blocked', reason: 'code_candidate_authorization_required', providerCalls: 0, inventory: stored, attemptId: existing.attempt_id, artifactDirectory };
    }
    const attemptId = options.attemptId || `proposal-${proposal.id}`;
    const prepared = await prepareCodeProposalAttempt({ ...options, proposal, inventory, attemptId, authorization: undefined, authorizationFile: undefined, stateFile: undefined, dispatchDraft: undefined, runPreparedLifecycle: undefined });
    const finalizedInventory = finalizePreparationInventory(inventory, { behavior_tests_sha256: prepared.metadata.behavior_tests_sha256, dataset_sha256: prepared.metadata.expected_dataset_sha256, source_sha256: prepared.metadata.baseline_source_sha256, prompt_sha256: prepared.metadata.prompt_sha256, accepted_rules_sha256: prepared.metadata.accepted_rules_sha256 });
    const summary = summaryFor(finalizedInventory, prepared.attemptId, prepared.artifactDirectory, finalizedInventory.groups);
    writeSummary(path.join(prepared.artifactDirectory, 'preparation-summary.json'), summary);
    const progressPath = path.join(prepared.artifactDirectory, 'candidate', 'progress.json');
    const progress = readBoundedJson(progressPath, 'Preparation progress');
    progress.state = 'blocked'; progress.reason = 'code_candidate_authorization_required'; progress.updated_at = new Date().toISOString();
    writeSummary(progressPath, progress);
    return { status: 'blocked', reason: 'code_candidate_authorization_required', providerCalls: 0, inventory: finalizedInventory, attemptId: prepared.attemptId, artifactDirectory: prepared.artifactDirectory, metadata: prepared.metadata, summary };
}

module.exports = { buildPreparationInventory, finalizePreparationInventory, prepareCodeProposalQueue, preparePendingCodeProposalQueue, enumerateCompletePages, loadPendingProposalRows, canonical, sha256 };
