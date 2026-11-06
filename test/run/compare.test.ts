import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Changes } from '../../src/diff/changes.js';
import { diffGraphs } from '../../src/diff/index.js';
import { VersionMismatchError } from '../../src/graph/load.js';
import { renderMarkdown } from '../../src/report/markdown.js';
import { handleError } from '../../src/cli.js';
import { CompareError, compare } from '../../src/run/compare.js';
import { GitError, headSha } from '../../src/run/git.js';
import { DEFAULT_ISOBAR_VERSION, IsobarError, runIsobar, type IsobarRunOptions } from '../../src/run/isobar.js';
import { makeGraph } from '../helpers/makeGraph.js';

// Pass-through spies: the fast tests script what isobar writes (no npx, no network) and read what diffGraphs was
// given; the slow tests run the real isobar (the fast suite's afterEach puts the original implementation back).
vi.mock('../../src/run/isobar.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/run/isobar.js')>();
  return { ...actual, runIsobar: vi.fn(actual.runIsobar) };
});
vi.mock('../../src/diff/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/diff/index.js')>();
  return { ...actual, diffGraphs: vi.fn(actual.diffGraphs) };
});

const here = dirname(fileURLToPath(import.meta.url));
const slow = process.env['ISOBAR_PR_SLOW'] ? describe : describe.skip;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const sh = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const PLANTED = `
export function reconcileSlow(orders: Order[], users: User[]): Line[] {
  const out: Line[] = [];
  for (const order of orders) {
    const user = users.find((u) => u.id === order.userId);
    if (user) {
      if (user.active) {
        if (order.total > 100) {
          if (order.currency === 'EUR') {
            if (order.items > 3) {
              out.push({ id: order.id, name: user.name, tier: 'gold' });
            } else {
              out.push({ id: order.id, name: user.name, tier: 'silver' });
            }
          } else if (order.currency === 'USD') {
            out.push({ id: order.id, name: user.name, tier: 'silver' });
          } else {
            out.push({ id: order.id, name: user.name, tier: 'bronze' });
          }
        } else if (order.total > 10) {
          out.push({ id: order.id, name: user.name, tier: 'bronze' });
        }
      } else if (order.total > 1000) {
        out.push({ id: order.id, name: user.name, tier: 'review' });
      }
    }
  }
  return out;
}
`;

function makeRepo(): string {
  const dir = tempDir('isobar-pr-e2e-');
  cpSync(join(here, '..', 'fixtures', 'project-tiny'), dir, { recursive: true });
  sh(dir, ['init', '-q', '-b', 'main']);
  sh(dir, ['add', '.']);
  sh(dir, ['commit', '-q', '-m', 'base']);
  sh(dir, ['checkout', '-q', '-b', 'feature']);
  appendFileSync(join(dir, 'src', 'services', 'users.ts'), PLANTED);
  writeFileSync(join(dir, 'README.md'), '# tiny\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'plant a slow nested function']);
  return dir;
}

const base = { headRef: 'HEAD', isobarVersion: DEFAULT_ISOBAR_VERSION, failOn: 'none' as const, reportUncalledRoutes: false, keepTemp: false, log: () => {} };

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

/** The error `fn` throws; fails the test when it throws nothing. */
function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected an error');
}

describe('compare: environment errors', () => {
  test('rejects a non-exact isobar version with code 2', () => {
    expect(() => compare({ ...base, dir: '.', baseRef: 'main', isobarVersion: '^0.7.1' })).toThrow(CompareError);
    try { compare({ ...base, dir: '.', baseRef: 'main', isobarVersion: 'latest' }); } catch (e) { expect((e as CompareError).code).toBe(2); }
  });
});

