import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const a = 'src/services/a.ts';
const b = 'src/services/b.ts';
const files = { [a]: { kind: 'service' }, [b]: { kind: 'service' } };

const fixture: Fixture = {
  base: makeGraph({ files, cycles: [[a, b]] }),
  head: makeGraph({ git_sha: 'h000000', files, cycles: [] }),
  changes: changes([a], { hunks: { [a]: [[1, 5]] } }),
};

export default fixture;
