import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const api = 'src/api/kb/kb.api.ts';

const fixture: Fixture = {
  base: makeGraph({
    files: { [api]: { kind: 'service', calls: [{ method: 'PATCH', path: '/kb/articles/:param', line: 146 }] } },
    http: { routes: [], matched: 0, dynamic: 0 },
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [api]: {
        kind: 'service',
        calls: [
          { method: 'PATCH', path: '/kb/articles/:param', line: 146 },
          { method: 'GET', path: '/kb/articles/:param/versions', line: 160 },
          { method: 'GET', path: null, line: 170, dynamic: true },
        ],
      },
    },
    http: { routes: [], matched: 0, dynamic: 1 },
  }),
  changes: changes([api], { hunks: { [api]: [[158, 172]] } }),
};

export default fixture;
