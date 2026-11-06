import { describe, expect, test } from 'vitest';
import type { ConventionPattern, GraphFile, GraphFunction, SecurityWarning } from '../../src/graph/types.js';
import type { PreExisting, SummaryKey } from '../../src/report/types.js';
import exception from '../fixtures/convention-new-exception/fixture.js';
import crossed from '../fixtures/crossed-limit/fixture.js';
import cycleGrew from '../fixtures/cycle-grew/fixture.js';
import cycleNew from '../fixtures/cycle-new/fixture.js';
import self from '../fixtures/http-self-contained/fixture.js';
import renamed from '../fixtures/renamed-file/fixture.js';
import grew from '../fixtures/security-grew/fixture.js';
import { changes, fn, makeGraph, runFixture, type Fixture } from '../helpers/makeGraph.js';

const rowOf = (f: Fixture, key: SummaryKey) => runFixture(f).summary.find((r) => r.key === key);

describe('summary rows', () => {
  test('counts over changed files on both sides and signs the delta', () => {
    expect(runFixture(crossed).summary).toEqual([
      { key: 'cognitive', label: 'Cognitive complexity', base: 30, head: 38, delta: '+8' },
      { key: 'over-limit', label: 'Functions over a limit', base: 1, head: 2, delta: '+1' },
      { key: 'convention-exceptions', label: 'Convention exceptions', base: 0, head: 0, delta: '0' },
      { key: 'security', label: 'Security warnings serious / advisory', base: '0 / 0', head: '0 / 0', delta: '0 / 0' },
      { key: 'cycles', label: 'Circular imports', base: 0, head: 0, delta: '0' },
    ]);
  });

  test('counts warning occurrences, not warnings', () => {
    const row = runFixture(grew).summary.find((r) => r.key === 'security');
    expect(row).toEqual({ key: 'security', label: 'Security warnings serious / advisory', base: '2 / 0', head: '3 / 0', delta: '+1 / 0' });
  });

  test('adds the HTTP row only when routes can be matched in this repo', () => {
    const { summary } = runFixture(self);
    expect(summary.map((r) => r.key)).toContain('http-unmatched');
    expect(summary.at(-1)).toEqual({ key: 'http-unmatched', label: 'HTTP calls with no route', base: 1, head: 2, delta: '+1' });
    expect(runFixture(crossed).summary.map((r) => r.key)).not.toContain('http-unmatched');
  });

  test('reads the base side through renames', () => {
    const { summary } = runFixture(renamed);
    expect(summary.find((r) => r.key === 'cognitive')).toEqual({ key: 'cognitive', label: 'Cognitive complexity', base: 10, head: 10, delta: '0' });
    expect(summary.find((r) => r.key === 'over-limit')).toEqual({ key: 'over-limit', label: 'Functions over a limit', base: 1, head: 1, delta: '0' });
  });

  describe('security', () => {
    const svc = 'src/services/db.ts';
    const other = 'src/services/other.ts';
    const files = { [svc]: { kind: 'service' }, [other]: { kind: 'service' } };
    const w = (over: Partial<SecurityWarning>): SecurityWarning => ({ level: 'serious', text: 'SQL is built from input.', file: svc, line: 10, ...over });

    test('a warning without lines is one occurrence; every level but serious is advisory; unchanged files do not count', () => {
      const head = [
        w({}),
        w({ level: 'advisory', text: 'eval is used.', line: 3, lines: [3, 7] }),
        w({ level: 'note', text: 'Weak hash.', line: 30, lines: [30] }),
        w({ file: other, text: 'Hard-coded secret.', lines: [1, 2, 3] }),
      ];
      const fixture: Fixture = { base: makeGraph({ files }), head: makeGraph({ files, security: { warnings: head } }), changes: changes([svc]) };
      expect(rowOf(fixture, 'security')).toEqual({ key: 'security', label: 'Security warnings serious / advisory', base: '0 / 0', head: '1 / 3', delta: '+1 / +3' });
    });

    test('an empty lines list also counts as one occurrence', () => {
      const fixture: Fixture = { base: makeGraph({ files }), head: makeGraph({ files, security: { warnings: [w({ lines: [] })] } }), changes: changes([svc]) };
      expect(rowOf(fixture, 'security')?.head).toBe('1 / 0');
    });
  });

  describe('http-unmatched', () => {
    const api = 'src/api/orders.ts';
    const spec = 'src/api/orders.test.ts';
    const idle = 'src/api/idle.ts';
    const server = 'src/server/routes.ts';
    const routes = [{ method: 'GET', path: '/api/orders', line: 3 }];
    const matched = { method: 'GET', path: '/api/orders', line: 5, target: { file: server, method: 'GET', path: '/api/orders', line: 3 } };
    const unmatched = (path: string, line = 9) => ({ method: 'GET', path, line });
    const base: Record<string, GraphFile> = {
      [api]: { kind: 'service', calls: [matched] },
      [spec]: { kind: 'test', calls: [unmatched('/api/stub')] },
      [idle]: { kind: 'service', calls: [unmatched('/api/idle')] },
      [server]: { kind: 'route', serves: [{ ...routes[0]!, callers: [{ file: api, line: 5 }] }] },
    };

    test('counts unmatched static calls in changed non-test files only', () => {
      const head: Record<string, GraphFile> = {
        ...base,
        [api]: { kind: 'service', calls: [matched, unmatched('/api/missing'), { method: 'POST', path: null, line: 12, dynamic: true }, { method: 'GET', path: '/v1', line: 14, external: 'api.example.com' }] },
        [spec]: { kind: 'test', calls: [unmatched('/api/stub'), unmatched('/api/other-stub', 20)] },
      };
      const fixture: Fixture = {
        base: makeGraph({ files: base, http: { routes } }),
        head: makeGraph({ files: head, http: { routes } }),
        changes: changes([api, spec]),
      };
      expect(rowOf(fixture, 'http-unmatched')).toEqual({ key: 'http-unmatched', label: 'HTTP calls with no route', base: 0, head: 1, delta: '+1' });
    });

    test('judges test kind on each side by its own entry, through renames', () => {
      const moved = 'src/api/legacy.ts';
      const wasSpec = 'src/api/legacy.test.ts';
      const fixture: Fixture = {
        base: makeGraph({ files: { ...base, [wasSpec]: { kind: 'test', calls: [unmatched('/api/legacy')] } }, http: { routes } }),
        head: makeGraph({ files: { ...base, [moved]: { kind: 'service', calls: [unmatched('/api/legacy')] } }, http: { routes } }),
        changes: changes([moved], { renames: { [moved]: wasSpec } }),
      };
      expect(rowOf(fixture, 'http-unmatched')).toEqual({ key: 'http-unmatched', label: 'HTTP calls with no route', base: 0, head: 1, delta: '+1' });
    });
  });

  describe('cycles', () => {
    test('counts cycles with at least one changed member on each side', () => {
      // Base's [a, b] has no changed member (only c changed), so it does not count; head's [a, b, c] does.
      expect(rowOf(cycleGrew, 'cycles')).toEqual({ key: 'cycles', label: 'Circular imports', base: 0, head: 1, delta: '+1' });
      expect(rowOf(cycleNew, 'cycles')).toEqual({ key: 'cycles', label: 'Circular imports', base: 0, head: 1, delta: '+1' });
    });

    test('a renamed member counts on the base side under its base path', () => {
      const x = 'src/x.ts';
      const fixture: Fixture = {
        base: makeGraph({ files: { 'src/old.ts': {}, [x]: {} }, cycles: [['src/old.ts', x]] }),
        head: makeGraph({ files: { 'src/new.ts': {}, [x]: {} }, cycles: [['src/new.ts', x]] }),
        changes: changes(['src/new.ts'], { renames: { 'src/new.ts': 'src/old.ts' } }),
      };
      expect(rowOf(fixture, 'cycles')).toEqual({ key: 'cycles', label: 'Circular imports', base: 1, head: 1, delta: '0' });
    });
  });

  describe('convention exceptions', () => {
    const pattern = (id: string, exceptions: string[]): ConventionPattern => ({ id, strength: 'rule', follow: 9, total: 10, title: id, rule: id, exceptions });

    test('counts changed files listed in a pattern on each side', () => {
      expect(rowOf(exception, 'convention-exceptions')).toEqual({ key: 'convention-exceptions', label: 'Convention exceptions', base: 1, head: 2, delta: '+1' });
    });

    test('counts (pattern, file) pairs: a changed file listed by two patterns counts twice; unchanged files never count', () => {
      const foo = 'src/services/foo.ts';
      const files = { [foo]: {}, 'src/services/idle.ts': {} };
      const fixture: Fixture = {
        base: makeGraph({ files }),
        head: makeGraph({ files, conventions: { patterns: [pattern('p1', [foo]), pattern('p2', [foo, 'src/services/idle.ts'])] } }),
        changes: changes([foo]),
      };
      expect(rowOf(fixture, 'convention-exceptions')).toEqual({ key: 'convention-exceptions', label: 'Convention exceptions', base: 0, head: 2, delta: '+2' });
    });

    test('a file one pattern lists twice counts once', () => {
      const foo = 'src/services/foo.ts';
      const files = { [foo]: {} };
      const fixture: Fixture = {
        base: makeGraph({ files }),
        head: makeGraph({ files, conventions: { patterns: [pattern('p1', [foo, foo])] } }),
        changes: changes([foo]),
      };
      expect(rowOf(fixture, 'convention-exceptions')).toEqual({ key: 'convention-exceptions', label: 'Convention exceptions', base: 0, head: 1, delta: '+1' });
    });
  });
});

