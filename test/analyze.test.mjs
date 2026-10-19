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
    "He allegedly stole it.",
    "Allegedly, the company concealed the losses.",
    "The server may have failed because the disk is full.",
    "The outage reportedly affected some users.",
    "The document purportedly describes the agreement.",
    "He reportedly, and allegedly, stole it."
  ]) {
    const r = analyze(text, { rules: RULES });
    const hedges = r.marks.filter((mark) => mark.ruleId === "hedge.deniable");
    assert.ok(hedges.length > 0, "preservation must not disable detection");
    for (const mark of hedges) {
      assert.equal(text.slice(mark.position.start.offset, mark.position.end.offset), mark.actual);
    }
    assert.equal(r.strip, text, "deleting the marker could strengthen the proposition");
    assert.equal(strip(text, r.marks), text, "the direct strip API preserves the same meaning");
  }
});

test("strip removes intensifiers without deleting adjacent qualifications", () => {
  for (const [text, expected] of [
    ["He allegedly made extremely serious errors.", "He allegedly made serious errors."],
    ["The result is reportedly extremely uncertain.", "The result is reportedly uncertain."],
    ["He is extremely allegedly careful.", "He is allegedly careful."]
  ]) {
    const r = analyze(text, { rules: RULES });
    assert.ok(r.marks.some((mark) => mark.ruleId === "hedge.deniable"));
    assert.ok(r.marks.some((mark) => mark.ruleId === "intensifier.loaded"));
    for (const mark of r.marks) {
      assert.equal(text.slice(mark.position.start.offset, mark.position.end.offset), mark.actual);
    }
    assert.equal(r.strip, expected);
    assert.equal(strip(text, r.marks), expected);
  }
});

test("strip keeps an intensifier under a negator or inside a quotation", () => {
  for (const text of [
    "The risk is not extremely high, but it is not negligible.",
    "The update isn't hugely different.",
    "The update isn\u2019t hugely different.",
    "We are not deeply sorry.",
    "The risk cannot be extremely high.",
    "NOT EXTREMELY HIGH",
    "\"It was utterly devastating,\" the flood survivor told reporters.",
    "He said \u201cwe are deeply sorry\u201d and left.",
    // A comma is not a break for strip's negator: only absolute.universal's guard ends a negator's reach there.
    "It isn\u2019t, frankly, extremely high.",
    "We said no, extremely few agreed."
  ]) {
    const r = analyze(text, { rules: RULES });
    const intensifiers = r.marks.filter((mark) => mark.ruleId === "intensifier.loaded");
    assert.equal(intensifiers.length, 1, "preservation must not disable detection");
    assert.equal(
      text.slice(intensifiers[0].position.start.offset, intensifiers[0].position.end.offset),
      intensifiers[0].actual
    );
    assert.equal(r.strip, text, "deleting it would strengthen the claim or edit quoted words");
    assert.equal(strip(text, r.marks), text, "the direct strip API keeps it too");
  }
});

test("strip still subtracts an intensifier the negator and quotation guards do not reach", () => {
  for (const [text, expected] of [
    ["This is an incredibly important update for every customer.",
      "This is an important update for every customer."],
    // The negator is the third word back: the window is two words.
    ["Not bad, and extremely cheap.", "Not bad, and cheap."],
    ["No doubt the team is extremely proud.", "No doubt the team is proud."],
    // The negator is the word before, but a clause break stands between them.
    ...[".", ";", ":", "!", "?"].map((brk) =>
      [`We said no${brk} extremely few agreed.`, `We said no${brk} few agreed.`]),
    // The quotation closed before the intensifier.
    ["\"Fine,\" she said, extremely calmly.", "\"Fine,\" she said, calmly."],
    ["He said \u201chello\u201d and was extremely calm.", "He said \u201chello\u201d and was calm."],
    // A quotation opened on an earlier line does not reach this one.
    ["He said \"hello\nand it was extremely loud.", "He said \"hello\nand it was loud."]
  ]) {
    const r = analyze(text, { rules: RULES });
    assert.ok(r.marks.some((mark) => mark.ruleId === "intensifier.loaded"));
    assert.equal(r.strip, expected);
    assert.equal(strip(text, r.marks), expected);
  }
});

