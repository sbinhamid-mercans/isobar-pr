import { listCodes } from '../report/text.js';
import type { Finding } from '../report/types.js';
import type { DiffContext } from './context.js';

/** One import cycle as a graph lists it. */
interface Cycle {
  /** Its distinct files on its own side (head paths for a head cycle), sorted. */
  files: string[];
  /** Identity: its distinct files in base path space, sorted and joined by `\n`. */
  id: string;
  /** Its files in base path space. */
  members: Set<string>;
}

function toCycle(files: readonly string[], basePathOf: (path: string) => string): Cycle {
  const members = new Set(files.map(basePathOf));
  return { files: [...new Set(files)].sort(), id: [...members].sort().join('\n'), members };
}

/** Whether every file of `small` is in `big`. */
function isSubset(small: ReadonlySet<string>, big: ReadonlySet<string>): boolean {
  for (const f of small) if (!big.has(f)) return false;
  return true;
}

function isStrictSubset(small: ReadonlySet<string>, big: ReadonlySet<string>): boolean {
  return small.size < big.size && isSubset(small, big);
}

/** The cycle with the most files, the first in graph order on a tie; undefined when there are none. */
function largest(cycles: readonly Cycle[]): Cycle | undefined {
  return cycles.reduce<Cycle | undefined>((best, c) => (best === undefined || c.members.size > best.members.size ? c : best), undefined);
}

/** Anchor fields of a finding on a head file. */
function anchor(ctx: DiffContext, file: string): Pick<Finding, 'file' | 'renamedFrom' | 'inDiff'> {
  return { file, renamedFrom: ctx.renamedFrom(file), inDiff: ctx.inDiff(file) };
}

/** cycle-grew or cycle-new for a head cycle, or undefined when no member changed, base has it, or it is a remnant. */
function headCycleFinding(ctx: DiffContext, h: Cycle, baseCycles: readonly Cycle[], baseIds: ReadonlySet<string>): Finding | undefined {
  const file = h.files.find((f) => ctx.isChanged(f));
  if (file === undefined || baseIds.has(h.id)) return undefined;
  const grown = largest(baseCycles.filter((b) => isStrictSubset(b.members, h.members)));
  if (grown) {
    const added = h.files.filter((f) => !grown.members.has(ctx.basePath(f)));
    return {
      kind: 'cycle-grew',
      severity: 'high',
      ...anchor(ctx, file),
      title: `circular import grew to ${h.files.length} files (+${added.length}): ${listCodes(added)}`,
      data: { files: h.files, added },
    };
  }
  // A remnant of a larger base cycle is reported once, from the base side, as a shrink.
  if (baseCycles.some((b) => isStrictSubset(h.members, b.members))) return undefined;
  return {
    kind: 'cycle-new',
    severity: 'high',
    ...anchor(ctx, file),
    title: `new circular import across ${h.files.length} files: ${listCodes(h.files)}`,
    data: { files: h.files },
  };
}

/** cycle-broken for a base cycle with a changed member that no head cycle contains, else undefined. */
function baseCycleFinding(ctx: DiffContext, b: Cycle, headCycles: readonly Cycle[]): Finding | undefined {
  // ctx.changed is sorted, so this is the alphabetically first changed member (head path).
  const file = ctx.changed.find((f) => b.members.has(ctx.basePath(f)));
  if (file === undefined || headCycles.some((h) => isSubset(b.members, h.members))) return undefined;
  const remnant = largest(headCycles.filter((h) => isStrictSubset(h.members, b.members)));
  return {
    kind: 'cycle-broken',
    severity: 'improved',
    ...anchor(ctx, file),
    title: remnant ? `circular import shrank from ${b.files.length} to ${remnant.files.length} files` : `circular import broken (${b.files.length} files)`,
    data: { files: b.files, shrankTo: remnant ? remnant.files : null },
  };
}

/**
 * Import cycles the PR created, grew, shrank or broke. A cycle's identity is its sorted file list in base path space
 * (head paths mapped through renames), so neither the order isobar lists files in nor a rename makes a cycle new. Only
 * cycles with at least one changed file are considered.
 * - cycle-new (high): a head cycle not in base that neither contains nor sits inside a base cycle.
 * - cycle-grew (high): a head cycle that strictly contains a base cycle; `data.added` holds its files outside that base
 *   cycle. When several base cycles merged into it, the largest is the one it grew from (the first in graph order on a
 *   tie), so `added` is minimal, and none of them is reported broken (each survives inside it).
 * - cycle-broken (improved): a base cycle no head cycle contains. A head cycle strictly inside it is not new: the base
 *   cycle shrank, reported once here with `data.shrankTo` (the largest such remnant), else `shrankTo` is null. Path
 *   spaces mix: `data.files` are base paths (the base cycle's own), while `file` and `shrankTo` are head paths.
 * - Anchor: the alphabetically first changed member, as a head path. Deleted files are not in the change set, so a
 *   cycle broken only by deleting a member surfaces only when another member changed.
 * - Titles list at most three paths, then ` and N more`; `data` keeps the full lists. isobar's cycles are strongly
 *   connected components with alphabetically sorted members, not import chains, so titles list files and never draw arrows.
 */
export function cycleFindings(ctx: DiffContext): Finding[] {
  const baseCycles = ctx.base.cycles.map((files) => toCycle(files, (p) => p));
  const headCycles = ctx.head.cycles.map((files) => toCycle(files, (p) => ctx.basePath(p)));
  const baseIds = new Set(baseCycles.map((c) => c.id));
  const found = [...headCycles.map((h) => headCycleFinding(ctx, h, baseCycles, baseIds)), ...baseCycles.map((b) => baseCycleFinding(ctx, b, headCycles))];
  return found.filter((f): f is Finding => f !== undefined);
}