describe('pre-existing', () => {
  test('lists over-limit functions unchanged between sides, through renames', () => {
    expect(runFixture(renamed).preExisting).toEqual([{ file: 'src/jobs/new-name.ts', line: 5, text: 'run over lines' }]);
  });

  test('lists the function already over the limit in crossed-limit', () => {
    expect(runFixture(crossed).preExisting).toEqual([{ file: 'src/pages/ManagerInbox.tsx', line: 92, text: 'render over cognitive' }]);
  });

  describe('functions', () => {
    const file = 'src/parse.ts';
    const other = 'src/other.ts';
    const fnCase = (baseFns: GraphFunction[], headFns: GraphFunction[]): Fixture => ({
      base: makeGraph({ files: { [file]: { kind: 'service', functions: baseFns } } }),
      head: makeGraph({ files: { [file]: { kind: 'service', functions: headFns } } }),
      changes: changes([file]),
    });
    const listed = (baseFns: GraphFunction[], headFns: GraphFunction[]): PreExisting[] => runFixture(fnCase(baseFns, headFns)).preExisting;

    test('pairs same-name functions as a multiset: a reordered duplicate is still pre-existing', () => {
      const base = [fn('parse', { line: 10, over: ['cognitive'] }), fn('parse', { line: 50, over: ['lines'] })];
      const head = [fn('parse', { line: 10, over: ['lines'] }), fn('parse', { line: 50, over: ['cognitive'] })];
      expect(listed(base, head)).toEqual([
        { file, line: 10, text: 'parse over lines' },
        { file, line: 50, text: 'parse over cognitive' },
      ]);
    });

    test('compares `over` as a sorted set: the order isobar lists the limits in does not matter', () => {
      expect(listed([fn('load', { line: 3, over: ['nesting', 'cognitive'] })], [fn('load', { line: 4, over: ['cognitive', 'nesting'] })])).toEqual([
        { file, line: 4, text: 'load over cognitive, nesting' },
      ]);
    });

    test('each base function vouches for one head function, claimed in head source order', () => {
      const base = [fn('parse', { line: 10, over: ['cognitive'] })];
      const head = [fn('parse', { line: 10, over: ['cognitive'] }), fn('parse', { line: 60, over: ['cognitive'] })];
      expect(listed(base, head)).toEqual([{ file, line: 10, text: 'parse over cognitive' }]);
    });

    test('a same-name function the PR added whole never claims the base twin: the existing one keeps it', () => {
      // Six lines added above the old `parse` (L14 in base) push it to L20; the new copy at L5–10 is wholly added.
      const fixture: Fixture = {
        base: makeGraph({ files: { [file]: { kind: 'service', functions: [fn('parse', { line: 14, end_line: 24, over: ['cognitive'] })] } } }),
        head: makeGraph({
          files: {
            [file]: {
              kind: 'service',
              functions: [fn('parse', { line: 5, end_line: 10, over: ['cognitive'] }), fn('parse', { line: 20, end_line: 30, over: ['cognitive'] })],
            },
          },
        }),
        changes: changes([file], { hunks: { [file]: [[5, 10]] } }),
      };
      expect(runFixture(fixture).preExisting).toEqual([{ file, line: 20, text: 'parse over cognitive' }]);
    });

    test('a function that crossed a further limit, left every limit, changed name or is new is not pre-existing', () => {
      expect(listed([fn('parse', { over: ['cognitive'] })], [fn('parse', { over: ['cognitive', 'nesting'] })])).toEqual([]);
      expect(listed([fn('parse', { over: ['cognitive'] })], [fn('parse', { cognitive: 9 })])).toEqual([]);
      expect(listed([fn('parseA', { over: ['cognitive'] })], [fn('parseB', { over: ['cognitive'] })])).toEqual([]);
      expect(listed([], [fn('parse', { over: ['cognitive'] })])).toEqual([]);
    });

    test('a function in an unchanged file is not listed', () => {
      const big = fn('run', { line: 2, over: ['lines'] });
      const files = { [file]: { kind: 'service' }, [other]: { kind: 'service', functions: [big] } };
      expect(runFixture({ base: makeGraph({ files }), head: makeGraph({ files }), changes: changes([file]) }).preExisting).toEqual([]);
    });

    test('escapes the name with text()', () => {
      expect(listed([fn('render_v2', { over: ['cognitive'] })], [fn('render_v2', { line: 7, over: ['cognitive'] })])).toEqual([
        { file, line: 7, text: 'render\\_v2 over cognitive' },
      ]);
    });
  });

  describe('warnings', () => {
    const svc = 'src/services/db.ts';
    const other = 'src/services/other.ts';
    const files = { [svc]: { kind: 'service' }, [other]: { kind: 'service' } };
    const w = (over: Partial<SecurityWarning>): SecurityWarning => ({ level: 'serious', text: 'SQL is built from input.', file: svc, line: 10, lines: [10, 20], ...over });
    const warnCase = (base: SecurityWarning[], head: SecurityWarning[], changed = [svc]): Fixture => ({
      base: makeGraph({ files, security: { warnings: base } }),
      head: makeGraph({ files, security: { warnings: head } }),
      changes: changes(changed),
    });

    test('a warning with the same occurrence count on both sides is pre-existing, at its head line', () => {
      expect(runFixture(warnCase([w({})], [w({ line: 12, lines: [12, 22] })])).preExisting).toEqual([{ file: svc, line: 12, text: 'serious: SQL is built from input.' }]);
    });

    test('a warning without lines is one occurrence on either side', () => {
      expect(runFixture(warnCase([w({ lines: undefined })], [w({ lines: [10] })])).preExisting).toEqual([{ file: svc, line: 10, text: 'serious: SQL is built from input.' }]);
    });

    test('a grown warning, a new one, or one in an unchanged file is not pre-existing', () => {
      expect(runFixture(grew).preExisting).toEqual([]);
      expect(runFixture(warnCase([], [w({})])).preExisting).toEqual([]);
      expect(runFixture(warnCase([w({ file: other })], [w({ file: other })])).preExisting).toEqual([]);
    });

    test('pairs through renames', () => {
      const moved = 'src/services/db2.ts';
      const fixture: Fixture = {
        base: makeGraph({ files, security: { warnings: [w({})] } }),
        head: makeGraph({ files: { [moved]: { kind: 'service' } }, security: { warnings: [w({ file: moved })] } }),
        changes: changes([moved], { renames: { [moved]: svc } }),
      };
      expect(runFixture(fixture).preExisting).toEqual([{ file: moved, line: 10, text: 'serious: SQL is built from input.' }]);
    });

    test('escapes the level and the text with text()', () => {
      const odd = w({ level: 'ad_hoc', text: 'Do not use *eval* on <input>.' });
      expect(runFixture(warnCase([odd], [odd])).preExisting).toEqual([{ file: svc, line: 10, text: 'ad\\_hoc: Do not use \\*eval\\* on \\<input\\>.' }]);
    });
  });

  test('sorts by file (code-unit order), then line (numerically), then text', () => {
    const upper = 'src/B.ts';
    const lower = 'src/a.ts';
    const files = {
      [upper]: { kind: 'service', functions: [fn('late', { line: 100, over: ['lines'] })] },
      [lower]: {
        kind: 'service',
        functions: [fn('zeta', { line: 5, over: ['cognitive'] }), fn('beta', { line: 9, over: ['cognitive'] }), fn('alpha', { line: 10, over: ['lines'] })],
      },
    };
    const security = { warnings: [{ level: 'advisory', text: 'eval is used.', file: lower, line: 5 }] };
    const fixture: Fixture = { base: makeGraph({ files, security }), head: makeGraph({ files, security }), changes: changes([lower, upper]) };
    expect(runFixture(fixture).preExisting).toEqual([
      { file: upper, line: 100, text: 'late over lines' },
      { file: lower, line: 5, text: 'advisory: eval is used.' },
      { file: lower, line: 5, text: 'zeta over cognitive' },
      { file: lower, line: 9, text: 'beta over cognitive' },
      { file: lower, line: 10, text: 'alpha over lines' },
    ]);
  });
});

