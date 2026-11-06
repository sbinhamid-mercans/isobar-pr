import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const files = { 'src/stores/cart.ts': { kind: 'state' }, 'src/pages/Cart.tsx': { kind: 'page' } };

const fixture: Fixture = {
  base: makeGraph({ files, conventions: { patterns: [] } }),
  head: makeGraph({
    git_sha: 'h000000',
    files,
    conventions: {
      patterns: [
        {
          id: 'lib:zustand',
          strength: 'rule',
          follow: 9,
          total: 10,
          title: 'Only src/stores/ import zustand',
          rule: 'Only src/stores/ import zustand: 9 of 10 files that use it.',
          example: 'src/stores/cart.ts',
          exceptions: ['src/pages/Cart.tsx'],
        },
      ],
    },
  }),
  changes: changes(['src/pages/Cart.tsx', 'src/stores/cart.ts']),
};

export default fixture;
