import { describe, expect, test } from 'vitest';
import { timeRank } from '../../src/diff/functions.js';
import type { GraphFunction } from '../../src/graph/types.js';
import { plain } from '../../src/report/text.js';
import type { Report } from '../../src/report/types.js';
import crossed from '../fixtures/crossed-limit/fixture.js';
import improved from '../fixtures/improved/fixture.js';
import issueRelabelled from '../fixtures/issue-relabelled/fixture.js';
import testFileLongDescribe from '../fixtures/test-file-long-describe/fixture.js';
import { changes, fn, makeGraph, runFixture } from '../helpers/makeGraph.js';

const P = 'src/a.ts';

/** Runs one changed file; `base: undefined` means the file does not exist in base. `from` renames it. */
function run(o: {
  base: GraphFunction[] | undefined;
  head: GraphFunction[];
  hunks?: Array<[number, number]>;
  from?: string;
  path?: string;
}): Report {
  const path = o.path ?? P;
  const basePath = o.from ?? path;
  return runFixture({
    base: makeGraph({ files: o.base ? { [basePath]: { kind: 'service', functions: o.base } } : {} }),
    head: makeGraph({ git_sha: 'h000000', files: { [path]: { kind: 'service', functions: o.head } } }),
    changes: changes([path], {
      ...(o.from ? { renames: { [path]: o.from } } : {}),
      ...(o.hunks ? { hunks: { [path]: o.hunks } } : {}),
    }),
  });
}

describe('timeRank', () => {
  test.each([
    ['O(1)', 0],
    ['O(log n)', 1],
    ['O(n)', 2],
    ['O(n log n)', 3],
    ['O(n²)', 4],
    ['O(n·m)', 4],
    ['O(n³)', 5],
    ['O(n·m·k)', 5],
    ['O(n·m²)', 5],
    ['O(n³) or more', 5],
    ['O(2ⁿ)', 6],
    ['O(n·m log n)', 4.5],
    ['O(n² log n)', 4.5],
    ['O(log² n)', 1],
    ['O(n log² n)', 3],
    ['O(n^2)', 4],
    ['O(n⁴)', 5],
    ['weird', undefined],
    [undefined, undefined],
  ])('%s → %s', (label, expected) => {
    expect(timeRank(label)).toBe(expected);
  });
});

describe('function rule: limits', () => {
  test('reports a function that crossed limits with base → head values', () => {
    const report = runFixture(crossed);
    expect(report.findings.map((f) => f.kind)).toEqual(['function-regression']);
    const f = report.findings[0]!;
    expect(f.file).toBe('src/pages/ManagerInbox.tsx');
    expect(f.line).toBe(40);
    expect(f.inDiff).toBe(true);
    expect(f.severity).toBe('medium');
    expect(f.title).toBe('`handleBulkEscalate` — cognitive 11 → **19** (limit 15), nesting 3 → **5** (limit 4)');
    expect(f.advice).toBeUndefined();
    expect(f.data['metrics']).toEqual([
      { name: 'cognitive', limit: 15, base: 11, head: 19 },
      { name: 'nesting', limit: 4, base: 3, head: 5 },
    ]);
    expect(f.data['isNew']).toBe(false);
    expect(f.data['wasWithinLimits']).toBe(false);
  });

  test('does not report a function that was already over the same limit', () => {
    const report = runFixture(crossed);
    expect(report.findings.filter((f) => f.title.startsWith('`render`'))).toEqual([]);
  });

  test('reports an improvement when a metric drops within its limit', () => {
    const report = runFixture(improved);
    expect(report.findings.map((f) => f.kind)).toEqual(['function-improved']);
    const f = report.findings[0]!;
    expect(f.severity).toBe('improved');
    expect(f.title).toBe('`render` — cognitive 22 → 13, now within limit 15');
    expect(f.data['metrics']).toEqual([{ name: 'cognitive', limit: 15, base: 22, head: 13 }]);
  });

  test('limit-crossed gate fails only on metric crossings', () => {
    expect(runFixture({ ...crossed, opts: { failOn: 'limit-crossed' } }).gate).toBe('fail');
    expect(runFixture({ ...improved, opts: { failOn: 'limit-crossed' } }).gate).toBe('pass');
    expect(runFixture({ ...crossed, opts: { failOn: 'any' } }).gate).toBe('fail');
    expect(runFixture({ ...improved, opts: { failOn: 'any' } }).gate).toBe('pass');
  });
});

