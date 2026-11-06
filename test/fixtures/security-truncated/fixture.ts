import type { SecurityWarning } from '../../../src/graph/types.js';
import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

// isobar 0.7.1 sorts warnings by level (serious before advisory), then file (localeCompare), then line, keeps the
// first 60 and reports the true total in `warningCount`. Base: 30 legacy files with two serious warnings each fill
// the 60 slots; 10 more are hidden, all sorting after the last kept one (src/legacy/query29.ts:20). Head is
// untruncated: query00–query09 plus two new serious warnings (22 in all). Files the PR removed (query10–query29 and
// the files of any hidden warning head no longer has) are left out of `changes` because they have no head warnings.
// The new ones:
// - src/legacy/query05.ts: base kept that file's serious warnings whole (another file's follow them), so a new
//   serious warning there is provably new;
// - src/reports/export.ts: base lists none of its serious warnings and its last kept one is serious, so this one
//   may be among the 10 hidden.
const sql = 'SQL is built by inserting values into the query text, which allows SQL injection. Pass the values as query parameters instead.';
const tls = 'TLS certificate checks are turned off for this connection (rejectUnauthorized: false), so it can be intercepted.';
const random = 'Math.random() is not cryptographically secure; use crypto.randomBytes / randomUUID for tokens and secrets.';
const legacy = (i: number): string => `src/legacy/query${String(i).padStart(2, '0')}.ts`;
const pair = (file: string): SecurityWarning[] => [
  { level: 'serious', text: sql, file, line: 10, lines: [10], code: 'db.query("SELECT * FROM t WHERE id = " + id)' },
  { level: 'serious', text: tls, file, line: 20, lines: [20], code: 'https.request({ rejectUnauthorized: false })' },
];

const query05 = legacy(5);
const exporter = 'src/reports/export.ts';
const files = { [query05]: { kind: 'util' }, [exporter]: { kind: 'util' } };

const headWarnings: SecurityWarning[] = [
  ...Array.from({ length: 10 }, (_, i) => pair(legacy(i))).flat(),
  { level: 'serious', text: random, file: query05, line: 42, lines: [42], code: 'const token = Math.random().toString(36)' },
  { level: 'serious', text: sql, file: exporter, line: 12, lines: [12], code: 'db.query("SELECT * FROM orders WHERE " + filter)' },
].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));

const fixture: Fixture = {
  base: makeGraph({ files, security: { warnings: Array.from({ length: 30 }, (_, i) => pair(legacy(i))).flat(), warningCount: 70 } }),
  head: makeGraph({ git_sha: 'h000000', files, security: { warnings: headWarnings, warningCount: headWarnings.length } }),
  changes: changes([query05, exporter], { hunks: { [query05]: [[40, 44]], [exporter]: [[10, 14]] } }),
};

export default fixture;
