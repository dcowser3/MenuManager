"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const learning_signals_1 = require("../lib/learning-signals");
describe('learning replacement signal extraction', () => {
    test('extracts diacritic corrections when the same dish line remains', () => {
        const aiDraft = [
            'Pipian Verde, pumpkin seed sauce, chicken, onion 18',
            'Roasted Corn, cotija cheese, tajin 14',
        ].join('\n');
        const final = [
            'Pipián Verde, pumpkin seed sauce, chicken, onion 18',
            'Roasted Corn, cotija cheese, tajin 14',
        ].join('\n');
        const signals = (0, learning_signals_1.extractReplacementSignals)(aiDraft, final);
        expect(signals).toEqual([
            expect.objectContaining({
                from: 'Pipian',
                to: 'Pipián',
                kind: 'diacritic',
            }),
        ]);
    });
    test('ignores diacritic-like changes from a removed dish while learning remaining dish edits', () => {
        const aiDraft = [
            'Pipián Verde, cotija cheese, pipián sauce, tajin 14',
            'Roasted Corn, cotija cheese, pipian sauce, tajin 14',
        ].join('\n');
        const final = [
            'Roasted Corn, cotija cheese, pipian sauce, tajín 14',
        ].join('\n');
        const signals = (0, learning_signals_1.extractReplacementSignals)(aiDraft, final);
        expect(signals).toEqual([
            expect.objectContaining({
                from: 'tajin',
                to: 'tajín',
                kind: 'diacritic',
            }),
        ]);
        expect(signals).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                from_norm: 'pipián',
                to_norm: 'pipian',
            }),
        ]));
    });
});
