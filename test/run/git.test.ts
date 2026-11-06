import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { handleError } from '../../src/cli.js';
import { parseChanges, parseHunks } from '../../src/diff/changes.js';
import { GitError, diffHunks, diffNameStatus, git, gitEnv, headSha, isDirty, isShallow, listUntracked, mergeBase, resolveRef, topLevel, worktreeAdd, worktreeRemove } from '../../src/run/git.js';

// A pass-through spy, so one test can make spawnSync report ENOBUFS without producing 256 MiB of output.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const sh = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

let repo: string;
let baseTip: string;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeAll(() => {
  repo = tempDir('isobar-pr-git-');
  sh(repo, ['init', '-q', '-b', 'main']);
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(repo, 'src', 'old.ts'), 'export const old = 1;\nexport const two = 2;\nexport const three = 3;\n');
  sh(repo, ['add', '.']);
  sh(repo, ['commit', '-q', '-m', 'one']);
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 2;\n');
  sh(repo, ['commit', '-q', '-am', 'two']);
  baseTip = sh(repo, ['rev-parse', 'HEAD']);
  sh(repo, ['checkout', '-q', '-b', 'feature', 'HEAD~1']);
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
  renameSync(join(repo, 'src', 'old.ts'), join(repo, 'src', 'new.ts'));
  writeFileSync(join(repo, 'src', 'c.ts'), 'export const c = 3;\n');
  sh(repo, ['add', '-A']);
  sh(repo, ['commit', '-q', '-m', 'feature']);
});

/** Every test starts from a clean `feature` checkout, so none depends on another's leftovers or on run order. */
afterEach(() => {
  sh(repo, ['checkout', '-q', '-f', 'feature']);
  sh(repo, ['clean', '-q', '-f', '-d', '-x']);
});

/** Commits `edit` on a new branch off `from` and returns the new tip (afterEach puts the repo back on `feature`). */
function commitOnBranch(name: string, from: string, edit: () => void): string {
  sh(repo, ['checkout', '-q', '-b', name, from]);
  edit();
  sh(repo, ['add', '-A']);
  sh(repo, ['commit', '-q', '-m', name]);
  return sh(repo, ['rev-parse', 'HEAD']);
}

/** A fresh clone of the shared repo (HEAD on `feature`, `origin/main` = baseTip) for tests that change config or refs. */
function cloneRepo(...extra: string[]): string {
  const dir = tempDir('isobar-pr-clone-');
  sh(dir, ['clone', '-q', ...extra, `file://${repo}`, dir]); // file:// so --depth applies to a local clone
  return dir;
}

/** The worktree paths `git worktree list --porcelain` reports, main worktree first. */
function worktrees(cwd: string): string[] {
  return sh(cwd, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length));
}

/** Runs `fn` with `vars` set in process.env, restoring each one afterwards. */
function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const saved = Object.keys(vars).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('git layer', () => {
  test('resolveRef tries origin/<ref>, then <ref>, then raw sha; mergeBase finds the fork point', () => {
    expect(resolveRef(repo, 'main')).toBe(baseTip);
    expect(resolveRef(repo, baseTip)).toBe(baseTip);
    expect(resolveRef(repo, 'nope')).toBeUndefined();
    const mb = mergeBase(repo, baseTip, headSha(repo));
    expect(mb).toBe(sh(repo, ['rev-parse', 'HEAD~1']));
  });

  test('name-status with renames and -U0 hunks parse into Changes', () => {
    const mb = mergeBase(repo, baseTip, headSha(repo));
    const changes = parseChanges(diffNameStatus(repo, mb));
    expect([...changes.changed].sort()).toEqual(['src/a.ts', 'src/c.ts', 'src/new.ts']);
    expect([...changes.renames]).toEqual([['src/new.ts', 'src/old.ts']]);
    const hunks = parseHunks(diffHunks(repo, mb));
    expect(hunks.get('src/a.ts')).toEqual([{ start: 2, end: 2 }]);
    expect(hunks.get('src/c.ts')).toEqual([{ start: 1, end: 1 }]);
    expect(hunks.has('src/new.ts')).toBe(false);
  });

  test('worktreeAdd checks out a detached sha and worktreeRemove cleans up', () => {
    const dir = join(tempDir('isobar-pr-wt-'), 'base');
    worktreeAdd(repo, dir, baseTip);
    expect(existsSync(join(dir, 'src', 'old.ts'))).toBe(true);
    expect(sh(dir, ['rev-parse', 'HEAD'])).toBe(baseTip);
    worktreeRemove(repo, dir);
    expect(existsSync(dir)).toBe(false);
    expect(sh(repo, ['worktree', 'list'])).not.toContain('base');
  });

  test('isShallow, isDirty and listUntracked', () => {
    expect(isShallow(repo)).toBe(false);
    expect(isDirty(repo)).toBe(false);
    writeFileSync(join(repo, 'src', 'scratch.ts'), 'export const s = 1;\n');
    expect(listUntracked(repo)).toEqual(['src/scratch.ts']);
    expect(isDirty(repo)).toBe(true);
  });

  test('git() throws GitError with stderr on failure', () => {
    expect(() => git(repo, ['rev-parse', '--verify', 'definitely-not-a-ref'])).toThrow(GitError);
  });
});