/** Writes `files` (path → text) under `dir`, creating folders. */
function write(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

const BASE_FILES: Record<string, string> = {
  'package.json': '{}\n',
  '.isobar.json': '{}\n',
  'README.md': '# r\n',
  'src/a.ts': 'export const a = 1;\n',
  'src/b.ts': 'export const b1 = 1;\nexport const b2 = 2;\nexport const b3 = 3;\n',
  'src/gone.ts': 'export const gone = 1;\n',
  'docs/x.ts': 'export const x = 1;\n',
  'docs/old.ts': 'export const old = 1;\n',
};

/** A repository whose `main` holds BASE_FILES, checked out on a `feature` branch off it where `pr` (if any) is committed. */
function gitRepo(pr?: (dir: string) => void): string {
  const dir = tempDir('isobar-pr-cmp-');
  write(dir, BASE_FILES);
  sh(dir, ['init', '-q', '-b', 'main']);
  sh(dir, ['add', '.']);
  sh(dir, ['commit', '-q', '-m', 'base']);
  sh(dir, ['checkout', '-q', '-b', 'feature']);
  if (pr) {
    pr(dir);
    sh(dir, ['add', '-A']);
    sh(dir, ['commit', '-q', '-m', 'pr']);
  }
  return dir;
}

/**
 * Edits inside and outside `src/` (an added line in src/a.ts, a deletion-only hunk in src/b.ts), a file deleted on each
 * side of the scope, and the root config: 4 changed paths, 2 deleted.
 */
function widePr(dir: string): void {
  write(dir, {
    'src/a.ts': 'export const a = 1;\nexport const a2 = 2;\n',
    'src/b.ts': 'export const b1 = 1;\nexport const b3 = 3;\n',
    'docs/x.ts': 'export const x = 2;\n',
    '.isobar.json': '{ "limits": {} }\n',
  });
  rmSync(join(dir, 'src', 'gone.ts'));
  rmSync(join(dir, 'docs', 'old.ts'));
}

/** The worktree paths `git worktree list --porcelain` reports, main worktree first. */
function worktrees(cwd: string): string[] {
  return sh(cwd, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length));
}

/** One scripted isobar run: what compare asked for, and the commit checked out in `dir` at the time. */
interface Run {
  dir: string;
  scope: string | undefined;
  outFile: string;
  sha: string;
}

let runs: Run[] = [];
/** tool_version of the graph each run writes, by call order (default 0.7.1). */
let toolVersions: string[] = [];
/** The call (0 = base, 1 = head) that throws an IsobarError instead of writing a graph. */
let failAt: number | undefined;

function fakeIsobar(o: IsobarRunOptions): void {
  const at = runs.length;
  runs.push({ dir: o.dir, scope: o.scope, outFile: o.outFile, sha: headSha(o.dir) });
  if (at === failAt) throw new IsobarError('isobar exploded', 'boom');
  mkdirSync(dirname(o.outFile), { recursive: true });
  writeFileSync(o.outFile, JSON.stringify(makeGraph({ tool_version: toolVersions[at] ?? '0.7.1' })));
}

/** The temp folder a run's graph went to (`<tmp>/<side>-out/graph.json`). */
const tempOf = (run: Run | undefined): string => dirname(dirname(run?.outFile ?? '/missing/x/graph.json'));

/** The Changes the latest compare handed to diffGraphs. */
function diffInput(): Changes {
  const call = vi.mocked(diffGraphs).mock.lastCall;
  if (!call) throw new Error('diffGraphs was not called');
  return call[2];
}

