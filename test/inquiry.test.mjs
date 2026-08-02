import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";
import { INQUIRY_SCHEMA, toInquiry } from "../packages/core/inquiry.mjs";
import { assertSupported, validate } from "./helpers/schema-validator.mjs";

const RULES = JSON.parse(
  readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url))
);
const SCHEMA = JSON.parse(
  readFileSync(new URL("../spec/inquiry.schema.json", import.meta.url))
);
const TEXT =
  "Experts say we must act now, and mistakes were made. " +
  "This is obviously the only option.";

function analyzed() {
  return analyze(TEXT, { rules: RULES, rewrite: () => "Private model output." });
}

test("the inquiry schema uses only enforced constructs", () => {
  assertSupported(SCHEMA);
});

test("the inquiry schema rejects an item that silently drops its hypotheses", () => {
  const inquiry = toInquiry(analyzed(), { rules: RULES });
  inquiry.items[0].effectHypotheses = [];
  assert.ok(
    validate(inquiry, SCHEMA).some((error) => /at least 1 items/.test(error)),
    "empty inquiry metadata must not look like a complete join"
  );
});

test("default inquiry is schema-valid, deterministic, and phrase-redacted", () => {
  const result = analyzed();
  const before = JSON.stringify(result);
  const inquiry = toInquiry(result, { rules: RULES, sourceRef: "case:inquiry" });
  const reversedPack = { ...RULES, rules: [...RULES.rules].reverse() };
  const json = JSON.stringify(inquiry);

  assert.equal(inquiry.schema, INQUIRY_SCHEMA);
  assert.equal(inquiry.kind, "rhetorlint.inquiry");
  assert.equal(inquiry.sourceRef, "case:inquiry");
  assert.deepEqual(inquiry.boundary, {
    observation: "span-and-position-only",
    classification: "rule-pack-candidate-context-required",
    interpretation: "hypotheses-not-findings",
    effects: "recipient-specific-evidence-required",
    truth: "questions-not-verdicts"
  });
  assert.deepEqual(inquiry.assurance, {
    metadataSource: "caller-supplied-rule-pack",
    boundary: "declared-not-semantically-verified",
    fingerprintUse: "change-detection-not-authentication",
    analysisPackBinding: "id-version-and-matched-family-only"
  });
  assert.deepEqual(inquiry.sourceAccess, {
    source: "not-included",
    reference: "caller-supplied-unverified",
    markedPhrases: "omitted"
  });
  assert.match(inquiry.metadataFingerprint, /^fnv1a64:[0-9a-f]{16}$/);
  assert.deepEqual(validate(inquiry, SCHEMA), []);
  assert.deepEqual(JSON.parse(json), inquiry);
  assert.ok(inquiry.items.length > 0);
  assert.ok(inquiry.items.every(
    (item) => item.markRef.classificationStatus === "rule-pack-candidate-context-required"
  ));
  assert.ok(inquiry.items.every((item) => !Object.hasOwn(item, "actual")));
  assert.ok(inquiry.items.every((item) => item.effectHypotheses.length > 0));
  assert.ok(inquiry.items.every((item) => item.verificationProbes.length > 0));
  assert.ok(!json.includes("Experts say"), "source phrases stay redacted by default");
  assert.ok(!json.includes("Private model output."), "rewrite never enters an inquiry");
  assert.ok(!Object.hasOwn(inquiry, "strip"));
  assert.ok(!Object.hasOwn(inquiry, "rewrite"));
  assert.deepEqual(toInquiry(result, { rules: reversedPack, sourceRef: "case:inquiry" }), inquiry);
  assert.equal(JSON.stringify(result), before, "projection does not mutate the result");
});

test("only literal includeActual true discloses cloned marked phrases", () => {
  const result = analyzed();
  const disclosed = toInquiry(result, { rules: RULES, includeActual: true });
  const notLiteralTrue = toInquiry(result, { rules: RULES, includeActual: "true" });

  assert.deepEqual(validate(disclosed, SCHEMA), []);
  assert.deepEqual(
    disclosed.items.map((item) => item.actual),
    result.marks.map((mark) => mark.actual)
  );
  assert.deepEqual(disclosed.sourceAccess, {
    source: "not-included",
    reference: "none",
    markedPhrases: "disclosed"
  });
  assert.ok(notLiteralTrue.items.every((item) => !Object.hasOwn(item, "actual")));
  assert.notEqual(disclosed.items[0].markRef.position, result.marks[0].position);
  assert.notEqual(disclosed.items[0].effectHypotheses, RULES.rules[0].effectHypotheses);
});

