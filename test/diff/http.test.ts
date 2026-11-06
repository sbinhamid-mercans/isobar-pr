import { describe, expect, test } from 'vitest';
import { buildIndex } from '../../src/graph/index.js';
import type { GraphFile, GraphV3, HttpCall, HttpRoute } from '../../src/graph/types.js';
import type { Finding } from '../../src/report/types.js';
import self from '../fixtures/http-self-contained/fixture.js';
import split from '../fixtures/http-split-repo/fixture.js';
import { changes, makeGraph, runFixture, type Fixture } from '../helpers/makeGraph.js';

const client = 'src/api/orders.ts';
const server = 'src/server/routes/orders.ts';
const api = 'src/api/kb/kb.api.ts';
/** A backend's own HTTP client (calls, no routes) for the activity tests. */
const orderClient = 'src/main/java/OrderClient.java';

/** The fixture's graph with `path` added or replaced. */
function withFile(graph: GraphV3, path: string, entry: GraphFile): GraphV3 {
  return { ...graph, files: { ...graph.files, [path]: entry } };
}

/** The head file's entry with `calls` / `serves` appended. */
function extended(graph: GraphV3, path: string, extra: { calls?: HttpCall[]; serves?: HttpRoute[] }): GraphV3 {
  const entry = graph.files[path] ?? {};
  return withFile(graph, path, { ...entry, calls: [...(entry.calls ?? []), ...(extra.calls ?? [])], serves: [...(entry.serves ?? []), ...(extra.serves ?? [])] });
}

function http(f: Fixture): Finding[] {
  return runFixture(f).findings.filter((x) => x.kind.startsWith('http-'));
}

