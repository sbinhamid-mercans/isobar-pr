/**
 * The git layer `compare` runs on: every call spawns `git` synchronously in `cwd`. What callers rely on:
 * - Paths come back raw: every call runs with `-c core.quotePath=false`, so non-ASCII paths are not C-quoted. git still
 *   quotes a path holding `"`, `\` or a control character; `parseChanges` and `parseHunks` unquote those, and
 *   `listUntracked` reads `-z` output, which is never quoted.
 * - User config cannot change what the diff parsers read: both diffs pin `diff.relative=false` (paths stay
 *   repo-root-relative from any directory), `diff.renameLimit=10000` and `--no-color`; `diffHunks` also pins the
 *   `a/`/`b/` prefixes, `--inter-hunk-context=0`, `--no-ext-diff` and `--no-textconv`.
 * - Both diffs detect renames with `-M` at git's default 50% similarity, so rename rows and hunks name the same paths.
 *   Beyond 10,000 rename candidates git skips inexact detection: an edited rename then shows as A plus D (whole-file hunk).
 * - Revisions are never read as options or paths: `--end-of-options` precedes them and `--` ends them, so `--output=x`
 *   is a bad revision and a work-tree file named like a ref is not ambiguous.
 * - `head` undefined compares `base` with the working tree: tracked files only, untracked ones come from `listUntracked`.
 * - No call waits on a credential prompt (`GIT_TERMINAL_PROMPT=0`) or takes `index.lock` for a read (`GIT_OPTIONAL_LOCKS=0`),
 *   and none follows a repository-local variable (`GIT_DIR`, `GIT_COMMON_DIR`, …) inherited from a git hook (see `gitEnv`).
 * - `worktreeAdd` never runs the repository's hooks in the base checkout.
 * - A failure is a GitError with exit code 3 and git's stderr, which `handleError` prints once.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { exitText } from './spawn.js';

/** A git call that could not start or exited non-zero; `handleError` prints the message and `stderr`, then exits 3. */
export class GitError extends Error {
  override name = 'GitError';
  readonly code = 3;
  constructor(
    message: string,
    public readonly stderr: string,
    /** git's exit status; undefined when git did not exit on its own (could not start, killed, output over the buffer). */
    public readonly status?: number,
  ) {
    super(message);
  }
}

/** Every git call disables path quoting so non-ASCII paths come back raw (the parsers also unquote, as a fallback). */
const GIT_BASE_ARGS = ['-c', 'core.quotePath=false'];

/**
 * Config pinned on both diffs: paths stay relative to the repository root whatever the user's `diff.relative`, and a
 * low `diff.renameLimit` (or git's built-in 1,000) cannot turn a large PR's edited renames into whole-file hunks.
 */
const DIFF_CONFIG = ['-c', 'diff.relative=false', '-c', 'diff.renameLimit=10000'];

/** Room for a large PR's `-U0` diff; spawnSync's default is 1 MiB. */
const MAX_BUFFER = 256 * 1024 * 1024;

/**
 * Repository-local variables, as `git rev-parse --local-env-vars` lists them (git 2.50). git exports some to its hooks;
 * inherited, they would point every call at another repository, index, object store or config.
 */
const STRIPPED_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY',
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
];

/** The installed git's `--local-env-vars`, well-formed names only; empty when git cannot say. */
function liveLocalEnvVars(): string[] {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of STRIPPED_ENV) delete env[key];
  const r = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8', env });
  if (r.error || r.status !== 0) return [];
  return r.stdout.split('\n').filter((name) => /^GIT_[A-Z0-9_]+$/.test(name));
}

let strippedCache: readonly string[] | undefined;

/** STRIPPED_ENV plus whatever the installed git lists (a newer git may list more), read once per process. */
function strippedEnv(): readonly string[] {
  strippedCache ??= [...new Set([...STRIPPED_ENV, ...liveLocalEnvVars()])];
  return strippedCache;
}

/**
 * The environment for any process that runs git on the caller's behalf (this module; the isobar runner reuses it): the
 * current environment without the repository-local variables, with credential prompts and optional index locks off.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  for (const key of strippedEnv()) delete env[key];
  return env;
}

/** The GitError for a spawn that failed before git exited on its own: output over the buffer, or git not starting. */
function spawnError(error: NodeJS.ErrnoException, cwd: string, args: string[]): GitError {
  const call = `(git ${args.join(' ')} in ${cwd})`;
  if (error.code === 'ENOBUFS') return new GitError(`git output exceeded ${MAX_BUFFER / 1024 / 1024} MiB ${call}`, '');
  return new GitError(`git could not run ${call}: ${error.message}`, '');
}

/** Spawns git; throws GitError when it cannot start, overflows the buffer or exits with a status outside `ok`. */
function run(cwd: string, args: string[], ok: readonly number[] = [0]): SpawnSyncReturns<string> {
  const r = spawnSync('git', [...GIT_BASE_ARGS, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    env: gitEnv(),
  });
  if (r.error) throw spawnError(r.error, cwd, args);
  if (r.status === null || !ok.includes(r.status)) throw new GitError(`git ${args.join(' ')} ${exitText(r)}`, r.stderr, r.status ?? undefined);
  return r;
}

/** Runs git in `cwd` and returns its stdout verbatim (trailing newline kept). */
export function git(cwd: string, args: string[]): string {
  return run(cwd, args).stdout;
}

/**
 * `HEAD` or a `*_HEAD` pseudo-ref, alone or followed by a revision suffix (`~3`, `^`, `@{1}`, `:path`). Any case: on a
 * case-insensitive file system (macOS) `head~3` reads `.git/HEAD`, and `refs/remotes/origin/head` would read origin's.
 */
