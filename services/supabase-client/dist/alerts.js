"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAlert = logAlert;
exports.buildAlertEmailHtml = buildAlertEmailHtml;
const client_1 = require("./client");
/**
 * Log an alert to the system_alerts Supabase table.
 * Fire-and-forget — never throws.
 */
async function logAlert(alert) {
    try {
        if (!(0, client_1.isSupabaseConfigured)())
            return;
        const supabase = (0, client_1.getSupabaseClient)();
        const { error } = await supabase.from('system_alerts').insert({
            alert_type: alert.alert_type,
            severity: alert.severity,
            service: alert.service,
            submission_id: alert.submission_id || null,
            message: alert.message,
            details: typeof alert.details === 'string' ? { raw: alert.details } : (alert.details || null),
        });
        if (error) {
            console.error(`Failed to log alert to Supabase:`, error.message);
        }
    }
    catch (err) {
        console.error(`Alert logging failed:`, err.message);
    }
}
/**
 * Build the HTML email body for an admin alert.
 */
function buildAlertEmailHtml(alert, dashboardUrl) {
    const severityLabel = alert.severity.toUpperCase();
    const severityColor = severityLabel === 'CRITICAL' ? '#d32f2f' : '#e65100';
    const detailsHtml = alert.details
        ? `<details style="margin:12px 0"><summary style="cursor:pointer;font-weight:bold">Technical Details</summary><pre style="background:#f5f5f5;padding:12px;overflow:auto;font-size:12px">${typeof alert.details === 'string' ? alert.details : JSON.stringify(alert.details, null, 2)}</pre></details>`
        : '';
    const submissionLink = alert.submission_id
        ? `<p><a href="${dashboardUrl}/review/${alert.submission_id}">View Submission</a></p>`
        : '';
    return `
        <div style="font-family:sans-serif;max-width:600px">
            <h2 style="color:${severityColor};margin-bottom:4px">${severityLabel}: ${alert.alert_type.replace(/_/g, ' ')}</h2>
            <table style="border-collapse:collapse;width:100%;margin:12px 0">
                <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold;width:120px">Service</td><td style="padding:6px 12px">${alert.service}</td></tr>
                ${alert.submission_id ? `<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Submission</td><td style="padding:6px 12px">${alert.submission_id}</td></tr>` : ''}
                <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Time</td><td style="padding:6px 12px">${new Date().toISOString()}</td></tr>
            </table>
            <div style="background:#fff3e0;border-left:4px solid #e65100;padding:12px;margin:12px 0">
                <strong>Message:</strong><br>${alert.message}
            </div>
            ${detailsHtml}
            ${submissionLink}
        </div>
    `;
}
//# sourceMappingURL=alerts.js.map