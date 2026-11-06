# Convention threshold — isobar 0.7.1 (measured 2026-10-26, Task 25 part 2)

Feeds the demo-repo plan: how many files a folder needs before isobar mines a convention a PR can break.
`isobar brief --json` does not exist in 0.7.1 (`--json` belongs to query/bundle/stats only), so every number below
comes from `npx -y isobar@0.7.1 <dir> --format json -q -o <tmp>/graph.json` → `conventions.patterns`.

## Measured
- `test/fixtures/project-tiny` (6 files: one each of entry, module, hook, service, util, test): **0 patterns**,
  so there is no smallest `total` to report.
- Scratch copies grown by N similar files in `services/`, `hooks/`, `utils/` plus N tests next to the services:
  N = 1–3 (10–18 files) → 0 patterns; **N = 4 (5 files per kind, 22 files) → first 6 patterns**, all `rule 5/5`:
  `name:hook`, `name:hook-prefix`, `exports:hook`, `exports:service`, `exports:util`, `tests:place`.
  **Minimum sample: 5 files of one kind** (smallest `total` = 5).
- One exception at that size (a non-`use` file added to 5 hooks): `name:hook-prefix` drops to `mostly 5/6`, so the PR
  gets convention-broken (low) + convention-weakened. With 10 hooks it stays `rule 10/11` (90.9 %) → broken (medium).
  `layer:hook>service` first appears at 10 hook → service imports.

## isobar's thresholds (read from dist/isobar.js, 0.7.1)
- Strength: rule ≥ 90 % follow, mostly ≥ 75 %, otherwise no pattern.
- `name:<kind>` / `exports:<kind>` / `suffix:<dir>`: ≥ 5 non-index files of one language (suffix ≥ 3 chars);
  `hook:<name>` ≥ 5 files; `pkg:<name>` ≥ 4 files; `data:<db>` ≥ 3 files; `tests:place` ≥ 5 tests;
  `layer:A>B` ≥ 5 following and ≥ 8 total imports; `barrel:<dir>` index + ≥ 4 files and ≥ 10 cross-folder imports;
  `imports:alias` ≥ 20 cross-folder imports; `http:wrappers` ≥ 5 calls.

## arbites (epic/SCC-318 head vs main merge-base)
- Head 40 patterns = 31 rule / 9 mostly: layer 6r/2m, pkg 3r, hook 2r/1m, imports 1r, barrel 1r/2m, name 6r/2m,
  exports 8r, suffix 3r/2m, tests 1r. Base 41 = 33 rule / 8 mostly. Smallest total 4 (a `pkg:` pattern).

**Demo implication:** give each folder the demo PR breaks ≥ 9 followers of one kind, so one exception keeps the rule (medium finding);
use exactly 5 to show broken + weakened together.
