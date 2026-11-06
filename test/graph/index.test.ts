import { describe, expect, test } from 'vitest';
import { buildIndex, isMatchableCall, warningKey } from '../../src/graph/index.js';
import type { GraphV3 } from '../../src/graph/types.js';
import { DEFAULT_LIMITS } from '../../src/graph/types.js';

const graph: GraphV3 = {
  schema_version: 3,
  tool_version: '0.7.1',
  files: {
    'src/a.ts': {
      kind: 'component',
      imported_by: ['test/a.test.ts', 'src/b.ts'],
      functions: [
        { name: 'A', line: 1 },
        { name: 'A › useEffect callback', line: 5 },
        { name: 'A › useEffect callback', line: 9 },
      ],
      calls: [{ method: 'GET', path: '/api/x', line: 3 }],
    },
    'src/b.ts': { kind: 'hook' },
    'test/a.test.ts': { kind: 'test' },
  },
  hotspots: [{ rank: 1, file: 'src/a.ts', score: 0.5, commits: 9, cognitive: 40 }],
  cycles: [['src/a.ts', 'src/b.ts']],
  conventions: { patterns: [{ id: 'p1', strength: 'rule', follow: 10, total: 10, title: 'T', rule: 'R', exceptions: [] }] },
  security: { warnings: [{ level: 'serious', text: 'SQL concat', file: 'src/a.ts', line: 3 }] },
  http: { routes: [{ method: 'GET', path: '/api/x' }] },
  complexity: { limits: { cognitive: 20 } },
};

