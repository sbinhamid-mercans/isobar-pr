import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { Changes } from '../src/diff/changes.js';
import { diffGraphs } from '../src/diff/index.js';
import { FAIL_ON_VALUES } from '../src/gate.js';
import { buildIndex } from '../src/graph/index.js';
import { renderAnnotations } from '../src/report/annotations.js';
import { toJson } from '../src/report/json.js';
import { renderMarkdown } from '../src/report/markdown.js';
import type { FailOn, Finding, FindingKind, Report } from '../src/report/types.js';
import { changes, DEFAULT_OPTS, fn, makeGraph, runFixture, type Fixture } from './helpers/makeGraph.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'fixtures');
/** The golden cases, enumerated as golden.test.ts does (A2): fixture directories with a fixture.ts, sample projects (a package.json) excluded. */
const cases = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'fixture.ts')) && !existsSync(join(root, d.name, 'package.json')))
  .map((d) => d.name)
  .sort();

async function loadFixture(name: string): Promise<Fixture> {
  return ((await import(`./fixtures/${name}/fixture.ts`)) as { default: Fixture }).default;
}

const client = 'src/api/items.ts';
const server = 'src/server/items.ts';
const dynamicCall = { method: 'GET', path: null, line: 5, dynamic: true };
const oldPath = 'src/core/old-engine.ts';
const newPath = 'src/core/engine.ts';
const peer = 'src/core/bus.ts';
const joiner = 'src/core/registry.ts';

/**
 * Edge cases no golden fixture reaches, run through the same properties (not goldens: nothing is compared to disk).
 * - `deleted-files`: the PR deletes a config file and a source file. Only the config banner may anchor on a deleted
 *   path (A25), and the deleted file counts on neither side of the summary.
 * - `http-active-head-only`: the PR adds the repo's first route and matchable call, so the `http-unmatched` row exists
 *   forward but not backward (A23), where the http rule reports an info line instead.
 * - `renamed-hotspot-cycle`: the PR renames and edits a base hotspot that sits in a cycle the PR grows, and a function
 *   in it crosses a limit, so findings carry a real `renamedFrom` and the summary rows read base paths through the
 *   rename (`renamed-file` has no findings either way).
 */
const INLINE: Readonly<Record<string, Fixture>> = {
  'inline/renamed-hotspot-cycle': {
    base: makeGraph({
      files: {
        [oldPath]: { kind: 'service', complexity: { cognitive: 10 }, functions: [fn('run', { line: 3, end_line: 20, cognitive: 10 })] },
        [peer]: { kind: 'service' },
        [joiner]: { kind: 'service' },
      },
      hotspots: [{ rank: 1, file: oldPath, score: 0.8, commits: 12, cognitive: 10 }],
      cycles: [[peer, oldPath]],
    }),
    head: makeGraph({
      git_sha: 'h000000',
      files: {
        [newPath]: {
          kind: 'service',
          complexity: { cognitive: 20 },
          functions: [fn('run', { line: 3, end_line: 24, cognitive: 20, over: ['cognitive'] })],
        },
        [peer]: { kind: 'service' },
        [joiner]: { kind: 'service' },
      },
      hotspots: [{ rank: 1, file: newPath, score: 0.9, commits: 13, cognitive: 20 }],
      cycles: [[peer, joiner, newPath]],
    }),
    changes: changes([newPath], { renames: { [newPath]: oldPath }, hunks: { [newPath]: [[1, 1], [10, 14]] } }),
  },
  'inline/deleted-files': {
    base: makeGraph({
      files: {
        'src/a.ts': { kind: 'util', complexity: { cognitive: 2 }, functions: [fn('a', { cognitive: 2 })] },
        'src/gone.ts': { kind: 'util', complexity: { cognitive: 30 }, functions: [fn('old', { cognitive: 30, over: ['cognitive'] })] },
      },
    }),
    head: makeGraph({
      git_sha: 'h000000',
      files: { 'src/a.ts': { kind: 'util', complexity: { cognitive: 3 }, functions: [fn('a', { cognitive: 3 })] } },
    }),
    changes: changes(['src/a.ts'], { deleted: ['.isobar.json', 'src/gone.ts'] }),
  },
  'inline/http-active-head-only': {
    base: makeGraph({
      files: { [client]: { kind: 'service', calls: [dynamicCall] } },
      http: { routes: [], matched: 0, dynamic: 1 },
    }),
    head: makeGraph({
      git_sha: 'h000000',
      files: {
        [client]: {
          kind: 'service',
          calls: [
            dynamicCall,
            { method: 'GET', path: '/api/items', line: 9, target: { file: server, method: 'GET', path: '/api/items', line: 3 } },
            { method: 'POST', path: '/api/items/bulk', line: 14 },
          ],
        },
        [server]: {
          kind: 'route',
          serves: [{ method: 'GET', path: '/api/items', line: 3, callers: [{ file: client, line: 9, method: 'GET', path: '/api/items' }] }],
        },
      },
      http: { routes: [{ method: 'GET', path: '/api/items', line: 3 }], matched: 1, dynamic: 1 },
    }),
    changes: changes([client, server]),
  },
};

