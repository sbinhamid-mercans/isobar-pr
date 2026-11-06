import { describe, expect, test } from 'vitest';
import { SECTION_RANK, emptyReport } from '../../src/diff/index.js';
import { COMMENT_LIMIT, COUNTERS, MARKER, SECTIONS, headline, renderMarkdown, truncateComment } from '../../src/report/markdown.js';
import type { Finding, FindingKind, Report, Severity } from '../../src/report/types.js';
import banner from '../fixtures/config-changed-banner/fixture.js';
import conventionAbsent from '../fixtures/convention-absent-in-base/fixture.js';
import conventionNew from '../fixtures/convention-new-exception/fixture.js';
import conventionTruncated from '../fixtures/convention-truncated/fixture.js';
import weakened from '../fixtures/convention-weakened/fixture.js';
import crossed from '../fixtures/crossed-limit/fixture.js';
import cycleBroken from '../fixtures/cycle-broken/fixture.js';
import cycleNew from '../fixtures/cycle-new/fixture.js';
import emptyDelta from '../fixtures/empty-delta/fixture.js';
import hotspot from '../fixtures/hotspot-touched/fixture.js';
import httpSelf from '../fixtures/http-self-contained/fixture.js';
import httpSplit from '../fixtures/http-split-repo/fixture.js';
import improved from '../fixtures/improved/fixture.js';
import refactorIssue from '../fixtures/refactor-new-issue/fixture.js';
import securityNew from '../fixtures/security-new/fixture.js';
import unresolvedNew from '../fixtures/unresolved-new/fixture.js';
import { runFixture } from '../helpers/makeGraph.js';

const finding = (over: Partial<Finding>): Finding => ({ kind: 'security-new', severity: 'medium', file: 'src/a.ts', line: 3, title: 't', data: {}, ...over });
/** The crossed-limit report with its findings replaced, so meta, summary and footer stay realistic. */
const withFindings = (findings: Finding[]): Report => ({ ...runFixture(crossed), findings });

describe('headline', () => {
  test('no analyzable source', () => {
    expect(headline(emptyReport({ changedFiles: 3 }))).toBe('No analyzable source changed (3 files)');
  });

  test('counts each family', () => {
    expect(headline(runFixture(crossed))).toBe('+8 cognitive across 1 changed file · 1 function crossed a limit or got slower');
    expect(headline(runFixture(hotspot))).toBe('2 hotspots touched');
    expect(headline(runFixture(improved))).toBe('-9 cognitive across 1 changed file · 1 improved');
  });

  test('security, convention, cycle and http families', () => {
    expect(headline(runFixture(securityNew))).toBe('2 security warnings (1 serious)');
    expect(headline(runFixture(conventionNew))).toBe('1 convention broken');
    expect(headline(runFixture(cycleNew))).toBe('1 circular import');
    expect(headline(runFixture(httpSelf))).toBe('1 call with no route');
  });

  test('an uncalled route is not counted as a call with no route', () => {
    expect(headline(withFindings([finding({ kind: 'http-uncalled-route', severity: 'low' })]))).toBe(
      '+8 cognitive across 1 changed file · 1 route with no caller',
    );
  });

  test('conventions count distinct patterns, broken and weakened alike (A29)', () => {
    expect(headline(runFixture(weakened))).toBe('1 convention broken');
    expect(headline(runFixture(conventionTruncated))).toBe('1 convention broken');
    const broken = (patternId: string | undefined, file: string): Finding =>
      finding({ kind: 'convention-broken', file, line: undefined, data: patternId === undefined ? {} : { patternId } });
    expect(headline({ ...withFindings([broken('a', 'src/x.ts'), broken('b', 'src/y.ts')]), summary: [] })).toBe('2 conventions broken');
    expect(headline({ ...withFindings([broken(undefined, 'src/x.ts'), broken(undefined, 'src/y.ts')]), summary: [] })).toBe('2 conventions broken');
  });

  test('a new unresolved import is counted, not reported as no change', () => {
    expect(headline(runFixture(unresolvedNew))).toBe('1 unresolved import');
  });

  test('all-zero report says so', () => {
    expect(headline(runFixture(emptyDelta))).toBe('No pressure change in 1 changed file');
  });

  test('finds the cognitive row by key, not by label', () => {
    const report: Report = {
      ...runFixture(crossed),
      findings: [],
      summary: [
        { key: 'over-limit', label: 'Cognitive complexity', base: 0, head: 5, delta: '+5' },
        { key: 'cognitive', label: 'X', base: 1, head: 4, delta: '+3' },
      ],
    };
    expect(headline(report)).toBe('+3 cognitive across 1 changed file');
  });
});

