// measurement/ asks whether the engine agrees with people; conformance/ asks
// whether the engines agree with each other. These tests keep the committed
// measurement honest: every mark the canonical engine makes on a committed item
// carries a human label, labels and gold point at real text, no rule's false
// positives move without a deliberate baseline change, and report.json is current.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { analyze } from "../packages/core/index.mjs";
import {
  loadCommitted, runEngine, unlabelledMarks, falsePositives, buildReport, serialize, keyOf, wilson
} from "../scripts/measure.mjs";
import { validate, assertSupported } from "./helpers/schema-validator.mjs";

const M = new URL("../measurement/", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, M), "utf8"));
const corpus = loadCommitted();
const { marks } = runEngine(analyze, corpus.rules, corpus.items);
const itemById = new Map(corpus.items.map((item) => [item.id, item]));

for (const [data, schema] of [["items.json", "items"], ["labels.json", "labels"], ["gold.json", "gold"]]) {
  test(`measurement/${data} matches schema/${schema}.schema.json`, () => {
    const s = json(`schema/${schema}.schema.json`);
    assertSupported(s);
    assert.deepEqual(validate(json(data), s), []);
  });
}

test("each committed item is the exact file items.json describes", () => {
  const files = readdirSync(new URL("items/", M)).filter((f) => f.endsWith(".txt")).map((f) => f.slice(0, -4)).sort();
  assert.deepEqual(files, corpus.items.map((i) => i.id).sort(), "measurement/items/ and items.json must list the same ids");
  for (const item of corpus.items) {
    const bytes = readFileSync(new URL(`items/${item.id}.txt`, M));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256, `${item.id}: sha256`);
    assert.equal((item.text.trim().match(/\S+/g) || []).length, item.words, `${item.id}: words`);
    assert.ok(bytes.length <= 20 * 1024, `${item.id}: at most 20 KB`);
    assert.ok(!bytes.includes(13), `${item.id}: LF line endings only`);
    assert.doesNotMatch(item.text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, `${item.id}: no email-like strings`);
    if (item.stratum === "pastiche") {
      assert.match(item.provenance, /rules-aware/, `${item.id}: pastiche must say it was written after reading the rules`);
    }
  }
});

test("each label points at the text it names", () => {
  const labellers = new Set(json("labels.json").labellers.map((l) => l.id));
  const seen = new Set();
  for (const l of corpus.labels) {
    const key = keyOf(l.item, l.ruleId, l.start, l.end);
    assert.ok(!seen.has(key), `duplicate label ${key}`);
    seen.add(key);
    assert.ok(itemById.has(l.item), `${key}: unknown item`);
    assert.ok(labellers.has(l.by), `${key}: unknown labeller '${l.by}'`);
    assert.equal(itemById.get(l.item).text.slice(l.start, l.end), l.actual, `${key}: actual differs from the item text at its offsets`);
  }
});

test("each gold span points at the text it names", () => {
  const sets = new Set(corpus.gold.sets.map((s) => s.id));
  for (const g of corpus.gold.annotations) {
    assert.ok(sets.has(g.set), `${g.item}: unknown gold set '${g.set}'`);
    assert.ok(itemById.has(g.item), `${g.item}: unknown item`);
    assert.equal(itemById.get(g.item).text.slice(g.start, g.end), g.text, `${g.item}@${g.start}: gold text differs from the item`);
  }
});

test("every mark the engine makes on a committed item has a human label", () => {
  const missing = unlabelledMarks(marks, corpus.labels, new Date().toISOString().slice(0, 10));
  assert.equal(
    missing.length, 0,
    `${missing.length} mark(s) on committed items have no label in measurement/labels.json.\n` +
    "Proposed rows (a PROPOSAL: read each mark in context, choose TP | MENTION | DEBATABLE | FPB | FPW and a reason, then commit):\n" +
    missing.map((m) => JSON.stringify(m)).join("\n")
  );
});

test("no rule's false-positive count moved from measurement/baseline.json", () => {
  const baseline = json("baseline.json").false_positives;
  const now = falsePositives(marks, corpus.labels);
  const total = (x) => (x ? x.FPB + x.FPW : 0);
  const problems = [];
  for (const ruleId of [...new Set([...Object.keys(baseline), ...Object.keys(now)])].sort()) {
    const before = total(baseline[ruleId]), after = total(now[ruleId]);
    if (after > before) problems.push(`${ruleId}: FPB+FPW rose ${before} -> ${after} (a regression: fix the rule, do not re-baseline)`);
    if (after < before) problems.push(`${ruleId}: FPB+FPW fell ${before} -> ${after} (lock the gain in: update measurement/baseline.json in this commit)`);
  }
  assert.deepEqual(problems, [], problems.join("\n") + "\ncurrent false_positives:\n" + JSON.stringify(now, null, 1));
});

test("measurement/report.json is current", () => {
  const expected = serialize(buildReport(analyze, corpus));
  assert.ok(
    readFileSync(new URL("report.json", M), "utf8") === expected,
    "measurement/report.json is stale: run `node scripts/measure.mjs --write` and commit the result"
  );
});

test("Wilson intervals are bounded and deterministic", () => {
  assert.equal(wilson(0, 0), null);
  assert.deepEqual(wilson(20, 31), [0.469, 0.789]);
  assert.deepEqual(wilson(5, 5), [0.566, 1]);
  assert.deepEqual(wilson(0, 5), [0, 0.434]);
});
