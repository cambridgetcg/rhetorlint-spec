import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";
import { toInquiry } from "../packages/core/inquiry.mjs";

const RULES = JSON.parse(
  readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url))
);

function inquiryFor(text) {
  const result = analyze(text, { rules: RULES });
  return { result, inquiry: toInquiry(result, { rules: RULES }) };
}

function itemFor(inquiry, ruleId) {
  return inquiry.items.find((item) => item.markRef.ruleId === ruleId);
}

test("a safety universal stays a surface match with a live benign reading", () => {
  const { result, inquiry } = inquiryFor("Never print credentials.");
  const mark = result.marks.find((item) => item.ruleId === "absolute.universal");
  const item = itemFor(inquiry, "absolute.universal");

  assert.ok(item, "the configured universal marker still fires");
  assert.ok(mark);
  assert.deepEqual({
    displayName: mark.displayName,
    family: mark.family,
    technique: mark.technique,
    classificationStatus: mark.classificationStatus,
    taxonomyMappingStatus: mark.taxonomyMappingStatus,
    level: mark.level
  }, {
    displayName: "absolute or certainty cue",
    family: "simplification",
    technique: "False Dilemma or No Choice",
    classificationStatus: "rule-pack-candidate-context-required",
    taxonomyMappingStatus: "approximate-candidate",
    level: "info"
  });
  assert.ok(item.effectHypotheses[0].conditions.some((text) => /safety requirement/i.test(text)));
  assert.ok(item.effectHypotheses[0].alternatives.some((text) => /precautionary requirement/i.test(text)));
});

test("epistemic modality remains intact and prompts evidence rather than certainty", () => {
  const text = "The server may have failed because the disk is full.";
  const { result, inquiry } = inquiryFor(text);
  const item = itemFor(inquiry, "hedge.deniable");
  const mark = result.marks.find((entry) => entry.ruleId === "hedge.deniable");

  assert.equal(result.strip, text, "the counterfactual must not delete epistemic modality");
  assert.ok(item);
  assert.equal(mark.displayName, "epistemic modal or attribution cue");
  assert.equal(mark.classificationStatus, "rule-pack-candidate-context-required");
  assert.equal(mark.taxonomyMappingStatus, "approximate-candidate");
  assert.equal(mark.level, "info");
  assert.match(item.verificationProbes[0].question, /what evidence.*uncertainty/i);
  assert.ok(item.effectHypotheses[0].alternatives.some((value) => /epistemically necessary/i.test(value)));
});

test("a scientific passive does not become an intent or accountability finding", () => {
  const { result, inquiry } = inquiryFor("The sample was heated to 80°C.");
  const mark = result.marks.find((item) => item.ruleId === "agency-hiding.deleted-subject");
  const item = itemFor(inquiry, "agency-hiding.deleted-subject");

  assert.ok(mark);
  assert.equal(mark.displayName, "passive with omitted semantic agent");
  assert.equal(mark.classificationStatus, "rule-pack-candidate-context-required");
  assert.equal(mark.taxonomyMappingStatus, "rhetorlint-extension");
  assert.equal(mark.level, "info");
  assert.match(mark.note, /passive construction with an omitted agent/);
  assert.doesNotMatch(mark.note, /intent|hid|conceal|accountability/i);
  assert.ok(item.effectHypotheses[0].alternatives.some((text) => /scientific/i.test(text)));
});

test("topic-shift and urgency cues keep context, emergency, and quotation alternatives live", () => {
  const question = inquiryFor("What about the second control group?").inquiry;
  const emergency = inquiryFor("ACT NOW: leave the burning building.").inquiry;
  const quoted = inquiryFor("The phrase 'act now' is an urgency example.").inquiry;

  assert.ok(itemFor(question, "deflection.whataboutism").effectHypotheses[0].conditions.some(
    (text) => /prior question/i.test(text)
  ));
  assert.ok(itemFor(emergency, "urgency.appeal-to-time").effectHypotheses[0].alternatives.some(
    (text) => /genuine emergency/i.test(text)
  ));
  assert.ok(itemFor(quoted, "urgency.appeal-to-time").effectHypotheses[0].alternatives.some(
    (text) => /quoted|mentioned/i.test(text)
  ));
});

test("zero configured markers carry no positive truth or safety verdict", () => {
  const { result, inquiry } = inquiryFor("Your funds will double tomorrow.");

  assert.deepEqual(result.marks, []);
  assert.deepEqual(inquiry.items, []);
  assert.equal(inquiry.boundary.truth, "questions-not-verdicts");
});
