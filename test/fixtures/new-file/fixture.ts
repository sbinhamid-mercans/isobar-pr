import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const path = 'src/utils/parse.ts';

// A file the PR added: every function is new, and only the one over a limit is reported.
const fixture: Fixture = {
  base: makeGraph(),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [path]: {
        kind: 'util',
        complexity: { cognitive: 23 },
        functions: [
          fn('parseRow', { line: 3, end_line: 60, cognitive: 21, cyclomatic: 14, nesting: 4, lines: 58, params: 2, over: ['cognitive', 'cyclomatic'], time: 'O(n)' }),
          fn('helper', { line: 62, end_line: 70, cognitive: 2, nesting: 1, lines: 9, params: 1, time: 'O(1)' }),
        ],
      },
    },
  }),
  changes: changes([path], { hunks: { [path]: [[1, 70]] } }),
};

export default fixture;
