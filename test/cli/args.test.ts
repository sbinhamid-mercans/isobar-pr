import { describe, expect, test } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('parseArgs', () => {
  test('separates command, positionals, valued flags, boolean flags and --k=v', () => {
    expect(parseArgs(['compare', '.', '--base-ref', 'main', '--gate-output', '--format=json', '--changes', '-'])).toEqual({
      command: 'compare',
      positional: ['.'],
      flags: { 'base-ref': 'main', 'gate-output': true, format: 'json', changes: '-' },
    });
  });

  test('a valued flag at the end becomes true', () => {
    expect(parseArgs(['diff', '--out']).flags).toEqual({ out: true });
  });
});
