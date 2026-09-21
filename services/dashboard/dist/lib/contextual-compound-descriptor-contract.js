"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTEXTUAL_COMPOUND_DESCRIPTOR_VERSION = exports.CONTEXTUAL_COMPOUND_DESCRIPTOR_CONTRACT_SHA256 = exports.CONTEXTUAL_COMPOUND_DESCRIPTOR_CONTRACT = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// The reviewed JSON artifact is the runtime source of truth. Keeping the
// loader here makes the production guard, manifest, and tests share one file.
// eslint-disable-next-line @typescript-eslint/no-var-requires
function loadContract() {
    const candidates = [
        path_1.default.resolve(__dirname, '../../../docs/references/contextual-compound-descriptors-v1.json'),
        path_1.default.resolve(__dirname, '../../../../docs/references/contextual-compound-descriptors-v1.json'),
    ];
    const file = candidates.find((candidate) => fs_1.default.existsSync(candidate));
    if (!file)
        throw new Error('Contextual compound descriptor contract artifact is unavailable.');
    return JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
}
exports.CONTEXTUAL_COMPOUND_DESCRIPTOR_CONTRACT = loadContract();
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
exports.CONTEXTUAL_COMPOUND_DESCRIPTOR_CONTRACT_SHA256 = crypto_1.default
    .createHash('sha256')
    .update(JSON.stringify(canonical(exports.CONTEXTUAL_COMPOUND_DESCRIPTOR_CONTRACT)))
    .digest('hex');
exports.CONTEXTUAL_COMPOUND_DESCRIPTOR_VERSION = exports.CONTEXTUAL_COMPOUND_DESCRIPTOR_CONTRACT.version;
