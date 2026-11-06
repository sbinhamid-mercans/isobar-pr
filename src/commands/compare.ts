import type { Io, ParsedArgs } from '../cli.js';
import { compare } from '../run/compare.js';
import { DEFAULT_ISOBAR_VERSION } from '../run/isobar.js';
import { emitReport } from './emit.js';
import { UsageError, sharedOptions, str } from './options.js';

/** `diff`'s input flags, which `compare` would otherwise ignore without a word (`--head` for `--head-ref` is an easy slip). */
const DIFF_ONLY = ['base', 'head', 'changes', 'hunks'];

/**
 * `isobar-pr compare [dir] [--base-ref main] [--head-ref HEAD] [--isobar-version X.Y.Z] [--scope DIR] [--keep-temp]`:
 * runs isobar on the merge base and the head of the repository at `dir` (default `.`) and emits the report; progress
 * lines go to stderr. Returns the exit code; throws UsageError or CompareError (2), GitError and IsobarError (their
 * code), SchemaError or VersionMismatchError (3) for `handleError`.
 */
export function runCompare(args: ParsedArgs, io: Io): number {
  const o = sharedOptions(args);
  if (args.positional.length > 1) throw new UsageError(`compare takes one repository directory, got ${args.positional.length}: ${args.positional.join(' ')}`);
  const misplaced = DIFF_ONLY.find((flag) => Object.hasOwn(args.flags, flag));
  if (misplaced) throw new UsageError(`--${misplaced} is a diff option; compare takes --base-ref and --head-ref`);
  const result = compare({
    dir: args.positional[0] ?? '.',
    baseRef: str(args.flags['base-ref']) ?? 'main',
    headRef: str(args.flags['head-ref']) ?? 'HEAD',
    isobarVersion: str(args.flags['isobar-version']) ?? DEFAULT_ISOBAR_VERSION,
    scope: str(args.flags['scope']),
    failOn: o.failOn,
    reportUncalledRoutes: o.reportUncalledRoutes,
    keepTemp: args.flags['keep-temp'] === true,
    log: (line) => io.err(`${line}\n`),
  });
  return emitReport(result.report, { format: o.format, out: o.out, gateOutput: o.gateOutput, durationMs: result.durationMs }, io);
}
