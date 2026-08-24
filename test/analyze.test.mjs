import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze, strip } from "../packages/core/index.mjs";
import { toSarif } from "../packages/core/sarif.mjs";
import { validate } from "./helpers/schema-validator.mjs";

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

function testPack(rules, overrides = {}) {
  return {
    id: "test-pack",
    version: "1.0.0",
    locale: "en",
    rules,
    ...overrides
  };
}

function lexicalRule(overrides = {}) {
  return {
    ruleId: "example.marker",
    family: "manipulative-wording",
    type: "lexical",
    terms: ["example"],
    ...overrides
  };
}

function patternRule(overrides = {}) {
  return {
    ruleId: "example.marker",
    family: "manipulative-wording",
    type: "pattern",
    pattern: "example",
    ...overrides
  };
}

function structuralRule(overrides = {}) {
  return {
    ruleId: "example.marker",
    family: "agency-hiding",
    type: "structural",
    detector: "agentless-passive",
    ...overrides
  };
}

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

test("strip removes a loaded intensifier and flags the hidden agent", () => {
  const r = analyze(SPECIMEN, { rules: RULES });
  assert.ok(!/extremely/.test(r.strip), "intensifier removed");
  assert.ok(/\[who\?\]/.test(r.strip), "agentless passive flagged with [who?]");
  // verb-phrase hedges are left marked, not deleted, so the sentence stays whole
  assert.ok(/reaching out to/.test(r.strip), "verb-phrase hedge left intact for the reader to judge");
  assert.ok(!/\s{2,}/.test(r.strip), "no double spaces left at removal seams");
});

test("strip preserves epistemic modality and attribution", () => {
  for (const text of [
    "The server may have failed because the disk is full.",
    "The outage reportedly affected some users."
  ]) {
    const r = analyze(text, { rules: RULES });
    assert.ok(r.marks.some((mark) => mark.ruleId === "hedge.deniable"));
    assert.equal(r.strip, text, "deleting the marker could strengthen the proposition");
  }
});

