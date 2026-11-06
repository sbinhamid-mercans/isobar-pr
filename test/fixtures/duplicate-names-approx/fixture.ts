import type { GraphFunction } from '../../../src/graph/types.js';
import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const path = 'src/components/Dashboard.tsx';
const cb = (line: number, extra: Partial<GraphFunction> = {}) =>
  fn('Dashboard › useEffect callback', { line, end_line: line + 8, cognitive: 3, nesting: 1, lines: 9, params: 0, time: 'O(1)', ...extra });

// Base: one callback over the cognitive limit, one within. Head: the within one is kept (pairs by fingerprint),
// plus two different over-limit callbacks. Leftovers on both sides (1 vs 2) → approximate net count.
const fixture: Fixture = {
  base: makeGraph({
    files: {
      [path]: {
        kind: 'component',
        complexity: { cognitive: 23 },
        functions: [fn('Dashboard', { line: 1, end_line: 80, cognitive: 4 }), cb(20, { cognitive: 16, over: ['cognitive'] }), cb(40)],
      },
    },
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [path]: {
        kind: 'component',
        complexity: { cognitive: 28 },
        functions: [
          fn('Dashboard', { line: 1, end_line: 95, cognitive: 4 }),
          cb(20),
          cb(30, { cognitive: 18, nesting: 5, over: ['cognitive', 'nesting'] }),
          cb(50, { cyclomatic: 12, over: ['cyclomatic'] }),
        ],
      },
    },
  }),
  changes: changes([path], { hunks: { [path]: [[28, 60]] } }),
};

export default fixture;
