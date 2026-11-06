import { describe, expect, test } from 'vitest';
import type { Changes } from '../../src/diff/changes.js';
import fixture from '../fixtures/hotspot-touched/fixture.js';
import { changes, runFixture } from '../helpers/makeGraph.js';

const inbox = 'src/pages/manager-inbox/ManagerInbox.tsx';
const view = 'src/components/inbox/MessageView.tsx';
const pane = 'src/components/inbox/MessagePane.tsx';

const hotspots = (c: Changes, f = fixture) => runFixture({ ...f, changes: c }).findings.filter((x) => x.kind === 'hotspot-touched');
/** MessageView.tsx (base hotspot rank 2, one test importer) renamed to MessagePane.tsx. */
const renameView = (extra: { hunks?: Record<string, Array<[number, number]>>; deletions?: Record<string, number[]> } = {}) =>
  changes([pane], { renames: { [pane]: view }, ...extra });
/** A realistic head for the rename: the view's entry lives at the new path only, so a head lookup by the old path finds nothing. */
const renamedHead = (entry = fixture.head.files[view]!) => {
  const files: typeof fixture.head.files = { ...fixture.head.files, [pane]: entry };
  delete files[view];
  return { ...fixture.head, files };
};

describe('hotspot rule', () => {
  test('flags changed files that are base hotspots, with test importer count', () => {
    const hot = runFixture(fixture).findings.filter((f) => f.kind === 'hotspot-touched');
    // sorted by severity: medium (no tests) before low (has tests)
    expect(hot.map((f) => [f.file, f.severity, f.title])).toEqual([
      [inbox, 'medium', 'base hotspot rank **1** (49 commits, total cognitive 52), imported by 0 tests'],
      [view, 'low', 'base hotspot rank **2** (61 commits, total cognitive 13), imported by 1 test'],
    ]);
    expect(hot[0]?.advice).toBe('Keep changes small and tested.');
    expect(hot[0]?.data).toEqual({ rank: 1, score: 0.583, commits: 49, cognitive: 52, testImporters: 0 });
    expect(hot.every((f) => f.inDiff === true)).toBe(true);
    expect(hot.every((f) => f.line === undefined)).toBe(true);
  });

  test('ignores head-only hotspots and files the PR did not change', () => {
    const files = runFixture(fixture).findings.filter((f) => f.kind === 'hotspot-touched').map((f) => f.file);
    expect(files).not.toContain('src/utils/format.ts');
    expect(hotspots(changes(['src/utils/format.ts']))).toEqual([]);
  });

  test('inDiff is undefined when hunks are unknown; a renamed hotspot keeps its base test importers', () => {
    expect(hotspots(changes([inbox]))[0]?.inDiff).toBeUndefined();
    // Head has the file at the new path only: the old path finds nothing there, the new path finds the same test importer.
    const hot = hotspots(renameView({ hunks: { [pane]: [[1, 1]] } }), { ...fixture, head: renamedHead() });
    expect(hot.map((f) => [f.file, f.renamedFrom, f.severity, f.data['testImporters']])).toEqual([[pane, view, 'low', 1]]);
    // With no test importer at the new head path, the 1 must come from the base lookup via basePath.
    const untested = renamedHead({ ...fixture.head.files[view], imported_by: [inbox] });
    expect(hotspots(renameView({ hunks: { [pane]: [[1, 1]] } }), { ...fixture, head: untested }).map((f) => f.data['testImporters'])).toEqual([1]);
  });

  test('a pure move is not a touch; a rename with an edit or a deletion is', () => {
    expect(hotspots(renameView({ hunks: {} }))).toEqual([]);
    expect(hotspots(renameView({ hunks: { [pane]: [[1, 1]] } })).map((f) => [f.file, f.renamedFrom])).toEqual([[pane, view]]);
    // git writes a deletion at the top of a file as `+0,0`: deletion point 0 still counts as a touch.
    expect(hotspots(renameView({ hunks: {}, deletions: { [pane]: [0] } })).map((f) => f.file)).toEqual([pane]);
    // Hunks unknown: a rename cannot be told apart from an edit, so it is still reported.
    expect(hotspots(renameView()).map((f) => f.inDiff)).toEqual([undefined]);
  });

  test('credits tests the PR adds: the head importer count wins when higher', () => {
    const head = fixture.head;
    const withTest = {
      ...head,
      files: {
        ...head.files,
        [inbox]: { ...head.files[inbox], imported_by: [...(head.files[inbox]?.imported_by ?? []), 'test/ManagerInbox.test.tsx'] },
        'test/ManagerInbox.test.tsx': { kind: 'test' },
      },
    };
    const hot = hotspots(changes([inbox], { hunks: { [inbox]: [[300, 320]] } }), { ...fixture, head: withTest });
    expect(hot.map((f) => [f.file, f.severity, f.data['testImporters']])).toEqual([[inbox, 'low', 1]]);
    expect(hot[0]?.title).toBe('base hotspot rank **1** (49 commits, total cognitive 52), imported by 1 test');
  });
});
