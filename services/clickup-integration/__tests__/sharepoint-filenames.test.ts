import {
    buildSharePointApprovedFilename,
    formatSharePointDateSegment,
} from '../lib/sharepoint-filenames';

describe('SharePoint approved menu filenames', () => {
    test('uses restaurant, service period, and date', () => {
        expect(buildSharePointApprovedFilename({
            property: 'Aqimero - Ritz-Carlton - Philadelphia',
            service_period: 'Breakfast',
            date_needed: '2023-11-06',
        })).toBe('Aqimero_Breakfast_11.6.23.docx');
    });

    test('normalizes folder-style service values', () => {
        expect(buildSharePointApprovedFilename({
            property: 'Toro - Hotel Clio - Denver',
            service_period: 'late_night',
            date_needed: '2026-05-11',
        })).toBe('Toro_Late Night_5.11.26.docx');
    });

    test('formats input dates without timezone drift', () => {
        expect(formatSharePointDateSegment('2023-11-06')).toBe('11.6.23');
    });
});
