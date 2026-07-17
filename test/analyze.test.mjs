import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze, strip } from "../packages/core/index.mjs";
import { toSarif } from "../packages/core/sarif.mjs";

const RULES = JSON.parse(
  readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url))
);
const SCHEMA = JSON.parse(
  readFileSync(new URL("../spec/output.schema.json", import.meta.url))
);
const CORE_PACKAGE = JSON.parse(
  readFileSync(new URL("../packages/core/package.json", import.meta.url))
);

const SPECIMEN =
  "We take your privacy extremely seriously, and regrettably, mistakes were made. " +
  "We are reaching out to affected users.";

test("the specimen fires the expected families of tells", () => {
  const r = analyze(SPECIMEN, { rules: RULES });
  const ids = r.marks.map((m) => m.ruleId);
  assert.ok(ids.includes("intensifier.loaded"), "should mark the intensifier 'extremely'");
  assert.ok(ids.includes("contrition.rehearsed"), "should mark 'we take ... seriously'");
  assert.ok(ids.includes("agency-hiding.deleted-subject"), "should mark 'were made'");
  assert.ok(ids.includes("hedge.softener"), "should mark 'reaching out to'");
  assert.ok(r.density.tells >= 4, "at least four tells");
  assert.ok(r.density.per100Words > 0);
});

test("every mark points at a real, visible phrase (positions are exact)", () => {
  const r = analyze(SPECIMEN, { rules: RULES });
  assert.ok(r.marks.length > 0);
  for (const m of r.marks) {
    const slice = SPECIMEN.slice(m.position.start.offset, m.position.end.offset);
    assert.equal(slice, m.actual, `mark '${m.ruleId}' must point at its own text`);
  }
});

test("the deleted-subject mark catches the agentless passive", () => {
  const r = analyze(SPECIMEN, { rules: RULES });
  const dm = r.marks.find((m) => m.ruleId === "agency-hiding.deleted-subject");
  assert.ok(dm, "found the passive mark");
  assert.match(dm.actual, /were made/);
  assert.equal(dm.family, "agency-hiding");
});

test("strip subtracts adverbial spin and flags the hidden agent, without breaking grammar", () => {
  const r = analyze(SPECIMEN, { rules: RULES });
  assert.ok(!/extremely/.test(r.strip), "intensifier removed");
  assert.ok(/\[who\?\]/.test(r.strip), "agentless passive flagged with [who?]");
  // verb-phrase hedges are left marked, not deleted, so the sentence stays whole
  assert.ok(/reaching out to/.test(r.strip), "verb-phrase hedge left intact for the reader to judge");
  assert.ok(!/\s{2,}/.test(r.strip), "no double spaces left at removal seams");
});

test("stripping a deniable adverb is grammar-safe", () => {
  const r = analyze("The outage reportedly affected some users.", { rules: RULES });
  assert.ok(!/reportedly/.test(r.strip), "'reportedly' removed");
});

test("an honest, active sentence produces zero tells", () => {
  const clean = "I made a mistake and I will fix it by Friday.";
  const r = analyze(clean, { rules: RULES });
  assert.equal(r.density.tells, 0, `clean text should have no marks, got: ${JSON.stringify(r.marks.map(m=>m.actual))}`);
});

test("the 'by <agent>' escape prevents a false passive flag", () => {
  const withAgent = "The report was written by the committee.";
  const r = analyze(withAgent, { rules: RULES });
  const passive = r.marks.filter((m) => m.ruleId === "agency-hiding.deleted-subject");
  assert.equal(passive.length, 0, "a named agent means it is not hiding anything");
});

test("predicate adjectives are not mistaken for passives", () => {
  const r = analyze("We were tired and we were committed to the plan.", { rules: RULES });
  const passive = r.marks.filter((m) => m.ruleId === "agency-hiding.deleted-subject");
  assert.equal(passive.length, 0, "'were tired' / 'were committed' are not agentless passives");
});

test("the core never fabricates a rewrite", () => {
  const r = analyze(SPECIMEN, { rules: RULES });
  assert.equal(r.rewrite, null, "rewrite stays null without a model adapter");
});

test("an optional rewrite adapter is honored when supplied", () => {
  const r = analyze(SPECIMEN, { rules: RULES, rewrite: () => "plain truth here" });
  assert.equal(r.rewrite, "plain truth here");
});

test("rewrite adapters must return a string synchronously", () => {
  assert.throws(
    () => analyze(SPECIMEN, { rules: RULES, rewrite: async () => "later" }),
    /must return a string synchronously/
  );
  assert.throws(
    () => analyze(SPECIMEN, { rules: RULES, rewrite: () => undefined }),
    /must return a string/
  );
  assert.throws(
    () => analyze(SPECIMEN, {
      rules: RULES,
      rewrite: async () => { throw new Error("adapter failed later"); }
    }),
    /must return a string synchronously/
  );
});

test("analyze() refuses to run without a rule pack", () => {
  assert.throws(() => analyze("x"), /rule pack/);
});

test("result carries the shape the output schema requires", () => {
  const r = analyze(SPECIMEN, { rules: RULES });
  for (const key of SCHEMA.required) assert.ok(key in r, `missing required key '${key}'`);
  assert.equal(r.rhetorlint, "0.1");
  assert.ok(SCHEMA.$defs.mark.properties.family.enum.includes(r.marks[0].family));
  assert.ok(typeof r.engine.rules === "string" && r.engine.rules.includes("@"));
  assert.equal(r.engine.version, CORE_PACKAGE.version, "engine provenance matches the package");
});

test("SARIF conversion is well-formed", () => {
  const r = analyze(SPECIMEN, { rules: RULES });
  const sarif = toSarif(r);
  assert.equal(sarif.version, "2.1.0");
  const run = sarif.runs[0];
  assert.equal(run.results.length, r.marks.length);
  assert.ok(run.tool.driver.rules.length > 0);
  for (const res of run.results) {
    assert.ok(["note", "warning", "error", "none"].includes(res.level));
    assert.ok(res.locations[0].physicalLocation.region.charOffset >= 0);
  }
  assert.deepEqual(run.properties.density, r.density);
});
