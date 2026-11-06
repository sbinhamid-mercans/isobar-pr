import { describe, expect, test } from 'vitest';
import refactor from '../fixtures/refactor-new-issue/fixture.js';
import time from '../fixtures/time-regression/fixture.js';
import { runFixture } from '../helpers/makeGraph.js';

describe('function rule: time and refactor issues', () => {
  test('a worse time class is a high-severity regression with the why line and advice', () => {
    const [f] = runFixture(time).findings;
    expect(f?.kind).toBe('function-regression');
    expect(f?.severity).toBe('high');
    expect(f?.title).toBe('`reconcile` — O(n) → **O(n·m)** (L58: users.find() inside the loop over orders)');
    expect(f?.advice).toBe('Build a Map of users by id first.');
    expect(f?.data['time']).toEqual({ base: 'O(n)', head: 'O(n·m)', why: ['L58: users.find() inside the loop over orders'] });
    expect((f?.data['issues'] as unknown[]).length).toBe(1);
    expect(f?.inDiff).toBe(true);
  });

  test('a crossed limit with a new medium issue stays medium; advice comes from the issue', () => {
    const [f] = runFixture(refactor).findings;
    expect(f?.severity).toBe('medium');
    expect(f?.title).toBe('`handleSave` — lines 60 → **110** (limit 100)');
    expect(f?.advice).toMatch(/^Split it by responsibility/);
    expect(f?.data['issues']).toEqual([expect.objectContaining({ kind: 'long-function', severity: 'medium' })]);
  });

  test('limit-crossed gate ignores a regression with no crossed metric', () => {
    expect(runFixture({ ...time, opts: { failOn: 'limit-crossed' } }).gate).toBe('pass');
    expect(runFixture({ ...time, opts: { failOn: 'any' } }).gate).toBe('fail');
  });
});
