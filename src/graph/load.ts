import { readFileSync } from 'node:fs';
import type { GraphV3 } from './types.js';

export class SchemaError extends Error {
  override name = 'SchemaError';
}

export class VersionMismatchError extends Error {
  override name = 'VersionMismatchError';
  constructor(base: string, head: string) {
    super(
      `isobar versions differ: base ${base}, head ${head}. Pin one isobar version on both sides (compare: --isobar-version; diff: regenerate both graph.json files with the same isobar).`,
    );
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new SchemaError(`${label}: not valid JSON (${(e as Error).message})`);
  }
}

/** The first way `data` falls short of the graph.json fields isobar-pr relies on, or undefined when it has them all. */
function schemaProblem(data: unknown): string | undefined {
  if (!isRecord(data)) return 'graph.json is not an object';
  if (data['schema_version'] !== 3) return `expected graph.json schema_version 3, got ${JSON.stringify(data['schema_version'])}`;
  if (!isRecord(data['files'])) return 'graph.json has no "files" map';
  const toolVersion = data['tool_version'];
  if (typeof toolVersion !== 'string' || toolVersion === '') return 'graph.json has no "tool_version"';
  return undefined;
}

export function parseGraph(text: string, label: string): GraphV3 {
  const data = parseJson(text, label);
  const problem = schemaProblem(data);
  if (problem !== undefined) throw new SchemaError(`${label}: ${problem}`);
  return data as GraphV3;
}

export function loadGraph(path: string, label = path): GraphV3 {
  return parseGraph(readFileSync(path, 'utf8'), label);
}
