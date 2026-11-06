import { readFileSync } from 'node:fs';
import type { Io, ParsedArgs } from '../cli.js';
import type { Changes } from '../diff/changes.js';
import { parseChanges, parseDeletions, parseHunks } from '../diff/changes.js';
import { diffGraphs } from '../diff/index.js';
import type { GraphIndex } from '../graph/index.js';
import { buildIndex } from '../graph/index.js';
import { VersionMismatchError, loadGraph } from '../graph/load.js';
import { emitReport } from './emit.js';
import { UsageError, sharedOptions, str, withPath } from './options.js';

/** `compare`'s own flags, which `diff` would otherwise ignore without a word (`--base-ref` is shared: it labels the report). */
const COMPARE_ONLY = ['head-ref', 'isobar-version', 'scope', 'keep-temp'];

/** Rejects what `diff` would silently ignore: a positional argument (it reads only files named by flags) or a compare option. */
function rejectStrayArgs(args: ParsedArgs): void {
  if (args.positional.length > 0) throw new UsageError(`diff takes no positional arguments, got: ${args.positional.join(' ')}`);
  const misplaced = COMPARE_ONLY.find((flag) => Object.hasOwn(args.flags, flag));
  if (misplaced) throw new UsageError(`--${misplaced} is a compare option; diff takes --base, --head and --changes`);
}

function readText(path: string): string {
  return withPath('read', path, () => readFileSync(path, 'utf8'));
}

/** One side's graph, indexed. A filesystem error is a UsageError (exit 2); a SchemaError passes through (exit 3). */
function loadSide(path: string, side: 'base' | 'head'): GraphIndex {
  return buildIndex(withPath('read', path, () => loadGraph(path, side)));
}

/** The name-status text: the file, or standard input for `-` through `io.stdin` (never fd 0 directly, so a test cannot block on it). */
function readChangesText(path: string, io: Io): string {
  if (path !== '-') return readText(path);
  const { stdin } = io;
  if (!stdin) throw new UsageError('cannot read stdin: none is available here');
  return withPath('read', 'stdin', stdin);
}

/** Name-status changes, plus added ranges and deletion points (A14) from `git diff -U0` when `--hunks` is given. */
function loadChanges(changesPath: string, hunksPath: string | undefined, io: Io): Changes {
  const changes: Changes = parseChanges(readChangesText(changesPath, io));
  if (hunksPath) {
    const u0 = readText(hunksPath);
    changes.hunks = parseHunks(u0);
    changes.deletions = parseDeletions(u0);
  }
  return changes;
}

/**
 * `isobar-pr diff --base b.json --head h.json --changes <file|-> [--hunks diff.txt] [--base-ref REF]`: diffs two
 * graph.json files built by the same isobar version and emits the report. Returns the exit code; throws UsageError
 * (2), SchemaError or VersionMismatchError (3) for `handleError`.
 */
export function runDiff(args: ParsedArgs, io: Io): number {
  const o = sharedOptions(args);
  rejectStrayArgs(args);
  const basePath = str(args.flags['base']);
  const headPath = str(args.flags['head']);
  const changesPath = str(args.flags['changes']);
  if (!basePath || !headPath || !changesPath) throw new UsageError('diff needs --base, --head and --changes');

  const base = loadSide(basePath, 'base');
  const head = loadSide(headPath, 'head');
  if (base.toolVersion !== head.toolVersion) throw new VersionMismatchError(base.toolVersion, head.toolVersion);
  const changes = loadChanges(changesPath, str(args.flags['hunks']), io);

  const report = diffGraphs(base, head, changes, {
    failOn: o.failOn,
    reportUncalledRoutes: o.reportUncalledRoutes,
    baseRef: str(args.flags['base-ref']) ?? '',
    baseSha: base.graph.git_sha ?? '',
    headSha: head.graph.git_sha ?? '',
  });
  return emitReport(report, { format: o.format, out: o.out, gateOutput: o.gateOutput }, io);
}
