import { execFileSync, spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { handleError } from '../../src/cli.js';
import { loadGraph } from '../../src/graph/load.js';
import { gitEnv } from '../../src/run/git.js';
import { ANALYZABLE_EXTENSIONS, DEFAULT_ISOBAR_VERSION, IsobarError, isAnalyzable, isExactSemver, runIsobar } from '../../src/run/isobar.js';

// A pass-through spy: the mocked runner tests script one npx result each; the slow tests spawn the real npx.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

const here = dirname(fileURLToPath(import.meta.url));
const tiny = join(here, '..', 'fixtures', 'project-tiny');
const slow = process.env['ISOBAR_PR_SLOW'] ? describe : describe.skip;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
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

/** The IsobarError `fn` throws; fails the test when it throws anything else or nothing. */
function caught(fn: () => void): IsobarError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(IsobarError);
    return e as IsobarError;
  }
  throw new Error('expected an IsobarError');
}

describe('isobar runner helpers', () => {
  test('isExactSemver accepts exact versions only', () => {
    expect(isExactSemver('0.7.1')).toBe(true);
    expect(isExactSemver('1.0.0-beta.1')).toBe(true);
    expect(isExactSemver('^0.7.1')).toBe(false);
    expect(isExactSemver('latest')).toBe(false);
    expect(isExactSemver('0.7')).toBe(false);
  });

  test('isExactSemver refuses a v prefix, build metadata (strict by choice) and malformed versions', () => {
    for (const v of ['0.0.0', '10.20.30', '1.0.0-rc.1', '1.0.0-alpha-2.0']) expect(isExactSemver(v), v).toBe(true);
    const refused = ['v0.7.1', '0.7.1+build', '0.7.1-beta+exp.sha.5114f85', '01.7.1', '0.07.1', '1.0.0-', '1.0.0-beta..1', '0.7.1.0', ' 0.7.1', '0.7.1\n', ''];
    for (const v of refused) expect(isExactSemver(v), JSON.stringify(v)).toBe(false);
  });

  test('isAnalyzable follows isobar language support', () => {
    expect(ANALYZABLE_EXTENSIONS.has('tsx')).toBe(true);
    expect(isAnalyzable('src/App.TSX')).toBe(true);
    expect(isAnalyzable('README.md')).toBe(false);
    expect(isAnalyzable('Makefile')).toBe(false);
    expect(isAnalyzable('app/models/user.rb')).toBe(true);
  });

  test('isAnalyzable reads the extension as isobar does (path.posix.extname, any case)', () => {
    const parsed = [
      'src/App.vue', 'app/main.py', 'cmd/main.go', 'src/Main.java', 'public/index.html', 'styles/site.css', 'src/mod.mts',
      'styles/a.sass', 'site/index.htm', 'lib/tasks/db.rake', 'config.ru', 'R/model.R', 'types.d.ts', // .d.ts: isobar skips it; a needless run, never a missed one
    ];
    for (const p of parsed) expect(isAnalyzable(p), p).toBe(true);
    // No extension: a dotfile, a dot in a directory name, a trailing dot, a dotfile named like an extension.
    // Mapped by isobar as line counts only (no parser): .rs, .sh, .sql.
    const skipped = ['.gitignore', 'src/v1.2/app', 'file.', 'src/.ts', 'src/lib.rs', 'deploy.sh', 'db/schema.sql', 'package.json'];
    for (const p of skipped) expect(isAnalyzable(p), p).toBe(false);
  });

  test('ANALYZABLE_EXTENSIONS is exactly what isobar 0.7.1 parses (recheck its bundle when DEFAULT_ISOBAR_VERSION moves)', () => {
    const javascript = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'astro'];
    const others = ['css', 'scss', 'sass', 'less', 'go', 'html', 'htm', 'java', 'py', 'r', 'rmd', 'qmd', 'rb', 'rake', 'ru'];
    expect([...ANALYZABLE_EXTENSIONS].sort()).toEqual([...javascript, ...others].sort());
  });

  test('DEFAULT_ISOBAR_VERSION is pinned exactly', () => {
    expect(isExactSemver(DEFAULT_ISOBAR_VERSION)).toBe(true);
  });

  test('IsobarError carries stderr and exit code 3 by default; handleError prints both and exits with its code', () => {
    const e = new IsobarError('isobar failed', 'boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('IsobarError');
    expect(e.message).toBe('isobar failed');
    expect(e.stderr).toBe('boom');
    expect(e.code).toBe(3);
    expect(new IsobarError('refused', '', 2).code).toBe(2);
    const err: string[] = [];
    const io = { out: () => {}, err: (s: string) => { err.push(s); }, env: {} };
    expect(handleError(new IsobarError('refused', 'why', 2), io)).toBe(2);
    expect(err.join('')).toBe('isobar-pr: refused\nwhy\n');
  });
});