describe('compare: git orchestration (isobar scripted)', () => {
  beforeEach(() => {
    runs = [];
    toolVersions = [];
    failAt = undefined;
    vi.mocked(runIsobar).mockImplementation(fakeIsobar);
    vi.mocked(diffGraphs).mockClear();
  });
  afterEach(() => {
    vi.mocked(runIsobar).mockReset(); // back to the real runner for the slow suite
  });

  test('dir must be the repository root: a subfolder is code 2 naming the root and --scope; a symlink to the root is fine (A32)', () => {
    const dir = gitRepo(widePr);
    const e = thrown(() => compare({ ...base, dir: join(dir, 'src'), baseRef: 'main' }));
    expect(e).toBeInstanceOf(CompareError);
    expect((e as CompareError).code).toBe(2);
    expect(e.message).toContain(realpathSync(dir));
    expect(e.message).toContain('--scope');
    expect(runs).toHaveLength(0);
    const link = join(tempDir('isobar-pr-link-'), 'repo');
    symlinkSync(dir, link);
    expect(compare({ ...base, dir: link, baseRef: 'main' }).report.meta.changedFiles).toBe(4);
  });

  test('a missing directory and one outside any git repository are code 2 (A35); a git that cannot run stays a GitError (3)', () => {
    const gone = join(tmpdir(), 'isobar-pr-no-such-dir');
    const missing = thrown(() => compare({ ...base, dir: gone, baseRef: 'main' }));
    expect(missing).toBeInstanceOf(CompareError);
    expect((missing as CompareError).code).toBe(2);
    expect(missing.message).toBe(`${gone} is not a directory`);
    const outsideDir = tempDir('isobar-pr-norepo-');
    const outside = thrown(() => compare({ ...base, dir: outsideDir, baseRef: 'main' }));
    expect(outside).toBeInstanceOf(CompareError);
    expect((outside as CompareError).code).toBe(2);
    expect(outside.message).toBe(`not in a git repository: ${outsideDir}`);
    expect((outside as CompareError).stderr).toMatch(/not a git repository/i);
    const repo = gitRepo(widePr);
    const noGit = withEnv({ PATH: tempDir('isobar-pr-nogit-') }, () => thrown(() => compare({ ...base, dir: repo, baseRef: 'main' })));
    expect(noGit).toBeInstanceOf(GitError);
    expect((noGit as GitError).code).toBe(3);
  });

  test('--scope is normalised and must be a folder inside the repository (A12)', () => {
    const dir = gitRepo(widePr);
    for (const scope of ['nope', 'README.md', 'src/a.ts', '..', '../', tmpdir()]) {
      const e = thrown(() => compare({ ...base, dir, baseRef: 'main', scope }));
      expect(e, scope).toBeInstanceOf(CompareError);
      expect((e as CompareError).code, scope).toBe(2);
      expect(e.message, scope).toContain(`--scope ${scope} `);
    }
    expect(runs).toHaveLength(0);
    for (const scope of ['./src/', 'src', 'src//', join(dir, 'src'), 'docs/../src']) {
      runs = [];
      compare({ ...base, dir, baseRef: 'main', scope });
      expect(runs.map((r) => r.scope), scope).toEqual(['src', 'src']);
    }
    for (const scope of ['.', './', '', 'src/..']) {
      runs = [];
      compare({ ...base, dir, baseRef: 'main', scope });
      expect(runs.map((r) => r.scope), JSON.stringify(scope)).toEqual([undefined, undefined]);
    }
  });

  test('changes are built in full, then scope-filtered once: hunks, deletions, deleted and untracked files included (A12, A14, A25, A26)', () => {
    const dir = gitRepo(widePr);
    write(dir, { 'src/u.ts': 'export const u = 1;\nexport const v = 2;\n', 'other/v.ts': 'export const v = 1;\n', 'other/notes.txt': 'x\n' });
    compare({ ...base, dir, baseRef: 'main', scope: 'src' });
    const scoped = diffInput();
    expect([...scoped.changed].sort()).toEqual(['.isobar.json', 'src/a.ts', 'src/b.ts', 'src/u.ts']); // root config kept (A26)
    expect(scoped.hunks).toEqual(new Map([['src/a.ts', [{ start: 2, end: 2 }]], ['src/u.ts', [{ start: 1, end: 2 }]]]));
    expect(scoped.deletions).toEqual(new Map([['src/b.ts', [1]]]));
    expect(scoped.deleted).toEqual(new Set(['src/gone.ts']));
    expect(scoped.renames).toEqual(new Map());

    compare({ ...base, dir, baseRef: 'main' });
    const all = diffInput();
    expect([...all.changed].sort()).toEqual(['.isobar.json', 'docs/x.ts', 'other/notes.txt', 'other/v.ts', 'src/a.ts', 'src/b.ts', 'src/u.ts']);
    expect([...(all.hunks?.keys() ?? [])].sort()).toEqual(['.isobar.json', 'docs/x.ts', 'other/v.ts', 'src/a.ts', 'src/u.ts']);
    expect(all.hunks?.get('other/v.ts')).toEqual([{ start: 1, end: 1 }]); // untracked source: wholly added
    expect([...(all.deleted ?? [])].sort()).toEqual(['docs/old.ts', 'src/gone.ts']);
  });

  test('a file dropped from the index but still on disk is untracked: changed and wholly added, not deleted', () => {
    const dir = gitRepo(widePr);
    sh(dir, ['rm', '-q', '--cached', 'src/a.ts']);
    expect(sh(dir, ['diff', '--name-status', 'main']).split('\n')).toContain('D\tsrc/a.ts'); // control: git calls it deleted
    compare({ ...base, dir, baseRef: 'main' });
    const c = diffInput();
    expect(c.changed.has('src/a.ts')).toBe(true);
    expect(c.deleted?.has('src/a.ts')).toBe(false);
    expect(c.hunks?.get('src/a.ts')).toEqual([{ start: 1, end: 2 }]);
  });

  test('a PR that touches no analyzable source or config skips isobar and returns the empty report', () => {
    const dir = gitRepo((d) => write(d, { 'README.md': '# r\n\nmore\n' }));
    const lines: string[] = [];
    const { report, durationMs } = compare({ ...base, dir, baseRef: 'main', log: (l) => lines.push(l) });
    expect(runs).toHaveLength(0);
    expect(vi.mocked(diffGraphs)).not.toHaveBeenCalled();
    expect(report.meta).toMatchObject({ changedFiles: 1, analyzedChangedFiles: 0, baseRef: 'main', baseSha: sh(dir, ['rev-parse', 'main']), headSha: sh(dir, ['rev-parse', 'HEAD']) });
    expect(report.findings).toEqual([]);
    expect(report.gate).toBe('pass');
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(lines.at(-1)).toContain('skipping isobar');

    const outOfScope = gitRepo((d) => write(d, { 'docs/x.ts': 'export const x = 2;\n' }));
    expect(compare({ ...base, dir: outOfScope, baseRef: 'main', scope: 'src' }).report.meta.changedFiles).toBe(0);
    expect(runs).toHaveLength(0);
  });

  test('a PR that only deletes or renames away the root config still runs isobar, so the banner fires (A25)', () => {
    const deleted = gitRepo((d) => rmSync(join(d, '.isobar.json')));
    const r1 = compare({ ...base, dir: deleted, baseRef: 'main' }).report;
    expect(runs).toHaveLength(2);
    expect(r1.findings.map((f) => [f.kind, f.data['deleted']])).toEqual([['config-changed', ['.isobar.json']]]);

    runs = [];
    const renamed = gitRepo((d) => sh(d, ['mv', '.isobar.json', 'isobar.json.bak']));
    const r2 = compare({ ...base, dir: renamed, baseRef: 'main' }).report;
    expect(runs).toHaveLength(2);
    expect(r2.findings.map((f) => [f.kind, f.file, f.renamedFrom])).toEqual([['config-changed', 'isobar.json.bak', '.isobar.json']]);
  });

  test('missing refs and unrelated histories are code 2 with the fetch-depth hint (A32)', () => {
    const dir = gitRepo(widePr);
    for (const o of [{ baseRef: 'nope' }, { baseRef: 'main', headRef: 'nope' }, { baseRef: '--all' }]) {
      const e = thrown(() => compare({ ...base, dir, ...o }));
      expect(e, JSON.stringify(o)).toBeInstanceOf(CompareError);
      expect((e as CompareError).code).toBe(2);
      expect(e.message).toContain('"nope" not found'.replace('nope', o.headRef ?? o.baseRef));
      expect(e.message).toContain('fetch-depth: 0');
    }
    sh(dir, ['checkout', '-q', '--orphan', 'other']);
    sh(dir, ['rm', '-rfq', '.']);
    write(dir, { 'src/z.ts': 'export const z = 1;\n' });
    sh(dir, ['add', '-A']);
    sh(dir, ['commit', '-q', '-m', 'unrelated']);
    const e = thrown(() => compare({ ...base, dir, baseRef: 'main' }));
    expect(e).toBeInstanceOf(CompareError);
    expect((e as CompareError).code).toBe(2);
    expect(e.message).toContain('no merge base between main and HEAD');
    expect(e.message).toContain('fetch-depth: 0');
    expect(runs).toHaveLength(0);
  });

  test('a merge-base failure keeps git\'s stderr on the CompareError (code 2), and handleError prints it (A35)', () => {
    const dir = gitRepo(widePr);
    write(dir, { 'src/a.ts': 'export const a = 3;\n' });
    sh(dir, ['commit', '-q', '-am', 'second']);
    const parent = sh(dir, ['rev-parse', 'HEAD~1']);
    rmSync(join(dir, '.git', 'objects', parent.slice(0, 2), parent.slice(2))); // history cut: merge-base cannot walk past HEAD
    const e = thrown(() => compare({ ...base, dir, baseRef: 'main', headRef: 'feature' }));
    expect(e).toBeInstanceOf(CompareError);
    expect((e as CompareError).code).toBe(2);
    expect(e.message).toContain('no merge base between main and feature. ');
    expect((e as CompareError).stderr).toContain(`could not parse commit ${parent}`);
    const err: string[] = [];
    expect(handleError(e, { out: () => {}, err: (s) => { err.push(s); }, env: {} })).toBe(2);
    expect(err.join('')).toContain(`fetch-depth: 0 }\n${(e as CompareError).stderr}`);
  });

  test('a depth-1 clone says so where the base ref is missing and where the merge base is (A35)', () => {
    const origin = gitRepo(widePr);
    const single = tempDir('isobar-pr-shallow-');
    sh(single, ['clone', '-q', '--depth', '1', `file://${origin}`, single]); // the Actions default: one branch, one commit
    const e1 = thrown(() => compare({ ...base, dir: single, baseRef: 'main' }));
    expect(e1).toBeInstanceOf(CompareError);
    expect((e1 as CompareError).code).toBe(2);
    expect(e1.message).toContain(`base ref "main" not found in ${realpathSync(single)} (this clone is shallow). `);
    const both = tempDir('isobar-pr-shallow-');
    sh(both, ['clone', '-q', '--depth', '1', '--no-single-branch', `file://${origin}`, both]); // main fetched, history cut
    const e2 = thrown(() => compare({ ...base, dir: both, baseRef: 'main' }));
    expect(e2).toBeInstanceOf(CompareError);
    expect(e2.message).toContain('no merge base between main and HEAD (this clone is shallow). ');
    const full = thrown(() => compare({ ...base, dir: origin, baseRef: 'nope' }));
    expect(full.message).toContain(`base ref "nope" not found in ${realpathSync(origin)}. `); // no note on a full clone
    expect(runs).toHaveLength(0);
  });

  test('--head-ref <commit> analyzes a second worktree at that commit; HEAD analyzes the working tree, -dirty when edited', () => {
    const dir = gitRepo(widePr);
    const top = realpathSync(dir);
    const tip = sh(dir, ['rev-parse', 'HEAD']);
    const mb = sh(dir, ['merge-base', 'main', 'HEAD']);
    write(dir, { 'src/wt.ts': 'export const w = 1;\n' }); // untracked: in the working tree only

    const atTip = compare({ ...base, dir, baseRef: 'main', headRef: tip }).report;
    expect(atTip.meta.headSha).toBe(tip);
    expect(atTip.meta.baseSha).toBe(mb);
    expect(runs.map((r) => r.sha)).toEqual([mb, tip]);
    expect(runs.map((r) => r.dir)).not.toContain(top);
    expect(diffInput().changed.has('src/wt.ts')).toBe(false);
    expect(compare({ ...base, dir, baseRef: 'main', headRef: 'feature' }).report.meta.headSha).toBe(tip);

    runs = [];
    const dirty = compare({ ...base, dir, baseRef: 'main' }).report;
    expect(dirty.meta.headSha).toBe(`${tip}-dirty`);
    expect(runs.map((r) => r.dir)[1]).toBe(top);
    expect(diffInput().changed.has('src/wt.ts')).toBe(true);
    rmSync(join(dir, 'src', 'wt.ts'));
    expect(compare({ ...base, dir, baseRef: 'main' }).report.meta.headSha).toBe(tip);
    expect(worktrees(dir)).toEqual([top]);
  });

  test('worktrees and the temp folder are removed even when isobar fails (finally)', () => {
    const dir = gitRepo(widePr);
    const tip = sh(dir, ['rev-parse', 'HEAD']);
    for (const at of [0, 1]) {
      runs = [];
      failAt = at;
      const e = thrown(() => compare({ ...base, dir, baseRef: 'main', headRef: tip }));
      expect(e).toBeInstanceOf(IsobarError);
      expect(runs).toHaveLength(at + 1);
      expect(existsSync(runs[0]?.dir ?? '/')).toBe(false);
      expect(existsSync(tempOf(runs[0]))).toBe(false);
      expect(worktrees(dir)).toEqual([realpathSync(dir)]);
    }
  });

  test('keepTemp keeps the temp folder with both graphs and logs its path; the worktrees still go', () => {
    const dir = gitRepo(widePr);
    const lines: string[] = [];
    compare({ ...base, dir, baseRef: 'main', headRef: 'feature', keepTemp: true, log: (l) => lines.push(l) });
    const tmp = tempOf(runs[0]);
    dirs.push(tmp);
    expect(runs.every((r) => existsSync(r.outFile))).toBe(true);
    expect(lines.at(-1)).toBe(`isobar-pr: kept ${tmp}`);
    expect(worktrees(dir)).toEqual([realpathSync(dir)]);
  });

  test('graphs from two isobar versions are a VersionMismatchError, cleaned up like any failure', () => {
    const dir = gitRepo(widePr);
    toolVersions = ['0.7.1', '0.7.2'];
    const e = thrown(() => compare({ ...base, dir, baseRef: 'main' }));
    expect(e).toBeInstanceOf(VersionMismatchError);
    expect(e.message).toContain('base 0.7.1, head 0.7.2');
    expect(existsSync(tempOf(runs[0]))).toBe(false);
    expect(worktrees(dir)).toEqual([realpathSync(dir)]);
  });

  test('log: the first line names the merge base, the head and the changed-file count; then one line per isobar run', () => {
    const dir = gitRepo(widePr);
    const mb = sh(dir, ['merge-base', 'main', 'HEAD']);
    const tip = sh(dir, ['rev-parse', 'HEAD']);
    const lines: string[] = [];
    compare({ ...base, dir, baseRef: 'main', log: (l) => lines.push(l) });
    expect(lines).toEqual([
      `isobar-pr: base ${mb.slice(0, 7)} (merge-base of main) vs head ${tip.slice(0, 7)}, 4 changed files`,
      `isobar-pr: isobar@${DEFAULT_ISOBAR_VERSION} on base…`,
      `isobar-pr: isobar@${DEFAULT_ISOBAR_VERSION} on head…`,
    ]);
    writeFileSync(join(dir, 'src', 'a.ts'), 'edited\n');
    lines.length = 0;
    compare({ ...base, dir, baseRef: 'main', log: (l) => lines.push(l) });
    expect(lines[0]).toContain(`vs head ${tip.slice(0, 7)}-dirty, 4 changed files`);
  });
});

