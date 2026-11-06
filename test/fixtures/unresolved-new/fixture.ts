import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const files = { 'index.html': { kind: 'entry' }, 'src/pages/Lazy.tsx': { kind: 'page' } };

const fixture: Fixture = {
  base: makeGraph({ files, unresolved: [{ file: 'index.html', line: 54, spec: '/config.js', reason: 'not found' }] }),
  head: makeGraph({
    git_sha: 'h000000',
    files,
    unresolved: [
      { file: 'index.html', line: 54, spec: '/config.js', reason: 'not found' },
      { file: 'src/pages/Lazy.tsx', line: 9, expr: 'import(`./pages/${name}`)', reason: 'computed path' },
    ],
  }),
  changes: changes(['src/pages/Lazy.tsx', 'index.html'], { hunks: { 'src/pages/Lazy.tsx': [[8, 10]] } }),
};

export default fixture;
