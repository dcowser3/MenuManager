const { appendExpectationArtifactArgs } = require('../lib/improvement-cycle-wiring');

test('every improvement-cycle eval arm receives the identical derived artifact path', () => {
    const path = '/tmp/derived-expectations.json';
    const arms = [
        appendExpectationArtifactArgs(['--rules', 'live'], path),
        appendExpectationArtifactArgs(['--rules', 'candidate:x', '--baseline', 'b'], path),
        appendExpectationArtifactArgs(['--rules', 'candidate:x', '--baseline', 'b', '--case', 'a'], path),
    ];
    expect(arms.map((args) => args.slice(-2))).toEqual([['--expectations', path], ['--expectations', path], ['--expectations', path]]);
});