describe('SECTIONS', () => {
  test('agree with SECTION_RANK: one rank per section, ascending, every kind but the banner exactly once', () => {
    const ranks = SECTIONS.map((s) => {
      const inSection = new Set(s.kinds.map((k) => SECTION_RANK[k]));
      expect(inSection.size, s.heading).toBe(1);
      return [...inSection][0]!;
    });
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
    const all = (Object.keys(SECTION_RANK) as FindingKind[]).filter((k) => k !== 'config-changed').sort();
    expect(SECTIONS.flatMap((s) => s.kinds).sort()).toEqual(all);
  });

  test('every sectioned kind but http-info is counted by exactly one headline family', () => {
    const counted = COUNTERS.flatMap((c) => c.kinds);
    expect(new Set(counted).size).toBe(counted.length);
    const expected = SECTIONS.flatMap((s) => s.kinds).filter((k) => k !== 'http-info').sort();
    expect([...counted].sort()).toEqual(expected);
  });
});

describe('renderMarkdown', () => {
  const md = renderMarkdown(runFixture(crossed));

  test('starts with the marker and title, then the table', () => {
    expect(md.startsWith(`${MARKER}\n## 🌀 isobar-pr · pressure delta\n`)).toBe(true);
    expect(md).toContain('| Signal (changed files only) | Base | Head | Δ |');
    expect(md).toContain('| Cognitive complexity | 30 | 38 | +8 |');
  });

  test('summary cells are escaped', () => {
    const report: Report = { ...runFixture(crossed), summary: [{ key: 'cognitive', label: 'a|b', base: 1, head: 2, delta: '+1' }] };
    expect(renderMarkdown(report)).toContain('| a\\|b | 1 | 2 | +1 |');
  });

  test('renders a function card with file, title, line and no advice line when there is none', () => {
    expect(md).toContain('### ⚠️ Crossed a limit or got slower\n- `src/pages/ManagerInbox.tsx` › `handleBulkEscalate` — cognitive 11 → **19** (limit 15), nesting 3 → **5** (limit 4) · L40\n');
    expect(md).not.toContain('↳');
  });

  test('a function card shows its detail before the line', () => {
    const out = renderMarkdown(withFindings([finding({ kind: 'function-regression', file: 'src/d.ts', line: 30, title: '`f` ×3 — 2 over a limit, was 1', detail: 'approximate match' })]));
    expect(out).toContain('- `src/d.ts` › `f` ×3 — 2 over a limit, was 1 — approximate match · L30\n');
  });

  test('omits empty sections and lists pre-existing items in the footer', () => {
    expect(md).not.toContain('### 🔥 Hotspot touched');
    expect(md).not.toContain('### ✅ Improved');
    expect(md).toContain('<details><summary>Pre-existing in changed files (1) · isobar 0.7.1 · base b000000 · head h000000</summary>');
    expect(md).toContain('- `src/pages/ManagerInbox.tsx:92` — render over cognitive');
  });

  test('an empty footer says nothing is pre-existing', () => {
    expect(renderMarkdown(runFixture(improved))).toContain(
      '<details><summary>Pre-existing in changed files (0) · isobar 0.7.1 · base b000000 · head h000000</summary>\n\n_Nothing pre-existing in the changed files._\n\n</details>\n',
    );
  });

  test('shows the duration only when given', () => {
    expect(md).not.toMatch(/ s<\/summary>/);
    expect(renderMarkdown(runFixture(crossed), { durationMs: 5820 })).toContain('· head h000000 · 5.8 s</summary>');
  });

  test('shortens 40-character shas to 7 and shows ? for a missing one', () => {
    const base = runFixture(crossed);
    const out = renderMarkdown({ ...base, meta: { ...base.meta, baseSha: 'a'.repeat(40), headSha: '' } });
    expect(out).toContain(' · base aaaaaaa · head ?</summary>');
  });

  test('trims shas: whitespace only is missing, padding is not counted', () => {
    const base = runFixture(crossed);
    const out = renderMarkdown({ ...base, meta: { ...base.meta, baseSha: '   ', headSha: ' abcdef0123\n' } });
    expect(out).toContain(' · base ? · head abcdef0</summary>');
  });

  test('keeps a trailing -dirty when it shortens a sha (compare\'s working-tree head, A35)', () => {
    const base = runFixture(crossed);
    const long = renderMarkdown({ ...base, meta: { ...base.meta, baseSha: 'a'.repeat(40), headSha: `${'c'.repeat(40)}-dirty` } });
    expect(long).toContain(' · base aaaaaaa · head ccccccc-dirty</summary>');
    const short = renderMarkdown({ ...base, meta: { ...base.meta, headSha: ' abc-dirty\n' } });
    expect(short).toContain(' · head abc-dirty</summary>');
  });

  test('prints the duration only for a finite, non-negative number', () => {
    for (const durationMs of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(renderMarkdown(runFixture(crossed), { durationMs })).toContain('· head h000000</summary>');
    }
    expect(renderMarkdown(runFixture(crossed), { durationMs: 0 })).toContain('· head h000000 · 0.0 s</summary>');
  });

  test('HTML-escapes the isobar version inside the summary element', () => {
    const base = runFixture(crossed);
    const out = renderMarkdown({ ...base, meta: { ...base.meta, toolVersion: '<b>0.7.1&' } });
    expect(out).toContain('· isobar &lt;b&gt;0.7.1&amp; ·');
    expect(out).not.toContain('<b>');
  });

  test('lists at most 50 pre-existing items, then counts the rest', () => {
    const preExisting = Array.from({ length: 60 }, (_, i) => ({ file: `src/p${String(i).padStart(2, '0')}.ts`, line: 1, text: 'f over lines' }));
    const out = renderMarkdown({ ...runFixture(crossed), preExisting });
    expect(out).toContain('<details><summary>Pre-existing in changed files (60) · ');
    expect(out).toContain('- `src/p49.ts:1` — f over lines\n\n_and 10 more in report.json_\n\n</details>\n');
    expect(out).not.toContain('src/p50.ts');
    expect(out.match(/ — f over lines/g)).toHaveLength(50);
  });

  test('renders hotspot advice and the banner', () => {
    const hot = renderMarkdown(runFixture(hotspot));
    expect(hot).toContain('### 🔥 Hotspot touched\n- `src/pages/manager-inbox/ManagerInbox.tsx` — base hotspot rank **1** (49 commits, total cognitive 52), imported by 0 tests\n  ↳ Keep changes small and tested.\n');
    expect(renderMarkdown(runFixture(banner))).toContain('> ⚠️ Analysis config changed in this PR (`.isobar.json`); deltas may reflect configuration, not code.');
  });

  test('orders the hotspot section by base rank even when severities differ', () => {
    const hot = (rank: number, severity: Severity, file: string): Finding =>
      finding({ kind: 'hotspot-touched', severity, file, line: undefined, inDiff: true, title: `base hotspot rank **${rank}**`, data: { rank } });
    // sortFindings would put the medium rank-2 file first.
    const out = renderMarkdown(withFindings([hot(2, 'medium', 'src/a.ts'), hot(1, 'low', 'src/b.ts')]));
    expect(out).toContain('### 🔥 Hotspot touched\n- `src/b.ts` — base hotspot rank **1**\n- `src/a.ts` — base hotspot rank **2**\n');
  });

  test('marks findings outside the diff and names the old path of a renamed file', () => {
    const out = renderMarkdown(
      withFindings([
        finding({ inDiff: false }),
        finding({ file: 'src/new.ts', renamedFrom: 'src/old.ts' }),
        finding({ kind: 'function-regression', file: 'src/new.ts', renamedFrom: 'src/old.ts', line: 7, title: '`f` — cognitive **16** (limit 15)', inDiff: false }),
        finding({ kind: 'convention-broken', file: 'src/new.ts', renamedFrom: 'src/old.ts', line: undefined, title: '**Rule** (9 of 10 follow it)', detail: 'breaks it.' }),
      ]),
    );
    expect(out).toContain('- `src/a.ts:3` — t _(outside the diff)_\n');
    expect(out).toContain('- `src/new.ts:3` (renamed from `src/old.ts`) — t\n');
    expect(out).toContain('- `src/new.ts` (renamed from `src/old.ts`) › `f` — cognitive **16** (limit 15) · L7 _(outside the diff)_\n');
    expect(out).toContain('- **Rule** (9 of 10 follow it) — `src/new.ts` (renamed from `src/old.ts`) breaks it.\n');
  });

  test('title-only lines carry no path, rename or diff suffix', () => {
    const out = renderMarkdown(withFindings([finding({ kind: 'http-info', severity: 'info', line: undefined, renamedFrom: 'src/old.ts', inDiff: false, title: 'HTTP calls changed' })]));
    expect(out).toContain('### 🔌 HTTP contract\n- HTTP calls changed\n');
  });

  test('refactor advice on a function card cites the isobar guide', () => {
    expect(renderMarkdown(runFixture(refactorIssue))).toContain(
      '\n  ↳ Split it by responsibility: loading, deciding and saving usually belong in separate functions. *(isobar refactor guide)*\n',
    );
  });

  test('convention line: rule, then the file that breaks it, then the example to copy', () => {
    expect(renderMarkdown(runFixture(conventionNew))).toContain(
      '### 📐 Convention broken\n- **Hooks use services, never the other way round** (206 of 208 imports follow it) — `src/services/foo.ts` breaks it.\n  ↳ Copy `src/hooks/me/useSystemicIssuePreferences.ts` instead.\n',
    );
  });

  test('does not escape rule titles a second time', () => {
    const out = renderMarkdown(runFixture(weakened));
    expect(out).toContain('use the \\@/ path alias');
    expect(out).not.toContain('\\\\@');
  });

  test('a broken cycle is an improvement; a new one has its own section', () => {
    expect(renderMarkdown(runFixture(cycleBroken))).toContain('### ✅ Improved\n- `src/services/a.ts` — circular import broken (2 files)\n');
    expect(renderMarkdown(runFixture(cycleNew))).toContain(
      '### 🔁 Circular import\n- `src/services/c.ts` — new circular import across 2 files: `src/services/c.ts`, `src/services/d.ts`\n',
    );
  });

  test('http-info prints just its title; an unmatched call is located', () => {
    expect(renderMarkdown(runFixture(httpSplit))).toContain(
      '### 🔌 HTTP contract\n- HTTP calls in changed files: +1 static, +1 dynamic — no routes in this repo to match them against\n',
    );
    expect(renderMarkdown(runFixture(httpSelf))).toContain('### 🔌 HTTP contract\n- `src/api/orders.ts:40` — `GET /api/orders/export` has no matching route\n');
  });

  test('a report with no findings is a one-line comment: no table, no footer (A29)', () => {
    const oneLine = (h: string): string => `${MARKER}\n## 🌀 isobar-pr · pressure delta\n\n${h}\n\n`;
    expect(renderMarkdown(runFixture(emptyDelta))).toBe(oneLine('No pressure change in 1 changed file'));
    expect(renderMarkdown(runFixture(conventionAbsent))).toBe(oneLine('No pressure change in 2 changed files'));
    const cognitiveOnly: Report = { ...withFindings([]), summary: [{ key: 'cognitive', label: 'Cognitive complexity', base: 1, head: 4, delta: '+3' }] };
    expect(renderMarkdown(cognitiveOnly, { durationMs: 1000 })).toBe(oneLine('+3 cognitive across 1 changed file'));
  });

  test('empty report renders the headline only', () => {
    expect(renderMarkdown(emptyReport({ changedFiles: 2 }))).toBe(`${MARKER}\n## 🌀 isobar-pr · pressure delta\n\nNo analyzable source changed (2 files)\n\n`);
  });

  test('caps a section at 10 items and folds the rest', () => {
    const base = runFixture(crossed);
    const many: Finding[] = Array.from({ length: 14 }, (_, i) => ({
      kind: 'unresolved-new', severity: 'low', file: `src/f${String(i).padStart(2, '0')}.ts`, line: 1, title: `import \`x${i}\` could not be resolved`, data: {},
    }));
    const report: Report = { ...base, findings: many };
    const out = renderMarkdown(report);
    expect(out).toContain('<details><summary>and 4 more</summary>');
    expect(out.match(/could not be resolved/g)).toHaveLength(14);
    expect(out).toContain('- `src/f09.ts:1` — import `x9` could not be resolved\n\n<details><summary>and 4 more</summary>\n\n- `src/f10.ts:1`');
  });
});

