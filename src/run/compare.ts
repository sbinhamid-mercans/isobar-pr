/**
 * `compare`, the impure half of isobar-pr: resolve the refs, take the merge base, collect the PR's changes from git, run
 * isobar on both sides and hand the two graphs to `diffGraphs`. What callers rely on:
 * - `dir` must be the repository's top level (a subfolder is exit 2; `--scope` narrows instead), so isobar's
 *   dir-relative `files` keys and git's repo-relative paths are the same strings (A32, A33).
 * - The base side is a detached worktree at the merge base in a fresh temp folder. The head side is the working tree in
 *   place (`headRef` 'HEAD': uncommitted edits and untracked files included, `-dirty` in `meta.headSha` when there are
 *   any), or a second worktree when `headRef` names a commit. isobar writes nothing inside either.
 * - Changes are built in full (name-status, hunks, deletion points, deleted paths, untracked files) and scope-filtered
 *   once (A12, A14, A25, A26).
 * - A PR whose changed, deleted and renamed-from paths include nothing isobar parses and no isobar config skips isobar
 *   and returns `emptyReport` (A33: no finding can come from any other file).
 * - The worktrees are removed and the temp folder deleted whatever happens; `keepTemp` keeps the folder (both graphs).
 * - Errors: CompareError (code 2: a bad version, directory, scope or ref, not a git repository, no merge base; git's
 *   stderr rides along when git said why); GitError and IsobarError keep their own codes; SchemaError and
 *   VersionMismatchError exit 3 through `handleError`.
 */
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Changes, Range } from '../diff/changes.js';
import { filterChanges, normalizeScope, parseChanges, parseDeletions, parseHunks } from '../diff/changes.js';
import { isConfigFile } from '../diff/config.js';
import { diffGraphs, emptyReport } from '../diff/index.js';
import type { GraphIndex } from '../graph/index.js';
import { buildIndex } from '../graph/index.js';
import { VersionMismatchError, loadGraph } from '../graph/load.js';
import type { FailOn, Report } from '../report/types.js';
import { GitError, diffHunks, diffNameStatus, headSha, isDirty, isShallow, listUntracked, mergeBase, resolveRef, topLevel, worktreeAdd, worktreeRemove } from './git.js';
import { DEFAULT_ISOBAR_VERSION, isAnalyzable, isExactSemver, runIsobar } from './isobar.js';

export interface CompareOptions {
  /** The repository's top-level folder; a subfolder is refused (use `scope`). */
  dir: string;
  /** The branch the PR merges into; the base side is its merge base with the head. */
  baseRef: string;
  /** 'HEAD' = the working tree, uncommitted edits and untracked files included; anything else = that commit. */
  headRef: string;
  /** An exact version (`isExactSemver`), the same on both sides. */
  isobarVersion: string;
  /** Only analyze this folder of the repository (normalised; must exist). */
  scope?: string;
  failOn: FailOn;
  reportUncalledRoutes: boolean;
  /** Keep the temp folder (both graph.json files) and log its path; the worktrees are removed regardless. */
  keepTemp: boolean;
  /** Progress lines; the CLI prints them on stderr. */
  log: (line: string) => void;
}

/** A bad version, directory, scope or ref, or no merge base; `handleError` prints the message and `stderr`, then exits `code`. */
export class CompareError extends Error {
  override name = 'CompareError';
  constructor(
    message: string,
    public readonly code: 2 | 3,
    /** git's own explanation, when a git call underlies the error. */
    public readonly stderr = '',
  ) {
    super(message);
  }
}

const FETCH_HINT = 'In GitHub Actions, check out with history:\n  - uses: actions/checkout@v5\n    with: { fetch-depth: 0 }';

/** Everything `compare` resolves before it reads the diff. */
interface Sides {
  /** The repository's top level, realpath'd. */
  top: string;
  /** The normalised scope, relative to `top`; undefined for the whole repository. */
  scope: string | undefined;
  /** The merge base of the base ref and the head. */
  base: string;
  /** The head commit when `headRef` names one; undefined when the head is the working tree. */
  headCommit: string | undefined;
  /** The commit the head is (or sits on, for the working tree). */
  headTip: string;
  /** The head is a working tree with staged, unstaged or untracked edits. */
  dirty: boolean;
}

const short = (sha: string): string => sha.slice(0, 7);