/** Makes runIsobar's next spawn (npx) return `result`, after `effect` stands in for what isobar writes. */
function fakeNpx(result: Partial<SpawnSyncReturns<string>>, effect: () => void = () => {}): void {
  const done: SpawnSyncReturns<string> = { pid: 1, output: [], stdout: '', stderr: '', status: 0, signal: null, ...result };
  vi.mocked(spawnSync).mockImplementationOnce((() => {
    effect();
    return done;
  }) as unknown as typeof spawnSync);
}

/** The command, argv and options of the last spawn. */
function lastSpawn(): { cmd: string; args: readonly string[]; opts: SpawnSyncOptions } {
  const call = vi.mocked(spawnSync).mock.lastCall as unknown as [string, string[], SpawnSyncOptions] | undefined;
  if (!call) throw new Error('spawnSync was not called');
  return { cmd: call[0], args: call[1], opts: call[2] };
}

describe('isobar runner (npx mocked)', () => {
  let work: string;
  let outFile: string;
  const writeGraph = () => writeFileSync(outFile, '{}');

  beforeAll(() => {
    gitEnv(); // fill gitEnv's once-per-process git query, so each scripted result meets runIsobar's own npx spawn
    vi.mocked(spawnSync).mockClear(); // forget that git spawn, so call counts start at zero in every test, run alone or not
  });
  beforeEach(() => {
    work = tempDir('isobar-pr-mock-');
    outFile = join(work, 'out', 'graph.json');
  });
  afterEach(() => {
    vi.mocked(spawnSync).mockReset(); // drops an unused scripted result; vitest 3 restores the pass-through
  });

  test('spawns npx -y isobar@<version> <dir> --format json -q -o <outFile>, with --scope only when given', () => {
    fakeNpx({}, writeGraph);
    runIsobar({ dir: work, version: '0.7.1', outFile });
    expect(lastSpawn().cmd).toBe('npx');
    expect(lastSpawn().args).toEqual(['-y', 'isobar@0.7.1', work, '--format', 'json', '-q', '-o', outFile]);
    expect(statSync(dirname(outFile)).isDirectory()).toBe(true); // created before isobar runs
    fakeNpx({}, writeGraph);
    runIsobar({ dir: work, version: '0.7.1', outFile, scope: 'packages/api' });
    expect(lastSpawn().args).toEqual(['-y', 'isobar@0.7.1', work, '--format', 'json', '-q', '-o', outFile, '--scope', 'packages/api']);
  });

  test('dir and outFile are passed absolute, so a folder named like an option is never read as one', () => {
    fakeNpx({}, writeGraph);
    runIsobar({ dir: '-h', version: '0.7.1', outFile });
    expect(lastSpawn().args[2]).toBe(resolve('-h'));
  });

  test('runs with gitEnv (no inherited GIT_DIR and friends), CI=1 and NO_COLOR=1, under a 120 s timeout by default', () => {
    fakeNpx({}, writeGraph);
    withEnv({ GIT_DIR: '/nowhere', GIT_WORK_TREE: '/nowhere', GIT_INDEX_FILE: '/nowhere' }, () => runIsobar({ dir: work, version: '0.7.1', outFile }));
    const { opts } = lastSpawn();
    const env = opts.env ?? {};
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) expect(env[key], key).toBeUndefined();
    expect(env['CI']).toBe('1');
    expect(env['NO_COLOR']).toBe('1');
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
    expect(env['PATH']).toBe(process.env['PATH']); // the whole environment, not only the overrides
    expect(opts.encoding).toBe('utf8');
    expect(opts.timeout).toBe(120_000);
    fakeNpx({}, writeGraph);
    runIsobar({ dir: work, version: '0.7.1', outFile, timeoutMs: 5_000 });
    expect(lastSpawn().opts.timeout).toBe(5_000);
  });

  test('a spawn that times out is an IsobarError (code 3) saying how long it waited, with the stderr so far', () => {
    const timedOut = Object.assign(new Error('spawnSync npx ETIMEDOUT'), { code: 'ETIMEDOUT' });
    fakeNpx({ error: timedOut, status: null, signal: 'SIGTERM', stderr: 'partial' });
    const e = caught(() => runIsobar({ dir: work, version: '0.7.1', outFile, timeoutMs: 1_500 }));
    expect(e.message).toBe(`isobar@0.7.1 did not finish on ${work}: timed out after 1.5 s`);
    expect(e.stderr).toBe('partial');
    expect(e.code).toBe(3);
  });

  test('an npx that cannot start is an IsobarError (code 3) with the spawn error', () => {
    const missing = Object.assign(new Error('spawnSync npx ENOENT'), { code: 'ENOENT' });
    fakeNpx({ error: missing, status: null, stdout: undefined, stderr: undefined }); // what spawnSync returns on ENOENT
    const e = caught(() => runIsobar({ dir: work, version: '0.7.1', outFile }));
    expect(e.message).toBe(`isobar@0.7.1 did not finish on ${work}: spawnSync npx ENOENT`);
    expect(e.stderr).toBe('');
    expect(e.code).toBe(3);
  });

  test('a non-zero exit is an IsobarError (code 3) with isobar\'s stderr; a kill names the signal', () => {
    fakeNpx({ status: 1, stderr: 'npm error 404 Not Found - isobar@9.9.9\n' });
    const failed = caught(() => runIsobar({ dir: work, version: '0.7.1', outFile }));
    expect(failed.message).toBe(`isobar@0.7.1 exited 1 on ${work}`);
    expect(failed.stderr).toBe('npm error 404 Not Found - isobar@9.9.9\n');
    expect(failed.code).toBe(3);
    fakeNpx({ status: null, signal: 'SIGKILL' });
    expect(caught(() => runIsobar({ dir: work, version: '0.7.1', outFile })).message).toBe(`isobar@0.7.1 was killed by SIGKILL on ${work}`);
  });

  test('exit 0 with a directory at outFile (isobar\'s workspace mode) is refused with exit code 2 and a --scope hint', () => {
    fakeNpx({}, () => mkdirSync(join(outFile, 'one'), { recursive: true }));
    const e = caught(() => runIsobar({ dir: work, version: '0.7.1', outFile }));
    expect(e.code).toBe(2);
    expect(e.message).toMatch(/workspace of several projects/);
    expect(e.message).toMatch(/--scope/);
  });

  test('exit 0 with nothing at outFile is an IsobarError (code 3): isobar 0.7.1 writes graph.json even for an empty folder', () => {
    fakeNpx({});
    const e = caught(() => runIsobar({ dir: work, version: '0.7.1', outFile }));
    expect(e.message).toBe(`isobar@0.7.1 exited 0 but wrote no graph.json at ${outFile}`);
    expect(e.code).toBe(3);
  });

  test('a version that is not exact is refused (code 2) before npx runs: isobar@<spec> could name any package source', () => {
    for (const version of ['latest', '^0.7.1', 'file:../evil', '0.7.1 --help']) {
      const e = caught(() => runIsobar({ dir: work, version, outFile }));
      expect(e.code, version).toBe(2);
      expect(e.message).toContain(JSON.stringify(version));
    }
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
  });
});

