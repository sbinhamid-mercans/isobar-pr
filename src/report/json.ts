import type { Report } from './types.js';

function sortKeys(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toJSON' in value && typeof (value as { toJSON: unknown }).toJSON === 'function') {
    return sortKeys((value as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    if (value instanceof Map || value instanceof Set) throw new TypeError('stableStringify: Map and Set are not serialisable; use arrays');
    const src = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(src).sort().map((k) => [k, sortKeys(src[k])]));
  }
  return value;
}

/** JSON with object keys sorted by code unit at every level (arrays keep their order), so equal reports serialise identically. */
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeys(value), null, indent);
}

export function toJson(report: Report): string {
  return stableStringify(report) + '\n';
}