describe('http rule', () => {
  test('in a self-contained repo a new static call with no route is reported; pre-existing and dynamic ones are not', () => {
    const found = http(self);
    expect(found.map((f) => [f.kind, f.file, f.line, f.inDiff])).toEqual([['http-unmatched-call', 'src/api/orders.ts', 40, true]]);
    expect(found[0]?.title).toBe('`GET /api/orders/export` has no matching route');
    expect(found[0]?.severity).toBe('medium');
  });

  test('uncalled routes only with the option', () => {
    const on = runFixture({ ...self, opts: { reportUncalledRoutes: true } }).findings.filter((f) => f.kind === 'http-uncalled-route');
    expect(on.map((f) => [f.file, f.line, f.title])).toEqual([
      ['src/server/routes/orders.ts', 30, '`DELETE /api/orders/:param` is a new route no client in this repo calls'],
    ]);
  });

  test('a split repo gets one info line with call deltas and no per-call findings', () => {
    const report = runFixture(split);
    expect(report.meta.httpActive).toBe(false);
    const found = report.findings.filter((f) => f.kind.startsWith('http-'));
    expect(found.map((f) => [f.kind, f.severity])).toEqual([['http-info', 'info']]);
    expect(found[0]?.title).toBe('HTTP calls in changed files: +1 static, +1 dynamic — no routes in this repo to match them against');
    expect(found[0]?.data).toEqual({ staticBase: 1, staticHead: 2, dynamicBase: 0, dynamicHead: 1 });
  });

  test('per-call findings carry raw method/path payloads and no renamedFrom without a rename; an uncalled route is low and in the diff', () => {
    const [call] = http(self);
    expect(call?.data).toEqual({ method: 'GET', path: '/api/orders/export' });
    expect(call?.renamedFrom).toBeUndefined();
    const [route] = http({ ...self, opts: { reportUncalledRoutes: true } }).filter((f) => f.kind === 'http-uncalled-route');
    expect([route?.severity, route?.inDiff, route?.renamedFrom]).toEqual(['low', true, undefined]);
    expect(route?.data).toEqual({ method: 'DELETE', path: '/api/orders/:param' });
  });

  test('the info line anchors on the changed file, is in the diff when hunks are known, and carries no renamedFrom without a rename', () => {
    const [info] = http(split);
    expect([info?.file, info?.inDiff, info?.renamedFrom]).toEqual([api, true, undefined]);
  });

  test('identity: the same graph on both sides yields no http findings, not even the info line', () => {
    expect(http({ ...self, base: self.head, opts: { reportUncalledRoutes: true } })).toEqual([]);
    expect(http({ ...split, base: split.head })).toEqual([]);
  });

  test('a client call whose route this PR removed is reported', () => {
    const calls = (self.head.files[client]?.calls ?? []).map((c): HttpCall => (c.line === 10 ? { method: c.method, path: c.path, line: c.line } : c));
    const serves = (self.head.files[server]?.serves ?? []).filter((r) => r.path !== '/api/orders');
    let head = withFile(self.head, client, { kind: 'service', calls });
    head = withFile(head, server, { kind: 'route', serves });
    head = { ...head, http: { routes: [{ method: 'DELETE', path: '/api/orders/:param', line: 30 }], matched: 0, dynamic: 1 } };
    expect(http({ ...self, head }).map((f) => [f.kind, f.line, f.inDiff, f.title])).toEqual([
      ['http-unmatched-call', 40, true, '`GET /api/orders/export` has no matching route'],
      ['http-unmatched-call', 10, false, '`GET /api/orders` has no matching route'],
    ]);
  });

  test('a pre-existing unmatched call in a renamed file is not re-reported; a new one carries renamedFrom', () => {
    const oldPath = 'src/api/legacy-orders.ts';
    const base = makeGraph({
      files: { [oldPath]: { kind: 'service', calls: [{ method: 'GET', path: '/api/legacy', line: 20 }] } },
      http: { routes: [{ method: 'GET', path: '/api/orders', line: 12 }], matched: 0, dynamic: 0 },
    });
    const head = makeGraph({
      git_sha: 'h000000',
      files: {
        [client]: {
          kind: 'service',
          calls: [
            { method: 'GET', path: '/api/legacy', line: 22 },
            { method: 'GET', path: '/api/orders/export', line: 40 },
          ],
        },
      },
      http: { routes: [{ method: 'GET', path: '/api/orders', line: 12 }], matched: 0, dynamic: 0 },
    });
    const found = http({ base, head, changes: changes([client], { renames: { [client]: oldPath }, hunks: { [client]: [[1, 50]] } }) });
    expect(found.map((f) => [f.kind, f.file, f.line, f.renamedFrom])).toEqual([['http-unmatched-call', client, 40, oldPath]]);
  });

  test('inDiff is false outside the hunks and undefined when hunks are unknown', () => {
    const outside = http({ ...self, changes: changes([client, server], { hunks: { [client]: [[1, 5]] } }) });
    expect(outside.map((f) => [f.kind, f.line, f.inDiff])).toEqual([['http-unmatched-call', 40, false]]);
    const unknown = http({ ...self, changes: changes([client, server]), opts: { reportUncalledRoutes: true } });
    expect(unknown.map((f) => [f.kind, f.line, f.inDiff])).toEqual([
      ['http-unmatched-call', 40, undefined],
      ['http-uncalled-route', 30, undefined],
    ]);
  });

  test('a new call that a route in this repo answers is not reported', () => {
    const answered: HttpCall = { method: 'DELETE', path: '/api/orders/7', line: 42, target: { file: server, method: 'DELETE', path: '/api/orders/:param', line: 30 } };
    const head = extended(self.head, client, { calls: [answered] });
    expect(http({ ...self, head }).map((f) => f.line)).toEqual([40]);
  });

  test('a call to an external host is never reported', () => {
    // isobar writes `host` only for non-external calls, so an external call carries `external` alone.
    const head = extended(self.head, client, { calls: [{ method: 'POST', path: '/v1/charges', line: 44, external: 'api.stripe.com' }] });
    expect(http({ ...self, head }).map((f) => f.data)).toEqual([{ method: 'GET', path: '/api/orders/export' }]);
  });

  test('a call in a file outside the change set is never reported', () => {
    const other = 'src/api/other.ts';
    const head = withFile(self.head, other, { kind: 'service', calls: [{ method: 'GET', path: '/api/unknown', line: 3 }] });
    expect(http({ ...self, head }).map((f) => f.file)).toEqual([client]);
  });

  test('a route base already served, or one with callers, is not an uncalled route', () => {
    const opts = { reportUncalledRoutes: true };
    const base = extended(self.base, server, { serves: [{ method: 'DELETE', path: '/api/orders/:param', line: 25, callers: [] }] });
    expect(http({ ...self, base, opts }).filter((f) => f.kind === 'http-uncalled-route')).toEqual([]);
    const called: HttpRoute = { method: 'POST', path: '/api/orders', line: 32, callers: [{ file: client, line: 50 }] };
    const head = extended(self.head, server, { serves: [called] });
    expect(http({ ...self, head, opts }).filter((f) => f.kind === 'http-uncalled-route').map((f) => f.line)).toEqual([30]);
  });

  test('head test-kind files are skipped: no unmatched call or uncalled route, and no part of the info counts', () => {
    const spec = 'src/api/orders.test.ts';
    const stub: GraphFile = {
      kind: 'test',
      calls: [{ method: 'GET', path: '/api/nope', line: 5 }],
      serves: [{ method: 'GET', path: '/mock/orders', line: 9, callers: [] }],
    };
    const active = { ...self, head: withFile(self.head, spec, stub), changes: changes([client, server, spec]), opts: { reportUncalledRoutes: true } };
    expect(http(active).map((f) => [f.kind, f.file])).toEqual([
      ['http-unmatched-call', client],
      ['http-uncalled-route', server],
    ]);
    const inactive = { ...split, head: withFile(split.head, spec, stub), changes: changes([api, spec]) };
    expect(http(inactive).map((f) => f.data)).toEqual([{ staticBase: 1, staticHead: 2, dynamicBase: 0, dynamicHead: 1 }]);
    const onlyTests = { ...split, base: split.head, head: withFile(split.head, spec, stub), changes: changes([api, spec]) };
    expect(http(onlyTests)).toEqual([]);
  });

  test('base test-kind files are skipped too: a stub renamed into a service file is new traffic', () => {
    const fixtureTest = 'src/api/orders.fixture.test.ts';
    const stub = 'src/api/stub.ts';
    const call: HttpCall = { method: 'GET', path: '/api/stub', line: 3 };
    const route: HttpRoute = { method: 'POST', path: '/api/stub', line: 9, callers: [] };
    const renamed = { renames: { [stub]: fixtureTest } };
    const active: Fixture = {
      base: withFile(self.base, fixtureTest, { kind: 'test', calls: [call], serves: [route] }),
      head: withFile(self.head, stub, { kind: 'service', calls: [call], serves: [route] }),
      changes: changes([client, server, stub], renamed),
      opts: { reportUncalledRoutes: true },
    };
    expect(http(active).map((f) => [f.kind, f.file, f.line, f.renamedFrom])).toEqual([
      ['http-unmatched-call', client, 40, undefined],
      ['http-unmatched-call', stub, 3, fixtureTest],
      ['http-uncalled-route', stub, 9, fixtureTest],
      ['http-uncalled-route', server, 30, undefined],
    ]);
    const inactive: Fixture = {
      base: withFile(split.base, fixtureTest, { kind: 'test', calls: [call] }),
      head: withFile(split.head, stub, { kind: 'service', calls: [call] }),
      changes: changes([stub], renamed),
    };
    expect(http(inactive).map((f) => [f.file, f.renamedFrom, f.title, f.data])).toEqual([
      [stub, fixtureTest, 'HTTP calls in changed files: +1 static, 0 dynamic — no routes in this repo to match them against', { staticBase: 0, staticHead: 1, dynamicBase: 0, dynamicHead: 0 }],
    ]);
  });

  test('the info line anchors on the first changed file whose own counts differ, with inDiff undefined when hunks are unknown', () => {
    const spec = 'src/__tests__/kb.test.ts';
    const articles = 'src/api/articles.api.ts';
    const unchanged: GraphFile = { kind: 'service', calls: [{ method: 'GET', path: '/kb/articles', line: 4 }] };
    const base = withFile(split.base, articles, unchanged);
    const head = withFile(withFile(split.head, spec, { kind: 'test', calls: [{ method: 'GET', path: '/kb', line: 1 }] }), articles, unchanged);
    // README.md, the test file and articles.api.ts all sort before the api file; none of them gained or lost a call.
    const found = http({ base, head, changes: changes(['README.md', spec, articles, api]) });
    expect(found.map((f) => [f.kind, f.file, f.inDiff])).toEqual([['http-info', api, undefined]]);
  });

  test('no info line when a call only moved between changed files', () => {
    const other = 'src/api/kb/other.api.ts';
    const call: HttpCall = { method: 'GET', path: '/kb/x', line: 2 };
    const base = withFile(withFile(split.base, api, { kind: 'service', calls: [call] }), other, { kind: 'service', calls: [] });
    const head = withFile(withFile(split.base, api, { kind: 'service', calls: [] }), other, { kind: 'service', calls: [call] });
    expect(http({ base, head, changes: changes([api, other]) })).toEqual([]);
  });

  test('the info line of a renamed file carries renamedFrom', () => {
    const oldPath = 'src/api/kb.api.ts';
    const base = makeGraph({ files: { [oldPath]: split.base.files[api]! } });
    const found = http({ ...split, base, changes: changes([api], { renames: { [api]: oldPath }, hunks: { [api]: [[158, 172]] } }) });
    expect(found.map((f) => [f.kind, f.file, f.renamedFrom, f.data])).toEqual([
      ['http-info', api, oldPath, { staticBase: 1, staticHead: 2, dynamicBase: 0, dynamicHead: 1 }],
    ]);
  });

  test('a backend repo with routes but no matchable calls says so instead of claiming there are no routes', () => {
    const routes = [{ method: 'GET', path: '/api/orders', line: 12 }];
    const base = makeGraph({ files: { [orderClient]: { kind: 'service', calls: [] } }, http: { routes, matched: 0, dynamic: 0 } });
    const head = makeGraph({
      git_sha: 'h000000',
      files: { [orderClient]: { kind: 'service', calls: [{ method: 'GET', path: null, line: 7, dynamic: true }] } },
      http: { routes, matched: 0, dynamic: 1 },
    });
    const report = runFixture({ base, head, changes: changes([orderClient]) });
    expect(report.meta.httpActive).toBe(false);
    expect(report.findings.filter((f) => f.kind.startsWith('http-')).map((f) => f.title)).toEqual([
      'HTTP calls in changed files: 0 static, +1 dynamic — no static calls in this repo to match its routes against',
    ]);
  });

  // httpActive is deliberately head-only (spec §7): the PR's own graph decides whether its calls can be matched.
  describe('activity is decided by head alone', () => {
    const routes = [{ method: 'GET', path: '/api/orders', line: 12 }];
    const dynamic: HttpCall = { method: 'GET', path: null, line: 7, dynamic: true };
    const inactive = makeGraph({ files: { [orderClient]: { kind: 'service', calls: [dynamic] } }, http: { routes, matched: 0, dynamic: 1 } });
    const active = makeGraph({
      git_sha: 'h000000',
      files: { [orderClient]: { kind: 'service', calls: [dynamic, { method: 'GET', path: '/api/reports', line: 12 }] } },
      http: { routes, matched: 0, dynamic: 1 },
    });

    test('a PR that adds the first matchable call gets an unmatched-call finding and no info line', () => {
      expect([buildIndex(inactive).httpActive, buildIndex(active).httpActive]).toEqual([false, true]);
      const found = http({ base: inactive, head: active, changes: changes([orderClient]) });
      expect(found.map((f) => [f.kind, f.severity, f.line])).toEqual([['http-unmatched-call', 'medium', 12]]);
    });

    test('a PR that removes the last matchable call gets the info line', () => {
      const found = http({ base: active, head: inactive, changes: changes([orderClient]) });
      expect(found.map((f) => [f.kind, f.title])).toEqual([
        ['http-info', 'HTTP calls in changed files: -1 static, 0 dynamic — no static calls in this repo to match its routes against'],
      ]);
    });
  });
});
