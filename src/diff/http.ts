import { isMatchableCall } from '../graph/index.js';
import type { GraphFile, HttpCall } from '../graph/types.js';
import { code, signed } from '../report/text.js';
import type { Finding } from '../report/types.js';
import type { DiffContext } from './context.js';

/** A matchable call that no route in this repo answers. The `http-unmatched` summary row counts with this predicate too. */
export function isUnmatched(c: HttpCall): boolean {
  return isMatchableCall(c) && !c.target;
}

/** Identity of a call or route within its file: `METHOD path`. Lines are ignored, so a moved call is the same call. */
const httpKey = (r: { method: string; path: string | null }): string => `${r.method} ${r.path}`;

/** The entry, or undefined when it is of test kind (isobar's test-file calls and routes are stubs and fixtures, not traffic). */
function nonTest(entry: GraphFile | undefined): GraphFile | undefined {
  return entry?.kind === 'test' ? undefined : entry;
}

/** The calls of a file entry that count as traffic: none for a missing or test-kind entry. The summary row counts with it too. */
export function nonTestCalls(entry: GraphFile | undefined): HttpCall[] {
  return nonTest(entry)?.calls ?? [];
}

/** Static and dynamic call counts, base and head. A type alias, not an interface, so it is assignable to `Finding.data`. */
type CallCounts = { staticBase: number; staticHead: number; dynamicBase: number; dynamicHead: number };

/** [static, dynamic] counts of one side's entry. A call is dynamic when isobar marks it so; every other call counts as static. */
function tally(entry: GraphFile | undefined): [number, number] {
  const calls = nonTestCalls(entry);
  const dynamic = calls.filter((c) => c.dynamic).length;
  return [calls.length - dynamic, dynamic];
}

/**
 * Counts summed over the changed files (each side in its own path space, test-kind entries empty), and the anchor:
 * the first changed file (sorted) whose own counts differ between sides, i.e. the file that gained or lost a call.
 * The anchor is undefined only when no file's counts differ, and then the sums are equal too.
 */
function callCounts(ctx: DiffContext): { counts: CallCounts; anchor: string | undefined } {
  const counts: CallCounts = { staticBase: 0, staticHead: 0, dynamicBase: 0, dynamicHead: 0 };
  let anchor: string | undefined;
  for (const file of ctx.changed) {
    const [staticHead, dynamicHead] = tally(ctx.head.graph.files[file]);
    const [staticBase, dynamicBase] = tally(ctx.base.graph.files[ctx.basePath(file)]);
    counts.staticBase += staticBase;
    counts.staticHead += staticHead;
    counts.dynamicBase += dynamicBase;
    counts.dynamicHead += dynamicHead;
    if (anchor === undefined && (staticHead !== staticBase || dynamicHead !== dynamicBase)) anchor = file;
  }
  return { counts, anchor };
}

/** The http-info line, or undefined when both sums are unchanged (a call that only moved between changed files included). */
function infoFinding(ctx: DiffContext): Finding | undefined {
  const { counts: n, anchor: file } = callCounts(ctx);
  if (file === undefined || (n.staticHead === n.staticBase && n.dynamicHead === n.dynamicBase)) return undefined;
  // Inactive means no routes, or routes but no matchable call (a backend whose only calls are dynamic or in tests).
  const why = (ctx.head.graph.http?.routes?.length ?? 0) > 0 ? 'no static calls in this repo to match its routes against' : 'no routes in this repo to match them against';
  return {
    kind: 'http-info',
    severity: 'info',
    file,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.inDiff(file),
    title: `HTTP calls in changed files: ${signed(n.staticHead - n.staticBase)} static, ${signed(n.dynamicHead - n.dynamicBase)} dynamic — ${why}`,
    data: n,
  };
}

/** http-unmatched-call for each unmatched head call whose key was not already unmatched in the (non-test) base file. */
function unmatchedCallFindings(ctx: DiffContext, file: string, head: GraphFile, base: GraphFile | undefined): Finding[] {
  const known = new Set(nonTestCalls(base).filter(isUnmatched).map(httpKey));
  return (head.calls ?? [])
    .filter((c) => isUnmatched(c) && !known.has(httpKey(c)))
    .map((c) => ({
      kind: 'http-unmatched-call',
      severity: 'medium',
      file,
      line: c.line,
      renamedFrom: ctx.renamedFrom(file),
      inDiff: ctx.inDiff(file, c.line),
      title: `${code(httpKey(c))} has no matching route`,
      data: { method: c.method, path: c.path },
    }));
}

/** http-uncalled-route for each head route with no callers whose key the (non-test) base file did not serve. */
function uncalledRouteFindings(ctx: DiffContext, file: string, head: GraphFile, base: GraphFile | undefined): Finding[] {
  const known = new Set((nonTest(base)?.serves ?? []).map(httpKey));
  return (head.serves ?? [])
    .filter((r) => (r.callers ?? []).length === 0 && !known.has(httpKey(r)))
    .map((r) => ({
      kind: 'http-uncalled-route',
      severity: 'low',
      file,
      line: r.line,
      renamedFrom: ctx.renamedFrom(file),
      inDiff: ctx.inDiff(file, r.line),
      title: `${code(httpKey(r))} is a new route no client in this repo calls`,
      data: { method: r.method, path: r.path },
    }));
}

/** Both per-call kinds for one changed file; none for a file missing from head or of test kind. */
function fileFindings(ctx: DiffContext, file: string): Finding[] {
  const head = nonTest(ctx.head.graph.files[file]);
  if (!head) return [];
  const base = ctx.base.graph.files[ctx.basePath(file)];
  const uncalled = ctx.opts.reportUncalledRoutes ? uncalledRouteFindings(ctx, file, head, base) : [];
  return [...unmatchedCallFindings(ctx, file, head, base), ...uncalled];
}

/**
 * HTTP contract changes in changed files. Whether the repo can match calls to its own routes is head's `httpActive`
 * (routes exist and at least one matchable call sits in a non-test file); a split frontend or backend repo is inactive.
 * Activity is deliberately head-only (spec §7): a PR that adds the first matchable call gets per-call findings, and a
 * PR that removes the last one gets the info line.
 * - Active: http-unmatched-call (medium) for a static, non-external head call with no `target` whose `METHOD path` key
 *   was not already unmatched in the base file (renames applied). http-uncalled-route (low, only with
 *   `reportUncalledRoutes`) for a head route with no callers whose key the base file did not serve.
 * - Inactive: one http-info line (info) with static and dynamic call count deltas over the changed files, only when a
 *   sum differs, anchored on the first changed file whose own counts differ. A call is dynamic when isobar marks it
 *   so; every other call, external ones included, counts as static.
 * - Identity is the key, never the line: a call or route that only moved, or a second call with a key base already had
 *   unmatched, is not reported.
 * - Test-kind files are ignored on both sides, as `httpActive` ignores them (isobar's test-file calls are stubs and
 *   fixtures, not traffic): a head test file yields no per-call finding, a base test file's calls and routes never
 *   make a head key pre-existing (a stub renamed into a service file is new traffic), and neither side's test files
 *   enter the counts.
 * - Deleted files are not in the change set, so calls removed with their file never reach the counts.
 */
export function httpFindings(ctx: DiffContext): Finding[] {
  if (!ctx.head.httpActive) {
    const info = infoFinding(ctx);
    return info ? [info] : [];
  }
  return ctx.changed.flatMap((file) => fileFindings(ctx, file));
}
