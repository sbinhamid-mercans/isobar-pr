import type { FunctionRef, GraphIndex } from '../graph/index.js';
import type { GraphFunction, RefactorIssue, TimeWhy } from '../graph/types.js';
import { code, text, textWithCode } from '../report/text.js';
import type { Finding, Severity } from '../report/types.js';
import type { DiffContext } from './context.js';

const SUPERSCRIPT: Readonly<Record<string, number>> = { '²': 2, '³': 3, '⁴': 4 };
const SUPERSCRIPT_CLASS = `[${Object.keys(SUPERSCRIPT).join('')}]`;
/** One factor of a polynomial label: a variable with an optional `^k` or superscript power. */
const FACTOR = new RegExp(`^([a-z])(?:\\^(\\d+)|(${SUPERSCRIPT_CLASS}))?$`);
/** A label ending in ` log n`, `log² n` or `log^k n`; group 1 is the polynomial before it, absent for a bare log. */
const LOG_SUFFIX = new RegExp(`^(?:(.+?) )?log(?:\\^\\d+|${SUPERSCRIPT_CLASS})? n$`);
/** Rank by polynomial degree (index), capped at the last entry. */
const POLY_RANKS: readonly number[] = [0, 2, 4, 5];
/** Rank of `<polynomial> log n` by the polynomial's degree (index 0 = a bare log), capped at the last entry. */
const LOG_RANKS: readonly number[] = [1, 3, 4.5, 5];

/** Sum of the factor powers (`n·m²` → 3), or undefined when any factor cannot be read. */
function polyDegree(s: string): number | undefined {
  let degree = 0;
  for (const factor of s.split('·')) {
    const m = FACTOR.exec(factor.trim());
    if (!m) return undefined;
    degree += m[2] !== undefined ? Number(m[2]) : m[3] !== undefined ? SUPERSCRIPT[m[3]]! : 1;
  }
  return degree > 0 ? degree : undefined;
}

function rankOf(degree: number | undefined, ranks: readonly number[]): number | undefined {
  return degree === undefined ? undefined : ranks[Math.min(degree, ranks.length - 1)];
}

/**
 * Ordinal growth class of an isobar time label, or undefined when the label cannot be read.
 * 0 O(1) · 1 O(log n) · 2 linear · 3 O(n log n) · 4 quadratic (n², n·m) · 4.5 quadratic × log · 5 cubic or worse (n³, n·m·k, n·m², "or more") · 6 O(2ⁿ).
 */
export function timeRank(time: string | undefined): number | undefined {
  if (time === undefined) return undefined;
  const inner = time.trim().replace(/^O\((.*)\)$/, '$1').trim();
  if (inner === '1') return 0;
  if (/^2(\^n|ⁿ)$/.test(inner)) return 6;
  if (/or more$/.test(inner)) return 5;
  const log = LOG_SUFFIX.exec(inner);
  if (!log) return rankOf(polyDegree(inner), POLY_RANKS);
  return rankOf(log[1] === undefined ? 0 : polyDegree(log[1]), LOG_RANKS);
}

/** The per-function limits isobar enforces. */
export type MetricName = 'cognitive' | 'cyclomatic' | 'nesting' | 'lines' | 'params';

const METRIC_LABEL: Readonly<Record<MetricName, string>> = {
  cognitive: 'cognitive',
  cyclomatic: 'cyclomatic',
  nesting: 'nesting',
  lines: 'lines',
  params: 'parameters',
};

/** True for the five metric names isobar enforces per-function limits on. */
export function isMetric(name: string): name is MetricName {
  return Object.hasOwn(METRIC_LABEL, name);
}

/** One limit a function crossed or left. `name` is isobar's raw `over` entry (unknown names keep limit 0). */
export interface MetricDelta {
  name: string;
  limit: number;
  /** Null when there is no base function or it lacks the metric. */
  base: number | null;
  /** Null when the head function lacks the metric or no longer exists. */
  head: number | null;
}

