import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";
import { SIGNAL_SCHEMA, toSignal } from "../packages/core/signals.mjs";

const RULES = JSON.parse(
  readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url))
);
const SPECIMEN =
  "We take your privacy extremely seriously, and regrettably, mistakes were made. " +
  "We are reaching out to affected users.";

function result() {
  return analyze(SPECIMEN, { rules: RULES, rewrite: () => "A private rewrite." });
}

test("the default signal is an aggregate with no phrase or rewrite disclosure", () => {
  const analyzed = result();
  const signal = toSignal(analyzed);
  const json = JSON.stringify(signal);

  assert.equal(signal.schema, SIGNAL_SCHEMA);
  assert.equal(signal.kind, "rhetorlint.analysis");
  assert.ok(!Object.hasOwn(signal, "marks"));
  assert.ok(!Object.hasOwn(signal, "strip"));
  assert.ok(!Object.hasOwn(signal, "rewrite"));
  assert.ok(!json.includes("extremely"), "a matched phrase must stay redacted by default");
  assert.ok(!json.includes("A private rewrite."), "the rewrite must never enter a signal");
  assert.deepEqual(signal.source, analyzed.source);
  assert.deepEqual(signal.density, analyzed.density);
  assert.deepEqual(signal.engine, analyzed.engine);
  assert.notEqual(signal.source, analyzed.source, "source provenance is cloned");
  assert.notEqual(signal.density, analyzed.density, "density provenance is cloned");
  assert.notEqual(signal.engine, analyzed.engine, "engine provenance is cloned");
  assert.deepEqual(signal.boundary.doesNot, [
    "infer-speaker-intent",
    "detect-deception",
    "determine-factual-truth"
  ]);
  assert.deepEqual(JSON.parse(json), signal, "the signal round-trips through JSON");
});

test("includeMarks true explicitly opts into cloned phrase-level marks", () => {
  const analyzed = result();
  const signal = toSignal(analyzed, { includeMarks: true });

  assert.equal(signal.marks.length, analyzed.marks.length);
  assert.deepEqual(signal.marks, analyzed.marks);
  assert.notEqual(signal.marks, analyzed.marks);
  assert.notEqual(signal.marks[0], analyzed.marks[0]);
  assert.notEqual(signal.marks[0].position, analyzed.marks[0].position);
  assert.notEqual(signal.marks[0].expected, analyzed.marks[0].expected);
  assert.ok(signal.marks.some((mark) => mark.actual === "extremely"));
  assert.ok(!Object.hasOwn(signal, "strip"));
  assert.ok(!Object.hasOwn(signal, "rewrite"));
  assert.deepEqual(JSON.parse(JSON.stringify(signal)), signal, "disclosed marks remain JSON-safe");

  const notLiteralTrue = toSignal(analyzed, { includeMarks: "true" });
  assert.ok(!Object.hasOwn(notLiteralTrue, "marks"), "only boolean true discloses marks");
});

test("family and rule counts are sorted, deterministic, and do not mutate the result", () => {
  const analyzed = result();
  const before = JSON.stringify(analyzed);
  const signal = toSignal(analyzed);
  const reordered = { ...analyzed, marks: [...analyzed.marks].reverse() };

  assert.deepEqual(signal.summary.families, [
    { id: "agency-hiding", count: 1 },
    { id: "manipulative-wording", count: 3 }
  ]);
  assert.deepEqual(signal.summary.rules, [
    { id: "agency-hiding.deleted-subject", count: 1 },
    { id: "contrition.rehearsed", count: 1 },
    { id: "hedge.softener", count: 1 },
    { id: "intensifier.loaded", count: 1 }
  ]);
  assert.deepEqual(toSignal(reordered), signal, "aggregate output ignores mark order");
  assert.equal(JSON.stringify(analyzed), before, "conversion leaves the canonical result untouched");
});