describe('git layer: refs', () => {
  test('resolveRef prefers origin/<ref> over a diverged local branch, and a branch over a same-named tag', () => {
    const dir = cloneRepo();
    const mb = mergeBase(dir, baseTip, headSha(dir));
    sh(dir, ['branch', 'main', mb]); // local main diverges from origin/main
    expect(resolveRef(dir, 'main')).toBe(baseTip);
    sh(dir, ['tag', 'release', baseTip]);
    sh(dir, ['branch', 'release', mb]); // raw "release" would resolve the tag (refs/tags wins in git's DWIM order)
    expect(resolveRef(dir, 'release')).toBe(mb);
  });

  test('resolveRef reads HEAD-relative refs as git does, never through the origin/HEAD symref', () => {
    const dir = cloneRepo();
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 3;\n');
    sh(dir, ['commit', '-q', '-am', 'local']); // local HEAD moves one commit past origin/HEAD
    expect(sh(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD'])).toBe('refs/remotes/origin/feature');
    for (const ref of ['HEAD', 'HEAD~1', 'HEAD^', 'HEAD~1^{commit}']) expect(resolveRef(dir, ref)).toBe(sh(dir, ['rev-parse', `${ref}^{commit}`]));
    expect(resolveRef(dir, 'HEAD~1')).not.toBe(sh(dir, ['rev-parse', 'origin/HEAD~1']));
    expect(resolveRef(dir, 'ORIG_HEAD')).toBeUndefined(); // no such pseudo-ref yet: not origin's ORIG_HEAD either
    // Lower case: on a case-insensitive file system git reads `head~1` as HEAD~1; elsewhere it resolves to nothing.
    // Either way it is never origin's commit (refs/remotes/origin/head would match origin/HEAD on macOS).
    const caseInsensitive = existsSync(join(dir, '.git', 'head'));
    expect(resolveRef(dir, 'head~1')).toBe(caseInsensitive ? sh(dir, ['rev-parse', 'HEAD~1']) : undefined);
  });

  test('a pseudo-ref-like branch that exists only on origin still resolves (raw name first, then origin/)', () => {
    sh(repo, ['branch', 'RELEASE_HEAD', baseTip]);
    try {
      const dir = cloneRepo();
      expect(sh(dir, ['branch', '--list', 'RELEASE_HEAD'])).toBe(''); // no local branch: only origin/RELEASE_HEAD
      expect(resolveRef(dir, 'RELEASE_HEAD')).toBe(baseTip);
    } finally {
      sh(repo, ['branch', '-D', 'RELEASE_HEAD']);
    }
  });

  test('resolveRef peels annotated tags to commits, takes short shas and rejects option-like input', () => {
    sh(repo, ['tag', '-a', 'v1', '-m', 'v1', baseTip]);
    try {
      expect(resolveRef(repo, 'v1')).toBe(baseTip);
      expect(resolveRef(repo, baseTip.slice(0, 12))).toBe(baseTip);
      expect(resolveRef(repo, '--all')).toBeUndefined();
      expect(resolveRef(repo, '--path-format=absolute')).toBeUndefined(); // rev-parse itself would exit 128
      expect(resolveRef(repo, '')).toBeUndefined();
    } finally {
      sh(repo, ['tag', '-d', 'v1']);
    }
  });

  test('resolveRef outside a repository throws GitError instead of reporting the ref as missing', () => {
    const outside = tempDir('isobar-pr-norepo-');
    expect(() => resolveRef(outside, 'main')).toThrow(GitError);
  });

  test('option-like revisions are bad revisions, never options (--end-of-options)', () => {
    const out = join(tempDir('isobar-pr-opt-'), 'written.txt');
    const head = headSha(repo);
    const wt = join(tempDir('isobar-pr-wt-'), 'opt');
    expect(() => diffNameStatus(repo, `--output=${out}`)).toThrow(GitError); // as an option: writes the diff to out
    expect(() => diffHunks(repo, `--output=${out}`, head)).toThrow(GitError);
    expect(() => mergeBase(repo, `--output=${out}`, head)).toThrow(GitError);
    expect(() => mergeBase(repo, '--independent', head)).toThrow(GitError); // as an option: prints head's sha
    expect(() => worktreeAdd(repo, wt, `--output=${out}`)).toThrow(GitError);
    expect(() => worktreeAdd(repo, wt, '--lock')).toThrow(GitError); // as an option: checks HEAD out, locked
    expect(existsSync(out)).toBe(false);
    expect(existsSync(wt)).toBe(false);
  });

  test('headSha reads a detached HEAD', () => {
    sh(repo, ['checkout', '-q', '--detach', baseTip]);
    expect(headSha(repo)).toBe(baseTip);
  });
});

describe('git layer: diffs', () => {
  test('a deleted file is a D row: in deleted, never in changed (A25)', () => {
    const from = headSha(repo);
    const tip = commitOnBranch('drop', 'feature', () => rmSync(join(repo, 'src', 'c.ts')));
    const text = diffNameStatus(repo, from, tip);
    expect(text).toBe('D\tsrc/c.ts\n');
    const changes = parseChanges(text);
    expect([...changes.deleted]).toEqual(['src/c.ts']);
    expect(changes.changed.size).toBe(0);
  });

  test('non-ASCII paths come back raw (core.quotePath=false); paths git still quotes are unquoted by the parsers', () => {
    const from = headSha(repo);
    const tip = commitOnBranch('unicode', 'feature', () => {
      writeFileSync(join(repo, 'src', 'café.ts'), 'export const cafe = 1;\n');
      writeFileSync(join(repo, 'src', 'we"ird.ts'), 'export const w = 1;\n');
    });
    const text = diffNameStatus(repo, from, tip);
    expect(text).toContain('A\tsrc/café.ts\n');
    expect([...parseChanges(text).changed].sort()).toEqual(['src/café.ts', 'src/we"ird.ts']);
    const u0 = diffHunks(repo, from, tip);
    expect(u0).toContain('+++ b/src/café.ts\n');
    expect([...parseHunks(u0).keys()].sort()).toEqual(['src/café.ts', 'src/we"ird.ts']);
  });

  test('user diff config cannot change what the parsers see (pinned prefixes, context, colour, drivers, root-relative paths)', () => {
    const dir = cloneRepo();
    mkdirSync(join(dir, 'b')); // a top-level b/ makes a dropped or doubled b/ prefix visible
    writeFileSync(join(dir, 'b', 'x.ts'), 'one\ntwo\nthree\n');
    sh(dir, ['add', '-A']);
    sh(dir, ['commit', '-q', '-m', 'b']);
    const head = headSha(dir);
    const mb = mergeBase(dir, baseTip, head); // mb..head holds feature's pure rename src/old.ts → src/new.ts
    writeFileSync(join(dir, 'b', 'x.ts'), 'ONE\ntwo\nTHREE\n');
    writeFileSync(join(dir, '.git', 'info', 'attributes'), '*.ts diff=shift\n');
    const sub = join(dir, 'src'); // run from a subdirectory so diff.relative would show
    const expected = new Map([['b/x.ts', [{ start: 1, end: 1 }, { start: 3, end: 3 }]]]);
    const configs: Array<[string, string]> = [
      ['diff.noprefix', 'true'],
      ['diff.srcPrefix', 'x/'], // git ≥ 2.45; ignored (harmless) before
      ['diff.dstPrefix', 'y/'],
      ['diff.mnemonicPrefix', 'true'],
      ['diff.interHunkContext', '5'], // would fuse the two -U0 hunks across the unchanged line 2
      ['color.diff', 'always'],
      ['diff.external', 'true'], // `true` prints nothing: every hunk would vanish
      ['diff.shift.textconv', 'sed 1d'], // shifts every line number by one
      ['diff.relative', 'true'], // would hide b/x.ts from a run in src/
      ['diff.renames', 'false'], // without -M a rename is a D row plus an A row with a whole-file hunk
    ];
    for (const [key, value] of configs) {
      sh(dir, ['config', key, value]);
      try {
        expect(parseHunks(diffHunks(sub, head)), `${key}=${value}`).toEqual(expected);
        expect(diffNameStatus(sub, head), `${key}=${value}`).toBe('M\tb/x.ts\n');
        expect([...parseChanges(diffNameStatus(sub, mb, head)).renames], `${key}=${value}`).toEqual([['src/new.ts', 'src/old.ts']]);
        expect(parseHunks(diffHunks(sub, mb, head)).has('src/new.ts'), `${key}=${value}`).toBe(false);
      } finally {
        sh(dir, ['config', '--unset', key]);
      }
    }
  });

  test('a tiny diff.renameLimit cannot turn an edited rename into a delete plus a whole-file add', () => {
    const dir = cloneRepo();
    writeFileSync(join(dir, 'src', 'r.ts'), 'l1\nl2\nl3\nl4\n');
    sh(dir, ['add', '-A']);
    sh(dir, ['commit', '-q', '-m', 'r']);
    const from = headSha(dir);
    renameSync(join(dir, 'src', 'r.ts'), join(dir, 'src', 'moved.ts'));
    writeFileSync(join(dir, 'src', 'moved.ts'), 'l1\nl2\nl3\nL4\n'); // 75% similar: an inexact rename
    writeFileSync(join(dir, 'src', 'extra.ts'), 'e\n'); // a second candidate, over a limit of 1
    sh(dir, ['add', '-A']);
    sh(dir, ['commit', '-q', '-m', 'move']);
    const to = headSha(dir);
    sh(dir, ['config', 'diff.renameLimit', '1']);
    expect([...parseChanges(diffNameStatus(dir, from, to)).renames]).toEqual([['src/moved.ts', 'src/r.ts']]);
    expect(parseHunks(diffHunks(dir, from, to)).get('src/moved.ts')).toEqual([{ start: 4, end: 4 }]);
  });

  test('a work-tree file named like the base ref is not ambiguous (the -- separator)', () => {
    writeFileSync(join(repo, 'main'), 'x\n'); // without --, git exits 128: "both revision and filename"
    expect(parseChanges(diffNameStatus(repo, 'main')).changed.has('src/a.ts')).toBe(true);
    expect(parseHunks(diffHunks(repo, 'main')).has('src/a.ts')).toBe(true);
  });

  test('without a head both diffs compare the working tree (untracked files excluded)', () => {
    const head = headSha(repo);
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
    writeFileSync(join(repo, 'src', 'untracked.ts'), 'export const u = 1;\n');
    expect(diffNameStatus(repo, head)).toBe('M\tsrc/a.ts\n');
    expect(diffNameStatus(repo, head, head)).toBe('');
    expect(parseHunks(diffHunks(repo, head))).toEqual(new Map([['src/a.ts', [{ start: 3, end: 3 }]]]));
    expect(diffHunks(repo, head, head)).toBe('');
  });
});

describe('git layer: working tree state', () => {
  test('topLevel names the working tree root from any folder in it (a linked worktree\'s own root), GitError outside one', () => {
    expect(realpathSync(topLevel(repo))).toBe(realpathSync(repo));
    expect(realpathSync(topLevel(join(repo, 'src')))).toBe(realpathSync(repo));
    const wt = join(tempDir('isobar-pr-wt-'), 'linked');
    worktreeAdd(repo, wt, baseTip);
    try {
      expect(realpathSync(topLevel(join(wt, 'src')))).toBe(realpathSync(wt));
    } finally {
      worktreeRemove(repo, wt);
    }
    expect(() => topLevel(tempDir('isobar-pr-norepo-'))).toThrow(GitError);
    expect(() => topLevel(join(repo, '.git'))).toThrow(GitError);
  });

  test('isShallow is true for a --depth 1 clone', () => {
    expect(isShallow(cloneRepo('--depth', '1'))).toBe(true);
  });

  test('listUntracked skips ignored files, lists raw repo-root paths from any directory; ignored-only is not dirty', () => {
    const exclude = join(repo, '.git', 'info', 'exclude');
    writeFileSync(exclude, '*.log\n');
    try {
      writeFileSync(join(repo, 'debug.log'), 'x\n');
      expect(listUntracked(repo)).toEqual([]);
      expect(isDirty(repo)).toBe(false);
      writeFileSync(join(repo, '.gitignore'), 'tmp/\n');
      mkdirSync(join(repo, 'tmp'));
      writeFileSync(join(repo, 'tmp', 'x.ts'), 'x\n');
      writeFileSync(join(repo, 'src', 'café.ts'), 'x\n');
      writeFileSync(join(repo, 'src', 'we"ird.ts'), 'x\n');
      expect(listUntracked(repo).sort()).toEqual(['.gitignore', 'src/café.ts', 'src/we"ird.ts']);
      expect(listUntracked(join(repo, 'src')).sort()).toEqual(['src/café.ts', 'src/we"ird.ts']);
      expect(isDirty(repo)).toBe(true);
    } finally {
      writeFileSync(exclude, '');
    }
  });

  test('listUntracked leaves out an untracked nested repository, which git lists as one dir/ entry (A35)', () => {
    const dir = cloneRepo();
    mkdirSync(join(dir, 'vendor', 'sub'), { recursive: true });
    sh(join(dir, 'vendor', 'sub'), ['init', '-q']);
    writeFileSync(join(dir, 'vendor', 'sub', 'x.ts'), 'x\n');
    writeFileSync(join(dir, 'src', 'u.ts'), 'u\n');
    expect(git(dir, ['ls-files', '--others', '--exclude-standard']).split('\n').sort()).toEqual(['', 'src/u.ts', 'vendor/sub/']); // control
    expect(listUntracked(dir)).toEqual(['src/u.ts']);
  });

  test('worktreeRemove removes a dirty worktree, is idempotent, and prunes stale entries', () => {
    const parent = tempDir('isobar-pr-wt-');
    const dirty = join(parent, 'dirty');
    const stale = join(parent, 'stale');
    worktreeAdd(repo, dirty, baseTip);
    worktreeAdd(repo, stale, baseTip);
    expect(headSha(dirty)).toBe(baseTip);
    writeFileSync(join(dirty, 'src', 'a.ts'), 'edited\n');
    writeFileSync(join(dirty, 'untracked.ts'), 'x\n');
    rmSync(stale, { recursive: true, force: true }); // deleted behind git's back: a prunable entry
    expect(worktrees(repo)).toHaveLength(3);
    worktreeRemove(repo, dirty);
    expect(existsSync(dirty)).toBe(false);
    expect(worktrees(repo)).toHaveLength(1);
    expect(() => worktreeRemove(repo, dirty)).not.toThrow();
    expect(worktrees(repo)).toHaveLength(1);
  });
});

describe('git layer: hooks', () => {
  test('worktreeAdd never runs a husky-style post-checkout hook; plain git worktree add does (control)', () => {
    const dir = cloneRepo();
    const hooks = join(dir, '.husky', '_');
    mkdirSync(hooks, { recursive: true });
    const marker = join(tempDir('isobar-pr-hookmark-'), 'ran');
    writeFileSync(join(hooks, 'post-checkout'), `#!/bin/sh\necho "$PWD" >> '${marker}'\n`, { mode: 0o755 });
    sh(dir, ['config', 'core.hooksPath', hooks]);
    const parent = tempDir('isobar-pr-wt-');
    worktreeAdd(dir, join(parent, 'quiet'), baseTip);
    expect(existsSync(join(parent, 'quiet', 'src', 'old.ts'))).toBe(true);
    expect(existsSync(marker)).toBe(false);
    sh(dir, ['worktree', 'add', '-q', '--detach', join(parent, 'control'), baseTip]);
    expect(existsSync(marker)).toBe(true);
  });
});

describe('git layer: errors and process', () => {
  test('GitError carries code 3 and git\'s stderr; handleError prints both without a stack; output is verbatim', () => {
    const args = ['rev-parse', '--verify', 'definitely-not-a-ref'];
    const direct = spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stderr;
    let caught: unknown;
    try {
      git(repo, args);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitError);
    const e = caught as GitError;
    expect(e.code).toBe(3);
    expect(e.status).toBe(128);
    expect(e.name).toBe('GitError');
    expect(e.message).toBe('git rev-parse --verify definitely-not-a-ref exited 128');
    expect(e.stderr).not.toBe('');
    expect(e.stderr).toBe(direct);
    const err: string[] = [];
    expect(handleError(e, { out: () => {}, err: (s) => { err.push(s); }, env: {} })).toBe(3);
    expect(err.join('')).toBe(`isobar-pr: ${e.message}\n${direct.endsWith('\n') ? direct : `${direct}\n`}`);
    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }));
    expect(git(repo, ['rev-parse', 'HEAD']).endsWith('\n')).toBe(true);
  });

  test('a git that cannot be spawned is a GitError (code 3) saying git could not run', () => {
    const empty = tempDir('isobar-pr-nogit-');
    let caught: unknown;
    withEnv({ PATH: empty }, () => {
      try {
        headSha(repo);
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBeInstanceOf(GitError);
    expect((caught as GitError).message).toMatch(/^git could not run/);
    expect((caught as GitError).message).toContain('ENOENT');
    expect((caught as GitError).code).toBe(3);
    expect((caught as GitError).status).toBeUndefined();
  });

  test('output over the 256 MiB buffer is its own GitError, not "could not run"', () => {
    const enobufs = Object.assign(new Error('spawnSync git ENOBUFS'), { code: 'ENOBUFS' });
    const overflow = { pid: 1, output: [], stdout: '', stderr: '', status: null, signal: 'SIGTERM', error: enobufs };
    gitEnv(); // fill gitEnv's once-per-process git query first, so the mock meets the diff's own spawn
    vi.mocked(spawnSync).mockImplementationOnce((() => overflow) as unknown as typeof spawnSync);
    let caught: unknown;
    try {
      diffHunks(repo, baseTip);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitError);
    expect((caught as GitError).message).toMatch(/^git output exceeded 256 MiB \(git .*diff -U0 .* in /);
    expect((caught as GitError).code).toBe(3);
  });

  test('gitEnv also strips names only the installed git lists, and keeps the built-in list when git cannot say', async () => {
    const bin = tempDir('isobar-pr-newgit-');
    writeFileSync(join(bin, 'git'), '#!/bin/sh\ncase "$*" in *--local-env-vars*) printf "GIT_DIR\\nGIT_FUTURE_VAR\\n" ;; esac\n', { mode: 0o755 });
    const vars = { GIT_FUTURE_VAR: 'x', GIT_COMMON_DIR: 'x' };
    vi.resetModules(); // a fresh module instance: its once-per-process query has not run yet
    const newer = await import('../../src/run/git.js');
    withEnv({ PATH: bin, ...vars }, () => {
      expect(newer.gitEnv()['GIT_FUTURE_VAR']).toBeUndefined();
      expect(newer.gitEnv()['GIT_COMMON_DIR']).toBeUndefined();
    });
    vi.resetModules();
    const noGit = await import('../../src/run/git.js');
    withEnv({ PATH: tempDir('isobar-pr-nogit-'), ...vars }, () => {
      expect(noGit.gitEnv()['GIT_COMMON_DIR']).toBeUndefined();
      expect(noGit.gitEnv()['GIT_FUTURE_VAR']).toBe('x');
    });
  });

  test('every call runs with quotePath off, no terminal prompt, no optional locks and no inherited repository-local variable', () => {
    const local = sh(repo, ['rev-parse', '--local-env-vars']).split('\n'); // the installed git's own list
    const bin = tempDir('isobar-pr-fakegit-');
    const seen = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS'];
    const shim = `#!/bin/sh\necho "$GIT_TERMINAL_PROMPT $GIT_OPTIONAL_LOCKS ${seen.map((k) => `\${${k}-unset}`).join(' ')} $*"\n`;
    writeFileSync(join(bin, 'git'), shim, { mode: 0o755 });
    withEnv({ PATH: bin, ...Object.fromEntries(local.map((k) => [k, '/nowhere'])) }, () => {
      const clean = `0 0 ${seen.map(() => 'unset').join(' ')} -c core.quotePath=false`;
      expect(git(repo, ['status'])).toBe(`${clean} status\n`);
      expect(resolveRef(repo, 'main')).toBe(`${clean} rev-parse --verify --quiet refs/remotes/origin/main^{commit}`);
      const env = gitEnv();
      expect(local.filter((k) => env[k] !== undefined)).toEqual([]);
      expect(env['PATH']).toBe(bin);
      expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
    });
  });
});