/** A change of time-complexity class. */
export interface TimeDelta {
  /** Null when isobar did not emit the function in base. */
  base: string | null;
  /** Null when isobar no longer emits the function in head. */
  head: string | null;
  /** Raw "L<line>: <text>" strings from the slower side; escaped with text() only when rendered. */
  why: string[];
}

/** A refactor issue that appeared or was resolved; fields are raw graph text. */
export interface IssueDelta {
  kind: string;
  severity: string;
  title: string;
  how: string;
  why: string;
}

interface Measure {
  crossed: MetricDelta[];
  left: MetricDelta[];
  time: { up?: TimeDelta; down?: TimeDelta };
  newIssues: IssueDelta[];
  goneIssues: IssueDelta[];
}

/** Where a head function sits and whether the PR touched it. */
interface Where {
  file: string;
  line: number;
  renamedFrom: string | undefined;
  inDiff: boolean | undefined;
}

/** How a head function relates to base: matched, new, or previously omitted as trivial. */
interface Origin {
  matched: boolean;
  /** The file (rename-mapped) does not exist in base. */
  newFile: boolean;
  isNew: boolean;
  wasWithinLimits: boolean;
  suffix: string;
}

const MATCHED: Origin = { matched: true, newFile: false, isNew: false, wasWithinLimits: false, suffix: '' };
/** Quadratic or worse: the time class at which a function with no counterpart on the other side is reported (a new O(n log n) sort is normal). */
const SLOW_RANK = 4;
const ISSUE_RANK: ReadonlyMap<string, number> = new Map([
  ['serious', 0],
  ['high', 1],
  ['medium', 2],
  ['low', 3],
]);
/** Issue kinds that only restate a limit the function already exceeds (isobar emits them next to `over`). */
const LIMIT_RESTATING_KINDS: ReadonlySet<string> = new Set(['logic', 'long-function', 'long-component', 'paths', 'switch', 'chain', 'nesting', 'params']);

/** Items of `a` whose key does not occur in `b`, in `a`'s order. */
function minus<T>(a: readonly T[], b: readonly T[], key: (x: T) => string = String): T[] {
  const drop = new Set(b.map(key));
  return a.filter((x) => !drop.has(key(x)));
}

/** The limits a function exceeds, de-duplicated and sorted (the form every comparison of `over` lists uses). */
export function overOf(fn: GraphFunction | undefined): string[] {
  return [...new Set(fn?.over ?? [])].sort();
}

/** True when isobar classifies the file as a test (kind `test`) on this side. */
export function isTestFile(idx: GraphIndex, file: string): boolean {
  return idx.graph.files[file]?.kind === 'test';
}

/**
 * The limits the function rule counts for a function: `overOf`, minus `lines` in a test file (describe / it callbacks
 * are long by nature, A35 #4). The summary's over-limit row and the pre-existing footer count with it too, so the three
 * agree on what "over a limit" means.
 */
export function ruleOver(fn: GraphFunction | undefined, testFile: boolean): string[] {
  const over = overOf(fn);
  return testFile ? over.filter((name) => name !== 'lines') : over;
}

/** Last line of a function: `end_line`, or its first line when isobar gives none. */
export function endOf(fn: GraphFunction): number {
  return fn.end_line ?? fn.line;
}

function limitOf(limits: Record<string, number>, name: string): number {
  return Object.hasOwn(limits, name) ? (limits[name] ?? 0) : 0;
}

function metricValue(fn: GraphFunction | undefined, name: string): number | null {
  return fn !== undefined && isMetric(name) ? (fn[name] ?? null) : null;
}

function metricDelta(
  limits: Record<string, number>,
  name: string,
  base: GraphFunction | undefined,
  head: GraphFunction | undefined,
): MetricDelta {
  return { name, limit: limitOf(limits, name), base: metricValue(base, name), head: metricValue(head, name) };
}

function whyLines(why: TimeWhy[] | undefined): string[] {
  return (why ?? []).map((w) => `L${w.line}: ${w.text}`);
}

function toIssue(i: RefactorIssue): IssueDelta {
  return { kind: i.kind, severity: i.severity, title: i.title, how: i.how ?? '', why: i.why ?? '' };
}

