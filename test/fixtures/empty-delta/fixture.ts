import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const file = {
  kind: 'service',
  complexity: { cognitive: 8 },
  functions: [fn('load', { line: 3, end_line: 20, cognitive: 8, cyclomatic: 4, nesting: 2, lines: 18, params: 1, time: 'O(n)' })],
};

const fixture: Fixture = {
  base: makeGraph({ files: { 'src/services/load.ts': file } }),
  head: makeGraph({ git_sha: 'h000000', files: { 'src/services/load.ts': file } }),
  changes: changes(['src/services/load.ts'], { hunks: { 'src/services/load.ts': [[5, 6]] } }),
};

export default fixture;
