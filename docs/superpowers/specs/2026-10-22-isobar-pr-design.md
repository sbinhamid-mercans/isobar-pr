# isobar-pr — design spec

**Date:** 2026-10-22
**Author:** Syed Huzaifa
**Status:** approved in brainstorm, pending implementation plan
**Repo:** `sbinhamid-mercans/isobar-pr` (new)

## 1. Summary

isobar-pr is a GitHub Action and CLI that reports the *pressure delta* of a pull request: how the PR changes complexity, conventions, hotspots, security warnings, circular imports and HTTP contracts, measured by running [isobar](https://www.npmjs.com/package/isobar) on the merge base and on the PR, and diffing the two `graph.json` files.

It posts one sticky comment on the PR, inline annotations on the exact lines, a job summary, and an optional red check. It is deterministic, needs no configuration, no LLM, no secrets, and never sends code anywhere.

**Hackathon framing.** Company-wide, individual. Rules: project must be new; must not replicate an existing or planned initiative; tools and process improvements qualify; proof of concept expected; ~2-minute demo video. The company runs nothing like this on PRs (no SonarQube, CodeClimate or Danger). isobar itself is untouched: isobar-pr consumes its documented `graph.json` schema v3.

## 2. Decisions and constraints

| Decision | Choice | Why |
| --- | --- | --- |
| Relationship to isobar | Standalone package + composite action, isobar pinned and invoked via `npx` | Wholly new project; isobar stays closed-source and unchanged; judges see all code |
| Name | `isobar-pr` (npm name verified available 2026-10-22) | Obvious lineage and purpose |
| Owner | `sbinhamid-mercans` (personal GitHub) | Submission stays the author's |
| CI platform | GitHub Actions | Company repos are on GitHub |
| LLM | None in v1 | Deterministic, demoable, no key in CI, does not overlap AI review bots |
| Timeline | 3–5 build days | See §10 |
| Language | TypeScript strict, ESM, Node ≥ 20 | Matches author's stack; `GraphV3` types are an asset |
| Runtime deps | Zero | isobar via `npx`, GitHub via preinstalled `gh`, git via `child_process` |
| Build | esbuild → single `dist/cli.js`, **committed** | `uses: sbinhamid-mercans/isobar-pr@v1` with no install step |
| Tests | vitest | Author familiarity |
| License | MIT (changeable before publish) | Judges and users can read and reuse it |

**Verified by spike on 2026-10-22 (arbites, 840 files, isobar 0.7.1):**

- `isobar <dir> --format json -q -o DIR/graph.json` writes `graph.json` at that path, with `BRIEF.md` and `AGENTS.md` beside it. The repo's own `.codegraph/` is untouched.
- A bare `git worktree` without `node_modules` analyzes fine (792 of 798 files compiler-checked).
- Wall time with full git history: head 3.0 s, base 2.5 s.
- `tool_version` is identical on both sides when the version is pinned.
- The git-history window is anchored to each side's latest commit (`2025-10-01→2026-10-01` on base vs `2025-10-20→2026-10-20` on head), so hotspot ranks drift between sides. The base list is the reference.
- `graph.json` is 4.1 MB per side: test fixtures must be hand-built, never dumps.

## 3. The product: the PR comment

One sticky comment per PR, found and edited in place by the marker `<!-- isobar-pr -->`.

```markdown
<!-- isobar-pr -->
## 🌀 isobar-pr · pressure delta

+31 cognitive across 4 changed files · 2 functions crossed a limit · 1 hotspot touched · 1 new serious warning · 1 call with no route

| Signal (changed files only)        | Base  | Head  | Δ     |
|------------------------------------|-------|-------|-------|
| Cognitive complexity               | 118   | 149   | +31   |
| Functions over a limit             | 3     | 5     | +2    |
| Convention exceptions              | 12    | 13    | +1    |
| Security warnings serious / advis. | 3 / 4 | 4 / 4 | +1/0  |
| Circular imports                   | 7     | 7     | 0     |
| HTTP calls with no route           | 2     | 3     | +1    |

### ⚠️ Crossed a limit or got slower
- `src/pages/manager-inbox/ManagerInbox.tsx` › `handleBulkEscalate` — cognitive 11 → **19** (limit 15), nesting 3 → **5** (limit 4) · L412
  ↳ Guard clauses; extract the inner block. *(isobar refactor guide)*
- `src/services/orders.ts` › `reconcile` — O(n) → **O(n·m)** (`.find` inside the loop at L58) · L41
  ↳ Build a Map of users by id first. *(isobar refactor guide)*

### 🔥 Hotspot touched
- `src/pages/manager-inbox/ManagerInbox.tsx` — base hotspot rank **1** (49 commits, total cognitive 182), imported by 0 tests. Keep changes small and tested.

### 📐 Convention broken
- **Hooks use services, never the other way round** (206 of 208 imports follow it) — `src/services/foo.ts` breaks it. Copy `src/hooks/me/useSystemicIssuePreferences.ts` instead.

### 🔒 New security warning
- **serious** `src/main/java/.../EscalationScopeRepositoryImpl.java:32` — SQL is built by inserting values into the query text.

### 🔌 HTTP call with no matching route
- `GET /api/v1/accounts/:id/pulse` from `src/api/pulse.api.ts:40`.

### ✅ Improved
- `src/components/inbox/MessageView.tsx` › `render` — cognitive 22 → 13, now within limit.

<details><summary>Pre-existing in changed files (3) · isobar 0.7.1 · base 31d3ed3 · head 9ab12cd · 5.8 s</summary>
…
</details>
```

**Rules**

- **Scope.** Only deltas that touch files changed in the PR. Cycles and HTTP findings count when at least one of their files changed.
- **Empty sections are omitted.** A PR with no findings still gets a one-line comment ("No pressure change in 4 changed files"), proving the bot ran.
- **Ordering inside a section:** findings on lines the PR touched (`inDiff`) first, then by severity (`serious > high > medium > low > info`), then by file path, then by line. Deterministic. `improved` findings live only in their own section.
- **Caps.** 10 items per section inline, then "and N more" with the rest in a `<details>` block. The whole comment is truncated at 65,000 characters (GitHub's limit is 65,536) with a pointer to the job summary and `report.json`.
- **Pre-existing** over-limit functions and warnings in changed files, unchanged between sides, go in the collapsed footer, never in a section.
- **Function identity** is `file + name`, with ordinal for duplicate names. Never line number.
- **Hotspot reference** is the base graph's `hotspots[]`.
- **Inline annotations:** `::warning file=,line=,title=isobar-pr::text` per in-diff finding; `::error` for serious security. GitHub shows at most 10 per level per step, so emit highest severity first and leave the rest to the comment.
- **Job summary:** the same Markdown appended to `$GITHUB_STEP_SUMMARY`.
- **Gate:** input `fail-on` ∈ `none | serious-security | limit-crossed | any`, default `none`. The gate never prevents the comment or annotations from posting.
- **Cross-repo contracts** (arbites ↔ EQ-Command-Center) are out of scope for v1; see §7 for how split repos are handled without noise.

## 4. Architecture

### 4.1 Layout

```
isobar-pr/
  action.yml                  composite action: CI glue only
  dist/cli.js                 esbuild bundle, committed, CI checks it matches source
  package.json                name isobar-pr, bin isobar-pr, type module, engines node>=20
  src/
    cli.ts                    subcommands: diff | compare; flags; exit codes
    graph/
      types.ts                GraphV3: only the fields isobar-pr reads
      load.ts                 parse; guard schema_version === 3; return tool_version
      index.ts                lookups: functionsByFile (with per-name ordinals), hotspotsByFile,
                              patternsById, warningsByKey, cycles, testImportersByFile, httpActive;
                              rules read calls/serves/unresolved straight off `graph.files`
    diff/                     PURE: no IO, no Date, no randomness
      functions.ts            function-regression / function-improved
      hotspots.ts             hotspot-touched
      conventions.ts          convention-broken / convention-weakened
      security.ts             security-new / security-grew
      cycles.ts               cycle-new / cycle-grew / cycle-broken
      http.ts                 http-unmatched-call / http-uncalled-route / http-info
      unresolved.ts           unresolved-new
      summary.ts              table rows over changed files
      preexisting.ts          unchanged over-limit functions + warnings in changed files
      index.ts                diffGraphs(base, head, changes, opts) → Report
    report/
      types.ts                Report, Finding, Severity
      markdown.ts             Report → sticky comment Markdown
      annotations.ts          Report → workflow-command lines
      json.ts                 Report → JSON with stable key order
    gate.ts                   (report, failOn) → 'pass' | 'fail'
    run/                      IMPURE: shared by `compare` and action.yml
      git.ts                  mergeBase, worktreeAdd/Remove, changes (name-status -M), hunks (-U0)
      isobar.ts               spawn npx -y isobar@<pin> <dir> --format json -q -o <file> [--scope]
      compare.ts              orchestrate end to end
  scripts/
    build.js                  esbuild → dist/cli.js
    compare-real.sh           local sanity run on arbites + EQ-Command-Center (output not committed)
  test/
    fixtures/<case>/          base.json, head.json, changes.txt, hunks.txt?, expected.md, expected.json
    fixtures/project-tiny/    a real 10-file TS app for integration tests
    helpers/makeGraph.ts      fixture builder
    *.test.ts
  docs/superpowers/specs/     this document
```

### 4.2 Module contracts

- `loadGraph(path, label = path): GraphV3` (and `parseGraph(text, label)`) — throws `SchemaError` if the JSON is not an object, `schema_version !== 3`, `files` is not a map, or `tool_version` is missing; `toolVersion` is read off the graph by `buildIndex`.
- `buildIndex(graph): GraphIndex` — pure lookups; `functionsByFile` lists each file's emitted functions as `FunctionRef { file, name, ordinal, fn }`, ordinal = position among same-named functions in that file. isobar omits trivial functions (within every limit, no issues), so a function missing on one side while its file exists means "was/is within every limit", not "new/deleted". `warningsTruncated` flags isobar's 60-warning cap (`security.warningCount`); patterns carry `exceptionCount` for the 50-exception cap.
- `diffGraphs(base: GraphIndex, head: GraphIndex, changes: Changes, opts: DiffOptions): Report` — pure and deterministic. `Changes = { changed: Set<string>; renames: Map<newPath, oldPath>; hunks?: Map<path, Range[]> }`.
- `renderMarkdown(report, extra?: { durationMs?: number }): string`, `renderAnnotations(report): string[]`, `toJson(report): string`. The footer shows the duration only when `extra.durationMs` is given; fixture tests omit it.
- `gate(findings, failOn): 'pass' | 'fail'` (called inside `diffGraphs`; the result lands in `Report.gate`).
- `compare(opts): { report: Report; durationMs: number; outDir: string }` — the only function that touches git, isobar, or the filesystem beyond reading inputs.

### 4.3 Report model

```ts
type Severity = 'serious' | 'high' | 'medium' | 'low' | 'info' | 'improved';

interface Finding {
  kind:
    | 'function-regression' | 'function-improved'
    | 'hotspot-touched'
    | 'convention-broken' | 'convention-weakened'
    | 'security-new' | 'security-grew'
    | 'cycle-new' | 'cycle-grew' | 'cycle-broken'
    | 'http-unmatched-call' | 'http-uncalled-route' | 'http-info'
    | 'unresolved-new'
    | 'config-changed';
  severity: Severity;
  file: string;              // head path
  renamedFrom?: string;
  line?: number;             // head line
  inDiff?: boolean;          // undefined when hunks unavailable → treated as true
  title: string;             // one line, Markdown-safe
  detail?: string;           // one line
  advice?: string;           // one line, from isobar's `how`
  data: Record<string, unknown>;   // kind-specific payload, stable keys, used by json + tests
}

interface Report {
  meta: {
    toolVersion: string; baseSha: string; headSha: string; baseRef: string;
    changedFiles: number; analyzedChangedFiles: number;
    httpActive: boolean; configChanged: boolean; truncated: boolean;
  };
  summary: Array<{ label: string; base: number | string; head: number | string; delta: string }>;
  findings: Finding[];
  preExisting: Array<{ file: string; line?: number; text: string }>;
  gate: 'pass' | 'fail';
}
```

Annotation level by severity: `serious` → `::error`; `high`, `medium` → `::warning`; `low` → `::notice`; `info`, `improved` → none.

### 4.4 CLI

```
isobar-pr diff    --base <graph.json> --head <graph.json> --changes <file|->
                  [--hunks <file>] [--format markdown|json|annotations|all] [--out DIR]
                  [--fail-on none|serious-security|limit-crossed|any] [--gate-output]
                  [--report-uncalled-routes]

isobar-pr compare [dir] [--base-ref REF] [--head-ref REF] [--isobar-version X.Y.Z]
                  [--scope DIR] [--format ...] [--out DIR] [--fail-on ...] [--gate-output]
                  [--report-uncalled-routes] [--keep-temp]
```

- `--changes` is the raw output of `git diff --name-status -M --diff-filter=ACDMRT BASE HEAD`; `--hunks` is the raw output of `git diff -U0 BASE HEAD`. `diff` parses both; `compare` produces them. Without `--hunks`, `inDiff` is undefined and treated as true.
- `--format` default `markdown` to stdout; `--out DIR` writes `report.md`, `report.json`, `annotations.txt`; `all` requires `--out`.
- `--gate-output` makes the process exit 0 and write `gate=pass|fail` and `summary=<one line>` to `$GITHUB_OUTPUT` (or stdout when unset). Without it, a failed gate exits 1.
- `--isobar-version` must be an exact semver (`0.7.1`); ranges are rejected.
- `head-ref` defaults to `HEAD` (the working tree in `compare`, so uncommitted edits are previewed locally).

**Exit codes:** `0` ok · `1` gate failed (direct use only) · `2` usage or environment (missing base ref, workspace repo, bad version) · `3` isobar or git failure.

## 5. CI data flow

### 5.1 The workflow a user adds

```yaml
name: isobar-pr
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: isobar-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  isobar-pr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: sbinhamid-mercans/isobar-pr@v1
        with:
          fail-on: serious-security
```

### 5.2 Inside `compare`

1. **Resolve refs.** `HEAD` is whatever is checked out. On `pull_request` that is `refs/pull/N/merge`: base tip with the PR merged, i.e. what would land. `BASE = git merge-base origin/<base-ref> HEAD`. On the merge ref this equals the base tip; on a raw head-sha checkout it is the true fork point. One formula, correct in both cases.
2. **Changes.** `git diff --name-status -M --diff-filter=ACDMRT BASE HEAD` → `changed` set (new paths), `renames` map and `deleted` set (base paths; only the config banner reads it). `git diff -U0 BASE HEAD` → `hunks`. Both run with `-c core.quotePath=false`, pinned `--src-prefix=a/ --dst-prefix=b/`, `--no-color`; the parsers also decode C-quoted paths. Paths are repo-relative POSIX, matching isobar's `files` keys. If `--scope` is set, only paths under it are kept.
3. **Pre-filter.** If no changed path has an extension isobar analyzes (`js jsx ts tsx mjs cjs vue svelte astro py go r rmd qmd java rb html css scss less`) and no analysis config file changed, skip isobar and emit the one-line "no analyzable source changed" report.
4. **Base worktree.** `git worktree add --detach <tmp>/base BASE`. Shares the object database, so isobar's `git log` works. Always removed in `finally`, followed by `git worktree prune`. `--keep-temp` disables cleanup for debugging.
5. **Two isobar runs**, sequential, same pinned version: `npx -y isobar@<pin> <dir> --format json -q -o <tmp>/<side>/graph.json [--scope DIR]`. Timeout 120 s per side. Non-zero exit → exit 3 with isobar's stderr; no comment.
6. **Load and guard.** Both sides `schema_version === 3`; `tool_version` equal; otherwise exit 3 naming both versions. If `-o` produced no `graph.json` (isobar treated the repo as a folder of projects) → exit 2 "workspace repos unsupported in v1; use --scope".
7. **Diff.** `diffGraphs(base, head, changes, opts)` → `Report`.
8. **Render.** `report.md`, `report.json`, `annotations.txt` into `--out`; gate and summary to `$GITHUB_OUTPUT` under `--gate-output`.

### 5.3 `action.yml`

Composite action. Inputs:

| Input | Default | Purpose |
| --- | --- | --- |
| `base-ref` | `${{ github.base_ref }}` | Branch to diff against |
| `fail-on` | `none` | Gate policy |
| `isobar-version` | `0.7.1` | Exact pin; both sides use it |
| `scope` | `` | Passed to isobar `--scope`; also filters changed files |
| `comment` | `true` | Post / update the sticky comment |
| `annotations` | `true` | Emit workflow-command annotations |
| `report-uncalled-routes` | `false` | See §7 |
| `github-token` | `${{ github.token }}` | For `gh api` |

Outputs: `gate` (`pass`/`fail`), `summary` (one line), `report-json` (path).

Steps:

1. Ensure history: `git rev-parse --is-shallow-repository` → if true, `git fetch --unshallow`; then `git fetch origin +refs/heads/<base-ref>:refs/remotes/origin/<base-ref>`.
2. `actions/setup-node@v4` with Node 20.
3. `node $GITHUB_ACTION_PATH/dist/cli.js compare --base-ref … --isobar-version … --format all --out $RUNNER_TEMP/isobar-pr --gate-output [--scope …] [--fail-on …]` (id `compare`).
4. If `annotations`: `cat $RUNNER_TEMP/isobar-pr/annotations.txt`.
5. `cat $RUNNER_TEMP/isobar-pr/report.md >> $GITHUB_STEP_SUMMARY`.
6. If `comment`: with `GH_TOKEN`, `gh api repos/$R/issues/$N/comments --paginate` → all comments whose body contains `<!-- isobar-pr -->`; PATCH the first, DELETE the rest, POST if none. `continue-on-error: true`; on 403 print `::notice::isobar-pr: comment skipped (read-only token, e.g. fork PR)`.
7. `if: steps.compare.outputs.gate == 'fail'` → `echo "::error::isobar-pr gate failed: $SUMMARY"; exit 1`. Last step, so the comment and annotations always land first.

Permissions documented: `contents: read`, `pull-requests: write`. `pull_request_target` is never recommended.

### 5.4 Local loop

`npx isobar-pr compare --base-ref main` in any repo prints the Markdown in ~6 s. Head is the working tree, including uncommitted edits, so the comment can be previewed before pushing. The same code path runs in CI.

## 6. Finding rules

All rules operate on the rename-mapped base: when looking up a head path in base, use `renames.get(path) ?? path`.

**Summary table** (changed files, both sides): sum of per-file `complexity.cognitive`; count of functions with non-empty `over`; count of convention exceptions in changed files, i.e. (pattern, file) pairs — a file listed by two patterns counts twice, each list de-duplicated first; security warning occurrences (`lines.length`, or 1) split serious / advisory; cycles with ≥ 1 changed file; unmatched static calls (only when HTTP is active, else the row is omitted).

**function-regression / function-improved.** Functions matched by `file + name + ordinal`. A regression has at least one of:

- a metric in head `over` that is not in base `over` for the matched function (or any `over` entry in a function with no base match, flagged "new");
- time-complexity rank up, on the ordinal scale `O(1) < O(log n) < O(n) < O(n log n) < O(n²) = O(n·m) < O(n³) or more < O(2ⁿ)`; unknown labels never produce a finding;
- a `refactor[]` entry whose `kind` is absent from the matched base function.

`data` is `{ metrics: Array<{ name, limit, base, head }>, time?: { base, head, why: string[] }, issues: Array<{ kind, severity, title, how, why }>, approximate?: true }`; at least one of `metrics`, `time`, `issues` is non-empty. Rendered as one card per function: metric values base → head with the limit, time base → head citing `time_why` lines, and the `how` text of the most severe new refactor issue (ties: array order) as advice. Same-name functions are paired by fingerprint (limits exceeded, time class, issue kinds) before ordinal, so a pure reorder reports nothing. A head function with no base match is "new" when the PR's added lines cover it entirely or its file is new; otherwise it was within every limit in base (isobar omits trivial functions). Severity: `high` if a time regression or a `serious`/`high` refactor issue, else `medium`. Improvement is the exact inverse (metric left `over`, rank down, issue kind gone), severity `improved`. When, after fingerprint pairing, unmatched same-name functions remain on both sides in unequal numbers, report only the net count of over-limit functions in the group, with detail "approximate match", no pairwise values. A head function with no base match at quadratic time or worse is a time regression (high if it was within limits in base, medium if new); the mirror case is an improvement.

**hotspot-touched.** Changed path ∈ base `hotspots[].file` (rename-mapped), skipping pure moves (hunks known, no added range, no deletion point). `data`: rank, score, commits, cognitive (the file's total), `testImporters` = max over base and head of the `imported_by` entries whose `kind === 'test'` and whose import of the file is not type-only. Severity `medium`; `low` if `testImporters > 0`. Title: `base hotspot rank **R** (C commits, total cognitive K), imported by N test(s)`.

**convention-broken.** For each head pattern with `strength ∈ {rule, mostly}` whose `id` also exists in base: `newExceptions = head.exceptions − base.exceptions` (rename-mapped), ∩ changed. One finding per file, severity `medium` for `rule`, `low` for `mostly`. `detail` = `rule` text with `follow / total`; `advice` = "Copy `<example>` instead". Patterns absent in base are skipped: the PR may have created the convention.

**convention-weakened.** Same `id` on both sides, `strength` went `rule → mostly`, and ≥ 1 changed file ∈ head `exceptions`. One finding per pattern, `file` = first such changed file. Severity `low`. `data`: from/to strength, follow/total both sides. A pattern that is present in base and absent in head (fell below 75 %) is not reported in v1: isobar no longer lists its exceptions, so the offending files cannot be named (see §11).

**security-new / security-grew.** Warnings keyed `file + text`. Key in head, not in base → `security-new`, line = first head `lines` entry inside a hunk if any, else `line`. Key in both and `head.lines.length > base.lines.length` → `security-grew`, `data.added = difference`, lines cited = head `lines` ∩ hunks. Severity = `serious` when `level === 'serious'`, else `medium`. The `code` snippet is quoted verbatim from graph.json (already secret-masked by isobar).

**cycle-new / cycle-grew / cycle-broken.** Cycle identity = sorted, rename-mapped file list joined by `\n`. Head cycle not in base with ≥ 1 changed file → `cycle-new` (`high`). Head cycle that is a strict superset of a base cycle → `cycle-grew` with `data.added` (`high`). Base cycle with ≥ 1 changed file and no head cycle that is a superset of it → `cycle-broken` (`improved`).

**HTTP.** `httpActive = head.http.routes.length > 0 && (matchable calls) > 0`, where a matchable call is a static one (`!dynamic`, `path !== null`, `!external`) in a non-test file. This keeps a backend-only repo such as EQ-Command-Center (hundreds of routes, a handful of dynamic calls in tests) inactive. When active: a call in a changed file with no `target`, not `dynamic`, whose `method + path` was not unmatched in base's same file → `http-unmatched-call` (`medium`). A `serves[]` entry in a changed file with `callers.length === 0` that was not present in base → `http-uncalled-route` (`low`), only with `--report-uncalled-routes`. When not active (split FE/BE repos such as arbites or EQ-Command-Center): one `http-info` finding (`info`) with static and dynamic call count deltas over changed files, rendered as a single line, and the summary row is omitted.

**unresolved-new.** `{file, spec}` or `{file, expr}` (isobar's computed-import shape, reason `computed path`) present in head `unresolved`, absent in base (keys prefixed by shape so they never collide), file ∈ changed. Specs with a URL scheme are skipped (remote by design). Severity `low`. Title `import \`SPEC\` could not be resolved (REASON)` / `computed import \`EXPR\` could not be resolved (computed path)`.

**config-changed.** Any of `.isobar.json`, `.codemap.json`, `.codegraph.json`, `.codegraph.toml` ∈ changed → one `info` finding rendered as a banner under the title: "Analysis config changed in this PR; deltas may reflect configuration, not code."

**preExisting.** Functions in changed files whose `over` is non-empty and identical on both sides; warnings whose key and `lines.length` are identical on both sides. Collapsed footer only.

**Gate.** `serious-security`: any `security-*` finding with severity `serious`. `limit-crossed`: any `function-regression` whose `data.metrics` is non-empty. `any`: any finding whose severity is not `info` or `improved`.

## 7. Edge cases and error handling

- **Renames** are resolved from `--name-status -M`; without this every function in a renamed file reads as new. Findings carry `renamedFrom`.
- **Duplicate names** (`Foo › useEffect callback` × 3): fingerprint matching first (limits exceeded, time class, issue kinds), then ordinal; unmatched members on both sides in unequal numbers → net count only, marked approximate.
- **New file:** every `over` function is a regression marked "new". **Deleted file:** nothing directly; effects surface through cycles and unmatched calls.
- **`inDiff`** from `-U0` hunks decides what is shouted (inline, annotated) versus listed. Annotations are emitted only for in-diff findings; GitHub renders only those inline anyway.
- **Split FE/BE repos** never get per-call HTTP findings (see `httpActive`). The arbites spike showed `matched: 0` with 2 static and 9 dynamic calls; a naive rule would flag every API line in every FE PR.
- **Non-source PRs** short-circuit before isobar runs.
- **Giant PRs:** per-section caps, 65,000-char comment truncation, full report in job summary and `report.json`.
- **Markdown safety:** `|`, backticks and `<` are escaped in table cells and titles.
- **Secrets:** isobar-pr never reads source; every quoted string comes from graph.json, which isobar secret-masks.
- **isobar failure or timeout** (120 s per side) → exit 3, stderr quoted, worktree removed, no comment.
- **Schema or version mismatch** → exit 3 naming both versions.
- **Missing base ref** → exit 2; the message includes the `fetch-depth: 0` YAML.
- **Folder-of-projects repos** → exit 2 with the `--scope` hint. Workspace mode is a stretch goal.
- **Fork PRs:** comment POST fails with 403 → `continue-on-error`, notice printed; annotations and summary still work.
- **Racing `synchronize` events:** documented `concurrency` group; the comment step also deletes duplicate marker comments, so a race self-heals on the next run.
- **Windows runners:** unsupported in v1 (documented); `npx` needs `cmd /c` there.
- **Determinism:** `diff/` reads no clock and no randomness; `durationMs` is not part of `Report` and reaches the renderer only as an optional extra from `compare`, so fixtures render byte-identical Markdown.

## 8. Testing

TDD throughout: each rule starts with a fixture pair and a failing golden test.

1. **Fixture pairs for `diff/`** (vitest, pure, fast). `test/fixtures/<case>/{base.json, head.json, changes.txt, hunks.txt?, expected.md, expected.json}`, built with `makeGraph()` so each is tens of lines. Golden files, refreshed with `UPDATE_GOLDEN=1`. Cases: crossed-limit, improved, new-file, renamed-file, duplicate-names-approx, hotspot-touched (with and without test importers), convention-new-exception, convention-weakened, convention-absent-in-base (must skip), security-new, security-grew, cycle-new, cycle-grew, cycle-broken, time-regression, refactor-new-issue, unresolved-new, http-self-contained, http-split-repo-info-line, config-changed-banner, non-source-pr, empty-delta, truncation (600 generated findings), tool-version-mismatch (error), schema-mismatch (error).
2. **Property tests** over every fixture pair, hand-rolled: determinism (two runs → identical JSON string); symmetry (swap sides → regressions ↔ improvements for metrics, time, cycles, security counts); identity (`diffGraphs(g, g)` → no delta findings; only `hotspot-touched`, `http-info` and `config-changed` may appear, since they describe the touch, not a delta); scope (every finding's file ∈ changed ∪ rename targets ∪ cycle members).
3. **Renderers and gate:** escaping, section omission, caps, truncation, in-diff ordering; annotation caps and levels; full `fail-on` matrix.
4. **`run/git.ts` against real git:** test builds a tmp repo with commits, a rename and a branch; asserts merge-base, ACMR + rename pairs, `-U0` ranges. No mocks.
5. **Integration (slow, tagged):** real `npx isobar@<pin>` on `test/fixtures/project-tiny/` → schema 3, `tool_version === pin`. One end-to-end `compare` on a tmp repo built from project-tiny whose head commit plants a nested loop and a hook → service import; asserts the Markdown names the function under "Crossed a limit".
6. **Action smoke:** isobar-pr's own CI runs `typecheck → test → build → git diff --exit-code dist/` and a self-dogfood job with `uses: ./`. The demo repo (§9) exercises the published action.
7. **Types:** `GraphV3` + `tsc --noEmit` in CI; `load.ts` runtime-checks only `schema_version`, `files`, `tool_version`.

## 9. Demo

**Demo repo** `sbinhamid-mercans/isobar-pr-demo`: a self-contained Express + React/Vite app of ~40 files with consistent layering (routes → services → repositories; hooks → services) so conventions clear isobar's sample thresholds, and with `scripts/seed-history.sh` producing ~30 backdated commits of uneven churn so real hotspots exist. Branch `demo/regression` opens one PR that plants:

| # | Plant | Section |
| --- | --- | --- |
| 1 | `.find` inside a nested loop in a service | Crossed a limit, O(n·m), refactor advice |
| 2 | a service imports a hook | Convention broken, with the example file to copy |
| 3 | SQL built by string concatenation in a route | New serious security warning, `::error`, red check |
| 4 | `fetch('/api/orders/export')` with no route | HTTP call with no matching route |
| 5 | an edit to the #1 hotspot file | Hotspot touched, "imported by 0 tests" |
| 6 | one function simplified | Improved |

**Video (~2 min, Loom):** 0:00 the problem (review sees the diff, not the pressure) · 0:15 isobar in one breath · 0:30 the PR: comment top to bottom, Files Changed annotations, red check · 1:20 `npx isobar-pr compare development` on arbites, ~6 s, same output · 1:40 six lines of YAML, no config, no LLM, no secrets, code never leaves the runner.

Pre-recording checklist: workflow green on the demo PR, `npx` cache warm, tabs open, `scripts/compare-real.sh` run on arbites and EQ-Command-Center to confirm real-repo noise is acceptable.

## 10. Plan

| Day | Work | 3-day cut |
| --- | --- | --- |
| 1 | Scaffold (TS strict, esbuild, vitest, CI with dist-drift check); `GraphV3`; `load`/`index`; `makeGraph`; rules: functions, hotspots, conventions; Markdown skeleton | keep |
| 2 | Rules: security, time, refactor issues, config banner; cycles, unresolved, HTTP gate; property tests; annotations, JSON, gate; caps and truncation | drop cycles, unresolved, HTTP |
| 3 | `run/` git + isobar + `compare`; e2e test; `action.yml` + sticky comment via `gh`; self-dogfood job; tag `v1` | keep; demo repo + recording that evening |
| 4 | Demo repo, seeded history, regression PR; run the real action; `compare-real.sh` on arbites and EQ-Command-Center, fix noise; README | — |
| 5 | Comment polish; record; buffer | — |

Minimum credible demo: crossed limit, hotspot, convention, security, improved, inline annotations, gate.

**Build-time checks** (verify as part of the day's work, not open requirements): isobar's minimum sample count for a convention, to size the demo app (`isobar brief --json` on the scaffold); EQ-Command-Center run time for the 120 s timeout; cold `npx -y isobar@0.7.1` time on an ubuntu runner.

## 11. Out of scope for v1 (stretch, only if day 5 is free)

- Claude-written one-paragraph summary (`summarize: true`, needs an API key input).
- Workspace mode: sibling repo checkout for cross-repo FE ↔ BE contracts (arbites ↔ EQ-Command-Center).
- Trend storage across PRs; GitLab; Windows runners; Checks API annotations beyond the 10-per-level workflow-command limit.
- Reporting a convention that vanished in head (fell below 75 %): needs isobar to expose sub-threshold patterns with their exceptions.
