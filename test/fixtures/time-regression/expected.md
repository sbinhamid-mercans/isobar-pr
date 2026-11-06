<!-- isobar-pr -->
## 🌀 isobar-pr · pressure delta

+3 cognitive across 1 changed file · 1 function crossed a limit or got slower

| Signal (changed files only) | Base | Head | Δ |
|---|---|---|---|
| Cognitive complexity | 9 | 12 | +3 |
| Functions over a limit | 0 | 0 | 0 |
| Convention exceptions | 0 | 0 | 0 |
| Security warnings serious / advisory | 0 / 0 | 0 / 0 | 0 / 0 |
| Circular imports | 0 | 0 | 0 |

### ⚠️ Crossed a limit or got slower
- `src/services/orders.ts` › `reconcile` — O(n) → **O(n·m)** (L58: users.find() inside the loop over orders) · L41
  ↳ Build a Map of users by id first. *(isobar refactor guide)*

<details><summary>Pre-existing in changed files (0) · isobar 0.7.1 · base b000000 · head h000000</summary>

_Nothing pre-existing in the changed files._

</details>
