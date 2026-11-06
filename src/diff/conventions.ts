import type { ConventionPattern } from '../graph/types.js';
import { code, compareText, text, textWithCode } from '../report/text.js';
import type { Finding } from '../report/types.js';
import type { DiffContext } from './context.js';

/** isobar caps `exceptions` at 50 and keeps the true total in `exceptionCount`. */
function truncated(p: ConventionPattern): boolean {
  const listed = p.exceptions?.length ?? 0;
  return (p.exceptionCount ?? listed) > listed;
}

/** The pattern's title (isobar's code spans kept) and its unit with a leading space, escaped for Markdown. */
function label(p: ConventionPattern): { title: string; unit: string } {
  return { title: textWithCode(p.title), unit: p.unit ? ` ${text(p.unit)}` : '' };
}

/**
 * How to follow the pattern. A `barrel:` pattern's example is the barrel (index file) itself, so the advice is to import
 * through it; any other example is a file that follows the pattern, to copy.
 */
function adviceFor(id: string, example: string | null | undefined): string | undefined {
  if (!example) return undefined;
  return id.startsWith('barrel:') ? `Import through ${code(example)} instead.` : `Copy ${code(example)} instead.`;
}

/**
 * Whether a new exception may be one of base's unlisted ones: base's list was cut and the file, in base path space,
 * sorts after base's last listed entry.
 */
function isAmbiguous(baseListed: readonly string[], baseCut: boolean, basePathOf: (headPath: string) => string): (file: string) => boolean {
  const lastListedBase = baseListed.at(-1);
  // With nothing listed, any exception could be an unlisted one.
  return (file) => baseCut && (lastListedBase === undefined || compareText(basePathOf(file), lastListedBase) > 0);
}

/** One convention-broken finding per new exception, in the given (sorted) order. */
function brokenFindings(ctx: DiffContext, id: string, base: ConventionPattern, head: ConventionPattern, newExceptions: readonly string[]): Finding[] {
  const { title, unit } = label(head);
  const ambiguous = isAmbiguous(base.exceptions ?? [], truncated(base), (f) => ctx.basePath(f));
  return newExceptions.map((file) => {
    const maybeOld = ambiguous(file);
    return {
      kind: 'convention-broken',
      severity: maybeOld ? 'low' : head.strength === 'rule' ? 'medium' : 'low',
      file,
      renamedFrom: ctx.renamedFrom(file),
      inDiff: ctx.inDiff(file),
      title: `**${title}** (${head.follow} of ${head.total}${unit} follow it)`,
      detail: maybeOld ? 'breaks it (may be pre-existing: isobar truncated the base exception list).' : 'breaks it.',
      advice: adviceFor(id, head.example),
      data: { patternId: id, strength: head.strength, follow: head.follow, total: head.total, example: head.example ?? null, rule: head.rule, truncated: maybeOld },
    };
  });
}

/** The convention-weakened finding for a rule that slipped to mostly, anchored to `file`. */
function weakenedFinding(ctx: DiffContext, id: string, base: ConventionPattern, head: ConventionPattern, file: string): Finding {
  const { title, unit } = label(head);
  return {
    kind: 'convention-weakened',
    severity: 'low',
    file,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.inDiff(file),
    title: `**${title}** weakened: rule → mostly (${base.follow} of ${base.total} → ${head.follow} of ${head.total}${unit})`,
    data: { patternId: id, from: 'rule', to: 'mostly', baseFollow: base.follow, baseTotal: base.total, headFollow: head.follow, headTotal: head.total },
  };
}

/** Findings for one pattern present on both sides: its new exceptions, then a rule → mostly slip. */
function patternFindings(ctx: DiffContext, id: string, base: ConventionPattern, head: ConventionPattern): Finding[] {
  // One filter + sort per pattern; filtering a sorted list keeps it sorted.
  const changedHeadExceptions = (head.exceptions ?? []).filter((f) => ctx.isChanged(f)).sort();
  const baseExceptions = new Set(base.exceptions ?? []);
  const newExceptions = changedHeadExceptions.filter((f) => !baseExceptions.has(ctx.basePath(f)));
  const out = brokenFindings(ctx, id, base, head, newExceptions);
  const anchor = newExceptions[0] ?? changedHeadExceptions[0];
  if (base.strength === 'rule' && head.strength === 'mostly' && anchor !== undefined) out.push(weakenedFinding(ctx, id, base, head, anchor));
  return out;
}

/**
 * New exceptions to a convention the codebase follows (rule ≥ 90 %, mostly 75–90 %), and conventions that
 * slipped from rule to mostly. Findings are limited to files the PR changed. A pattern absent in base is skipped
 * (the PR may have created it).
 * - New exception: listed in head, not listed in base (paths mapped through renames).
 * - Truncation: isobar lists the 50 alphabetically smallest exceptions. When base's list is truncated, a new
 *   exception that sorts after base's last listed entry may be one of base's unlisted ones: it is downgraded to
 *   low and says so. One that sorts before it is provably new. A truncated head list only hides exceptions, so it
 *   cannot create false positives and is ignored.
 * - Weakened: anchored to the first new exception when there is one, else to the first changed head exception.
 */
export function conventionFindings(ctx: DiffContext): Finding[] {
  const out: Finding[] = [];
  for (const [id, head] of ctx.head.patternsById) {
    const base = ctx.base.patternsById.get(id);
    if (base && (head.strength === 'rule' || head.strength === 'mostly')) out.push(...patternFindings(ctx, id, base, head));
  }
  return out;
}
