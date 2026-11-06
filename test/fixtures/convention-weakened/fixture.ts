import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const pattern = {
  id: 'alias:@/',
  category: 'Imports',
  strength: 'rule',
  follow: 95,
  total: 100,
  unit: 'imports',
  title: 'Imports from another folder use the @/ path alias',
  rule: 'Imports from another folder use the @/ path alias, not ../ paths: 95 of 100.',
  example: 'src/hooks/useX.ts',
  exceptions: ['src/a.ts', 'src/b.ts'],
};

const files = { 'src/new.ts': { kind: 'util' }, 'src/a.ts': { kind: 'util' }, 'src/b.ts': { kind: 'util' } };

const fixture: Fixture = {
  base: makeGraph({ files, conventions: { patterns: [pattern] } }),
  head: makeGraph({
    git_sha: 'h000000',
    files,
    conventions: { patterns: [{ ...pattern, strength: 'mostly', follow: 95, total: 112, exceptions: ['src/a.ts', 'src/b.ts', 'src/new.ts'] }] },
  }),
  changes: changes(['src/new.ts'], { hunks: { 'src/new.ts': [[1, 40]] } }),
};

export default fixture;