describe('function rule: pairing', () => {
  test('a pure reorder of same-name functions reports nothing', () => {
    const within = (line: number) => fn('cb', { line, end_line: line + 5, cognitive: 3, lines: 6, time: 'O(n)' });
    const over = (line: number) =>
      fn('cb', { line, end_line: line + 154, cognitive: 16, lines: 155, over: ['cognitive', 'lines'], time: 'O(n·m)' });
    const report = run({ base: [within(10), over(30)], head: [over(10), within(200)], hunks: [[1, 400]] });
    expect(report.findings).toEqual([]);
  });

  test('a shift in which same-name functions isobar emits, keeping the fingerprints, reports nothing', () => {
    const cog = (line: number) => fn('handler', { line, end_line: line + 30, cognitive: 18, over: ['cognitive'] });
    const long = (line: number) => fn('handler', { line, end_line: line + 150, lines: 151, over: ['lines'] });
    const report = run({ base: [cog(10), long(50)], head: [long(50), cog(210)], hunks: [[1, 400]] });
    expect(report.findings).toEqual([]);
  });
});

describe('function rule: functions with no base match', () => {
  const fresh = fn('fresh', { line: 30, end_line: 60, cognitive: 19, lines: 31, over: ['cognitive'], time: 'O(n)' });

  test('a function wholly inside the added lines of an existing file is new', () => {
    const report = run({ base: [], head: [fresh], hunks: [[25, 65]] });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-regression']);
    const f = report.findings[0]!;
    expect(f.title).toBe('`fresh` — cognitive **19** (limit 15) · new');
    expect(f.data['isNew']).toBe(true);
    expect(f.data['wasWithinLimits']).toBe(false);
    expect(f.data['newFile']).toBe(false);
  });

  test('a function only partly inside the added lines was within every limit', () => {
    const f = run({ base: [], head: [fresh], hunks: [[40, 45]] }).findings[0]!;
    expect(f.title).toBe('`fresh` — cognitive **19** (limit 15) · was within every limit');
    expect(f.data['isNew']).toBe(false);
    expect(f.data['wasWithinLimits']).toBe(true);
  });

  test('without hunks it was not measured in base', () => {
    const f = run({ base: [], head: [fresh] }).findings[0]!;
    expect(f.title).toBe('`fresh` — cognitive **19** (limit 15) · not measured in base');
    expect(f.data['isNew']).toBe(false);
    expect(f.data['wasWithinLimits']).toBe(false);
    expect(f.data['newFile']).toBe(false);
    expect(f.inDiff).toBeUndefined();
  });

  test('a within-limits function now quadratic or worse is a high time regression without an arrow', () => {
    const scan = (time: string) =>
      fn('scan', { line: 5, end_line: 20, cognitive: 4, lines: 16, time, time_why: [{ line: 8, text: 'loop over rows inside loop over cols' }] });
    const report = run({ base: [], head: [scan('O(n·m)')], hunks: [[8, 9]] });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-regression']);
    const f = report.findings[0]!;
    expect(f.severity).toBe('high');
    expect(f.data['time']).toEqual({ base: null, head: 'O(n·m)', why: ['L8: loop over rows inside loop over cols'] });
    expect(f.data['metrics']).toEqual([]);
    expect(f.title).toContain('**O(n·m)**');
    expect(f.title).not.toContain('→');
    expect(f.title).toBe('`scan` — **O(n·m)** (L8: loop over rows inside loop over cols) · was within every limit');
    expect(run({ base: [], head: [scan('O(n)')], hunks: [[8, 9]] }).findings).toEqual([]);
    expect(run({ base: [], head: [scan('O(n log n)')], hunks: [[8, 9]] }).findings).toEqual([]);
  });
});

describe('function rule: new slow functions', () => {
  test('a quadratic function in a new file is a medium time regression marked new', () => {
    const report = run({ base: undefined, head: [fn('pairs', { line: 3, end_line: 12, cognitive: 4, lines: 10, time: 'O(n²)' })], hunks: [[1, 12]] });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-regression']);
    const f = report.findings[0]!;
    expect(f.severity).toBe('medium');
    expect(f.data['newFile']).toBe(true);
    expect(f.title.endsWith('· new')).toBe(true);
    expect(f.title).toBe('`pairs` — **O(n²)** · new');
    expect((f.data['time'] as { base: string | null }).base).toBeNull();
    expect(f.data['isNew']).toBe(true);
  });

  test('an O(n log n) function in a new file reports nothing', () => {
    const report = run({ base: undefined, head: [fn('sorted', { line: 3, end_line: 12, cognitive: 4, lines: 10, time: 'O(n log n)' })], hunks: [[1, 12]] });
    expect(report.findings).toEqual([]);
  });
});