const absolutes = (text) =>
  analyze(text, { rules: RULES }).marks.filter((mark) => mark.ruleId === "absolute.universal");

test("absolute.universal leaves a negated absolute and an imperative 'Never' unmarked", () => {
  for (const text of [
    "Returns are not guaranteed; past performance is no indicator.",
    "Results aren't always typical.",
    "Results aren’t always typical.",
    "Not everyone qualifies.",
    "NOT EVERYONE QUALIFIES.",
    "The risk cannot always be priced.",
    "Never share your password with anyone.",
    "NEVER share it.",
    "Never\tshare it.",
    "\"Never share it,\" he said.",
    "Explain real constraints; never manufacture the shortage.",
    ...[".", ";", ":", "!", "?"].map((brk) => `Check the link${brk} never click it.`),
    // A negator followed directly by a comma reaches past the aside.
    "Past performance is not, however, always a guide.",
    "No, never.",
    // An adverb between 'Never' and its verb hands the decision to the verb.
    "Never ever share your password.",
    "Never again leave it unlocked.",
    "Never once doubt it.",
    // A word is compared whole: 'answer' is not 'an'.
    "Never answer it."
  ]) {
    assert.deepEqual(absolutes(text).map((mark) => mark.actual), [], text);
  }
});

test("absolute.universal still marks absolutes the negator and imperative guards do not reach", () => {
  for (const [text, actual] of [
    ["This is guaranteed to double your savings.", "guaranteed"],
    ["Everyone knows this policy works.", "Everyone"],
    ["Our product will always be the best choice.", "always"],
    // The negator is the third word back: the window is two words.
    ["Not bad, and always cheap.", "always"],
    // The negator is the word before, but a clause break stands between them.
    ...[".", ";", ":", "!", "?"].map((brk) => [`We said no${brk} everyone agreed.`, "everyone"]),
    // 'never' that does not open its clause, or that no lowercase word follows.
    ["We never share data.", "never"],
    ["Love begins with choice, never obligation.", "never"],
    ["Never Again.", "Never"],
    ["Never.", "Never"],
    ["Never, ever.", "Never"],
    ["Never\nshare it.", "Never"],
    // A line break is not a clause break.
    ["We will\nnever share it.", "never"],
    // A comma ends a negator's reach once a word stands between them.
    ["No risk, guaranteed.", "guaranteed"],
    ["Don't wait, everyone is buying.", "everyone"],
    ["No fees, always free.", "always"],
    ["No contracts, no fees, no exceptions.", "no exceptions"],
    // A clause-initial 'Never' before a word that cannot be its verb is a fragment or an inversion.
    ["Battery life? Never an issue.", "Never"],
    ["Never again will prices be this low.", "Never"],
    ["Never has a product been this good.", "Never"],
    ["Never before have prices been this low.", "Never"],
    ["Never again.", "Never"],
    ["Never ever again.", "Never"],
    ["Never again\nshare it.", "Never"]
  ]) {
    const marks = absolutes(text);
    assert.deepEqual(marks.map((mark) => mark.actual), [actual], text);
    assert.equal(text.slice(marks[0].position.start.offset, marks[0].position.end.offset), actual);
  }
  // The guard reads absolute.universal only: other rules keep their marks under a negator.
  assert.ok(analyze("It is not world-class.", { rules: RULES }).marks
    .some((mark) => mark.ruleId === "puffery.peacock"));
});

// The imperative 'Never' guard's two closed lists, declared here so an engine
// that drops or adds a word fails.
const NEVER_NON_VERBS = [
  "a", "an", "the", "any", "before", "so", "such", "in", "at", "on",
  "has", "have", "had", "is", "are", "was", "were", "will", "would", "could",
  "should", "can", "did", "does", "been", "being"
];
const NEVER_PASS_THROUGH = ["again", "ever", "once"];

