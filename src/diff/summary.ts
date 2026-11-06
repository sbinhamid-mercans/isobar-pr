import type { GraphIndex } from '../graph/index.js';
import type { GraphFile } from '../graph/types.js';
import { signed } from '../report/text.js';
import type { SummaryKey, SummaryRow } from '../report/types.js';
import type { DiffContext } from './context.js';
import { isTestFile, overCount } from './functions.js';
import { isUnmatched, nonTestCalls } from './http.js';
import { linesOf } from './security.js';

/** One side of the comparison: its index and the changed files in its own path space. */
interface Side {
  idx: GraphIndex;
  files: ReadonlySet<string>;
}

interface SideTotals {
  cognitive: number;
  over: number;
  exceptions: number;
  serious: number;
  advisory: number;
  cycles: number;
  unmatched: number;
}

/** Sum of `count` over the side's changed files that its graph lists (a file new or gone on this side adds 0). */
function sumFiles(side: Side, count: (entry: GraphFile) => number): number {
  const files = side.idx.graph.files;
  let n = 0;
  for (const f of side.files) if (Object.hasOwn(files, f)) n += count(files[f]!);
  return n;
}

/**
 * Functions over a limit the function rule counts (`ruleOver`: not `lines` in a test file) in the side's changed files
 * (`functionsByFile` has an entry for every file the graph lists).
 */
function overLimitCount(side: Side): number {
  let n = 0;
  for (const f of side.files) n += overCount(side.idx.functionsByFile.get(f) ?? [], isTestFile(side.idx, f));
  return n;
}

function unmatchedCount(entry: GraphFile): number {
  return nonTestCalls(entry).filter(isUnmatched).length;
}

/** Warning occurrences in the side's changed files, split by level (every level but `serious` counts as advisory). */
function warningOccurrences(side: Side): { serious: number; advisory: number } {
  let serious = 0;
  let advisory = 0;
  for (const w of side.idx.warningsByKey.values()) {
    if (!side.files.has(w.file)) continue;
    const n = linesOf(w).length;
    if (w.level === 'serious') serious += n;
    else advisory += n;
  }
  return { serious, advisory };
}

/**
 * (pattern, file) pairs with the file changed: a file listed as an exception by two patterns counts twice, while a file
 * one pattern lists twice counts once (isobar de-duplicates on emit; the Set keeps the count right if it ever does not).
 */
function exceptionCount(side: Side): number {
  let n = 0;
  for (const p of side.idx.patternsById.values()) {
    for (const f of new Set(p.exceptions ?? [])) if (side.files.has(f)) n++;
  }
  return n;
}

function touches(cycle: readonly string[], files: ReadonlySet<string>): boolean {
  return cycle.some((f) => files.has(f));
}

function totals(side: Side): SideTotals {
  return {
    cognitive: sumFiles(side, (e) => e.complexity?.cognitive ?? 0),
    over: overLimitCount(side),
    exceptions: exceptionCount(side),
    ...warningOccurrences(side),
    cycles: side.idx.cycles.filter((c) => touches(c, side.files)).length,
    unmatched: sumFiles(side, unmatchedCount),
  };
}

function row(key: SummaryKey, label: string, base: number, head: number): SummaryRow {
  return { key, label, base, head, delta: signed(head - base) };
}

/**
 * The summary table. Every row is totalled over the PR's changed files on both sides: head over the changed head
 * paths, base over the same files in base path space (renames applied), so a file the PR did not touch never moves a
 * row and deleted files count on neither side. Rows carry a stable `key`, in this order:
 * - `cognitive`: the sum of each file's `complexity.cognitive`.
 * - `over-limit`: functions isobar lists over at least one limit (non-empty `over`), counted as the function rule counts
 *   them (`ruleOver`): `lines` does not count in a test file, each side judged by its own entry's `kind`.
 * - `convention-exceptions`: distinct (pattern, file) pairs, i.e. a changed file listed in two patterns' `exceptions`
 *   counts twice, because each listing is one exception to one rule. Only listed exceptions count: isobar caps each
 *   list at 50, so at the cap a row can show a phantom delta.
 * - `security`: warning occurrences (`lines.length`, or 1 when isobar gives no lines), `serious / advisory`, where every
 *   level but `serious` is advisory (isobar 0.7.1 emits only these two; a level added later is counted, never dropped).
 *   Occurrences, not warnings: isobar folds every call site of a (file, text) warning into one entry, so a third unsafe
 *   query in a file that already had two grows the count without a new warning. Only listed warnings count: isobar
 *   caps the list at 60, so at the cap the row can show a phantom delta.
 * - `cycles`: import cycles with at least one changed member.
 * - `http-unmatched`: static, non-external calls no route answers (`isUnmatched`), in changed files that are not of
 *   test kind (each side judged by its own entry's `kind`). Last, and only when head's `httpActive`: in a split repo
 *   every call is unmatched by construction, so the row is omitted and the http rule reports an info line instead.
 */
export function summaryRows(ctx: DiffContext): SummaryRow[] {
  const b = totals({ idx: ctx.base, files: ctx.changedBase });
  const h = totals({ idx: ctx.head, files: new Set(ctx.changed) });
  const rows: SummaryRow[] = [
    row('cognitive', 'Cognitive complexity', b.cognitive, h.cognitive),
    row('over-limit', 'Functions over a limit', b.over, h.over),
    row('convention-exceptions', 'Convention exceptions', b.exceptions, h.exceptions),
    {
      key: 'security',
      label: 'Security warnings serious / advisory',
      base: `${b.serious} / ${b.advisory}`,
      head: `${h.serious} / ${h.advisory}`,
      delta: `${signed(h.serious - b.serious)} / ${signed(h.advisory - b.advisory)}`,
    },
    row('cycles', 'Circular imports', b.cycles, h.cycles),
  ];
  if (ctx.head.httpActive) rows.push(row('http-unmatched', 'HTTP calls with no route', b.unmatched, h.unmatched));
  return rows;
}
