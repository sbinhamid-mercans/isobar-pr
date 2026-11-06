/**
 * Runs isobar on one checkout for `compare`: `npx -y isobar@<version> <dir> --format json -q -o <outFile> [--scope S]`.
 * What callers rely on (isobar 0.7.1, checked against its bundle and real runs):
 * - isobar never runs project code: it reads files and git history (its `--project-typescript` is never passed).
 * - The run gets `gitEnv()` (no inherited `GIT_DIR` and friends, no credential prompt), plus `CI=1` and `NO_COLOR=1`.
 * - `files` keys in graph.json are relative to `dir`, with or without `--scope` (`--scope src/services` keeps
 *   `src/services/users.ts`), so they match git's repo-relative paths when `dir` is the repository root.
 * - isobar writes `AGENTS.md` and `BRIEF.md` next to `outFile`, nothing inside `dir`. Two runs on the same tree differ
 *   only in `generated_at`; `name` is `<basename of dir> — isobar`.
 * - A folder with no project file at its root (package.json, pyproject.toml, go.mod, .git, …) but two or more subfolders
 *   that have one is a workspace. A top-level code file (e.g. `index.ts`) also makes the root one project, and
 *   dot-folders and `node_modules`, `dist`, `vendor`-style folders never count as projects. In a workspace isobar exits 0
 *   and makes `outFile` a folder holding one graph.json per project, even with `--scope`. v1 refuses that (exit 2). A git
 *   repository root or worktree has `.git`, so `compare` never meets it.
 * - Linux and macOS only: on Windows `npx` is `npx.cmd`, which spawnSync cannot start without a shell.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { gitEnv } from './git.js';
import { exitText } from './spawn.js';

export const DEFAULT_ISOBAR_VERSION = '0.7.1';

/**
 * The extensions isobar 0.7.1 has a parser for: JavaScript/TypeScript (with Vue, Svelte, Astro), CSS, Go, HTML, Java,
 * Python, R and Ruby. isobar also lists about 50 more (.rs, .kt, .sh, .sql, …) in graph.json as line counts only: no
 * functions, imports or security scan, so no change to one of those can produce a finding.
 */
export const ANALYZABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'astro',
  'css', 'scss', 'sass', 'less', 'go', 'html', 'htm', 'java', 'py', 'r', 'rmd', 'qmd', 'rb', 'rake', 'ru',
]);

/**
 * True when isobar parses `path`, judged by its extension the way isobar reads it (`path.posix.extname`, any case): a
 * dotfile such as `.gitignore`, a trailing dot or a dot in a folder name is no extension. Extension only: files isobar
 * skips by location or pattern (node_modules, dist, dot-folders, `*.d.ts`, `*.min.js`) still count, so a true can cost
 * a needless run but a false never hides a finding.
 */
export function isAnalyzable(path: string): boolean {
  return ANALYZABLE_EXTENSIONS.has(posix.extname(path).slice(1).toLowerCase());
}

/** major.minor.patch with an optional pre-release, no leading zeros, no `v`. */
const EXACT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/**
 * An exact version such as `0.7.1` or `1.0.0-beta.1`: never a range or tag (`^0.7.1`, `latest`), whose meaning can move
 * between the base and head runs. Strict by choice: no `v` prefix and no build metadata (`0.7.1+build`), which semver
 * ignores when matching, so it would name a version it does not select.
 */
export function isExactSemver(v: string): boolean {
  return EXACT_SEMVER.test(v);
}

/** isobar could not run, failed, or ran in a mode v1 refuses; `handleError` prints the message and `stderr`, then exits `code`. */
export class IsobarError extends Error {
  override name = 'IsobarError';
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly code: 2 | 3 = 3,
  ) {
    super(message);
  }
}

export interface IsobarRunOptions {
  /** The checkout to analyze. Passed absolute, so a folder named like an option is never read as one. */
  dir: string;
  /** An exact version (`isExactSemver`); anything else is refused before npx runs. */
  version: string;
  /** Where graph.json goes; its folder is created. Use a fresh path: isobar also writes AGENTS.md and BRIEF.md there. */
  outFile: string;
  /** Only analyze this subfolder of `dir`; `files` keys stay relative to `dir`. */
  scope?: string;
  /** Stop isobar (SIGTERM to npx) after this long; default 120 s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** npx's argv: `-y` installs without asking, `--format json` skips the HTML map, `-q` keeps isobar quiet. */
function isobarArgs(o: IsobarRunOptions): string[] {
  const args = ['-y', `isobar@${o.version}`, resolve(o.dir), '--format', 'json', '-q', '-o', resolve(o.outFile)];
  return o.scope ? [...args, '--scope', o.scope] : args;
}

function workspaceMessage(dir: string): string {
  return (
    `isobar wrote no graph.json for ${dir}: it read the folder as a workspace of several projects (no project file such ` +
    'as package.json or .git at its root, two or more subfolders with one), which v1 does not support. Run isobar-pr on ' +
    'one project, or on a git repository root, which isobar maps as one project (--scope then narrows it to one folder).'
  );
}

/** Why the spawn itself failed: the timeout, or the error that kept npx from starting or finishing. */
function spawnWhy(error: Error, timeoutMs: number): string {
  return (error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? `timed out after ${timeoutMs / 1000} s` : error.message;
}

/** For an isobar that exited 0: the workspace refusal, a missing graph.json, or undefined when outFile is a file. */
function outputFailure(o: IsobarRunOptions, stderr: string): IsobarError | undefined {
  const out = statSync(o.outFile, { throwIfNoEntry: false });
  if (out?.isDirectory()) return new IsobarError(workspaceMessage(o.dir), stderr, 2);
  if (!out?.isFile()) return new IsobarError(`isobar@${o.version} exited 0 but wrote no graph.json at ${o.outFile}`, stderr);
  return undefined;
}

/** Why the run failed, or undefined when isobar exited 0 and wrote `outFile` as a file. */
function failure(o: IsobarRunOptions, r: SpawnSyncReturns<string>, timeoutMs: number): IsobarError | undefined {
  const stderr = r.stderr ?? ''; // undefined when npx could not start
  if (r.error) return new IsobarError(`isobar@${o.version} did not finish on ${o.dir}: ${spawnWhy(r.error, timeoutMs)}`, stderr);
  if (r.status !== 0) return new IsobarError(`isobar@${o.version} ${exitText(r)} on ${o.dir}`, stderr);
  return outputFailure(o, stderr);
}

/** Runs isobar on `o.dir` and leaves graph.json at `o.outFile`, or throws IsobarError (see the module comment). */
export function runIsobar(o: IsobarRunOptions): void {
  if (!isExactSemver(o.version)) {
    throw new IsobarError(`the isobar version must be exact, such as ${DEFAULT_ISOBAR_VERSION}; got ${JSON.stringify(o.version)}`, '', 2);
  }
  mkdirSync(dirname(o.outFile), { recursive: true });
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const r = spawnSync('npx', isobarArgs(o), {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    env: { ...gitEnv(), CI: '1', NO_COLOR: '1' },
  });
  const error = failure(o, r, timeoutMs);
  if (error) throw error;
}