/** `meta.headSha` (`sha` = identity) or its log form (`sha` = short): the head commit, `-dirty` for an edited working tree. */
function headLabel(s: Sides, sha: (full: string) => string = (full) => full): string {
  return `${sha(s.headTip)}${s.dirty ? '-dirty' : ''}`;
}

/**
 * The top level of the working tree `abs` is in, realpath'd. git exiting 128 (not a repository, a bare one, inside
 * `.git`, a repository git refuses to trust) is code 2 with git's stderr; a git that cannot run stays a GitError (3).
 */
function topLevelOf(abs: string, dir: string): string {
  try {
    return realpathSync(topLevel(abs));
  } catch (e) {
    if (e instanceof GitError && e.status === 128) throw new CompareError(`not in a git repository: ${dir}`, 2, e.stderr);
    throw e;
  }
}

/** The repository top level `dir` must be, realpath'd on both sides of the comparison (A32: macOS /var → /private/var). */
function repoRoot(dir: string): string {
  const abs = resolve(dir);
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) throw new CompareError(`${dir} is not a directory`, 2);
  const top = topLevelOf(abs, dir);
  if (realpathSync(abs) !== top) {
    throw new CompareError(`${dir} is inside the repository ${top}; run isobar-pr from the repository root and use --scope <subdir> to narrow the analysis`, 2);
  }
  return top;
}

/**
 * The scope as a path relative to `top` (A12): normalised, then resolved, so `./src/`, `src//`, `docs/../src` and an
 * absolute path into the repository all read `src`. Code 2 unless it names a folder inside the repository (a mistyped
 * scope must not pass green as "no analyzable source"); a scope that resolves to the root is no scope.
 */
function resolveScope(top: string, raw: string | undefined): string | undefined {
  const scope = normalizeScope(raw);
  if (scope === undefined) return undefined;
  const abs = resolve(top, scope);
  const rel = statSync(abs, { throwIfNoEntry: false })?.isDirectory() ? relative(top, realpathSync(abs)) : '..';
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new CompareError(`--scope ${raw} is not a directory in ${top}`, 2);
  return rel === '' ? undefined : rel;
}

/** ` (this clone is shallow)` when it is: the usual reason, in CI, that a ref or the merge base is missing. */
function shallowNote(top: string): string {
  return isShallow(top) ? ' (this clone is shallow)' : '';
}

/** A ref as a commit sha, or code 2 with the fetch hint (a depth-1 checkout, the Actions default, fails here first). */
function commitOf(top: string, side: 'base' | 'head', ref: string): string {
  const sha = resolveRef(top, ref);
  if (sha === undefined) throw new CompareError(`${side} ref "${ref}" not found in ${top}${shallowNote(top)}. ${FETCH_HINT}`, 2);
  return sha;
}

/** The merge base; any git failure (no common ancestor, history cut short) is code 2 with the fetch hint and git's stderr (A32). */
function mergeBaseOf(top: string, baseTip: string, headTip: string, baseRef: string, headRef: string): string {
  try {
    return mergeBase(top, baseTip, headTip);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    throw new CompareError(`no merge base between ${baseRef} and ${headRef}${shallowNote(top)}. ${FETCH_HINT}`, 2, e.stderr);
  }
}

/** Validates the options and resolves both sides; nothing is checked out yet. */
function resolveSides(o: CompareOptions): Sides {
  if (!isExactSemver(o.isobarVersion)) {
    throw new CompareError(`--isobar-version must be an exact version such as ${DEFAULT_ISOBAR_VERSION}, got "${o.isobarVersion}"`, 2);
  }
  const top = repoRoot(o.dir);
  const scope = resolveScope(top, o.scope);
  const baseTip = commitOf(top, 'base', o.baseRef);
  const headCommit = o.headRef === 'HEAD' ? undefined : commitOf(top, 'head', o.headRef);
  const headTip = headCommit ?? headSha(top);
  const base = mergeBaseOf(top, baseTip, headTip, o.baseRef, o.headRef);
  return { top, scope, base, headCommit, headTip, dirty: headCommit === undefined && isDirty(top) };
}

/** Lines 1..N of a regular file; undefined when it is empty or not a regular file. */
function wholeFile(path: string): Range | undefined {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) return undefined;
  const text = readFileSync(path, 'utf8');
  const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  return lines > 0 ? { start: 1, end: lines } : undefined;
}