type Pred = (x: Finding) => boolean;
const count = (r: Report, pred: Pred): number => r.findings.filter(pred).length;
const kindIs =
  (...kinds: FindingKind[]): Pred =>
  (x) =>
    kinds.includes(x.kind);

/** Kinds a file earns merely by being in the change set: it is a base hotspot, or it is an isobar config file. */
const TOUCH_KINDS: readonly FindingKind[] = ['hotspot-touched', 'config-changed'];

/**
 * The same PR seen backwards: head and base trade places. The change set covers the same files: each changed path is
 * mapped to its base path, and the rename map is inverted (old path → new path). Hunks, deletions and `deleted` are
 * dropped (A14: line ranges do not mirror). The A25 added/deleted asymmetry is deliberately not mirrored: a file the PR
 * deleted would be an added file backwards, but it simply stays out of `changed`, as deleted files do forwards.
 */
function swapped(f: Fixture): Fixture {
  const changed = new Set([...f.changes.changed].map((p) => f.changes.renames.get(p) ?? p));
  const renames = new Map([...f.changes.renames].map(([to, from]) => [from, to] as const));
  const swappedChanges: Changes = { changed, renames };
  return { base: f.head, head: f.base, changes: swappedChanges, opts: f.opts };
}

/** Head against itself: the same changed paths and head's own hunks, no renames (both sides share head's path space). */
function identity(f: Fixture, failOn?: FailOn): Fixture {
  const same: Changes = { changed: f.changes.changed, renames: new Map(), hunks: f.changes.hunks, deletions: f.changes.deletions };
  return { base: f.head, head: f.head, changes: same, opts: failOn === undefined ? f.opts : { ...f.opts, failOn } };
}

function expectDeterministic(f: Fixture): void {
  // Most identity runs have no findings, so the one-line comment form (A29) is rendered here too.
  for (const variant of [f, swapped(f), identity(f)]) {
    const a = runFixture(variant);
    const b = runFixture(variant);
    expect(toJson(b)).toBe(toJson(a));
    expect(renderMarkdown(b)).toBe(renderMarkdown(a));
    expect(renderAnnotations(b)).toEqual(renderAnnotations(a));
  }
}

/** Every finding sits on a changed head path, except the config banner, which may anchor on a deleted base path (A25). */
function expectInScope(report: Report, c: Changes): void {
  for (const x of report.findings) {
    const where = `${x.kind} on ${x.file}`;
    if (!c.changed.has(x.file)) {
      expect(c.deleted?.has(x.file) ?? false, `${where}: neither changed nor deleted`).toBe(true);
      expect(x.kind, `${where}: only the config banner reads deleted paths (spec §7)`).toBe('config-changed');
    }
    expect(x.renamedFrom, `${where}: renamedFrom`).toBe(c.renames.get(x.file));
  }
}

