import { describe, expect, test } from 'vitest';
import { KIND_ORDER, SECTION_RANK, diffGraphs, emptyReport, sortFindings } from '../../src/diff/index.js';
import { buildIndex } from '../../src/graph/index.js';
import type { Finding } from '../../src/report/types.js';
import { DEFAULT_OPTS, changes, makeGraph } from '../helpers/makeGraph.js';

describe('diffGraphs skeleton', () => {
  test('returns meta, empty findings and a pass gate for identical graphs', () => {
    const g = makeGraph({ files: { 'src/a.ts': {} } });
    const report = diffGraphs(buildIndex(g), buildIndex(g), changes(['src/a.ts', 'README.md']), DEFAULT_OPTS);
    expect(report.meta).toEqual({
      toolVersion: '0.7.1',
      baseSha: 'b000000',
      headSha: 'h000000',
      baseRef: 'main',
      changedFiles: 2,
      analyzedChangedFiles: 1,
      httpActive: false,
      configChanged: false,
      truncated: false,
    });
    expect(report.findings).toEqual([]);
    expect(report.gate).toBe('pass');
  });

  test('emptyReport carries the meta it is given', () => {
    const r = emptyReport({ changedFiles: 3, baseRef: 'main', baseSha: 'x', headSha: 'y' });
    expect(r.meta.analyzedChangedFiles).toBe(0);
    expect(r.meta.changedFiles).toBe(3);
    expect(r.findings).toEqual([]);
  });
});

describe('sortFindings', () => {
  const f = (over: Partial<Finding>): Finding => ({
    kind: 'security-new', severity: 'medium', file: 'b.ts', title: 't', data: {}, ...over,
  });

  test('orders by section, in-diff, severity, file, line, title', () => {
    const out = sortFindings([
      f({ kind: 'function-improved', file: 'a.ts' }),
      f({ kind: 'security-new', inDiff: false, severity: 'serious' }),
      f({ kind: 'security-new', inDiff: true, severity: 'medium', file: 'z.ts' }),
      f({ kind: 'security-new', inDiff: true, severity: 'medium', file: 'a.ts', line: 9 }),
      f({ kind: 'security-new', inDiff: true, severity: 'medium', file: 'a.ts', line: 2 }),
      f({ kind: 'function-regression' }),
    ]);
    expect(out.map((x) => [x.kind, x.inDiff, x.severity, x.file, x.line])).toEqual([
      ['function-regression', undefined, 'medium', 'b.ts', undefined],
      ['security-new', true, 'medium', 'a.ts', 2],
      ['security-new', true, 'medium', 'a.ts', 9],
      ['security-new', true, 'medium', 'z.ts', undefined],
      ['security-new', false, 'serious', 'b.ts', undefined],
      ['function-improved', undefined, 'medium', 'a.ts', undefined],
    ]);
  });

  test('KIND_ORDER starts with the banner and ends with improvements', () => {
    expect(KIND_ORDER[0]).toBe('config-changed');
    expect(KIND_ORDER.slice(-2)).toEqual(['function-improved', 'cycle-broken']);
  });

  test('kinds that share a section interleave by in-diff and severity, not by kind', () => {
    const out = sortFindings([
      f({ kind: 'security-new', severity: 'medium', inDiff: false }),
      f({ kind: 'security-grew', severity: 'serious', inDiff: true }),
      f({ kind: 'security-new', severity: 'low', inDiff: true }),
    ]);
    expect(out.map((x) => [x.kind, x.severity])).toEqual([
      ['security-grew', 'serious'],
      ['security-new', 'low'],
      ['security-new', 'medium'],
    ]);
  });

  test('tie-breaks: undefined inDiff counts as in-diff, missing line sorts first, then kind order, then title', () => {
    const out = sortFindings([
      f({ title: 'b' }),
      f({ title: 'a' }),
      f({ line: 1, title: 'z' }),
      f({ inDiff: false, severity: 'serious', title: '0' }),
      f({ kind: 'security-grew', title: 'a' }),
    ]);
    expect(out.map((x) => [x.kind, x.inDiff, x.line, x.title])).toEqual([
      ['security-new', undefined, undefined, 'a'],
      ['security-new', undefined, undefined, 'b'],
      ['security-grew', undefined, undefined, 'a'],
      ['security-new', undefined, 1, 'z'],
      ['security-new', false, undefined, '0'],
    ]);
  });

  test('SECTION_RANK agrees with KIND_ORDER and is exhaustive', () => {
    const ranks = KIND_ORDER.map((k) => SECTION_RANK[k]);
    expect([...ranks]).toEqual([...ranks].sort((a, b) => a - b));
    expect(Object.keys(SECTION_RANK).sort()).toEqual([...KIND_ORDER].sort());
  });
});
