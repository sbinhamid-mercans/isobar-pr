import { isConfigFile } from './config.js';

/** 1-based, inclusive line range on the head side. */
export interface Range {
  start: number;
  end: number;
}

export interface Changes {
  /** Head-side paths changed by the PR (added, copied, modified, renamed, type-changed). */
  changed: Set<string>;
  /** new path → old path for renames. */
  renames: Map<string, string>;
  /** Added-side line ranges per head path, from `git diff -U0`. Undefined when not supplied. */
  hunks?: Map<string, Range[]>;
  /** Head-side line numbers after which lines were deleted (hunks with an empty added side), per head path. */
  deletions?: Map<string, number[]>;
  /** Base-side paths the PR deleted (name-status `D`); never in `changed`. Undefined when not supplied. */
  deleted?: Set<string>;
}

const ESCAPES: Record<string, number> = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7, '\\': 92, '"': 34 };
const OCTAL_DIGIT = /^[0-7]$/;

/** Up to three octal digits starting at `chars[i]`. */
function octalRun(chars: readonly string[], i: number): string {
  let oct = '';
  while (oct.length < 3 && OCTAL_DIGIT.test(chars[i + oct.length] ?? '')) oct += chars[i + oct.length];
  return oct;
}

/**
 * The bytes of the escape whose first character (after the backslash) is `chars[i]`, and how many characters it
 * used: an octal byte, a named escape, a lone trailing backslash, or any other character kept as itself.
 */
function escapeAt(chars: readonly string[], i: number): { bytes: number[]; used: number } {
  const next = chars[i] ?? '';
  const oct = octalRun(chars, i);
  if (oct !== '') return { bytes: [parseInt(oct, 8)], used: oct.length };
  if (next === '') return { bytes: [92], used: 1 };
  const named = ESCAPES[next];
  return { bytes: named !== undefined ? [named] : [...Buffer.from(next, 'utf8')], used: 1 };
}

/** Decodes a C-quoted git path (`"src/caf\303\251.ts"`, written when core.quotePath is on); other strings pass through. */
export function unquotePath(s: string): string {
  if (s.length < 2 || !s.startsWith('"') || !s.endsWith('"')) return s;
  const chars = Array.from(s.slice(1, -1));
  const bytes: number[] = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i]!;
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      i++;
      continue;
    }
    const escape = escapeAt(chars, i + 1);
    bytes.push(...escape.bytes);
    i += 1 + escape.used;
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Normalises a scope directory: `./packages/api/` → `packages/api`; `.`, `./` and empty mean "no scope". */
export function normalizeScope(scope: string | undefined): string | undefined {
  if (!scope) return undefined;
  const s = scope.replace(/^\.\//, '').replace(/\/+$/, '');
  return s === '' || s === '.' ? undefined : s;
}

/** The name-status sets `parseChanges` fills. */
type NameStatus = Required<Pick<Changes, 'changed' | 'renames' | 'deleted'>>;

/** Applies one name-status row (`STATUS\tPATH`, or `STATUS\tFROM\tTO` for renames and copies); malformed rows are skipped. */
function addRow(out: NameStatus, [status = '', first, second]: string[]): void {
  if (status.startsWith('R') || status.startsWith('C')) {
    if (!first || !second) return;
    const to = unquotePath(second);
    out.changed.add(to);
    if (status.startsWith('R')) out.renames.set(to, unquotePath(first));
    return;
  }
  if (first) (status === 'D' ? out.deleted : out.changed).add(unquotePath(first));
}

/**
 * Parses `git diff --name-status -M BASE HEAD` (statuses A, C, D, M, R, T). Deleted paths go to `deleted`, which is
 * always present (possibly empty), never to `changed`.
 */
export function parseChanges(text: string): Changes & { deleted: Set<string> } {
  const out: NameStatus = { changed: new Set(), renames: new Map(), deleted: new Set() };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() !== '') addRow(out, line.split('\t'));
  }
  return out;
}

/**
 * Walks `git diff -U0 BASE HEAD` and calls `visit` with the added side (`+start,count`) of every hunk in a file
 * that exists on the head side, including hunks whose added side is empty (`count === 0`, a pure deletion).
 */
function walkHunks(text: string, visit: (file: string, start: number, count: number) => void): void {
  const state: HunkWalk = { current: undefined, inHeader: false };
  for (const raw of text.split('\n')) {
    const hunk = hunkAt(state, raw.replace(/\r$/, ''));
    if (hunk) visit(hunk.file, hunk.start, hunk.count);
  }
}

