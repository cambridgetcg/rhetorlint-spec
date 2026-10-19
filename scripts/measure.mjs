#!/usr/bin/env node
// Does the engine agree with people? measurement/ asks that; conformance/ asks
// whether the engines agree with each other. This script runs packages/core over
// the committed items in measurement/items/ and scores every mark against one
// reader's labels in measurement/labels.json. Zero dependencies.
//
//   node scripts/measure.mjs            print the per-rule x stratum table
//   node scripts/measure.mjs --write    regenerate measurement/report.json (deterministic, no timings)
//   node scripts/measure.mjs --check    exit 1 if report.json is stale or a current mark has no label
//   node scripts/measure.mjs --local    also print the uncommitted strata in measurement/local/ (never written)
//   node scripts/measure.mjs --table    print a markdown table for a PR body
//   node scripts/measure.mjs --compare <git-rev>
//                                       score that revision's core and rules on today's items and labels
//
// Floors are reported and never gate: a rule's precision is one reader's
// judgement on a small corpus, not proof.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = join(ROOT, "measurement");
export const AGENCY = "agency-hiding.deleted-subject";
export const FLOORS = { warning: 0.8, note: 0.67, info: 0.5 };
export const MIN_N = 5;
const STRATA = ["pastiche", "wild-pd", "target-genre", "technical"];
const GROUPS = {
  legacy: ["pastiche", "wild-pd"],
  wild: ["wild-pd", "target-genre", "technical"],
  all: STRATA
};
const Z = 1.959964;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;
export const keyOf = (item, ruleId, start, end) => `${item}|${ruleId}|${start}|${end}`;

/** Wilson score interval for k successes in n trials (95%). */
export function wilson(k, n) {
  if (!n) return null;
  const p = k / n, z2 = Z * Z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [r3(Math.max(0, centre - half)), r3(Math.min(1, centre + half))];
}

function cell() {
  return { n: 0, TP: 0, MENTION: 0, DEBATABLE: 0, FPB: 0, FPW: 0, unlabelled: 0 };
}

/** A rule's cell for one stratum; strata where the rule made no mark are omitted from the report. */
const cellOf = (rule, stratum) => rule.strata[stratum] || finish(cell());

function finish(c) {
  const out = { ...c };
  out.strict = c.n ? r3(c.TP / c.n) : null;
  out.strict_ci = wilson(c.TP, c.n);
  const lenientK = c.TP + c.MENTION + c.DEBATABLE;
  out.lenient = c.n ? r3(lenientK / c.n) : null;
  out.lenient_ci = wilson(lenientK, c.n);
  out.status = c.n >= MIN_N ? "measured" : "unmeasured";
  return out;
}

/** Load the committed corpus: items with their text, labels, gold, and the canonical pack. */
export function loadCommitted(root = ROOT) {
  const m = join(root, "measurement");
  const { items } = readJson(join(m, "items.json"));
  for (const item of items) item.text = readFileSync(join(m, "items", `${item.id}.txt`), "utf8");
  return {
    items,
    labels: readJson(join(m, "labels.json")).labels,
    gold: readJson(join(m, "gold.json")),
    rules: readJson(join(root, "packages", "rules-en", "rules.json")),
    contrast: existsSync(join(m, "contrast.json")) ? readJson(join(m, "contrast.json")) : null
  };
}

/** Run an engine over items; return marks as flat rows. */
export function runEngine(analyze, rules, items) {
  const marks = [];
  const perItem = [];
  let engine = null;
  for (const item of items) {
    const result = analyze(item.text, { rules });
    engine ||= result.engine;
    perItem.push({ id: item.id, stratum: item.stratum, register: item.register, words: result.source.words, tells: result.density.tells, per100: result.density.per100Words });
    for (const mark of result.marks) {
      marks.push({ item: item.id, stratum: item.stratum, ruleId: mark.ruleId, start: mark.position.start.offset, end: mark.position.end.offset, actual: mark.actual });
    }
  }
  return { marks, perItem, engine };
}

/** Every current mark without a label, as ready-to-review proposal rows. */
export function unlabelledMarks(marks, labels, date = "YYYY-MM-DD") {
  const known = new Set(labels.map((l) => keyOf(l.item, l.ruleId, l.start, l.end)));
  return marks
    .filter((m) => !known.has(keyOf(m.item, m.ruleId, m.start, m.end)))
    .map((m) => ({ item: m.item, ruleId: m.ruleId, start: m.start, end: m.end, actual: m.actual, label: "?", reason: "?", by: "?", date }));
}

