import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const big = fn('run', { line: 5, end_line: 130, cognitive: 10, nesting: 2, lines: 126, params: 0, over: ['lines'], time: 'O(n)' });

// The line-1 edit does not touch `run`; only the rename pairs it with base.
const fixture: Fixture = {
  base: makeGraph({
    files: { 'src/jobs/old-name.ts': { kind: 'service', complexity: { cognitive: 10 }, functions: [big] } },
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files: { 'src/jobs/new-name.ts': { kind: 'service', complexity: { cognitive: 10 }, functions: [big] } },
  }),
  changes: changes(['src/jobs/new-name.ts'], {
    renames: { 'src/jobs/new-name.ts': 'src/jobs/old-name.ts' },
    hunks: { 'src/jobs/new-name.ts': [[1, 1]] },
  }),
};

export default fixture;
