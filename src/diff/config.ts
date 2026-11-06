import { code, listCapped } from '../report/text.js';
import type { Finding } from '../report/types.js';
import type { DiffContext } from './context.js';

/** File names isobar 0.7.1 reads its analysis configuration from. */
export const CONFIG_FILES: readonly string[] = ['.isobar.json', '.codemap.json', '.codegraph.json', '.codegraph.toml'];

/** Whether the path's basename is an isobar config file name, at any depth. */
export function isConfigFile(path: string): boolean {
  return CONFIG_FILES.includes(path.slice(path.lastIndexOf('/') + 1));
}

/** Config files the PR touched, by source, each list sorted. */
interface TouchedConfigs {
  /** Changed head paths with a config name. */
  named: string[];
  /** Changed head paths without a config name whose base path had one (renamed away, e.g. `.isobar.json → isobar.json.bak`). */
  renamedAway: string[];
  /** Deleted base paths with a config name. */
  deleted: string[];
}

function touchedConfigs(ctx: DiffContext): TouchedConfigs {
  return {
    named: ctx.changed.filter(isConfigFile),
    renamedAway: ctx.changed.filter((f) => !isConfigFile(f) && isConfigFile(ctx.basePath(f))),
    deleted: [...ctx.deleted].filter(isConfigFile).sort(),
  };
}

/**
 * config-changed (info): one banner when the PR changed, renamed away from or deleted an isobar config file (matched by
 * basename at any depth), since every delta may then reflect configuration rather than code.
 * - Anchor: the first config-named head path, else the first renamed-away head path, else the first deleted base path.
 *   A deleted-only anchor is not a head path, so with hunks known its file-level `inDiff` is false (undefined when hunks
 *   are unknown); the banner still sorts first by section.
 * - `data.files` lists the head paths (config-named, then renamed-away), `data.deleted` the deleted base paths (`[]` when
 *   none); the title lists both as code, deleted ones marked ` (deleted)`, in that order (so the anchor is listed
 *   first), at most three in all, then ` and N more`.
 * - `meta.configChanged` is derived from the banner's presence in index.ts.
 */
export function configFindings(ctx: DiffContext): Finding[] {
  const { named, renamedAway, deleted } = touchedConfigs(ctx);
  const file = named[0] ?? renamedAway[0] ?? deleted[0];
  if (file === undefined) return [];
  const files = [...named, ...renamedAway];
  const listed = listCapped([...files.map((f) => code(f)), ...deleted.map((f) => `${code(f)} (deleted)`)]);
  return [
    {
      kind: 'config-changed',
      severity: 'info',
      file,
      renamedFrom: ctx.renamedFrom(file),
      inDiff: ctx.inDiff(file),
      title: `Analysis config changed in this PR (${listed}); deltas may reflect configuration, not code.`,
      data: { files, deleted },
    },
  ];
}