describe('function rule: approximate and vanished', () => {
  test('an approximate group anchors on the member in the diff and keeps the rename', () => {
    const report = run({
      path: 'src/new.ts',
      from: 'src/old.ts',
      base: [fn('cb', { line: 10, end_line: 30, cognitive: 17, over: ['cognitive'] })],
      head: [
        fn('cb', { line: 10, end_line: 30, cognitive: 17, nesting: 5, over: ['cognitive', 'nesting'] }),
        fn('cb', { line: 50, end_line: 170, lines: 121, over: ['lines'] }),
      ],
      hunks: [[150, 160]],
    });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-regression']);
    const f = report.findings[0]!;
    expect(f.data['approximate']).toBe(true);
    expect(f.inDiff).toBe(true);
    expect(f.line).toBe(50);
    expect(f.renamedFrom).toBe('src/old.ts');
    expect(f.title).toBe('`cb` ×2 — 2 over a limit, was 1');
  });

  test('an approximate title counts the whole group, including members that paired by fingerprint', () => {
    const report = run({
      base: [
        fn('cb', { line: 10, end_line: 30, cognitive: 17, over: ['cognitive'] }),
        fn('cb', { line: 100, end_line: 220, lines: 121, over: ['lines'] }),
      ],
      head: [
        fn('cb', { line: 10, end_line: 30, cognitive: 17, over: ['cognitive'] }),
        fn('cb', { line: 50, end_line: 60, nesting: 5, over: ['nesting'] }),
        fn('cb', { line: 70, end_line: 80, params: 6, over: ['params'] }),
      ],
      hunks: [[50, 80]],
    });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-regression']);
    const f = report.findings[0]!;
    expect(f.title).toBe('`cb` ×3 — 3 over a limit, was 2');
    expect(f.data['overHead']).toBe(3);
    expect(f.data['overBase']).toBe(2);
    expect(f.line).toBe(50);
  });

  test('a function that is no longer emitted in a renamed file is an improvement with the rename', () => {
    const report = run({
      path: 'src/new.ts',
      from: 'src/old.ts',
      base: [fn('helper', { line: 5, end_line: 30, nesting: 5, over: ['nesting'] })],
      head: [],
      hunks: [[1, 3]],
    });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-improved']);
    const f = report.findings[0]!;
    expect(f.renamedFrom).toBe('src/old.ts');
    expect(f.inDiff).toBe(true);
    expect(f.title).toBe('`helper` — nesting no longer over a limit (simplified, moved or removed)');
    expect(f.title).toContain('no longer over a limit (simplified, moved or removed)');
    expect(f.data['metrics']).toEqual([{ name: 'nesting', limit: 4, base: 5, head: null }]);
    expect(f.data['time']).toBeNull();
  });

  test('a quadratic function within limits that is no longer emitted is an improvement', () => {
    const scan = fn('scan', { line: 5, end_line: 20, cognitive: 4, time: 'O(n·m)', time_why: [{ line: 8, text: 'nested loop' }] });
    const report = run({ base: [scan], head: [], hunks: [[5, 6]] });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-improved']);
    const f = report.findings[0]!;
    expect(f.data['vanished']).toBe(true);
    expect((f.data['time'] as { base: string }).base).toBe('O(n·m)');
    expect(f.data).toEqual({
      name: 'scan',
      ordinal: 0,
      metrics: [],
      time: { base: 'O(n·m)', head: null, why: ['L8: nested loop'] },
      issues: [],
      vanished: true,
    });
    expect(f.title).toBe('`scan` — O(n·m) no longer reported (simplified, moved or removed)');
    expect(f.inDiff).toBe(true);
    expect(run({ base: [{ ...scan, time: 'O(n log n)' }], head: [], hunks: [[5, 6]] }).findings).toEqual([]);
  });

  test('a base function both over a limit and slow vanishes as one finding naming both', () => {
    const scan = fn('scan', { line: 5, end_line: 20, nesting: 5, over: ['nesting'], time: 'O(n·m)' });
    const report = run({ base: [scan], head: [], hunks: [[5, 6]] });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-improved']);
    expect(report.findings[0]!.title).toBe('`scan` — nesting, O(n·m) no longer reported (simplified, moved or removed)');
  });

  test('a base function with only a refactor issue that is no longer emitted mirrors as an improvement', () => {
    const issue = { kind: 'n-plus-one', severity: 'high', title: 'Database call inside a loop (N+1 queries)', line: 18, how: 'Load all rows at once.', why: 'One query per item.' };
    const report = run({ base: [fn('nplus', { line: 10, end_line: 30, cognitive: 4, time: 'O(n)', refactor: [issue] })], head: [], hunks: [[10, 12]] });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-improved']);
    const f = report.findings[0]!;
    expect(f.title).toBe('`nplus` — Database call inside a loop (N+1 queries) resolved (simplified, moved or removed)');
    expect(f.data['vanished']).toBe(true);
    expect(f.data['issues']).toEqual([expect.objectContaining({ kind: 'n-plus-one', severity: 'high' })]);
  });

  test('a vanished title names limits, time and unique issue titles, dropping kinds that restate a shown limit', () => {
    const f = fn('f', {
      line: 5,
      end_line: 20,
      nesting: 5,
      over: ['nesting'],
      time: 'O(n·m)',
      refactor: [
        { kind: 'scan-in-loop', severity: 'high', title: 'a_b *c*' },
        { kind: 'scan-in-loop', severity: 'high', title: 'a_b *c*' },
        { kind: 'nesting', severity: 'medium', title: 'Deep nesting' },
      ],
    });
    const report = run({ base: [f], head: [], hunks: [[5, 6]] });
    expect(report.findings.map((x) => x.kind)).toEqual(['function-improved']);
    const finding = report.findings[0]!;
    expect(finding.title).toBe('`f` — nesting, O(n·m), a\\_b \\*c\\* no longer reported (simplified, moved or removed)');
    expect((finding.data['issues'] as unknown[]).length).toBe(3);
  });

  test('a vanished function over a limit whose only issue restates it reads as no longer over a limit', () => {
    const g = fn('g', {
      line: 5,
      end_line: 130,
      lines: 126,
      over: ['lines'],
      refactor: [{ kind: 'long-function', severity: 'medium', title: 'A 126-line function' }],
    });
    const report = run({ base: [g], head: [], hunks: [[5, 6]] });
    expect(report.findings.map((x) => x.title)).toEqual(['`g` — lines no longer over a limit (simplified, moved or removed)']);
    expect((report.findings[0]!.data['issues'] as unknown[]).length).toBe(1);
  });

  test('a matched improvement names a duplicated resolved issue once', () => {
    const issue = { kind: 'n-plus-one', severity: 'high', title: 'Database call inside a loop (N+1 queries)' };
    const report = run({
      base: [fn('h', { line: 5, end_line: 40, cognitive: 6, refactor: [issue, { ...issue, line: 30 }] })],
      head: [fn('h', { line: 5, end_line: 40, cognitive: 6 })],
      hunks: [[10, 12]],
    });
    expect(report.findings.map((x) => x.kind)).toEqual(['function-improved']);
    const title = report.findings[0]!.title;
    expect(title.split('Database call inside a loop (N+1 queries) resolved').length - 1).toBe(1);
    expect(report.findings[0]!.data['issues']).toHaveLength(2);
  });

  test('a matched improvement names at most two resolved issues, then a count', () => {
    const issues = [
      { kind: 'scan-in-loop', severity: 'high', title: 'Lookup inside a loop' },
      { kind: 'n-plus-one', severity: 'high', title: 'Database call inside a loop (N+1 queries)' },
      { kind: 'await-in-loop', severity: 'medium', title: 'Awaiting inside a loop' },
    ];
    const report = run({
      base: [fn('h', { line: 5, end_line: 40, cognitive: 6, refactor: issues })],
      head: [fn('h', { line: 5, end_line: 40, cognitive: 6 })],
      hunks: [[10, 12]],
    });
    expect(report.findings.map((x) => x.kind)).toEqual(['function-improved']);
    const f = report.findings[0]!;
    expect(f.title).toBe('`h` — Lookup inside a loop resolved, Database call inside a loop (N+1 queries) resolved, +1 more resolved');
    expect(f.data['issues']).toHaveLength(3);
    const two = run({
      base: [fn('h', { line: 5, end_line: 40, cognitive: 6, refactor: issues.slice(0, 2) })],
      head: [fn('h', { line: 5, end_line: 40, cognitive: 6 })],
      hunks: [[10, 12]],
    }).findings;
    expect(two.map((x) => x.title)).toEqual(['`h` — Lookup inside a loop resolved, Database call inside a loop (N+1 queries) resolved']);
    expect(two[0]!.data['issues']).toHaveLength(2);
  });
});

