import { cell, code, plural } from './text.js';
import type { Finding, FindingKind, PreExisting, Report, SummaryRow } from './types.js';

/** Hidden first line the action finds its sticky comment by. */
export const MARKER = '<!-- isobar-pr -->';
/** Comment budget in UTF-16 code units (GitHub rejects bodies over 65,536 characters). */
export const COMMENT_LIMIT = 65_000;
/** Findings shown inline per section; the rest fold into a `<details>` block. */
const PER_SECTION = 10;
/** Pre-existing items listed in the footer; the rest are counted and left to report.json. */
const PRE_EXISTING_CAP = 50;
const TITLE = '## 🌀 isobar-pr · pressure delta';
/** Between a location and its title, and between a title and its detail. */
const SEP = ' — ';
/** Between headline parts, between footer facts, and before a function card's line number. */
const DOT = ' · ';
const OUTSIDE_DIFF = ' _(outside the diff)_';

/** One `###` section of the comment: the kinds it lists and, optionally, an order that replaces report order. */
export interface Section {
  heading: string;
  kinds: readonly FindingKind[];
  order?: (a: Finding, b: Finding) => number;
}

/** Base hotspot rank; a finding without one sorts last. */
function rankOf(f: Finding): number {
  const rank = f.data['rank'];
  return typeof rank === 'number' ? rank : Number.MAX_SAFE_INTEGER;
}

/**
 * Comment sections in display order. Must agree with `SECTION_RANK` in `src/diff/index.ts` (A17, tested): kinds that
 * share a section share a rank, and sections are listed by ascending rank. `config-changed` is the banner, not a section.
 */
export const SECTIONS: ReadonlyArray<Readonly<Section>> = [
  { heading: '⚠️ Crossed a limit or got slower', kinds: ['function-regression'] },
  { heading: '🔥 Hotspot touched', kinds: ['hotspot-touched'], order: (a, b) => rankOf(a) - rankOf(b) },
  { heading: '📐 Convention broken', kinds: ['convention-broken', 'convention-weakened'] },
  { heading: '🔒 New security warning', kinds: ['security-new', 'security-grew'] },
  { heading: '🔁 Circular import', kinds: ['cycle-new', 'cycle-grew'] },
  { heading: '🔌 HTTP contract', kinds: ['http-unmatched-call', 'http-uncalled-route', 'http-info'] },
  { heading: '❓ Unresolved import', kinds: ['unresolved-new'] },
  { heading: '✅ Improved', kinds: ['function-improved', 'cycle-broken'] },
];

/** The section that lists each kind (every kind but `config-changed`). */
const SECTION_OF: ReadonlyMap<FindingKind, Readonly<Section>> = new Map(SECTIONS.flatMap((s) => s.kinds.map((k) => [k, s] as const)));