const PSEUDO_REF = /^(?:[a-z]+_)*head(?:$|[~^@:])/i;

/**
 * Resolves a branch name, tag or sha to a commit sha, trying `origin/<ref>`, then the local branch `<ref>`, then `<ref>`
 * as git reads it. Remote first: in CI the local branch can be stale or missing while origin's was just fetched. Local
 * branch before the raw name: git's own lookup would pick a same-named tag. Annotated tags peel to their commit.
 * Undefined when nothing resolves to a commit, and at once for option-like input (`-…` is never a valid branch name, and
 * some such as `--path-format=x` would make rev-parse fail outright); throws GitError for anything else, such as `cwd`
 * not being a repository. `HEAD` and other pseudo-refs (`ORIG_HEAD`, `FETCH_HEAD`…), suffixed or not (`HEAD~30`), are
 * read as git reads them first: `refs/remotes/origin/HEAD` is a symref to origin's default branch, so `HEAD~30` would
 * otherwise resolve to `origin/main~30`. Only when that fails do `origin/<ref>` and the local branch follow (a branch
 * named like `RELEASE_HEAD` that exists only on origin still resolves).
 */
export function resolveRef(cwd: string, ref: string): string | undefined {
  if (ref.startsWith('-')) return undefined;
  const remote = `refs/remotes/origin/${ref}`;
  const branch = `refs/heads/${ref}`;
  const candidates = PSEUDO_REF.test(ref) ? [ref, remote, branch] : [remote, branch, ref];
  for (const candidate of candidates) {
    const r = run(cwd, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], [0, 1]); // 1: no such commit
    if (r.status === 0) return r.stdout.trim();
  }
  return undefined;
}

/** The best common ancestor of `a` and `b`; option-like input is a bad revision, never an option. */
export function mergeBase(cwd: string, a: string, b: string): string {
  return git(cwd, ['merge-base', '--end-of-options', a, b]).trim();
}

/** The commit HEAD points at, detached or not. */
export function headSha(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD']).trim();
}

/**
 * The top-level folder of the working tree `cwd` belongs to (a linked worktree's own root), absolute, as git prints it.
 * Throws GitError outside a working tree (not a repository, a bare repository, inside `.git`).
 */
export function topLevel(cwd: string): string {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

export function isShallow(cwd: string): boolean {
  return git(cwd, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
}

/** True when the working tree has staged, unstaged or untracked (not ignored) changes. */
export function isDirty(cwd: string): boolean {
  return git(cwd, ['status', '--porcelain', '--untracked-files=normal']).trim() !== '';
}

/**
 * Untracked files under `cwd` that no ignore rule covers (.gitignore, .git/info/exclude, core.excludesFile), as raw
 * repo-root-relative paths (`--full-name`, `-z`). An untracked nested repository, which git lists as one `dir/` entry,
 * is left out: it is not a file of this repository.
 */
export function listUntracked(cwd: string): string[] {
  return git(cwd, ['ls-files', '-z', '--others', '--exclude-standard', '--full-name']).split('\0').filter((p) => p !== '' && !p.endsWith('/'));
}

/**
 * The revisions a diff compares: `base` against `head`, or against the working tree when `head` is undefined. Fenced by
 * `--end-of-options` (an option-like value is a bad revision) and `--` (a same-named file is not ambiguous).
 */
function revs(base: string, head: string | undefined): string[] {
  return ['--end-of-options', ...(head === undefined ? [base] : [base, head]), '--'];
}

/**
 * `git diff --name-status -M` rows for `parseChanges`: statuses A, C, D, M, R and T (A25: D rows feed `Changes.deleted`);
 * unmerged, unknown and broken pairs never appear. `head` undefined compares the working tree.
 */
export function diffNameStatus(cwd: string, base: string, head?: string): string {
  return git(cwd, [...DIFF_CONFIG, 'diff', '--name-status', '-M', '--no-color', '--diff-filter=ACDMRT', ...revs(base, head)]);
}

/**
 * `git diff -U0 -M` for `parseHunks` and `parseDeletions`. Prefixes are pinned so user config (diff.noprefix,
 * diff.srcPrefix, diff.mnemonicPrefix) cannot change what the hunk parser strips; hunks are never fused across unchanged
 * lines (diff.interHunkContext); no external diff or textconv driver can rewrite the text or shift line numbers.
 * `head` undefined compares the working tree.
 */
export function diffHunks(cwd: string, base: string, head?: string): string {
  const pinned = ['-U0', '-M', '--inter-hunk-context=0', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/'];
  return git(cwd, [...DIFF_CONFIG, 'diff', ...pinned, ...revs(base, head)]);
}

/**
 * Checks `sha` out, detached, into a new worktree at `dir` (which must not exist or be empty). Hooks are switched off
 * (`core.hooksPath=/dev/null`) so a repository's post-checkout hook (husky, lefthook) never runs in the base checkout.
 * An option-like `sha` is a bad reference, never an option.
 */
export function worktreeAdd(cwd: string, dir: string, sha: string): void {
  git(cwd, ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', '--end-of-options', dir, sha]);
}

/**
 * Removes a worktree made by `worktreeAdd`, local edits included (`--force`), then prunes every entry whose directory is
 * gone. Never throws, so it is safe in a `finally` and safe to repeat.
 */
export function worktreeRemove(cwd: string, dir: string): void {
  for (const args of [['worktree', 'remove', '--force', dir], ['worktree', 'prune']]) {
    try {
      git(cwd, args);
    } catch {
      // Already removed, or never added: nothing left to clean.
    }
  }
}
