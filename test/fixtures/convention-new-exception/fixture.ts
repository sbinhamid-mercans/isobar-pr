import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const pattern = {
  id: 'layer:hook>service',
  category: 'Architecture',
  strength: 'rule',
  follow: 206,
  total: 206,
  unit: 'imports',
  title: 'Hooks use services, never the other way round',
  rule: 'Services never import hooks: all 206 imports between them go hooks → services.',
  example: 'src/hooks/me/useSystemicIssuePreferences.ts',
  exceptions: [] as string[],
};

const files = {
  'src/services/foo.ts': { kind: 'service', complexity: { cognitive: 0 } },
  'src/services/pre.ts': { kind: 'service', complexity: { cognitive: 0 } },
};

const fixture: Fixture = {
  base: makeGraph({ files, conventions: { patterns: [{ ...pattern, follow: 206, total: 207, exceptions: ['src/services/pre.ts'] }] } }),
  head: makeGraph({
    git_sha: 'h000000',
    files,
    conventions: { patterns: [{ ...pattern, follow: 206, total: 208, exceptions: ['src/services/pre.ts', 'src/services/foo.ts'] }] },
  }),
  changes: changes(['src/services/foo.ts', 'src/services/pre.ts'], { hunks: { 'src/services/foo.ts': [[1, 3]], 'src/services/pre.ts': [[9, 9]] } }),
};

export default fixture;
