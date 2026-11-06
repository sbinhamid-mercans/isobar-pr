#!/usr/bin/env node

// src/cli.ts
import { readFileSync as readFileSync4 } from "node:fs";

// src/run/compare.ts
import { lstatSync, mkdtempSync, readFileSync as readFileSync2, realpathSync, rmSync, statSync as statSync2 } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve as resolve2 } from "node:path";

// src/report/text.ts
function code(s) {
  const flat = s.replace(/\r?\n/g, " ");
  if (flat === "") return "";
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  return longest === 0 ? `${fence}${flat}${fence}` : `${fence} ${flat} ${fence}`;
}
var MARKDOWN_PUNCTUATION = "\\`*_[]<>|@#";
var ESCAPABLE = new RegExp(`[${MARKDOWN_PUNCTUATION.replace(/[\\\]]/g, "\\$&")}]`);
var ESCAPABLE_G = new RegExp(ESCAPABLE.source, "g");
function text(s) {
  return s.replace(ESCAPABLE_G, "\\$&");
}
function textWithCode(s) {
  let out = "";
  let from = 0;
  let i = s.indexOf("`");
  while (i >= 0) {
    const n = runLength(s, i);
    const close = closingRun(s, i + n, n);
    if (close < 0) {
      i = s.indexOf("`", i + n);
      continue;
    }
    out += text(s.slice(from, i)) + s.slice(i, close + n);
    from = close + n;
    i = s.indexOf("`", from);
  }
  return out + text(s.slice(from));
}
function runLength(s, i) {
  let n = 0;
  while (s[i + n] === "`") n++;
  return n;
}
function closingRun(s, from, n) {
  let j = s.indexOf("`", from);
  while (j >= 0) {
    const m = runLength(s, j);
    if (m === n) return j;
    j = s.indexOf("`", j + m);
  }
  return -1;
}
function cell(s) {
  return text(String(s)).replace(/\s+/g, " ");
}
function plain(md) {
  let out = "";
  let i = 0;
  while (i < md.length) {
    const step = md[i] === "`" ? scanCode(md, i) : scanText(md, i);
    out += step.out;
    i = step.next;
  }
  return out.replace(/\s+/g, " ").trim();
}
function scanCode(md, i) {
  const n = runLength(md, i);
  const close = closingRun(md, i + n, n);
  if (close < 0) return { out: "", next: i + n };
  return { out: trimSpan(md.slice(i + n, close)), next: close + n };
}
function trimSpan(inner) {
  const padded = inner.length >= 2 && inner.startsWith(" ") && inner.endsWith(" ") && inner.trim() !== "";
  return padded ? inner.slice(1, -1) : inner;
}
function scanText(md, i) {
  const ch = md[i];
  const next = md[i + 1];
  if (ch === "\\" && next !== void 0 && ESCAPABLE.test(next)) return { out: next, next: i + 2 };
  if (ch === "*" && next === "*") return { out: "", next: i + 2 };
  return { out: ch, next: i + 1 };
}
function listCapped(parts, max = 3) {
  const listed = parts.slice(0, max).join(", ");
  const more = parts.length - max;
  return more > 0 ? `${listed} and ${more} more` : listed;
}
function listCodes(items, max = 3) {
  return listCapped(items.map((s) => code(s)), max);
}
function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}
function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// src/diff/config.ts
var CONFIG_FILES = [".isobar.json", ".codemap.json", ".codegraph.json", ".codegraph.toml"];
function isConfigFile(path) {
  return CONFIG_FILES.includes(path.slice(path.lastIndexOf("/") + 1));
}
function touchedConfigs(ctx) {
  return {
    named: ctx.changed.filter(isConfigFile),
    renamedAway: ctx.changed.filter((f) => !isConfigFile(f) && isConfigFile(ctx.basePath(f))),
    deleted: [...ctx.deleted].filter(isConfigFile).sort()
  };
}
function configFindings(ctx) {
  const { named, renamedAway, deleted } = touchedConfigs(ctx);
  const file = named[0] ?? renamedAway[0] ?? deleted[0];
  if (file === void 0) return [];
  const files = [...named, ...renamedAway];
  const listed = listCapped([...files.map((f) => code(f)), ...deleted.map((f) => `${code(f)} (deleted)`)]);
  return [
    {
      kind: "config-changed",
      severity: "info",
      file,
      renamedFrom: ctx.renamedFrom(file),
      inDiff: ctx.inDiff(file),
      title: `Analysis config changed in this PR (${listed}); deltas may reflect configuration, not code.`,
      data: { files, deleted }
    }
  ];
}

// src/diff/changes.ts
var ESCAPES = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7, "\\": 92, '"': 34 };
var OCTAL_DIGIT = /^[0-7]$/;
function octalRun(chars, i) {
  let oct = "";
  while (oct.length < 3 && OCTAL_DIGIT.test(chars[i + oct.length] ?? "")) oct += chars[i + oct.length];
  return oct;
}
function escapeAt(chars, i) {
  const next = chars[i] ?? "";
  const oct = octalRun(chars, i);
  if (oct !== "") return { bytes: [parseInt(oct, 8)], used: oct.length };
  if (next === "") return { bytes: [92], used: 1 };
  const named = ESCAPES[next];
  return { bytes: named !== void 0 ? [named] : [...Buffer.from(next, "utf8")], used: 1 };
}
function unquotePath(s) {
  if (s.length < 2 || !s.startsWith('"') || !s.endsWith('"')) return s;
  const chars = Array.from(s.slice(1, -1));
  const bytes = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      i++;
      continue;
    }
    const escape = escapeAt(chars, i + 1);
    bytes.push(...escape.bytes);
    i += 1 + escape.used;
  }
  return Buffer.from(bytes).toString("utf8");
}
function normalizeScope(scope) {
  if (!scope) return void 0;
  const s = scope.replace(/^\.\//, "").replace(/\/+$/, "");
  return s === "" || s === "." ? void 0 : s;
}
function addRow(out, [status = "", first, second]) {
  if (status.startsWith("R") || status.startsWith("C")) {
    if (!first || !second) return;
    const to = unquotePath(second);
    out.changed.add(to);
    if (status.startsWith("R")) out.renames.set(to, unquotePath(first));
    return;
  }
  if (first) (status === "D" ? out.deleted : out.changed).add(unquotePath(first));
}
function parseChanges(text2) {
  const out = { changed: /* @__PURE__ */ new Set(), renames: /* @__PURE__ */ new Map(), deleted: /* @__PURE__ */ new Set() };
  for (const raw of text2.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() !== "") addRow(out, line.split("	"));
  }
  return out;
}
function walkHunks(text2, visit) {
  const state = { current: void 0, inHeader: false };
  for (const raw of text2.split("\n")) {
    const hunk = hunkAt(state, raw.replace(/\r$/, ""));
    if (hunk) visit(hunk.file, hunk.start, hunk.count);
  }
}
var HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
function hunkAt(state, line) {
  if (line.startsWith("diff --git ")) {
    state.inHeader = true;
    state.current = void 0;
    return void 0;
  }
  if (state.inHeader && line.startsWith("+++ ")) {
    state.current = headSidePath(line);
    return void 0;
  }
  if (!line.startsWith("@@")) return void 0;
  state.inHeader = false;
  const file = state.current;
  return file === void 0 ? void 0 : addedSide(file, line);
}
function headSidePath(line) {
  const target2 = unquotePath(line.slice(4).replace(/\t$/, ""));
  return target2 === "/dev/null" ? void 0 : target2.replace(/^b\//, "");
}
function addedSide(file, line) {
  const m = HUNK_HEADER.exec(line);
  if (!m) return void 0;
  return { file, start: Number(m[1]), count: m[2] === void 0 ? 1 : Number(m[2]) };
}
function parseHunks(text2) {
  const hunks = /* @__PURE__ */ new Map();
  walkHunks(text2, (file, start, count) => {
    if (count === 0) return;
    const list = hunks.get(file) ?? [];
    list.push({ start, end: start + count - 1 });
    hunks.set(file, list);
  });
  return hunks;
}
function parseDeletions(text2) {
  const deletions = /* @__PURE__ */ new Map();
  walkHunks(text2, (file, start, count) => {
    if (count !== 0) return;
    const list = deletions.get(file) ?? [];
    list.push(start);
    deletions.set(file, list);
  });
  return deletions;
}
function isRootConfig(path) {
  return path !== void 0 && !path.includes("/") && isConfigFile(path);
}
function filterChanges(changes, scope) {
  const s = normalizeScope(scope);
  if (!s) return changes;
  const prefix = s + "/";
  const inScope = (p) => p.startsWith(prefix);
  const keep = (p) => inScope(p) || isRootConfig(p) || isRootConfig(changes.renames.get(p));
  return {
    changed: new Set([...changes.changed].filter(keep)),
    renames: new Map([...changes.renames].filter(([to]) => keep(to))),
    hunks: changes.hunks ? new Map([...changes.hunks].filter(([p]) => inScope(p))) : void 0,
    deletions: changes.deletions ? new Map([...changes.deletions].filter(([p]) => inScope(p))) : void 0,
    deleted: changes.deleted ? new Set([...changes.deleted].filter((p) => inScope(p) || isRootConfig(p))) : void 0
  };
}
function overlaps(ranges, start, end) {
  if (!ranges) return false;
  return ranges.some((r) => r.start <= end && r.end >= start);
}
function covers(ranges, start, end) {
  if (!ranges || end < start) return false;
  let next = start;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    if (r.start > next) return false;
    next = Math.max(next, r.end + 1);
    if (next > end) return true;
  }
  return false;
}

// src/gate.ts
var FAIL_ON_VALUES = ["none", "serious-security", "limit-crossed", "any"];
function isFailOn(v) {
  return FAIL_ON_VALUES.includes(v);
}
function gate(findings, failOn) {
  switch (failOn) {
    case "none":
      return "pass";
    case "serious-security":
      return findings.some((f) => (f.kind === "security-new" || f.kind === "security-grew") && f.severity === "serious") ? "fail" : "pass";
    case "limit-crossed":
      return findings.some(
        (f) => f.kind === "function-regression" && (Array.isArray(f.data["metrics"]) && f.data["metrics"].length > 0 || f.data["approximate"] === true)
      ) ? "fail" : "pass";
    case "any":
      return findings.some((f) => f.severity !== "info" && f.severity !== "improved") ? "fail" : "pass";
    default: {
      const bad = failOn;
      throw new Error(`unknown fail-on policy ${String(bad)}`);
    }
  }
}

// src/report/types.ts
var SEVERITY_ORDER = Object.freeze({
  serious: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  improved: 5
});

// src/diff/context.ts
function createContext(base, head, changes, opts) {
  const changed = [...changes.changed].sort();
  const changedSet = new Set(changed);
  const basePath = (p) => changes.renames.get(p) ?? p;
  const changedBase = new Set(changed.map(basePath));
  const inDiffRange = (file, start, end) => {
    if (!changes.hunks) return void 0;
    if (overlaps(changes.hunks.get(file), start, end)) return true;
    return (changes.deletions?.get(file) ?? []).some((p) => start <= p && p < end);
  };
  return {
    base,
    head,
    changes,
    opts,
    changed,
    changedBase,
    deleted: changes.deleted ?? /* @__PURE__ */ new Set(),
    basePath,
    renamedFrom: (p) => {
      const b = basePath(p);
      return b !== p ? b : void 0;
    },
    isChanged: (p) => changedSet.has(p),
    inDiff: (file, line) => line === void 0 ? changes.hunks ? changedSet.has(file) : void 0 : inDiffRange(file, line, line),
    inDiffRange,
    coversRange: (file, start, end) => changes.hunks ? covers(changes.hunks.get(file), start, end) : void 0
  };
}

