import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

// isobar lists the 50 alphabetically smallest exceptions and keeps the true total in `exceptionCount`.
// Base lists file00…file49 of 60. In head (40 exceptions, listed in full, so no `exceptionCount`):
// - src/legacy/aaa.ts sorts before base's last listed entry, so it is provably new;
// - src/zz/New_Thing.ts sorts after it, so it may be one of base's 10 unlisted exceptions.
const many = Array.from({ length: 50 }, (_, i) => `src/legacy/file${String(i).padStart(2, '0')}.ts`);
const pattern = {
  id: 'naming:camel',
  strength: 'rule',
  title: 'Utils use camelCase file names',
  example: 'src/utils/formatDate.ts',
};

const files = { 'src/legacy/aaa.ts': { kind: 'util' }, 'src/zz/New_Thing.ts': { kind: 'util' } };

const fixture: Fixture = {
  base: makeGraph({
    files,
    conventions: { patterns: [{ ...pattern, follow: 900, total: 960, rule: 'Utils use camelCase file names: 900 of 960.', exceptions: many, exceptionCount: 60 }] },
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files,
    conventions: {
      patterns: [
        { ...pattern, follow: 900, total: 940, rule: 'Utils use camelCase file names: 900 of 940.', exceptions: ['src/legacy/aaa.ts', ...many.slice(0, 38), 'src/zz/New_Thing.ts'] },
      ],
    },
  }),
  changes: changes(['src/legacy/aaa.ts', 'src/zz/New_Thing.ts'], { hunks: { 'src/legacy/aaa.ts': [[1, 5]], 'src/zz/New_Thing.ts': [[1, 10]] } }),
};

export default fixture;
