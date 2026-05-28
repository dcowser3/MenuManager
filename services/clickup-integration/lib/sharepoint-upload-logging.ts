type SharePointUploadLogDetails = Record<string, any>;

function compactLogDetails(details: SharePointUploadLogDetails): SharePointUploadLogDetails {
    return Object.fromEntries(
        Object.entries(details)
            .filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
}

export function buildSharePointUploadLogLine(event: string, details: SharePointUploadLogDetails = {}): string {
    return `[sharepoint-upload] ${event} ${JSON.stringify(compactLogDetails(details))}`;
}

export function logSharePointUploadEvent(event: string, details: SharePointUploadLogDetails = {}): void {
    console.log(buildSharePointUploadLogLine(event, details));
}
