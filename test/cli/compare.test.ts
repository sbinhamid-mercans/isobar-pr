import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { main } from '../../src/cli.js';
import { runIsobar } from '../../src/run/isobar.js';
import { makeGraph } from '../helpers/makeGraph.js';

// isobar is scripted (no npx): each run writes an empty schema-3 graph, so the CLI path is exercised without the network.
vi.mock('../../src/run/isobar.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/run/isobar.js')>();
  return { ...actual, runIsobar: vi.fn() };
});

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const sh = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
/** A stack frame line, which no handled error may print. */
const STACK = /\n\s+at /;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function fakeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => { out.push(s); }, err: (s: string) => { err.push(s); }, env: {} as NodeJS.ProcessEnv }, out, err };
}

/** `main` on a repository whose `feature` branch (checked out) edits src/a.ts off `main`. */
function repo(): string {
  const dir = tempDir('isobar-pr-clicmp-');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'package.json'), '{}\n');
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  sh(dir, ['init', '-q', '-b', 'main']);
  sh(dir, ['add', '.']);
  sh(dir, ['commit', '-q', '-m', 'base']);
  sh(dir, ['checkout', '-q', '-b', 'feature']);
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 2;\n');
  sh(dir, ['commit', '-q', '-am', 'pr']);
  return dir;
}

beforeEach(() => {
  vi.mocked(runIsobar).mockReset();
  vi.mocked(runIsobar).mockImplementation((o) => {
    mkdirSync(dirname(o.outFile), { recursive: true });
    writeFileSync(o.outFile, JSON.stringify(makeGraph()));
  });
});

describe('isobar-pr compare', () => {
  test('--format json prints the report on stdout and progress on stderr; exit 0', async () => {
    const dir = repo();
    const { io, out, err } = fakeIo();
    expect(await main(['compare', dir, '--base-ref', 'main', '--format', 'json'], io)).toBe(0);
    const report = JSON.parse(out.join(''));
    expect(report.meta).toMatchObject({ baseRef: 'main', baseSha: sh(dir, ['rev-parse', 'main']), headSha: sh(dir, ['rev-parse', 'HEAD']), changedFiles: 1 });
    expect(report.gate).toBe('pass');
    expect(err.join('')).toMatch(/^isobar-pr: base [0-9a-f]{7} \(merge-base of main\) vs head [0-9a-f]{7}, 1 changed file\n/);
    expect(err.join('')).toContain('on head…\n');
    expect(vi.mocked(runIsobar)).toHaveBeenCalledTimes(2);
  });

  test('markdown by default, with the run time in the footer; --out writes all three files', async () => {
    const dir = repo();
    const outDir = join(tempDir('isobar-pr-cliout-'), 'r');
    const { io, out } = fakeIo();
    expect(await main(['compare', dir, '--out', outDir], io)).toBe(0);
    expect(out.join('')).toContain('## 🌀 isobar-pr');
    expect(readFileSync(join(outDir, 'report.md'), 'utf8')).toBe(out.join(''));
    expect(existsSync(join(outDir, 'report.json'))).toBe(true);
  });

  test('--keep-temp keeps the temp folder and says where it is', async () => {
    const dir = repo();
    const { io, err } = fakeIo();
    expect(await main(['compare', dir, '--keep-temp', '--format', 'json'], io)).toBe(0);
    const kept = /isobar-pr: kept (.+)\n/.exec(err.join(''))?.[1];
    expect(kept).toBeDefined();
    dirs.push(kept ?? '');
    expect(existsSync(join(kept ?? '', 'base-out', 'graph.json'))).toBe(true);
  });

  test('a subfolder exits 2 naming the repository root and --scope, without a stack', async () => {
    const dir = repo();
    const { io, out, err } = fakeIo();
    expect(await main(['compare', join(dir, 'src')], io)).toBe(2);
    expect(err.join('')).toContain(`is inside the repository ${realpathSync(dir)}; run isobar-pr from the repository root and use --scope`);
    expect(err.join('')).not.toMatch(STACK);
    expect(out.join('')).toBe('');
  });

  test.each([
    [['--isobar-version', '^0.7.1'], '--isobar-version must be an exact version such as 0.7.1, got "^0.7.1"'],
    [['--base-ref', 'nope'], 'base ref "nope" not found'],
    [['--scope', 'nope'], '--scope nope is not a directory in'],
    [['--head', 'feature'], '--head is a diff option; compare takes --base-ref and --head-ref'],
    [['extra'], 'compare takes one repository directory, got 2'],
    [['--format', 'xml'], '--format must be markdown, json, annotations or all'],
  ])('compare %j exits 2 with a one-line reason', async (extra, message) => {
    const dir = repo();
    const { io, out, err } = fakeIo();
    expect(await main(['compare', dir, ...extra], io)).toBe(2);
    expect(err.join('')).toContain(`isobar-pr: ${message}`);
    expect(err.join('')).not.toMatch(STACK);
    expect(out.join('')).toBe('');
    expect(vi.mocked(runIsobar)).not.toHaveBeenCalled();
  });

  test('a directory outside any git repository exits 2: our line, then git\'s own (A35)', async () => {
    const dir = tempDir('isobar-pr-clinorepo-');
    const { io, out, err } = fakeIo();
    expect(await main(['compare', dir], io)).toBe(2);
    expect(err.join('')).toMatch(/^isobar-pr: not in a git repository: .+\nfatal: not a git repository/i);
    expect(err.join('')).toContain(`isobar-pr: not in a git repository: ${dir}\n`);
    expect(err.join('')).not.toMatch(STACK);
    expect(out.join('')).toBe('');
  });

  test('an unknown command is still a usage error (exit 2)', async () => {
    const { io, err } = fakeIo();
    expect(await main(['comapre', '.'], io)).toBe(2);
    expect(err.join('')).toContain('isobar-pr: unknown command "comapre"');
  });
});
