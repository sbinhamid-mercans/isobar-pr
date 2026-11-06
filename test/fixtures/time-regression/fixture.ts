import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const path = 'src/services/orders.ts';

const fixture: Fixture = {
  base: makeGraph({
    files: {
      [path]: {
        kind: 'service',
        complexity: { cognitive: 9 },
        functions: [
          fn('reconcile', {
            line: 41,
            end_line: 70,
            cognitive: 9,
            nesting: 2,
            lines: 30,
            params: 2,
            time: 'O(n)',
            time_why: [{ line: 52, text: 'a loop over orders' }],
          }),
        ],
      },
    },
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [path]: {
        kind: 'service',
        complexity: { cognitive: 12 },
        functions: [
          fn('reconcile', {
            line: 41,
            end_line: 78,
            cognitive: 12,
            nesting: 3,
            lines: 38,
            params: 2,
            time: 'O(n·m)',
            time_why: [{ line: 58, text: 'users.find() inside the loop over orders' }],
            refactor: [
              {
                kind: 'scan-in-loop',
                severity: 'high',
                title: 'Lookup inside a loop',
                line: 58,
                how: 'Build a Map of users by id first.',
                why: 'Each order scans the whole users array.',
              },
            ],
          }),
        ],
      },
    },
  }),
  changes: changes([path], { hunks: { [path]: [[56, 60]] } }),
};

export default fixture;
