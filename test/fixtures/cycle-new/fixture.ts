import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const a = 'src/services/a.ts';
const b = 'src/services/b.ts';
const c = 'src/services/c.ts';
const d = 'src/services/d.ts';
const files = { [a]: { kind: 'service' }, [b]: { kind: 'service' }, [c]: { kind: 'service' }, [d]: { kind: 'service' } };

const fixture: Fixture = {
  base: makeGraph({ files, cycles: [[a, b]] }),
  head: makeGraph({ git_sha: 'h000000', files, cycles: [[b, a], [d, c]] }),
  changes: changes([c], { hunks: { [c]: [[1, 5]] } }),
};

export default fixture;