function expectScoped(f: Fixture): void {
  expectInScope(runFixture(f), f.changes);
  const back = swapped(f);
  expectInScope(runFixture(back), back.changes);
}

/** Under every fail-on policy: touch findings only, every summary row unchanged, and a red gate only for `any` with a hotspot touched. */
function expectIdentityQuiet(f: Fixture): void {
  for (const failOn of FAIL_ON_VALUES) {
    const report = runFixture(identity(f, failOn));
    for (const x of report.findings) expect(TOUCH_KINDS, `${x.kind} on ${x.file} (fail-on ${failOn})`).toContain(x.kind);
    for (const row of report.summary) {
      expect(row.head, `${row.key} row`).toEqual(row.base);
      expect(['0', '0 / 0'], `${row.key} row delta`).toContain(row.delta);
    }
    const hotspot = count(report, kindIs('hotspot-touched')) > 0;
    expect(report.gate, `fail-on ${failOn}`).toBe(failOn === 'any' && hotspot ? 'fail' : 'pass');
  }
}

/**
 * Rows present on both sides swap base and head and negate the delta. A27: every row, cycles included, totals each side
 * over its own changed files. A23: the `http-unmatched` row exists only when that run's head is HTTP-active, so it is
 * the one row that may be missing on one side.
 */
function expectMirroredSummary(forward: Report, backward: Report): void {
  for (const r of [forward, backward]) {
    expect(r.summary.some((row) => row.key === 'http-unmatched'), 'http-unmatched row iff head is HTTP-active').toBe(r.meta.httpActive);
  }
  const backByKey = new Map(backward.summary.map((row) => [row.key, row] as const));
  const forwardKeys = new Set(forward.summary.map((row) => row.key));
  for (const row of [...forward.summary, ...backward.summary]) {
    if (!(forwardKeys.has(row.key) && backByKey.has(row.key))) expect(row.key, 'a row missing on one side').toBe('http-unmatched');
  }
  const shared = forward.summary.filter((row) => backByKey.has(row.key));
  expect(backward.summary.filter((row) => forwardKeys.has(row.key)).map((row) => row.key), 'row order').toEqual(shared.map((row) => row.key));
  for (const row of shared) {
    const back = backByKey.get(row.key)!;
    expect(back.label).toBe(row.label);
    expect(back.base, `${row.key}: backward base`).toEqual(row.head);
    expect(back.head, `${row.key}: backward head`).toEqual(row.base);
    const forwardDelta = row.delta.split(' / ').map(Number);
    const sums = back.delta.split(' / ').map((d, i) => Number(d) + (forwardDelta[i] ?? Number.NaN));
    expect(sums, `${row.key}: deltas negate (${row.delta} vs ${back.delta})`).toEqual(forwardDelta.map(() => 0));
  }
}

function expectMirrored(f: Fixture): void {
  const forward = runFixture(f);
  const backward = runFixture(swapped(f));
  // A18/A20: a regression in a file new to the PR has no counterpart (backwards the file is absent from head), while a
  // function new to an existing file mirrors a vanished improvement, so only `newFile` regressions are left out.
  const regression: Pred = (x) => x.kind === 'function-regression' && x.data['newFile'] !== true;
  const improved = kindIs('function-improved');
  const approximate =
    (p: Pred): Pred =>
    (x) =>
      p(x) && x.data['approximate'] === true;
  expect(count(forward, regression), 'forward regressions vs backward improvements').toBe(count(backward, improved));
  expect(count(forward, improved), 'forward improvements vs backward regressions').toBe(count(backward, regression));
  expect(count(forward, approximate(regression)), 'approximate: regression vs improvement').toBe(count(backward, approximate(improved)));
  expect(count(forward, approximate(improved)), 'approximate: improvement vs regression').toBe(count(backward, approximate(regression)));
  // A new cycle is broken backwards and a grown one shrank (cycle-broken with shrankTo), and the other way round.
  const broken =
    (shrank: boolean): Pred =>
    (x) =>
      x.kind === 'cycle-broken' && Array.isArray(x.data['shrankTo']) === shrank;
  expect(count(forward, kindIs('cycle-new')), 'cycle-new vs broken').toBe(count(backward, broken(false)));
  expect(count(forward, kindIs('cycle-grew')), 'cycle-grew vs shrank').toBe(count(backward, broken(true)));
  expect(count(forward, broken(false)), 'broken vs cycle-new').toBe(count(backward, kindIs('cycle-new')));
  expect(count(forward, broken(true)), 'shrank vs cycle-grew').toBe(count(backward, kindIs('cycle-grew')));
  expect(backward.meta.changedFiles).toBe(forward.meta.changedFiles);
  expect(backward.meta.analyzedChangedFiles).toBe(forward.meta.analyzedChangedFiles);
  expectMirroredSummary(forward, backward);
}

