import { describe, expect, test } from 'vitest';
import { renderAnnotations } from '../../src/report/annotations.js';
import type { Finding, Report } from '../../src/report/types.js';
import fresh from '../fixtures/security-new/fixture.js';
import { runFixture } from '../helpers/makeGraph.js';

const make = (over: Partial<Finding>): Finding => ({ kind: 'unresolved-new', severity: 'low', file: 'a.ts', line: 1, title: 't', data: {}, ...over });
const report = (findings: Finding[]): Report => ({ ...runFixture(fresh), findings });

describe('renderAnnotations', () => {
  test('maps severities to levels, strips markdown, escapes properties and data', () => {
    const lines = renderAnnotations(runFixture(fresh));
    expect(lines).toEqual([
      '::error file=src/main/java/com/eq/frip/repository/inbox/EscalationScopeRepositoryImpl.java,line=32,title=isobar-pr::serious — SQL is built by inserting values into the query text, which allows SQL injection. Pass the values as query parameters instead. — Query countQuery = entityManager.createNativeQuery("SELECT COUNT(DISTINCT et.id) " + from);',
    ]);
  });

  test('skips findings outside the diff, without a line, or with info/improved severity', () => {
    const lines = renderAnnotations(report([
      make({ severity: 'medium', inDiff: false }),
      make({ severity: 'medium', line: undefined }),
      make({ severity: 'info' }),
      make({ severity: 'improved' }),
      make({ severity: 'high', file: 'keep.ts', title: 'kept' }),
    ]));
    expect(lines).toEqual(['::warning file=keep.ts,line=1,title=isobar-pr::kept']);
  });

  test('caps at 10 per level, highest severity first', () => {
    const findings: Finding[] = [
      ...Array.from({ length: 12 }, (_, i) => make({ severity: 'medium', file: `m${i}.ts`, title: `medium ${i}` })),
      ...Array.from({ length: 3 }, (_, i) => make({ severity: 'high', file: `h${i}.ts`, title: `high ${i}` })),
      ...Array.from({ length: 11 }, (_, i) => make({ severity: 'low', file: `l${i}.ts`, title: `low ${i}` })),
    ];
    const lines = renderAnnotations(report(findings));
    expect(lines.filter((l) => l.startsWith('::warning'))).toHaveLength(10);
    expect(lines.filter((l) => l.startsWith('::notice'))).toHaveLength(10);
    expect(lines.slice(0, 3).every((l) => l.includes('::high '))).toBe(true);
  });

  test('escapes newlines, percent, commas and colons where GitHub requires it', () => {
    const [line] = renderAnnotations(report([make({ severity: 'medium', file: 'a,b:c.ts', title: '100% x\ny' })]));
    expect(line).toBe('::warning file=a%2Cb%3Ac.ts,line=1,title=isobar-pr::100%25 x y');
  });

  test('includes a finding whose inDiff is undefined (hunks unknown)', () => {
    expect(renderAnnotations(report([make({ severity: 'medium', inDiff: undefined, title: 'unknown hunks' })]))).toEqual([
      '::warning file=a.ts,line=1,title=isobar-pr::unknown hunks',
    ]);
    expect(renderAnnotations(report([make({ severity: 'medium', inDiff: true, title: 'in diff' })]))).toEqual([
      '::warning file=a.ts,line=1,title=isobar-pr::in diff',
    ]);
  });

  test('maps serious to error, high and medium to warning, low to notice', () => {
    const lines = renderAnnotations(report([
      make({ severity: 'serious', title: 's' }),
      make({ severity: 'high', title: 'h' }),
      make({ severity: 'medium', title: 'm' }),
      make({ severity: 'low', title: 'l' }),
    ]));
    expect(lines).toEqual([
      '::error file=a.ts,line=1,title=isobar-pr::s',
      '::warning file=a.ts,line=1,title=isobar-pr::h',
      '::warning file=a.ts,line=1,title=isobar-pr::m',
      '::notice file=a.ts,line=1,title=isobar-pr::l',
    ]);
  });

  test('joins plain title, detail and advice with an em dash, skipping missing or empty parts', () => {
    const lines = renderAnnotations(report([
      make({ title: '**bold** \\_x\\_', detail: 'see `a_b.ts`', advice: 'split `run`' }),
      make({ title: 'title', advice: 'advice only' }),
      make({ title: 'title', detail: '', advice: 'empty detail' }),
      make({ title: 'title', detail: 'detail only' }),
    ]));
    expect(lines).toEqual([
      '::notice file=a.ts,line=1,title=isobar-pr::bold _x_ — see a_b.ts — split run',
      '::notice file=a.ts,line=1,title=isobar-pr::title — advice only',
      '::notice file=a.ts,line=1,title=isobar-pr::title — empty detail',
      '::notice file=a.ts,line=1,title=isobar-pr::title — detail only',
    ]);
  });

  test('orders errors, then warnings, then notices, keeping report order within a severity', () => {
    const lines = renderAnnotations(report([
      make({ severity: 'low', file: 'z-low.ts' }),
      make({ severity: 'medium', file: 'z-medium.ts' }),
      make({ severity: 'serious', file: 'serious.ts' }),
      make({ severity: 'high', file: 'high.ts' }),
      make({ severity: 'medium', file: 'a-medium.ts' }),
      make({ severity: 'low', file: 'a-low.ts' }),
    ]));
    expect(lines.map((l) => l.slice(0, l.indexOf(',')))).toEqual([
      '::error file=serious.ts',
      '::warning file=high.ts',
      '::warning file=z-medium.ts',
      '::warning file=a-medium.ts',
      '::notice file=z-low.ts',
      '::notice file=a-low.ts',
    ]);
  });

  test('drops the least severe findings of a level past the cap, and skipped findings do not count toward it', () => {
    const findings: Finding[] = [
      ...Array.from({ length: 10 }, (_, i) => make({ severity: 'high', file: `out${i}.ts`, inDiff: false })),
      ...Array.from({ length: 9 }, (_, i) => make({ severity: 'medium', file: `m${i}.ts`, title: `medium ${i}` })),
      ...Array.from({ length: 2 }, (_, i) => make({ severity: 'high', file: `h${i}.ts`, title: `high ${i}` })),
    ];
    const titles = renderAnnotations(report(findings)).map((l) => l.slice(l.indexOf('::', 2) + 2));
    expect(titles).toEqual(['high 0', 'high 1', ...Array.from({ length: 8 }, (_, i) => `medium ${i}`)]);
  });

  test('a finding without a line does not use up a cap slot', () => {
    const findings: Finding[] = [
      ...Array.from({ length: 10 }, (_, i) => make({ severity: 'high', file: `noline${i}.ts`, line: undefined })),
      make({ severity: 'high', file: 'kept.ts', line: 7, title: 'kept' }),
    ];
    expect(renderAnnotations(report(findings))).toEqual(['::warning file=kept.ts,line=7,title=isobar-pr::kept']);
  });

  test('skips a line that is not a positive integer, without using up a cap slot', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const findings: Finding[] = [
        ...Array.from({ length: 10 }, (_, i) => make({ severity: 'high', file: `bad${i}.ts`, line: bad })),
        make({ severity: 'high', file: 'kept.ts', line: 1, title: 'kept' }),
      ];
      expect(renderAnnotations(report(findings))).toEqual(['::warning file=kept.ts,line=1,title=isobar-pr::kept']);
    }
  });

  test('passes a "::" in the message through unchanged', () => {
    expect(renderAnnotations(report([make({ title: 'a::b ::error file=x::y' })]))).toEqual([
      '::notice file=a.ts,line=1,title=isobar-pr::a::b ::error file=x::y',
    ]);
  });

  test('ignores renamedFrom: the annotation is placed on the head-side file', () => {
    const [line] = renderAnnotations(report([make({ file: 'new.ts', renamedFrom: 'old.ts', title: 'moved' })]));
    expect(line).toBe('::notice file=new.ts,line=1,title=isobar-pr::moved');
  });

  test('flattens CR/LF in the message to one space but percent-encodes them in properties', () => {
    const [line] = renderAnnotations(report([make({ file: 'a%\r\nb.ts', title: 'x\r\ny', detail: '50%\rdone\n' })]));
    expect(line).toBe('::notice file=a%25%0D%0Ab.ts,line=1,title=isobar-pr::x y — 50%25 done');
  });

  test('renders nothing for a report without annotatable findings', () => {
    expect(renderAnnotations(report([]))).toEqual([]);
    expect(renderAnnotations(report([make({ severity: 'info' }), make({ severity: 'low', inDiff: false })]))).toEqual([]);
  });
});