describe('function rule: issues that only restate a limit', () => {
  test('a relabelled issue (paths ↔ logic) with no limit crossed or left is no change on its own', () => {
    const findings = runFixture(issueRelabelled).findings;
    expect(findings.map((f) => [f.kind, f.file, f.title])).toEqual([
      ['function-regression', 'src/api/errors.ts', '`showErrorToast` — cognitive 15 → **18** (limit 15)'],
      ['function-improved', 'src/api/client.ts', '`runRequest` — cognitive 18 → 12, now within limit 15'],
    ]);
    const [regression, improvement] = findings;
    expect(regression!.severity).toBe('high');
    expect(regression!.advice).toMatch(/^Split it into steps/);
    expect(improvement!.data['issues']).toEqual([expect.objectContaining({ kind: 'logic' })]);
  });

  test('only the restating part of the gone issues is dropped: a resolved N+1 still counts', () => {
    const paths = { kind: 'paths', severity: 'low', title: 'Many paths through one function' };
    const nPlusOne = { kind: 'n-plus-one', severity: 'high', title: 'Database call inside a loop (N+1 queries)' };
    const logic = { kind: 'logic', severity: 'high', title: 'Too much logic in one function' };
    const over = { line: 5, end_line: 40, cognitive: 18, cyclomatic: 14, over: ['cognitive', 'cyclomatic'] };
    const report = run({ base: [fn('h', { ...over, refactor: [paths, nPlusOne] })], head: [fn('h', { ...over, refactor: [logic] })], hunks: [[10, 12]] });
    expect(report.findings.map((f) => f.title)).toEqual(['`h` — Database call inside a loop (N+1 queries) resolved']);
  });
});