test("absolute.universal reads the word after a clause-initial 'Never' against two closed lists", () => {
  const actuals = (text) => absolutes(text).map((mark) => mark.actual);
  for (const word of NEVER_NON_VERBS) {
    assert.deepEqual(actuals(`Never ${word} x.`), ["Never"], word);
    // After its lowercase first letter, the word is compared in ASCII lower case: "hAS" is "has".
    const mixed = word[0] + word.slice(1).toUpperCase();
    assert.deepEqual(actuals(`Go; never ${mixed} x.`), ["never"], mixed);
  }
  for (const adverb of NEVER_PASS_THROUGH) {
    assert.deepEqual(actuals(`Never ${adverb} share it.`), [], adverb);
    assert.deepEqual(actuals(`Never ${adverb} ${NEVER_PASS_THROUGH[0]} share it.`), [], adverb);
    for (const word of NEVER_NON_VERBS) assert.deepEqual(actuals(`Never ${adverb} ${word} x.`), ["Never"], `${adverb} ${word}`);
    assert.deepEqual(actuals(`Never ${adverb}.`), ["Never"], adverb);
    assert.deepEqual(actuals(`Never ${adverb} Share it.`), ["Never"], adverb);
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

const agencySpans = (text) => analyze(text, { rules: RULES }).marks
  .filter((m) => m.ruleId === "agency-hiding.deleted-subject")
  .map((m) => [m.actual, m.position.start.offset, m.position.end.offset]);

test("the agency detector marks an accountable past passive, auxiliary through participle", () => {
  const cases = [
    ["Mistakes were made.", "were made"],
    ["Mistakes, frankly, were made.", "were made"],
    ["Customer data was quietly accessed.", "was quietly accessed"],
    ["Your data was shared with partners.", "was shared"],
    ["PII may have been compromised.", "been compromised"],
    ["Records were withheld from investigators.", "were withheld"],
    ["It was decided that the program would end.", "was decided"],
    ["Hundreds of workers were laid off.", "were laid off"],
    ["Additional safeguards have been put in place.", "been put"],
    ["Concerns were raised about the audit.", "were raised"],
    ["MISTAKES WERE MADE.", "WERE MADE"]
  ];
  for (const [text, actual] of cases) {
    const at = text.indexOf(actual);
    assert.deepEqual(agencySpans(text), [[actual, at, at + actual.length]], text);
  }
});

test("the agency detector leaves procedure, named agents, harm verbs and idioms unmarked", () => {
  for (const text of [
    "My name is Fred.",
    "JavaScript is required.",
    "Soil water content was measured at 5 cm depth.",
    "The soup can be frozen for up to 3 months.",
    "This option is ignored when the flag is unset.",
    "The startup has been described as the next big thing by Forbes.",
    // A pinned under-mark: "by" names when, not who, and the rule stays silent.
    "The report was shelved by Friday.",
    "Lives were lost in the earthquake.",
    "Your account was closed at your request.",
    "He got fired up about the album.",
    "We won’t be utterly ruined.",
    "This is guaranteed to double your savings.",
    // Methods-section procedure: collected, retained and transferred are not in
    // the lexicon, and a light verb needs an error or decision noun before it.
    "Data were collected from 200 participants.",
    "Information was collected via a survey.",
    "Samples were collected at dawn.",
    "Records were retained for seven years.",
    "Data were transferred to a secure server.",
    "If no error was raised, the call succeeded.",
    // Present, modal, progressive and relative-clause passives are out of reach.
    "Mistakes are made every day.",
    "Records were being withheld.",
    "The mistakes that have been made are regrettable.",
    "Workers were exposed to asbestos.",
    "Mistakes were made\nby the board."
  ]) {
    assert.deepEqual(agencySpans(text), [], text);
  }
});

test("a no-break space or a folded look-alike letter joins no passive", () => {
  for (const text of ["Mistakes were made.", "Your data was\u000bshared.", "Civilians were Killed.", "Your data was ſhared."]) {
    assert.deepEqual(agencySpans(text), [], JSON.stringify(text));
  }
});

test("strip flags exactly the agency marks it is given", () => {
  assert.equal(analyze("My name is Fred.", { rules: RULES }).strip, "My name is Fred.");
  assert.equal(analyze("Mistakes were made.", { rules: RULES }).strip, "Mistakes [who?] were made.");
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
