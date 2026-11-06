import { describe, expect, test } from 'vitest';
import absent from '../fixtures/convention-absent-in-base/fixture.js';
import barrel from '../fixtures/convention-barrel-hint/fixture.js';
import broken from '../fixtures/convention-new-exception/fixture.js';
import truncated from '../fixtures/convention-truncated/fixture.js';
import weakened from '../fixtures/convention-weakened/fixture.js';
import { changes, runFixture } from '../helpers/makeGraph.js';

const foo = 'src/services/foo.ts';
const bar = 'src/services/bar.ts';

/** The broken fixture's head with foo.ts renamed to bar.ts and the given head exception list. */
function headWithBar(exceptions: string[]) {
  const head = structuredClone(broken.head);
  head.files[bar] = head.files[foo]!;
  delete head.files[foo];
  head.conventions!.patterns![0]!.exceptions = exceptions;
  return head;
}
const renameFooToBar = changes([bar], { renames: { [bar]: foo }, hunks: { [bar]: [[1, 3]] } });

describe('convention rule', () => {
  test('a broken barrel pattern advises importing through its index file instead of copying it', () => {
    const found = runFixture(barrel).findings;
    expect(found.map((f) => [f.kind, f.file])).toEqual([['convention-broken', 'src/hooks/organizations/useCreateOrganization.ts']]);
    expect(found[0]!.advice).toBe('Import through `src/api/core/index.ts` instead.');
    expect(found[0]!.data['example']).toBe('src/api/core/index.ts');
  });

  test('a new exception in a changed file breaks the convention', () => {
    const found = runFixture(broken).findings.filter((f) => f.kind === 'convention-broken');
    expect(found).toHaveLength(1);
    const f = found[0]!;
    expect(f.file).toBe(foo);
    expect(f.renamedFrom).toBeUndefined();
    expect(f.severity).toBe('medium');
    expect(f.inDiff).toBe(true);
    expect(f.line).toBeUndefined();
    expect(f.title).toBe('**Hooks use services, never the other way round** (206 of 208 imports follow it)');
    expect(f.detail).toBe('breaks it.');
    expect(f.advice).toBe('Copy `src/hooks/me/useSystemicIssuePreferences.ts` instead.');
    expect(f.data).toEqual({
      patternId: 'layer:hook>service',
      strength: 'rule',
      follow: 206,
      total: 208,
      example: 'src/hooks/me/useSystemicIssuePreferences.ts',
      rule: 'Services never import hooks: all 206 imports between them go hooks → services.',
      truncated: false,
    });
  });

  test('a pre-existing exception in a changed file is not reported', () => {
    const files = runFixture(broken).findings.map((f) => f.file);
    expect(files).not.toContain('src/services/pre.ts');
  });

  test('a new exception in a file the PR did not change is not reported', () => {
    expect(runFixture({ ...broken, changes: changes(['src/services/pre.ts'], { hunks: { 'src/services/pre.ts': [[9, 9]] } }) }).findings).toEqual([]);
  });

  test('rule → mostly with a changed exception is reported as weakened, plus the new exception; titles are escaped', () => {
    const { findings } = runFixture(weakened);
    expect(findings.map((f) => [f.kind, f.file, f.severity])).toEqual([
      ['convention-broken', 'src/new.ts', 'low'],
      ['convention-weakened', 'src/new.ts', 'low'],
    ]);
    const [b, w] = findings;
    expect(b?.title).toBe('**Imports from another folder use the \\@/ path alias** (95 of 112 imports follow it)');
    expect(w?.title).toBe('**Imports from another folder use the \\@/ path alias** weakened: rule → mostly (95 of 100 → 95 of 112 imports)');
    expect(w?.data).toEqual({ patternId: 'alias:@/', from: 'rule', to: 'mostly', baseFollow: 95, baseTotal: 100, headFollow: 95, headTotal: 112 });
  });

  test('mostly → mostly with a changed new exception is broken (low) but not weakened', () => {
    const base = structuredClone(weakened.base);
    Object.assign(base.conventions!.patterns![0]!, { strength: 'mostly', follow: 85 });
    const { findings } = runFixture({ ...weakened, base });
    expect(findings.map((f) => [f.kind, f.file, f.severity])).toEqual([['convention-broken', 'src/new.ts', 'low']]);
  });

  test('weakened anchors to the new exception rather than the first touched one', () => {
    const base = structuredClone(weakened.base);
    base.conventions!.patterns![0]!.exceptions = ['src/a.ts'];
    const head = structuredClone(weakened.head);
    head.files['src/z.ts'] = { kind: 'util' };
    head.conventions!.patterns![0]!.exceptions = ['src/a.ts', 'src/z.ts'];
    const { findings } = runFixture({ base, head, changes: changes(['src/a.ts', 'src/z.ts'], { hunks: { 'src/a.ts': [[1, 1]], 'src/z.ts': [[1, 9]] } }) });
    expect(findings.find((f) => f.kind === 'convention-weakened')?.file).toBe('src/z.ts');
    expect(findings.filter((f) => f.kind === 'convention-broken').map((f) => f.file)).toEqual(['src/z.ts']);
  });

  test('weakened falls back to the first changed head exception, which may be a renamed pre-existing one', () => {
    // x was already an exception under its old name x0, so it is not new: only the fallback anchors the slip on it.
    const x0 = 'src/old/x.ts';
    const x = 'src/x.ts';
    const y = 'src/y.ts';
    const base = structuredClone(weakened.base);
    base.files = { [x0]: { kind: 'util' }, [y]: { kind: 'util' } };
    base.conventions!.patterns![0]!.exceptions = [x0];
    const head = structuredClone(weakened.head);
    head.files = { [x]: { kind: 'util' }, [y]: { kind: 'util' } };
    head.conventions!.patterns![0]!.exceptions = [x, y];
    const { findings } = runFixture({ base, head, changes: changes([x], { renames: { [x]: x0 }, hunks: { [x]: [[1, 3]] } }) });
    expect(findings.map((f) => [f.kind, f.file, f.renamedFrom])).toEqual([['convention-weakened', x, x0]]);
  });

  test('a pattern absent in base is skipped', () => {
    expect(runFixture(absent).findings).toEqual([]);
  });

  test('a truncated base list makes only exceptions past its last listed entry ambiguous', () => {
    const { findings } = runFixture(truncated);
    expect(findings.map((f) => [f.kind, f.file, f.severity, f.data['truncated']])).toEqual([
      ['convention-broken', 'src/legacy/aaa.ts', 'medium', false],
      ['convention-broken', 'src/zz/New_Thing.ts', 'low', true],
    ]);
    expect(findings[0]?.detail).toBe('breaks it.');
    expect(findings[1]?.detail).toBe('breaks it (may be pre-existing: isobar truncated the base exception list).');
    expect(findings[1]?.title).toBe('**Utils use camelCase file names** (900 of 940 follow it)');
    expect(runFixture({ ...truncated, opts: { failOn: 'any' } }).gate).toBe('fail');
  });

  test('a truncated head list does not downgrade a new exception', () => {
    // zed.ts sorts after base's last listed entry (pre.ts), so treating head truncation as ambiguous would downgrade it.
    const zed = 'src/services/zed.ts';
    const head = structuredClone(broken.head);
    head.files[zed] = { kind: 'service' };
    Object.assign(head.conventions!.patterns![0]!, { exceptions: ['src/services/pre.ts', zed], exceptionCount: 70 });
    const f = runFixture({ ...broken, head, changes: changes([zed], { hunks: { [zed]: [[1, 3]] } }) }).findings.find((x) => x.kind === 'convention-broken');
    expect([f?.file, f?.severity, f?.detail, f?.data['truncated']]).toEqual([zed, 'medium', 'breaks it.', false]);
  });

  test('a truncated base list is compared in base path space, so a renamed file sorting before the cut is provably new', () => {
    // Base lists 2 of 5 exceptions. The head path src/zz/new.ts sorts after base's last listed entry (src/m.ts), but its
    // base path src/aa/old.ts sorts before it, so comparing the head path would wrongly call the exception ambiguous.
    const newPath = 'src/zz/new.ts';
    const oldPath = 'src/aa/old.ts';
    const base = structuredClone(broken.base);
    base.files[oldPath] = { kind: 'service' };
    Object.assign(base.conventions!.patterns![0]!, { exceptions: ['src/a.ts', 'src/m.ts'], exceptionCount: 5 });
    const head = structuredClone(broken.head);
    head.files[newPath] = { kind: 'service' };
    head.conventions!.patterns![0]!.exceptions = ['src/a.ts', 'src/m.ts', newPath];
    const { findings } = runFixture({ base, head, changes: changes([newPath], { renames: { [newPath]: oldPath }, hunks: { [newPath]: [[1, 3]] } }) });
    const f = findings.find((x) => x.kind === 'convention-broken');
    expect([f?.file, f?.renamedFrom, f?.severity, f?.detail, f?.data['truncated']]).toEqual([newPath, oldPath, 'medium', 'breaks it.', false]);
  });

  test('inDiff is undefined without hunks; a renamed exception file carries renamedFrom', () => {
    const noHunks = runFixture({ ...broken, changes: changes([foo]) });
    expect(noHunks.findings.find((f) => f.kind === 'convention-broken')?.inDiff).toBeUndefined();
    const renamed = runFixture({ ...broken, head: headWithBar(['src/services/pre.ts', bar]), changes: renameFooToBar });
    const f = renamed.findings.find((x) => x.kind === 'convention-broken');
    expect(f?.file).toBe(bar);
    expect(f?.renamedFrom).toBe(foo);
  });

  test('a renamed file that was already an exception under its old name is not new', () => {
    const base = structuredClone(broken.base);
    base.conventions!.patterns![0]!.exceptions = [foo];
    const { findings } = runFixture({ base, head: headWithBar([bar]), changes: renameFooToBar });
    expect(findings.filter((f) => f.kind === 'convention-broken')).toEqual([]);
  });

  test('a title with a code span keeps the span verbatim', () => {
    const head = structuredClone(broken.head);
    head.conventions!.patterns![0]!.title = '`@tiptap/react` is used only in src/components/';
    const f = runFixture({ ...broken, head }).findings.find((x) => x.kind === 'convention-broken');
    expect(f?.title).toBe('**`@tiptap/react` is used only in src/components/** (206 of 208 imports follow it)');
  });
});
