"use strict";
/**
 * Supabase Client for Menu Manager
 *
 * Shared database client used by all services
 */
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./client"), exports);
// Re-export types
__exportStar(require("./types"), exports);
// Re-export service modules
__exportStar(require("./submissions"), exports);
__exportStar(require("./dishes"), exports);
__exportStar(require("./dish-extractor"), exports);
__exportStar(require("./dish-quality"), exports);
__exportStar(require("./alerts"), exports);
//# sourceMappingURL=index.js.map