#!/usr/bin/env node
'use strict';

// Plan-only reconciliation. This command writes a private resumable plan and
// never updates Supabase; applying the plan requires a separately authorized
// CAS operation after review.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const reconciliation = require('./lib/contextual-descriptor-reconciliation');
const verification = require('../services/dashboard/dist/lib/code-proposal-verification');

const proposalFile = process.argv[process.argv.indexOf('--proposal-file') + 1];
const root = path.resolve(__dirname, '..');
const proposalId = process.argv[process.argv.indexOf('--proposal-id') + 1] || '72c144aa-c33e-4873-85e8-6e48537e799e';
const outputDir = path.resolve(root, 'tmp', 'code-proposals', proposalId, 'contextual-descriptor-reconciliation');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function writePrivate(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(file), 0o700);
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
}

function main() {
    if (!proposalFile) throw new Error('Plan-only reconciliation requires --proposal-file <private proposal artifact>.');
    const resolved = path.resolve(proposalFile);
    if (!fs.existsSync(resolved) || fs.lstatSync(resolved).isSymbolicLink()) throw new Error('Proposal artifact must be an existing regular file.');
    const bytes = fs.readFileSync(resolved);
    const proposal = JSON.parse(bytes.toString('utf8'));
    const implementationSha256 = verification.hashCodeImplementation(root);
    const fingerprint = verification.codeProposalVerificationFingerprint(proposal);
    const plan = reconciliation.buildContextualDescriptorReconciliationPlan({ proposal, expectedProposalFingerprint: fingerprint, implementationSha256, expectedImplementationSha256: implementationSha256 });
    reconciliation.assertContextualDescriptorReconciliationPlan(plan);
    writePrivate(path.join(outputDir, 'before.json'), proposal);
    writePrivate(path.join(outputDir, 'plan.json'), { ...plan, input_sha256: digest(bytes), proposal_file: resolved });
    process.stdout.write(`${JSON.stringify({ status: 'ready', proposal_id: proposal.id, output_dir: outputDir, proposal_before_sha256: plan.proposal_before_sha256, proposal_after_sha256: plan.proposal_after_sha256, contract_sha256: plan.contract_sha256, model_calls: 0 }, null, 2)}\n`);
}

main();
