import { plain } from './text.js';
import type { Finding, Report, Severity } from './types.js';
import { SEVERITY_ORDER } from './types.js';

/** GitHub's annotation levels. */
type Level = 'error' | 'warning' | 'notice';

/** serious → error, high and medium → warning, low → notice; info and improved are not annotated. Total, so a new severity must be mapped. */
const LEVEL: Readonly<Record<Severity, Level | undefined>> = Object.freeze({
  serious: 'error',
  high: 'warning',
  medium: 'warning',
  low: 'notice',
  info: undefined,
  improved: undefined,
});
/** GitHub shows at most 10 annotations per level per step and silently drops the rest. */
const MAX_PER_LEVEL = 10;
/** The annotation title GitHub shows above each message. */
const ANNOTATION_TITLE = 'isobar-pr';
/** Between the title, detail and advice of one message. */
const SEP = ' — ';

/**
 * A workflow-command property value (`file=`, `title=`): `%`, CR, LF, `:` and `,` are percent-encoded, as GitHub's
 * runner decodes them; `%` goes first so the encodings are not encoded again.
 */
function escapeProperty(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** `title=` value, escaped once. */
const TITLE_PROPERTY = escapeProperty(ANNOTATION_TITLE);

/**
 * Workflow-command data (the message after `::`): `%` is encoded and every line break becomes one space. GitHub
 * would accept `%0D`/`%0A` and render a multi-line message, but multi-line annotations read poorly inline in the PR
 * diff view, so the message is kept on one line. `plain()` already collapses whitespace; flattening here as well
 * keeps a raw line break from ever ending the command early and starting a new one, whatever the caller passes.
 */
function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r\n|\r|\n/g, ' ');
}

/** Plain-text title, detail and advice joined by ` — `; a missing or empty part is left out. */
function message(f: Finding): string {
  return [f.title, f.detail, f.advice]
    .map((part) => plain(part ?? ''))
    .filter((part) => part !== '')
    .join(SEP);
}

/** The level a finding is annotated at; undefined for info/improved and for findings outside the diff. */
function levelOf(f: Finding): Level | undefined {
  return f.inDiff === false ? undefined : LEVEL[f.severity];
}

/** The head-side line to annotate, or undefined unless it is a positive integer (isobar lines start at 1; GitHub's `line=` needs one). */
function lineOf(f: Finding): number | undefined {
  const line = f.line;
  return line !== undefined && Number.isInteger(line) && line >= 1 ? line : undefined;
}

function annotation(level: Level, f: Finding, line: number): string {
  return `::${level} file=${escapeProperty(f.file)},line=${line},title=${TITLE_PROPERTY}::${escapeData(message(f))}`;
}

/**
 * Inline PR annotations as GitHub workflow-command lines, `::error|warning|notice file=…,line=…,title=isobar-pr::…`,
 * which the Action prints so the runner creates them without the Checks API.
 * - Levels: serious → `error`, high and medium → `warning`, low → `notice`; info and improved findings get none.
 * - Only findings whose head-side `line` is a positive integer are annotated. A finding with `inDiff === false` is
 *   skipped: GitHub shows annotations inline only on lines the diff displays, and elsewhere one would read as
 *   something this PR caused (the comment still reports it, marked outside the diff). `inDiff` undefined (hunks
 *   unknown) counts as in the diff. `renamedFrom` is not used; the annotation sits on the head-side `file`.
 * - At most 10 per level, GitHub's own per-step limit, so the ones kept are the most severe: findings are ordered by
 *   severity first (`Array.prototype.sort` is stable, so report order holds within a severity), and a skipped finding
 *   does not use up a slot. The output therefore lists every error, then warnings, then notices.
 * - The message is `plain()` title — detail — advice (the rules pre-escape Markdown, which annotations do not render).
 *   Properties escape `%`, CR, LF, `:` and `,`; the message escapes `%` and flattens line breaks to spaces (see
 *   `escapeData`). A `::` inside the message needs no escape: the runner splits on the first `::` after the properties.
 */
export function renderAnnotations(report: Report): string[] {
  const counts: Record<Level, number> = { error: 0, warning: 0, notice: 0 };
  const out: string[] = [];
  const bySeverity = [...report.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  for (const f of bySeverity) {
    const level = levelOf(f);
    const line = lineOf(f);
    if (level === undefined || line === undefined || counts[level] >= MAX_PER_LEVEL) continue;
    counts[level]++;
    out.push(annotation(level, f, line));
  }
  return out;
}