describe('truncateComment', () => {
  test('leaves short comments alone and truncates long ones with a note', () => {
    expect(truncateComment('abc')).toEqual({ text: 'abc', truncated: false });
    const long = 'x'.repeat(COMMENT_LIMIT + 10);
    const t = truncateComment(long);
    expect(t.truncated).toBe(true);
    expect(t.text.length).toBeLessThanOrEqual(COMMENT_LIMIT);
    expect(t.text.endsWith('`report.json`._\n')).toBe(true);
    expect(t.text).not.toContain('</details>');
  });

  const tags = (s: string, tag: string): number => s.split(tag).length - 1;
  const unresolved = (n: number): Finding[] =>
    Array.from({ length: n }, (_, i) => finding({ kind: 'unresolved-new', severity: 'low', file: `src/u${String(i).padStart(3, '0')}.ts`, line: 1, title: `import \`x${i}\` could not be resolved` }));

  test('closes a fold the cut left open, so the note is not hidden inside it', () => {
    const md = renderMarkdown(withFindings(unresolved(300)));
    const t = truncateComment(md, 4_000);
    expect(t.text.length).toBeLessThanOrEqual(4_000);
    const before = t.text.slice(0, t.text.indexOf('_Comment truncated.'));
    expect(tags(before, '<details>')).toBeGreaterThan(0);
    expect(tags(before, '<details>')).toBe(tags(before, '</details>'));
    expect(tags(t.text, '<details>')).toBe(tags(t.text, '</details>'));
  });

  test('closes the pre-existing footer the cut left open', () => {
    const preExisting = Array.from({ length: 50 }, (_, i) => ({ file: `src/p${String(i).padStart(2, '0')}.ts`, line: 1, text: 'f over lines' }));
    const md = renderMarkdown({ ...withFindings(unresolved(1)), preExisting });
    const t = truncateComment(md, md.length - 200);
    const before = t.text.slice(0, t.text.indexOf('_Comment truncated.'));
    expect(before).toContain('Pre-existing in changed files (50)');
    expect(tags(before, '<details>')).toBe(1);
    expect(tags(before, '</details>')).toBe(1);
  });

  test('never exceeds the limit, even one smaller than the note', () => {
    const md = renderMarkdown(withFindings(unresolved(300)));
    for (let limit = 0; limit <= 100; limit++) expect(truncateComment(md, limit).text.length, `limit ${limit}`).toBeLessThanOrEqual(limit);
  });

  test('cuts at the last newline when one is near the limit', () => {
    const md = `${'a'.repeat(900)}\n${'b'.repeat(500)}`;
    const t = truncateComment(md, 1_000);
    expect(t.truncated).toBe(true);
    expect(t.text.startsWith(`${'a'.repeat(900)}\n\n_Comment truncated.`)).toBe(true);
    expect(t.text).not.toMatch(/bb/);
  });

  test('cuts mid-line when the last newline is too far back', () => {
    const md = `a\n${'b'.repeat(5_000)}`;
    const t = truncateComment(md, 3_000);
    expect(t.text.length).toBeLessThanOrEqual(3_000);
    expect(t.text).toMatch(/^a\nb+\n\n_Comment truncated\./);
  });

  test('never splits a surrogate pair, whatever the parity of the cut', () => {
    const md = '🌀'.repeat(2_000);
    for (const limit of [1_001, 1_002]) {
      const t = truncateComment(md, limit);
      expect(t.text.length, `limit ${limit}`).toBeLessThanOrEqual(limit);
      expect(t.text, `limit ${limit}`).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
  });
});
