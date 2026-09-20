"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const source = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
test('review page keeps the backend approval block in its render payload', () => {
    const page = source.slice(source.indexOf("app.get('/learning/prompt-proposal'"), source.indexOf('// Files approved code recommendations'));
    expect(page).toContain('approvalBlock: promptProposalApprovalBlock(proposal)');
});
test('approval mutation checks the backend block before its status write', () => {
    const routeStart = source.indexOf("app.post('/api/learning/prompt-proposal/:id/review'");
    const route = source.slice(routeStart);
    const gate = route.indexOf('promptProposalApprovalBlock(proposalRecord)');
    const statusWrite = route.indexOf('internalApi.put(`${DB_SERVICE_URL}/prompt-proposals/${encodeURIComponent(id)}`');
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(statusWrite).toBeGreaterThan(gate);
});