describe('function rule: test files ignore the lines limit', () => {
  const T = 'src/a.test.ts';
  /** One changed test-kind file (A35 #4: describe / it callbacks are long by nature). */
  function runTest(base: GraphFunction[], head: GraphFunction[]): Report {
    return runFixture({
      base: makeGraph({ files: { [T]: { kind: 'test', functions: base } } }),
      head: makeGraph({ git_sha: 'h000000', files: { [T]: { kind: 'test', functions: head } } }),
      changes: changes([T], { hunks: { [T]: [[1, 200]] } }),
    });
  }

  test('a describe callback over lines only reports nothing; one also over cognitive leaves lines out of the title', () => {
    const findings = runFixture(testFileLongDescribe).findings;
    expect(findings.map((f) => [f.kind, f.file])).toEqual([['function-regression', 'src/lib/beta.test.ts']]);
    expect(findings[0]!.title).toBe('`describe callback` — cognitive 9 → **18** (limit 15)');
    expect((findings[0]!.data['metrics'] as Array<{ name: string }>).map((m) => m.name)).toEqual(['cognitive']);
  });

  test('the same growth outside a test file still crosses the lines limit', () => {
    const report = run({
      base: [fn('describe callback', { line: 10, end_line: 104, lines: 95 })],
      head: [fn('describe callback', { line: 10, end_line: 139, lines: 130, over: ['lines'] })],
      hunks: [[100, 134]],
    });
    expect(report.findings.map((f) => f.title)).toEqual(['`describe callback` — lines 95 → **130** (limit 100)']);
  });

  test('in a test file, lines alone is never an improvement or a vanished function either; time still counts', () => {
    // isobar attaches a lines-restating issue whenever `lines` is over; it must not resolve on its own either.
    const longIssue = { kind: 'long-function', severity: 'medium', title: 'A 121-line function', how: 'Split it.' };
    const long = fn('it callback', { line: 5, end_line: 125, lines: 121, over: ['lines'], time: 'O(n)', refactor: [longIssue] });
    expect(runTest([long], [{ ...long, end_line: 95, lines: 91, over: [], refactor: [] }]).findings).toEqual([]);
    expect(runTest([long], []).findings).toEqual([]);
    const slower = runTest([long], [{ ...long, time: 'O(n²)', time_why: [{ line: 9, text: 'a loop inside a loop' }] }]).findings;
    expect(slower.map((f) => f.title)).toEqual(['`it callback` — O(n) → **O(n²)** (L9: a loop inside a loop)']);
  });
});

