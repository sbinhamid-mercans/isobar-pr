import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const path = 'src/App.tsx';

// A function added to a file that already existed: the PR's added lines cover it entirely.
const fixture: Fixture = {
  base: makeGraph({ files: { [path]: { kind: 'router', complexity: { cognitive: 2 }, functions: [fn('App', { line: 1, end_line: 20, cognitive: 2 })] } } }),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [path]: {
        kind: 'router',
        complexity: { cognitive: 20 },
        functions: [fn('App', { line: 1, end_line: 20, cognitive: 2 }), fn('handleExport', { line: 22, end_line: 142, cognitive: 18, lines: 121, over: ['cognitive', 'lines'], time: 'O(n)' })],
      },
    },
  }),
  changes: changes([path], { hunks: { [path]: [[21, 143]] } }),
};

export default fixture;
