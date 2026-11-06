import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Io } from '../cli.js';
import { renderAnnotations } from '../report/annotations.js';
import { toJson } from '../report/json.js';
import { headline, renderMarkdown, truncateComment } from '../report/markdown.js';
import type { Report } from '../report/types.js';
import type { Format } from './options.js';
import { withPath } from './options.js';

export interface EmitOptions {
  format: Format;
  out: string | undefined;
  gateOutput: boolean;
  /** Run time for the comment footer (compare passes it; diff does not). */
  durationMs?: number;
}

/** The renderings of one report, as written to `--out` and printed per `--format`. */
interface Rendered {
  /** The comment body, cut to COMMENT_LIMIT. */
  markdown: string;
  /** The same Markdown uncut, for the job summary (GitHub allows 1 MiB there). */
  summary: string;
  json: string;
  annotations: string;
}

/**
 * Renders the Markdown, keeps it whole for the job summary and cuts a copy to the comment limit, then renders the JSON
 * and annotations. When the comment was cut, the JSON is rendered from a copy with `meta.truncated` set, so report.json
 * records it; the caller's report is not mutated.
 */
function render(report: Report, durationMs: number | undefined): Rendered {
  const full = renderMarkdown(report, { durationMs });
  const comment = truncateComment(full);
  const final = comment.truncated ? { ...report, meta: { ...report.meta, truncated: true } } : report;
  const lines = renderAnnotations(final);
  return { markdown: comment.text, summary: full, json: toJson(final), annotations: lines.length ? `${lines.join('\n')}\n` : '' };
}

/** What `--format` prints on stdout; `all` prints nothing (it writes the files). */
const STDOUT: Readonly<Record<Format, (r: Rendered) => string>> = {
  markdown: (r) => r.markdown,
  json: (r) => r.json,
  annotations: (r) => r.annotations,
  all: () => '',
};

function writeFiles(dir: string, r: Rendered): void {
  withPath('write', dir, () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.md'), r.markdown);
    writeFileSync(join(dir, 'summary.md'), r.summary);
    writeFileSync(join(dir, 'report.json'), r.json);
    writeFileSync(join(dir, 'annotations.txt'), r.annotations);
  });
}

/** `gate=`, `summary=` and, with `--out`, `report-json=` lines; values are kept to one line, as $GITHUB_OUTPUT requires. */
function gateOutputLines(report: Report, out: string | undefined): string {
  const summary = headline(report).replace(/\s*[\r\n]+\s*/g, ' ');
  return `gate=${report.gate}\nsummary=${summary}\n${out ? `report-json=${join(out, 'report.json')}\n` : ''}`;
}

/** Appends the gate lines to $GITHUB_OUTPUT, or prints them on stdout when it is unset (a local run). */
function writeGateOutput(report: Report, out: string | undefined, io: Io): void {
  const lines = gateOutputLines(report, out);
  const target = io.env['GITHUB_OUTPUT'];
  if (target) withPath('write', target, () => appendFileSync(target, lines));
  else io.out(lines);
}

/**
 * Writes the report in the requested formats and returns the process exit code.
 * - `--out DIR` (created if missing) always gets report.md, summary.md, report.json and annotations.txt, whatever
 *   `--format` says. report.md is the comment body, cut to COMMENT_LIMIT with a note pointing at the job summary;
 *   summary.md is the same Markdown never cut, for `$GITHUB_STEP_SUMMARY`. The two are identical when nothing was cut.
 * - stdout gets the one rendering `--format` names (nothing for `all`).
 * - `--gate-output` writes the gate lines and exits 0, so a workflow can post the comment before failing the job;
 *   otherwise a failed gate exits 1.
 */
export function emitReport(report: Report, o: EmitOptions, io: Io): number {
  const rendered = render(report, o.durationMs);
  if (o.out) writeFiles(o.out, rendered);
  const text = STDOUT[o.format](rendered);
  if (text) io.out(text);
  if (o.gateOutput) {
    writeGateOutput(report, o.out, io);
    return 0;
  }
  return report.gate === 'fail' ? 1 : 0;
}
