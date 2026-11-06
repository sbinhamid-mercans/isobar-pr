import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const files = { 'src/a.ts': { kind: 'util', complexity: { cognitive: 0 } } };

const fixture: Fixture = {
  base: makeGraph({ files }),
  head: makeGraph({ git_sha: 'h000000', files }),
  changes: changes(['.isobar.json', 'src/a.ts']),
};

export default fixture;
