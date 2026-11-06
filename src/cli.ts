import { readFileSync } from 'node:fs';
import { runCompare } from './commands/compare.js';
import { runDiff } from './commands/diff.js';
import { UsageError } from './commands/options.js';
import { SchemaError, VersionMismatchError } from './graph/load.js';
import { VERSION } from './version.js';

export interface Io {
  out(s: string): void;
  err(s: string): void;
  env: NodeJS.ProcessEnv;
  /** Reads all of standard input (for `--changes -`). Optional so test doubles need not supply it; `--changes -` without it exits 2. */
  stdin?: () => string;
}

export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | true>;
}

const BOOLEAN_FLAGS = new Set(['gate-output', 'report-uncalled-routes', 'keep-temp', 'help', 'version']);
const VALUED_FLAGS = new Set(['base', 'head', 'changes', 'hunks', 'format', 'out', 'fail-on', 'base-ref', 'head-ref', 'isobar-version', 'scope']);
const COMMANDS = new Set(['diff', 'compare']);

/**
 * Records the `--flag` at `argv[i]` (`--key=value`, `--key value`, or a bare `--key` = true) and returns how many
 * arguments it used: 2 when it took the next one as its value. A boolean flag or a following `--…` never takes a value.
 */
function readFlag(argv: readonly string[], i: number, flags: ParsedArgs['flags']): number {
  const arg = argv[i]!;
  const eq = arg.indexOf('=');
  if (eq > 0) {
    flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    return 1;
  }
  const key = arg.slice(2);
  const next = argv[i + 1];
  if (next !== undefined && !next.startsWith('--') && !BOOLEAN_FLAGS.has(key)) {
    flags[key] = next;
    return 2;
  }
  flags[key] = true;
  return 1;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { command: undefined, positional: [], flags: {} };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '--') {
      parsed.positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      i += readFlag(argv, i, parsed.flags);
      continue;
    }
    if (parsed.command === undefined && COMMANDS.has(arg)) parsed.command = arg;
    else parsed.positional.push(arg);
    i++;
  }
  return parsed;
}

/** What is wrong with one parsed flag, or undefined when it is known and given (or not given) a value as it should be. */
function flagError(key: string, value: string | true): string | undefined {
  if (BOOLEAN_FLAGS.has(key)) return value === true ? undefined : `--${key} takes no value`;
  if (VALUED_FLAGS.has(key)) return value === true ? `--${key} needs a value` : undefined;
  return `unknown option --${key}`;
}

/** Usage mistakes `parseArgs` cannot reject on its own. Empty when the invocation is well-formed. */
export function usageErrors(args: ParsedArgs): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(args.flags)) {
    const error = flagError(key, value);
    if (error !== undefined) errors.push(error);
  }
  for (const p of args.positional) if (p.startsWith('-') && p !== '-') errors.push(`unknown option ${p}`);
  if (args.command === undefined && args.positional.length > 0) errors.push(`unknown command "${args.positional[0]}"`);
  return errors;
}

export const USAGE = `Usage: isobar-pr <command> [options]

Commands:
  diff      Diff two graph.json files:  --base b.json --head h.json --changes <file|-> [--hunks diff.txt] [--base-ref REF]
            (--changes = output of \`git diff --name-status -M BASE HEAD\`, "-" reads stdin; --hunks = \`git diff -U0 BASE HEAD\`;
             --base-ref only labels the report)
  compare   Run isobar on the merge base and the head, then diff:  [dir] [--base-ref main] [--head-ref HEAD]
            (dir = the repository root, default "."; --head-ref HEAD, the default, analyzes the working tree,
             uncommitted edits included; any other ref analyzes that commit)

Shared options:
  --format markdown|json|annotations|all   (default markdown; "all" needs --out)
  --out DIR                                 write report.md, summary.md, report.json, annotations.txt
  --fail-on none|serious-security|limit-crossed|any
  --gate-output                             always exit 0; append gate=, summary= (and report-json= with --out)
                                            to $GITHUB_OUTPUT, or print them when it is unset
  --report-uncalled-routes                  also report new routes with no caller in this repo

compare options:
  --isobar-version X.Y.Z   exact isobar version (default 0.7.1)
  --scope DIR              only analyze this directory of the repository
  --keep-temp              keep the temporary folder with both graph.json files (the worktrees are always removed)

Exit codes: 0 ok · 1 gate failed · 2 usage or environment (incl. unreadable input) · 3 isobar, git or graph.json failure
`;

export function defaultIo(): Io {
  return {
    out: (s) => { process.stdout.write(s); },
    err: (s) => { process.stderr.write(s); },
    env: process.env,
    stdin: () => readFileSync(0, 'utf8'),
  };
}

export async function main(argv: string[], io: Io = defaultIo()): Promise<number> {
  const args = parseArgs(argv);
  if (args.flags['version'] === true) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  if (args.flags['help'] === true) {
    io.out(USAGE);
    return 0;
  }
  const errors = usageErrors(args);
  if (errors.length > 0) {
    for (const e of errors) io.err(`isobar-pr: ${e}\n`);
    io.err('Run isobar-pr --help for usage.\n');
    return 2;
  }
  if (args.command === undefined) {
    io.err(USAGE);
    return 2;
  }
  try {
    if (args.command === 'diff') return runDiff(args, io);
    if (args.command === 'compare') return runCompare(args, io);
    io.err(USAGE); // unreachable: parseArgs only sets a command from COMMANDS
    return 2;
  } catch (e) {
    return handleError(e, io);
  }
}

/**
 * Prints a failure and returns its exit code: UsageError → 2; SchemaError and VersionMismatchError → 3; an error with
 * a positive integer `code` (CompareError, GitError, IsobarError) → that code, after its `stderr`; anything
 * else (a `code` of 0 included, which must never read as success) → 3 with its stack, since it is a bug.
 */
export function handleError(e: unknown, io: Io): number {
  const known = knownErrorCode(e);
  if (known !== undefined) {
    io.err(`isobar-pr: ${known.message}\n`);
    return known.code;
  }
  const err = (e ?? {}) as { message?: string; code?: unknown; stderr?: string; stack?: string };
  io.err(`isobar-pr: ${err.message ?? String(e)}\n`);
  if (err.stderr) io.err(withNewline(err.stderr));
  const code = exitCodeOf(err.code);
  if (code !== undefined) return code;
  if (err.stack) io.err(`${err.stack}\n`);
  return 3;
}

/** The message and exit code of an error class isobar-pr raises on purpose without a `code`: usage 2, graph.json 3. */
function knownErrorCode(e: unknown): { message: string; code: number } | undefined {
  if (e instanceof UsageError) return { message: e.message, code: 2 };
  if (e instanceof SchemaError || e instanceof VersionMismatchError) return { message: e.message, code: 3 };
  return undefined;
}

/** A positive integer exit code an error carries (CompareError, GitError, IsobarError); undefined for anything else, 0 included. */
function exitCodeOf(code: unknown): number | undefined {
  return typeof code === 'number' && Number.isInteger(code) && code > 0 ? code : undefined;
}

/** `s` with a trailing newline, added when missing. */
function withNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}
