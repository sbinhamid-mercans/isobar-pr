import { describe, expect, test } from 'vitest';
import type { Changes } from '../../src/diff/changes.js';
import type { Finding } from '../../src/report/types.js';
import broken from '../fixtures/cycle-broken/fixture.js';
import grew from '../fixtures/cycle-grew/fixture.js';
import fresh from '../fixtures/cycle-new/fixture.js';
import shrank from '../fixtures/cycle-shrank/fixture.js';
import { changes, makeGraph, runFixture } from '../helpers/makeGraph.js';

const a = 'src/services/a.ts';
const b = 'src/services/b.ts';
const b2 = 'src/services/b2.ts';
const c = 'src/services/c.ts';
const d = 'src/services/d.ts';
const e = 'src/services/e.ts';
const fixtures = { fresh, grew, broken, shrank };

/** A change set touching lines 1–5 of each file. */
function touched(...files: string[]): Changes {
  return changes(files, { hunks: Object.fromEntries(files.map((f): [string, Array<[number, number]>] => [f, [[1, 5]]])) });
}

/** The cycle findings for the given cycles on each side; each side's graph lists its cycle members as service files. */
function cycles(baseCycles: string[][], headCycles: string[][], changeSet: Changes): Finding[] {
  const files = (cs: string[][]) => Object.fromEntries(cs.flat().map((f) => [f, { kind: 'service' }]));
  const base = makeGraph({ files: files(baseCycles), cycles: baseCycles });
  const head = makeGraph({ git_sha: 'h000000', files: files(headCycles), cycles: headCycles });
  return runFixture({ base, head, changes: changeSet }).findings.filter((f) => f.kind.startsWith('cycle-'));
}