// src/diff/conventions.ts
function truncated(p) {
  const listed = p.exceptions?.length ?? 0;
  return (p.exceptionCount ?? listed) > listed;
}
function label(p) {
  return { title: textWithCode(p.title), unit: p.unit ? ` ${text(p.unit)}` : "" };
}
function adviceFor(id, example) {
  if (!example) return void 0;
  return id.startsWith("barrel:") ? `Import through ${code(example)} instead.` : `Copy ${code(example)} instead.`;
}
function isAmbiguous(baseListed, baseCut, basePathOf) {
  const lastListedBase = baseListed.at(-1);
  return (file) => baseCut && (lastListedBase === void 0 || compareText(basePathOf(file), lastListedBase) > 0);
}
function brokenFindings(ctx, id, base, head, newExceptions) {
  const { title, unit } = label(head);
  const ambiguous = isAmbiguous(base.exceptions ?? [], truncated(base), (f) => ctx.basePath(f));
  return newExceptions.map((file) => {
    const maybeOld = ambiguous(file);
    return {
      kind: "convention-broken",
      severity: maybeOld ? "low" : head.strength === "rule" ? "medium" : "low",
      file,
      renamedFrom: ctx.renamedFrom(file),
      inDiff: ctx.inDiff(file),
      title: `**${title}** (${head.follow} of ${head.total}${unit} follow it)`,
      detail: maybeOld ? "breaks it (may be pre-existing: isobar truncated the base exception list)." : "breaks it.",
      advice: adviceFor(id, head.example),
      data: { patternId: id, strength: head.strength, follow: head.follow, total: head.total, example: head.example ?? null, rule: head.rule, truncated: maybeOld }
    };
  });
}
function weakenedFinding(ctx, id, base, head, file) {
  const { title, unit } = label(head);
  return {
    kind: "convention-weakened",
    severity: "low",
    file,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.inDiff(file),
    title: `**${title}** weakened: rule \u2192 mostly (${base.follow} of ${base.total} \u2192 ${head.follow} of ${head.total}${unit})`,
    data: { patternId: id, from: "rule", to: "mostly", baseFollow: base.follow, baseTotal: base.total, headFollow: head.follow, headTotal: head.total }
  };
}
function patternFindings(ctx, id, base, head) {
  const changedHeadExceptions = (head.exceptions ?? []).filter((f) => ctx.isChanged(f)).sort();
  const baseExceptions = new Set(base.exceptions ?? []);
  const newExceptions = changedHeadExceptions.filter((f) => !baseExceptions.has(ctx.basePath(f)));
  const out = brokenFindings(ctx, id, base, head, newExceptions);
  const anchor2 = newExceptions[0] ?? changedHeadExceptions[0];
  if (base.strength === "rule" && head.strength === "mostly" && anchor2 !== void 0) out.push(weakenedFinding(ctx, id, base, head, anchor2));
  return out;
}
function conventionFindings(ctx) {
  const out = [];
  for (const [id, head] of ctx.head.patternsById) {
    const base = ctx.base.patternsById.get(id);
    if (base && (head.strength === "rule" || head.strength === "mostly")) out.push(...patternFindings(ctx, id, base, head));
  }
  return out;
}

// src/diff/cycles.ts
function toCycle(files, basePathOf) {
  const members = new Set(files.map(basePathOf));
  return { files: [...new Set(files)].sort(), id: [...members].sort().join("\n"), members };
}
function isSubset(small, big) {
  for (const f of small) if (!big.has(f)) return false;
  return true;
}
function isStrictSubset(small, big) {
  return small.size < big.size && isSubset(small, big);
}
function largest(cycles) {
  return cycles.reduce((best, c) => best === void 0 || c.members.size > best.members.size ? c : best, void 0);
}
function anchor(ctx, file) {
  return { file, renamedFrom: ctx.renamedFrom(file), inDiff: ctx.inDiff(file) };
}
function headCycleFinding(ctx, h, baseCycles, baseIds) {
  const file = h.files.find((f) => ctx.isChanged(f));
  if (file === void 0 || baseIds.has(h.id)) return void 0;
  const grown = largest(baseCycles.filter((b) => isStrictSubset(b.members, h.members)));
  if (grown) {
    const added = h.files.filter((f) => !grown.members.has(ctx.basePath(f)));
    return {
      kind: "cycle-grew",
      severity: "high",
      ...anchor(ctx, file),
      title: `circular import grew to ${h.files.length} files (+${added.length}): ${listCodes(added)}`,
      data: { files: h.files, added }
    };
  }
  if (baseCycles.some((b) => isStrictSubset(h.members, b.members))) return void 0;
  return {
    kind: "cycle-new",
    severity: "high",
    ...anchor(ctx, file),
    title: `new circular import across ${h.files.length} files: ${listCodes(h.files)}`,
    data: { files: h.files }
  };
}
function baseCycleFinding(ctx, b, headCycles) {
  const file = ctx.changed.find((f) => b.members.has(ctx.basePath(f)));
  if (file === void 0 || headCycles.some((h) => isSubset(b.members, h.members))) return void 0;
  const remnant = largest(headCycles.filter((h) => isStrictSubset(h.members, b.members)));
  return {
    kind: "cycle-broken",
    severity: "improved",
    ...anchor(ctx, file),
    title: remnant ? `circular import shrank from ${b.files.length} to ${remnant.files.length} files` : `circular import broken (${b.files.length} files)`,
    data: { files: b.files, shrankTo: remnant ? remnant.files : null }
  };
}
function cycleFindings(ctx) {
  const baseCycles = ctx.base.cycles.map((files) => toCycle(files, (p) => p));
  const headCycles = ctx.head.cycles.map((files) => toCycle(files, (p) => ctx.basePath(p)));
  const baseIds = new Set(baseCycles.map((c) => c.id));
  const found = [...headCycles.map((h) => headCycleFinding(ctx, h, baseCycles, baseIds)), ...baseCycles.map((b) => baseCycleFinding(ctx, b, headCycles))];
  return found.filter((f) => f !== void 0);
}

