import type { ParsedArgs } from '../cli.js';
import { isFailOn } from '../gate.js';
import type { FailOn } from '../report/types.js';

export const FORMATS = ['markdown', 'json', 'annotations', 'all'] as const;
export type Format = (typeof FORMATS)[number];

export function isFormat(v: string): v is Format {
  return (FORMATS as readonly string[]).includes(v);
}

/** A mistake in how the CLI was called, or an input or output path it cannot use; exits 2 with the message alone. */
export class UsageError extends Error {
  override name = 'UsageError';
}

export interface SharedOptions {
  format: Format;
  out: string | undefined;
  failOn: FailOn;
  gateOutput: boolean;
  reportUncalledRoutes: boolean;
}

/** A flag's string value; undefined when absent (usageErrors has already rejected a valued flag given no value). */
export function str(v: string | true | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** The options `diff` and `compare` share, validated; throws UsageError on a bad value. */
export function sharedOptions(args: ParsedArgs): SharedOptions {
  const format = str(args.flags['format']) ?? 'markdown';
  if (!isFormat(format)) throw new UsageError(`--format must be markdown, json, annotations or all, got "${format}"`);
  const out = str(args.flags['out']);
  if (format === 'all' && !out) throw new UsageError('--format all requires --out DIR');
  const failOn = str(args.flags['fail-on']) ?? 'none';
  if (!isFailOn(failOn)) throw new UsageError(`--fail-on must be none, serious-security, limit-crossed or any, got "${failOn}"`);
  return {
    format,
    out,
    failOn,
    gateOutput: args.flags['gate-output'] === true,
    reportUncalledRoutes: args.flags['report-uncalled-routes'] === true,
  };
}

/**
 * The message of a filesystem error (a string `code` such as ENOENT, EISDIR or EACCES, plus the `syscall` that failed);
 * undefined for any other value, so Node's internal `ERR_*` errors, which carry a code but no syscall, pass through.
 */
function fsErrorMessage(e: unknown): string | undefined {
  if (!(e instanceof Error)) return undefined;
  const { code, syscall } = e as NodeJS.ErrnoException;
  return typeof code === 'string' && typeof syscall === 'string' ? e.message : undefined;
}

/**
 * Runs `fn`, turning a filesystem error into `UsageError("cannot <verb> <path>: <message>")` so a missing or unusable
 * path exits 2 with one line instead of 3 with a stack trace (A8). Every other error, SchemaError included, passes through.
 */
export function withPath<T>(verb: 'read' | 'write', path: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const message = fsErrorMessage(e);
    if (message === undefined) throw e;
    throw new UsageError(`cannot ${verb} ${path}: ${message}`);
  }
}
