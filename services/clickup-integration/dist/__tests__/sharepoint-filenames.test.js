"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sharepoint_filenames_1 = require("../lib/sharepoint-filenames");
describe('SharePoint approved menu filenames', () => {
    test('uses restaurant, service period, and date', () => {
        expect((0, sharepoint_filenames_1.buildSharePointApprovedFilename)({
            property: 'Aqimero - Ritz-Carlton - Philadelphia',
            service_period: 'Breakfast',
            date_needed: '2023-11-06',
        })).toBe('Aqimero_Breakfast_11.6.23.docx');
    });
    test('normalizes folder-style service values', () => {
        expect((0, sharepoint_filenames_1.buildSharePointApprovedFilename)({
            property: 'Toro - Hotel Clio - Denver',
            service_period: 'late_night',
            date_needed: '2026-05-11',
        })).toBe('Toro_Late Night_5.11.26.docx');
    });
    test('formats input dates without timezone drift', () => {
        expect((0, sharepoint_filenames_1.formatSharePointDateSegment)('2023-11-06')).toBe('11.6.23');
    });
});
