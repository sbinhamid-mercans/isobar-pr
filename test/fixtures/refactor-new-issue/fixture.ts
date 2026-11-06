import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const path = 'src/components/EditAccountAside.tsx';

const fixture: Fixture = {
  base: makeGraph({
    files: {
      [path]: {
        kind: 'component',
        complexity: { cognitive: 14 },
        functions: [fn('handleSave', { line: 581, end_line: 640, cognitive: 14, nesting: 3, lines: 60, params: 0, time: 'O(n)' })],
      },
    },
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [path]: {
        kind: 'component',
        complexity: { cognitive: 14 },
        functions: [
          fn('handleSave', {
            line: 581,
            end_line: 690,
            cognitive: 14,
            nesting: 3,
            lines: 110,
            params: 0,
            over: ['lines'],
            time: 'O(n)',
            refactor: [
              {
                kind: 'long-function',
                severity: 'medium',
                title: 'A 110-line function',
                line: 581,
                how: 'Split it by responsibility: loading, deciding and saving usually belong in separate functions.',
                why: 'At 110 lines (limit 100) it does several jobs, so a change to one risks the others.',
              },
            ],
          }),
        ],
      },
    },
  }),
  changes: changes([path], { hunks: { [path]: [[640, 690]] } }),
};

export default fixture;