/**
 * Untracked files belong to a working-tree head: each is changed and not deleted (a file dropped from the index but
 * still on disk), and a source file is wholly added, so its findings are in the diff like any new file's.
 */
function addUntracked(top: string, changes: Required<Changes>): void {
  for (const path of listUntracked(top)) {
    changes.changed.add(path);
    changes.deleted.delete(path);
    const range = isAnalyzable(path) ? wholeFile(join(top, path)) : undefined;
    if (range) changes.hunks.set(path, [range]);
  }
}

/** The PR's changes, built in full and then scope-filtered once, so hunks, deletion points and deleted paths are too. */
function collectChanges(s: Sides): Changes {
  const u0 = diffHunks(s.top, s.base, s.headCommit);
  const all = { ...parseChanges(diffNameStatus(s.top, s.base, s.headCommit)), hunks: parseHunks(u0), deletions: parseDeletions(u0) };
  if (s.headCommit === undefined) addUntracked(s.top, all);
  return filterChanges(all, s.scope);
}

/**
 * Whether isobar can see anything the PR did: a changed, deleted or renamed-from path that isobar parses or reads as
 * config. Deleted and renamed-from paths count so a config deleted or renamed away still raises the banner (A25).
 */
function worthAnalyzing(changes: Changes): boolean {
  const touched = [...changes.changed, ...(changes.deleted ?? []), ...changes.renames.values()];
  return touched.some((p) => isAnalyzable(p) || isConfigFile(p));
}

/** Checks `sha` out at `dir`, recording `dir` first so a half-made worktree is cleaned up too. */
function checkout(top: string, dir: string, sha: string, worktrees: string[]): string {
  worktrees.push(dir);
  worktreeAdd(top, dir, sha);
  return dir;
}

/** Runs isobar on one side and indexes its graph. */
function graphOf(side: 'base' | 'head', dir: string, outFile: string, s: Sides, o: CompareOptions): GraphIndex {
  o.log(`isobar-pr: isobar@${o.isobarVersion} on ${side}…`);
  runIsobar({ dir, version: o.isobarVersion, outFile, scope: s.scope });
  return buildIndex(loadGraph(outFile, side));
}

/** Both graphs from one temp folder; the worktrees are removed and the folder deleted (unless kept) whatever happens. */
function analyze(s: Sides, changes: Changes, o: CompareOptions): Report {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'isobar-pr-')));
  const worktrees: string[] = [];
  try {
    const baseDir = checkout(s.top, join(tmp, 'base'), s.base, worktrees);
    const headDir = s.headCommit === undefined ? s.top : checkout(s.top, join(tmp, 'head'), s.headCommit, worktrees);
    const baseIndex = graphOf('base', baseDir, join(tmp, 'base-out', 'graph.json'), s, o);
    const headIndex = graphOf('head', headDir, join(tmp, 'head-out', 'graph.json'), s, o);
    if (baseIndex.toolVersion !== headIndex.toolVersion) throw new VersionMismatchError(baseIndex.toolVersion, headIndex.toolVersion);
    const opts = { failOn: o.failOn, reportUncalledRoutes: o.reportUncalledRoutes, baseRef: o.baseRef, baseSha: s.base, headSha: headLabel(s) };
    return diffGraphs(baseIndex, headIndex, changes, opts);
  } finally {
    for (const dir of worktrees) worktreeRemove(s.top, dir);
    if (o.keepTemp) o.log(`isobar-pr: kept ${tmp}`);
    else rmSync(tmp, { recursive: true, force: true });
  }
}

/** Runs the comparison (see the module comment); `durationMs` is wall time for the comment footer. */
export function compare(o: CompareOptions): { report: Report; durationMs: number } {
  const started = Date.now();
  const s = resolveSides(o);
  const changes = collectChanges(s);
  const n = changes.changed.size;
  o.log(`isobar-pr: base ${short(s.base)} (merge-base of ${o.baseRef}) vs head ${headLabel(s, short)}, ${n} changed file${n === 1 ? '' : 's'}`);
  if (!worthAnalyzing(changes)) {
    o.log('isobar-pr: no analyzable source or isobar config among the changed files; skipping isobar');
    const meta = { baseRef: o.baseRef, baseSha: s.base, headSha: headLabel(s), changedFiles: n };
    return { report: emptyReport(meta), durationMs: Date.now() - started };
  }
  return { report: analyze(s, changes, o), durationMs: Date.now() - started };
}