function issueRank(i: IssueDelta): number {
  return ISSUE_RANK.get(i.severity) ?? ISSUE_RANK.size;
}

/** Highest severity first (serious > high > medium > low > other); ties keep array order. */
function mostSevere(issues: IssueDelta[]): IssueDelta | undefined {
  let best: IssueDelta | undefined;
  for (const i of issues) if (best === undefined || issueRank(i) < issueRank(best)) best = i;
  return best;
}

/** Escaped issue titles for a title line: unique, first-seen order, limit-restating kinds dropped when a limit label is already shown, at most two plus "+N more". */
function issueTitles(issues: readonly IssueDelta[], hasLimitLabels: boolean): string[] {
  const kept = hasLimitLabels ? issues.filter((i) => !LIMIT_RESTATING_KINDS.has(i.kind)) : issues;
  const unique = [...new Set(kept.map((i) => i.title))];
  const shown = unique.slice(0, 2).map(text);
  if (unique.length > 2) shown.push(`+${unique.length - 2} more`);
  return shown;
}

function fmt(v: number | null): string {
  return v === null ? '–' : String(v);
}

function label(name: string): string {
  return isMetric(name) ? METRIC_LABEL[name] : text(name);
}

function timeText(t: string | null): string {
  return t === null ? '–' : text(t);
}

/** `base → ` for a time change, or nothing when the function had no base time. */
function timeFrom(t: TimeDelta): string {
  return t.base === null ? '' : `${text(t.base)} → `;
}

function timeChange(head: GraphFunction, base: GraphFunction | undefined): Measure['time'] {
  const headTime = head.time;
  const baseTime = base?.time;
  if (headTime === undefined || baseTime === undefined) return {};
  const h = timeRank(headTime);
  const b = timeRank(baseTime);
  if (h === undefined || b === undefined || h === b) return {};
  return h > b
    ? { up: { base: baseTime, head: headTime, why: whyLines(head.time_why) } }
    : { down: { base: baseTime, head: headTime, why: whyLines(base?.time_why) } };
}

/** The function's time label when it is quadratic or worse, for a function with no counterpart on the other side. */
function slowTime(fn: GraphFunction): string | undefined {
  return fn.time !== undefined && (timeRank(fn.time) ?? 0) >= SLOW_RANK ? fn.time : undefined;
}

/**
 * The issues that count as new (or resolved). An issue of a limit-restating kind changes only with a limit: one that
 * appears while no limit was crossed (or goes while none was left) is isobar relabelling a limit the function still
 * exceeds (it keeps one complexity issue: `paths` becomes `logic` once cognitive is over too), so it is dropped.
 */
function changedIssues(issues: IssueDelta[], limitsMoved: boolean): IssueDelta[] {
  return limitsMoved ? issues : issues.filter((i) => !LIMIT_RESTATING_KINDS.has(i.kind));
}

function measure(limits: Record<string, number>, head: GraphFunction, base: GraphFunction | undefined): Measure {
  const delta = (name: string): MetricDelta => metricDelta(limits, name, base, head);
  const byKind = (i: RefactorIssue): string => i.kind;
  const headIssues = head.refactor ?? [];
  const baseIssues = base?.refactor ?? [];
  const crossed = minus(overOf(head), overOf(base)).map(delta);
  const left = minus(overOf(base), overOf(head)).map(delta);
  return {
    crossed,
    left,
    time: timeChange(head, base),
    newIssues: changedIssues(minus(headIssues, baseIssues, byKind).map(toIssue), crossed.length > 0),
    goneIssues: changedIssues(minus(baseIssues, headIssues, byKind).map(toIssue), left.length > 0),
  };
}

/**
 * For a head function with no base match: new when the file is new or the added lines cover it; omitted as trivial in
 * base (was within every limit) when the hunks are known and do not cover it; otherwise unknown (not measured in base).
 */
