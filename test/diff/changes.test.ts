import { describe, expect, test } from 'vitest';
import {
  covers,
  filterChanges,
  normalizeScope,
  overlaps,
  parseChanges,
  parseDeletions,
  parseHunks,
  unquotePath,
} from '../../src/diff/changes.js';

describe('parseChanges', () => {
  test('reads added, modified, renamed and copied paths; deletions go to deleted, not changed', () => {
    const text = [
      'M\tsrc/a.ts',
      'A\tsrc/new.ts',
      'D\tsrc/gone.ts',
      'R100\tsrc/old.ts\tsrc/renamed.ts',
      'C85\tsrc/a.ts\tsrc/copy.ts',
      'T\tsrc/link.ts',
      '',
    ].join('\n');
    const c = parseChanges(text);
    expect([...c.changed].sort()).toEqual(['src/a.ts', 'src/copy.ts', 'src/link.ts', 'src/new.ts', 'src/renamed.ts']);
    expect([...c.renames]).toEqual([['src/renamed.ts', 'src/old.ts']]);
    expect([...c.deleted]).toEqual(['src/gone.ts']);
    expect(c.hunks).toBeUndefined();
  });

  test('deleted is always present, possibly empty; a D row without a path is skipped', () => {
    expect([...parseChanges('M\tsrc/a.ts\n').deleted]).toEqual([]);
    expect([...parseChanges('D\n').deleted]).toEqual([]);
  });

  test('tolerates CRLF and blank lines', () => {
    const c = parseChanges('M\tsrc/a.ts\r\n\r\n');
    expect([...c.changed]).toEqual(['src/a.ts']);
  });

  test('unquotes C-quoted paths', () => {
    const c = parseChanges('M\t"src/caf\\303\\251.ts"\nR100\t"old \\"q\\".ts"\tsrc/plain.ts\nD\t"gone \\"q\\".ts"\n');
    expect([...c.changed].sort()).toEqual(['src/café.ts', 'src/plain.ts']);
    expect(c.renames.get('src/plain.ts')).toBe('old "q".ts');
    expect([...c.deleted]).toEqual(['gone "q".ts']);
  });
});

describe('parseHunks', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,0 +11,3 @@ function x() {',
    '+a',
    '+b',
    '+c',
    '@@ -40 +44 @@',
    '-old',
    '+new',
    '@@ -50,2 +55,0 @@',
    '-gone',
    '-gone',
    'diff --git a/src/gone.ts b/src/gone.ts',
    'deleted file mode 100644',
    '--- a/src/gone.ts',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    '-x',
    '',
  ].join('\n');

  test('collects added-side line ranges per file and ignores pure deletions', () => {
    const h = parseHunks(diff);
    expect(h.get('src/a.ts')).toEqual([
      { start: 11, end: 13 },
      { start: 44, end: 44 },
    ]);
    expect(h.has('src/gone.ts')).toBe(false);
  });

  test('parseDeletions records where lines were removed', () => {
    expect([...parseDeletions(diff)]).toEqual([['src/a.ts', [55]]]);
  });

  test('handles a trailing tab for paths with spaces, quoted paths, and content lines that look like headers', () => {
    const text = [
      'diff --git a/foo bar.ts b/foo bar.ts',
      '--- a/foo bar.ts\t',
      '+++ b/foo bar.ts\t',
      '@@ -1,0 +2,2 @@',
      '+x',
      '+++ not a header',
      '@@ -9,0 +10 @@',
      '+y',
      'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
      '--- "a/caf\\303\\251.ts"',
      '+++ "b/caf\\303\\251.ts"',
      '@@ -0,0 +1 @@',
      '+z',
      '',
    ].join('\n');
    const h = parseHunks(text);
    expect(h.get('foo bar.ts')).toEqual([{ start: 2, end: 3 }, { start: 10, end: 10 }]);
    expect(h.get('café.ts')).toEqual([{ start: 1, end: 1 }]);
    expect(h.size).toBe(2);
  });

  test('a removed "-- " line followed by an added "++ " line is body, not a header', () => {
    const text = [
      'diff --git a/q.sql b/q.sql',
      '--- a/q.sql',
      '+++ b/q.sql',
      '@@ -1 +1 @@',
      '--- old comment',
      '+++ new comment',
      '@@ -3,0 +4 @@',
      '+select 1;',
      '',
    ].join('\n');
    const h = parseHunks(text);
    expect([...h.entries()]).toEqual([['q.sql', [{ start: 1, end: 1 }, { start: 4, end: 4 }]]]);
  });
});

describe('overlaps', () => {
  test('overlaps checks a range against hunks', () => {
    const ranges = [{ start: 11, end: 13 }, { start: 44, end: 44 }];
    expect(overlaps(ranges, 1, 10)).toBe(false);
    expect(overlaps(ranges, 13, 20)).toBe(true);
    expect(overlaps(ranges, 44, 44)).toBe(true);
    expect(overlaps(undefined, 1, 1)).toBe(false);
  });
});

