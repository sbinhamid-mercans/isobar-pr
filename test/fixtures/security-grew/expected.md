<!-- isobar-pr -->
## 🌀 isobar-pr · pressure delta

1 security warning (1 serious)

| Signal (changed files only) | Base | Head | Δ |
|---|---|---|---|
| Cognitive complexity | 0 | 0 | 0 |
| Functions over a limit | 0 | 0 | 0 |
| Convention exceptions | 0 | 0 | 0 |
| Security warnings serious / advisory | 2 / 0 | 3 / 0 | +1 / 0 |
| Circular imports | 0 | 0 | 0 |

### 🔒 New security warning
- `src/main/java/com/eq/frip/repository/inbox/InboxScopeRepositoryImpl.java:450` — **serious** — SQL is built by inserting values into the query text, which allows SQL injection. Pass the values as query parameters instead. — 1 more occurrence (2 → 3), at L450

<details><summary>Pre-existing in changed files (0) · isobar 0.7.1 · base b000000 · head h000000</summary>

_Nothing pre-existing in the changed files._

</details>
