import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const client = 'src/api/orders.ts';
const server = 'src/server/routes/orders.ts';
const routes = [{ method: 'GET', path: '/api/orders', line: 12 }];

const fixture: Fixture = {
  base: makeGraph({
    files: {
      [client]: { kind: 'service', calls: [{ method: 'GET', path: '/api/orders', line: 10, target: { file: server, method: 'GET', path: '/api/orders', line: 12 } }, { method: 'GET', path: '/api/legacy', line: 20 }] },
      [server]: { kind: 'route', serves: [{ method: 'GET', path: '/api/orders', line: 12, callers: [{ file: client, line: 10, method: 'GET', path: '/api/orders' }] }] },
    },
    http: { routes, matched: 1, dynamic: 0 },
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [client]: {
        kind: 'service',
        calls: [
          { method: 'GET', path: '/api/orders', line: 10, target: { file: server, method: 'GET', path: '/api/orders', line: 12 } },
          { method: 'GET', path: '/api/legacy', line: 20 },
          { method: 'GET', path: '/api/orders/export', line: 40 },
          { method: 'POST', path: null, line: 48, dynamic: true },
        ],
      },
      [server]: {
        kind: 'route',
        serves: [
          { method: 'GET', path: '/api/orders', line: 12, callers: [{ file: client, line: 10, method: 'GET', path: '/api/orders' }] },
          { method: 'DELETE', path: '/api/orders/:param', line: 30, callers: [] },
        ],
      },
    },
    http: { routes: [...routes, { method: 'DELETE', path: '/api/orders/:param', line: 30 }], matched: 1, dynamic: 1 },
  }),
  changes: changes([client, server], { hunks: { [client]: [[38, 50]], [server]: [[28, 34]] } }),
};

export default fixture;