function originOf(ctx: DiffContext, file: string, fn: GraphFunction): Origin {
  const newFile = !Object.hasOwn(ctx.base.graph.files, ctx.basePath(file));
  const covered = ctx.coversRange(file, fn.line, endOf(fn));
  const isNew = newFile || covered === true;
  const wasWithinLimits = !isNew && covered === false;
  const suffix = isNew ? ' · new' : wasWithinLimits ? ' · was within every limit' : ' · not measured in base';
  return { matched: false, newFile, isNew, wasWithinLimits, suffix };
}

function describeRegression(m: Measure, worst: IssueDelta | undefined, origin: Origin): string {
  const parts = m.crossed.map(
    (d) => `${label(d.name)} ${origin.matched ? `${fmt(d.base)} → ` : ''}**${fmt(d.head)}** (limit ${d.limit})`,
  );
  const up = m.time.up;
  if (up) parts.push(`${timeFrom(up)}**${timeText(up.head)}**${up.why[0] !== undefined ? ` (${text(up.why[0])})` : ''}`);
  if (parts.length === 0 && worst) parts.push(text(worst.title));
  return parts.join(', ') + origin.suffix;
}

function describeImprovement(m: Measure): string {
  const parts = m.left.map((d) => `${label(d.name)} ${fmt(d.base)} → ${fmt(d.head)}, now within limit ${d.limit}`);
  const down = m.time.down;
  if (down) parts.push(`${timeFrom(down)}${timeText(down.head)}`);
  for (const t of issueTitles(m.goneIssues, m.left.length > 0)) parts.push(`${t} resolved`);
  return parts.join(', ');
}

/**
 * High for a serious or high new issue, or a time class that provably went up: a matched function, or one omitted as
 * trivial in base. A slow function that is new (or not measured in base) is medium.
 */
function regressionSeverity(up: TimeDelta | undefined, worst: IssueDelta | undefined, origin: Origin): Severity {
  const slowerThanBase = up !== undefined && (origin.matched || origin.wasWithinLimits);
  return slowerThanBase || (worst !== undefined && issueRank(worst) <= 1) ? 'high' : 'medium';
}

function regressionFinding(head: FunctionRef, m: Measure, where: Where, origin: Origin): Finding | undefined {
  const up = m.time.up;
  if (m.crossed.length === 0 && up === undefined && m.newIssues.length === 0) return undefined;
  const worst = mostSevere(m.newIssues);
  return {
    kind: 'function-regression',
    severity: regressionSeverity(up, worst, origin),
    ...where,
    title: `${code(head.name)} — ${describeRegression(m, worst, origin)}`,
    advice: worst && worst.how !== '' ? textWithCode(worst.how) : undefined,
    data: {
      name: head.name,
      ordinal: head.ordinal,
      metrics: m.crossed,
      time: up ?? null,
      issues: m.newIssues,
      isNew: origin.isNew,
      wasWithinLimits: origin.wasWithinLimits,
      newFile: origin.newFile,
    },
  };
}

function improvementFinding(head: FunctionRef, m: Measure, where: Where): Finding | undefined {
  const down = m.time.down;
  if (m.left.length === 0 && down === undefined && m.goneIssues.length === 0) return undefined;
  return {
    kind: 'function-improved',
    severity: 'improved',
    ...where,
    title: `${code(head.name)} — ${describeImprovement(m)}`,
    data: { name: head.name, ordinal: head.ordinal, metrics: m.left, time: down ?? null, issues: m.goneIssues },
  };
}

function compareFunction(ctx: DiffContext, file: string, head: FunctionRef, base: FunctionRef | undefined): Finding[] {
  const m = measure(ctx.head.limits, head.fn, base?.fn);
  const origin = base ? MATCHED : originOf(ctx, file, head.fn);
  const slow = origin.matched ? undefined : slowTime(head.fn);
  if (slow !== undefined) m.time.up = { base: null, head: slow, why: whyLines(head.fn.time_why) };
  const where: Where = {
    file,
    line: head.fn.line,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.inDiffRange(file, head.fn.line, endOf(head.fn)),
  };
  return [regressionFinding(head, m, where, origin), improvementFinding(head, m, where)].filter(
    (f): f is Finding => f !== undefined,
  );
}

