import type { Unresolved } from '../graph/types.js';
import { code, text } from '../report/text.js';
import type { Finding } from '../report/types.js';
import type { DiffContext } from './context.js';

/** A specifier with a URL scheme (`https://…`, e.g. a Google Fonts `@import` in CSS) is remote by design, not broken. */
const REMOTE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** What an entry failed to resolve: its identity within the file and its title label. */
interface Target {
  /** `s:SPEC` or `e:EXPR`; the prefix keeps a spec from colliding with an expr of the same text. */
  id: string;
  label: string;
}

/** The entry's target, or undefined when it has neither a spec nor an expr, or its spec is a remote URL. */
function target(u: Unresolved): Target | undefined {
  if (u.spec) return REMOTE.test(u.spec) ? undefined : { id: `s:${u.spec}`, label: `import ${code(u.spec)}` };
  if (u.expr) return { id: `e:${u.expr}`, label: `computed import ${code(u.expr)}` };
  return undefined;
}

/** Identity of an entry: its file and target id. NUL never appears in a path, so the key is unambiguous. */
const unresolvedKey = (file: string, t: Target): string => `${file}\u0000${t.id}`;

/** Keys of base's reportable entries, in base path space. */
function baseKeys(ctx: DiffContext): Set<string> {
  const keys = new Set<string>();
  for (const u of ctx.base.graph.unresolved ?? []) {
    const t = target(u);
    if (t) keys.add(unresolvedKey(u.file, t));
  }
  return keys;
}

/** The finding for one new head entry. */
function newFinding(ctx: DiffContext, u: Unresolved, t: Target): Finding {
  return {
    kind: 'unresolved-new',
    severity: 'low',
    file: u.file,
    line: u.line,
    renamedFrom: ctx.renamedFrom(u.file),
    inDiff: ctx.inDiff(u.file, u.line),
    title: `${t.label} could not be resolved${u.reason ? ` (${text(u.reason)})` : ''}`,
    data: { spec: u.spec ?? null, expr: u.expr ?? null, reason: u.reason ?? null },
  };
}

/**
 * unresolved-new (low): an import isobar could not resolve that the PR introduced. isobar writes two shapes: a literal
 * `spec` (reason `not found`) and the source `expr` of a computed import (reason `computed path`).
 * - Reported: a head entry in a changed file whose `(file, spec)` or `(file, expr)` key is absent in base, the head
 *   path mapped through renames. The line is ignored, so an entry that only moved is not new; each new entry is its
 *   own finding, anchored on its line.
 * - Skipped: an entry with neither spec nor expr, and a spec with a URL scheme (remote by design).
 * - Asymmetric by design, like the HTTP rule: an import that became resolvable is not reported.
 * - Title: ``import `SPEC` `` or ``computed import `EXPR` `` as code, then isobar's reason as escaped text; `data`
 *   keeps all three raw, null when absent.
 */
export function unresolvedFindings(ctx: DiffContext): Finding[] {
  const known = baseKeys(ctx);
  const out: Finding[] = [];
  for (const u of ctx.head.graph.unresolved ?? []) {
    const t = target(u);
    if (t && ctx.isChanged(u.file) && !known.has(unresolvedKey(ctx.basePath(u.file), t))) out.push(newFinding(ctx, u, t));
  }
  return out;
}
