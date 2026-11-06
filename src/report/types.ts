export type Severity = 'serious' | 'high' | 'medium' | 'low' | 'info' | 'improved';

export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = Object.freeze({
  serious: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  improved: 5,
});

export type FindingKind =
  | 'config-changed'
  | 'function-regression'
  | 'function-improved'
  | 'hotspot-touched'
  | 'convention-broken'
  | 'convention-weakened'
  | 'security-new'
  | 'security-grew'
  | 'cycle-new'
  | 'cycle-grew'
  | 'cycle-broken'
  | 'http-unmatched-call'
  | 'http-uncalled-route'
  | 'http-info'
  | 'unresolved-new';

export type FailOn = 'none' | 'serious-security' | 'limit-crossed' | 'any';

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  /** Head-side path. */
  file: string;
  renamedFrom?: string;
  /** Head-side line. */
  line?: number;
  /** True when the PR touched the lines in question; undefined when hunks were not supplied (treated as true). */
  inDiff?: boolean;
  /** One Markdown line, without the file. */
  title: string;
  detail?: string;
  advice?: string;
  /** Kind-specific payload with stable keys; serialised into report.json. */
  data: Record<string, unknown>;
}

export type SummaryKey = 'cognitive' | 'over-limit' | 'convention-exceptions' | 'security' | 'cycles' | 'http-unmatched';

export interface SummaryRow {
  /** Stable machine key (e.g. "cognitive"); `label` is for humans. */
  key: SummaryKey;
  label: string;
  base: number | string;
  head: number | string;
  delta: string;
}

export interface PreExisting {
  file: string;
  line?: number;
  /** Markdown-ready text (already escaped with text()). */
  text: string;
}

export interface ReportMeta {
  toolVersion: string;
  baseSha: string;
  headSha: string;
  baseRef: string;
  changedFiles: number;
  analyzedChangedFiles: number;
  httpActive: boolean;
  configChanged: boolean;
  truncated: boolean;
}

export interface Report {
  meta: ReportMeta;
  summary: SummaryRow[];
  findings: Finding[];
  preExisting: PreExisting[];
  gate: 'pass' | 'fail';
}
