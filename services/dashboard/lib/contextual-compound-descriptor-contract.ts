import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type ContextualCompoundDescriptorContract = {
    version: string;
    property_scope: string;
    template_scope: string;
    guards: Record<string, any>;
    motivating_examples: Array<{ before: string; after: string }>;
    unseen_positive_examples: Array<{ before: string; after: string }>;
    negative_examples: Array<{ before: string; after: string }>;
    expectations: Record<string, string>;
};

// The reviewed JSON artifact is the runtime source of truth. Keeping the
// loader here makes the production guard, manifest, and tests share one file.
// eslint-disable-next-line @typescript-eslint/no-var-requires
function loadContract(): ContextualCompoundDescriptorContract {
    const candidates = [
        path.resolve(__dirname, '../../../docs/references/contextual-compound-descriptors-v1.json'),
        path.resolve(__dirname, '../../../../docs/references/contextual-compound-descriptors-v1.json'),
    ];
    const file = candidates.find((candidate) => fs.existsSync(candidate));
    if (!file) throw new Error('Contextual compound descriptor contract artifact is unavailable.');
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ContextualCompoundDescriptorContract;
}

export const CONTEXTUAL_COMPOUND_DESCRIPTOR_CONTRACT = loadContract();

function canonical(value: any): any {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export const CONTEXTUAL_COMPOUND_DESCRIPTOR_CONTRACT_SHA256 = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(CONTEXTUAL_COMPOUND_DESCRIPTOR_CONTRACT)))
    .digest('hex');

export const CONTEXTUAL_COMPOUND_DESCRIPTOR_VERSION = CONTEXTUAL_COMPOUND_DESCRIPTOR_CONTRACT.version;
