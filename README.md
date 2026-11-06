# isobar-pr

**Pressure delta for every pull request.** isobar-pr runs [isobar](https://www.npmjs.com/package/isobar) on a PR's merge base and on the PR, diffs the two maps, and tells reviewers what the PR did to the codebase's pressure: complexity limits crossed, hotspots touched, conventions broken, new security warnings, circular imports, HTTP calls with no route, and what got better.

Deterministic. No configuration. No LLM, no API keys. The code never leaves the runner.

## In a workflow

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
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: sbinhamid-mercans/isobar-pr@v1
        with:
          fail-on: serious-security
```

On every push to the PR the action posts:

- **One sticky comment**, found by its hidden `<!-- isobar-pr -->` first line and edited in place; duplicates left by racing runs are deleted.
- **Inline annotations** on changed lines: `::error` for serious security warnings, `::warning` for high and medium findings, `::notice` for low ones. GitHub shows 10 per level, so the most severe come first.
- **The job summary**: the same Markdown as the comment, always the full report even when the comment had to be cut.
- **The gate**: with `fail-on` set, a failing last step, so the comment and annotations always land first.

Run the action right after `actions/checkout`, before any build or test step. It analyzes the working tree, so files that earlier steps create and `.gitignore` does not cover (build output, coverage) count as files the PR added. The action also puts Node 22 on the job's `PATH`; add your own `actions/setup-node` after it if later steps need another version.

| Input | Default | Meaning |
| --- | --- | --- |
| `base-ref` | PR base branch | Branch to diff against. Empty outside `pull_request` events: set it on `push` or `workflow_dispatch` |
| `fail-on` | `none` | `none`, `serious-security`, `limit-crossed` or `any` (`any` also fails when a base hotspot is touched) |
| `isobar-version` | `0.7.1` | Exact isobar version, used on both sides |
| `scope` | | Only analyze this folder of the repository |
| `comment` | `true` | Post or update the sticky comment (`pull_request` events only) |
| `annotations` | `true` | Emit inline annotations |
| `report-uncalled-routes` | `false` | Also report new routes no client in this repo calls |
| `github-token` | `github.token` | Token for the comment |

Outputs: `gate` (`pass` or `fail`), `summary` (the one-line headline), `report-json` (path to `report.json` under `$RUNNER_TEMP`; upload it with `actions/upload-artifact` to keep it).

## Demo

[isobar-pr-demo](https://github.com/sbinhamid-mercans/isobar-pr-demo) is a small Express + React app with a seeded history that runs this action with `fail-on: serious-security`. Its [`demo/regression` pull request](<PR-URL>) plants six changes, one for each of six report sections (limit crossed, hotspot touched, convention broken, new security warning, HTTP contract, improved), and the new security warning fails the gate. Its `demo/clean` pull request changes one label and gets the one-line comment.

## On your laptop

```bash
npx isobar-pr compare --base-ref main   # once published to npm
```

Run it at the repository root (until then, `node <isobar-pr clone>/dist/cli.js compare` does the same). The head is your working tree, uncommitted edits and untracked files included, so you can preview the comment before pushing; `--head-ref <ref>` analyzes a commit instead. To diff two `graph.json` files you already have:

```bash
git diff --name-status -M main HEAD > files.txt
git diff -U0 main HEAD > u0.txt
isobar-pr diff --base a.json --head b.json --changes files.txt --hunks u0.txt
```

`--changes -` reads the change list from stdin, so the first line can be piped in instead of written to a file.

`--format markdown|json|annotations|all` picks what goes to stdout (default `markdown`); `--out DIR` writes `report.md` (the comment), `summary.md` (the same, never cut), `report.json` and `annotations.txt` (`all` requires it). `--fail-on`, `--scope`, `--isobar-version` and `--report-uncalled-routes` work like the action inputs of the same name; `--keep-temp` keeps the temp folder with both `graph.json` files. `isobar-pr --help` lists everything.

Exit codes: `0` ok · `1` gate failed · `2` usage or environment (a bad flag, unreadable input, not at a repository root, a base ref or merge base missing from a shallow history) · `3` isobar, git or `graph.json` failure. With `--gate-output` a failed gate exits `0` and `gate=`, `summary=` (and `report-json=` with `--out`) go to `$GITHUB_OUTPUT`, or to stdout when it is unset.

## What it reports

Only deltas in the files the PR changed. Each section appears only when it has something:

- **⚠️ Crossed a limit or got slower**: a function crossed one of isobar's limits (cognitive, cyclomatic, nesting, lines, parameters), its time class went up, or it gained a performance issue such as a lookup inside a loop, with isobar's refactor advice.
- **🔥 Hotspot touched**: the file is one of the base branch's hotspots, with how many tests import it.
- **📐 Convention broken**: a new exception to a convention the codebase follows in at least 75 % of cases, with an example file to copy.
- **🔒 New security warning**: a new warning from isobar's security scan, or more occurrences of an existing one.
- **🔁 Circular import**: a new or grown import cycle through a changed file.
- **🔌 HTTP contract**: in a repo that serves its own routes, calls no route answers. In a frontend-only or backend-only repo, a change in call counts gets one info line instead, ending "no routes in this repo to match them against" or "no static calls in this repo to match its routes against".
- **❓ Unresolved import**: a new import isobar could not resolve.
- **✅ Improved**: functions back within their limits or in a lower time class, and import cycles broken.

A collapsed footer lists what was already over a limit in the changed files. A PR with no findings gets a one-line comment; one that changes no file isobar analyzes skips isobar and says so. Sections show 10 items, then fold the rest; a comment over 65,000 characters is cut, while the job summary and `report.json` keep everything.

## How it works

1. The base is `git merge-base <base-ref> HEAD`; branch names are read from `origin/` first, `HEAD`-relative refs as git reads them. On `pull_request` events HEAD is the merge commit, so the diff is exactly what would land.
2. The merge base is checked out as a `git worktree` in a temp folder; the same pinned isobar runs on both trees: about 15 s end to end on a 232-file PR (both isobar runs included), measured on a laptop with isobar cached.
3. A pure diff of the two `graph.json` files, keyed by file and function name with renames followed, restricted to the PR's changed files and lines.
4. Markdown for the comment, workflow-command annotations, and stable JSON.

## Limits

- One git repository is one project: a monorepo is mapped whole and `scope` narrows it to one folder. A plain folder with no `.git`, such as a folder of several projects, is refused.
- Cross-repo API contracts (a frontend and a backend in separate repos) are not matched.
- Linux and macOS runners only.
- Fork PRs get annotations and the job summary; the comment needs a token with write access and is otherwise skipped with a notice.
- Needs full history: check out with `fetch-depth: 0`. The action deepens a shallow checkout itself at the cost of an extra fetch; when the base ref or merge base is missing from a shallow history, the run exits `2` with a fetch-depth hint.
- One isobar-pr run per PR: the output folder and the sticky comment are fixed, so two runs with different `scope`s overwrite each other.

## Development

```bash
npm install
npm test                # fast unit, golden and property tests
npm run test:slow       # also runs the real isobar (needs the network)
npm run build           # dist/cli.js, committed: the action runs it without an install step
UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts   # refresh expected.md / expected.json
```

## License

MIT. isobar itself is a separate, proprietary package by the same author; isobar-pr only reads its documented `graph.json`.
