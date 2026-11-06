import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { USAGE } from '../src/cli.js';
import { FAIL_ON_VALUES } from '../src/gate.js';
import { MARKER } from '../src/report/markdown.js';
import { DEFAULT_ISOBAR_VERSION } from '../src/run/isobar.js';

// action.yml and README.md are read as text. A small line-based walker covers the block-style YAML action.yml uses
// (one key per line, `- ` list items, `|` blocks) without a YAML dependency and without relying on key order or a
// fixed indent; CI's YAML check (js-yaml) is a separate manual step.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const action = readFileSync(join(root, 'action.yml'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const lines = action.split('\n');

const indent = (line: string): number => line.length - line.trimStart().length;
const blank = (line: string): boolean => line.trim() === '' || line.trim().startsWith('#');

/** The lines nested under the first line equal to `header` (after trimming), up to the next line at its indent or less. */
function block(from: readonly string[], header: string): string[] {
  const start = from.findIndex((l) => l.trim() === header);
  if (start < 0) throw new Error(`no "${header}" in action.yml`);
  const level = indent(from[start]!);
  const body: string[] = [];
  for (const line of from.slice(start + 1)) {
    if (!blank(line) && indent(line) <= level) break;
    body.push(line);
  }
  return body;
}

/**
 * A YAML mapping in block style, one level deep: each key at the shallowest indent maps to its inline value, or, for a
 * `|` block or a nested mapping, to the nested lines with that key's child indent removed. Quotes are kept.
 */
function mapping(body: readonly string[]): Map<string, string> {
  const level = Math.min(...body.filter((l) => !blank(l)).map(indent));
  const out = new Map<string, string>();
  let key: string | undefined;
  let nested: string[] = [];
  const flush = () => {
    if (key !== undefined && nested.length) {
      const child = Math.min(...nested.filter((l) => l.trim() !== '').map(indent));
      out.set(key, nested.map((l) => l.slice(child)).join('\n').trimEnd());
    }
    nested = [];
  };
  for (const line of body) {
    const pair = indent(line) === level ? /^\s*([\w-]+):(?:\s+(.*))?$/.exec(line) : null;
    if (pair) {
      flush();
      key = pair[1]!;
      const inline = pair[2] ?? '';
      out.set(key, inline === '|' ? '' : inline);
    } else if (key !== undefined && !(blank(line) && nested.length === 0)) {
      nested.push(line);
    }
  }
  flush();
  return out;
}

/** The items of a block-style list (`- key: …` with more keys below), each as a mapping. */
function listItems(body: readonly string[]): Map<string, string>[] {
  const level = Math.min(...body.filter((l) => !blank(l)).map(indent));
  const items: string[][] = [];
  for (const line of body) {
    if (indent(line) === level && line.trimStart().startsWith('- ')) items.push([`${' '.repeat(level + 2)}${line.trimStart().slice(2)}`]);
    else items.at(-1)?.push(line);
  }
  return items.map(mapping);
}

/** The value of one key in a nested mapping value such as a step's `with:` or `env:`. */
function sub(value: string | undefined, key: string): string | undefined {
  return value === undefined ? undefined : mapping(value.split('\n')).get(key);
}

