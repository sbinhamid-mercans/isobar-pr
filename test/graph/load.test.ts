import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { SchemaError, VersionMismatchError, loadGraph, parseGraph } from '../../src/graph/load.js';

const ok = JSON.stringify({ schema_version: 3, tool_version: '0.7.1', files: {} });

/** parseGraph must throw a SchemaError whose message matches. */
function rejects(text: string, label: string, message: RegExp): void {
  let caught: unknown;
  try {
    parseGraph(text, label);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SchemaError);
  expect((caught as Error).message).toMatch(message);
}

describe('parseGraph', () => {
  test('accepts schema 3 with files and tool_version', () => {
    const g = parseGraph(ok, 'base');
    expect(g.tool_version).toBe('0.7.1');
    expect(g.files).toEqual({});
  });

  test('rejects invalid JSON', () => {
    rejects('{', 'base', /^base: not valid JSON/);
    rejects('', 'base', /^base: not valid JSON/);
  });

  test('rejects JSON that is not an object', () => {
    rejects('null', 'x', /^x: graph.json is not an object$/);
    rejects('42', 'x', /^x: graph.json is not an object$/);
    rejects('[]', 'x', /^x: graph.json is not an object$/);
  });

  test('rejects other schema versions', () => {
    rejects(JSON.stringify({ schema_version: 2, tool_version: '0.6.0', files: {} }), 'head', /^head: expected graph.json schema_version 3, got 2$/);
    rejects(JSON.stringify({ schema_version: '3', tool_version: '0.7.1', files: {} }), 'head', /got "3"$/);
    rejects(JSON.stringify({ tool_version: '0.7.1', files: {} }), 'head', /got undefined$/);
  });

  test('rejects a missing or non-map files', () => {
    rejects(JSON.stringify({ schema_version: 3, tool_version: '0.7.1' }), 'x', /^x: graph.json has no "files" map$/);
    rejects(JSON.stringify({ schema_version: 3, tool_version: '0.7.1', files: [] }), 'x', /no "files" map$/);
    rejects(JSON.stringify({ schema_version: 3, tool_version: '0.7.1', files: null }), 'x', /no "files" map$/);
  });

  test('rejects a missing or empty tool_version', () => {
    rejects(JSON.stringify({ schema_version: 3, files: {} }), 'x', /^x: graph.json has no "tool_version"$/);
    rejects(JSON.stringify({ schema_version: 3, files: {}, tool_version: '' }), 'x', /no "tool_version"$/);
  });
});

describe('loadGraph', () => {
  test('reads a file from disk and uses the path as the default label', () => {
    const dir = mkdtempSync(join(tmpdir(), 'isobar-pr-load-'));
    try {
      const good = join(dir, 'graph.json');
      writeFileSync(good, ok);
      expect(loadGraph(good).schema_version).toBe(3);

      const bad = join(dir, 'bad.json');
      writeFileSync(bad, '{');
      expect(() => loadGraph(bad)).toThrow(SchemaError);
      expect(() => loadGraph(bad)).toThrow(bad);
      expect(() => loadGraph(bad, 'base')).toThrow(/^base: /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('VersionMismatchError', () => {
  test('names both versions', () => {
    const e = new VersionMismatchError('0.7.0', '0.7.1');
    expect(e.message).toBe(
      'isobar versions differ: base 0.7.0, head 0.7.1. Pin one isobar version on both sides (compare: --isobar-version; diff: regenerate both graph.json files with the same isobar).',
    );
    expect(e.name).toBe('VersionMismatchError');
  });
});
