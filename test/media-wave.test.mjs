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

// --- sourcing.anonymous ---
test("sourcing.anonymous marks descriptor formulas", () => {
  assert.deepEqual(spansOf("People familiar with the matter said the deal is dead.", "sourcing.anonymous"), ["People familiar with the matter"]);
  assert.deepEqual(spansOf("A source close to the campaign confirmed it.", "sourcing.anonymous"), ["A source close to"]);
  assert.deepEqual(spansOf("Sources with direct knowledge of the matter disagreed.", "sourcing.anonymous"), ["Sources with direct knowledge of the matter"]);
});
test("sourcing.anonymous leaves disclosure and literal uses alone", () => {
  for (const t of [
    "Two officials spoke on condition of anonymity.",     // disclosure branch cut — transparency, not vagueness
    "The victim asked not to be identified.",
    "The lottery winner declined to be named.",
    "Light sources close to the subject cause flare.",
  ]) assert.equal(idsFor(t).includes("sourcing.anonymous"), false, t);
});

// --- combat.attack-verb ---
test("combat.attack-verb marks the combat verb", () => {
  assert.deepEqual(spansOf("The senator ripped into the ruling on Tuesday.", "combat.attack-verb"), ["ripped into"]);
  assert.deepEqual(spansOf("She lashed out at critics of the plan.", "combat.attack-verb"), ["lashed out at"]);
  assert.deepEqual(spansOf("The ad sparked outrage online.", "combat.attack-verb"), ["sparked outrage"]);
  assert.deepEqual(spansOf("He clapped back at the host.", "combat.attack-verb"), ["clapped back at"]);
});
test("combat.attack-verb survives the literal battlefield", () => {
  for (const t of [
    "The platoon was under fire for six hours.",   // branch cut
    "The kids tore into their presents.",          // tear-family cut
    "She broke her silence on the allegations.",   // cut — plainest report of the event
    "The mayor faces a backlash over the budget.", // cut
    "The surgeon eviscerated the specimen.",       // cut
    "He slammed the car boot twice.",              // slams deliberately unseeded
  ]) assert.equal(idsFor(t).includes("combat.attack-verb"), false, t);
});

// --- exoneration.formula ---
test("exoneration.formula marks the deed-noun frame", () => {
  assert.deepEqual(spansOf("An officer-involved shooting occurred at dawn.", "exoneration.formula"), ["officer-involved shooting"]);
  assert.deepEqual(spansOf("An altercation ensued outside the bar.", "exoneration.formula"), ["altercation ensued"]);
  assert.deepEqual(spansOf("Shots rang out near the plaza.", "exoneration.formula"), ["Shots rang out"]);
});
test("exoneration.formula refuses death-frames and adjacent literals", () => {
  for (const t of [
    "He died in police custody awaiting trial.",     // intransitive death-frame cut
    "A power struggle ensued after the chairman resigned.",
    "The fatal encounter ended the expedition.",
    "The officer involved in the case testified.",
    "The department revised its use-of-force policy.",
  ]) assert.equal(idsFor(t).includes("exoneration.formula"), false, t);
});

// --- insinuation.raises-questions ---
test("insinuation.raises-questions needs the loaded adjective or the questions-as-agent frame", () => {
  assert.deepEqual(spansOf("The filing raises serious questions about the timeline.", "insinuation.raises-questions"), ["raises serious questions about"]);
  assert.deepEqual(spansOf("Questions linger over the auditor's independence.", "insinuation.raises-questions"), ["Questions linger over"]);
  assert.deepEqual(spansOf("Questions swirled around the campaign.", "insinuation.raises-questions"), ["Questions swirled around"]);
});
test("insinuation.raises-questions leaves honest signposting alone", () => {
  for (const t of [
    "This raises questions about the generalizability of our findings.", // no loaded adjective
    "It raises new questions about how the law applies.",                // fresh/new cut
    "Questions remain about the cause of the crash.",                    // remain cut — honest open state
    "Residents raised concerns about the noise.",                        // 'concerns' deliberately unseeded
  ]) assert.equal(idsFor(t).includes("insinuation.raises-questions"), false, t);
});