/** Per-rule FPB/FPW counts on the committed strata — the quantity baseline.json ratchets. */
export function falsePositives(marks, labels) {
  const byKey = new Map(labels.map((l) => [keyOf(l.item, l.ruleId, l.start, l.end), l.label]));
  const out = {};
  for (const m of marks) {
    const label = byKey.get(keyOf(m.item, m.ruleId, m.start, m.end));
    if (label !== "FPB" && label !== "FPW") continue;
    out[m.ruleId] ||= { FPB: 0, FPW: 0 };
    out[m.ruleId][label]++;
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

/** Gold recall: any-rule, per intended rule (with incidental overlaps listed apart), and per set. */
export function goldRecall(gold, marks) {
  const byItem = new Map();
  for (const m of marks) {
    if (!byItem.has(m.item)) byItem.set(m.item, []);
    byItem.get(m.item).push(m);
  }
  const anyRule = { hit: 0, n: 0 };
  const bySet = {};
  const byRule = {};
  for (const g of gold.annotations) {
    const over = (byItem.get(g.item) || []).filter((m) => m.start < g.end && m.end > g.start);
    const rulesOver = [...new Set(over.map((m) => m.ruleId))].sort();
    anyRule.n++; if (over.length) anyRule.hit++;
    bySet[g.set] ||= { hit: 0, n: 0 };
    bySet[g.set].n++; if (over.length) bySet[g.set].hit++;
    if (g.rule) {
      const r = (byRule[g.rule] ||= { hit: 0, n: 0, incidental: [] });
      r.n++;
      if (rulesOver.includes(g.rule)) r.hit++;
      else if (rulesOver.length) r.incidental.push({ item: g.item, text: g.text, rules: rulesOver });
    }
  }
  const pct = (o) => ({ ...o, recall: o.n ? r3(o.hit / o.n) : null });
  return {
    any_rule: pct(anyRule),
    by_set: Object.fromEntries(Object.keys(bySet).sort().map((k) => [k, pct(bySet[k])])),
    by_rule: Object.fromEntries(Object.keys(byRule).sort().map((k) => [k, pct(byRule[k])]))
  };
}

/** Spin items should out-mark ham items: count correctly ordered (spin, ham) pairs. */
export function spinHamOrdering(perItem) {
  const density = (i) => (i.words ? i.tells / i.words : 0);
  const spins = perItem.filter((i) => i.register === "spin");
  const hams = perItem.filter((i) => i.register === "ham");
  const violations = [];
  let correct = 0;
  for (const s of spins) {
    for (const h of hams) {
      if (density(s) > density(h)) correct++;
      else violations.push({ spin: s.id, spin_per100: s.per100, ham: h.id, ham_per100: h.per100 });
    }
  }
  return { pairs: spins.length * hams.length, correct, violations };
}

/** Score one engine's marks against the labels, per rule x stratum. */
export function score({ marks, perItem, labels, gold, rules, strata = STRATA, groups = GROUPS, pairStratum = "pastiche" }) {
  const byKey = new Map(labels.map((l) => [keyOf(l.item, l.ruleId, l.start, l.end), l.label]));
  const level = Object.fromEntries(rules.rules.map((r) => [r.ruleId, r.level || "info"]));
  const ruleIds = [...new Set([...rules.rules.map((r) => r.ruleId), ...marks.map((m) => m.ruleId)])];
  const table = {};
  for (const id of [...ruleIds, "ALL"]) {
    table[id] = {};
    for (const s of [...strata, ...Object.keys(groups)]) table[id][s] = cell();
  }
  const add = (c, label) => {
    if (label) { c.n++; c[label]++; } else c.unlabelled++;
  };
  for (const m of marks) {
    const label = byKey.get(keyOf(m.item, m.ruleId, m.start, m.end));
    const targets = [m.stratum, ...Object.entries(groups).filter(([, members]) => members.includes(m.stratum)).map(([g]) => g)];
    for (const t of targets) {
      add(table[m.ruleId][t], label);
      add(table.ALL[t], label);
    }
  }
  const rulesOut = ruleIds.sort().map((id) => ({
    ruleId: id,
    level: level[id] || "info",
    strata: Object.fromEntries(Object.entries(table[id]).filter(([, c]) => c.n + c.unlabelled > 0).map(([s, c]) => [s, finish(c)]))
  }));
  const totals = Object.fromEntries(Object.entries(table.ALL).map(([s, c]) => [s, finish(c)]));

  const strataSummary = {};
  for (const s of [...strata, ...Object.keys(groups)]) {
    const members = groups[s] || [s];
    const its = perItem.filter((i) => members.includes(i.stratum));
    const words = its.reduce((a, i) => a + i.words, 0);
    const tells = its.reduce((a, i) => a + i.tells, 0);
    const agency = marks.filter((m) => members.includes(m.stratum) && m.ruleId === AGENCY).length;
    strataSummary[s] = {
      items: its.length, words, marks: tells,
      per100: words ? r2((tells / words) * 100) : null,
      agency_marks: agency,
      agency_per100: words ? r2((agency / words) * 100) : null,
      agency_share: tells ? r2(agency / tells) : null
    };
  }

  const wild = groups.wild ? "wild" : null;
  const blockers = [];
  if (wild) {
    for (const r of rulesOut) {
      const c = cellOf(r, wild);
      const floor = FLOORS[r.level];
      const why = [];
      if (c.FPW > 0) why.push(`FPW ${c.FPW} > 0`);
      if (c.n >= MIN_N && c.lenient < floor) why.push(`lenient ${c.lenient} < ${floor} (${r.level})`);
      if (why.length) blockers.push({ ruleId: r.ruleId, level: r.level, n: c.n, lenient: c.lenient, FPW: c.FPW, why });
    }
  }
  return {
    strata: strataSummary,
    rules: rulesOut,
    totals,
    gold: gold ? goldRecall(gold, marks) : null,
    density: {
      items: perItem.map(({ id, stratum, register, words, tells, per100 }) => ({ id, stratum, register, words, tells, per100 })),
      spin_ham: spinHamOrdering(perItem.filter((i) => i.stratum === pairStratum))
    },
    release_blockers: blockers
  };
}

/** Open known-defect counts per tag from measurement/contrast.json, when that file exists. */
export function contrastCounts(contrast) {
  if (!contrast) return null;
  const rows = Array.isArray(contrast) ? contrast : contrast.rows || contrast.cases || [];
  const open = {};
  for (const row of rows) {
    if (row.status !== "known-defect") continue;
    const tag = row.tag || "untagged";
    open[tag] = (open[tag] || 0) + 1;
  }
  return { rows: rows.length, known_defect_by_tag: Object.fromEntries(Object.keys(open).sort().map((k) => [k, open[k]])) };
}

/** The deterministic report.json object for the committed strata. */
export function buildReport(analyze, corpus = loadCommitted()) {
  const { marks, perItem, engine } = runEngine(analyze, corpus.rules, corpus.items);
  const scored = score({ marks, perItem, labels: corpus.labels, gold: corpus.gold, rules: corpus.rules });
  const produced = new Set(marks.map((m) => keyOf(m.item, m.ruleId, m.start, m.end)));
  return {
    measurement: 1,
    about: "Does the engine agree with one reader? Precision per rule x stratum on the committed items. Labels are one reader's judgement, not proof; floors are reported and never gate.",
    engine: { core: `${engine.name}@${engine.version}`, rules: engine.rules },
    floors: { lenient: FLOORS, FPW: 0, min_n: MIN_N, binds_on: GROUPS.wild, gates: false },
    labels: {
      rows: corpus.labels.length,
      unlabelled_marks: unlabelledMarks(marks, corpus.labels).length,
      not_produced_by_engine: corpus.labels.filter((l) => !produced.has(keyOf(l.item, l.ruleId, l.start, l.end))).length
    },
    ...scored,
    false_positives: falsePositives(marks, corpus.labels),
    contrast: contrastCounts(corpus.contrast)
  };
}

export const serialize = (report) => JSON.stringify(report, null, 1) + "\n";

// ---------------------------------------------------------------- printing
const pct = (x) => (x === null || x === undefined ? "  - " : x.toFixed(2));
const ci = (c) => (c ? `[${c[0].toFixed(2)},${c[1].toFixed(2)}]` : "     -     ");

function printTable(title, rulesOut, totals, columns) {
  console.log(`\n${title}`);
  for (const s of columns) {
    const rows = rulesOut.filter((r) => r.strata[s]);
    if (!rows.length && !totals[s].n) continue;
    console.log(`  -- ${s}`);
    console.log(`  ${"rule".padEnd(34)}${"n".padStart(5)}  TP MEN DEB FPB FPW  ?   strict [95% CI]      lenient [95% CI]     status`);
    for (const r of [...rows, { ruleId: "ALL", strata: totals }]) {
      const c = r.ruleId === "ALL" ? totals[s] : cellOf(r, s);
      console.log(`  ${r.ruleId.padEnd(34)}${String(c.n).padStart(5)} ${[c.TP, c.MENTION, c.DEBATABLE, c.FPB, c.FPW, c.unlabelled].map((v) => String(v).padStart(3)).join(" ")}  ${pct(c.strict)} ${ci(c.strict_ci)}  ${pct(c.lenient)} ${ci(c.lenient_ci)}  ${c.status}`);
    }
  }
}

function printReport(report, { label = "HEAD" } = {}) {
  console.log(`RhetorLint measurement - ${label}: ${report.engine.core} with ${report.engine.rules}`);
  const s = report.strata;
  console.log("committed strata: " + STRATA.map((k) => `${k} ${s[k].items} items/${s[k].words} words`).join(" | "));
  printTable("precision by rule x stratum (pastiche is rules-aware: reported, never gates)", report.rules, report.totals, [...STRATA, "legacy", "wild"]);
  console.log("\ndensity per 100 words (HEAD marks): " + [...STRATA, "all"].map((k) => `${k} ${s[k].per100} (agency ${s[k].agency_marks} = ${s[k].agency_per100}/100, share ${s[k].agency_share})`).join(" | "));
  const sh = report.density.spin_ham;
  console.log(`spin/ham ordering on pastiche pairs: ${sh.correct}/${sh.pairs}` + sh.violations.map((v) => `; ${v.ham} ${v.ham_per100} >= ${v.spin} ${v.spin_per100}`).join(""));
  if (report.gold) {
    const g = report.gold;
    console.log(`gold recall: any rule ${g.any_rule.hit}/${g.any_rule.n}` + Object.entries(g.by_set).map(([k, v]) => ` | ${k} ${v.hit}/${v.n}`).join(""));
    for (const [rule, v] of Object.entries(g.by_rule)) {
      console.log(`  by intended rule ${rule}: ${v.hit}/${v.n}` + (v.incidental.length ? `; incidental overlaps by other rules: ${v.incidental.map((x) => `${x.item} "${x.text}" (${x.rules.join(",")})`).join("; ")}` : ""));
    }
  }
  console.log(`release blockers under proposed floors (wild strata; reported, never gate): ${report.release_blockers.length}`);
  for (const b of report.release_blockers) console.log(`  ${b.ruleId} [${b.level}] n=${b.n}: ${b.why.join("; ")}`);
  if (report.contrast) console.log(`contrast set: open known defects by tag ${JSON.stringify(report.contrast.known_defect_by_tag)}`);
  console.log(`labels: ${report.labels.rows} rows; ${report.labels.unlabelled_marks} current marks unlabelled; ${report.labels.not_produced_by_engine} labelled rows this engine does not produce`);
}

function markdown(report) {
  const cols = ["pastiche", "wild-pd", "target-genre", "technical"];
  const lines = [
    `Measured with \`${report.engine.core}\` + \`${report.engine.rules}\` (labels: one reader's judgement; pastiche never gates).`,
    "",
    "| rule | " + cols.join(" | ") + " |",
    "|---|" + cols.map(() => "---").join("|") + "|"
  ];
  const fmt = (c) => (c.n ? `${c.n} · TP ${c.TP}, FP ${c.FPB + c.FPW}${c.FPW ? ` (FPW ${c.FPW})` : ""} · ${pct(c.strict)}/${pct(c.lenient)}` : "–");
  for (const r of report.rules.filter((r) => cols.some((s) => cellOf(r, s).n))) {
    lines.push(`| \`${r.ruleId}\` | ${cols.map((s) => fmt(cellOf(r, s))).join(" | ")} |`);
  }
  lines.push(`| **all** | ${cols.map((s) => fmt(report.totals[s])).join(" | ")} |`);
  lines.push("", "Cells: marks · TP, FP (FPB+FPW) · strict/lenient precision.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- local strata (printout only)
function localStrata(analyze, rules) {
  const L = join(M, "local");
  if (!existsSync(L)) {
    console.log("\n--local: measurement/local/ is absent; nothing to add.");
    return;
  }
  const corpusDir = join(L, "empirical", "corpus");
  const lg = join(L, "labels-gold.json");
  if (existsSync(corpusDir) && existsSync(lg)) {
    const { labels: raw, gold: rawGold } = readJson(lg);
    const manifest = existsSync(join(corpusDir, "manifest.json")) ? readJson(join(corpusDir, "manifest.json")) : [];
    const kind = Object.fromEntries(manifest.map((m) => [m.id, m.kind]));
    const register = (id) => (kind[id] === "invented" ? "spin" : kind[id] === "invented-negative-control" ? "ham" : "mixed");
    const ids = readdirSync(corpusDir).filter((f) => f.endsWith(".txt") && !f.endsWith(".source.txt")).map((f) => f.slice(0, -4)).sort();
    const items = ids.map((id) => ({ id, stratum: "local-empirical", register: register(id), text: readFileSync(join(corpusDir, `${id}.txt`), "utf8") }));
    const labels = raw.map((l) => ({ item: l.sid, ruleId: l.ruleId, start: l.start, end: l.end, label: l.label }));
    const annotations = [];
    for (const [id, spans] of Object.entries(rawGold)) {
      const text = items.find((i) => i.id === id).text;
      for (const [sub] of spans) {
        const a = text.indexOf(sub);
        if (a >= 0) annotations.push({ item: id, set: "legacy-semeval", start: a, end: a + sub.length, text: sub, rule: null });
      }
    }
    const { marks, perItem } = runEngine(analyze, rules, items);
    const out = score({ marks, perItem, labels, gold: { annotations }, rules, strata: ["local-empirical"], groups: {}, pairStratum: "local-empirical" });
    printTable(`local-empirical: the empirical reader's ${items.length} samples (estate, Fable, Orwell, pastiche; uncommitted)`, out.rules, out.totals, ["local-empirical"]);
    const s = out.strata["local-empirical"];
    const sh = out.density.spin_ham;
    console.log(`  density ${s.per100} per 100 words (${s.marks} marks / ${s.words} words); agency share ${s.agency_share}`);
    console.log(`  gold recall: any rule ${out.gold.any_rule.hit}/${out.gold.any_rule.n}`);
    console.log(`  spin/ham ordering: ${sh.correct}/${sh.pairs}` + sh.violations.map((v) => `; ${v.ham} ${v.ham_per100} ranks above ${v.spin} ${v.spin_per100}`).join(""));
    const missing = unlabelledMarks(marks, labels).length;
    if (missing) console.log(`  ${missing} current marks have no local label (counted as '?', not in n)`);
  }
  const heldout = join(L, "heldout");
  if (existsSync(heldout)) {
    console.log("\nlocal held-out sets (unlabelled; counts only):");
    const walk = (d) => readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : n.endsWith(".txt") && !n.endsWith(".source.txt") ? [p] : [];
    });
    for (const set of readdirSync(heldout).sort()) {
      const files = walk(join(heldout, set));
      let words = 0, tells = 0, agency = 0;
      for (const f of files) {
        const r = analyze(readFileSync(f, "utf8"), { rules });
        words += r.source.words; tells += r.density.tells;
        agency += r.marks.filter((m) => m.ruleId === AGENCY).length;
      }
      console.log(`  ${set.padEnd(26)} ${String(files.length).padStart(3)} files ${String(words).padStart(7)} words ${String(tells).padStart(5)} marks (${r2((tells / words) * 100)}/100)  agency ${agency} (${r2((agency / words) * 100)}/100)`);
    }
  }
  const lines = (name, list) => {
    const marked = list.filter((t) => analyze(t, { rules }).marks.some((m) => m.ruleId === AGENCY)).length;
    console.log(`  ${name.padEnd(26)} ${marked}/${list.length} carry an agency mark`);
  };
  console.log("\nlocal probe sets:");
  if (existsSync(join(L, "twins.json"))) lines("honest twins", readJson(join(L, "twins.json")));
  if (existsSync(join(L, "openlens-specimens.json"))) lines("Open Lens specimens", readJson(join(L, "openlens-specimens.json")).specimens);
  if (existsSync(join(L, "xeng-inputs.jsonl"))) {
    const inputs = readFileSync(join(L, "xeng-inputs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const marked = inputs.filter((t) => analyze(t, { rules }).marks.length).length;
    console.log(`  ${"frontier differential set".padEnd(26)} ${marked}/${inputs.length} carry any mark`);
  }
}

// ---------------------------------------------------------------- --compare <rev>
async function engineAt(rev) {
  const dir = mkdtempSync(join(tmpdir(), "rhetorlint-measure-"));
  const show = (path) => execFileSync("git", ["-C", ROOT, "show", `${rev}:${path}`], { maxBuffer: 64 * 1024 * 1024 });
  const files = execFileSync("git", ["-C", ROOT, "ls-tree", "--name-only", rev, "packages/core/"], { encoding: "utf8" })
    .split("\n").filter((p) => p.endsWith(".mjs"));
  for (const path of files) writeFileSync(join(dir, path.split("/").pop()), show(path));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
  const rules = JSON.parse(show("packages/rules-en/rules.json").toString("utf8"));
  const { analyze } = await import(pathToFileURL(join(dir, "index.mjs")).href);
  return { analyze, rules, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function compareTable(before, after, revLabel) {
  console.log(`\nbefore (${revLabel}) -> after (working tree), committed strata; FP = FPB+FPW; ? = unlabelled`);
  for (const s of [...STRATA, "wild"]) {
    console.log(`  -- ${s}`);
    const ids = [...new Set([...before.rules, ...after.rules].filter((r) => r.strata[s]).map((r) => r.ruleId))].sort();
    const get = (rep, id) => (id === "ALL" ? rep.totals[s] : cellOf(rep.rules.find((r) => r.ruleId === id) || { strata: {} }, s));
    for (const id of [...ids, "ALL"]) {
      const b = get(before, id), a = get(after, id);
      const f = (c) => `n ${String(c.n).padStart(3)} TP ${String(c.TP).padStart(3)} FP ${String(c.FPB + c.FPW).padStart(3)} ? ${String(c.unlabelled).padStart(3)} strict ${pct(c.strict)} lenient ${pct(c.lenient)}`;
      console.log(`  ${id.padEnd(34)} ${f(b)}  ->  ${f(a)}`);
    }
  }
}

// ---------------------------------------------------------------- CLI
async function main(argv) {
  const flag = (name) => argv.includes(name);
  const { analyze } = await import(pathToFileURL(join(ROOT, "packages", "core", "index.mjs")).href);
  const corpus = loadCommitted();
  const report = buildReport(analyze, corpus);
  const reportPath = join(M, "report.json");

  if (flag("--write")) {
    writeFileSync(reportPath, serialize(report));
    console.log(`wrote measurement/report.json (${report.labels.unlabelled_marks} unlabelled marks)`);
  }
  if (flag("--check")) {
    const problems = [];
    if (!existsSync(reportPath) || readFileSync(reportPath, "utf8") !== serialize(report)) {
      problems.push("measurement/report.json is stale: run `node scripts/measure.mjs --write`");
    }
    const { marks } = runEngine(analyze, corpus.rules, corpus.items);
    const missing = unlabelledMarks(marks, corpus.labels, new Date().toISOString().slice(0, 10));
    if (missing.length) {
      problems.push(`${missing.length} current mark(s) on committed items have no label. Proposed rows (hand-label before committing):\n` +
        missing.map((m) => JSON.stringify(m)).join("\n"));
    }
    if (problems.length) {
      console.error(problems.join("\n"));
      process.exitCode = 1;
      return;
    }
    console.log("measurement: report.json is current and every mark is labelled");
  }
  if (flag("--table")) console.log(markdown(report));
  const cmp = argv.indexOf("--compare");
  if (cmp >= 0) {
    const rev = argv[cmp + 1];
    if (!rev || rev.startsWith("--")) throw new Error("--compare needs a git revision");
    const old = await engineAt(rev);
    try {
      compareTable(buildReport(old.analyze, { ...corpus, rules: old.rules }), report, rev);
    } finally {
      old.cleanup();
    }
  }
  const quiet = flag("--check") || flag("--write") || flag("--table") || cmp >= 0;
  if (!quiet || flag("--local")) printReport(report);
  if (flag("--local")) localStrata(analyze, corpus.rules);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.stack || String(error));
    process.exitCode = 1;
  });
}
