import { describe, expect, test } from 'vitest';
import { stableStringify, toJson } from '../../src/report/json.js';
import { emptyReport } from '../../src/diff/index.js';

describe('stableStringify', () => {
  test('sorts object keys recursively and keeps array order', () => {
    expect(stableStringify({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } }, 0)).toBe('{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  test('toJson ends with a newline', () => {
    expect(toJson(emptyReport({ changedFiles: 0 }))).toMatch(/\n$/);
  });

  test('honours toJSON', () => {
    expect(stableStringify({ d: { toJSON: () => ({ b: 1, a: 2 }) } }, 0)).toBe('{"d":{"a":2,"b":1}}');
  });

  test('refuses Map and Set', () => {
    expect(() => stableStringify({ m: new Map() })).toThrow(TypeError);
  });
});
