import { describe, expect, test } from 'vitest';
import type { GraphV3, SecurityWarning } from '../../src/graph/types.js';
import grew from '../fixtures/security-grew/fixture.js';
import fresh from '../fixtures/security-new/fixture.js';
import truncated from '../fixtures/security-truncated/fixture.js';
import { changes, runFixture } from '../helpers/makeGraph.js';

/** [severity, data.truncated] of `w` when it is added to the truncated fixture's head as the PR's only changed file. */
function judge(w: SecurityWarning, base: GraphV3 = truncated.base, renames: Record<string, string> = {}): unknown[] {
  const head = structuredClone(truncated.head);
  head.security!.warnings!.push(w);
  head.security!.warningCount = head.security!.warnings!.length;
  const { findings } = runFixture({ base, head, changes: changes([w.file], { renames, hunks: { [w.file]: [[w.line, w.line]] } }) });
  const f = findings.find((x) => x.kind === 'security-new' && x.data['text'] === w.text);
  return [f?.severity, f?.data['truncated']];
}

describe('security rule', () => {
  test('a warning absent in base is new; serious maps to serious, others to medium', () => {
    const found = runFixture(fresh).findings.filter((f) => f.kind === 'security-new');
    expect(found.map((f) => [f.severity, f.file, f.line, f.inDiff])).toEqual([
      ['serious', 'src/main/java/com/eq/frip/repository/inbox/EscalationScopeRepositoryImpl.java', 32, true],
      ['medium', 'src/lib/auth.ts', 8, false],
    ]);
    expect(found[0]?.title).toBe('**serious** — SQL is built by inserting values into the query text, which allows SQL injection. Pass the values as query parameters instead.');
    expect(found[0]?.detail).toBe('`Query countQuery = entityManager.createNativeQuery("SELECT COUNT(DISTINCT et.id) " + from);`');
    expect(found[0]?.data).toEqual({ level: 'serious', text: expect.stringMatching(/^SQL is built/), lines: [32, 53], code: expect.stringMatching(/^Query countQuery/), truncated: false });
    expect(found[0]?.renamedFrom).toBeUndefined();
  });

  test('more occurrences of a known warning is security-grew with the in-diff lines', () => {
    const { findings } = runFixture(grew);
    const [f] = findings;
    expect(findings).toHaveLength(1);
    expect(f?.kind).toBe('security-grew');
    expect(f?.severity).toBe('serious');
    expect(f?.line).toBe(450);
    expect(f?.detail).toBe('1 more occurrence (2 → 3), at L450');
    expect(f?.data).toEqual(expect.objectContaining({ added: 1, lines: [450], truncated: false }));
  });

  test('the line is the first occurrence inside the diff, else the first (new) or last (grew) occurrence', () => {
    const repo = 'src/main/java/com/eq/frip/repository/inbox/EscalationScopeRepositoryImpl.java';
    const second = runFixture({ ...fresh, changes: changes([repo], { hunks: { [repo]: [[50, 55]] } }) }).findings[0];
    expect([second?.line, second?.inDiff]).toEqual([53, true]);
    const outside = runFixture({ ...fresh, changes: changes([repo], { hunks: { [repo]: [[1, 2]] } }) }).findings[0];
    expect([outside?.line, outside?.inDiff]).toEqual([32, false]);

    const inbox = 'src/main/java/com/eq/frip/repository/inbox/InboxScopeRepositoryImpl.java';
    const [g] = runFixture({ ...grew, changes: changes([inbox], { hunks: { [inbox]: [[1, 2]] } }) }).findings;
    expect([g?.line, g?.inDiff, g?.detail, g?.data['lines']]).toEqual([450, false, '1 more occurrence (2 → 3)', []]);
    const [unknown] = runFixture({ ...grew, changes: changes([inbox]) }).findings;
    expect([unknown?.line, unknown?.inDiff, unknown?.detail, unknown?.data['lines']]).toEqual([450, undefined, '1 more occurrence (2 → 3)', []]);
  });

  test('fewer or equal occurrences report nothing; a warning gone from head reports nothing', () => {
    const same = runFixture({ ...grew, head: grew.base, changes: grew.changes });
    expect(same.findings.filter((f) => f.kind.startsWith('security-'))).toEqual([]);
    const fewer = runFixture({ ...grew, base: grew.head, head: grew.base });
    expect(fewer.findings.filter((f) => f.kind.startsWith('security-'))).toEqual([]);
    const gone = runFixture({ ...fresh, base: fresh.head, head: fresh.base });
    expect(gone.findings.filter((f) => f.kind.startsWith('security-'))).toEqual([]);
  });

  test('serious-security gate', () => {
    expect(runFixture({ ...fresh, opts: { failOn: 'serious-security' } }).gate).toBe('fail');
    expect(runFixture({ ...grew, opts: { failOn: 'serious-security' } }).gate).toBe('fail');
  });

  test('titles and details are escaped, data stays raw', () => {
    const head = structuredClone(fresh.head);
    head.security!.warnings![0]!.text = 'Uses `eval` on <input> | risky_call';
    head.security!.warnings![0]!.code = 'x = `a${b}` | y';
    const [f] = runFixture({ ...fresh, head }).findings;
    expect(f?.title).toBe('**serious** — Uses `eval` on \\<input\\> \\| risky\\_call');
    expect(f?.detail).toBe('`` x = `a${b}` | y ``');
    expect(f?.data['text']).toBe('Uses `eval` on <input> | risky_call');
  });

  test('a renamed file matches its base warning through the rename map', () => {
    const head = structuredClone(grew.head);
    const oldPath = 'src/main/java/com/eq/frip/repository/inbox/InboxScopeRepositoryImpl.java';
    const newPath = 'src/main/java/com/eq/frip/repository/inbox/InboxScopeRepo.java';
    head.files[newPath] = head.files[oldPath]!;
    delete head.files[oldPath];
    head.security!.warnings![0]!.file = newPath;
    const [f] = runFixture({ ...grew, head, changes: changes([newPath], { renames: { [newPath]: oldPath }, hunks: { [newPath]: [[448, 452]] } }) }).findings;
    expect(f?.kind).toBe('security-grew');
    expect(f?.renamedFrom).toBe(oldPath);
  });

  test('a truncated base list downgrades an ambiguous new warning to medium and says so', () => {
    const found = runFixture(truncated).findings.filter((f) => f.kind === 'security-new');
    expect(found).toHaveLength(2);
    const ambiguous = found.find((f) => f.data['truncated'] === true);
    expect(ambiguous?.file).toBe('src/reports/export.ts');
    expect(ambiguous?.severity).toBe('medium');
    expect(ambiguous?.detail).toMatch(/^may be pre-existing: isobar truncated the base warning list — /);
    const provable = found.find((f) => f.data['truncated'] === false);
    expect([provable?.file, provable?.severity]).toEqual(['src/legacy/query05.ts', 'serious']);
    expect(runFixture({ ...truncated, opts: { failOn: 'serious-security' } }).gate).toBe('fail');
    const onlyAmbiguous = changes(['src/reports/export.ts'], { hunks: { 'src/reports/export.ts': [[10, 14]] } });
    expect(runFixture({ ...truncated, changes: onlyAmbiguous, opts: { failOn: 'serious-security' } }).gate).toBe('pass');
  });

  test('a truncated base never downgrades security-grew: a listed warning has an exact count', () => {
    // query29's TLS warning is base's last kept one, so its group straddles the cut; it is still listed whole.
    const file = 'src/legacy/query29.ts';
    const head = structuredClone(truncated.head);
    const w = structuredClone(truncated.base.security!.warnings!.at(-1)!);
    head.security!.warnings!.push({ ...w, lines: [20, 31] });
    head.security!.warningCount = head.security!.warnings!.length;
    const found = runFixture({ ...truncated, head, changes: changes([file], { hunks: { [file]: [[31, 31]] } }) }).findings;
    expect(found.map((f) => [f.kind, f.severity, f.detail, f.data['truncated']])).toEqual([['security-grew', 'serious', '1 more occurrence (1 → 2), at L31', false]]);
  });

  test('fallbacks: empty lines use line, a blank snippet is omitted, an ambiguous warning without code ends the note', () => {
    const head = structuredClone(fresh.head);
    Object.assign(head.security!.warnings![0]!, { lines: [], code: '   ' });
    const [f] = runFixture({ ...fresh, head }).findings;
    expect([f?.line, f?.data['lines'], f?.detail, f?.data['code']]).toEqual([32, [32], undefined, '   ']);

    const exporter = 'src/reports/export.ts';
    const cut = structuredClone(truncated.head);
    delete cut.security!.warnings!.find((w) => w.file === exporter)!.code;
    const [g] = runFixture({ ...truncated, head: cut, changes: changes([exporter], { hunks: { [exporter]: [[10, 14]] } }) }).findings;
    expect([g?.data['truncated'], g?.detail, g?.data['code']]).toEqual([true, 'may be pre-existing: isobar truncated the base warning list.', null]);
  });

  test('under truncation only a warning whose (level, file) group base kept whole is provably new', () => {
    const at = (level: string, file: string, text: string): SecurityWarning => ({ level, text, file, line: 7, lines: [7] });
    const sneaky = 'A new serious finding nobody has seen before.';
    // Base's last kept warning is serious (src/legacy/query29.ts): its group may continue past the cap.
    expect(judge(at('serious', 'src/legacy/query29.ts', sneaky))).toEqual(['medium', true]);
    // query05's serious group is listed whole, but its advisory group sorts after every serious warning: hidden.
    expect(judge(at('advisory', 'src/legacy/query05.ts', sneaky))).toEqual(['medium', true]);
    // A file base lists nothing for: its position under localeCompare is unknown.
    expect(judge(at('serious', 'src/zz/new.ts', sneaky))).toEqual(['medium', true]);
    // Groups are matched in base path space: query05 renamed is still a group base kept whole.
    expect(judge(at('serious', 'src/zz/query05.ts', sneaky), truncated.base, { 'src/zz/query05.ts': 'src/legacy/query05.ts' })).toEqual(['serious', false]);

    // With an advisory warning last, every serious base warning was kept.
    const advisoryLast = structuredClone(truncated.base);
    Object.assign(advisoryLast.security!.warnings!.at(-1)!, { level: 'advisory', text: 'SQL text is assembled at runtime.' });
    expect(judge(at('serious', 'src/zz/new.ts', sneaky), advisoryLast)).toEqual(['serious', false]);
    expect(judge(at('advisory', 'src/zz/new.ts', sneaky), advisoryLast)).toEqual(['medium', true]);
    // Levels isobar 0.7.1 never emits are never provably new, even when base lists a group of that level.
    const critical = structuredClone(advisoryLast);
    critical.security!.warnings!.find((w) => w.file === 'src/legacy/query05.ts')!.level = 'critical';
    expect(judge(at('critical', 'src/legacy/query05.ts', sneaky), critical)).toEqual(['medium', true]);

    // A truncated head list only hides warnings, so it never makes one ambiguous.
    const head = structuredClone(fresh.head);
    head.security!.warningCount = 70;
    expect(runFixture({ ...fresh, head }).findings.map((f) => f.data['truncated'])).toEqual([false, false]);
  });
});
