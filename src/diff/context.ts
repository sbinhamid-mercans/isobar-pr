import type { GraphIndex } from '../graph/index.js';
import type { FailOn } from '../report/types.js';
import type { Changes } from './changes.js';
import { covers, overlaps } from './changes.js';

export interface DiffOptions {
  /** Which findings turn the gate red. */
  failOn: FailOn;
  /** Also report new routes with no caller in this repo (`--report-uncalled-routes`, default false). */
  reportUncalledRoutes: boolean;
  /** Branch or ref the PR merges into, for display. */
  baseRef: string;
  /** Merge-base commit the base graph was built from. */
  baseSha: string;
  /** PR head commit the head graph was built from. */
  headSha: string;
}

export interface DiffContext {
  base: GraphIndex;
  head: GraphIndex;
  changes: Changes;
  opts: DiffOptions;
  /** Changed head paths, sorted. */
  changed: string[];
  /** The same files in base path space (renames applied). */
  changedBase: Set<string>;
  /** Base paths the PR deleted; empty when unknown. Only the config banner reads it (spec §7: other rules ignore deleted files). */
  deleted: ReadonlySet<string>;
  basePath(headPath: string): string;
  /** The base path when the file was renamed, else undefined (the value for `Finding.renamedFrom`). */
  renamedFrom(headPath: string): string | undefined;
  isChanged(headPath: string): boolean;
  /** Undefined when hunks are unknown. With no line: whether the file is in the change set. With a line: whether that head line was added. */
  inDiff(file: string, line?: number): boolean | undefined;
  /** Whether [start, end] contains an added line or a point where lines were deleted (so a function shrunk by deletions counts as touched). */
  inDiffRange(file: string, start: number, end: number): boolean | undefined;
  /** Undefined when hunks are unknown; otherwise whether every line of [start, end] was added (the function is wholly new). */
  coversRange(file: string, start: number, end: number): boolean | undefined;
}

/**
 * Builds the per-comparison helper the rules share: head-to-base path mapping through renames, the sorted change set,
 * and "did the PR touch these lines?" answers from added hunks and deletion points (undefined when hunks are unknown).
 */
export function createContext(base: GraphIndex, head: GraphIndex, changes: Changes, opts: DiffOptions): DiffContext {
  const changed = [...changes.changed].sort();
  const changedSet = new Set(changed);
  const basePath = (p: string): string => changes.renames.get(p) ?? p;
  const changedBase = new Set(changed.map(basePath));
  const inDiffRange = (file: string, start: number, end: number): boolean | undefined => {
    if (!changes.hunks) return undefined;
    if (overlaps(changes.hunks.get(file), start, end)) return true;
    return (changes.deletions?.get(file) ?? []).some((p) => start <= p && p < end);
  };
  return {
    base,
    head,
    changes,
    opts,
    changed,
    changedBase,
    deleted: changes.deleted ?? new Set(),
    basePath,
    renamedFrom: (p) => {
      const b = basePath(p);
      return b !== p ? b : undefined;
    },
    isChanged: (p) => changedSet.has(p),
    inDiff: (file, line) => (line === undefined ? (changes.hunks ? changedSet.has(file) : undefined) : inDiffRange(file, line, line)),
    inDiffRange,
    coversRange: (file, start, end) => (changes.hunks ? covers(changes.hunks.get(file), start, end) : undefined),
  };
}
