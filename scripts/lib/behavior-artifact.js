'use strict';

/**
 * Build the B6-A evidence artifact from human explanations and the current
 * accepted policy snapshot. This helper owns no database, model, or network
 * boundary; the improvement cycle supplies already-fetched rows and the
 * dashboard core supplies the frozen artifact implementation.
 */
function dedupeById(rows) {
    const byId = new Map();
    for (const row of rows || []) {
        if (!row || row.id == null || `${row.id}`.trim() === '') continue;
        const id = `${row.id}`;
        // First-seen wins. The cycle fetches unconsumed rows before carried
        // rows, so a current unconsumed explanation deterministically wins a
        // duplicate carried row.
        if (!byId.has(id)) byId.set(id, row);
    }
    return [...byId.values()];
}

function mergePolicies(acceptedRules, acceptedExplanationRows) {
    const byId = new Map();
    for (const rule of acceptedRules || []) {
        if (rule && rule.id != null) byId.set(`${rule.id}`, rule);
    }
    // The explanation captured in this cycle is the human-authoritative value
    // for a duplicate policy id; it must not be silently replaced by an older
    // baseline row.
    for (const rule of acceptedExplanationRows || []) {
        if (rule && rule.id != null) byId.set(`${rule.id}`, rule);
    }
    return [...byId.values()].sort((a, b) => `${a.id}`.localeCompare(`${b.id}`));
}

function buildFrozenBehaviorArtifact(core, explanationRows, acceptedRules) {
    if (!core || typeof core.buildBehaviorTestRecord !== 'function' || typeof core.freezeBehaviorTests !== 'function') {
        throw new Error('Behavior-artifact core is unavailable.');
    }
    const records = dedupeById(explanationRows).map((row) => core.buildBehaviorTestRecord(row));
    const acceptedExplanationRows = dedupeById(explanationRows)
        .filter((row) => `${row.status || ''}`.trim().toLowerCase() === 'accepted');
    const policies = mergePolicies(acceptedRules, acceptedExplanationRows);
    // Consolidation passes empty rows/policies and therefore produces a valid,
    // empty artifact rather than inventing expectations from the candidate.
    return core.freezeBehaviorTests(records, policies, policies);
}

async function writeFrozenBehaviorArtifact({ artifactPath, core, explanationRows, acceptedRules }) {
    if (!artifactPath) throw new Error('Behavior-artifact path is required.');
    const fs = require('fs');
    const path = require('path');
    const artifact = buildFrozenBehaviorArtifact(core, explanationRows, acceptedRules);
    await fs.promises.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.promises.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
    // writeFile's mode is subject to the process umask; make the owner-only
    // contract explicit for an existing artifact as well.
    await fs.promises.chmod(artifactPath, 0o600);
    return artifact;
}

module.exports = { dedupeById, mergePolicies, buildFrozenBehaviorArtifact, writeFrozenBehaviorArtifact };
