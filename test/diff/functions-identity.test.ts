import { describe, expect, test } from 'vitest';
import dup from '../fixtures/duplicate-names-approx/fixture.js';
import added from '../fixtures/new-file/fixture.js';
import inExisting from '../fixtures/new-in-existing-file/fixture.js';
import renamed from '../fixtures/renamed-file/fixture.js';
import vanished from '../fixtures/vanished-improved/fixture.js';
import within from '../fixtures/was-within-limits/fixture.js';
import { runFixture } from '../helpers/makeGraph.js';

describe('function rule: identity', () => {
  test('every over-limit function in a new file is a regression marked new', () => {
    const report = runFixture(added);
    expect(report.findings.map((f) => [f.kind, f.title])).toEqual([
      ['function-regression', '`parseRow` — cognitive **21** (limit 15), cyclomatic **14** (limit 10) · new'],
    ]);
    expect(report.findings[0]?.data).toEqual(expect.objectContaining({ isNew: true, newFile: true, wasWithinLimits: false }));
  });

  test('a renamed file matches its base functions and reports nothing', () => {
    expect(runFixture(renamed).findings).toEqual([]);
  });

  test('a function new to an existing file, fully covered by the diff, is marked new but not a new file', () => {
    const { findings } = runFixture(inExisting);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f?.kind).toBe('function-regression');
    expect(f?.title).toBe('`handleExport` — cognitive **18** (limit 15), lines **121** (limit 100) · new');
    expect(f?.data).toEqual(expect.objectContaining({ isNew: true, newFile: false, wasWithinLimits: false }));
  });

  test('a function the PR only touched in part, absent from base, was within every limit', () => {
    const { findings } = runFixture(within);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f?.kind).toBe('function-regression');
    expect(f?.title).toBe('`parse` — cognitive **18** (limit 15) · was within every limit');
    expect(f?.data).toEqual(expect.objectContaining({ isNew: false, newFile: false, wasWithinLimits: true }));
    expect(runFixture({ ...within, opts: { failOn: 'limit-crossed' } }).gate).toBe('fail');
  });

  test('a base function no longer emitted while its file exists is an improvement', () => {
    const { findings } = runFixture(vanished);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f?.kind).toBe('function-improved');
    expect(f?.title).toBe('`run` — lines no longer over a limit (simplified, moved or removed)');
    expect(f?.data['vanished']).toBe(true);
    expect(f?.inDiff).toBe(true);
  });

  test('ambiguous duplicate names report a net count, not pairwise values', () => {
    const report = runFixture(dup);
    expect(report.findings).toHaveLength(1);
    const f = report.findings[0]!;
    expect(f.kind).toBe('function-regression');
    expect(f.title).toBe('`Dashboard › useEffect callback` ×3 — 2 over a limit, was 1');
    expect(f.detail).toMatch(/approximate match/);
    expect(f.data['approximate']).toBe(true);
    expect(f.data['metrics']).toEqual([]);
    expect(f.line).toBe(30);
    expect(f.inDiff).toBe(true);
    expect(runFixture({ ...dup, opts: { failOn: 'limit-crossed' } }).gate).toBe('fail');
  });
});
