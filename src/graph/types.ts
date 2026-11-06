export interface TimeWhy {
  line: number;
  text: string;
}

export interface RefactorIssue {
  kind: string;
  severity: string;
  title: string;
  line?: number;
  lines?: number[];
  how?: string;
  why?: string;
}

export interface GraphFunction {
  name: string;
  line: number;
  end_line?: number;
  lines?: number;
  params?: number;
  cyclomatic?: number;
  cognitive?: number;
  nesting?: number;
  /** Names of the limits this function exceeds: "cognitive", "cyclomatic", "nesting", "lines", "params". */
  over?: string[];
  time?: string;
  time_why?: TimeWhy[];
  refactor?: RefactorIssue[];
}

/** The route that answers a call, as isobar resolves it. */
export interface HttpTarget {
  file: string;
  method: string;
  path: string;
  line: number;
}

/** A client call site that reaches a route. */
export interface HttpCaller {
  file: string;
  line: number;
  method?: string;
  path?: string;
}

export interface HttpCall {
  method: string;
  path: string | null;
  line: number;
  dynamic?: boolean;
  /** Present when a route in this repo answers the call. */
  target?: HttpTarget;
  /** Host name when the call goes to another service. */
  external?: string;
  /** Local host of an absolute URL; absent when `external` is set. */
  host?: string;
}

export interface HttpRoute {
  method: string;
  path: string;
  line: number;
  callers?: HttpCaller[];
  tests?: unknown[];
}

export interface FileComplexity {
  cognitive?: number;
  functions?: number;
  flagged?: number;
  max_cognitive?: number;
}

export interface GraphFile {
  kind?: string;
  language?: string;
  loc?: number;
  imports?: string[];
  imported_by?: string[];
  /** Imports this file uses only for types (isobar lists them per importer). */
  type_only?: string[];
  complexity?: FileComplexity;
  functions?: GraphFunction[];
  hotspot?: { score?: number; rank?: number | null };
  cycle?: number;
  calls?: HttpCall[];
  serves?: HttpRoute[];
}

export interface ConventionPattern {
  id: string;
  category?: string;
  strength: string;
  follow: number;
  total: number;
  unit?: string;
  title: string;
  rule: string;
  example?: string | null;
  exceptions?: string[];
  exceptionCount?: number;
}

export interface SecurityWarning {
  level: string;
  text: string;
  file: string;
  line: number;
  lines?: number[];
  code?: string;
}

export interface Hotspot {
  rank: number;
  file: string;
  score: number;
  commits: number;
  authors?: number;
  cognitive: number;
  max_cognitive?: number;
}

/**
 * An import isobar could not resolve. Exactly one of `spec` / `expr` is present: `spec` for a literal specifier
 * (reason `not found`), `expr` for the source of a computed one such as ``import(`./pages/${name}`)`` (reason
 * `computed path`).
 */
export interface Unresolved {
  file: string;
  line: number;
  spec?: string;
  expr?: string;
  /** `not found` or `computed path` in isobar 0.7.1. */
  reason?: string;
}

export interface GraphV3 {
  schema_version: 3;
  tool_version: string;
  git_sha?: string;
  name?: string;
  files: Record<string, GraphFile>;
  hotspots?: Hotspot[] | null;
  cycles?: string[][] | null;
  conventions?: { patterns?: ConventionPattern[] | null } | null;
  security?: { warnings?: SecurityWarning[] | null; warningCount?: number } | null;
  http?: { routes?: unknown[] | null; matched?: number; dynamic?: number; external?: number } | null;
  unresolved?: Unresolved[] | null;
  complexity?: { limits?: Record<string, number> | null } | null;
}

export const DEFAULT_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  cognitive: 15,
  cyclomatic: 10,
  nesting: 4,
  lines: 100,
  params: 5,
});
