"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const eval_scoring_1 = require("../lib/eval-scoring");
const RAW = [
    'DINNER MENU',
    'caesar salad, romain, parmesean 14',
    'jalapeno poppers, queso fresco 9',
    'short rib, tomatillo sauce 54',
].join('\n');
// Human reviewer fixed two description spellings AND the diacritic.
const TRUTH = [
    'DINNER MENU',
    'caesar salad, romaine, parmesan 14',
    'jalapeño poppers, queso fresco 9',
    'short rib, tomatillo sauce 54',
].join('\n');
// Candidate fixed the spellings, missed the diacritic, and overcorrected a word
// the human left alone (tomatillo -> tomatilla).
const CANDIDATE = [
    'DINNER MENU',
    'caesar salad, romaine, parmesan 14',
    'jalapeno poppers, queso fresco 9',
    'short rib, tomatilla sauce 54',
].join('\n');
describe('scoreCorrections', () => {
    test('perfect candidate output yields full recall/precision and no remaining diffs', () => {
        const score = (0, eval_scoring_1.scoreCorrections)(RAW, TRUTH, TRUTH);
        expect(score.falseNegatives).toBe(0);
        expect(score.falsePositives).toBe(0);
        expect(score.truePositives).toBe(3);
        expect(score.precision).toBe(1);
        expect(score.recall).toBe(1);
        expect(score.f1).toBe(1);
        expect(score.remainingDiffCount).toBe(0);
    });
    test('partial candidate output is scored with TP, FN, and FP', () => {
        const score = (0, eval_scoring_1.scoreCorrections)(RAW, CANDIDATE, TRUTH);
        expect(score.matched.map((m) => `${m.from}->${m.to}`)).toEqual(expect.arrayContaining(['romain->romaine', 'parmesean->parmesan']));
        expect(score.missed.map((m) => `${m.from}->${m.to}`)).toContain('jalapeno->jalapeño');
        expect(score.extra.map((m) => `${m.from}->${m.to}`)).toContain('tomatillo->tomatilla');
        expect(score.truePositives).toBe(2);
        expect(score.falseNegatives).toBe(1);
        expect(score.falsePositives).toBe(1);
        expect(score.precision).toBeCloseTo(2 / 3);
        expect(score.recall).toBeCloseTo(2 / 3);
        expect(score.remainingDiffCount).toBeGreaterThan(0);
        expect(score.byKind.spelling?.truePositives).toBe(2);
        expect(score.byKind.diacritic?.falseNegatives).toBe(1);
    });
    test('unchanged candidate has zero recall when truth contains corrections', () => {
        const score = (0, eval_scoring_1.scoreCorrections)(RAW, RAW, TRUTH);
        expect(score.truePositives).toBe(0);
        expect(score.falseNegatives).toBe(3);
        expect(score.recall).toBe(0);
    });
    test('corrections to the leading dish-name token are excluded by design', () => {
        // The differ's dish-identity guard skips lines whose pre-comma identity
        // changed, so a "ceasar salad" -> "caesar salad" fix produces no token
        // signal. It still surfaces through document-similarity metrics.
        const raw = 'ceasar salad, romaine 14';
        const truth = 'caesar salad, romaine 14';
        const score = (0, eval_scoring_1.scoreCorrections)(raw, truth, truth);
        expect(score.truePositives).toBe(0);
        expect(score.falseNegatives).toBe(0);
        expect(score.remainingDiffCount).toBe(0);
    });
});
describe('compositeCaseScore', () => {
    test('falls back to similarity when no correction signals exist', () => {
        const score = (0, eval_scoring_1.scoreCorrections)(RAW, RAW, RAW);
        expect((0, eval_scoring_1.compositeCaseScore)(0.97, score)).toBe(0.97);
    });
    test('blends similarity and F1 when corrections exist', () => {
        const score = (0, eval_scoring_1.scoreCorrections)(RAW, CANDIDATE, TRUTH);
        const composite = (0, eval_scoring_1.compositeCaseScore)(0.99, score);
        expect(composite).toBeCloseTo(0.6 * 0.99 + 0.4 * score.f1, 10);
    });
});
describe('classifyConfirmedRegression', () => {
    // Args are a back-to-back fresh pair: (baselineFresh, candidateFresh).
    test('noise: fresh back-to-back pair is within the band (gap was temporal drift)', () => {
        const r = (0, eval_scoring_1.classifyConfirmedRegression)(0.80, 0.79);
        expect(r.confirmed).toBe(false);
        expect(r.reason).toContain('temporal drift');
    });
    test('confirmed: candidate still materially below baseline on the fresh pair', () => {
        const r = (0, eval_scoring_1.classifyConfirmedRegression)(0.80, 0.55);
        expect(r.confirmed).toBe(true);
        expect(r.reason).toContain('back-to-back');
    });
    test('exactly at the floor is not confirmed (must exceed it)', () => {
        expect((0, eval_scoring_1.classifyConfirmedRegression)(0.80, 0.78).confirmed).toBe(false);
        expect((0, eval_scoring_1.classifyConfirmedRegression)(0.80, 0.779).confirmed).toBe(true);
    });
    test('candidate above baseline on the fresh pair is never a regression', () => {
        expect((0, eval_scoring_1.classifyConfirmedRegression)(0.80, 0.85).confirmed).toBe(false);
    });
    test('custom noise epsilon widens/narrows the band', () => {
        expect((0, eval_scoring_1.classifyConfirmedRegression)(0.80, 0.74, 0.10).confirmed).toBe(false);
        expect((0, eval_scoring_1.classifyConfirmedRegression)(0.80, 0.68, 0.10).confirmed).toBe(true);
    });
});