/**
 * runFixture deep-freezes both graphs, so every property above already throws on a write to a graph. Freezing cannot
 * guard the Maps and Sets of GraphIndex and Changes (Object.freeze does not stop Map.set or Set.add), nor state kept
 * between calls: diffGraphs runs twice on the same unfrozen inputs, which must be unchanged, with identical reports.
 * toStrictEqual against a structured clone also sees a key set to undefined and a value set to NaN.
 */
function expectNoMutation(f: Fixture): void {
  const base = buildIndex(structuredClone(f.base));
  const head = buildIndex(structuredClone(f.head));
  const c = structuredClone(f.changes);
  const opts = { ...DEFAULT_OPTS, ...f.opts };
  const inputs = [base, head, c, opts];
  const before = structuredClone(inputs);
  const first = toJson(diffGraphs(base, head, c, opts));
  const second = toJson(diffGraphs(base, head, c, opts));
  expect(inputs, 'inputs after two diffGraphs calls').toStrictEqual(before);
  expect(second, 'a second call on the same inputs').toBe(first);
  expect(first, 'unfrozen inputs vs runFixture').toBe(toJson(runFixture(f)));
}

/** report.json loses nothing: toEqual skips keys whose value is undefined (JSON drops them), while NaN, ±Infinity or an undefined array slot (all `null` in JSON) would differ. */
function expectJsonRoundTrip(f: Fixture): void {
  const report = runFixture(f);
  expect(JSON.parse(toJson(report))).toEqual(report);
}

const PROPERTIES: ReadonlyArray<readonly [string, (f: Fixture) => void]> = [
  ['deterministic', expectDeterministic],
  ['every finding is in a changed file', expectScoped],
  ['identity yields only touch findings', expectIdentityQuiet],
  ['swapping sides mirrors regressions and improvements', expectMirrored],
  ['diffGraphs leaves its inputs untouched', expectNoMutation],
  ['report.json parses back to the report', expectJsonRoundTrip],
];

const sources: ReadonlyArray<readonly [string, () => Promise<Fixture>]> = [
  ...cases.map((name) => [name, () => loadFixture(name)] as const),
  ...Object.entries(INLINE).map(([name, f]) => [name, () => Promise.resolve(f)] as const),
];

describe('properties over every fixture', () => {
  test('the fixture directory is not empty', () => {
    expect(cases.length).toBeGreaterThan(0);
  });
  // Keeps the rename case from decaying into a no-finding fixture, where the renamedFrom check compares undefined to undefined.
  test('inline/renamed-hotspot-cycle: forward findings carry renamedFrom', () => {
    const report = runFixture(INLINE['inline/renamed-hotspot-cycle']!);
    const renamed = report.findings.filter((x) => x.file === newPath && x.renamedFrom === oldPath).map((x) => x.kind);
    expect(renamed).toEqual(expect.arrayContaining<FindingKind>(['hotspot-touched', 'cycle-grew', 'function-regression']));
  });
  for (const [name, load] of sources) {
    for (const [property, check] of PROPERTIES) {
      test(`${name}: ${property}`, async () => {
        check(await load());
      });
    }
  }
});
