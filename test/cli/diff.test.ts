import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { defaultIo, handleError, main } from '../../src/cli.js';
import { UsageError, withPath } from '../../src/commands/options.js';
import { SchemaError, VersionMismatchError } from '../../src/graph/load.js';
import type { Finding } from '../../src/report/types.js';
import crossed from '../fixtures/crossed-limit/fixture.js';
import self from '../fixtures/http-self-contained/fixture.js';
import { makeGraph, type Fixture } from '../helpers/makeGraph.js';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function fakeIo(env: NodeJS.ProcessEnv = {}, stdin?: () => string) {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => { out.push(s); }, err: (s: string) => { err.push(s); }, env, stdin }, out, err };
}

const PAGE = 'src/pages/ManagerInbox.tsx';
/** The `diff --git` block header parseHunks needs before a hunk (A12). */
const HEADER = [`diff --git a/${PAGE} b/${PAGE}`, `--- a/${PAGE}`, `+++ b/${PAGE}`];
/** A stack frame line, which no handled error may print. */
const STACK = /\n\s+at /;

function writeFixture(fixture: Fixture = crossed, changesText = `M\t${PAGE}\n`) {
  const dir = mkdtempSync(join(tmpdir(), 'isobar-pr-cli-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'base.json'), JSON.stringify(fixture.base));
  writeFileSync(join(dir, 'head.json'), JSON.stringify(fixture.head));
  writeFileSync(join(dir, 'changes.txt'), changesText);
  writeFileSync(join(dir, 'hunks.txt'), [...HEADER, '@@ -55,2 +55,14 @@', ''].join('\n')); // A12: parseHunks needs the diff --git header
  return dir;
}

/** `diff --base … --head … --changes …` over a fixture dir, then `extra`. */
function diffArgs(dir: string, ...extra: string[]): string[] {
  return ['diff', '--base', join(dir, 'base.json'), '--head', join(dir, 'head.json'), '--changes', join(dir, 'changes.txt'), ...extra];
}

describe('isobar-pr diff', () => {
  test('prints markdown by default and exits 0', async () => {
    const dir = writeFixture();
    const { io, out } = fakeIo();
    const code = await main(['diff', '--base', join(dir, 'base.json'), '--head', join(dir, 'head.json'), '--changes', join(dir, 'changes.txt'), '--hunks', join(dir, 'hunks.txt')], io);
    expect(code).toBe(0);
    expect(out.join('')).toContain('### ⚠️ Crossed a limit or got slower');
  });

  test('--format json prints stable JSON; --fail-on limit-crossed exits 1', async () => {
    const dir = writeFixture();
    const { io, out } = fakeIo();
    const code = await main(['diff', '--base', join(dir, 'base.json'), '--head', join(dir, 'head.json'), '--changes', join(dir, 'changes.txt'), '--format', 'json', '--fail-on', 'limit-crossed'], io);
    expect(code).toBe(1);
    const report = JSON.parse(out.join(''));
    expect(report.gate).toBe('fail');
    expect(report.findings[0].kind).toBe('function-regression');
  });

  test('--format all --out DIR writes three files; --gate-output exits 0 and writes GITHUB_OUTPUT', async () => {
    const dir = writeFixture();
    const outDir = join(dir, 'out');
    const ghOut = join(dir, 'gh_output');
    writeFileSync(ghOut, '');
    const { io } = fakeIo({ GITHUB_OUTPUT: ghOut });
    const code = await main(['diff', '--base', join(dir, 'base.json'), '--head', join(dir, 'head.json'), '--changes', join(dir, 'changes.txt'), '--format', 'all', '--out', outDir, '--fail-on', 'any', '--gate-output'], io);
    expect(code).toBe(0);
    expect(readFileSync(join(outDir, 'report.md'), 'utf8')).toContain('<!-- isobar-pr -->');
    expect(JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')).gate).toBe('fail');
    expect(readFileSync(join(outDir, 'annotations.txt'), 'utf8')).toMatch(/^::warning file=src\/pages\/ManagerInbox.tsx,line=40/);
    expect(readFileSync(ghOut, 'utf8')).toBe(`gate=fail\nsummary=+8 cognitive across 1 changed file · 1 function crossed a limit or got slower\nreport-json=${join(outDir, 'report.json')}\n`);
  });

  test('usage errors exit 2 with a message', async () => {
    const { io, err } = fakeIo();
    expect(await main(['diff', '--base', 'x.json'], io)).toBe(2);
    expect(err.join('')).toContain('diff needs --base, --head and --changes');
    expect(await main(['diff', '--base', 'x', '--head', 'y', '--changes', 'z', '--format', 'bogus'], io)).toBe(2);
    expect(await main(['diff', '--base', 'x', '--head', 'y', '--changes', 'z', '--format', 'all'], io)).toBe(2);
  });

  test.each([
    [['--scope', 'src'], '--scope is a compare option; diff takes --base, --head and --changes'],
    [['--isobar-version', '0.7.1'], '--isobar-version is a compare option'],
    [['--head-ref', 'HEAD'], '--head-ref is a compare option'],
    [['--keep-temp'], '--keep-temp is a compare option'],
    [['extra.json'], 'diff takes no positional arguments, got: extra.json'],
  ])('diff %j exits 2 with a one-line reason and reads nothing', async (extra, message) => {
    const dir = writeFixture();
    const { io, out, err } = fakeIo();
    expect(await main(diffArgs(dir, ...extra), io)).toBe(2);
    expect(err.join('')).toContain(`isobar-pr: ${message}`);
    expect(err.join('')).not.toMatch(STACK);
    expect(out.join('')).toBe('');
  });

  test('--base-ref is shared with compare and still accepted by diff', async () => {
    const dir = writeFixture();
    const { io } = fakeIo();
    expect(await main(diffArgs(dir, '--base-ref', 'main'), io)).toBe(0);
  });

  test('a tool_version mismatch exits 3', async () => {
    const dir = writeFixture();
    writeFileSync(join(dir, 'head.json'), JSON.stringify(makeGraph({ tool_version: '0.7.0' })));
    const { io, err } = fakeIo();
    expect(await main(['diff', '--base', join(dir, 'base.json'), '--head', join(dir, 'head.json'), '--changes', join(dir, 'changes.txt')], io)).toBe(3);
    expect(err.join('')).toContain('isobar versions differ: base 0.7.1, head 0.7.0');
  });

  test('option errors name the option and the accepted values', async () => {
    const cases: Array<[string[], string]> = [
      [['--format', 'bogus'], 'isobar-pr: --format must be markdown, json, annotations or all, got "bogus"\n'],
      [['--format', 'all'], 'isobar-pr: --format all requires --out DIR\n'],
      [['--fail-on', 'sometimes'], 'isobar-pr: --fail-on must be none, serious-security, limit-crossed or any, got "sometimes"\n'],
    ];
    for (const [extra, message] of cases) {
      const { io, out, err } = fakeIo();
      expect(await main(['diff', '--base', 'x', '--head', 'y', '--changes', 'z', ...extra], io), extra.join(' ')).toBe(2);
      expect(err.join('')).toBe(message);
      expect(out.join('')).toBe('');
    }
  });

  test('a missing or unreadable input exits 2 with "cannot read <path>", no stack trace (A8)', async () => {
    const dir = writeFixture();
    const [base, head, changesFile] = ['base.json', 'head.json', 'changes.txt'].map((f) => join(dir, f)) as [string, string, string];
    const cases: Array<[string[], string]> = [
      [['diff', '--base', 'nope.json', '--head', head, '--changes', changesFile], 'isobar-pr: cannot read nope.json: ENOENT'],
      [['diff', '--base', dir, '--head', head, '--changes', changesFile], `isobar-pr: cannot read ${dir}: EISDIR`],
      [['diff', '--base', base, '--head', join(dir, 'gone.json'), '--changes', changesFile], `isobar-pr: cannot read ${join(dir, 'gone.json')}: ENOENT`],
      [['diff', '--base', base, '--head', head, '--changes', join(dir, 'gone.txt')], `isobar-pr: cannot read ${join(dir, 'gone.txt')}: ENOENT`],
      [diffArgs(dir, '--hunks', join(dir, 'gone.diff')), `isobar-pr: cannot read ${join(dir, 'gone.diff')}: ENOENT`],
    ];
    for (const [argv, message] of cases) {
      const { io, out, err } = fakeIo();
      expect(await main(argv, io), argv.join(' ')).toBe(2);
      expect(err.join('')).toContain(message);
      expect(err.join('')).not.toMatch(STACK);
      expect(out.join('')).toBe('');
    }
  });

  test('an --out that cannot be created exits 2 with "cannot write <path>"', async () => {
    const dir = writeFixture();
    const blocked = join(dir, 'changes.txt'); // a regular file, so no directory can be made there
    const { io, err } = fakeIo();
    expect(await main(diffArgs(dir, '--out', blocked), io)).toBe(2);
    expect(err.join('')).toContain(`isobar-pr: cannot write ${blocked}: `);
    expect(err.join('')).not.toMatch(STACK);
  });

  test('--changes - reads standard input', async () => {
    const dir = writeFixture();
    const { io, out } = fakeIo({}, () => `M\t${PAGE}\n`);
    const code = await main(['diff', '--base', join(dir, 'base.json'), '--head', join(dir, 'head.json'), '--changes', '-', '--format', 'json'], io);
    expect(code).toBe(0);
    const report = JSON.parse(out.join(''));
    expect(report.meta.changedFiles).toBe(1);
    expect(report.findings[0].kind).toBe('function-regression');
  });

  test('a failed read of standard input exits 2 with "cannot read stdin"', async () => {
    const dir = writeFixture();
    const stdin = () => {
      throw Object.assign(new Error('EAGAIN: resource temporarily unavailable, read'), { code: 'EAGAIN', syscall: 'read' });
    };
    const { io, err } = fakeIo({}, stdin);
    expect(await main(['diff', '--base', join(dir, 'base.json'), '--head', join(dir, 'head.json'), '--changes', '-'], io)).toBe(2);
    expect(err.join('')).toBe('isobar-pr: cannot read stdin: EAGAIN: resource temporarily unavailable, read\n');
  });

  test('--changes - with an Io that has no stdin exits 2 instead of reading fd 0; defaultIo supplies one', async () => {
    const dir = writeFixture();
    const { io, err } = fakeIo();
    expect(await main(['diff', '--base', join(dir, 'base.json'), '--head', join(dir, 'head.json'), '--changes', '-'], io)).toBe(2);
    expect(err.join('')).toBe('isobar-pr: cannot read stdin: none is available here\n');
    expect(typeof defaultIo().stdin).toBe('function');
  });

  test('an error with a code but no syscall (a Node ERR_* internal) is not a filesystem error: exit 3 with the stack', async () => {
    const dir = writeFixture();
    const internal = Object.assign(new Error('internal failure'), { code: 'ERR_X' });
    const { io, err } = fakeIo({}, () => { throw internal; });
    expect(await main(['diff', '--base', join(dir, 'base.json'), '--head', join(dir, 'head.json'), '--changes', '-'], io)).toBe(3);
    expect(err.join('')).toBe(`isobar-pr: internal failure\n${internal.stack}\n`);
    expect(() => withPath('read', 'x', () => { throw internal; })).toThrow(internal);
  });

  test('a deletion-only hunk inside a function keeps it in the diff (A14)', async () => {
    const dir = writeFixture();
    const regression = async (hunk: string): Promise<Finding | undefined> => {
      writeFileSync(join(dir, 'hunks.txt'), [...HEADER, hunk, ''].join('\n'));
      const { io, out } = fakeIo();
      expect(await main(diffArgs(dir, '--hunks', join(dir, 'hunks.txt'), '--format', 'json'), io)).toBe(0);
      return (JSON.parse(out.join('')).findings as Finding[]).find((f) => f.kind === 'function-regression');
    };
    // handleBulkEscalate spans head lines 40–82; the hunks add no line, they only delete.
    expect((await regression('@@ -60,3 +60,0 @@'))?.inDiff).toBe(true);
    expect((await regression('@@ -100,3 +99,0 @@'))?.inDiff).toBe(false);
  });

  test('--format annotations prints only annotation lines; --format json prints only the JSON', async () => {
    const dir = writeFixture();
    const a = fakeIo();
    expect(await main(diffArgs(dir, '--format', 'annotations'), a.io)).toBe(0);
    expect(a.out.join('')).toMatch(/^::warning file=src\/pages\/ManagerInbox\.tsx,line=40,title=isobar-pr::[^\n]+\n$/);
    expect(a.err.join('')).toBe('');
    const j = fakeIo();
    expect(await main(diffArgs(dir, '--format', 'json'), j.io)).toBe(0);
    expect(j.out).toHaveLength(1);
    expect(JSON.parse(j.out.join('')).findings).toHaveLength(1);
    expect(j.err.join('')).toBe('');
  });

  test('report.json carries --base-ref and both graphs\' git_sha', async () => {
    const dir = writeFixture();
    const { io, out } = fakeIo();
    expect(await main(diffArgs(dir, '--format', 'json', '--base-ref', 'main'), io)).toBe(0);
    expect(JSON.parse(out.join('')).meta).toMatchObject({ baseRef: 'main', baseSha: 'b000000', headSha: 'h000000', toolVersion: '0.7.1', truncated: false });
  });

  test('--gate-output without GITHUB_OUTPUT prints the k=v lines to stdout and still exits 0 on a failing gate', async () => {
    const dir = writeFixture();
    const outDir = join(dir, 'out');
    const { io, out } = fakeIo();
    expect(await main(diffArgs(dir, '--format', 'all', '--out', outDir, '--fail-on', 'any', '--gate-output'), io)).toBe(0);
    expect(out.join('')).toBe(`gate=fail\nsummary=+8 cognitive across 1 changed file · 1 function crossed a limit or got slower\nreport-json=${join(outDir, 'report.json')}\n`);
  });

  test('--gate-output appends to GITHUB_OUTPUT and leaves out report-json without --out', async () => {
    const dir = writeFixture();
    const ghOut = join(dir, 'gh_output');
    writeFileSync(ghOut, 'earlier=1\n');
    const { io, out } = fakeIo({ GITHUB_OUTPUT: ghOut });
    expect(await main(diffArgs(dir, '--format', 'json', '--gate-output'), io)).toBe(0);
    expect(readFileSync(ghOut, 'utf8')).toBe('earlier=1\ngate=pass\nsummary=+8 cognitive across 1 changed file · 1 function crossed a limit or got slower\n');
    expect(JSON.parse(out.join('')).gate).toBe('pass');
  });

  test('--report-uncalled-routes is a boolean flag that reaches the http rule', async () => {
    const dir = writeFixture(self, 'M\tsrc/api/orders.ts\nM\tsrc/server/routes/orders.ts\n');
    const kinds = async (...extra: string[]): Promise<string[]> => {
      const { io, out } = fakeIo();
      expect(await main(diffArgs(dir, ...extra, '--format', 'json'), io)).toBe(0);
      return (JSON.parse(out.join('')).findings as Finding[]).map((f) => f.kind);
    };
    expect(await kinds()).not.toContain('http-uncalled-route');
    expect(await kinds('--report-uncalled-routes')).toContain('http-uncalled-route');
  });

  test('a schema error exits 3 with the loader message and no stack trace', async () => {
    const dir = writeFixture();
    writeFileSync(join(dir, 'base.json'), '{ not json');
    const bad = fakeIo();
    expect(await main(diffArgs(dir), bad.io)).toBe(3);
    expect(bad.err.join('')).toContain('isobar-pr: base: not valid JSON');
    expect(bad.err.join('')).not.toMatch(STACK);

    writeFileSync(join(dir, 'base.json'), JSON.stringify(crossed.base));
    writeFileSync(join(dir, 'head.json'), JSON.stringify({ ...crossed.head, schema_version: 2 }));
    const old = fakeIo();
    expect(await main(diffArgs(dir), old.io)).toBe(3);
    expect(old.err.join('')).toBe('isobar-pr: head: expected graph.json schema_version 3, got 2\n');
    expect(old.out.join('')).toBe('');
  });

  test('--out DIR with --format markdown writes the three files and prints the markdown', async () => {
    const dir = writeFixture();
    const outDir = join(dir, 'nested', 'out');
    const { io, out } = fakeIo();
    expect(await main(diffArgs(dir, '--out', outDir), io)).toBe(0);
    const markdown = readFileSync(join(outDir, 'report.md'), 'utf8');
    expect(out.join('')).toBe(markdown);
    expect(markdown).toContain('### ⚠️ Crossed a limit or got slower');
    expect(JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')).meta.truncated).toBe(false);
    expect(readFileSync(join(outDir, 'annotations.txt'), 'utf8')).toMatch(/^::warning file=src\/pages\/ManagerInbox\.tsx,line=40,[^\n]+\n$/);
  });
});

describe('handleError', () => {
  test('a usage error exits 2; schema and version errors exit 3; each prints its message only', () => {
    const cases: Array<[Error, number]> = [
      [new UsageError('bad option'), 2],
      [new SchemaError('base: not valid JSON'), 3],
      [new VersionMismatchError('0.7.1', '0.7.0'), 3],
    ];
    for (const [e, code] of cases) {
      const { io, err } = fakeIo();
      expect(handleError(e, io), e.name).toBe(code);
      expect(err.join('')).toBe(`isobar-pr: ${e.message}\n`);
    }
  });

  test('an error with a numeric code exits with it and prints its stderr, without a stack', () => {
    const { io, err } = fakeIo();
    expect(handleError(Object.assign(new Error('isobar failed'), { code: 4, stderr: 'boom' }), io)).toBe(4);
    expect(err.join('')).toBe('isobar-pr: isobar failed\nboom\n');
  });

  test.each([0, -1, 1.5, Number.NaN])('a code of %s is not an exit code: exit 3 with the stack', (code) => {
    const e = Object.assign(new Error('odd code'), { code });
    const { io, err } = fakeIo();
    expect(handleError(e, io)).toBe(3);
    expect(err.join('')).toBe(`isobar-pr: odd code\n${e.stack}\n`);
  });

  test('anything else exits 3 and prints the stack', () => {
    const e = new TypeError('unexpected');
    const typed = fakeIo();
    expect(handleError(e, typed.io)).toBe(3);
    expect(typed.err.join('')).toBe(`isobar-pr: unexpected\n${e.stack}\n`);
    const thrown = fakeIo();
    expect(handleError('a string', thrown.io)).toBe(3);
    expect(handleError(undefined, thrown.io)).toBe(3);
    expect(thrown.err.join('')).toBe('isobar-pr: a string\nisobar-pr: undefined\n');
  });
});
