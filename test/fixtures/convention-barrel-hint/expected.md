<!-- isobar-pr -->
## 🌀 isobar-pr · pressure delta

+2 cognitive across 1 changed file · 1 convention broken

| Signal (changed files only) | Base | Head | Δ |
|---|---|---|---|
| Cognitive complexity | 0 | 2 | +2 |
| Functions over a limit | 0 | 0 | 0 |
| Convention exceptions | 0 | 1 | +1 |
| Security warnings serious / advisory | 0 / 0 | 0 / 0 | 0 / 0 |
| Circular imports | 0 | 0 | 0 |

### 📐 Convention broken
- **Import src/api/core/ through its index file** (73 of 81 imports follow it) — `src/hooks/organizations/useCreateOrganization.ts` breaks it.
  ↳ Import through `src/api/core/index.ts` instead.

<details><summary>Pre-existing in changed files (0) · isobar 0.7.1 · base b000000 · head h000000</summary>

_Nothing pre-existing in the changed files._

</details>
