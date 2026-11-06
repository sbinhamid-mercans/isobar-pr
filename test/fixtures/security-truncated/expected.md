<!-- isobar-pr -->
## 🌀 isobar-pr · pressure delta

2 security warnings (1 serious)

| Signal (changed files only) | Base | Head | Δ |
|---|---|---|---|
| Cognitive complexity | 0 | 0 | 0 |
| Functions over a limit | 0 | 0 | 0 |
| Convention exceptions | 0 | 0 | 0 |
| Security warnings serious / advisory | 2 / 0 | 4 / 0 | +2 / 0 |
| Circular imports | 0 | 0 | 0 |

### 🔒 New security warning
- `src/legacy/query05.ts:42` — **serious** — Math.random() is not cryptographically secure; use crypto.randomBytes / randomUUID for tokens and secrets. — `const token = Math.random().toString(36)`
- `src/reports/export.ts:12` — **serious** — SQL is built by inserting values into the query text, which allows SQL injection. Pass the values as query parameters instead. — may be pre-existing: isobar truncated the base warning list — `db.query("SELECT * FROM orders WHERE " + filter)`

<details><summary>Pre-existing in changed files (2) · isobar 0.7.1 · base b000000 · head h000000</summary>

- `src/legacy/query05.ts:10` — serious: SQL is built by inserting values into the query text, which allows SQL injection. Pass the values as query parameters instead.
- `src/legacy/query05.ts:20` — serious: TLS certificate checks are turned off for this connection (rejectUnauthorized: false), so it can be intercepted.

</details>