describe('function rule: text and issues', () => {
  test('graph text is escaped in the title and advice but kept raw in data', () => {
    const report = run({
      base: [fn('calc', { line: 10, end_line: 30, cognitive: 16, over: ['cognitive'], time: 'O(n)' })],
      head: [
        fn('calc', {
          line: 10,
          end_line: 30,
          cognitive: 16,
          over: ['cognitive'],
          time: 'O(n²)',
          time_why: [{ line: 12, text: 'arr[i] * 2 <b>' }],
          refactor: [{ kind: 'loop-map', severity: 'medium', title: 'Loop builds an array', how: 'use _map_' }],
        }),
      ],
      hunks: [[12, 12]],
    });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-regression']);
    const f = report.findings[0]!;
    expect(f.severity).toBe('high');
    expect(f.title).toBe('`calc` — O(n) → **O(n²)** (L12: arr\\[i\\] \\* 2 \\<b\\>)');
    expect(f.title).toContain('arr\\[i\\] \\* 2 \\<b\\>');
    expect(f.advice).toBe('use \\_map\\_');
    expect((f.data['time'] as { why: string[] }).why[0]).toBe('L12: arr[i] * 2 <b>');
    expect((f.data['issues'] as Array<{ how: string }>)[0]!.how).toBe('use _map_');
  });

  test("advice keeps isobar's code spans verbatim, escapes the text around them, and plain() reads it back", () => {
    const how = 'Build a Map (or Set) from `ctx.team_ids` once before the loop, and replace `ctx.team_ids.includes()` with a .has() in my_fn.';
    const scan = { kind: 'scan-in-loop', severity: 'high', title: 'Lookup inside a loop', how };
    const report = run({
      base: [fn('canEdit', { line: 5, end_line: 20, time: 'O(n)' })],
      head: [fn('canEdit', { line: 5, end_line: 20, time: 'O(n·m)', refactor: [scan] })],
      hunks: [[6, 8]],
    });
    const advice = report.findings[0]!.advice!;
    expect(advice).toBe('Build a Map (or Set) from `ctx.team_ids` once before the loop, and replace `ctx.team_ids.includes()` with a .has() in my\\_fn.');
    expect(plain(advice)).toBe(how.replaceAll('`', '')); // annotations: spans unwrapped, escapes undone
  });

  test('advice and an issue-only title come from the most severe new issue, ties keeping order', () => {
    const base = fn('parse', { line: 1, end_line: 120, lines: 120, over: ['lines'] });
    const head = fn('parse', {
      line: 1,
      end_line: 120,
      lines: 120,
      over: ['lines'],
      refactor: [
        { kind: 'magic-number', severity: 'low', title: 'Magic number', how: 'name it' },
        { kind: 'n-plus-one', severity: 'serious', title: 'Query in a loop', how: 'batch the query' },
        { kind: 'deep-copy', severity: 'serious', title: 'Deep copy', how: 'share it' },
      ],
    });
    const report = run({ base: [base], head: [head], hunks: [[5, 6]] });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-regression']);
    const f = report.findings[0]!;
    expect(f.severity).toBe('high');
    expect(f.title).toBe('`parse` — Query in a loop');
    expect(f.advice).toBe('batch the query');
    expect((f.data['issues'] as Array<{ kind: string }>).map((i) => i.kind)).toEqual(['magic-number', 'n-plus-one', 'deep-copy']);
  });

  test('a function the PR did not touch is out of the diff', () => {
    const report = run({
      base: [fn('idle', { line: 10, end_line: 130, lines: 121, over: ['lines'] })],
      head: [fn('idle', { line: 10, end_line: 130, lines: 121, cognitive: 17, over: ['cognitive', 'lines'] })],
      hunks: [[200, 210]],
    });
    expect(report.findings.map((f) => f.kind)).toEqual(['function-regression']);
    expect(report.findings[0]!.inDiff).toBe(false);
  });
});