describe('identity: base equal to head', () => {
  const page = 'src/pages/ManagerInbox.tsx';
  const repo = 'src/main/java/com/eq/frip/repository/inbox/InboxScopeRepositoryImpl.java';
  const cases: Array<[string, Fixture, PreExisting[]]> = [
    [
      'crossed-limit',
      crossed,
      [
        { file: page, line: 40, text: 'handleBulkEscalate over cognitive, nesting' },
        { file: page, line: 92, text: 'render over cognitive' },
      ],
    ],
    ['security-grew', grew, [{ file: repo, line: 232, text: 'serious: SQL is built by inserting values into the query text, which allows SQL injection. Pass the values as query parameters instead.' }]],
    ['http-self-contained', self, []],
    ['cycle-grew', cycleGrew, []],
  ];

  test.each(cases)('%s: every row is unchanged and every over-limit function and warning is pre-existing', (_name, fixture, expected) => {
    const report = runFixture({ ...fixture, base: fixture.head });
    expect(report.summary.length).toBeGreaterThanOrEqual(5);
    for (const r of report.summary) {
      expect(r.base, r.key).toBe(r.head);
      expect(r.delta, r.key).toBe(r.key === 'security' ? '0 / 0' : '0');
    }
    expect(report.preExisting).toEqual(expected);
  });

  test('identity rows still carry the totals', () => {
    const summary = runFixture({ ...crossed, base: crossed.head }).summary;
    expect(summary.find((r) => r.key === 'cognitive')).toEqual({ key: 'cognitive', label: 'Cognitive complexity', base: 38, head: 38, delta: '0' });
    expect(runFixture({ ...self, base: self.head }).summary.at(-1)).toEqual({ key: 'http-unmatched', label: 'HTTP calls with no route', base: 2, head: 2, delta: '0' });
    expect(runFixture({ ...cycleGrew, base: cycleGrew.head }).summary.find((r) => r.key === 'cycles')).toEqual({ key: 'cycles', label: 'Circular imports', base: 1, head: 1, delta: '0' });
  });
});
