/** Inline code span whose fence is longer than any backtick run inside (CommonMark). Newlines become spaces; empty input yields ''. */
export function code(s: string): string {
  const flat = s.replace(/\r?\n/g, ' ');
  if (flat === '') return '';
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  return longest === 0 ? `${fence}${flat}${fence}` : `${fence} ${flat} ${fence}`;
}

/** ASCII punctuation that `text()` escapes and `plain()` unescapes. `@` and `#` stop GitHub mention/issue autolinks. */
const MARKDOWN_PUNCTUATION = '\\`*_[]<>|@#';
const ESCAPABLE = new RegExp(`[${MARKDOWN_PUNCTUATION.replace(/[\\\]]/g, '\\$&')}]`);
const ESCAPABLE_G = new RegExp(ESCAPABLE.source, 'g');

/** Escapes Markdown punctuation in raw text from graph.json (names, messages) placed outside a code span. */
export function text(s: string): string {
  return s.replace(ESCAPABLE_G, '\\$&');
}

/**
 * Like `text()`, but balanced code spans already in `s` are kept verbatim (isobar titles such as
 * "`@tiptap/react` is used only in src/components/" contain intended spans); only the text outside them is
 * escaped, so an unbalanced backtick run is escaped too. A span closes on a backtick run of the same length
 * (CommonMark), the same rule `plain()` unwraps by.
 */
export function textWithCode(s: string): string {
  let out = '';
  let from = 0;
  let i = s.indexOf('`');
  while (i >= 0) {
    const n = runLength(s, i);
    const close = closingRun(s, i + n, n);
    if (close < 0) {
      // Unbalanced: the run stays in the pending plain text, which text() escapes.
      i = s.indexOf('`', i + n);
      continue;
    }
    out += text(s.slice(from, i)) + s.slice(i, close + n);
    from = close + n;
    i = s.indexOf('`', from);
  }
  return out + text(s.slice(from));
}

/** Length of the backtick run starting at `i` (0 when `s[i]` is not a backtick). */
function runLength(s: string, i: number): number {
  let n = 0;
  while (s[i + n] === '`') n++;
  return n;
}

/** Start of the first backtick run of exactly `n` at or after `from`, or -1: a code span closes on a run of its opening length. */
function closingRun(s: string, from: number, n: number): number {
  let j = s.indexOf('`', from);
  while (j >= 0) {
    const m = runLength(s, j);
    if (m === n) return j;
    j = s.indexOf('`', j + m);
  }
  return -1;
}

/** Safe text for a Markdown table cell: `text()` escaping plus whitespace collapsed to single spaces. */
export function cell(s: string | number): string {
  return text(String(s)).replace(/\s+/g, ' ');
}

/**
 * Plain text for annotations: unwraps code spans verbatim (CommonMark fence matching, one-space trim),
 * drops unmatched backtick runs, removes `**` and backslash escapes outside spans, collapses whitespace.
 * Near-linear time (worst case O(n·√n) on pathological fence runs).
 */
export function plain(md: string): string {
  let out = '';
  let i = 0;
  while (i < md.length) {
    const step = md[i] === '`' ? scanCode(md, i) : scanText(md, i);
    out += step.out;
    i = step.next;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** What one scanner step of `plain()` emits and where the next step starts. */
interface Step {
  out: string;
  next: number;
}

/** The backtick run at `i`: a code span unwrapped verbatim (one-space trim), or an unmatched run dropped. */
function scanCode(md: string, i: number): Step {
  const n = runLength(md, i);
  const close = closingRun(md, i + n, n);
  if (close < 0) return { out: '', next: i + n };
  return { out: trimSpan(md.slice(i + n, close)), next: close + n };
}

/** CommonMark strips one space from each end of a span's content when both ends have one and it is not all spaces. */
function trimSpan(inner: string): string {
  const padded = inner.length >= 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== '';
  return padded ? inner.slice(1, -1) : inner;
}

/** One character outside a span: a backslash escape unescaped, `**` dropped, anything else kept. */
function scanText(md: string, i: number): Step {
  const ch = md[i]!;
  const next = md[i + 1];
  if (ch === '\\' && next !== undefined && ESCAPABLE.test(next)) return { out: next, next: i + 2 };
  if (ch === '*' && next === '*') return { out: '', next: i + 2 };
  return { out: ch, next: i + 1 };
}

/** Already-formatted Markdown parts joined by `, `, at most `max` of them, then ` and N more`. */
export function listCapped(parts: readonly string[], max = 3): string {
  const listed = parts.slice(0, max).join(', ');
  const more = parts.length - max;
  return more > 0 ? `${listed} and ${more} more` : listed;
}

/** Raw strings (paths, names) as code spans, listed by `listCapped`. */
export function listCodes(items: readonly string[], max = 3): string {
  return listCapped(items.map((s) => code(s)), max);
}

/** `+3`, `-2`, `0`. */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** `1 file`, `2 files`, `0 entries`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Deterministic, locale-independent ordering by UTF-16 code units (never `localeCompare`). */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
