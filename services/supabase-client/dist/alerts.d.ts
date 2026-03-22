export interface SystemAlert {
    alert_type: string;
    severity: 'warning' | 'error' | 'critical';
    service: string;
    submission_id?: string;
    message: string;
    details?: Record<string, any> | string;
}
/**
 * Log an alert to the system_alerts Supabase table.
 * Fire-and-forget — never throws.
 */
export declare function logAlert(alert: SystemAlert): Promise<void>;
/**
 * Build the HTML email body for an admin alert.
 */
export declare function buildAlertEmailHtml(alert: SystemAlert, dashboardUrl: string): string;
//# sourceMappingURL=alerts.d.ts.map