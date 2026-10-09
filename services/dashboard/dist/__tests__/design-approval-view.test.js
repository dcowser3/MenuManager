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
describe('design approval view', () => {
    test('shows visual AI status and page-level visual findings', () => {
        const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'design-approval.ejs'), 'utf8');
        expect(template).toContain('Visual AI Check');
        expect(template).toContain('renderVisualReviewStatus(data.visualReview)');
        expect(template).toContain('PDF page ${escapeHtml(String(d.pageNumber))}');
    });
    test('uses the current approved menu picker and accepts only the design PDF', () => {
        const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'design-approval.ejs'), 'utf8');
        expect(template).toContain('Choose Approved Menu');
        expect(template).toContain('id="designRestaurant"');
        expect(template).toContain('id="designServicePeriod"');
        expect(template).toContain('id="designMenuKeyword"');
        expect(template).toContain('Search by restaurant to show approved menus');
        expect(template).toContain('Choose This Menu');
        expect(template).toContain('class="menu-card"');
        expect(template).toContain('/api/design-approval/menus');
        expect(template).toContain("formData.append('menuId', selectedMenu.menuId || '')");
        expect(template).toContain('ClickUp Handoff');
        expect(template).not.toContain('prefillSubmitterProfile();\n            loadDesignMenus();');
        expect(template).not.toContain('id="docxFile"');
        expect(template).not.toContain('id="approvalCulinary"');
        expect(template).not.toContain('id="approvalRegional"');
    });
});