slow('compare: end to end on a real repo with isobar', () => {
  test('reports the planted function as a regression and skips isobar for non-source PRs', () => {
    const dir = makeRepo();
    const { report, durationMs } = compare({ ...base, dir, baseRef: 'main' });
    expect(durationMs).toBeGreaterThan(0);
    expect(report.meta.changedFiles).toBe(2);
    expect(report.meta.baseRef).toBe('main');
    const regression = report.findings.find((f) => f.kind === 'function-regression' && f.data['name'] === 'reconcileSlow');
    expect(regression, JSON.stringify(report.findings, null, 2)).toBeDefined();
    expect((regression!.data['metrics'] as unknown[]).length).toBeGreaterThan(0);
    expect(regression!.inDiff).toBe(true);
    expect(renderMarkdown(report)).toContain('### ⚠️ Crossed a limit or got slower');
    expect(report.summary.find((r) => r.label === 'Cognitive complexity')?.delta).toMatch(/^\+\d+$/);

    writeFileSync(join(dir, 'README.md'), '# tiny\n\ndocs only\n');
    sh(dir, ['commit', '-q', '-am', 'docs']);
    const docs = compare({ ...base, dir, baseRef: 'HEAD~1' });
    expect(docs.report.meta.analyzedChangedFiles).toBe(0);
    expect(docs.report.findings).toEqual([]);
  });

  test('a missing base ref is a code-2 error that mentions fetch-depth', () => {
    const dir = makeRepo();
    try { compare({ ...base, dir, baseRef: 'does-not-exist' }); throw new Error('expected CompareError'); }
    catch (e) { expect(e).toBeInstanceOf(CompareError); expect((e as CompareError).code).toBe(2); expect((e as CompareError).message).toContain('fetch-depth: 0'); }
  });
});
