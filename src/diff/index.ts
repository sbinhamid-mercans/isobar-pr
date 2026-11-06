import { gate } from '../gate.js';
import type { GraphIndex } from '../graph/index.js';
import type { Finding, FindingKind, Report, ReportMeta } from '../report/types.js';
import { compareText } from '../report/text.js';
import { SEVERITY_ORDER } from '../report/types.js';
import type { Changes } from './changes.js';
import type { DiffOptions } from './context.js';
import { configFindings } from './config.js';
import { createContext } from './context.js';
import { conventionFindings } from './conventions.js';
import { cycleFindings } from './cycles.js';
import { functionFindings } from './functions.js';
import { hotspotFindings } from './hotspots.js';
import { httpFindings } from './http.js';
import { preExisting } from './preexisting.js';
import { securityFindings } from './security.js';
import { summaryRows } from './summary.js';
import { unresolvedFindings } from './unresolved.js';

/** Canonical kind order: the in-section tie-break for sorting and the order rules are reported in. Sections come from SECTION_RANK. */
export const KIND_ORDER: readonly FindingKind[] = [
  'config-changed',
  'function-regression',
  'hotspot-touched',
  'convention-broken',
  'convention-weakened',
  'security-new',
  'security-grew',
  'cycle-new',
  'cycle-grew',
  'http-unmatched-call',
  'http-uncalled-route',
  'http-info',
  'unresolved-new',
  'function-improved',
  'cycle-broken',
];

/** Comment section of each kind (several kinds share a section); the compiler enforces that every kind is ranked. */
export const SECTION_RANK: Readonly<Record<FindingKind, number>> = Object.freeze({
  'config-changed': 0,
  'function-regression': 1,
  'hotspot-touched': 2,
  'convention-broken': 3,
  'convention-weakened': 3,
  'security-new': 4,
  'security-grew': 4,
  'cycle-new': 5,
  'cycle-grew': 5,
  'http-unmatched-call': 6,
  'http-uncalled-route': 6,
  'http-info': 6,
  'unresolved-new': 7,
  'function-improved': 8,
  'cycle-broken': 8,
});

/** Section, then in-diff before out-of-diff (undefined counts as in-diff), then severity, file, line (missing = 0), kind order, title. Stable and locale-independent. */
export function sortFindings(findings: Finding[]): Finding[] {
  const key = (f: Finding): number[] => [SECTION_RANK[f.kind], f.inDiff === false ? 1 : 0, SEVERITY_ORDER[f.severity]];
  return [...findings].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return (
      compareText(a.file, b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      compareText(a.title, b.title)
    );
  });
}

/** Pure and deterministic: no clock, no randomness, inputs never mutated. */
export function diffGraphs(base: GraphIndex, head: GraphIndex, changes: Changes, opts: DiffOptions): Report {
  const ctx = createContext(base, head, changes, opts);
  const findings = sortFindings([
    ...configFindings(ctx),
    ...functionFindings(ctx),
    ...hotspotFindings(ctx),
    ...conventionFindings(ctx),
    ...securityFindings(ctx),
    ...cycleFindings(ctx),
    ...httpFindings(ctx),
    ...unresolvedFindings(ctx),
  ]);
  const analyzed = ctx.changed.filter((f) => Object.hasOwn(head.graph.files, f) || Object.hasOwn(base.graph.files, ctx.basePath(f))).length;
  return {
    meta: {
      toolVersion: head.toolVersion,
      baseSha: opts.baseSha,
      headSha: opts.headSha,
      baseRef: opts.baseRef,
      changedFiles: ctx.changed.length,
      analyzedChangedFiles: analyzed,
      httpActive: head.httpActive,
      configChanged: findings.some((f) => f.kind === 'config-changed'),
      truncated: false,
    },
    summary: summaryRows(ctx),
    findings,
    preExisting: preExisting(ctx),
    gate: gate(findings, opts.failOn),
  };
}

/** A report for a PR that changed no analyzable source; isobar never ran. */
export function emptyReport(meta: Partial<ReportMeta> & { changedFiles: number }): Report {
  return {
    meta: {
      toolVersion: '',
      baseSha: '',
      headSha: '',
      baseRef: '',
      analyzedChangedFiles: 0,
      httpActive: false,
      configChanged: false,
      truncated: false,
      ...meta,
    },
    summary: [],
    findings: [],
    preExisting: [],
    gate: 'pass',
  };
}