// src/diff/functions.ts
var SUPERSCRIPT = { "\xB2": 2, "\xB3": 3, "\u2074": 4 };
var SUPERSCRIPT_CLASS = `[${Object.keys(SUPERSCRIPT).join("")}]`;
var FACTOR = new RegExp(`^([a-z])(?:\\^(\\d+)|(${SUPERSCRIPT_CLASS}))?$`);
var LOG_SUFFIX = new RegExp(`^(?:(.+?) )?log(?:\\^\\d+|${SUPERSCRIPT_CLASS})? n$`);
var POLY_RANKS = [0, 2, 4, 5];
var LOG_RANKS = [1, 3, 4.5, 5];
function polyDegree(s) {
  let degree = 0;
  for (const factor of s.split("\xB7")) {
    const m = FACTOR.exec(factor.trim());
    if (!m) return void 0;
    degree += m[2] !== void 0 ? Number(m[2]) : m[3] !== void 0 ? SUPERSCRIPT[m[3]] : 1;
  }
  return degree > 0 ? degree : void 0;
}
function rankOf(degree, ranks) {
  return degree === void 0 ? void 0 : ranks[Math.min(degree, ranks.length - 1)];
}
function timeRank(time) {
  if (time === void 0) return void 0;
  const inner = time.trim().replace(/^O\((.*)\)$/, "$1").trim();
  if (inner === "1") return 0;
  if (/^2(\^n|ⁿ)$/.test(inner)) return 6;
  if (/or more$/.test(inner)) return 5;
  const log = LOG_SUFFIX.exec(inner);
  if (!log) return rankOf(polyDegree(inner), POLY_RANKS);
  return rankOf(log[1] === void 0 ? 0 : polyDegree(log[1]), LOG_RANKS);
}
var METRIC_LABEL = {
  cognitive: "cognitive",
  cyclomatic: "cyclomatic",
  nesting: "nesting",
  lines: "lines",
  params: "parameters"
};
function isMetric(name) {
  return Object.hasOwn(METRIC_LABEL, name);
}
var MATCHED = { matched: true, newFile: false, isNew: false, wasWithinLimits: false, suffix: "" };
var SLOW_RANK = 4;
var ISSUE_RANK = /* @__PURE__ */ new Map([
  ["serious", 0],
  ["high", 1],
  ["medium", 2],
  ["low", 3]
]);
var LIMIT_RESTATING_KINDS = /* @__PURE__ */ new Set(["logic", "long-function", "long-component", "paths", "switch", "chain", "nesting", "params"]);
function minus(a, b, key = String) {
  const drop = new Set(b.map(key));
  return a.filter((x) => !drop.has(key(x)));
}
function overOf(fn) {
  return [...new Set(fn?.over ?? [])].sort();
}
function isTestFile(idx, file) {
  return idx.graph.files[file]?.kind === "test";
}
function ruleOver(fn, testFile) {
  const over = overOf(fn);
  return testFile ? over.filter((name) => name !== "lines") : over;
}
function endOf(fn) {
  return fn.end_line ?? fn.line;
}
function limitOf(limits, name) {
  return Object.hasOwn(limits, name) ? limits[name] ?? 0 : 0;
}
function metricValue(fn, name) {
  return fn !== void 0 && isMetric(name) ? fn[name] ?? null : null;
}
function metricDelta(limits, name, base, head) {
  return { name, limit: limitOf(limits, name), base: metricValue(base, name), head: metricValue(head, name) };
}
function whyLines(why) {
  return (why ?? []).map((w) => `L${w.line}: ${w.text}`);
}
function toIssue(i) {
  return { kind: i.kind, severity: i.severity, title: i.title, how: i.how ?? "", why: i.why ?? "" };
}
function issueRank(i) {
  return ISSUE_RANK.get(i.severity) ?? ISSUE_RANK.size;
}
function mostSevere(issues) {
  let best;
  for (const i of issues) if (best === void 0 || issueRank(i) < issueRank(best)) best = i;
  return best;
}
function issueTitles(issues, hasLimitLabels) {
  const kept = hasLimitLabels ? issues.filter((i) => !LIMIT_RESTATING_KINDS.has(i.kind)) : issues;
  const unique = [...new Set(kept.map((i) => i.title))];
  const shown = unique.slice(0, 2).map(text);
  if (unique.length > 2) shown.push(`+${unique.length - 2} more`);
  return shown;
}
function fmt(v) {
  return v === null ? "\u2013" : String(v);
}
function label2(name) {
  return isMetric(name) ? METRIC_LABEL[name] : text(name);
}
function timeText(t) {
  return t === null ? "\u2013" : text(t);
}
function timeFrom(t) {
  return t.base === null ? "" : `${text(t.base)} \u2192 `;
}
function timeChange(head, base) {
  const headTime = head.time;
  const baseTime = base?.time;
  if (headTime === void 0 || baseTime === void 0) return {};
  const h = timeRank(headTime);
  const b = timeRank(baseTime);
  if (h === void 0 || b === void 0 || h === b) return {};
  return h > b ? { up: { base: baseTime, head: headTime, why: whyLines(head.time_why) } } : { down: { base: baseTime, head: headTime, why: whyLines(base?.time_why) } };
}
function slowTime(fn) {
  return fn.time !== void 0 && (timeRank(fn.time) ?? 0) >= SLOW_RANK ? fn.time : void 0;
}
function changedIssues(issues, limitsMoved) {
  return limitsMoved ? issues : issues.filter((i) => !LIMIT_RESTATING_KINDS.has(i.kind));
}
function measure(limits, head, base) {
  const delta = (name) => metricDelta(limits, name, base, head);
  const byKind = (i) => i.kind;
  const headIssues = head.refactor ?? [];
  const baseIssues = base?.refactor ?? [];
  const crossed = minus(overOf(head), overOf(base)).map(delta);
  const left = minus(overOf(base), overOf(head)).map(delta);
  return {
    crossed,
    left,
    time: timeChange(head, base),
    newIssues: changedIssues(minus(headIssues, baseIssues, byKind).map(toIssue), crossed.length > 0),
    goneIssues: changedIssues(minus(baseIssues, headIssues, byKind).map(toIssue), left.length > 0)
  };
}
function originOf(ctx, file, fn) {
  const newFile = !Object.hasOwn(ctx.base.graph.files, ctx.basePath(file));
  const covered = ctx.coversRange(file, fn.line, endOf(fn));
  const isNew = newFile || covered === true;
  const wasWithinLimits = !isNew && covered === false;
  const suffix = isNew ? " \xB7 new" : wasWithinLimits ? " \xB7 was within every limit" : " \xB7 not measured in base";
  return { matched: false, newFile, isNew, wasWithinLimits, suffix };
}
function describeRegression(m, worst, origin) {
  const parts = m.crossed.map(
    (d) => `${label2(d.name)} ${origin.matched ? `${fmt(d.base)} \u2192 ` : ""}**${fmt(d.head)}** (limit ${d.limit})`
  );
  const up = m.time.up;
  if (up) parts.push(`${timeFrom(up)}**${timeText(up.head)}**${up.why[0] !== void 0 ? ` (${text(up.why[0])})` : ""}`);
  if (parts.length === 0 && worst) parts.push(text(worst.title));
  return parts.join(", ") + origin.suffix;
}
function describeImprovement(m) {
  const parts = m.left.map((d) => `${label2(d.name)} ${fmt(d.base)} \u2192 ${fmt(d.head)}, now within limit ${d.limit}`);
  const down = m.time.down;
  if (down) parts.push(`${timeFrom(down)}${timeText(down.head)}`);
  for (const t of issueTitles(m.goneIssues, m.left.length > 0)) parts.push(`${t} resolved`);
  return parts.join(", ");
}
function regressionSeverity(up, worst, origin) {
  const slowerThanBase = up !== void 0 && (origin.matched || origin.wasWithinLimits);
  return slowerThanBase || worst !== void 0 && issueRank(worst) <= 1 ? "high" : "medium";
}
function regressionFinding(head, m, where2, origin) {
  const up = m.time.up;
  if (m.crossed.length === 0 && up === void 0 && m.newIssues.length === 0) return void 0;
  const worst = mostSevere(m.newIssues);
  return {
    kind: "function-regression",
    severity: regressionSeverity(up, worst, origin),
    ...where2,
    title: `${code(head.name)} \u2014 ${describeRegression(m, worst, origin)}`,
    advice: worst && worst.how !== "" ? textWithCode(worst.how) : void 0,
    data: {
      name: head.name,
      ordinal: head.ordinal,
      metrics: m.crossed,
      time: up ?? null,
      issues: m.newIssues,
      isNew: origin.isNew,
      wasWithinLimits: origin.wasWithinLimits,
      newFile: origin.newFile
    }
  };
}
function improvementFinding(head, m, where2) {
  const down = m.time.down;
  if (m.left.length === 0 && down === void 0 && m.goneIssues.length === 0) return void 0;
  return {
    kind: "function-improved",
    severity: "improved",
    ...where2,
    title: `${code(head.name)} \u2014 ${describeImprovement(m)}`,
    data: { name: head.name, ordinal: head.ordinal, metrics: m.left, time: down ?? null, issues: m.goneIssues }
  };
}
function compareFunction(ctx, file, head, base) {
  const m = measure(ctx.head.limits, head.fn, base?.fn);
  const origin = base ? MATCHED : originOf(ctx, file, head.fn);
  const slow = origin.matched ? void 0 : slowTime(head.fn);
  if (slow !== void 0) m.time.up = { base: null, head: slow, why: whyLines(head.fn.time_why) };
  const where2 = {
    file,
    line: head.fn.line,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.inDiffRange(file, head.fn.line, endOf(head.fn))
  };
  return [regressionFinding(head, m, where2, origin), improvementFinding(head, m, where2)].filter(
    (f) => f !== void 0
  );
}
function groupBy(items, key) {
  const groups = /* @__PURE__ */ new Map();
  for (const x of items) {
    const k = key(x);
    const list = groups.get(k);
    if (list) list.push(x);
    else groups.set(k, [x]);
  }
  return groups;
}
function fingerprint(fn) {
  return JSON.stringify([overOf(fn), timeRank(fn.time) ?? null, (fn.refactor ?? []).map((i) => i.kind).sort()]);
}
function unpaired(heads, bases) {
  const free = groupBy(bases, (b) => fingerprint(b.fn));
  const used = /* @__PURE__ */ new Set();
  const restHeads = [];
  for (const h of heads) {
    const match = free.get(fingerprint(h.fn))?.shift();
    if (match) used.add(match);
    else restHeads.push(h);
  }
  return { heads: restHeads, bases: bases.filter((b) => !used.has(b)) };
}
function overCount(refs, testFile = false) {
  return refs.filter((r) => ruleOver(r.fn, testFile).length > 0).length;
}
function approximate(ctx, file, group, rest) {
  const baseCount = overCount(group.bases);
  const headCount = overCount(group.heads);
  if (baseCount === headCount) return [];
  const touched = rest.heads.filter((h) => ctx.inDiffRange(file, h.fn.line, endOf(h.fn)) === true);
  const anchor2 = touched.find((h) => overOf(h.fn).length > 0) ?? touched[0] ?? rest.heads[0];
  const name = anchor2.name;
  const common = {
    file,
    line: anchor2.fn.line,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.changes.hunks === void 0 ? void 0 : touched.length > 0,
    title: `${code(name)} \xD7${group.heads.length} \u2014 ${headCount} over a limit, was ${baseCount}`,
    detail: "approximate match: the number of functions with this name changed",
    data: { name, metrics: [], issues: [], time: null, approximate: true, overBase: baseCount, overHead: headCount }
  };
  return headCount > baseCount ? [{ kind: "function-regression", severity: "medium", ...common }] : [{ kind: "function-improved", severity: "improved", ...common }];
}
function vanishedVerb(shown) {
  const onlyLimits = shown.time === 0 && shown.issues === 0;
  const onlyIssues = shown.limits === 0 && shown.time === 0;
  if (onlyLimits) return "no longer over a limit";
  return onlyIssues ? "resolved" : "no longer reported";
}
function vanishedFinding(ctx, file, b) {
  const over = overOf(b.fn);
  const slow = slowTime(b.fn);
  const issues = (b.fn.refactor ?? []).map(toIssue);
  if (over.length === 0 && slow === void 0 && issues.length === 0) return void 0;
  const times = slow === void 0 ? [] : [text(slow)];
  const titles = issueTitles(issues, over.length > 0);
  const verb = vanishedVerb({ limits: over.length, time: times.length, issues: titles.length });
  const limits = ctx.head.limits;
  return {
    kind: "function-improved",
    severity: "improved",
    file,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.inDiff(file),
    title: `${code(b.name)} \u2014 ${[...over.map(label2), ...times, ...titles].join(", ")} ${verb} (simplified, moved or removed)`,
    data: {
      name: b.name,
      ordinal: b.ordinal,
      metrics: over.map((n) => metricDelta(limits, n, b.fn, void 0)),
      time: slow === void 0 ? null : { base: slow, head: null, why: whyLines(b.fn.time_why) },
      issues,
      vanished: true
    }
  };
}
function vanished(ctx, file, bases) {
  return bases.map((b) => vanishedFinding(ctx, file, b)).filter((f) => f !== void 0);
}
function matchGroup(ctx, file, group) {
  const rest = unpaired(group.heads, group.bases);
  if (rest.heads.length === 0) return vanished(ctx, file, rest.bases);
  if (rest.bases.length === 0 || rest.bases.length === rest.heads.length) {
    return rest.heads.flatMap((h, i) => compareFunction(ctx, file, h, rest.bases[i]));
  }
  return approximate(ctx, file, group, rest);
}
var LINES_ISSUE_KINDS = /* @__PURE__ */ new Set(["long-function", "long-component"]);
function withoutLinesLimit(r) {
  const refactor = r.fn.refactor?.filter((i) => !LINES_ISSUE_KINDS.has(i.kind));
  return { ...r, fn: { ...r.fn, over: ruleOver(r.fn, true), refactor } };
}
function compared(ctx, file, refs) {
  return isTestFile(ctx.head, file) ? refs.map(withoutLinesLimit) : refs;
}
function functionFindings(ctx) {
  const out = [];
  for (const file of ctx.changed) {
    const headRefs = ctx.head.functionsByFile.get(file);
    if (!headRefs) continue;
    const headGroups = groupBy(compared(ctx, file, headRefs), (r) => r.name);
    const baseGroups = groupBy(compared(ctx, file, ctx.base.functionsByFile.get(ctx.basePath(file)) ?? []), (r) => r.name);
    for (const name of /* @__PURE__ */ new Set([...headGroups.keys(), ...baseGroups.keys()])) {
      out.push(...matchGroup(ctx, file, { heads: headGroups.get(name) ?? [], bases: baseGroups.get(name) ?? [] }));
    }
  }
  return out;
}

// src/diff/hotspots.ts
function hotspotFindings(ctx) {
  const out = [];
  for (const file of ctx.changed) {
    const basePath = ctx.basePath(file);
    const h = ctx.base.hotspotsByFile.get(basePath);
    if (!h) continue;
    if (ctx.changes.hunks && ctx.inDiffRange(file, 0, Number.MAX_SAFE_INTEGER) !== true) continue;
    const tests = Math.max(ctx.base.testImportersByFile.get(basePath) ?? 0, ctx.head.testImportersByFile.get(file) ?? 0);
    out.push({
      kind: "hotspot-touched",
      severity: tests > 0 ? "low" : "medium",
      file,
      renamedFrom: ctx.renamedFrom(file),
      inDiff: ctx.inDiff(file),
      title: `base hotspot rank **${h.rank}** (${h.commits} commit${h.commits === 1 ? "" : "s"}, total cognitive ${h.cognitive}), imported by ${tests} test${tests === 1 ? "" : "s"}`,
      advice: "Keep changes small and tested.",
      data: { rank: h.rank, score: h.score, commits: h.commits, cognitive: h.cognitive, testImporters: tests }
    });
  }
  return out;
}

// src/graph/types.ts
var DEFAULT_LIMITS = Object.freeze({
  cognitive: 15,
  cyclomatic: 10,
  nesting: 4,
  lines: 100,
  params: 5
});

