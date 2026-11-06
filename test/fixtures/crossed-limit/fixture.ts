import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const path = 'src/pages/ManagerInbox.tsx';

const fixture: Fixture = {
  base: makeGraph({
    files: {
      [path]: {
        kind: 'page',
        complexity: { cognitive: 30 },
        functions: [
          fn('handleBulkEscalate', { line: 40, end_line: 70, cognitive: 11, cyclomatic: 6, nesting: 3, lines: 31, params: 1, time: 'O(n)' }),
          fn('render', { line: 80, end_line: 120, cognitive: 19, nesting: 2, lines: 41, params: 0, over: ['cognitive'], time: 'O(1)' }),
        ],
      },
    },
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [path]: {
        kind: 'page',
        complexity: { cognitive: 38 },
        functions: [
          fn('handleBulkEscalate', { line: 40, end_line: 82, cognitive: 19, cyclomatic: 8, nesting: 5, lines: 43, params: 1, over: ['cognitive', 'nesting'], time: 'O(n)' }),
          fn('render', { line: 92, end_line: 132, cognitive: 19, nesting: 2, lines: 41, params: 0, over: ['cognitive'], time: 'O(1)' }),
        ],
      },
    },
  }),
  changes: changes([path], { hunks: { [path]: [[55, 68]] } }),
};

export default fixture;
