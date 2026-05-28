"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSharePointUploadLogLine = buildSharePointUploadLogLine;
exports.logSharePointUploadEvent = logSharePointUploadEvent;
function compactLogDetails(details) {
    return Object.fromEntries(Object.entries(details)
        .filter(([, value]) => value !== undefined && value !== null && value !== ''));
}
function buildSharePointUploadLogLine(event, details = {}) {
    return `[sharepoint-upload] ${event} ${JSON.stringify(compactLogDetails(details))}`;
}
function logSharePointUploadEvent(event, details = {}) {
    console.log(buildSharePointUploadLogLine(event, details));
}