describe('covers', () => {
  test('true only when every line of the range lies inside the ranges, adjacent ranges joining', () => {
    const ranges = [{ start: 10, end: 20 }, { start: 21, end: 30 }, { start: 40, end: 50 }];
    expect(covers(ranges, 10, 30)).toBe(true);
    expect(covers(ranges, 15, 15)).toBe(true);
    expect(covers(ranges, 25, 41)).toBe(false);
    expect(covers(ranges, 9, 12)).toBe(false);
    expect(covers(ranges, 45, 51)).toBe(false);
    expect(covers([{ start: 40, end: 50 }, { start: 5, end: 39 }], 5, 50)).toBe(true);
    expect(covers([], 1, 1)).toBe(false);
    expect(covers(undefined, 1, 1)).toBe(false);
  });
});

describe('unquotePath', () => {
  test('decodes octal UTF-8 and simple escapes; leaves plain paths alone', () => {
    expect(unquotePath('"src/caf\\303\\251.ts"')).toBe('src/café.ts');
    expect(unquotePath('"a\\tb\\"c\\\\d"')).toBe('a\tb"c\\d');
    expect(unquotePath('src/a.ts')).toBe('src/a.ts');
    expect(unquotePath('"')).toBe('"');
    expect(unquotePath('"ab\\"')).toBe('ab\\');
    expect(unquotePath('"\\é"')).toBe('é');
  });
});

describe('normalizeScope', () => {
  test('strips ./ and trailing slashes; ".", "./" and empty mean no scope', () => {
    expect(normalizeScope('./x/')).toBe('x');
    expect(normalizeScope('x//')).toBe('x');
    expect(normalizeScope('packages/api')).toBe('packages/api');
    expect(normalizeScope('')).toBeUndefined();
    expect(normalizeScope(undefined)).toBeUndefined();
    expect(normalizeScope('.')).toBeUndefined();
    expect(normalizeScope('./')).toBeUndefined();
  });
});

describe('filterChanges', () => {
  test('keeps only paths under the scope', () => {
    const c = parseChanges('M\tpackages/api/a.ts\nM\tpackages/web/b.ts\nR100\tpackages/api/o.ts\tpackages/api/n.ts\nD\tpackages/api/gone.ts\nD\tpackages/web/gone.ts\n');
    c.hunks = new Map([['packages/api/a.ts', [{ start: 1, end: 1 }]], ['packages/web/b.ts', [{ start: 1, end: 1 }]]]);
    c.deletions = new Map([['packages/api/a.ts', [3]], ['packages/web/b.ts', [4]]]);
    const f = filterChanges(c, 'packages/api/');
    expect([...f.changed].sort()).toEqual(['packages/api/a.ts', 'packages/api/n.ts']);
    expect([...f.renames]).toEqual([['packages/api/n.ts', 'packages/api/o.ts']]);
    expect([...f.hunks!.keys()]).toEqual(['packages/api/a.ts']);
    expect([...f.deletions!]).toEqual([['packages/api/a.ts', [3]]]);
    expect([...f.deleted!]).toEqual(['packages/api/gone.ts']);
  });

  test('repo-root config files survive any scope, changed or deleted; nested ones outside the scope do not', () => {
    const c = parseChanges('M\t.isobar.json\nM\tpackages/api/a.ts\nM\tsrc/b.ts\nM\tsrc/.isobar.json\nD\t.codegraph.toml\nD\tsrc/c.ts\n');
    const f = filterChanges(c, 'packages/api');
    expect([...f.changed].sort()).toEqual(['.isobar.json', 'packages/api/a.ts']);
    expect([...f.deleted!]).toEqual(['.codegraph.toml']);
  });

  test('a root config renamed, or renamed away from its name, survives the scope with its rename', () => {
    const c = parseChanges('R100\t.codegraph.json\t.isobar.json\nR100\t.codemap.json\tnotes/codemap.bak\nR100\tsrc/o.ts\tsrc/n.ts\n');
    const f = filterChanges(c, 'packages/api');
    expect([...f.changed].sort()).toEqual(['.isobar.json', 'notes/codemap.bak']);
    expect([...f.renames].sort()).toEqual([
      ['.isobar.json', '.codegraph.json'],
      ['notes/codemap.bak', '.codemap.json'],
    ]);
  });

  test('a scoped filter leaves an unsupplied deleted set undefined', () => {
    expect(filterChanges({ changed: new Set(['packages/api/a.ts']), renames: new Map() }, 'packages/api').deleted).toBeUndefined();
  });

  test('is a no-op without a scope', () => {
    const c = parseChanges('M\ta.ts\n');
    expect(filterChanges(c)).toBe(c);
  });

  test('normalises the scope and treats "." as no scope', () => {
    const c = parseChanges('M\tpackages/api/a.ts\nM\tpackages/web/b.ts\n');
    expect([...filterChanges(c, './packages/api').changed]).toEqual(['packages/api/a.ts']);
    expect(filterChanges(c, './packages/api').deletions).toBeUndefined();
    expect(filterChanges(c, '.')).toBe(c);
    expect(filterChanges(c, './')).toBe(c);
  });
});
