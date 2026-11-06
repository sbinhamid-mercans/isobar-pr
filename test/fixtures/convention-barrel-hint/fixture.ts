import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

/**
 * A `barrel:` pattern's example is the barrel (index file) itself, so its advice says to import through it, not to
 * copy it (arbites, Task 25: "Copy `src/api/core/index.ts` instead" on a file that imported a core module directly).
 */
const pattern = {
  id: 'barrel:src/api/core',
  category: 'Imports',
  strength: 'rule',
  follow: 73,
  total: 80,
  unit: 'imports',
  title: 'Import src/api/core/ through its index file',
  rule: 'Other folders import src/api/core/ through index.ts, not its individual files: 73 of 80 imports.',
  example: 'src/api/core/index.ts',
  exceptions: ['src/lib/legacy.ts'],
};

const breaker = 'src/hooks/organizations/useCreateOrganization.ts';
const files = {
  [breaker]: { kind: 'hook', complexity: { cognitive: 2 } },
  'src/lib/legacy.ts': { kind: 'util', complexity: { cognitive: 0 } },
};

const fixture: Fixture = {
  base: makeGraph({ files: { 'src/lib/legacy.ts': files['src/lib/legacy.ts'] }, conventions: { patterns: [pattern] } }),
  head: makeGraph({
    git_sha: 'h000000',
    files,
    conventions: { patterns: [{ ...pattern, total: 81, exceptions: ['src/hooks/organizations/useCreateOrganization.ts', 'src/lib/legacy.ts'] }] },
  }),
  changes: changes([breaker], { hunks: { [breaker]: [[1, 24]] } }),
};

export default fixture;