slow('isobar runner (network: downloads isobar once)', () => {
  const version = DEFAULT_ISOBAR_VERSION;

  /** A copy of project-tiny in a fresh temp folder (not a git repository). */
  function tinyCopy(): string {
    const dir = tempDir('isobar-pr-run-');
    cpSync(tiny, dir, { recursive: true });
    return dir;
  }

  /** A fresh graph.json path outside every analyzed folder. */
  const freshOut = () => join(tempDir('isobar-pr-out-'), 'graph.json');

  test('writes schema-3 graph.json for project-tiny with the pinned tool_version', () => {
    const dir = tinyCopy();
    const outFile = join(dir, '.out', 'graph.json');
    const started = Date.now();
    runIsobar({ dir, version, outFile });
    console.log(`isobar-pr: one isobar@${version} run on project-tiny took ${Date.now() - started} ms`);
    expect(existsSync(outFile)).toBe(true);
    const g = loadGraph(outFile);
    expect(g.schema_version).toBe(3);
    expect(g.tool_version).toBe(version);
    expect(Object.keys(g.files)).toContain('src/services/users.ts');
    expect(g.files['src/services/users.ts']?.functions?.map((f) => f.name)).toContain('reconcile');
  });

  test('a missing graph.json is reported as a workspace repo (exit code 2)', () => {
    const parent = tempDir('isobar-pr-ws-');
    cpSync(tiny, join(parent, 'one'), { recursive: true });
    cpSync(tiny, join(parent, 'two'), { recursive: true });
    const outFile = join(parent, '.out', 'graph.json');
    let error: unknown;
    try {
      runIsobar({ dir: parent, version, outFile });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(IsobarError);
    expect((error as IsobarError).code).toBe(2);
    expect((error as IsobarError).message).toMatch(/--scope/);
    // What isobar 0.7.1 actually does: it exits 0 and makes outFile a folder with one graph.json per project.
    expect(statSync(outFile).isDirectory()).toBe(true);
    expect(existsSync(join(outFile, 'one', 'graph.json'))).toBe(true);
  });

  test('measures reconcile (cognitive 6, cyclomatic 4 in isobar 0.7.1) and marks users.test.ts as a test', () => {
    const outFile = freshOut();
    runIsobar({ dir: tinyCopy(), version, outFile });
    const g = loadGraph(outFile);
    expect(Object.keys(g.files).sort()).toEqual([
      'src/data/orders.ts', 'src/hooks/useUsers.ts', 'src/index.ts', 'src/services/users.test.ts', 'src/services/users.ts', 'src/utils/format.ts',
    ]);
    const reconcile = g.files['src/services/users.ts']?.functions?.find((f) => f.name === 'reconcile');
    expect(reconcile?.cognitive).toBe(6);
    expect(reconcile?.cyclomatic).toBe(4);
    expect(g.files['src/services/users.test.ts']?.kind).toBe('test');
  });

  test('--scope narrows the map but keeps files keys relative to dir, not to the scope', () => {
    const outFile = freshOut();
    runIsobar({ dir: tinyCopy(), version, outFile, scope: 'src/services' });
    // `src/services/users.ts`, never `users.ts`: Task 23 (filterChanges, the untracked-file scope filter) compares these
    // keys with git's repo-relative paths as they are, with no prefix to add or strip.
    expect(Object.keys(loadGraph(outFile).files).sort()).toEqual(['src/services/users.test.ts', 'src/services/users.ts']);
  });

  test('a git repository root is always one project: a folder of projects maps whole, keys prefixed by project folder', () => {
    const repo = tempDir('isobar-pr-repo-');
    cpSync(tiny, join(repo, 'one'), { recursive: true });
    cpSync(tiny, join(repo, 'two'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repo, env: gitEnv() }); // `.git` is a project file to isobar
    const whole = freshOut();
    runIsobar({ dir: repo, version, outFile: whole });
    const keys = Object.keys(loadGraph(whole).files);
    expect(keys).toContain('one/src/services/users.ts');
    expect(keys).toContain('two/src/services/users.ts');
    const scoped = freshOut();
    runIsobar({ dir: repo, version, outFile: scoped, scope: 'one' });
    const scopedKeys = Object.keys(loadGraph(scoped).files);
    expect(scopedKeys).toContain('one/src/services/users.ts');
    expect(scopedKeys.every((k) => k.startsWith('one/'))).toBe(true);
  });

  test('two runs on the same tree differ only in generated_at', () => {
    const dir = tinyCopy();
    const run = (): Record<string, unknown> => {
      const outFile = freshOut();
      runIsobar({ dir, version, outFile });
      return JSON.parse(readFileSync(outFile, 'utf8')) as Record<string, unknown>;
    };
    const a = run();
    const b = run();
    const differing = Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    // generated_at is a second-resolution timestamp, so two quick runs can share it. `name` is dir's basename, so
    // compare's base worktree and head checkout always differ there too (nothing in isobar-pr reads it).
    expect(differing.filter((k) => k !== 'generated_at')).toEqual([]);
    expect(typeof a['generated_at']).toBe('string');
  });

  test('a run past timeoutMs is killed and reported as timed out', () => {
    const e = caught(() => runIsobar({ dir: tinyCopy(), version, outFile: freshOut(), timeoutMs: 50 }));
    expect(e.message).toMatch(/: timed out after 0\.05 s$/);
    expect(e.code).toBe(3);
  });
});
