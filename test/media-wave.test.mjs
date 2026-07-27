import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";

const rules = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));
const marksFor = (text) => analyze(text, { rules }).marks;
const idsFor = (text) => marksFor(text).map((m) => m.ruleId);
const spansOf = (text, ruleId) => marksFor(text).filter((m) => m.ruleId === ruleId).map((m) => m.actual);

// --- euphemism.institutional ---
test("euphemism.institutional marks the administrative phrase", () => {
  assert.deepEqual(spansOf("The strike caused collateral damage in two villages.", "euphemism.institutional"), ["collateral damage"]);
  assert.deepEqual(spansOf("He defended enhanced interrogation techniques.", "euphemism.institutional"), ["enhanced interrogation"]);
  assert.deepEqual(spansOf("The company announced workforce reductions.", "euphemism.institutional"), ["workforce reductions"]);
});
test("euphemism.institutional stays silent on the cut terms and plain prose", () => {
  for (const t of [
    "The court examined the extraordinary rendition programme.", // accountability term — deliberately unseeded
    "Historians describe the pacification campaign of 1968.",
    "The report documented the black sites.",
    "Aggregate negative patient outcomes fell by 4%.",
    "The airline reduced its workforce by 3,000.",
  ]) assert.equal(idsFor(t).includes("euphemism.institutional"), false, t);
});

// --- editorializing.stance ---
test("editorializing.stance marks the stance marker", () => {
  assert.deepEqual(spansOf("It should be noted that revenue fell.", "editorializing.stance"), ["It should be noted"]);
  assert.deepEqual(spansOf("Tellingly, he skipped the hearing.", "editorializing.stance"), ["Tellingly"]);
  assert.deepEqual(spansOf("Make no mistake, this changes everything.", "editorializing.stance"), ["Make no mistake"]);
});
test("editorializing.stance does not mark manner adverbs or plain reporting", () => {
  for (const t of [
    "She gazed curiously at the door.",         // 'curiously' cut from the wave
    "He noted the time in the log.",
    "The move surprised no one at the plant.",
  ]) assert.equal(idsFor(t).includes("editorializing.stance"), false, t);
});

// --- puffery.peacock ---
test("puffery.peacock marks the epithet", () => {
  assert.deepEqual(spansOf("A world-class team of visionary engineers.", "puffery.peacock"), ["world-class", "visionary"]);
  assert.deepEqual(spansOf("The award-winning, critically acclaimed series returns.", "puffery.peacock"), ["award-winning", "critically acclaimed"]);
});
test("puffery.peacock survives literal and boundary traps", () => {
  for (const t of [
    "The defamed executive sued the paper.",       // \b guards 'famed'
    "Iconicity is a linguistics term.",             // \b guards 'iconic'
    "The method advances the state of the art.",    // unhyphenated literal
    "Legendary heroes fill the saga.",              // 'legendary' cut from the wave
  ]) assert.equal(idsFor(t).includes("puffery.peacock"), false, t);
});
