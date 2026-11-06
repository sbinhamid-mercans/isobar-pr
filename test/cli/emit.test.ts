import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { emitReport } from '../../src/commands/emit.js';
import { COMMENT_LIMIT } from '../../src/report/markdown.js';
import type { Finding, Report } from '../../src/report/types.js';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'isobar-pr-emit-'));
  dirs.push(dir);
  return dir;
}

function fakeIo(env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => { out.push(s); }, err: (s: string) => { err.push(s); }, env }, out, err };
}

/** `count` unresolved-import findings with 120-character titles, in distinct files. */
function report(count: number, gate: Report['gate'] = 'pass'): Report {
  const findings: Finding[] = Array.from({ length: count }, (_, i) => ({
    kind: 'unresolved-new',
    severity: 'low',
    file: `src/mod${String(i).padStart(3, '0')}.ts`,
    line: 1,
    title: `unresolved import ${i} `.padEnd(120, 'x'),
    data: {},
  }));
  return {
    meta: { toolVersion: '0.7.1', baseSha: 'b000000', headSha: 'h000000', baseRef: 'main', changedFiles: count, analyzedChangedFiles: count, httpActive: false, configChanged: false, truncated: false },
    summary: [],
    findings,
    preExisting: [],
    gate,
  };
}

const NOTE = '_Comment truncated. The full report is in the job summary and `report.json`._\n';

describe('emitReport', () => {
  test('a comment over COMMENT_LIMIT is cut, and report.json records meta.truncated', () => {
    const dir = tempDir();
    const big = report(700);
    const { io, out } = fakeIo();
    expect(emitReport(big, { format: 'json', out: dir, gateOutput: false }, io)).toBe(0);
    const markdown = readFileSync(join(dir, 'report.md'), 'utf8');
    expect(markdown.length).toBeLessThanOrEqual(COMMENT_LIMIT);
    expect(markdown.endsWith(NOTE)).toBe(true);
    const written = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    expect(written.meta.truncated).toBe(true);
    expect(written.findings).toHaveLength(700);
    expect(JSON.parse(out.join('')).meta.truncated).toBe(true);
    expect(big.meta.truncated).toBe(false); // the caller's report is left as it was
  });

  test('a comment within the limit is whole and meta.truncated stays false', () => {
    const dir = tempDir();
    const { io } = fakeIo();
    emitReport(report(3), { format: 'all', out: dir, gateOutput: false }, io);
    expect(readFileSync(join(dir, 'report.md'), 'utf8')).not.toContain('Comment truncated');
    expect(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).meta.truncated).toBe(false);
  });

  test('summary.md keeps the whole Markdown when report.md is cut, for the job summary the note points at', () => {
    const dir = tempDir();
    emitReport(report(700), { format: 'all', out: dir, gateOutput: false, durationMs: 1_000 }, fakeIo().io);
    const comment = readFileSync(join(dir, 'report.md'), 'utf8');
    const summary = readFileSync(join(dir, 'summary.md'), 'utf8');
    expect(comment.endsWith(NOTE)).toBe(true);
    expect(summary).not.toContain('Comment truncated');
    expect(summary.length).toBeGreaterThan(COMMENT_LIMIT);
    expect(summary.length).toBeGreaterThan(comment.length);
    expect(summary).toContain('src/mod699.ts'); // the last finding, past the cut
    expect(summary).toContain(' · 1.0 s</summary>');
  });

  test('summary.md and report.md are identical when nothing was cut', () => {
    const dir = tempDir();
    emitReport(report(3), { format: 'markdown', out: dir, gateOutput: false }, fakeIo().io);
    expect(readFileSync(join(dir, 'summary.md'), 'utf8')).toBe(readFileSync(join(dir, 'report.md'), 'utf8'));
  });

  test('durationMs reaches the footer', () => {
    const { io, out } = fakeIo();
    emitReport(report(1), { format: 'markdown', out: undefined, gateOutput: false, durationMs: 5_800 }, io);
    expect(out.join('')).toContain(' · 5.8 s</summary>');
  });

  test('the gate decides the exit code unless --gate-output, which always exits 0', () => {
    expect(emitReport(report(1, 'fail'), { format: 'json', out: undefined, gateOutput: false }, fakeIo().io)).toBe(1);
    expect(emitReport(report(1, 'pass'), { format: 'json', out: undefined, gateOutput: false }, fakeIo().io)).toBe(0);
    const { io, out } = fakeIo();
    expect(emitReport(report(1, 'fail'), { format: 'all', out: undefined, gateOutput: true }, io)).toBe(0);
    expect(out.join('')).toBe('gate=fail\nsummary=1 unresolved import\n');
  });

  test('--format all prints nothing to stdout; annotations with none to print write an empty annotations.txt', () => {
    const dir = tempDir();
    const empty = report(0);
    const { io, out } = fakeIo();
    emitReport(empty, { format: 'all', out: dir, gateOutput: false }, io);
    expect(out.join('')).toBe('');
    expect(readFileSync(join(dir, 'annotations.txt'), 'utf8')).toBe('');
  });
});
