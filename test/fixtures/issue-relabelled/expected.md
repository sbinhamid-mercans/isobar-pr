<!-- isobar-pr -->
## 🌀 isobar-pr · pressure delta

-3 cognitive across 2 changed files · 1 function crossed a limit or got slower · 1 improved

| Signal (changed files only) | Base | Head | Δ |
|---|---|---|---|
| Cognitive complexity | 33 | 30 | -3 |
| Functions over a limit | 2 | 2 | 0 |
| Convention exceptions | 0 | 0 | 0 |
| Security warnings serious / advisory | 0 / 0 | 0 / 0 | 0 / 0 |
| Circular imports | 0 | 0 | 0 |

### ⚠️ Crossed a limit or got slower
- `src/api/errors.ts` › `showErrorToast` — cognitive 15 → **18** (limit 15) · L544
  ↳ Split it into steps: give each block that does one job its own well-named function. *(isobar refactor guide)*

### ✅ Improved
- `src/api/client.ts` › `runRequest` — cognitive 18 → 12, now within limit 15 · L339

<details><summary>Pre-existing in changed files (0) · isobar 0.7.1 · base b000000 · head h000000</summary>

_Nothing pre-existing in the changed files._

</details>