// src/graph/index.ts
function isMatchableCall(c) {
  return !c.dynamic && c.path != null && !c.external;
}
function warningKey(file, text2) {
  return `${file}\0${text2}`;
}
function functionRefs(file, functions) {
  const nextOrdinal = /* @__PURE__ */ new Map();
  return functions.map((fn) => {
    const ordinal = nextOrdinal.get(fn.name) ?? 0;
    nextOrdinal.set(fn.name, ordinal + 1);
    return { file, name: fn.name, ordinal, fn };
  });
}
function testFiles(files) {
  const tests = /* @__PURE__ */ new Map();
  for (const [path, entry] of Object.entries(files)) {
    if (entry.kind === "test") tests.set(path, new Set(entry.type_only ?? []));
  }
  return tests;
}
function testImporterCount(file, importers, tests) {
  let count = 0;
  for (const p of importers) {
    const typeOnly = tests.get(p);
    if (typeOnly !== void 0 && !typeOnly.has(file)) count++;
  }
  return count;
}
function hasMatchableCall(files) {
  return Object.values(files).some((entry) => entry.kind !== "test" && (entry.calls ?? []).some(isMatchableCall));
}
function hotspotIndex(hotspots) {
  const byFile = /* @__PURE__ */ new Map();
  for (const h of hotspots) {
    if (!byFile.has(h.file)) byFile.set(h.file, h);
  }
  return byFile;
}
function warningIndex(graph) {
  const warnings = graph.security?.warnings ?? [];
  return {
    warningsByKey: new Map(warnings.map((w) => [warningKey(w.file, w.text), w])),
    warningsTruncated: (graph.security?.warningCount ?? warnings.length) > warnings.length
  };
}
function fileIndex(files) {
  const functionsByFile = /* @__PURE__ */ new Map();
  const testImportersByFile = /* @__PURE__ */ new Map();
  const tests = testFiles(files);
  for (const [file, entry] of Object.entries(files)) {
    functionsByFile.set(file, functionRefs(file, entry.functions ?? []));
    testImportersByFile.set(file, testImporterCount(file, entry.imported_by ?? [], tests));
  }
  return { functionsByFile, testImportersByFile };
}
function isHttpActive(graph) {
  return (graph.http?.routes?.length ?? 0) > 0 && hasMatchableCall(graph.files);
}
function buildIndex(graph) {
  const { functionsByFile, testImportersByFile } = fileIndex(graph.files);
  return {
    graph,
    toolVersion: graph.tool_version,
    limits: { ...DEFAULT_LIMITS, ...graph.complexity?.limits ?? {} },
    functionsByFile,
    hotspotsByFile: hotspotIndex(graph.hotspots ?? []),
    patternsById: new Map((graph.conventions?.patterns ?? []).map((p) => [p.id, p])),
    ...warningIndex(graph),
    cycles: graph.cycles ?? [],
    testImportersByFile,
    httpActive: isHttpActive(graph)
  };
}

// src/diff/http.ts
function isUnmatched(c) {
  return isMatchableCall(c) && !c.target;
}
var httpKey = (r) => `${r.method} ${r.path}`;
function nonTest(entry) {
  return entry?.kind === "test" ? void 0 : entry;
}
function nonTestCalls(entry) {
  return nonTest(entry)?.calls ?? [];
}
function tally(entry) {
  const calls = nonTestCalls(entry);
  const dynamic = calls.filter((c) => c.dynamic).length;
  return [calls.length - dynamic, dynamic];
}
function callCounts(ctx) {
  const counts = { staticBase: 0, staticHead: 0, dynamicBase: 0, dynamicHead: 0 };
  let anchor2;
  for (const file of ctx.changed) {
    const [staticHead, dynamicHead] = tally(ctx.head.graph.files[file]);
    const [staticBase, dynamicBase] = tally(ctx.base.graph.files[ctx.basePath(file)]);
    counts.staticBase += staticBase;
    counts.staticHead += staticHead;
    counts.dynamicBase += dynamicBase;
    counts.dynamicHead += dynamicHead;
    if (anchor2 === void 0 && (staticHead !== staticBase || dynamicHead !== dynamicBase)) anchor2 = file;
  }
  return { counts, anchor: anchor2 };
}
function infoFinding(ctx) {
  const { counts: n, anchor: file } = callCounts(ctx);
  if (file === void 0 || n.staticHead === n.staticBase && n.dynamicHead === n.dynamicBase) return void 0;
  const why = (ctx.head.graph.http?.routes?.length ?? 0) > 0 ? "no static calls in this repo to match its routes against" : "no routes in this repo to match them against";
  return {
    kind: "http-info",
    severity: "info",
    file,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.inDiff(file),
    title: `HTTP calls in changed files: ${signed(n.staticHead - n.staticBase)} static, ${signed(n.dynamicHead - n.dynamicBase)} dynamic \u2014 ${why}`,
    data: n
  };
}
function unmatchedCallFindings(ctx, file, head, base) {
  const known = new Set(nonTestCalls(base).filter(isUnmatched).map(httpKey));
  return (head.calls ?? []).filter((c) => isUnmatched(c) && !known.has(httpKey(c))).map((c) => ({
    kind: "http-unmatched-call",
    severity: "medium",
    file,
    line: c.line,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.inDiff(file, c.line),
    title: `${code(httpKey(c))} has no matching route`,
    data: { method: c.method, path: c.path }
  }));
}
function uncalledRouteFindings(ctx, file, head, base) {
  const known = new Set((nonTest(base)?.serves ?? []).map(httpKey));
  return (head.serves ?? []).filter((r) => (r.callers ?? []).length === 0 && !known.has(httpKey(r))).map((r) => ({
    kind: "http-uncalled-route",
    severity: "low",
    file,
    line: r.line,
    renamedFrom: ctx.renamedFrom(file),
    inDiff: ctx.inDiff(file, r.line),
    title: `${code(httpKey(r))} is a new route no client in this repo calls`,
    data: { method: r.method, path: r.path }
  }));
}
function fileFindings(ctx, file) {
  const head = nonTest(ctx.head.graph.files[file]);
  if (!head) return [];
  const base = ctx.base.graph.files[ctx.basePath(file)];
  const uncalled = ctx.opts.reportUncalledRoutes ? uncalledRouteFindings(ctx, file, head, base) : [];
  return [...unmatchedCallFindings(ctx, file, head, base), ...uncalled];
}
function httpFindings(ctx) {
  if (!ctx.head.httpActive) {
    const info = infoFinding(ctx);
    return info ? [info] : [];
  }
  return ctx.changed.flatMap((file) => fileFindings(ctx, file));
}

// src/diff/security.ts
var TRUNCATED_NOTE = "may be pre-existing: isobar truncated the base warning list";
function linesOf(w) {
  return w.lines && w.lines.length > 0 ? w.lines : [w.line];
}
function maybeCut(listed, level, basePath) {
  const last = listed.at(-1);
  if (last === void 0 || level !== "serious" && level !== "advisory") return true;
  if (level === "serious" && last.level === "advisory") return false;
  const sameGroup = (w) => w.level === level && w.file === basePath;
  return sameGroup(last) || !listed.some(sameGroup);
}
function addedLines(ctx, w) {
  return linesOf(w).filter((l) => ctx.inDiff(w.file, l) === true);
}
function shared(ctx, w) {
  return { file: w.file, renamedFrom: ctx.renamedFrom(w.file), title: `**${text(w.level)}** \u2014 ${textWithCode(w.text)}` };
}
function newFinding(ctx, w, ambiguous) {
  const lines = linesOf(w);
  const line = addedLines(ctx, w)[0] ?? lines[0];
  const snippet = code(w.code?.trim() ?? "") || void 0;
  const note = snippet ? `${TRUNCATED_NOTE} \u2014 ${snippet}` : `${TRUNCATED_NOTE}.`;
  return {
    kind: "security-new",
    severity: !ambiguous && w.level === "serious" ? "serious" : "medium",
    ...shared(ctx, w),
    line,
    inDiff: ctx.inDiff(w.file, line),
    detail: ambiguous ? note : snippet,
    data: { level: w.level, text: w.text, lines, code: w.code ?? null, truncated: ambiguous }
  };
}
function grewFinding(ctx, w, base) {
  const lines = linesOf(w);
  const baseCount = linesOf(base).length;
  const added = lines.length - baseCount;
  if (added <= 0) return void 0;
  const inHunk = addedLines(ctx, w);
  const line = inHunk[0] ?? lines.at(-1);
  const at = inHunk.length > 0 ? `, at L${inHunk.join(", L")}` : "";
  return {
    kind: "security-grew",
    severity: w.level === "serious" ? "serious" : "medium",
    ...shared(ctx, w),
    line,
    inDiff: ctx.inDiff(w.file, line),
    detail: `${plural(added, "more occurrence")} (${baseCount} \u2192 ${lines.length})${at}`,
    data: { level: w.level, text: w.text, added, lines: inHunk, code: w.code ?? null, truncated: false }
  };
}
function securityFindings(ctx) {
  const baseListed = ctx.base.graph.security?.warnings ?? [];
  const out = [];
  for (const w of ctx.head.warningsByKey.values()) {
    if (!ctx.isChanged(w.file)) continue;
    const basePath = ctx.basePath(w.file);
    const base = ctx.base.warningsByKey.get(warningKey(basePath, w.text));
    if (base === void 0) {
      out.push(newFinding(ctx, w, ctx.base.warningsTruncated && maybeCut(baseListed, w.level, basePath)));
      continue;
    }
    const grown = grewFinding(ctx, w, base);
    if (grown) out.push(grown);
  }
  return out;
}

