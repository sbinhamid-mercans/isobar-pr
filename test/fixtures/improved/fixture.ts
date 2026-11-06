import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const path = 'src/components/MessageView.tsx';

const fixture: Fixture = {
  base: makeGraph({
    files: {
      [path]: {
        kind: 'component',
        complexity: { cognitive: 22 },
        functions: [fn('render', { line: 10, end_line: 90, cognitive: 22, nesting: 3, lines: 81, params: 1, over: ['cognitive'], time: 'O(1)' })],
      },
    },
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [path]: {
        kind: 'component',
        complexity: { cognitive: 13 },
        functions: [fn('render', { line: 10, end_line: 60, cognitive: 13, nesting: 2, lines: 51, params: 1, time: 'O(1)' })],
      },
    },
  }),
  changes: changes([path], { hunks: { [path]: [[12, 60]] } }),
};

export default fixture;