describe('buildIndex', () => {
  const idx = buildIndex(graph);

  test('numbers duplicate function names by ordinal in source order', () => {
    const refs = idx.functionsByFile.get('src/a.ts')!;
    expect(refs.map((r) => [r.name, r.ordinal])).toEqual([
      ['A', 0],
      ['A › useEffect callback', 0],
      ['A › useEffect callback', 1],
    ]);
  });

  test('merges limits over the defaults', () => {
    expect(idx.limits).toEqual({ cognitive: 20, cyclomatic: 10, nesting: 4, lines: 100, params: 5 });
  });

  test('indexes hotspots, patterns, warnings and cycles', () => {
    expect(idx.hotspotsByFile.get('src/a.ts')?.rank).toBe(1);
    expect(idx.patternsById.get('p1')?.title).toBe('T');
    expect(idx.warningsByKey.get(warningKey('src/a.ts', 'SQL concat'))?.level).toBe('serious');
    expect(idx.cycles).toEqual([['src/a.ts', 'src/b.ts']]);
  });

  test('counts importers whose kind is test', () => {
    expect(idx.testImportersByFile.get('src/a.ts')).toBe(1);
    expect(idx.testImportersByFile.get('src/b.ts')).toBe(0);
  });

  test('httpActive needs both routes and calls', () => {
    expect(idx.httpActive).toBe(true);
    expect(buildIndex({ ...graph, http: { routes: [] } }).httpActive).toBe(false);
    expect(buildIndex({ ...graph, files: { 'src/a.ts': {} } }).httpActive).toBe(false);
  });

  test('tolerates a graph with no optional sections', () => {
    const bare = buildIndex({ schema_version: 3, tool_version: '0.7.1', files: {} });
    expect(bare.cycles).toEqual([]);
    expect(bare.httpActive).toBe(false);
    expect(bare.limits.cognitive).toBe(15);
  });

  test('ordinals survive interleaved names and restart per file', () => {
    const g: GraphV3 = {
      schema_version: 3,
      tool_version: '0.7.1',
      files: {
        'src/x.ts': { functions: [{ name: 'A', line: 1 }, { name: 'B', line: 5 }, { name: 'A', line: 9 }] },
        'src/y.ts': { functions: [{ name: 'A', line: 1 }] },
      },
    };
    const i = buildIndex(g);
    expect(i.functionsByFile.get('src/x.ts')!.map((r) => [r.name, r.ordinal])).toEqual([['A', 0], ['B', 0], ['A', 1]]);
    expect(i.functionsByFile.get('src/y.ts')!.map((r) => [r.name, r.ordinal])).toEqual([['A', 0]]);
  });

  test('a test importer that uses the file only for types is not counted', () => {
    const files = {
      'src/a.ts': { imported_by: ['test/types.test.ts', 'test/real.test.ts'] },
      'src/b.ts': { imported_by: ['test/types.test.ts'] },
      'test/types.test.ts': { kind: 'test', type_only: ['src/a.ts'] },
      'test/real.test.ts': { kind: 'test' },
    };
    const i = buildIndex({ schema_version: 3, tool_version: '0.7.1', files });
    expect(i.testImportersByFile.get('src/a.ts')).toBe(1);
    expect(i.testImportersByFile.get('src/b.ts')).toBe(1);
  });

  test('an importer missing from the graph is not counted and does not throw', () => {
    const i = buildIndex({ schema_version: 3, tool_version: '0.7.1', files: { 'src/a.ts': { imported_by: ['gone/test.ts'] } } });
    expect(i.testImportersByFile.get('src/a.ts')).toBe(0);
  });

  test('keeps extra limit keys and leaves DEFAULT_LIMITS untouched', () => {
    const i = buildIndex({ ...graph, complexity: { limits: { cognitive: 20, custom: 7 } } });
    expect(i.limits).toEqual({ cognitive: 20, cyclomatic: 10, nesting: 4, lines: 100, params: 5, custom: 7 });
    expect(DEFAULT_LIMITS).toEqual({ cognitive: 15, cyclomatic: 10, nesting: 4, lines: 100, params: 5 });
  });

  test('tolerates null sections, as isobar writes them', () => {
    const i = buildIndex({ schema_version: 3, tool_version: '0.7.1', files: {}, hotspots: null, cycles: null, conventions: null, security: null, http: null, unresolved: null, complexity: null });
    expect(i.cycles).toEqual([]);
    expect(i.hotspotsByFile.size).toBe(0);
    expect(i.patternsById.size).toBe(0);
    expect(i.warningsByKey.size).toBe(0);
    expect(i.warningsTruncated).toBe(false);
    expect(i.httpActive).toBe(false);
    expect(i.limits.cognitive).toBe(15);
  });

  test('httpActive ignores dynamic, external and test-file calls', () => {
    const routes = [{ method: 'GET', path: '/api/x' }];
    const dynamicOnly: GraphV3 = { schema_version: 3, tool_version: '0.7.1', files: { 'src/a.ts': { calls: [{ method: 'GET', path: null, line: 1, dynamic: true }] } }, http: { routes } };
    const externalOnly: GraphV3 = { schema_version: 3, tool_version: '0.7.1', files: { 'src/a.ts': { calls: [{ method: 'GET', path: '/x', line: 1, external: 'api.example.com' }] } }, http: { routes } };
    const testOnly: GraphV3 = { schema_version: 3, tool_version: '0.7.1', files: { 'test/a.test.ts': { kind: 'test', calls: [{ method: 'GET', path: '/api/x', line: 1 }] } }, http: { routes } };
    expect(buildIndex(dynamicOnly).httpActive).toBe(false);
    expect(buildIndex(externalOnly).httpActive).toBe(false);
    expect(buildIndex(testOnly).httpActive).toBe(false);
  });

  test('isMatchableCall: static, path known, not external', () => {
    expect(isMatchableCall({ method: 'GET', path: '/api/x', line: 1 })).toBe(true);
    expect(isMatchableCall({ method: 'GET', path: '/api/x', line: 1, target: { file: 'src/s.ts', method: 'GET', path: '/api/x', line: 2 } })).toBe(true);
    expect(isMatchableCall({ method: 'GET', path: '/api/x', line: 1, dynamic: true })).toBe(false);
    expect(isMatchableCall({ method: 'GET', path: null, line: 1 })).toBe(false);
    expect(isMatchableCall({ method: 'GET', path: '/x', line: 1, external: 'api.example.com' })).toBe(false);
  });

  test('flags a truncated warning list and keeps the first hotspot for a duplicate file', () => {
    const i = buildIndex({
      ...graph,
      security: { warnings: [{ level: 'serious', text: 'SQL concat', file: 'src/a.ts', line: 3 }], warningCount: 61 },
      hotspots: [{ rank: 1, file: 'src/a.ts', score: 0.5, commits: 9, cognitive: 40 }, { rank: 2, file: 'src/a.ts', score: 0.1, commits: 1, cognitive: 1 }],
    });
    expect(i.warningsTruncated).toBe(true);
    expect(i.hotspotsByFile.get('src/a.ts')?.rank).toBe(1);
    expect(buildIndex(graph).warningsTruncated).toBe(false);
  });
});