// src/diff/preexisting.ts
function overKey(name, over) {
  return JSON.stringify([name, over]);
}
function baseCounts(refs, testFile) {
  const counts = /* @__PURE__ */ new Map();
  for (const r of refs) {
    const over = ruleOver(r.fn, testFile);
    if (over.length === 0) continue;
    const key = overKey(r.name, over);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
function unchangedFunctions(ctx, file) {
  const testFile = isTestFile(ctx.head, file);
  const free = baseCounts(ctx.base.functionsByFile.get(ctx.basePath(file)) ?? [], testFile);
  const out = [];
  for (const h of ctx.head.functionsByFile.get(file) ?? []) {
    const over = ruleOver(h.fn, testFile);
    if (over.length === 0 || ctx.coversRange(file, h.fn.line, endOf(h.fn)) === true) continue;
    const key = overKey(h.name, over);
    const left = free.get(key) ?? 0;
    if (left === 0) continue;
    free.set(key, left - 1);
    out.push({ file, line: h.fn.line, text: `${text(h.name)} over ${over.map(text).join(", ")}` });
  }
  return out;
}
function unchangedWarnings(ctx) {
  const out = [];
  for (const w of ctx.head.warningsByKey.values()) {
    if (!ctx.isChanged(w.file)) continue;
    const base = ctx.base.warningsByKey.get(warningKey(ctx.basePath(w.file), w.text));
    if (base === void 0 || linesOf(base).length !== linesOf(w).length) continue;
    out.push({ file: w.file, line: w.line, text: `${text(w.level)}: ${text(w.text)}` });
  }
  return out;
}
function byPlace(a, b) {
  return compareText(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || compareText(a.text, b.text);
}
function preExisting(ctx) {
  return [...ctx.changed.flatMap((file) => unchangedFunctions(ctx, file)), ...unchangedWarnings(ctx)].sort(byPlace);
}

// src/diff/summary.ts
function sumFiles(side, count) {
  const files = side.idx.graph.files;
  let n = 0;
  for (const f of side.files) if (Object.hasOwn(files, f)) n += count(files[f]);
  return n;
}
function overLimitCount(side) {
  let n = 0;
  for (const f of side.files) n += overCount(side.idx.functionsByFile.get(f) ?? [], isTestFile(side.idx, f));
  return n;
}
function unmatchedCount(entry) {
  return nonTestCalls(entry).filter(isUnmatched).length;
}
function warningOccurrences(side) {
  let serious = 0;
  let advisory = 0;
  for (const w of side.idx.warningsByKey.values()) {
    if (!side.files.has(w.file)) continue;
    const n = linesOf(w).length;
    if (w.level === "serious") serious += n;
    else advisory += n;
  }
  return { serious, advisory };
}
function exceptionCount(side) {
  let n = 0;
  for (const p of side.idx.patternsById.values()) {
    for (const f of new Set(p.exceptions ?? [])) if (side.files.has(f)) n++;
  }
  return n;
}
function touches(cycle, files) {
  return cycle.some((f) => files.has(f));
}
function totals(side) {
  return {
    cognitive: sumFiles(side, (e) => e.complexity?.cognitive ?? 0),
    over: overLimitCount(side),
    exceptions: exceptionCount(side),
    ...warningOccurrences(side),
    cycles: side.idx.cycles.filter((c) => touches(c, side.files)).length,
    unmatched: sumFiles(side, unmatchedCount)
  };
}
function row(key, label3, base, head) {
  return { key, label: label3, base, head, delta: signed(head - base) };
}
function summaryRows(ctx) {
  const b = totals({ idx: ctx.base, files: ctx.changedBase });
  const h = totals({ idx: ctx.head, files: new Set(ctx.changed) });
  const rows = [
    row("cognitive", "Cognitive complexity", b.cognitive, h.cognitive),
    row("over-limit", "Functions over a limit", b.over, h.over),
    row("convention-exceptions", "Convention exceptions", b.exceptions, h.exceptions),
    {
      key: "security",
      label: "Security warnings serious / advisory",
      base: `${b.serious} / ${b.advisory}`,
      head: `${h.serious} / ${h.advisory}`,
      delta: `${signed(h.serious - b.serious)} / ${signed(h.advisory - b.advisory)}`
    },
    row("cycles", "Circular imports", b.cycles, h.cycles)
  ];
  if (ctx.head.httpActive) rows.push(row("http-unmatched", "HTTP calls with no route", b.unmatched, h.unmatched));
  return rows;
}

// src/diff/unresolved.ts
var REMOTE = /^[a-z][a-z0-9+.-]*:\/\//i;
function target(u) {
  if (u.spec) return REMOTE.test(u.spec) ? void 0 : { id: `s:${u.spec}`, label: `import ${code(u.spec)}` };
  if (u.expr) return { id: `e:${u.expr}`, label: `computed import ${code(u.expr)}` };
  return void 0;
}
var unresolvedKey = (file, t) => `${file}\0${t.id}`;
function baseKeys(ctx) {
  const keys = /* @__PURE__ */ new Set();
  for (const u of ctx.base.graph.unresolved ?? []) {
    const t = target(u);
    if (t) keys.add(unresolvedKey(u.file, t));
  }
  return keys;
}
function newFinding2(ctx, u, t) {
  return {
    kind: "unresolved-new",
    severity: "low",
    file: u.file,
    line: u.line,
    renamedFrom: ctx.renamedFrom(u.file),
    inDiff: ctx.inDiff(u.file, u.line),
    title: `${t.label} could not be resolved${u.reason ? ` (${text(u.reason)})` : ""}`,
    data: { spec: u.spec ?? null, expr: u.expr ?? null, reason: u.reason ?? null }
  };
}
function unresolvedFindings(ctx) {
  const known = baseKeys(ctx);
  const out = [];
  for (const u of ctx.head.graph.unresolved ?? []) {
    const t = target(u);
    if (t && ctx.isChanged(u.file) && !known.has(unresolvedKey(ctx.basePath(u.file), t))) out.push(newFinding2(ctx, u, t));
  }
  return out;
}

// src/diff/index.ts
var KIND_ORDER = [
  "config-changed",
  "function-regression",
  "hotspot-touched",
  "convention-broken",
  "convention-weakened",
  "security-new",
  "security-grew",
  "cycle-new",
  "cycle-grew",
  "http-unmatched-call",
  "http-uncalled-route",
  "http-info",
  "unresolved-new",
  "function-improved",
  "cycle-broken"
];
var SECTION_RANK = Object.freeze({
  "config-changed": 0,
  "function-regression": 1,
  "hotspot-touched": 2,
  "convention-broken": 3,
  "convention-weakened": 3,
  "security-new": 4,
  "security-grew": 4,
  "cycle-new": 5,
  "cycle-grew": 5,
  "http-unmatched-call": 6,
  "http-uncalled-route": 6,
  "http-info": 6,
  "unresolved-new": 7,
  "function-improved": 8,
  "cycle-broken": 8
});
function sortFindings(findings) {
  const key = (f) => [SECTION_RANK[f.kind], f.inDiff === false ? 1 : 0, SEVERITY_ORDER[f.severity]];
  return [...findings].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return compareText(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || compareText(a.title, b.title);
  });
}
function diffGraphs(base, head, changes, opts) {
  const ctx = createContext(base, head, changes, opts);
  const findings = sortFindings([
    ...configFindings(ctx),
    ...functionFindings(ctx),
    ...hotspotFindings(ctx),
    ...conventionFindings(ctx),
    ...securityFindings(ctx),
    ...cycleFindings(ctx),
    ...httpFindings(ctx),
    ...unresolvedFindings(ctx)
  ]);
  const analyzed = ctx.changed.filter((f) => Object.hasOwn(head.graph.files, f) || Object.hasOwn(base.graph.files, ctx.basePath(f))).length;
  return {
    meta: {
      toolVersion: head.toolVersion,
      baseSha: opts.baseSha,
      headSha: opts.headSha,
      baseRef: opts.baseRef,
      changedFiles: ctx.changed.length,
      analyzedChangedFiles: analyzed,
      httpActive: head.httpActive,
      configChanged: findings.some((f) => f.kind === "config-changed"),
      truncated: false
    },
    summary: summaryRows(ctx),
    findings,
    preExisting: preExisting(ctx),
    gate: gate(findings, opts.failOn)
  };
}
function emptyReport(meta) {
  return {
    meta: {
      toolVersion: "",
      baseSha: "",
      headSha: "",
      baseRef: "",
      analyzedChangedFiles: 0,
      httpActive: false,
      configChanged: false,
      truncated: false,
      ...meta
    },
    summary: [],
    findings: [],
    preExisting: [],
    gate: "pass"
  };
}

// src/graph/load.ts
import { readFileSync } from "node:fs";
var SchemaError = class extends Error {
  name = "SchemaError";
};
var VersionMismatchError = class extends Error {
  name = "VersionMismatchError";
  constructor(base, head) {
    super(
      `isobar versions differ: base ${base}, head ${head}. Pin one isobar version on both sides (compare: --isobar-version; diff: regenerate both graph.json files with the same isobar).`
    );
  }
};
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseJson(text2, label3) {
  try {
    return JSON.parse(text2);
  } catch (e) {
    throw new SchemaError(`${label3}: not valid JSON (${e.message})`);
  }
}
function schemaProblem(data) {
  if (!isRecord(data)) return "graph.json is not an object";
  if (data["schema_version"] !== 3) return `expected graph.json schema_version 3, got ${JSON.stringify(data["schema_version"])}`;
  if (!isRecord(data["files"])) return 'graph.json has no "files" map';
  const toolVersion = data["tool_version"];
  if (typeof toolVersion !== "string" || toolVersion === "") return 'graph.json has no "tool_version"';
  return void 0;
}
function parseGraph(text2, label3) {
  const data = parseJson(text2, label3);
  const problem = schemaProblem(data);
  if (problem !== void 0) throw new SchemaError(`${label3}: ${problem}`);
  return data;
}
function loadGraph(path, label3 = path) {
  return parseGraph(readFileSync(path, "utf8"), label3);
}

// src/run/git.ts
import { spawnSync } from "node:child_process";

// src/run/spawn.ts
function exitText(r) {
  return r.status === null ? `was killed by ${r.signal ?? "a signal"}` : `exited ${r.status}`;
}

// src/run/git.ts
var GitError = class extends Error {
  constructor(message2, stderr, status) {
    super(message2);
    this.stderr = stderr;
    this.status = status;
  }
  stderr;
  status;
  name = "GitError";
  code = 3;
};
var GIT_BASE_ARGS = ["-c", "core.quotePath=false"];
var DIFF_CONFIG = ["-c", "diff.relative=false", "-c", "diff.renameLimit=10000"];
var MAX_BUFFER = 256 * 1024 * 1024;
var STRIPPED_ENV = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR"
];
function liveLocalEnvVars() {
  const env = { ...process.env };
  for (const key of STRIPPED_ENV) delete env[key];
  const r = spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8", env });
  if (r.error || r.status !== 0) return [];
  return r.stdout.split("\n").filter((name) => /^GIT_[A-Z0-9_]+$/.test(name));
}
var strippedCache;
function strippedEnv() {
  strippedCache ??= [.../* @__PURE__ */ new Set([...STRIPPED_ENV, ...liveLocalEnvVars()])];
  return strippedCache;
}
function gitEnv() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
  for (const key of strippedEnv()) delete env[key];
  return env;
}
function spawnError(error, cwd, args) {
  const call = `(git ${args.join(" ")} in ${cwd})`;
  if (error.code === "ENOBUFS") return new GitError(`git output exceeded ${MAX_BUFFER / 1024 / 1024} MiB ${call}`, "");
  return new GitError(`git could not run ${call}: ${error.message}`, "");
}
function run(cwd, args, ok = [0]) {
  const r = spawnSync("git", [...GIT_BASE_ARGS, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    env: gitEnv()
  });
  if (r.error) throw spawnError(r.error, cwd, args);
  if (r.status === null || !ok.includes(r.status)) throw new GitError(`git ${args.join(" ")} ${exitText(r)}`, r.stderr, r.status ?? void 0);
  return r;
}
function git(cwd, args) {
  return run(cwd, args).stdout;
}
var PSEUDO_REF = /^(?:[a-z]+_)*head(?:$|[~^@:])/i;
function resolveRef(cwd, ref) {
  if (ref.startsWith("-")) return void 0;
  const remote = `refs/remotes/origin/${ref}`;
  const branch = `refs/heads/${ref}`;
  const candidates = PSEUDO_REF.test(ref) ? [ref, remote, branch] : [remote, branch, ref];
  for (const candidate of candidates) {
    const r = run(cwd, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], [0, 1]);
    if (r.status === 0) return r.stdout.trim();
  }
  return void 0;
}
function mergeBase(cwd, a, b) {
  return git(cwd, ["merge-base", "--end-of-options", a, b]).trim();
}
function headSha(cwd) {
  return git(cwd, ["rev-parse", "HEAD"]).trim();
}
function topLevel(cwd) {
  return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
}
function isShallow(cwd) {
  return git(cwd, ["rev-parse", "--is-shallow-repository"]).trim() === "true";
}
function isDirty(cwd) {
  return git(cwd, ["status", "--porcelain", "--untracked-files=normal"]).trim() !== "";
}
function listUntracked(cwd) {
  return git(cwd, ["ls-files", "-z", "--others", "--exclude-standard", "--full-name"]).split("\0").filter((p) => p !== "" && !p.endsWith("/"));
}
function revs(base, head) {
  return ["--end-of-options", ...head === void 0 ? [base] : [base, head], "--"];
}
function diffNameStatus(cwd, base, head) {
  return git(cwd, [...DIFF_CONFIG, "diff", "--name-status", "-M", "--no-color", "--diff-filter=ACDMRT", ...revs(base, head)]);
}
function diffHunks(cwd, base, head) {
  const pinned = ["-U0", "-M", "--inter-hunk-context=0", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/"];
  return git(cwd, [...DIFF_CONFIG, "diff", ...pinned, ...revs(base, head)]);
}
function worktreeAdd(cwd, dir, sha) {
  git(cwd, ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", "--end-of-options", dir, sha]);
}
function worktreeRemove(cwd, dir) {
  for (const args of [["worktree", "remove", "--force", dir], ["worktree", "prune"]]) {
    try {
      git(cwd, args);
    } catch {
    }
  }
}

// src/run/isobar.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
var DEFAULT_ISOBAR_VERSION = "0.7.1";
var ANALYZABLE_EXTENSIONS = /* @__PURE__ */ new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "vue",
  "svelte",
  "astro",
  "css",
  "scss",
  "sass",
  "less",
  "go",
  "html",
  "htm",
  "java",
  "py",
  "r",
  "rmd",
  "qmd",
  "rb",
  "rake",
  "ru"
]);
function isAnalyzable(path) {
  return ANALYZABLE_EXTENSIONS.has(posix.extname(path).slice(1).toLowerCase());
}
var EXACT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
function isExactSemver(v) {
  return EXACT_SEMVER.test(v);
}
var IsobarError = class extends Error {
  constructor(message2, stderr, code2 = 3) {
    super(message2);
    this.stderr = stderr;
    this.code = code2;
  }
  stderr;
  code;
  name = "IsobarError";
};
var DEFAULT_TIMEOUT_MS = 12e4;
var MAX_BUFFER2 = 64 * 1024 * 1024;
function isobarArgs(o) {
  const args = ["-y", `isobar@${o.version}`, resolve(o.dir), "--format", "json", "-q", "-o", resolve(o.outFile)];
  return o.scope ? [...args, "--scope", o.scope] : args;
}
function workspaceMessage(dir) {
  return `isobar wrote no graph.json for ${dir}: it read the folder as a workspace of several projects (no project file such as package.json or .git at its root, two or more subfolders with one), which v1 does not support. Run isobar-pr on one project, or on a git repository root, which isobar maps as one project (--scope then narrows it to one folder).`;
}
function spawnWhy(error, timeoutMs) {
  return error.code === "ETIMEDOUT" ? `timed out after ${timeoutMs / 1e3} s` : error.message;
}
function outputFailure(o, stderr) {
  const out = statSync(o.outFile, { throwIfNoEntry: false });
  if (out?.isDirectory()) return new IsobarError(workspaceMessage(o.dir), stderr, 2);
  if (!out?.isFile()) return new IsobarError(`isobar@${o.version} exited 0 but wrote no graph.json at ${o.outFile}`, stderr);
  return void 0;
}
function failure(o, r, timeoutMs) {
  const stderr = r.stderr ?? "";
  if (r.error) return new IsobarError(`isobar@${o.version} did not finish on ${o.dir}: ${spawnWhy(r.error, timeoutMs)}`, stderr);
  if (r.status !== 0) return new IsobarError(`isobar@${o.version} ${exitText(r)} on ${o.dir}`, stderr);
  return outputFailure(o, stderr);
}
function runIsobar(o) {
  if (!isExactSemver(o.version)) {
    throw new IsobarError(`the isobar version must be exact, such as ${DEFAULT_ISOBAR_VERSION}; got ${JSON.stringify(o.version)}`, "", 2);
  }
  mkdirSync(dirname(o.outFile), { recursive: true });
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const r = spawnSync2("npx", isobarArgs(o), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER2,
    env: { ...gitEnv(), CI: "1", NO_COLOR: "1" }
  });
  const error = failure(o, r, timeoutMs);
  if (error) throw error;
}

