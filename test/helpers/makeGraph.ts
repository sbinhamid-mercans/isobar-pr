import type { Changes, Range } from '../../src/diff/changes.js';
import type { DiffOptions } from '../../src/diff/context.js';
import { diffGraphs } from '../../src/diff/index.js';
import { buildIndex } from '../../src/graph/index.js';
import type { GraphFunction, GraphV3 } from '../../src/graph/types.js';
import { DEFAULT_LIMITS } from '../../src/graph/types.js';
import type { Report } from '../../src/report/types.js';

/** A minimal valid schema-3 graph (tool 0.7.1, sha b000000, default limits, every section empty); `seed` overrides any field. */
export function makeGraph(seed: Partial<GraphV3> = {}): GraphV3 {
  return {
    schema_version: 3,
    tool_version: '0.7.1',
    git_sha: 'b000000',
    hotspots: [],
    cycles: [],
    conventions: { patterns: [] },
    security: { warnings: [] },
    http: { routes: [], matched: 0, dynamic: 0 },
    unresolved: [],
    complexity: { limits: { ...DEFAULT_LIMITS } },
    ...seed,
    files: seed.files ?? {},
  };
}

/** A graph function entry at line 1 unless overridden. */
export function fn(name: string, overrides: Partial<GraphFunction> = {}): GraphFunction {
  return { name, line: 1, ...overrides };
}

/** A change set; hunks are `[start, end]` pairs, supplying deletions without hunks still marks hunks as known (empty), and `deleted` lists base paths. */
export function changes(
  changed: string[],
  extra: {
    renames?: Record<string, string>;
    hunks?: Record<string, Array<[number, number]>>;
    deletions?: Record<string, number[]>;
    deleted?: string[];
  } = {},
): Changes {
  return {
    changed: new Set(changed),
    renames: new Map(Object.entries(extra.renames ?? {})),
    hunks: extra.hunks
      ? new Map(Object.entries(extra.hunks).map(([file, ranges]) => [file, ranges.map(([start, end]) => ({ start, end }))]))
      : extra.deletions
        ? new Map<string, Range[]>()
        : undefined,
    deletions: extra.deletions ? new Map(Object.entries(extra.deletions)) : undefined,
    deleted: extra.deleted ? new Set(extra.deleted) : undefined,
  };
}

export const DEFAULT_OPTS: Readonly<DiffOptions> = Object.freeze({
  failOn: 'none',
  reportUncalledRoutes: false,
  baseRef: 'main',
  baseSha: 'b000000',
  headSha: 'h000000',
});

export interface Fixture {
  base: GraphV3;
  head: GraphV3;
  changes: Changes;
  opts?: Partial<DiffOptions>;
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

/** Runs the fixture through buildIndex + diffGraphs on frozen clones, so mutation of inputs fails loudly. */
export function runFixture(f: Fixture): Report {
  const base = buildIndex(deepFreeze(structuredClone(f.base)));
  const head = buildIndex(deepFreeze(structuredClone(f.head)));
  return diffGraphs(base, head, f.changes, { ...DEFAULT_OPTS, ...f.opts });
}