const unquote = (s: string | undefined): string | undefined => s?.replace(/^(['"])(.*)\1$/, '$2');

const inputs = new Map([...mapping(block(lines, 'inputs:'))].map(([name, body]) => [name, mapping(body.split('\n'))]));
const outputs = new Map([...mapping(block(lines, 'outputs:'))].map(([name, body]) => [name, mapping(body.split('\n'))]));
const steps = listItems(block(block(lines, 'runs:'), 'steps:'));

function step(name: string): Map<string, string> {
  const found = steps.find((s) => s.get('name') === name);
  if (found === undefined) throw new Error(`no step named ${name}`);
  return found;
}

/** First-column names of the README's inputs table. */
function readmeInputs(): string[] {
  const rows = readme.split('\n');
  const start = rows.findIndex((r) => /^\| Input \| Default \|/.test(r));
  if (start < 0) throw new Error('no inputs table in README.md');
  const names: string[] = [];
  for (const row of rows.slice(start + 2)) {
    if (!row.startsWith('|')) break;
    names.push(...[...row.split('|')[1]!.matchAll(/`([\w-]+)`/g)].map((m) => m[1]!));
  }
  return names;
}

describe('the action.yml walker', () => {
  test('reads every step, in order, by name or uses', () => {
    expect(steps.map((s) => s.get('name') ?? s.get('uses'))).toEqual([
      'Ensure git history',
      'actions/setup-node@v5',
      'Compare',
      'Inline annotations',
      'Job summary',
      'Sticky comment',
      'Gate',
    ]);
    expect(step('Compare').get('run')).toMatch(/^ARGS=\(compare /);
    expect(sub(step('Compare').get('env'), 'FAIL_ON')).toBe('${{ inputs.fail-on }}');
  });
});

describe('action.yml', () => {
  test('defaults isobar-version to DEFAULT_ISOBAR_VERSION', () => {
    expect(unquote(inputs.get('isobar-version')?.get('default'))).toBe(DEFAULT_ISOBAR_VERSION);
  });

  test('names every fail-on policy in the input description, and says any fails on a hotspot touch (A17)', () => {
    const description = unquote(inputs.get('fail-on')?.get('description')) ?? '';
    for (const value of FAIL_ON_VALUES) expect(description).toContain(value);
    expect(description).toMatch(/any.*hotspot/);
    expect(inputs.get('fail-on')?.get('default')).toBe('none');
  });

  test('every input it references is declared, and every declared input is referenced', () => {
    const used = new Set([...action.matchAll(/\binputs\.([\w-]+)/g)].map((m) => m[1]!));
    expect([...used].sort()).toEqual([...inputs.keys()].sort());
  });

  test('every step with run: says shell: bash (composite steps have no default shell)', () => {
    const runs = steps.filter((s) => s.has('run'));
    expect(runs.length).toBeGreaterThan(0);
    for (const s of runs) expect(s.get('shell'), s.get('name')).toBe('bash');
  });

  test('sets up Node 22 with actions/setup-node@v5 and no package-manager cache of the user repo', () => {
    const setup = steps.find((s) => s.get('uses')?.startsWith('actions/setup-node@'));
    expect(setup?.get('uses')).toBe('actions/setup-node@v5');
    expect(sub(setup?.get('with'), 'node-version')).toBe('22');
    expect(sub(setup?.get('with'), 'package-manager-cache')).toBe('false');
  });

  test('the Compare step writes every format to one folder and the gate is the last step', () => {
    const compare = step('Compare');
    expect(compare.get('id')).toBe('compare');
    expect(compare.get('run')).toContain('--format all --out "$RUNNER_TEMP/isobar-pr" --gate-output');
    expect(compare.get('run')).toContain('node "$GITHUB_ACTION_PATH/dist/cli.js"');
    expect(steps.at(-1)?.get('name')).toBe('Gate');
    expect(steps.at(-1)?.get('if')).toBe("steps.compare.outputs.gate == 'fail'");
  });

  test('every step reads only files the Compare step writes', () => {
    const read = [...action.matchAll(/\$RUNNER_TEMP\/isobar-pr\/([\w.-]+)/g)].map((m) => m[1]);
    expect(read.length).toBeGreaterThan(0);
    for (const file of read) expect(['report.md', 'summary.md', 'report.json', 'annotations.txt']).toContain(file);
  });

  test('the job summary gets the uncut summary.md and the comment the cut report.md (truncation note says so)', () => {
    expect(step('Job summary').get('run')).toBe('cat "$RUNNER_TEMP/isobar-pr/summary.md" >> "$GITHUB_STEP_SUMMARY"');
    expect(step('Sticky comment').get('run')).toContain('BODY="$RUNNER_TEMP/isobar-pr/report.md"');
  });

  test('flags valued inputs as --flag=value, so a value that starts with - is never read as an option', () => {
    const run = step('Compare').get('run');
    for (const flag of ['base-ref', 'isobar-version', 'fail-on', 'scope']) expect(run).toContain(`"--${flag}=$`);
  });

  test('comments only on pull_request events when asked, and never fails the job over the comment', () => {
    const comment = step('Sticky comment');
    expect(comment.get('if')).toContain("inputs.comment == 'true'");
    expect(comment.get('if')).toContain("github.event_name == 'pull_request'");
    expect(comment.get('continue-on-error')).toBe('true');
  });

  test('finds the sticky comment by the marker the Markdown renderer writes first', () => {
    expect(step('Sticky comment').get('run')).toContain(`startswith(${JSON.stringify(MARKER)})`);
  });

  test('fails early with an error when base-ref is empty (push, workflow_dispatch)', () => {
    expect(step('Ensure git history').get('run')).toMatch(/if \[ -z "\$BASE_REF" \]; then\n\s+echo "::error/);
  });

  test('turns a failed unshallow into one error pointing at fetch-depth: 0', () => {
    expect(step('Ensure git history').get('run')).toMatch(
      /if ! git fetch --unshallow [^\n]*; then\n\s+echo "::error title=isobar-pr::could not fetch history[^"\n]*fetch-depth: 0\."\n\s+exit 1\n/,
    );
  });

  test('passes every expression to run: blocks through env, never inline', () => {
    for (const s of steps) expect(s.get('run') ?? '', s.get('name')).not.toContain('${{');
  });

  test('declares the outputs the README documents, each wired to the Compare step', () => {
    expect([...outputs.keys()]).toEqual(['gate', 'summary', 'report-json']);
    for (const [name, body] of outputs) expect(unquote(body.get('value'))).toBe(`\${{ steps.compare.outputs.${name} }}`);
  });
});

describe('README.md', () => {
  test('documents exactly the inputs action.yml declares', () => {
    expect(readmeInputs().sort()).toEqual([...inputs.keys()].sort());
  });

  test('documents every output', () => {
    for (const name of outputs.keys()) expect(readme).toContain(`\`${name}\``);
  });

  test('uses the published action with a full-history checkout', () => {
    expect(readme).toContain('uses: sbinhamid-mercans/isobar-pr@v1');
    expect(readme).toContain('uses: actions/checkout@v5');
    expect(readme).toContain('fetch-depth: 0');
  });

  test('names the Node version the action puts on PATH', () => {
    expect(readme).toContain(`Node ${sub(steps.find((s) => s.get('uses')?.startsWith('actions/setup-node@'))?.get('with'), 'node-version')} on the job's \`PATH\``);
  });

  test('names only CLI flags that USAGE knows (or --help / --version, which main handles before it)', () => {
    const flags = [...new Set([...readme.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)].map((m) => m[0]))];
    expect(flags.length).toBeGreaterThan(5);
    for (const flag of flags.filter((f) => f !== '--help' && f !== '--version')) expect(USAGE, flag).toContain(flag);
  });

  test("quotes the HTTP info line's two endings as src/diff/http.ts writes them (A24)", () => {
    const http = readFileSync(join(root, 'src', 'diff', 'http.ts'), 'utf8');
    for (const why of ['no routes in this repo to match them against', 'no static calls in this repo to match its routes against']) {
      expect(http).toContain(`'${why}'`);
      expect(readme).toContain(`"${why}"`);
    }
  });

  test('states the default isobar version the CLI uses', () => {
    expect(readme).toContain(`| \`isobar-version\` | \`${DEFAULT_ISOBAR_VERSION}\` |`);
  });
});