/** Findings grouped by key, each group in report order; a finding whose key is undefined is left out. */
function groupBy<K>(findings: readonly Finding[], keyOf: (f: Finding) => K | undefined): Map<K, Finding[]> {
  const groups = new Map<K, Finding[]>();
  for (const f of findings) {
    const key = keyOf(f);
    if (key === undefined) continue;
    const group = groups.get(key);
    if (group) group.push(f);
    else groups.set(key, [f]);
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------------------------
// Headline

/** A headline family: the kinds it counts and the phrase for a non-empty count. */
export interface Counter {
  kinds: readonly FindingKind[];
  phrase: (items: readonly Finding[]) => string;
}

/** Distinct conventions among the findings: one per `data.patternId` (broken and weakened alike); a finding without one counts on its own. */
function conventionCount(items: readonly Finding[]): number {
  const ids = new Set<string>();
  let unnamed = 0;
  for (const f of items) {
    const id = f.data['patternId'];
    if (typeof id === 'string') ids.add(id);
    else unnamed++;
  }
  return ids.size + unnamed;
}

function securityPhrase(items: readonly Finding[]): string {
  const serious = items.filter((f) => f.severity === 'serious').length;
  return `${plural(items.length, 'security warning')}${serious ? ` (${serious} serious)` : ''}`;
}

/**
 * Headline families in section order. Every sectioned kind is counted except `http-info`, a note rather than
 * pressure (tested); `config-changed` is the banner.
 */
export const COUNTERS: readonly Counter[] = [
  { kinds: ['function-regression'], phrase: (xs) => `${plural(xs.length, 'function')} crossed a limit or got slower` },
  { kinds: ['hotspot-touched'], phrase: (xs) => `${plural(xs.length, 'hotspot')} touched` },
  { kinds: ['convention-broken', 'convention-weakened'], phrase: (xs) => `${plural(conventionCount(xs), 'convention')} broken` },
  { kinds: ['security-new', 'security-grew'], phrase: securityPhrase },
  { kinds: ['cycle-new', 'cycle-grew'], phrase: (xs) => plural(xs.length, 'circular import') },
  { kinds: ['http-unmatched-call'], phrase: (xs) => `${plural(xs.length, 'call')} with no route` },
  { kinds: ['http-uncalled-route'], phrase: (xs) => `${plural(xs.length, 'route')} with no caller` },
  { kinds: ['unresolved-new'], phrase: (xs) => plural(xs.length, 'unresolved import') },
  { kinds: ['function-improved', 'cycle-broken'], phrase: (xs) => `${xs.length} improved` },
];

/** The cognitive delta (found by `key`, never by label; A16), then one phrase per non-empty family. */
function headlineParts(report: Report): string[] {
  const parts: string[] = [];
  const cognitive = report.summary.find((r) => r.key === 'cognitive');
  if (cognitive && cognitive.delta !== '0') parts.push(`${cognitive.delta} cognitive across ${plural(report.meta.changedFiles, 'changed file')}`);
  const groups = groupBy(report.findings, (f) => f.kind);
  for (const counter of COUNTERS) {
    const items = counter.kinds.flatMap((k) => groups.get(k) ?? []);
    if (items.length) parts.push(counter.phrase(items));
  }
  return parts;
}

/**
 * The one-line verdict under the title, e.g. `+8 cognitive across 1 changed file · 1 function crossed a limit or got
 * slower`. Parts, joined by ` · `: the cognitive delta when non-zero, then a count per family (regressions, hotspots,
 * distinct conventions broken or weakened, security with its serious count, cycles, calls with no route, routes with
 * no caller, unresolved imports, improvements).
 * With no part it reads `No pressure change in N changed files`; when no changed file was analyzable,
 * `No analyzable source changed (N files)`.
 */
export function headline(report: Report): string {
  const n = report.meta.changedFiles;
  if (report.meta.analyzedChangedFiles === 0) return `No analyzable source changed (${plural(n, 'file')})`;
  const parts = headlineParts(report);
  return parts.length ? parts.join(DOT) : `No pressure change in ${plural(n, 'changed file')}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Finding lines. Titles, details and advice arrive Markdown-escaped from the rules; only paths added here go through code().

const TITLE_ONLY_KINDS = ['http-info', 'config-changed'] as const;
type TitleOnlyKind = (typeof TITLE_ONLY_KINDS)[number];
/** Repo-wide notes: the line is the title alone (A24); the anchor file is in report.json only, so no path, rename or diff suffix. */
const TITLE_ONLY: ReadonlySet<FindingKind> = new Set<FindingKind>(TITLE_ONLY_KINDS);

function isTitleOnly(kind: FindingKind): kind is TitleOnlyKind {
  return TITLE_ONLY.has(kind);
}

/** `path` or `path:line` as a code span, followed by the old path when the file was renamed. */
function where(f: Finding, withLine: boolean): string {
  const loc = withLine && f.line !== undefined ? `${f.file}:${f.line}` : f.file;
  return `${code(loc)}${f.renamedFrom ? ` (renamed from ${code(f.renamedFrom)})` : ''}`;
}

function withDetail(s: string, f: Finding): string {
  return f.detail ? `${s}${SEP}${f.detail}` : s;
}

/** Function card: `file` › title — detail · L<line> (the line is where the function starts in head). */
function functionLine(f: Finding): string {
  return `${where(f, false)} › ${withDetail(f.title, f)}${f.line !== undefined ? `${DOT}L${f.line}` : ''}`;
}

/** Convention: the rule first, then the file; the detail carries the verb ("breaks it."). */
function conventionLine(f: Finding): string {
  return `${f.title}${SEP}${where(f, false)}${f.detail ? ` ${f.detail}` : ''}`;
}

/** Everything else: `file:line` — title — detail. */
function locatedLine(f: Finding): string {
  return withDetail(`${where(f, true)}${SEP}${f.title}`, f);
}

const LINE: Readonly<Record<Exclude<FindingKind, TitleOnlyKind>, (f: Finding) => string>> = {
  'function-regression': functionLine,
  'function-improved': functionLine,
  'hotspot-touched': locatedLine,
  'convention-broken': conventionLine,
  'convention-weakened': conventionLine,
  'security-new': locatedLine,
  'security-grew': locatedLine,
  'cycle-new': locatedLine,
  'cycle-grew': locatedLine,
  'cycle-broken': locatedLine,
  'http-unmatched-call': locatedLine,
  'http-uncalled-route': locatedLine,
  'unresolved-new': locatedLine,
};

/** Indented `↳` advice line; function advice is isobar's refactor guide text and says so. */
function adviceLine(f: Finding): string {
  if (!f.advice) return '';
  return `\n  ↳ ${f.advice}${f.kind === 'function-regression' ? ' *(isobar refactor guide)*' : ''}`;
}

function renderFinding(f: Finding): string {
  const kind = f.kind;
  const body = isTitleOnly(kind) ? f.title : `${LINE[kind](f)}${f.inDiff === false ? OUTSIDE_DIFF : ''}`;
  return `- ${body}${adviceLine(f)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Comment blocks

function renderSection(section: Readonly<Section>, found: readonly Finding[]): string {
  const items = section.order ? [...found].sort(section.order) : found;
  const shown = items.slice(0, PER_SECTION).map(renderFinding).join('\n');
  const rest = items.slice(PER_SECTION);
  const fold = rest.length ? `\n<details><summary>and ${rest.length} more</summary>\n\n${rest.map(renderFinding).join('\n')}\n\n</details>\n` : '';
  return `### ${section.heading}\n${shown}\n${fold}`;
}

/** One block per non-empty section, in SECTIONS order; items keep report order within a section. */
function sectionBlocks(findings: readonly Finding[]): string[] {
  const groups = groupBy(findings, (f) => SECTION_OF.get(f.kind));
  return SECTIONS.flatMap((section) => {
    const items = groups.get(section);
    return items ? [renderSection(section, items)] : [];
  });
}

function bannerLines(findings: readonly Finding[]): string[] {
  const banner = findings.find((f) => f.kind === 'config-changed');
  return banner ? [`> ⚠️ ${banner.title}`, ''] : [];
}

function tableLines(rows: readonly SummaryRow[]): string[] {
  if (!rows.length) return [];
  const body = rows.map((r) => `| ${cell(r.label)} | ${cell(r.base)} | ${cell(r.head)} | ${cell(r.delta)} |`);
  return ['| Signal (changed files only) | Base | Head | Δ |', '|---|---|---|---|', ...body, ''];
}

/**
 * Escapes `&`, `<` and `>` for text inside an HTML block such as `<summary>…</summary>`, where Markdown backslash
 * escapes (`text()`) are not processed. Every graph-derived value placed in a summary goes through it.
 */
function html(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** First 7 characters of a trimmed sha, keeping a trailing `-dirty` (compare's working-tree head); `?` when it is empty. */
function shortSha(raw: string): string {
  const sha = raw.trim();
  const dirty = sha.endsWith('-dirty') ? '-dirty' : '';
  const bare = sha.slice(0, sha.length - dirty.length);
  return bare.length > 7 ? `${bare.slice(0, 7)}${dirty}` : (sha || '?');
}

/** `5.8 s`, or nothing for a missing, non-finite or negative duration. */
function durationBits(ms: number | undefined): string[] {
  return ms !== undefined && Number.isFinite(ms) && ms >= 0 ? [`${(ms / 1000).toFixed(1)} s`] : [];
}

function preExistingLine(p: PreExisting): string {
  return `- ${code(p.line !== undefined ? `${p.file}:${p.line}` : p.file)}${SEP}${p.text}`;
}

/** At most PRE_EXISTING_CAP items, then a count of the rest (they stay in report.json). */
function preExistingBody(pre: readonly PreExisting[]): string {
  if (!pre.length) return '_Nothing pre-existing in the changed files._';
  const listed = pre.slice(0, PRE_EXISTING_CAP).map(preExistingLine).join('\n');
  const more = pre.length - PRE_EXISTING_CAP;
  return more > 0 ? `${listed}\n\n_and ${more} more in report.json_` : listed;
}

function footerLines(report: Report, durationMs: number | undefined): string[] {
  const { meta, preExisting: pre } = report;
  const bits = [`isobar ${html(meta.toolVersion)}`, `base ${shortSha(meta.baseSha)}`, `head ${shortSha(meta.headSha)}`, ...durationBits(durationMs)];
  return [`<details><summary>Pre-existing in changed files (${pre.length})${DOT}${bits.join(DOT)}</summary>`, '', preExistingBody(pre), '', '</details>', ''];
}

/**
 * The sticky PR comment, in order:
 * 1. `MARKER` (hidden; the action finds and edits the comment by it), the `## 🌀 isobar-pr · pressure delta` title
 *    and the `headline()`. When no changed file was analyzable, or the report has no findings (spec §3: a PR with
 *    no findings gets a one-line comment), that is the whole comment: no banner, table or footer.
 * 2. The config banner (`> ⚠️ …`) when the PR changed isobar's analysis config.
 * 3. The summary table (changed files only, base / head / Δ), cells escaped with `cell()`.
 * 4. One `###` section per non-empty entry of `SECTIONS`, in rank order. Items keep report order (in-diff first, then
 *    severity, file, line) except the 🔥 section, which orders by base hotspot rank. At most 10 items inline; the
 *    rest fold into `<details><summary>and N more</summary>`. Each item is one line, plus an indented `↳` advice line.
 * 5. A collapsed footer listing up to 50 pre-existing over-limit functions and warnings in changed files (then
 *    `_and N more in report.json_`), its summary naming the isobar version, short base and head shas and, when given
 *    as a finite non-negative number, the run duration.
 * Titles, details, advice and pre-existing text are already Markdown-escaped by the rules and are not escaped again.
 */
export function renderMarkdown(report: Report, extra: { durationMs?: number } = {}): string {
  const top = [MARKER, TITLE, '', headline(report), ''];
  if (report.meta.analyzedChangedFiles === 0 || report.findings.length === 0) return `${top.join('\n')}\n`;
  return [
    ...top,
    ...bannerLines(report.findings),
    ...tableLines(report.summary),
    ...sectionBlocks(report.findings),
    ...footerLines(report, extra.durationMs),
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Truncation

const TRUNCATION_NOTE = '\n\n_Comment truncated. The full report is in the job summary and `report.json`._\n';
/** Closes the `<details>` block a cut left open, so the note after it stays visible. */
const DETAILS_CLOSE = '\n\n</details>\n';
/** How far before the cut a newline may sit and still be preferred as the cut point. */
const NEWLINE_WINDOW = 2_000;

/** Where to cut `s` to keep at most `budget` code units: the last newline within NEWLINE_WINDOW, else `budget`, never inside a surrogate pair. */
function cutPoint(s: string, budget: number): number {
  const newline = s.lastIndexOf('\n', budget - 1);
  if (newline >= 0 && budget - newline <= NEWLINE_WINDOW) return newline;
  const unit = s.charCodeAt(budget - 1);
  return unit >= 0xd800 && unit <= 0xdbff ? budget - 1 : budget;
}

function occurrences(s: string, needle: string): number {
  return s.split(needle).length - 1;
}

/**
 * Fits the comment into `limit` UTF-16 code units, never more, ending with a pointer to the job summary and
 * `report.json`.
 * - Cut point: the last line break in the final 2,000 units before the budget, so lines stay whole; with none that
 *   close, mid-line and never inside a surrogate pair (a mid-line cut may leave a code span open).
 * - On a long comment the cut usually lands inside a section's folded remainder or the pre-existing footer. When the
 *   kept text opens more `<details>` than it closes, a `</details>` goes before the note so the note is not hidden in
 *   the collapsed block; the budget always reserves room for it. The layout never nests `<details>`, so one is enough.
 * - A `limit` too small for the note and that closer yields the note's first `limit` units alone.
 */
export function truncateComment(markdown: string, limit = COMMENT_LIMIT): { text: string; truncated: boolean } {
  if (markdown.length <= limit) return { text: markdown, truncated: false };
  const budget = limit - TRUNCATION_NOTE.length - DETAILS_CLOSE.length;
  if (!(budget > 0)) return { text: TRUNCATION_NOTE.slice(0, Math.max(0, limit)), truncated: true };
  const kept = markdown.slice(0, cutPoint(markdown, budget));
  const close = occurrences(kept, '<details>') > occurrences(kept, '</details>') ? DETAILS_CLOSE : '';
  return { text: kept + close + TRUNCATION_NOTE, truncated: true };
}
