<!-- isobar-pr -->
## 🌀 isobar-pr · pressure delta

1 convention broken

| Signal (changed files only) | Base | Head | Δ |
|---|---|---|---|
| Cognitive complexity | 0 | 0 | 0 |
| Functions over a limit | 0 | 0 | 0 |
| Convention exceptions | 1 | 2 | +1 |
| Security warnings serious / advisory | 0 / 0 | 0 / 0 | 0 / 0 |
| Circular imports | 0 | 0 | 0 |

### 📐 Convention broken
- **Hooks use services, never the other way round** (206 of 208 imports follow it) — `src/services/foo.ts` breaks it.
  ↳ Copy `src/hooks/me/useSystemicIssuePreferences.ts` instead.

<details><summary>Pre-existing in changed files (0) · isobar 0.7.1 · base b000000 · head h000000</summary>

_Nothing pre-existing in the changed files._

</details>
