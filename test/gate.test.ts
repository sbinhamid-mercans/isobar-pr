import { describe, expect, test } from 'vitest';
import { FAIL_ON_VALUES, gate, isFailOn } from '../src/gate.js';
import type { Finding } from '../src/report/types.js';

const f = (over: Partial<Finding>): Finding => ({ kind: 'security-new', severity: 'medium', file: 'a.ts', title: 't', data: {}, ...over });
const serious = f({ severity: 'serious' });
const grewSerious = f({ kind: 'security-grew', severity: 'serious' });
const crossed = f({ kind: 'function-regression', data: { metrics: [{ name: 'cognitive' }] } });
const timeOnly = f({ kind: 'function-regression', severity: 'high', data: { metrics: [] } });
const approx = f({ kind: 'function-regression', data: { metrics: [], approximate: true } });
const hotspot = f({ kind: 'hotspot-touched', severity: 'medium' });
const info = f({ kind: 'http-info', severity: 'info' });
const improved = f({ kind: 'function-improved', severity: 'improved' });

describe('gate', () => {
  test.each([
    ['none', [serious, crossed], 'pass'],
    ['serious-security', [serious], 'fail'],
    ['serious-security', [grewSerious], 'fail'],
    ['serious-security', [f({ severity: 'medium' }), crossed], 'pass'],
    ['limit-crossed', [crossed], 'fail'],
    ['limit-crossed', [approx], 'fail'],
    ['limit-crossed', [timeOnly, serious], 'pass'],
    ['any', [info, improved], 'pass'],
    ['any', [hotspot], 'fail'],
    ['any', [], 'pass'],
  ] as const)('%s with %j → %s', (policy, findings, expected) => {
    expect(gate([...findings], policy)).toBe(expected);
  });

  test('isFailOn accepts exactly the four policies', () => {
    expect(FAIL_ON_VALUES).toEqual(['none', 'serious-security', 'limit-crossed', 'any']);
    expect(isFailOn('any')).toBe(true);
    expect(isFailOn('ANY')).toBe(false);
    expect(isFailOn('')).toBe(false);
  });
});
