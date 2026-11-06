import { describe, expect, test } from 'vitest';
import type { Changes } from '../../src/diff/changes.js';
import { CONFIG_FILES, isConfigFile } from '../../src/diff/config.js';
import type { Unresolved } from '../../src/graph/types.js';
import type { Finding } from '../../src/report/types.js';
import banner from '../fixtures/config-changed-banner/fixture.js';
import unresolved from '../fixtures/unresolved-new/fixture.js';
import { changes, makeGraph, runFixture } from '../helpers/makeGraph.js';

/** Findings for graphs that differ only in their unresolved lists. */
function run(base: Unresolved[] | null, head: Unresolved[], ch: Changes): Finding[] {
  return runFixture({ base: makeGraph({ unresolved: base }), head: makeGraph({ git_sha: 'h000000', unresolved: head }), changes: ch }).findings;
}

const lazy = 'src/pages/Lazy.tsx';

describe('unresolved rule', () => {
  test('reports a new unresolved import in a changed file, not a pre-existing one', () => {
    const found = runFixture(unresolved).findings;
    expect(found.map((f) => [f.kind, f.file, f.line, f.severity])).toEqual([['unresolved-new', 'src/pages/Lazy.tsx', 9, 'low']]);
    expect(found[0]?.title).toBe('computed import `` import(`./pages/${name}`) `` could not be resolved (computed path)');
  });

  test('carries the raw spec, expr and reason (null when absent), no renamedFrom without a rename, and is in the diff when its line was added', () => {
    const [f] = runFixture(unresolved).findings;
    expect(f?.data).toEqual({ spec: null, expr: 'import(`./pages/${name}`)', reason: 'computed path' });
    expect(f?.renamedFrom).toBeUndefined();
    expect(f?.inDiff).toBe(true);
  });

  test('identical sides yield nothing', () => {
    expect(runFixture({ ...unresolved, base: unresolved.head }).findings).toEqual([]);
  });

  test('swapping sides yields nothing: a resolved import is not reported (asymmetric by design, like HTTP)', () => {
    expect(runFixture({ ...unresolved, base: unresolved.head, head: unresolved.base }).findings).toEqual([]);
  });

  test('identity is (file, spec), not the line: an entry that only moved is not new', () => {
    const before = [{ file: lazy, line: 9, spec: './x', reason: 'not found' }];
    const after = [{ file: lazy, line: 40, spec: './x', reason: 'not found' }];
    expect(run(before, after, changes([lazy]))).toEqual([]);
  });

  test('identity follows renames; a new spec in a renamed file carries renamedFrom', () => {
    const renamed = changes(['new.tsx'], { renames: { 'new.tsx': 'old.tsx' } });
    const before = [{ file: 'old.tsx', line: 3, spec: './x', reason: 'not found' }];
    expect(run(before, [{ file: 'new.tsx', line: 3, spec: './x', reason: 'not found' }], renamed)).toEqual([]);
    const found = run(before, [{ file: 'new.tsx', line: 3, spec: './y', reason: 'not found' }], renamed);
    expect(found.map((f) => [f.kind, f.file, f.renamedFrom])).toEqual([['unresolved-new', 'new.tsx', 'old.tsx']]);
  });

  test('inDiff is false for a line outside the hunks and undefined when hunks are unknown', () => {
    const entry = [{ file: lazy, line: 30, spec: './x', reason: 'not found' }];
    expect(run([], entry, changes([lazy], { hunks: { [lazy]: [[8, 10]] } }))[0]?.inDiff).toBe(false);
    expect(run([], entry, changes([lazy]))[0]?.inDiff).toBeUndefined();
  });

  test('without a reason the title has no parenthetical and data.reason is null', () => {
    const [f] = run([], [{ file: lazy, line: 9, spec: './x' }], changes([lazy]));
    expect(f?.title).toBe('import `./x` could not be resolved');
    expect(f?.data).toEqual({ spec: './x', expr: null, reason: null });
  });

  test('computed imports are keyed by their expr: two in one file are two findings, and one base had does not mask a new one', () => {
    const a = { file: lazy, line: 9, expr: 'import(`./pages/${a}`)', reason: 'computed path' };
    const b = { file: lazy, line: 12, expr: 'import(`./pages/${b}`)', reason: 'computed path' };
    expect(run([], [a, b], changes([lazy])).map((f) => [f.line, f.data['expr']])).toEqual([
      [9, 'import(`./pages/${a}`)'],
      [12, 'import(`./pages/${b}`)'],
    ]);
    expect(run([a], [a, b], changes([lazy])).map((f) => f.line)).toEqual([12]);
  });

  test('a computed import already unresolved in base is not new', () => {
    const entry = { file: lazy, line: 9, expr: 'import(`./pages/${a}`)', reason: 'computed path' };
    expect(run([entry], [{ ...entry, line: 20 }], changes([lazy]))).toEqual([]);
  });

  test('an entry with neither spec nor expr is skipped', () => {
    expect(run([], [{ file: lazy, line: 9, reason: 'computed path' }], changes([lazy]))).toEqual([]);
  });

  test('a spec and an expr with the same text are different imports: both reported, and neither masks the other', () => {
    const same = './pages/x';
    const both = [
      { file: lazy, line: 9, spec: same, reason: 'not found' },
      { file: lazy, line: 10, expr: same, reason: 'computed path' },
    ];
    expect(run([], both, changes([lazy])).map((f) => f.title)).toEqual([
      'import `./pages/x` could not be resolved (not found)',
      'computed import `./pages/x` could not be resolved (computed path)',
    ]);
    expect(run([{ file: lazy, line: 9, spec: same }], both, changes([lazy])).map((f) => f.line)).toEqual([10]);
    // Both sides are prefixed, so no spec text can pose as an expr key either.
    expect(run([{ file: lazy, line: 10, expr: same }], [{ file: lazy, line: 9, spec: `e:${same}` }], changes([lazy])).map((f) => f.line)).toEqual([9]);
  });

  test('a spec with a URL scheme is remote by design and skipped; a bare package name like http-client is reported', () => {
    const remote = [{ file: 'src/styles.css', line: 1, spec: 'https://fonts.googleapis.com/css2?family=Inter', reason: 'not found' }];
    expect(run([], remote, changes(['src/styles.css']))).toEqual([]);
    const bare = [{ file: lazy, line: 2, spec: 'http-client', reason: 'not found' }];
    expect(run([], bare, changes([lazy])).map((f) => f.title)).toEqual(['import `http-client` could not be resolved (not found)']);
  });

  test('the reason is escaped in the title and raw in data', () => {
    const reason = 'uses_underscores *and* stars';
    const [f] = run([], [{ file: lazy, line: 9, spec: './x', reason }], changes([lazy]));
    expect(f?.title).toContain('(uses\\_underscores \\*and\\* stars)');
    expect(f?.data['reason']).toBe(reason);
  });

  test('an entry in an unchanged file is not reported', () => {
    expect(run([], [{ file: 'src/untouched.ts', line: 1, spec: './x', reason: 'not found' }], changes([lazy]))).toEqual([]);
  });

  test('a base graph without an unresolved list makes every head entry in a changed file new', () => {
    expect(run(null, [{ file: lazy, line: 9, spec: './x' }], changes([lazy])).map((f) => f.kind)).toEqual(['unresolved-new']);
  });
});