// src/run/compare.ts
var CompareError = class extends Error {
  constructor(message2, code2, stderr = "") {
    super(message2);
    this.code = code2;
    this.stderr = stderr;
  }
  code;
  stderr;
  name = "CompareError";
};
var FETCH_HINT = "In GitHub Actions, check out with history:\n  - uses: actions/checkout@v5\n    with: { fetch-depth: 0 }";
var short = (sha) => sha.slice(0, 7);
function headLabel(s, sha = (full) => full) {
  return `${sha(s.headTip)}${s.dirty ? "-dirty" : ""}`;
}
function topLevelOf(abs, dir) {
  try {
    return realpathSync(topLevel(abs));
  } catch (e) {
    if (e instanceof GitError && e.status === 128) throw new CompareError(`not in a git repository: ${dir}`, 2, e.stderr);
    throw e;
  }
}
function repoRoot(dir) {
  const abs = resolve2(dir);
  if (!statSync2(abs, { throwIfNoEntry: false })?.isDirectory()) throw new CompareError(`${dir} is not a directory`, 2);
  const top = topLevelOf(abs, dir);
  if (realpathSync(abs) !== top) {
    throw new CompareError(`${dir} is inside the repository ${top}; run isobar-pr from the repository root and use --scope <subdir> to narrow the analysis`, 2);
  }
  return top;
}
function resolveScope(top, raw) {
  const scope = normalizeScope(raw);
  if (scope === void 0) return void 0;
  const abs = resolve2(top, scope);
  const rel = statSync2(abs, { throwIfNoEntry: false })?.isDirectory() ? relative(top, realpathSync(abs)) : "..";
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new CompareError(`--scope ${raw} is not a directory in ${top}`, 2);
  return rel === "" ? void 0 : rel;
}
function shallowNote(top) {
  return isShallow(top) ? " (this clone is shallow)" : "";
}
function commitOf(top, side, ref) {
  const sha = resolveRef(top, ref);
  if (sha === void 0) throw new CompareError(`${side} ref "${ref}" not found in ${top}${shallowNote(top)}. ${FETCH_HINT}`, 2);
  return sha;
}
function mergeBaseOf(top, baseTip, headTip, baseRef, headRef) {
  try {
    return mergeBase(top, baseTip, headTip);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    throw new CompareError(`no merge base between ${baseRef} and ${headRef}${shallowNote(top)}. ${FETCH_HINT}`, 2, e.stderr);
  }
}
function resolveSides(o) {
  if (!isExactSemver(o.isobarVersion)) {
    throw new CompareError(`--isobar-version must be an exact version such as ${DEFAULT_ISOBAR_VERSION}, got "${o.isobarVersion}"`, 2);
  }
  const top = repoRoot(o.dir);
  const scope = resolveScope(top, o.scope);
  const baseTip = commitOf(top, "base", o.baseRef);
  const headCommit = o.headRef === "HEAD" ? void 0 : commitOf(top, "head", o.headRef);
  const headTip = headCommit ?? headSha(top);
  const base = mergeBaseOf(top, baseTip, headTip, o.baseRef, o.headRef);
  return { top, scope, base, headCommit, headTip, dirty: headCommit === void 0 && isDirty(top) };
}
function wholeFile(path) {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) return void 0;
  const text2 = readFileSync2(path, "utf8");
  const lines = text2 === "" ? 0 : text2.split("\n").length - (text2.endsWith("\n") ? 1 : 0);
  return lines > 0 ? { start: 1, end: lines } : void 0;
}
function addUntracked(top, changes) {
  for (const path of listUntracked(top)) {
    changes.changed.add(path);
    changes.deleted.delete(path);
    const range = isAnalyzable(path) ? wholeFile(join(top, path)) : void 0;
    if (range) changes.hunks.set(path, [range]);
  }
}
function collectChanges(s) {
  const u0 = diffHunks(s.top, s.base, s.headCommit);
  const all = { ...parseChanges(diffNameStatus(s.top, s.base, s.headCommit)), hunks: parseHunks(u0), deletions: parseDeletions(u0) };
  if (s.headCommit === void 0) addUntracked(s.top, all);
  return filterChanges(all, s.scope);
}
function worthAnalyzing(changes) {
  const touched = [...changes.changed, ...changes.deleted ?? [], ...changes.renames.values()];
  return touched.some((p) => isAnalyzable(p) || isConfigFile(p));
}
function checkout(top, dir, sha, worktrees) {
  worktrees.push(dir);
  worktreeAdd(top, dir, sha);
  return dir;
}
function graphOf(side, dir, outFile, s, o) {
  o.log(`isobar-pr: isobar@${o.isobarVersion} on ${side}\u2026`);
  runIsobar({ dir, version: o.isobarVersion, outFile, scope: s.scope });
  return buildIndex(loadGraph(outFile, side));
}
function analyze(s, changes, o) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "isobar-pr-")));
  const worktrees = [];
  try {
    const baseDir = checkout(s.top, join(tmp, "base"), s.base, worktrees);
    const headDir = s.headCommit === void 0 ? s.top : checkout(s.top, join(tmp, "head"), s.headCommit, worktrees);
    const baseIndex = graphOf("base", baseDir, join(tmp, "base-out", "graph.json"), s, o);
    const headIndex = graphOf("head", headDir, join(tmp, "head-out", "graph.json"), s, o);
    if (baseIndex.toolVersion !== headIndex.toolVersion) throw new VersionMismatchError(baseIndex.toolVersion, headIndex.toolVersion);
    const opts = { failOn: o.failOn, reportUncalledRoutes: o.reportUncalledRoutes, baseRef: o.baseRef, baseSha: s.base, headSha: headLabel(s) };
    return diffGraphs(baseIndex, headIndex, changes, opts);
  } finally {
    for (const dir of worktrees) worktreeRemove(s.top, dir);
    if (o.keepTemp) o.log(`isobar-pr: kept ${tmp}`);
    else rmSync(tmp, { recursive: true, force: true });
  }
}
function compare(o) {
  const started = Date.now();
  const s = resolveSides(o);
  const changes = collectChanges(s);
  const n = changes.changed.size;
  o.log(`isobar-pr: base ${short(s.base)} (merge-base of ${o.baseRef}) vs head ${headLabel(s, short)}, ${n} changed file${n === 1 ? "" : "s"}`);
  if (!worthAnalyzing(changes)) {
    o.log("isobar-pr: no analyzable source or isobar config among the changed files; skipping isobar");
    const meta = { baseRef: o.baseRef, baseSha: s.base, headSha: headLabel(s), changedFiles: n };
    return { report: emptyReport(meta), durationMs: Date.now() - started };
  }
  return { report: analyze(s, changes, o), durationMs: Date.now() - started };
}

// src/commands/emit.ts
import { appendFileSync, mkdirSync as mkdirSync2, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";

// src/report/annotations.ts
var LEVEL = Object.freeze({
  serious: "error",
  high: "warning",
  medium: "warning",
  low: "notice",
  info: void 0,
  improved: void 0
});
var MAX_PER_LEVEL = 10;
var ANNOTATION_TITLE = "isobar-pr";
var SEP = " \u2014 ";
function escapeProperty(s) {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/:/g, "%3A").replace(/,/g, "%2C");
}
var TITLE_PROPERTY = escapeProperty(ANNOTATION_TITLE);
function escapeData(s) {
  return s.replace(/%/g, "%25").replace(/\r\n|\r|\n/g, " ");
}
function message(f) {
  return [f.title, f.detail, f.advice].map((part) => plain(part ?? "")).filter((part) => part !== "").join(SEP);
}
function levelOf(f) {
  return f.inDiff === false ? void 0 : LEVEL[f.severity];
}
function lineOf(f) {
  const line = f.line;
  return line !== void 0 && Number.isInteger(line) && line >= 1 ? line : void 0;
}
function annotation(level, f, line) {
  return `::${level} file=${escapeProperty(f.file)},line=${line},title=${TITLE_PROPERTY}::${escapeData(message(f))}`;
}
function renderAnnotations(report) {
  const counts = { error: 0, warning: 0, notice: 0 };
  const out = [];
  const bySeverity = [...report.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  for (const f of bySeverity) {
    const level = levelOf(f);
    const line = lineOf(f);
    if (level === void 0 || line === void 0 || counts[level] >= MAX_PER_LEVEL) continue;
    counts[level]++;
    out.push(annotation(level, f, line));
  }
  return out;
}

// src/report/json.ts
function sortKeys(value) {
  if (value && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function") {
    return sortKeys(value.toJSON());
  }
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    if (value instanceof Map || value instanceof Set) throw new TypeError("stableStringify: Map and Set are not serialisable; use arrays");
    const src = value;
    return Object.fromEntries(Object.keys(src).sort().map((k) => [k, sortKeys(src[k])]));
  }
  return value;
}
function stableStringify(value, indent = 2) {
  return JSON.stringify(sortKeys(value), null, indent);
}
function toJson(report) {
  return stableStringify(report) + "\n";
}