/** Items grouped by key, each group in input order. */
function groupBy<T>(items: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const x of items) {
    const k = key(x);
    const list = groups.get(k);
    if (list) list.push(x);
    else groups.set(k, [x]);
  }
  return groups;
}

/** Over-limit sets, time class and refactor kinds: two functions with equal fingerprints compare to no finding. */
function fingerprint(fn: GraphFunction): string {
  return JSON.stringify([overOf(fn), timeRank(fn.time) ?? null, (fn.refactor ?? []).map((i) => i.kind).sort()]);
}

/** Same-name functions on each side, in source order. */
interface Group {
  heads: FunctionRef[];
  bases: FunctionRef[];
}

/**
 * Removes same-fingerprint pairs (a reorder, or a shift in which members isobar emits), returning the rest in source order.
 * Two same-name functions that swap fingerprints (one improves as the other regresses) cancel out and report nothing.
 */
function unpaired(heads: FunctionRef[], bases: FunctionRef[]): Group {
  const free = groupBy(bases, (b) => fingerprint(b.fn));
  const used = new Set<FunctionRef>();
  const restHeads: FunctionRef[] = [];
  for (const h of heads) {
    const match = free.get(fingerprint(h.fn))?.shift();
    if (match) used.add(match);
    else restHeads.push(h);
  }
  return { heads: restHeads, bases: bases.filter((b) => !used.has(b)) };
}

/** How many of the functions are over at least one limit the rule counts (`ruleOver`; the `over-limit` summary row uses it too). */
export function overCount(refs: readonly FunctionRef[], testFile = false): number {
  return refs.filter((r) => ruleOver(r.fn, testFile).length > 0).length;
}

/**
 * A name whose unpaired members differ in number on each side: one finding on the net change of over-limit members,
 * counted over the whole group (paired members have equal over-limit sets, so they never change the difference) and
 * anchored on an unpaired member the PR touched.
 */
function approximate(ctx: DiffContext, file: string, group: Group, rest: Group): Finding[] {
  const baseCount = overCount(group.bases);
  const headCount = overCount(group.heads);
  if (baseCount === headCount) return [];
  const touched = rest.heads.filter((h) => ctx.inDiffRange(file, h.fn.line, endOf(h.fn)) === true);
  const anchor = touched.find((h) => overOf(h.fn).length > 0) ?? touched[0] ?? rest.heads[0]!;
  const name = anchor.name;
  const common = {
    file,
    line: anchor.fn.line,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.changes.hunks === undefined ? undefined : touched.length > 0,
    title: `${code(name)} ×${group.heads.length} — ${headCount} over a limit, was ${baseCount}`,
    detail: 'approximate match: the number of functions with this name changed',
    data: { name, metrics: [], issues: [], time: null, approximate: true, overBase: baseCount, overHead: headCount },
  };
  return headCount > baseCount
    ? [{ kind: 'function-regression', severity: 'medium', ...common }]
    : [{ kind: 'function-improved', severity: 'improved', ...common }];
}

/** Counts of the parts a vanished title shows: limit labels, a time class (0 or 1) and issue titles. */
interface Shown {
  limits: number;
  time: number;
  issues: number;
}

/** `no longer over a limit` when only limit labels are shown, `resolved` when only issue titles are, otherwise `no longer reported`. */
function vanishedVerb(shown: Shown): string {
  const onlyLimits = shown.time === 0 && shown.issues === 0;
  const onlyIssues = shown.limits === 0 && shown.time === 0;
  if (onlyLimits) return 'no longer over a limit';
  return onlyIssues ? 'resolved' : 'no longer reported';
}

/**
 * A base function over a limit, quadratic or worse, or with refactor issues, that isobar no longer emits for the head (the
 * file still exists): it was simplified within every limit, moved or removed. One finding names the limits, the time
 * class and the issue titles (see issueTitles), in that order; data.issues keeps every raw issue.
 */
