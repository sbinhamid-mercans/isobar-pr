import { describe, expect, test } from 'vitest';
import type { Changes } from '../../src/diff/changes.js';
import { createContext, type DiffOptions } from '../../src/diff/context.js';
import { buildIndex } from '../../src/graph/index.js';

const opts: DiffOptions = { failOn: 'none', reportUncalledRoutes: false, baseRef: 'main', baseSha: 'b', headSha: 'h' };
const empty = () => buildIndex({ schema_version: 3, tool_version: '0.7.1', files: {} });

function changes(
  changed: string[],
  extra: {
    renames?: Record<string, string>;
    hunks?: Record<string, Array<[number, number]>>;
    deletions?: Record<string, number[]>;
  } = {},
): Changes {
  return {
    changed: new Set(changed),
    renames: new Map(Object.entries(extra.renames ?? {})),
    hunks: extra.hunks
      ? new Map(Object.entries(extra.hunks).map(([f, rs]) => [f, rs.map(([start, end]) => ({ start, end }))]))
      : undefined,
    deletions: extra.deletions ? new Map(Object.entries(extra.deletions)) : undefined,
  };
}

describe('createContext', () => {
  const base = empty();
  const head = empty();

  test('maps renamed head paths to base paths and sorts changed files', () => {
    const ctx = createContext(base, head, changes(['src/z.ts', 'src/a.ts'], { renames: { 'src/a.ts': 'src/old.ts' } }), opts);
    expect(ctx.changed).toEqual(['src/a.ts', 'src/z.ts']);
    expect(ctx.basePath('src/a.ts')).toBe('src/old.ts');
    expect(ctx.basePath('src/z.ts')).toBe('src/z.ts');
    expect([ctx.renamedFrom('src/a.ts'), ctx.renamedFrom('src/z.ts')]).toEqual(['src/old.ts', undefined]);
    expect([...ctx.changedBase].sort()).toEqual(['src/old.ts', 'src/z.ts']);
    expect(ctx.isChanged('src/a.ts')).toBe(true);
    expect(ctx.isChanged('src/b.ts')).toBe(false);
  });

  test('inDiff is undefined without hunks and exact with them', () => {
    const noHunks = createContext(base, head, changes(['src/a.ts']), opts);
    expect(noHunks.inDiff('src/a.ts', 5)).toBeUndefined();
    expect(noHunks.inDiff('src/a.ts')).toBeUndefined();

    const withHunks = createContext(base, head, changes(['src/a.ts'], { hunks: { 'src/a.ts': [[10, 20]] } }), opts);
    expect(withHunks.inDiff('src/a.ts', 15)).toBe(true);
    expect(withHunks.inDiff('src/a.ts', 20)).toBe(true);
    expect(withHunks.inDiff('src/a.ts', 21)).toBe(false);
    expect(withHunks.inDiff('src/a.ts')).toBe(true);
    expect(withHunks.inDiffRange('src/a.ts', 1, 10)).toBe(true);
    expect(withHunks.inDiffRange('src/a.ts', 21, 30)).toBe(false);
    expect(withHunks.inDiffRange('src/other.ts', 1, 99)).toBe(false);
  });

  test('coversRange is undefined without hunks and true only when the hunks cover every line', () => {
    expect(createContext(base, head, changes(['src/a.ts']), opts).coversRange('src/a.ts', 1, 5)).toBeUndefined();
    const ctx = createContext(base, head, changes(['src/a.ts'], { hunks: { 'src/a.ts': [[10, 20]] } }), opts);
    expect(ctx.coversRange('src/a.ts', 10, 20)).toBe(true);
    expect(ctx.coversRange('src/a.ts', 10, 21)).toBe(false);
    expect(ctx.coversRange('src/other.ts', 10, 20)).toBe(false);
  });

  test('deletions count for ranges but not single lines; untouched files are false once hunks are known', () => {
    const ctx = createContext(base, head, changes(['src/a.ts'], { hunks: { 'src/a.ts': [] }, deletions: { 'src/a.ts': [11] } }), opts);
    expect(ctx.inDiffRange('src/a.ts', 5, 30)).toBe(true);
    expect(ctx.inDiffRange('src/a.ts', 1, 11)).toBe(false);
    expect(ctx.inDiffRange('src/a.ts', 12, 30)).toBe(false);
    expect(ctx.inDiff('src/a.ts', 11)).toBe(false);
    expect(ctx.inDiff('src/a.ts')).toBe(true);
    expect(ctx.inDiff('src/other.ts')).toBe(false);
  });
});