describe('cycle rule', () => {
  test('a head cycle not in base, touching a changed file, is new; order inside the cycle is irrelevant', () => {
    const found = runFixture(fresh).findings;
    expect(found.map((f) => [f.kind, f.severity, f.file])).toEqual([['cycle-new', 'high', 'src/services/c.ts']]);
    expect(found[0]?.title).toBe('new circular import across 2 files: `src/services/c.ts`, `src/services/d.ts`');
    expect(found[0]?.data).toEqual({ files: ['src/services/c.ts', 'src/services/d.ts'] });
  });

  test('a strict superset of a base cycle grew', () => {
    const [f] = runFixture(grew).findings;
    expect(f?.kind).toBe('cycle-grew');
    expect(f?.title).toBe('circular import grew to 3 files (+1): `src/services/c.ts`');
    expect(f?.data).toEqual({ files: ['src/services/a.ts', 'src/services/b.ts', 'src/services/c.ts'], added: ['src/services/c.ts'] });
  });

  test('a base cycle with no surviving superset is broken', () => {
    const [f] = runFixture(broken).findings;
    expect(f?.kind).toBe('cycle-broken');
    expect(f?.severity).toBe('improved');
    expect(f?.file).toBe('src/services/a.ts');
    expect(f?.title).toBe('circular import broken (2 files)');
    expect(f?.data).toEqual({ files: ['src/services/a.ts', 'src/services/b.ts'], shrankTo: null });
  });

  test('a head cycle that is a strict subset of a base cycle means the base cycle shrank, never a new cycle', () => {
    const found = runFixture(shrank).findings;
    expect(found.map((f) => [f.kind, f.severity, f.file])).toEqual([['cycle-broken', 'improved', 'src/services/c.ts']]);
    expect(found[0]?.title).toBe('circular import shrank from 3 to 2 files');
    expect(found[0]?.data).toEqual({
      files: ['src/services/a.ts', 'src/services/b.ts', 'src/services/c.ts'],
      shrankTo: ['src/services/a.ts', 'src/services/b.ts'],
    });
  });

  test('a changed member of the remnant does not make the remnant new', () => {
    // In the fixture only c changed, so the [a, b] remnant is untouched; here a changed too.
    const found = runFixture({ ...shrank, changes: touched(a, c) }).findings;
    expect(found.map((f) => [f.kind, f.file, f.title])).toEqual([['cycle-broken', a, 'circular import shrank from 3 to 2 files']]);
  });

  test('a cycle identical on both sides yields nothing, whatever the order of its files', () => {
    expect(runFixture({ ...grew, base: grew.head }).findings).toEqual([]);
    // With a changed too, base's [a, b] and head's [b, a] are compared rather than skipped as untouched.
    const found = runFixture({ ...fresh, changes: touched(a, c) }).findings;
    expect(found.map((f) => [f.kind, f.file])).toEqual([['cycle-new', c]]);
  });

  test('swapping base and head turns new into broken and grew into shrank', () => {
    const unNew = runFixture({ ...fresh, base: fresh.head, head: fresh.base }).findings;
    expect(unNew.map((f) => [f.kind, f.severity, f.file])).toEqual([['cycle-broken', 'improved', c]]);
    expect(unNew[0]?.title).toBe('circular import broken (2 files)');
    expect(unNew[0]?.data).toEqual({ files: [c, d], shrankTo: null });
    const unGrew = runFixture({ ...grew, base: grew.head, head: grew.base }).findings;
    expect(unGrew.map((f) => [f.kind, f.severity, f.file])).toEqual([['cycle-broken', 'improved', c]]);
    expect(unGrew[0]?.title).toBe('circular import shrank from 3 to 2 files');
    expect(unGrew[0]?.data).toEqual({ files: [a, b, c], shrankTo: [a, b] });
  });

  test('a cycle none of whose files changed is not reported, however it changed', () => {
    for (const [name, fx] of Object.entries(fixtures)) {
      expect(runFixture({ ...fx, changes: touched('src/services/other.ts') }).findings, name).toEqual([]);
    }
  });

  test('inDiff is true with hunks and undefined when hunks are unknown', () => {
    for (const [name, fx] of Object.entries(fixtures)) {
      const withHunks = runFixture(fx).findings;
      expect(withHunks.map((f) => [f.kind.startsWith('cycle-'), f.inDiff]), name).toEqual([[true, true]]);
      const noHunks = runFixture({ ...fx, changes: changes([...fx.changes.changed]) }).findings;
      expect(noHunks.map((f) => [f.kind, f.inDiff]), name).toEqual([[withHunks[0]?.kind, undefined]]);
    }
  });

  test('a renamed member keeps the identity of its cycle; a finding anchored on a renamed file carries renamedFrom', () => {
    const rename = changes([b2], { renames: { [b2]: b }, hunks: { [b2]: [[1, 5]] } });
    expect(cycles([[a, b]], [[a, b2]], rename)).toEqual([]);

    const [g] = cycles([[a, b]], [[a, b2, c]], rename);
    expect([g?.kind, g?.file, g?.renamedFrom]).toEqual(['cycle-grew', b2, b]);
    expect(g?.title).toBe('circular import grew to 3 files (+1): `src/services/c.ts`');
    expect(g?.data).toEqual({ files: [a, b2, c], added: [c] });

    const [x] = cycles([[a, b]], [], rename);
    expect([x?.kind, x?.file, x?.renamedFrom]).toEqual(['cycle-broken', b2, b]);
    expect(x?.data).toEqual({ files: [a, b], shrankTo: null });

    expect(runFixture(fresh).findings[0]?.renamedFrom).toBeUndefined();
  });

  test('base cycles merging into one head cycle grow from the largest of them, and none is broken', () => {
    const merged = cycles([[a, b], [c, d, e]], [[e, d, c, b, a]], touched(a));
    expect(merged.map((f) => [f.kind, f.file])).toEqual([['cycle-grew', a]]);
    expect(merged[0]?.title).toBe('circular import grew to 5 files (+2): `src/services/a.ts`, `src/services/b.ts`');
    expect(merged[0]?.data).toEqual({ files: [a, b, c, d, e], added: [a, b] });
    // On a tie the first base cycle in graph order wins.
    const tie = cycles([[a, b], [c, d]], [[a, b, c, d]], touched(d));
    expect(tie.map((f) => [f.kind, f.file, f.data['added']])).toEqual([['cycle-grew', d, [c, d]]]);
  });

  test('a base cycle split in two shrank to the largest remnant, reported once', () => {
    const split = cycles([[a, b, c, d, e]], [[a, b], [c, d, e]], touched(a, c));
    expect(split.map((f) => [f.kind, f.file])).toEqual([['cycle-broken', a]]);
    expect(split[0]?.title).toBe('circular import shrank from 5 to 3 files');
    expect(split[0]?.data).toEqual({ files: [a, b, c, d, e], shrankTo: [c, d, e] });
  });

  test('titles list at most 3 files, then how many more; data keeps every file', () => {
    const [n] = cycles([], [[e, d, c, b, a]], touched(a));
    expect(n?.title).toBe('new circular import across 5 files: `src/services/a.ts`, `src/services/b.ts`, `src/services/c.ts` and 2 more');
    expect(n?.data).toEqual({ files: [a, b, c, d, e] });
    const sixth = 'src/services/f.ts';
    const [g] = cycles([[a, b]], [[a, b, c, d, e, sixth]], touched(a));
    expect(g?.title).toBe('circular import grew to 6 files (+4): `src/services/c.ts`, `src/services/d.ts`, `src/services/e.ts` and 1 more');
    expect(g?.data).toEqual({ files: [a, b, c, d, e, sixth], added: [c, d, e, sixth] });
    const [three] = cycles([], [[c, b, a]], touched(a));
    expect(three?.title).toBe('new circular import across 3 files: `src/services/a.ts`, `src/services/b.ts`, `src/services/c.ts`');
  });

  test('a finding anchors on the alphabetically first changed member', () => {
    expect(cycles([], [[d, c, b]], touched(d, b)).map((f) => f.file)).toEqual([b]);
    expect(cycles([[e, d, c]], [], touched(e, d)).map((f) => f.file)).toEqual([d]);
  });

  test('a base cycle broken only by deleting a member surfaces only when another member changed', () => {
    // Deleted files never enter `changed` (name-status D rows go to `Changes.deleted`, which only the config banner reads).
    expect(cycles([[a, b]], [], touched())).toEqual([]);
    expect(cycles([[a, b]], [], touched(a)).map((f) => [f.kind, f.file])).toEqual([['cycle-broken', a]]);
  });
});
