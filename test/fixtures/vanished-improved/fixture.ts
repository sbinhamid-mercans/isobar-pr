import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const path = 'src/jobs/run.ts';

// The base function was over the lines limit; the head file still exists but isobar no longer emits the function.
const fixture: Fixture = {
  base: makeGraph({ files: { [path]: { kind: 'service', complexity: { cognitive: 10 }, functions: [fn('run', { line: 5, end_line: 134, cognitive: 10, lines: 130, over: ['lines'], time: 'O(n)' })] } } }),
  head: makeGraph({ git_sha: 'h000000', files: { [path]: { kind: 'service', complexity: { cognitive: 0 } } } }),
  changes: changes([path], { hunks: { [path]: [[5, 29]] }, deletions: { [path]: [30] } }),
};

export default fixture;
