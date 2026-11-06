import type { FunctionRef } from '../graph/index.js';
import { warningKey } from '../graph/index.js';
import { compareText, text } from '../report/text.js';
import type { PreExisting } from '../report/types.js';
import type { DiffContext } from './context.js';
import { endOf, isTestFile, ruleOver } from './functions.js';
import { linesOf } from './security.js';

/** Multiset key of an over-limit function: its name and its sorted, de-duplicated `over` list. */
function overKey(name: string, over: readonly string[]): string {
  return JSON.stringify([name, over]);
}

/** How many base functions carry each key; functions within every limit (as `ruleOver` counts) never match, so they are left out. */
function baseCounts(refs: readonly FunctionRef[], testFile: boolean): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of refs) {
    const over = ruleOver(r.fn, testFile);
    if (over.length === 0) continue;
    const key = overKey(r.name, over);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Head functions of one changed file that claim an unclaimed base twin, in head source order. A function the PR added
 * whole (its lines all added) is new, so it never claims one: the existing twin further down keeps it.
 */
function unchangedFunctions(ctx: DiffContext, file: string): PreExisting[] {
  const testFile = isTestFile(ctx.head, file);
  const free = baseCounts(ctx.base.functionsByFile.get(ctx.basePath(file)) ?? [], testFile);
  const out: PreExisting[] = [];
  for (const h of ctx.head.functionsByFile.get(file) ?? []) {
    const over = ruleOver(h.fn, testFile);
    if (over.length === 0 || ctx.coversRange(file, h.fn.line, endOf(h.fn)) === true) continue;
    const key = overKey(h.name, over);
    const left = free.get(key) ?? 0;
    if (left === 0) continue;
    free.set(key, left - 1);
    out.push({ file, line: h.fn.line, text: `${text(h.name)} over ${over.map(text).join(', ')}` });
  }
  return out;
}

/** Head warnings in changed files whose base twin has the same number of occurrences. */
function unchangedWarnings(ctx: DiffContext): PreExisting[] {
  const out: PreExisting[] = [];
  for (const w of ctx.head.warningsByKey.values()) {
    if (!ctx.isChanged(w.file)) continue;
    const base = ctx.base.warningsByKey.get(warningKey(ctx.basePath(w.file), w.text));
    if (base === undefined || linesOf(base).length !== linesOf(w).length) continue;
    out.push({ file: w.file, line: w.line, text: `${text(w.level)}: ${text(w.text)}` });
  }
  return out;
}

function byPlace(a: PreExisting, b: PreExisting): number {
  return compareText(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || compareText(a.text, b.text);
}

/**
 * The collapsed footer: pressure the changed files already carried and the PR left as it was, listed once instead of
 * reported as findings. Only changed files count, head paths and lines throughout.
 * - Functions: a head function over a limit whose base file (renames applied) has a same-name function over exactly
 *   the same limits (`over` compared sorted and de-duplicated). Pairing is a multiset match, never `name#ordinal`:
 *   each base function vouches for one head function, claimed in head source order, so same-name functions that
 *   swapped places still count while a second copy of an over-limit function does not. A function the PR added whole
 *   (every line of it added) never claims a twin, so a new copy written above the old one leaves the old one listed.
 *   A function that crossed a further limit or left one is not pre-existing (the function rule reports it). Limits are
 *   counted as the function rule counts them (`ruleOver`): in a test file (head `kind`, both sides) `lines` does not
 *   count, so a long describe callback is neither a finding nor a footer line.
 * - Warnings: a head security warning whose base twin (same text, same file through renames: the security rule's
 *   key) has the same number of occurrences (`lines.length`, or 1). A grown warning is a finding instead.
 * - `text` is Markdown-ready: name, limit names, level and warning text go through `text()`, as
 *   `<name> over <limit>, <limit>` or `<level>: <text>`.
 * Sorted by file (`compareText`, code-unit order), then line, then text.
 *
 * Known limits:
 * - The footer pairs on `over` alone; the function rule pairs on the whole fingerprint (`over`, time class, refactor
 *   kinds). So when two same-name functions swap `over` sets while one's time class or issues also change, the
 *   footer lists both, and the function rule can still report one of them as a regression.
 * - isobar caps the warning list at 60. A base warning it cut has no twin, so its unchanged head warning is left out of
 *   the footer (the security rule reports it as possibly pre-existing). The summary rows have the same blind spot.
 */
export function preExisting(ctx: DiffContext): PreExisting[] {
  return [...ctx.changed.flatMap((file) => unchangedFunctions(ctx, file)), ...unchangedWarnings(ctx)].sort(byPlace);
}
