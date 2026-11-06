<!-- isobar-pr -->
## 🌀 isobar-pr · pressure delta

1 convention broken

| Signal (changed files only) | Base | Head | Δ |
|---|---|---|---|
| Cognitive complexity | 0 | 0 | 0 |
| Functions over a limit | 0 | 0 | 0 |
| Convention exceptions | 0 | 2 | +2 |
| Security warnings serious / advisory | 0 / 0 | 0 / 0 | 0 / 0 |
| Circular imports | 0 | 0 | 0 |

### 📐 Convention broken
- **Utils use camelCase file names** (900 of 940 follow it) — `src/legacy/aaa.ts` breaks it.
  ↳ Copy `src/utils/formatDate.ts` instead.
- **Utils use camelCase file names** (900 of 940 follow it) — `src/zz/New_Thing.ts` breaks it (may be pre-existing: isobar truncated the base exception list).
  ↳ Copy `src/utils/formatDate.ts` instead.

<details><summary>Pre-existing in changed files (0) · isobar 0.7.1 · base b000000 · head h000000</summary>

_Nothing pre-existing in the changed files._

</details>
