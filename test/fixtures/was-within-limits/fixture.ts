import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const path = 'src/utils/parse.ts';

// The base file exists but isobar emitted no entry for `parse` (it was trivial). The PR touched only part of it.
const fixture: Fixture = {
  base: makeGraph({ files: { [path]: { kind: 'util', complexity: { cognitive: 0 } } } }),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [path]: { kind: 'util', complexity: { cognitive: 18 }, functions: [fn('parse', { line: 3, end_line: 40, cognitive: 18, nesting: 3, lines: 38, params: 1, over: ['cognitive'], time: 'O(n)' })] },
    },
  }),
  changes: changes([path], { hunks: { [path]: [[10, 25]] } }),
};

export default fixture;
