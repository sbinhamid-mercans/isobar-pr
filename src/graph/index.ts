import type { ConventionPattern, GraphFunction, GraphV3, Hotspot, HttpCall, SecurityWarning } from './types.js';
import { DEFAULT_LIMITS } from './types.js';

export interface FunctionRef {
  file: string;
  name: string;
  /** 0-based position among the functions isobar emitted with the same name in the same file, in source order. isobar omits trivial functions (within every limit, no issues), so ordinals count emitted functions only. */
  ordinal: number;
  fn: GraphFunction;
}

export interface GraphIndex {
  graph: GraphV3;
  toolVersion: string;
  limits: Record<string, number>;
  functionsByFile: Map<string, FunctionRef[]>;
  hotspotsByFile: Map<string, Hotspot>;
  patternsById: Map<string, ConventionPattern>;
  warningsByKey: Map<string, SecurityWarning>;
  /** True when isobar capped security.warnings (warningCount > warnings.length): per-warning deltas are unreliable. */
  warningsTruncated: boolean;
  cycles: string[][];
  testImportersByFile: Map<string, number>;
  /** True when the repo serves routes and at least one static, non-external call sits in a non-test file, i.e. calls can be matched within it. */
  httpActive: boolean;
}

/** A call a route in this repo could answer: static (not dynamic, path known) and not aimed at another host. Calls in test files never count (callers check the file's kind). */
export function isMatchableCall(c: HttpCall): boolean {
  return !c.dynamic && c.path != null && !c.external;
}

/** NUL never appears in a path; the key mirrors isobar's own de-duplication of warnings on (file, text). */
export function warningKey(file: string, text: string): string {
  return `${file}\u0000${text}`;
}

/** A file's functions as refs, each with its ordinal among same-name functions, in source order. */
function functionRefs(file: string, functions: readonly GraphFunction[]): FunctionRef[] {
  const nextOrdinal = new Map<string, number>();
  return functions.map((fn) => {
    const ordinal = nextOrdinal.get(fn.name) ?? 0;
    nextOrdinal.set(fn.name, ordinal + 1);
    return { file, name: fn.name, ordinal, fn };
  });
}

/** Every test file, with the set of files it imports only for their types. Built once, so per-file counts are lookups. */
function testFiles(files: GraphV3['files']): Map<string, ReadonlySet<string>> {
  const tests = new Map<string, ReadonlySet<string>>();
  for (const [path, entry] of Object.entries(files)) {
    if (entry.kind === 'test') tests.set(path, new Set(entry.type_only ?? []));
  }
  return tests;
}

/** How many of `importers` are test files that exercise `file`: a test that imports it only for its types does not. */
function testImporterCount(file: string, importers: readonly string[], tests: ReadonlyMap<string, ReadonlySet<string>>): number {
  let count = 0;
  for (const p of importers) {
    const typeOnly = tests.get(p);
    if (typeOnly !== undefined && !typeOnly.has(file)) count++;
  }
  return count;
}

/** True when a non-test file makes a call a route in this repo could answer. */
function hasMatchableCall(files: GraphV3['files']): boolean {
  return Object.values(files).some((entry) => entry.kind !== 'test' && (entry.calls ?? []).some(isMatchableCall));
}

/** The first hotspot listed for each file. */
function hotspotIndex(hotspots: readonly Hotspot[]): Map<string, Hotspot> {
  const byFile = new Map<string, Hotspot>();
  for (const h of hotspots) {
    if (!byFile.has(h.file)) byFile.set(h.file, h);
  }
  return byFile;
}

/** Warnings keyed by (file, text), and whether isobar capped the list (warningCount > warnings.length). */
function warningIndex(graph: GraphV3): Pick<GraphIndex, 'warningsByKey' | 'warningsTruncated'> {
  const warnings = graph.security?.warnings ?? [];
  return {
    warningsByKey: new Map(warnings.map((w) => [warningKey(w.file, w.text), w] as const)),
    warningsTruncated: (graph.security?.warningCount ?? warnings.length) > warnings.length,
  };
}

/** Per file: its functions as refs, and how many test files exercise it. */
function fileIndex(files: GraphV3['files']): Pick<GraphIndex, 'functionsByFile' | 'testImportersByFile'> {
  const functionsByFile = new Map<string, FunctionRef[]>();
  const testImportersByFile = new Map<string, number>();
  const tests = testFiles(files);
  for (const [file, entry] of Object.entries(files)) {
    functionsByFile.set(file, functionRefs(file, entry.functions ?? []));
    testImportersByFile.set(file, testImporterCount(file, entry.imported_by ?? [], tests));
  }
  return { functionsByFile, testImportersByFile };
}

/** The repo serves routes and a non-test file makes a call one of them could answer: calls can be matched within it. */
function isHttpActive(graph: GraphV3): boolean {
  return (graph.http?.routes?.length ?? 0) > 0 && hasMatchableCall(graph.files);
}

export function buildIndex(graph: GraphV3): GraphIndex {
  const { functionsByFile, testImportersByFile } = fileIndex(graph.files);
  return {
    graph,
    toolVersion: graph.tool_version,
    limits: { ...DEFAULT_LIMITS, ...(graph.complexity?.limits ?? {}) },
    functionsByFile,
    hotspotsByFile: hotspotIndex(graph.hotspots ?? []),
    patternsById: new Map((graph.conventions?.patterns ?? []).map((p) => [p.id, p] as const)),
    ...warningIndex(graph),
    cycles: graph.cycles ?? [],
    testImportersByFile,
    httpActive: isHttpActive(graph),
  };
}