test("strip is identity without an actionable mark and cleans only removal seams", () => {
  for (const text of ["a  b", "a\n\nb", "  a  ", "a\t\tb"]) {
    assert.equal(strip(text, []), text);
  }

  const spaced = "A  extremely   careful claim.\nSecond  line.";
  assert.equal(
    analyze(spaced, { rules: RULES }).strip,
    "A careful claim.\nSecond  line.",
    "the removal seam is tidied without changing whitespace on the next line"
  );
  assert.equal(analyze("A extremely, careful claim.", { rules: RULES }).strip,
    "A, careful claim.");
  assert.equal(analyze("A, extremely, careful claim.", { rules: RULES }).strip,
    "A, careful claim.");
  assert.equal(analyze("Careful, extremely", { rules: RULES }).strip, "Careful,");
  assert.equal(analyze("Careful extremely", { rules: RULES }).strip, "Careful");
  assert.equal(analyze("Extremely careful", { rules: RULES }).strip, "careful");
  assert.equal(
    analyze("A extremely\nNext  line.", { rules: RULES }).strip,
    "A\nNext  line."
  );
  assert.equal(
    analyze("A\nextremely clear", { rules: RULES }).strip,
    "A\nclear",
    "removing a marker at true line-start must not manufacture indentation"
  );
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

test("a rewrite adapter receives detached marks and cannot corrupt canonical output", () => {
  const baseline = analyze(SPECIMEN, { rules: RULES });
  const rulesBefore = JSON.stringify(RULES);
  const r = analyze(SPECIMEN, {
    rules: RULES,
    rewrite: (_text, marks) => {
      marks[0].actual = "fabricated";
      marks[0].position.start.offset = 999;
      marks[0].expected.push("poisoned prompt");
      marks.reverse();
      marks.length = 0;
      return "caller supplied rewrite";
    }
  });

  assert.equal(r.rewrite, "caller supplied rewrite");
  assert.deepEqual(r.marks, baseline.marks);
  assert.equal(r.strip, baseline.strip);
  assert.equal(JSON.stringify(RULES), rulesBefore, "adapter mutations cannot reach the pack");
  for (const mark of r.marks) {
    assert.equal(
      SPECIMEN.slice(mark.position.start.offset, mark.position.end.offset),
      mark.actual
    );
  }
});

test("a rewrite adapter cannot rewrite snapshotted locale or rule provenance", () => {
  const mutablePack = structuredClone(RULES);
  const options = { rules: mutablePack, locale: "en-GB", rewrite: null };
  const originalRules = `${mutablePack.id}@${mutablePack.version}`;
  options.rewrite = () => {
    mutablePack.id = "changed-pack";
    mutablePack.version = "9.9.9";
    mutablePack.locale = "de";
    options.locale = "fr";
    return "caller supplied rewrite";
  };

  const result = analyze(SPECIMEN, options);
  assert.equal(result.source.locale, "en-GB");
  assert.equal(result.engine.rules, originalRules);
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

test("analyze() rejects inputs that could produce a malformed result", () => {
  assert.throws(() => analyze(42, { rules: RULES }), /text must be a string/);
  assert.throws(() => analyze("text", null), /options must be an object/);
  assert.throws(
    () => analyze("text", { rules: RULES, locale: 42 }),
    /options\.locale must be a valid locale/
  );
  assert.throws(
    () => analyze("text", { rules: RULES, locale: "not a locale" }),
    /options\.locale must be a valid locale/
  );
});

test("overlapping lexical terms match longest-first without changing authored order", () => {
  const terms = ["kind", "kind of"];
  const rules = testPack([lexicalRule({ terms })]);
  const result = analyze("This is kind of useful.", { rules });

  assert.equal(result.marks.length, 1);
  assert.equal(result.marks[0].actual, "kind of");
  assert.deepEqual(terms, ["kind", "kind of"]);
});

test("rule-pack validation rejects malformed, unsupported, and unbounded matchers", () => {
  const duplicate = lexicalRule();
  const cases = [
    [testPack([lexicalRule({ terms: [] })]), /terms.*between 1 and 256/],
    [testPack([lexicalRule({ terms: [" "] })]), /terms\[0\].*visible characters/],
    [testPack([duplicate, { ...duplicate }]), /duplicates 'example\.marker'/],
    [testPack([lexicalRule({ ruleId: "not an id" })]), /ruleId.*unsupported format/],
    [testPack([lexicalRule({ family: "unknown-family" })]), /unsupported family/],
    [testPack([lexicalRule({ type: "unknown" })]), /unsupported matcher type/],
    [testPack([structuralRule({ detector: "unknown" })]),
      /unsupported structural detector/],
    [testPack([patternRule({ pattern: "[" })]),
      /not a valid JavaScript regular expression/],
    [testPack([patternRule({ pattern: "a*" })]),
      /consume at least one character/],
    [testPack([patternRule({ pattern: "(?:a|)" })]),
      /consume at least one character/],
    [testPack([patternRule({ minEngine: "999.0.0" })]),
      /needs core >= 999\.0\.0/],
    [testPack([lexicalRule({ confidence: Number.NaN })]), /confidence.*finite number/],
    [testPack([lexicalRule({ level: "critical" })]), /unsupported level/],
    [testPack([lexicalRule({ expected: [""] })]), /expected\[0\].*non-empty string/],
    [testPack([lexicalRule({ unexpected: true })]), /property 'unexpected' is not supported/],
    [testPack([lexicalRule({ terms: ["x".repeat(257)] })]), /at most 256 characters/],
    [testPack([patternRule({ pattern: "x".repeat(4097) })]),
      /at most 4096 characters/],
    [testPack(Array.from({ length: 513 }, (_, index) =>
      lexicalRule({ ruleId: `family-${index}.marker` }))), /at most 512 rules/]
  ];

  for (const [rules, message] of cases) {
    assert.throws(() => analyze("example", { rules }), message);
  }

  assert.throws(
    () => analyze("example", { rules: testPack([lexicalRule()], { version: "v1" }) }),
    /version.*unsupported format/
  );
  assert.throws(
    () => analyze("example", { rules: testPack([lexicalRule()], { id: "bad id" }) }),
    /id.*unsupported format/
  );
  assert.throws(
    () => analyze("example", {
      rules: testPack([lexicalRule()], { unexpected: true })
    }),
    /property 'unexpected' is not supported/
  );

  const accessorRule = lexicalRule();
  Object.defineProperty(accessorRule, "family", {
    enumerable: true,
    get: () => "manipulative-wording"
  });
  assert.throws(
    () => analyze("example", { rules: testPack([accessorRule]) }),
    /family.*enumerable data property/
  );

  const accessorPack = testPack([lexicalRule()]);
  Object.defineProperty(accessorPack, "rules", {
    enumerable: true,
    get: () => [lexicalRule()]
  });
  assert.throws(
    () => analyze("example", { rules: accessorPack }),
    /rules.*enumerable data property/
  );
});

test("result carries the shape the output schema requires", () => {
  const r = analyze(SPECIMEN, { rules: RULES });
  assert.deepEqual(
    validate(r, SCHEMA),
    [],
    "the published schema is the contract; a result that violates it is a broken release"
  );
  assert.equal(r.rhetorlint, "0.1");
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
