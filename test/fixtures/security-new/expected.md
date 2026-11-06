<!-- isobar-pr -->
## 🌀 isobar-pr · pressure delta

2 security warnings (1 serious)

| Signal (changed files only) | Base | Head | Δ |
|---|---|---|---|
| Cognitive complexity | 0 | 0 | 0 |
| Functions over a limit | 0 | 0 | 0 |
| Convention exceptions | 0 | 0 | 0 |
| Security warnings serious / advisory | 0 / 0 | 2 / 1 | +2 / +1 |
| Circular imports | 0 | 0 | 0 |

### 🔒 New security warning
- `src/main/java/com/eq/frip/repository/inbox/EscalationScopeRepositoryImpl.java:32` — **serious** — SQL is built by inserting values into the query text, which allows SQL injection. Pass the values as query parameters instead. — `Query countQuery = entityManager.createNativeQuery("SELECT COUNT(DISTINCT et.id) " + from);`
- `src/lib/auth.ts:8` — **advisory** — An auth token is stored in localStorage, where any script on the page can read it (XSS). An httpOnly cookie can’t be read by scripts. — `localStorage.setItem('token', jwt)` _(outside the diff)_

<details><summary>Pre-existing in changed files (0) · isobar 0.7.1 · base b000000 · head h000000</summary>

_Nothing pre-existing in the changed files._

</details>
