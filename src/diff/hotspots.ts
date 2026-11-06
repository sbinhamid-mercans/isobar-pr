import type { Finding } from '../report/types.js';
import type { DiffContext } from './context.js';

/**
 * A changed file that is one of the base graph's hotspots (complexity × churn).
 * - Base list only: isobar anchors its churn window to each side's latest commit, so head ranks drift with every push.
 * - Pure moves are skipped: when hunks are known and the file has no added lines and no deletion points (an R100
 *   rename), the PR did not touch its contents. Deletion point 0 (lines deleted at the top of the file) counts.
 * - Tests the PR adds are credited: the importer count is the higher of base (via the rename map) and head.
 */
export function hotspotFindings(ctx: DiffContext): Finding[] {
  const out: Finding[] = [];
  for (const file of ctx.changed) {
    const basePath = ctx.basePath(file);
    const h = ctx.base.hotspotsByFile.get(basePath);
    if (!h) continue;
    if (ctx.changes.hunks && ctx.inDiffRange(file, 0, Number.MAX_SAFE_INTEGER) !== true) continue;
    const tests = Math.max(ctx.base.testImportersByFile.get(basePath) ?? 0, ctx.head.testImportersByFile.get(file) ?? 0);
    out.push({
      kind: 'hotspot-touched',
      severity: tests > 0 ? 'low' : 'medium',
      file,
      renamedFrom: ctx.renamedFrom(file),
      inDiff: ctx.inDiff(file),
      title: `base hotspot rank **${h.rank}** (${h.commits} commit${h.commits === 1 ? '' : 's'}, total cognitive ${h.cognitive}), imported by ${tests} test${tests === 1 ? '' : 's'}`,
      advice: 'Keep changes small and tested.',
      data: { rank: h.rank, score: h.score, commits: h.commits, cognitive: h.cognitive, testImporters: tests },
    });
  }
  return out;
}
