import { warningKey } from '../graph/index.js';
import type { SecurityWarning } from '../graph/types.js';
import { code, plural, text, textWithCode } from '../report/text.js';
import type { Finding } from '../report/types.js';
import type { DiffContext } from './context.js';

const TRUNCATED_NOTE = 'may be pre-existing: isobar truncated the base warning list';

/** Occurrence lines of a warning (isobar lists every call site in `lines`); `[line]` when `lines` is absent or empty. */
export function linesOf(w: { line: number; lines?: number[] }): number[] {
  return w.lines && w.lines.length > 0 ? w.lines : [w.line];
}

/**
 * Whether a warning missing from base's truncated list may be one isobar cut. `basePath` is the warning's file in base
 * path space (renames applied), since `listed` is base's list. isobar 0.7.1 sorts warnings by level (serious, then
 * advisory), then file with `localeCompare`, then line, and keeps the first 60. That file order depends on the locale
 * and differs from code-unit order (case, punctuation), so files are never compared here; only the list's own order is
 * used. The warning is provably new when base kept its whole (level, file) group:
 * - it is serious and base's last kept warning is advisory (every serious warning sorts first, so all were kept); or
 * - base lists a warning of the same level and file, and base's last kept warning belongs to another group (groups are
 *   contiguous, so a group followed by another kept warning is complete).
 * Lines are never compared: a cut base occurrence's line is unknown. Levels isobar 0.7.1 does not emit are never
 * provably new.
 */
function maybeCut(listed: readonly SecurityWarning[], level: string, basePath: string): boolean {
  const last = listed.at(-1);
  if (last === undefined || (level !== 'serious' && level !== 'advisory')) return true;
  if (level === 'serious' && last.level === 'advisory') return false;
  const sameGroup = (w: SecurityWarning): boolean => w.level === level && w.file === basePath;
  return sameGroup(last) || !listed.some(sameGroup);
}

/** The warning's occurrences on lines the PR added, in order. */
function addedLines(ctx: DiffContext, w: SecurityWarning): number[] {
  return linesOf(w).filter((l) => ctx.inDiff(w.file, l) === true);
}

/** File, rename and title shared by both kinds; isobar's own code spans in the text are kept. */
function shared(ctx: DiffContext, w: SecurityWarning): Pick<Finding, 'file' | 'renamedFrom' | 'title'> {
  return { file: w.file, renamedFrom: ctx.renamedFrom(w.file), title: `**${text(w.level)}** — ${textWithCode(w.text)}` };
}

/** A security-new finding; `data.lines` holds every head occurrence (the whole warning is new), per the spec. */
function newFinding(ctx: DiffContext, w: SecurityWarning, ambiguous: boolean): Finding {
  const lines = linesOf(w);
  const line = addedLines(ctx, w)[0] ?? lines[0]!;
  const snippet = code(w.code?.trim() ?? '') || undefined;
  const note = snippet ? `${TRUNCATED_NOTE} — ${snippet}` : `${TRUNCATED_NOTE}.`;
  return {
    kind: 'security-new',
    severity: !ambiguous && w.level === 'serious' ? 'serious' : 'medium',
    ...shared(ctx, w),
    line,
    inDiff: ctx.inDiff(w.file, line),
    detail: ambiguous ? note : snippet,
    data: { level: w.level, text: w.text, lines, code: w.code ?? null, truncated: ambiguous },
  };
}

/**
 * A security-grew finding, or undefined when head has no more occurrences than base. `data.lines` holds only the
 * occurrences inside the diff (head lines ∩ hunks), per the spec.
 */
function grewFinding(ctx: DiffContext, w: SecurityWarning, base: SecurityWarning): Finding | undefined {
  const lines = linesOf(w);
  const baseCount = linesOf(base).length;
  const added = lines.length - baseCount;
  if (added <= 0) return undefined;
  const inHunk = addedLines(ctx, w);
  const line = inHunk[0] ?? lines.at(-1)!;
  const at = inHunk.length > 0 ? `, at L${inHunk.join(', L')}` : '';
  return {
    kind: 'security-grew',
    severity: w.level === 'serious' ? 'serious' : 'medium',
    ...shared(ctx, w),
    line,
    inDiff: ctx.inDiff(w.file, line),
    detail: `${plural(added, 'more occurrence')} (${baseCount} → ${lines.length})${at}`,
    data: { level: w.level, text: w.text, added, lines: inHunk, code: w.code ?? null, truncated: false },
  };
}

/**
 * New security warnings and warnings with more occurrences, in changed files. Keyed by (file, text) like isobar's own
 * de-duplication, with head paths mapped to base paths through renames.
 * - security-new: the key is in head, not in base. Line = first head occurrence inside the diff, else the first one.
 * - security-grew: the key is on both sides with more occurrences in head. Line = first head occurrence inside the
 *   diff, else the last one; `data.lines` are the occurrences inside the diff.
 * - Severity: serious when isobar's level is serious, else medium.
 * - Truncation: isobar keeps 60 warnings (`security.warningCount` is the true total). When base's list is truncated, a
 *   new warning base may have cut (see `maybeCut`) is medium, says it may be pre-existing and carries
 *   `data.truncated: true`. A grown warning is listed in base, so its count is exact. A truncated head list only hides
 *   warnings, so it cannot create false positives and is ignored.
 */
export function securityFindings(ctx: DiffContext): Finding[] {
  const baseListed = ctx.base.graph.security?.warnings ?? [];
  const out: Finding[] = [];
  for (const w of ctx.head.warningsByKey.values()) {
    if (!ctx.isChanged(w.file)) continue;
    const basePath = ctx.basePath(w.file);
    const base = ctx.base.warningsByKey.get(warningKey(basePath, w.text));
    if (base === undefined) {
      out.push(newFinding(ctx, w, ctx.base.warningsTruncated && maybeCut(baseListed, w.level, basePath)));
      continue;
    }
    const grown = grewFinding(ctx, w, base);
    if (grown) out.push(grown);
  }
  return out;
}