// src/report/markdown.ts
var MARKER = "<!-- isobar-pr -->";
var COMMENT_LIMIT = 65e3;
var PER_SECTION = 10;
var PRE_EXISTING_CAP = 50;
var TITLE = "## \u{1F300} isobar-pr \xB7 pressure delta";
var SEP2 = " \u2014 ";
var DOT = " \xB7 ";
var OUTSIDE_DIFF = " _(outside the diff)_";
function rankOf2(f) {
  const rank = f.data["rank"];
  return typeof rank === "number" ? rank : Number.MAX_SAFE_INTEGER;
}
var SECTIONS = [
  { heading: "\u26A0\uFE0F Crossed a limit or got slower", kinds: ["function-regression"] },
  { heading: "\u{1F525} Hotspot touched", kinds: ["hotspot-touched"], order: (a, b) => rankOf2(a) - rankOf2(b) },
  { heading: "\u{1F4D0} Convention broken", kinds: ["convention-broken", "convention-weakened"] },
  { heading: "\u{1F512} New security warning", kinds: ["security-new", "security-grew"] },
  { heading: "\u{1F501} Circular import", kinds: ["cycle-new", "cycle-grew"] },
  { heading: "\u{1F50C} HTTP contract", kinds: ["http-unmatched-call", "http-uncalled-route", "http-info"] },
  { heading: "\u2753 Unresolved import", kinds: ["unresolved-new"] },
  { heading: "\u2705 Improved", kinds: ["function-improved", "cycle-broken"] }
];
var SECTION_OF = new Map(SECTIONS.flatMap((s) => s.kinds.map((k) => [k, s])));
function groupBy2(findings, keyOf) {
  const groups = /* @__PURE__ */ new Map();
  for (const f of findings) {
    const key = keyOf(f);
    if (key === void 0) continue;
    const group = groups.get(key);
    if (group) group.push(f);
    else groups.set(key, [f]);
  }
  return groups;
}
function conventionCount(items) {
  const ids = /* @__PURE__ */ new Set();
  let unnamed = 0;
  for (const f of items) {
    const id = f.data["patternId"];
    if (typeof id === "string") ids.add(id);
    else unnamed++;
  }
  return ids.size + unnamed;
}
function securityPhrase(items) {
  const serious = items.filter((f) => f.severity === "serious").length;
  return `${plural(items.length, "security warning")}${serious ? ` (${serious} serious)` : ""}`;
}
var COUNTERS = [
  { kinds: ["function-regression"], phrase: (xs) => `${plural(xs.length, "function")} crossed a limit or got slower` },
  { kinds: ["hotspot-touched"], phrase: (xs) => `${plural(xs.length, "hotspot")} touched` },
  { kinds: ["convention-broken", "convention-weakened"], phrase: (xs) => `${plural(conventionCount(xs), "convention")} broken` },
  { kinds: ["security-new", "security-grew"], phrase: securityPhrase },
  { kinds: ["cycle-new", "cycle-grew"], phrase: (xs) => plural(xs.length, "circular import") },
  { kinds: ["http-unmatched-call"], phrase: (xs) => `${plural(xs.length, "call")} with no route` },
  { kinds: ["http-uncalled-route"], phrase: (xs) => `${plural(xs.length, "route")} with no caller` },
  { kinds: ["unresolved-new"], phrase: (xs) => plural(xs.length, "unresolved import") },
  { kinds: ["function-improved", "cycle-broken"], phrase: (xs) => `${xs.length} improved` }
];
function headlineParts(report) {
  const parts = [];
  const cognitive = report.summary.find((r) => r.key === "cognitive");
  if (cognitive && cognitive.delta !== "0") parts.push(`${cognitive.delta} cognitive across ${plural(report.meta.changedFiles, "changed file")}`);
  const groups = groupBy2(report.findings, (f) => f.kind);
  for (const counter of COUNTERS) {
    const items = counter.kinds.flatMap((k) => groups.get(k) ?? []);
    if (items.length) parts.push(counter.phrase(items));
  }
  return parts;
}
function headline(report) {
  const n = report.meta.changedFiles;
  if (report.meta.analyzedChangedFiles === 0) return `No analyzable source changed (${plural(n, "file")})`;
  const parts = headlineParts(report);
  return parts.length ? parts.join(DOT) : `No pressure change in ${plural(n, "changed file")}`;
}
var TITLE_ONLY_KINDS = ["http-info", "config-changed"];
var TITLE_ONLY = new Set(TITLE_ONLY_KINDS);
function isTitleOnly(kind) {
  return TITLE_ONLY.has(kind);
}
function where(f, withLine) {
  const loc = withLine && f.line !== void 0 ? `${f.file}:${f.line}` : f.file;
  return `${code(loc)}${f.renamedFrom ? ` (renamed from ${code(f.renamedFrom)})` : ""}`;
}
function withDetail(s, f) {
  return f.detail ? `${s}${SEP2}${f.detail}` : s;
}
function functionLine(f) {
  return `${where(f, false)} \u203A ${withDetail(f.title, f)}${f.line !== void 0 ? `${DOT}L${f.line}` : ""}`;
}
function conventionLine(f) {
  return `${f.title}${SEP2}${where(f, false)}${f.detail ? ` ${f.detail}` : ""}`;
}
function locatedLine(f) {
  return withDetail(`${where(f, true)}${SEP2}${f.title}`, f);
}
var LINE = {
  "function-regression": functionLine,
  "function-improved": functionLine,
  "hotspot-touched": locatedLine,
  "convention-broken": conventionLine,
  "convention-weakened": conventionLine,
  "security-new": locatedLine,
  "security-grew": locatedLine,
  "cycle-new": locatedLine,
  "cycle-grew": locatedLine,
  "cycle-broken": locatedLine,
  "http-unmatched-call": locatedLine,
  "http-uncalled-route": locatedLine,
  "unresolved-new": locatedLine
};
function adviceLine(f) {
  if (!f.advice) return "";
  return `
  \u21B3 ${f.advice}${f.kind === "function-regression" ? " *(isobar refactor guide)*" : ""}`;
}
function renderFinding(f) {
  const kind = f.kind;
  const body = isTitleOnly(kind) ? f.title : `${LINE[kind](f)}${f.inDiff === false ? OUTSIDE_DIFF : ""}`;
  return `- ${body}${adviceLine(f)}`;
}
function renderSection(section, found) {
  const items = section.order ? [...found].sort(section.order) : found;
  const shown = items.slice(0, PER_SECTION).map(renderFinding).join("\n");
  const rest = items.slice(PER_SECTION);
  const fold = rest.length ? `
<details><summary>and ${rest.length} more</summary>

${rest.map(renderFinding).join("\n")}

</details>
` : "";
  return `### ${section.heading}
${shown}
${fold}`;
}
function sectionBlocks(findings) {
  const groups = groupBy2(findings, (f) => SECTION_OF.get(f.kind));
  return SECTIONS.flatMap((section) => {
    const items = groups.get(section);
    return items ? [renderSection(section, items)] : [];
  });
}
function bannerLines(findings) {
  const banner = findings.find((f) => f.kind === "config-changed");
  return banner ? [`> \u26A0\uFE0F ${banner.title}`, ""] : [];
}
function tableLines(rows) {
  if (!rows.length) return [];
  const body = rows.map((r) => `| ${cell(r.label)} | ${cell(r.base)} | ${cell(r.head)} | ${cell(r.delta)} |`);
  return ["| Signal (changed files only) | Base | Head | \u0394 |", "|---|---|---|---|", ...body, ""];
}
function html(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function shortSha(raw) {
  const sha = raw.trim();
  const dirty = sha.endsWith("-dirty") ? "-dirty" : "";
  const bare = sha.slice(0, sha.length - dirty.length);
  return bare.length > 7 ? `${bare.slice(0, 7)}${dirty}` : sha || "?";
}
function durationBits(ms) {
  return ms !== void 0 && Number.isFinite(ms) && ms >= 0 ? [`${(ms / 1e3).toFixed(1)} s`] : [];
}
function preExistingLine(p) {
  return `- ${code(p.line !== void 0 ? `${p.file}:${p.line}` : p.file)}${SEP2}${p.text}`;
}
function preExistingBody(pre) {
  if (!pre.length) return "_Nothing pre-existing in the changed files._";
  const listed = pre.slice(0, PRE_EXISTING_CAP).map(preExistingLine).join("\n");
  const more = pre.length - PRE_EXISTING_CAP;
  return more > 0 ? `${listed}

_and ${more} more in report.json_` : listed;
}
function footerLines(report, durationMs) {
  const { meta, preExisting: pre } = report;
  const bits = [`isobar ${html(meta.toolVersion)}`, `base ${shortSha(meta.baseSha)}`, `head ${shortSha(meta.headSha)}`, ...durationBits(durationMs)];
  return [`<details><summary>Pre-existing in changed files (${pre.length})${DOT}${bits.join(DOT)}</summary>`, "", preExistingBody(pre), "", "</details>", ""];
}
function renderMarkdown(report, extra = {}) {
  const top = [MARKER, TITLE, "", headline(report), ""];
  if (report.meta.analyzedChangedFiles === 0 || report.findings.length === 0) return `${top.join("\n")}
`;
  return [
    ...top,
    ...bannerLines(report.findings),
    ...tableLines(report.summary),
    ...sectionBlocks(report.findings),
    ...footerLines(report, extra.durationMs)
  ].join("\n");
}
var TRUNCATION_NOTE = "\n\n_Comment truncated. The full report is in the job summary and `report.json`._\n";
var DETAILS_CLOSE = "\n\n</details>\n";
var NEWLINE_WINDOW = 2e3;
function cutPoint(s, budget) {
  const newline = s.lastIndexOf("\n", budget - 1);
  if (newline >= 0 && budget - newline <= NEWLINE_WINDOW) return newline;
  const unit = s.charCodeAt(budget - 1);
  return unit >= 55296 && unit <= 56319 ? budget - 1 : budget;
}
function occurrences(s, needle) {
  return s.split(needle).length - 1;
}
function truncateComment(markdown, limit = COMMENT_LIMIT) {
  if (markdown.length <= limit) return { text: markdown, truncated: false };
  const budget = limit - TRUNCATION_NOTE.length - DETAILS_CLOSE.length;
  if (!(budget > 0)) return { text: TRUNCATION_NOTE.slice(0, Math.max(0, limit)), truncated: true };
  const kept = markdown.slice(0, cutPoint(markdown, budget));
  const close = occurrences(kept, "<details>") > occurrences(kept, "</details>") ? DETAILS_CLOSE : "";
  return { text: kept + close + TRUNCATION_NOTE, truncated: true };
}

// src/commands/options.ts
var FORMATS = ["markdown", "json", "annotations", "all"];
function isFormat(v) {
  return FORMATS.includes(v);
}
var UsageError = class extends Error {
  name = "UsageError";
};
function str(v) {
  return typeof v === "string" ? v : void 0;
}
function sharedOptions(args) {
  const format = str(args.flags["format"]) ?? "markdown";
  if (!isFormat(format)) throw new UsageError(`--format must be markdown, json, annotations or all, got "${format}"`);
  const out = str(args.flags["out"]);
  if (format === "all" && !out) throw new UsageError("--format all requires --out DIR");
  const failOn = str(args.flags["fail-on"]) ?? "none";
  if (!isFailOn(failOn)) throw new UsageError(`--fail-on must be none, serious-security, limit-crossed or any, got "${failOn}"`);
  return {
    format,
    out,
    failOn,
    gateOutput: args.flags["gate-output"] === true,
    reportUncalledRoutes: args.flags["report-uncalled-routes"] === true
  };
}
function fsErrorMessage(e) {
  if (!(e instanceof Error)) return void 0;
  const { code: code2, syscall } = e;
  return typeof code2 === "string" && typeof syscall === "string" ? e.message : void 0;
}
function withPath(verb, path, fn) {
  try {
    return fn();
  } catch (e) {
    const message2 = fsErrorMessage(e);
    if (message2 === void 0) throw e;
    throw new UsageError(`cannot ${verb} ${path}: ${message2}`);
  }
}

// src/commands/emit.ts
function render(report, durationMs) {
  const full = renderMarkdown(report, { durationMs });
  const comment = truncateComment(full);
  const final = comment.truncated ? { ...report, meta: { ...report.meta, truncated: true } } : report;
  const lines = renderAnnotations(final);
  return { markdown: comment.text, summary: full, json: toJson(final), annotations: lines.length ? `${lines.join("\n")}
` : "" };
}
var STDOUT = {
  markdown: (r) => r.markdown,
  json: (r) => r.json,
  annotations: (r) => r.annotations,
  all: () => ""
};
function writeFiles(dir, r) {
  withPath("write", dir, () => {
    mkdirSync2(dir, { recursive: true });
    writeFileSync(join2(dir, "report.md"), r.markdown);
    writeFileSync(join2(dir, "summary.md"), r.summary);
    writeFileSync(join2(dir, "report.json"), r.json);
    writeFileSync(join2(dir, "annotations.txt"), r.annotations);
  });
}
function gateOutputLines(report, out) {
  const summary = headline(report).replace(/\s*[\r\n]+\s*/g, " ");
  return `gate=${report.gate}
summary=${summary}
${out ? `report-json=${join2(out, "report.json")}
` : ""}`;
}
function writeGateOutput(report, out, io) {
  const lines = gateOutputLines(report, out);
  const target2 = io.env["GITHUB_OUTPUT"];
  if (target2) withPath("write", target2, () => appendFileSync(target2, lines));
  else io.out(lines);
}
function emitReport(report, o, io) {
  const rendered = render(report, o.durationMs);
  if (o.out) writeFiles(o.out, rendered);
  const text2 = STDOUT[o.format](rendered);
  if (text2) io.out(text2);
  if (o.gateOutput) {
    writeGateOutput(report, o.out, io);
    return 0;
  }
  return report.gate === "fail" ? 1 : 0;
}

// src/commands/compare.ts
var DIFF_ONLY = ["base", "head", "changes", "hunks"];
function runCompare(args, io) {
  const o = sharedOptions(args);
  if (args.positional.length > 1) throw new UsageError(`compare takes one repository directory, got ${args.positional.length}: ${args.positional.join(" ")}`);
  const misplaced = DIFF_ONLY.find((flag) => Object.hasOwn(args.flags, flag));
  if (misplaced) throw new UsageError(`--${misplaced} is a diff option; compare takes --base-ref and --head-ref`);
  const result = compare({
    dir: args.positional[0] ?? ".",
    baseRef: str(args.flags["base-ref"]) ?? "main",
    headRef: str(args.flags["head-ref"]) ?? "HEAD",
    isobarVersion: str(args.flags["isobar-version"]) ?? DEFAULT_ISOBAR_VERSION,
    scope: str(args.flags["scope"]),
    failOn: o.failOn,
    reportUncalledRoutes: o.reportUncalledRoutes,
    keepTemp: args.flags["keep-temp"] === true,
    log: (line) => io.err(`${line}
`)
  });
  return emitReport(result.report, { format: o.format, out: o.out, gateOutput: o.gateOutput, durationMs: result.durationMs }, io);
}

// src/commands/diff.ts
import { readFileSync as readFileSync3 } from "node:fs";
var COMPARE_ONLY = ["head-ref", "isobar-version", "scope", "keep-temp"];
function rejectStrayArgs(args) {
  if (args.positional.length > 0) throw new UsageError(`diff takes no positional arguments, got: ${args.positional.join(" ")}`);
  const misplaced = COMPARE_ONLY.find((flag) => Object.hasOwn(args.flags, flag));
  if (misplaced) throw new UsageError(`--${misplaced} is a compare option; diff takes --base, --head and --changes`);
}
function readText(path) {
  return withPath("read", path, () => readFileSync3(path, "utf8"));
}
function loadSide(path, side) {
  return buildIndex(withPath("read", path, () => loadGraph(path, side)));
}
function readChangesText(path, io) {
  if (path !== "-") return readText(path);
  const { stdin } = io;
  if (!stdin) throw new UsageError("cannot read stdin: none is available here");
  return withPath("read", "stdin", stdin);
}
function loadChanges(changesPath, hunksPath, io) {
  const changes = parseChanges(readChangesText(changesPath, io));
  if (hunksPath) {
    const u0 = readText(hunksPath);
    changes.hunks = parseHunks(u0);
    changes.deletions = parseDeletions(u0);
  }
  return changes;
}
function runDiff(args, io) {
  const o = sharedOptions(args);
  rejectStrayArgs(args);
  const basePath = str(args.flags["base"]);
  const headPath = str(args.flags["head"]);
  const changesPath = str(args.flags["changes"]);
  if (!basePath || !headPath || !changesPath) throw new UsageError("diff needs --base, --head and --changes");
  const base = loadSide(basePath, "base");
  const head = loadSide(headPath, "head");
  if (base.toolVersion !== head.toolVersion) throw new VersionMismatchError(base.toolVersion, head.toolVersion);
  const changes = loadChanges(changesPath, str(args.flags["hunks"]), io);
  const report = diffGraphs(base, head, changes, {
    failOn: o.failOn,
    reportUncalledRoutes: o.reportUncalledRoutes,
    baseRef: str(args.flags["base-ref"]) ?? "",
    baseSha: base.graph.git_sha ?? "",
    headSha: head.graph.git_sha ?? ""
  });
  return emitReport(report, { format: o.format, out: o.out, gateOutput: o.gateOutput }, io);
}

// src/version.ts
var VERSION = true ? "1.0.0" : "dev";

// src/cli.ts
var BOOLEAN_FLAGS = /* @__PURE__ */ new Set(["gate-output", "report-uncalled-routes", "keep-temp", "help", "version"]);
var VALUED_FLAGS = /* @__PURE__ */ new Set(["base", "head", "changes", "hunks", "format", "out", "fail-on", "base-ref", "head-ref", "isobar-version", "scope"]);
var COMMANDS = /* @__PURE__ */ new Set(["diff", "compare"]);
function readFlag(argv, i, flags) {
  const arg = argv[i];
  const eq = arg.indexOf("=");
  if (eq > 0) {
    flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    return 1;
  }
  const key = arg.slice(2);
  const next = argv[i + 1];
  if (next !== void 0 && !next.startsWith("--") && !BOOLEAN_FLAGS.has(key)) {
    flags[key] = next;
    return 2;
  }
  flags[key] = true;
  return 1;
}
function parseArgs(argv) {
  const parsed = { command: void 0, positional: [], flags: {} };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--") {
      parsed.positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      i += readFlag(argv, i, parsed.flags);
      continue;
    }
    if (parsed.command === void 0 && COMMANDS.has(arg)) parsed.command = arg;
    else parsed.positional.push(arg);
    i++;
  }
  return parsed;
}
function flagError(key, value) {
  if (BOOLEAN_FLAGS.has(key)) return value === true ? void 0 : `--${key} takes no value`;
  if (VALUED_FLAGS.has(key)) return value === true ? `--${key} needs a value` : void 0;
  return `unknown option --${key}`;
}
function usageErrors(args) {
  const errors = [];
  for (const [key, value] of Object.entries(args.flags)) {
    const error = flagError(key, value);
    if (error !== void 0) errors.push(error);
  }
  for (const p of args.positional) if (p.startsWith("-") && p !== "-") errors.push(`unknown option ${p}`);
  if (args.command === void 0 && args.positional.length > 0) errors.push(`unknown command "${args.positional[0]}"`);
  return errors;
}
var USAGE = `Usage: isobar-pr <command> [options]

Commands:
  diff      Diff two graph.json files:  --base b.json --head h.json --changes <file|-> [--hunks diff.txt] [--base-ref REF]
            (--changes = output of \`git diff --name-status -M BASE HEAD\`, "-" reads stdin; --hunks = \`git diff -U0 BASE HEAD\`;
             --base-ref only labels the report)
  compare   Run isobar on the merge base and the head, then diff:  [dir] [--base-ref main] [--head-ref HEAD]
            (dir = the repository root, default "."; --head-ref HEAD, the default, analyzes the working tree,
             uncommitted edits included; any other ref analyzes that commit)

Shared options:
  --format markdown|json|annotations|all   (default markdown; "all" needs --out)
  --out DIR                                 write report.md, summary.md, report.json, annotations.txt
  --fail-on none|serious-security|limit-crossed|any
  --gate-output                             always exit 0; append gate=, summary= (and report-json= with --out)
                                            to $GITHUB_OUTPUT, or print them when it is unset
  --report-uncalled-routes                  also report new routes with no caller in this repo

compare options:
  --isobar-version X.Y.Z   exact isobar version (default 0.7.1)
  --scope DIR              only analyze this directory of the repository
  --keep-temp              keep the temporary folder with both graph.json files (the worktrees are always removed)

Exit codes: 0 ok \xB7 1 gate failed \xB7 2 usage or environment (incl. unreadable input) \xB7 3 isobar, git or graph.json failure
`;
function defaultIo() {
  return {
    out: (s) => {
      process.stdout.write(s);
    },
    err: (s) => {
      process.stderr.write(s);
    },
    env: process.env,
    stdin: () => readFileSync4(0, "utf8")
  };
}
async function main(argv, io = defaultIo()) {
  const args = parseArgs(argv);
  if (args.flags["version"] === true) {
    io.out(`${VERSION}
`);
    return 0;
  }
  if (args.flags["help"] === true) {
    io.out(USAGE);
    return 0;
  }
  const errors = usageErrors(args);
  if (errors.length > 0) {
    for (const e of errors) io.err(`isobar-pr: ${e}
`);
    io.err("Run isobar-pr --help for usage.\n");
    return 2;
  }
  if (args.command === void 0) {
    io.err(USAGE);
    return 2;
  }
  try {
    if (args.command === "diff") return runDiff(args, io);
    if (args.command === "compare") return runCompare(args, io);
    io.err(USAGE);
    return 2;
  } catch (e) {
    return handleError(e, io);
  }
}
function handleError(e, io) {
  const known = knownErrorCode(e);
  if (known !== void 0) {
    io.err(`isobar-pr: ${known.message}
`);
    return known.code;
  }
  const err = e ?? {};
  io.err(`isobar-pr: ${err.message ?? String(e)}
`);
  if (err.stderr) io.err(withNewline(err.stderr));
  const code2 = exitCodeOf(err.code);
  if (code2 !== void 0) return code2;
  if (err.stack) io.err(`${err.stack}
`);
  return 3;
}
function knownErrorCode(e) {
  if (e instanceof UsageError) return { message: e.message, code: 2 };
  if (e instanceof SchemaError || e instanceof VersionMismatchError) return { message: e.message, code: 3 };
  return void 0;
}
function exitCodeOf(code2) {
  return typeof code2 === "number" && Number.isInteger(code2) && code2 > 0 ? code2 : void 0;
}
function withNewline(s) {
  return s.endsWith("\n") ? s : `${s}
`;
}

// src/bin.ts
process.exitCode = await main(process.argv.slice(2)).catch((e) => {
  console.error(e);
  return 3;
});