test("every seeded rule declares testable hypotheses and verification questions", () => {
  const hypothesisIds = new Set();
  const probeIds = new Set();
  for (const rule of RULES.rules) {
    assert.ok(rule.displayName?.trim(), `${rule.ruleId} needs a neutral display name`);
    assert.ok(
      ["aligned-candidate", "approximate-candidate", "rhetorlint-extension"].includes(
        rule.taxonomyMappingStatus
      ),
      `${rule.ruleId} needs an explicit taxonomy mapping status`
    );
    assert.ok(rule.effectHypotheses?.length, `${rule.ruleId} needs an effect hypothesis`);
    assert.ok(rule.verificationProbes?.length, `${rule.ruleId} needs a verification probe`);
    for (const hypothesis of rule.effectHypotheses) {
      assert.match(hypothesis.description, /\b(?:may|can|could)\b/i);
      assert.ok(hypothesis.conditions.length, `${hypothesis.id} needs applicability conditions`);
      assert.ok(hypothesis.alternatives.length, `${hypothesis.id} needs an alternative reading`);
      assert.ok(hypothesis.measures.length, `${hypothesis.id} needs an observable measure`);
      assert.ok(!hypothesisIds.has(hypothesis.id), `duplicate hypothesis id ${hypothesis.id}`);
      hypothesisIds.add(hypothesis.id);
    }
    for (const probe of rule.verificationProbes) {
      assert.ok(probe.question.endsWith("?"), `${probe.id} must be a question`);
      assert.ok(probe.evidenceNeeded.length, `${probe.id} needs external or contextual evidence`);
      assert.ok(!probeIds.has(probe.id), `duplicate verification probe id ${probe.id}`);
      probeIds.add(probe.id);
    }
  }
});

test("unresolved and duplicate rule ids fail instead of silently dropping inquiry context", () => {
  const result = analyzed();
  const missing = { ...RULES, rules: RULES.rules.filter((rule) => rule.ruleId !== result.marks[0].ruleId) };
  const duplicate = { ...RULES, rules: [...RULES.rules, RULES.rules[0]] };
  const metadataFree = structuredClone(RULES);
  const matchedRule = metadataFree.rules.find((rule) => rule.ruleId === result.marks[0].ruleId);
  delete matchedRule.effectHypotheses;
  delete matchedRule.verificationProbes;

  assert.throws(
    () => toInquiry(result, { rules: missing }),
    /cannot resolve mark ruleId/
  );
  assert.throws(
    () => toInquiry(result, { rules: duplicate }),
    /duplicate ruleId/
  );
  assert.throws(
    () => toInquiry(result, { rules: metadataFree }),
    /effectHypotheses.*non-empty array/
  );
});

test("rule-pack provenance must match the pack that produced the marks", () => {
  const result = analyzed();
  const differentVersion = { ...RULES, version: "9.9.9" };
  const differentFamily = structuredClone(RULES);
  const matchedRule = differentFamily.rules.find((rule) => rule.ruleId === result.marks[0].ruleId);
  matchedRule.family = "call";

  assert.throws(
    () => toInquiry(result, { rules: differentVersion }),
    /rules provenance mismatch/
  );
  assert.throws(
    () => toInquiry(result, { rules: differentFamily }),
    /family provenance mismatch/
  );
});

test("missing analysis provenance is disclosed instead of treated as a verified pack binding", () => {
  const result = analyzed();
  delete result.engine;
  const inquiry = toInquiry(result, { rules: RULES });
  assert.equal(inquiry.assurance.analysisPackBinding, "matched-family-only");
});

test("same-version metadata changes cannot retain the same inquiry fingerprint", () => {
  const result = analyzed();
  const changed = structuredClone(RULES);
  changed.rules[0].effectHypotheses[0].description =
    "May produce a different observable response under declared conditions.";

  const original = toInquiry(result, { rules: RULES });
  const modified = toInquiry(result, { rules: changed });
  assert.notEqual(modified.metadataFingerprint, original.metadataFingerprint);
});

test("third-party free text remains caller-supplied and semantically unverified", () => {
  const result = analyzed();
  const adversarial = structuredClone(RULES);
  const matched = adversarial.rules.find((rule) => rule.ruleId === result.marks[0].ruleId);
  matched.effectHypotheses[0].description = "The author intended to deceive.";
  matched.verificationProbes[0].question = "The claim is false.";

  const inquiry = toInquiry(result, { rules: adversarial });
  const item = inquiry.items.find((entry) => entry.markRef.ruleId === matched.ruleId);
  assert.equal(item.effectHypotheses[0].description, "The author intended to deceive.");
  assert.equal(item.verificationProbes[0].question, "The claim is false.");
  assert.equal(inquiry.assurance.boundary, "declared-not-semantically-verified");
  assert.deepEqual(validate(inquiry, SCHEMA), []);
});
