import { describe, expect, test } from 'vitest';
import { main } from '../src/cli.js';

function fakeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (s: string) => { out.push(s); }, err: (s: string) => { err.push(s); }, env: {} as NodeJS.ProcessEnv },
    out,
    err,
  };
}

describe('cli smoke', () => {
  test('--version prints a version and exits 0', async () => {
    const { io, out } = fakeIo();
    expect(await main(['--version'], io)).toBe(0);
    expect(out.join('')).toMatch(/^(dev|\d+\.\d+\.\d+)\n$/);
  });

  test('--help prints usage to stdout and exits 0', async () => {
    const { io, out, err } = fakeIo();
    expect(await main(['--help'], io)).toBe(0);
    expect(out.join('')).toContain('Usage: isobar-pr');
    expect(err.join('')).toBe('');
  });

  test('no command prints usage to stderr and exits 2', async () => {
    const { io, out, err } = fakeIo();
    expect(await main([], io)).toBe(2);
    expect(err.join('')).toContain('Usage: isobar-pr');
    expect(out.join('')).toBe('');
  });

  test('an unknown command is a usage error: exit 2, named, nothing on stdout', async () => {
    const { io, out, err } = fakeIo();
    expect(await main(['frobnicate', '--format', 'json'], io)).toBe(2);
    expect(err.join('')).toBe('isobar-pr: unknown command "frobnicate"\nRun isobar-pr --help for usage.\n');
    expect(out.join('')).toBe('');
  });

  test.each([
    [['diff', '--fail-on', '--gate-output'], '--fail-on needs a value'],
    [['diff', '--gate-output=true'], '--gate-output takes no value'],
    [['compare', '-h'], 'unknown option -h'],
    [['diff', '--fail-0n', 'any'], 'unknown option --fail-0n'],
    [['compar'], 'unknown command "compar"'],
  ])('usage mistake %j exits 2 and names the problem', async (argv, message) => {
    const { io, err } = fakeIo();
    expect(await main(argv, io)).toBe(2);
    expect(err.join('')).toContain(`isobar-pr: ${message}`);
  });
});