/** Where `walkHunks` is: inside a file's header lines, and the head-side file whose hunks follow (undefined: none). */
interface HunkWalk {
  current: string | undefined;
  inHeader: boolean;
}

/** The added side of one hunk in a head-side file. */
interface Hunk {
  file: string;
  start: number;
  count: number;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** Advances the walk past one line; returns the hunk when the line is a hunk header of a file that exists on the head side. */
function hunkAt(state: HunkWalk, line: string): Hunk | undefined {
  if (line.startsWith('diff --git ')) {
    state.inHeader = true;
    state.current = undefined;
    return undefined;
  }
  if (state.inHeader && line.startsWith('+++ ')) {
    state.current = headSidePath(line);
    return undefined;
  }
  if (!line.startsWith('@@')) return undefined;
  state.inHeader = false;
  const file = state.current;
  return file === undefined ? undefined : addedSide(file, line);
}

/** The path a `+++ ` header names, or undefined for `/dev/null` (the file was deleted). */
function headSidePath(line: string): string | undefined {
  const target = unquotePath(line.slice(4).replace(/\t$/, ''));
  return target === '/dev/null' ? undefined : target.replace(/^b\//, '');
}

/** The added side (`+start,count`, count 1 when omitted) of a hunk header, or undefined when the header does not parse. */
function addedSide(file: string, line: string): Hunk | undefined {
  const m = HUNK_HEADER.exec(line);
  if (!m) return undefined;
  return { file, start: Number(m[1]), count: m[2] === undefined ? 1 : Number(m[2]) };
}

/** Parses `git diff -U0 BASE HEAD` into added-side line ranges per file. */
export function parseHunks(text: string): Map<string, Range[]> {
  const hunks = new Map<string, Range[]>();
  walkHunks(text, (file, start, count) => {
    if (count === 0) return;
    const list = hunks.get(file) ?? [];
    list.push({ start, end: start + count - 1 });
    hunks.set(file, list);
  });
  return hunks;
}

/** Parses `git diff -U0 BASE HEAD` into head-side line numbers after which lines were deleted, per file. */
export function parseDeletions(text: string): Map<string, number[]> {
  const deletions = new Map<string, number[]>();
  walkHunks(text, (file, start, count) => {
    if (count !== 0) return;
    const list = deletions.get(file) ?? [];
    list.push(start);
    deletions.set(file, list);
  });
  return deletions;
}

/** An isobar config file at the repo root (no directory); false for undefined. */
function isRootConfig(path: string | undefined): boolean {
  return path !== undefined && !path.includes('/') && isConfigFile(path);
}

/**
 * Keeps only paths under the scope directory, except repo-root config files: isobar reads its config from the root, so
 * a changed or deleted root config (or a head path renamed away from one) stays whatever the scope, rename included.
 * Returns the same object when there is no scope (callers may mutate it).
 */
export function filterChanges(changes: Changes, scope?: string): Changes {
  const s = normalizeScope(scope);
  if (!s) return changes;
  const prefix = s + '/';
  const inScope = (p: string) => p.startsWith(prefix);
  const keep = (p: string) => inScope(p) || isRootConfig(p) || isRootConfig(changes.renames.get(p));
  return {
    changed: new Set([...changes.changed].filter(keep)),
    renames: new Map([...changes.renames].filter(([to]) => keep(to))),
    hunks: changes.hunks ? new Map([...changes.hunks].filter(([p]) => inScope(p))) : undefined,
    deletions: changes.deletions ? new Map([...changes.deletions].filter(([p]) => inScope(p))) : undefined,
    deleted: changes.deleted ? new Set([...changes.deleted].filter((p) => inScope(p) || isRootConfig(p))) : undefined,
  };
}

/** True when [start, end] intersects any range. */
export function overlaps(ranges: Range[] | undefined, start: number, end: number): boolean {
  if (!ranges) return false;
  return ranges.some((r) => r.start <= end && r.end >= start);
}

/** True when every line of [start, end] lies inside the ranges (adjacent or overlapping ranges join). */
export function covers(ranges: Range[] | undefined, start: number, end: number): boolean {
  if (!ranges || end < start) return false;
  let next = start;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    if (r.start > next) return false;
    next = Math.max(next, r.end + 1);
    if (next > end) return true;
  }
  return false;
}