describe('config banner', () => {
  test('isConfigFile matches isobar config names at any depth', () => {
    expect(isConfigFile('.isobar.json')).toBe(true);
    expect(isConfigFile('packages/api/.codegraph.toml')).toBe(true);
    expect(isConfigFile('src/config.json')).toBe(false);
  });

  test('isConfigFile matches every listed name exactly, by basename', () => {
    expect(CONFIG_FILES.every((name) => isConfigFile(`a/b/${name}`))).toBe(true);
    expect([...CONFIG_FILES].sort()).toEqual(['.codegraph.json', '.codegraph.toml', '.codemap.json', '.isobar.json']);
    expect(isConfigFile('src/x.isobar.json')).toBe(false);
    expect(isConfigFile('.isobar.json/readme.md')).toBe(false);
  });

  test('a changed config file yields one info finding and sets meta.configChanged', () => {
    const report = runFixture(banner);
    expect(report.meta.configChanged).toBe(true);
    expect(report.findings.map((f) => [f.kind, f.severity, f.file])).toEqual([['config-changed', 'info', '.isobar.json']]);
    expect(report.findings[0]?.title).toBe('Analysis config changed in this PR (`.isobar.json`); deltas may reflect configuration, not code.');
  });

  test('several changed config files: one finding anchored on the first (sorted), listing all', () => {
    const ch = changes(['src/a.ts', 'packages/api/.codegraph.toml', '.isobar.json']);
    const found = runFixture({ ...banner, changes: ch }).findings;
    expect(found.map((f) => [f.kind, f.file])).toEqual([['config-changed', '.isobar.json']]);
    expect(found[0]?.title).toBe(
      'Analysis config changed in this PR (`.isobar.json`, `packages/api/.codegraph.toml`); deltas may reflect configuration, not code.',
    );
    expect(found[0]?.data).toEqual({ files: ['.isobar.json', 'packages/api/.codegraph.toml'], deleted: [] });
  });

  test('banner inDiff is file-level: undefined when hunks are unknown, true when they are known', () => {
    expect(runFixture(banner).findings[0]?.inDiff).toBeUndefined();
    const known = changes(['.isobar.json', 'src/a.ts'], { hunks: {} });
    expect(runFixture({ ...banner, changes: known }).findings[0]?.inDiff).toBe(true);
  });

  test('a renamed config file carries renamedFrom; an unrenamed one does not', () => {
    expect(runFixture(banner).findings[0]?.renamedFrom).toBeUndefined();
    const renamed = changes(['.isobar.json'], { renames: { '.isobar.json': '.codegraph.json' } });
    const [f] = runFixture({ ...banner, changes: renamed }).findings;
    expect(f?.renamedFrom).toBe('.codegraph.json');
    // Config name to config name is a config-named head path, listed once, not also as renamed away.
    expect(f?.data).toEqual({ files: ['.isobar.json'], deleted: [] });
  });

  test('a deleted config file alone raises the banner, anchored on its base path', () => {
    const report = runFixture({ ...banner, changes: changes(['src/a.ts'], { deleted: ['.isobar.json'] }) });
    expect(report.meta.configChanged).toBe(true);
    expect(report.findings.map((f) => [f.kind, f.severity, f.file, f.renamedFrom])).toEqual([['config-changed', 'info', '.isobar.json', undefined]]);
    expect(report.findings[0]?.data).toEqual({ files: [], deleted: ['.isobar.json'] });
    expect(report.findings[0]?.title).toBe('Analysis config changed in this PR (`.isobar.json` (deleted)); deltas may reflect configuration, not code.');
  });

  test('a deleted-only anchor is not a head path: inDiff undefined with hunks unknown, false with hunks known', () => {
    expect(runFixture({ ...banner, changes: changes(['src/a.ts'], { deleted: ['.isobar.json'] }) }).findings[0]?.inDiff).toBeUndefined();
    const known = changes(['src/a.ts'], { deleted: ['.isobar.json'], hunks: {} });
    expect(runFixture({ ...banner, changes: known }).findings[0]?.inDiff).toBe(false);
  });

  test('a config file renamed away from its config name raises the banner on the new path', () => {
    const ch = changes(['isobar.json.bak'], { renames: { 'isobar.json.bak': '.isobar.json' } });
    const found = runFixture({ ...banner, changes: ch }).findings;
    expect(found.map((f) => [f.kind, f.file, f.renamedFrom])).toEqual([['config-changed', 'isobar.json.bak', '.isobar.json']]);
    expect(found[0]?.data).toEqual({ files: ['isobar.json.bak'], deleted: [] });
    expect(found[0]?.title).toBe('Analysis config changed in this PR (`isobar.json.bak`); deltas may reflect configuration, not code.');
  });

  test('changed and deleted config files: anchored on the head path, both listed, head paths first', () => {
    const ch = changes(['packages/api/.codegraph.toml'], { deleted: ['.isobar.json'] });
    const [f] = runFixture({ ...banner, changes: ch }).findings;
    expect(f?.file).toBe('packages/api/.codegraph.toml');
    expect(f?.data).toEqual({ files: ['packages/api/.codegraph.toml'], deleted: ['.isobar.json'] });
    expect(f?.title).toBe(
      'Analysis config changed in this PR (`packages/api/.codegraph.toml`, `.isobar.json` (deleted)); deltas may reflect configuration, not code.',
    );
  });

  test('anchor precedence is config-named, then renamed away, then deleted, whatever the sort order', () => {
    const anchorOf = (ch: Changes): string | undefined => runFixture({ ...banner, changes: ch }).findings[0]?.file;
    // 'a.bak' (renamed away) sorts before 'packages/…' (config-named); '.codemap.json' (deleted) before 'isobar.json.bak'.
    expect(anchorOf(changes(['packages/api/.codegraph.toml', 'a.bak'], { renames: { 'a.bak': '.codemap.json' } }))).toBe('packages/api/.codegraph.toml');
    expect(anchorOf(changes(['isobar.json.bak'], { renames: { 'isobar.json.bak': '.isobar.json' }, deleted: ['.codemap.json'] }))).toBe('isobar.json.bak');
  });

  test('deleted config paths are sorted, and the first sorted one anchors a deleted-only banner', () => {
    const [f] = runFixture({ ...banner, changes: changes([], { deleted: ['pkg/.isobar.json', '.codemap.json'] }) }).findings;
    expect(f?.file).toBe('.codemap.json');
    expect(f?.data).toEqual({ files: [], deleted: ['.codemap.json', 'pkg/.isobar.json'] });
  });

  test('the title lists at most three config paths in all, deleted ones included, then "and N more"; data keeps every path', () => {
    const ch = changes(['.isobar.json', 'a/.isobar.json', 'b/.isobar.json'], { deleted: ['.codemap.json'] });
    const [f] = runFixture({ ...banner, changes: ch }).findings;
    expect(f?.title).toBe(
      'Analysis config changed in this PR (`.isobar.json`, `a/.isobar.json`, `b/.isobar.json` and 1 more); deltas may reflect configuration, not code.',
    );
    expect(f?.data).toEqual({ files: ['.isobar.json', 'a/.isobar.json', 'b/.isobar.json'], deleted: ['.codemap.json'] });
  });

  test('deleting a file that is not a config file raises no banner', () => {
    const report = runFixture({ ...banner, changes: changes(['src/a.ts'], { deleted: ['src/old.ts', 'docs/isobar.md'] }) });
    expect(report.meta.configChanged).toBe(false);
    expect(report.findings).toEqual([]);
  });

  test('no changed config file: no banner and meta.configChanged is false', () => {
    const report = runFixture(unresolved);
    expect(report.meta.configChanged).toBe(false);
    expect(report.findings.some((f) => f.kind === 'config-changed')).toBe(false);
  });

  test('the banner sorts ahead of a more severe finding (section beats severity)', () => {
    const ch = changes([...banner.changes.changed, ...unresolved.changes.changed], { hunks: { [lazy]: [[8, 10]] } });
    const found = runFixture({ ...unresolved, changes: ch }).findings;
    expect(found.map((f) => [f.kind, f.file])).toEqual([
      ['config-changed', '.isobar.json'],
      ['unresolved-new', lazy],
    ]);
  });
});
