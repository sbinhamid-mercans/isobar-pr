import { describe, expect, test } from 'vitest';
import { cell, code, compareText, listCapped, listCodes, plain, plural, signed, text, textWithCode } from '../../src/report/text.js';

describe('text helpers', () => {
  test('code wraps in backticks and survives a backtick inside', () => {
    expect(code('src/a.ts')).toBe('`src/a.ts`');
    expect(code('a`b')).toBe('`` a`b ``');
    expect(code('a``b')).toBe('``` a``b ```');
    expect(code('')).toBe('');
    expect(code('a\nb')).toBe('`a b`');
  });

  test('cell escapes pipes and flattens newlines', () => {
    expect(cell('a|b\nc')).toBe('a\\|b c');
    expect(cell(3)).toBe('3');
    expect(cell('<x>')).toBe('\\<x\\>');
    expect(cell('a\\|b')).toBe('a\\\\\\|b');
    expect(cell('a   b')).toBe('a b');
    expect(cell('a`b')).toBe('a\\`b');
  });

  test('plain strips markdown emphasis and code', () => {
    expect(plain('**serious** — `x`  y')).toBe('serious — x y');
  });

  test('plain keeps the spacing around code spans and the text inside them', () => {
    expect(plain('call `foo` now')).toBe('call foo now');
    expect(plain('`src/a.ts` grew')).toBe('src/a.ts grew');
    expect(plain('in `a`, `b` and `c`')).toBe('in a, b and c');
    expect(plain('x `` a`b `` y')).toBe('x a`b y');
    expect(plain('**serious** — `x` y')).toBe('serious — x y');
  });

  test('text escapes Markdown punctuation outside code spans', () => {
    expect(text('__init__')).toBe('\\_\\_init\\_\\_');
    expect(text('Foo<T> | x')).toBe('Foo\\<T\\> \\| x');
    expect(text('plain words')).toBe('plain words');
    expect(text('@Transactional #1')).toBe('\\@Transactional \\#1');
  });

  test('textWithCode keeps balanced code spans verbatim and escapes the rest', () => {
    expect(textWithCode('`@tiptap/react` is used only in src/*')).toBe('`@tiptap/react` is used only in src/\\*');
    expect(textWithCode('a `b')).toBe('a \\`b');
    expect(textWithCode('a ``b `c` @d')).toBe('a \\`\\`b `c` \\@d');
    expect(textWithCode('x `` a`b `` y_')).toBe('x `` a`b `` y\\_');
    expect(textWithCode('no spans <here>')).toBe(text('no spans <here>'));
  });

  test('plain(textWithCode(s)) round-trips the spans\' inner text', () => {
    expect(plain(textWithCode('`@x` y'))).toBe('@x y');
    expect(plain(textWithCode('`@tiptap/react` is used only in src/*'))).toBe('@tiptap/react is used only in src/*');
    expect(plain(textWithCode('a `b'))).toBe('a `b');
  });

  test('plain keeps ** inside code spans, unescapes outside, drops stray fences', () => {
    expect(plain('def `f(**kw)` now')).toBe('def f(**kw) now');
    expect(plain(text('__init__') + ' is ' + code('x'))).toBe('__init__ is x');
    expect(plain('`a``')).toBe('a');
    expect(plain('``')).toBe('');
    expect(plain('a `b` c `d` e')).toBe('a b c d e');
    expect(plain(text('@x #1'))).toBe('@x #1');
  });

  test('plain and cell are linear on adversarial input', () => {
    const t0 = performance.now();
    plain('`'.repeat(25_000) + ' '.repeat(25_000));
    cell(' '.repeat(50_000));
    expect(performance.now() - t0).toBeLessThan(200);
  });

  test('plain scans 20,000 characters of backtick runs, spans and escapes in under 50 ms', () => {
    // Unmatched runs of rising length (each scans to the end: the O(n·√n) worst case), balanced spans, escapes and **.
    let md = '';
    for (let n = 1; md.length < 20_000; n++) md += `${'`'.repeat(n)} \\* \`a\\b\` **x** \\\` `;
    md = md.slice(0, 20_000);
    plain('`a` \\* **b**'); // warm up the JIT so the budget measures the scan
    const t0 = performance.now();
    const out = plain(md);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(out.length).toBeLessThan(md.length); // fences, escapes and ** markers were dropped
  });

  test('signed and plural', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(-2)).toBe('-2');
    expect(signed(0)).toBe('0');
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(2, 'file')).toBe('2 files');
    expect(plural(0, 'entry', 'entries')).toBe('0 entries');
  });

  test('compareText orders by code unit, not locale', () => {
    expect(compareText('Z.ts', 'a.ts')).toBe(-1);
    expect(compareText('a', 'a')).toBe(0);
    expect(compareText('b', 'a')).toBe(1);
  });
});

describe('listCodes', () => {
  test('lists up to three items as code spans, then "and N more"', () => {
    expect(listCodes([])).toBe('');
    expect(listCodes(['a', 'b', 'c'])).toBe('`a`, `b`, `c`');
    expect(listCodes(['a', 'b', 'c', 'd', 'e'])).toBe('`a`, `b`, `c` and 2 more');
    expect(listCodes(['a', 'b'], 1)).toBe('`a` and 1 more');
    expect(listCodes(['x`y'])).toBe('`` x`y ``');
  });

  test('listCapped caps already-formatted parts the same way', () => {
    expect(listCapped(['`a` (deleted)', 'b', 'c', 'd'])).toBe('`a` (deleted), b, c and 1 more');
  });
});