function vanishedFinding(ctx: DiffContext, file: string, b: FunctionRef): Finding | undefined {
  const over = overOf(b.fn);
  const slow = slowTime(b.fn);
  const issues = (b.fn.refactor ?? []).map(toIssue);
  if (over.length === 0 && slow === undefined && issues.length === 0) return undefined;
  const times = slow === undefined ? [] : [text(slow)];
  const titles = issueTitles(issues, over.length > 0);
  const verb = vanishedVerb({ limits: over.length, time: times.length, issues: titles.length });
  const limits = ctx.head.limits;
  return {
    kind: 'function-improved',
    severity: 'improved',
    file,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.inDiff(file),
    title: `${code(b.name)} — ${[...over.map(label), ...times, ...titles].join(', ')} ${verb} (simplified, moved or removed)`,
    data: {
      name: b.name,
      ordinal: b.ordinal,
      metrics: over.map((n) => metricDelta(limits, n, b.fn, undefined)),
      time: slow === undefined ? null : { base: slow, head: null, why: whyLines(b.fn.time_why) },
      issues,
      vanished: true,
    },
  };
}

function vanished(ctx: DiffContext, file: string, bases: FunctionRef[]): Finding[] {
  return bases.map((b) => vanishedFinding(ctx, file, b)).filter((f): f is Finding => f !== undefined);
}

/** Same-fingerprint pairs drop out; the rest pair by order, or fall back to approximate / vanished when one side runs out or the counts differ. */
function matchGroup(ctx: DiffContext, file: string, group: Group): Finding[] {
  const rest = unpaired(group.heads, group.bases);
  if (rest.heads.length === 0) return vanished(ctx, file, rest.bases);
  if (rest.bases.length === 0 || rest.bases.length === rest.heads.length) {
    return rest.heads.flatMap((h, i) => compareFunction(ctx, file, h, rest.bases[i]));
  }
  return approximate(ctx, file, group, rest);
}

/** Refactor issue kinds that restate the lines limit (isobar attaches one whenever `lines` is over). */
const LINES_ISSUE_KINDS: ReadonlySet<string> = new Set(['long-function', 'long-component']);

/**
 * The ref with the lines limit gone: `lines` dropped from its over-limit list (`ruleOver`) and the issues that restate it
 * dropped too, so a long test callback that vanishes is not "A 130-line function resolved" either. Other limits, the
 * time class and other issues are kept.
 */
function withoutLinesLimit(r: FunctionRef): FunctionRef {
  const refactor = r.fn.refactor?.filter((i) => !LINES_ISSUE_KINDS.has(i.kind));
  return { ...r, fn: { ...r.fn, over: ruleOver(r.fn, true), refactor } };
}

/**
 * The functions as this rule compares them. In a test file (head kind `test`) the lines limit does not count on either
 * side: describe / it callbacks are long by nature (A35 #4), so lines alone never makes a finding there.
 */
function compared(ctx: DiffContext, file: string, refs: readonly FunctionRef[]): readonly FunctionRef[] {
  return isTestFile(ctx.head, file) ? refs.map(withoutLinesLimit) : refs;
}

/**
 * Per-function regressions and improvements in every changed file isobar measured on the head side: limits crossed or
 * left, time class up or down, refactor issues new or resolved. Same-name functions pair by fingerprint, then by order.
 * isobar omits trivial functions, so a head function with no base match in an existing file was within every limit
 * unless the added lines cover it (unknown without hunks), and a base function missing from the head was simplified,
 * moved or removed. A function with no counterpart is also reported when it is quadratic or worse or has refactor issues.
 * Test files ignore the lines limit (see `compared`).
 */
export function functionFindings(ctx: DiffContext): Finding[] {
  const out: Finding[] = [];
  for (const file of ctx.changed) {
    const headRefs = ctx.head.functionsByFile.get(file);
    if (!headRefs) continue;
    const headGroups = groupBy(compared(ctx, file, headRefs), (r) => r.name);
    const baseGroups = groupBy(compared(ctx, file, ctx.base.functionsByFile.get(ctx.basePath(file)) ?? []), (r) => r.name);
    for (const name of new Set([...headGroups.keys(), ...baseGroups.keys()])) {
      out.push(...matchGroup(ctx, file, { heads: headGroups.get(name) ?? [], bases: baseGroups.get(name) ?? [] }));
    }
  }
  return out;
}
