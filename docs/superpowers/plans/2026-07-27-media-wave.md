# Media Wave (rules-en 0.2.0 + People Door) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the verified media tell-pack (11 new rules + weasel.attribution growth) as an atomic `@rhetorlint/rules-en` 0.2.0 release across all three engines, and open the People Door (GitHub Pages serving the explorer + bookmarklet).

**Architecture:** Pure data wave — every rule is lexical or pattern, `@rhetorlint/core` stays at 0.1.2 untouched. One feature branch; rules land family-group by family-group with their own tests; taxonomy/conformance/surfaces sync in the same wave; single PR; tag-triggered OIDC release.

**Tech Stack:** zero-dep Node (node --test), Python stdlib engine, Go stdlib engine, GitHub Actions (Pages + npm Trusted Publishing).

**Spec:** `docs/superpowers/specs/2026-07-27-media-tell-pack-design.md` — patterns/terms there are FINAL; copy them verbatim.

## Global Constraints

- Repo: `/Users/yuai/Projects/kingdom-new/rhetorlint-spec`, branch `feat/media-wave-0.2.0` off `main`.
- Every pattern must compile under Go RE2 (`regexp.MustCompile("(?i)"+pattern)`) — NO lookahead/lookbehind/backreferences. All wave patterns were already RE2-verified in review; do not "improve" them.
- No new rule sets `caseSensitive` or `minEngine`; confidence ≤ 0.7; level ∈ {info, note}.
- `impl/python/rules_en.json` must stay byte-identical to `packages/rules-en/rules.json` (copy after every pack edit).
- SemEval technique strings verbatim: `"Obfuscation, Intentional Vagueness, Confusion"`, `"Loaded Language"`, `"Exaggeration or Minimisation"`, `"Doubt"`, `"Appeal to Time"`.
- All terms/patterns pure ASCII.
- Gate for every task: `npm test` fully green (46+ tests), and for pack-touching tasks also `python3 impl/python/test_conformance.py` and `(cd impl/go && go test ./...)`.
- Commit messages follow repo voice (lowercase type prefix, meaningful sentence), each ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Branch + pack-bands lint test

**Files:**
- Create: `test/pack-bands.test.mjs`

**Interfaces:**
- Produces: `MEDIA_WAVE_RULE_IDS` (exported const array) that Tasks 2–5 grow against; the lint every later pack edit must satisfy.

- [ ] **Step 1: Branch**

```bash
cd /Users/yuai/Projects/kingdom-new/rhetorlint-spec && git checkout -b feat/media-wave-0.2.0
```

- [ ] **Step 2: Write the lint test**

Create `test/pack-bands.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pack = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));

// The 2026-07 media wave. Every id here must exist once the wave lands
// (Tasks 2-5); until then the per-rule assertions are simply vacuous.
export const MEDIA_WAVE_RULE_IDS = [
  "sourcing.anonymous", "combat.attack-verb", "euphemism.institutional",
  "exoneration.formula", "insinuation.raises-questions", "implicative.shortfall",
  "editorializing.stance", "attribution.factive", "puffery.peacock",
  "attribution.doubt-verb", "distancing.doubt-marker",
];

test("every rule stays inside the pack's honesty bands", () => {
  for (const r of pack.rules) {
    assert.ok(r.confidence >= 0.5 && r.confidence <= 0.7,
      `${r.ruleId}: confidence ${r.confidence} outside [0.5, 0.7] — near-certainty is a lie this pack refuses`);
    assert.ok(["info", "note", "warning"].includes(r.level), `${r.ruleId}: bad level`);
  }
});

test("media-wave rules carry no warning level and no engine-floor fields", () => {
  for (const id of MEDIA_WAVE_RULE_IDS) {
    const r = pack.rules.find((x) => x.ruleId === id);
    if (!r) continue; // not landed yet
    assert.ok(["info", "note"].includes(r.level), `${id}: media wave ships info/note only`);
    assert.equal(r.caseSensitive, undefined, `${id}: must not depend on the caseSensitive floor`);
    assert.equal(r.minEngine, undefined, `${id}: must not need an engine floor`);
  }
});

test("once the wave lands, it lands whole", () => {
  const present = MEDIA_WAVE_RULE_IDS.filter((id) => pack.rules.some((r) => r.ruleId === id));
  assert.ok(present.length === 0 || present.length === MEDIA_WAVE_RULE_IDS.length,
    `partial wave: only [${present.join(", ")}] present — the release is atomic`);
});
```

- [ ] **Step 3: Run**: `npm test` → all green (new tests pass vacuously/for current pack).
- [ ] **Step 4: Commit**: `git add test/pack-bands.test.mjs && git commit -m "test: honesty bands for the pack and the incoming media wave"`

---

### Task 2: Lexical trio — euphemism.institutional, editorializing.stance, puffery.peacock

**Files:**
- Create: `test/media-wave.test.mjs`
- Modify: `packages/rules-en/rules.json` (append to `rules`, bump nothing yet)
- Copy: `impl/python/rules_en.json`

**Interfaces:**
- Produces: `test/media-wave.test.mjs` with helper `marksFor(text)` returning `analyze(text, {rules}).marks`; Tasks 3–5 append their test blocks to this file.

- [ ] **Step 1: Write failing tests**

Create `test/media-wave.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify failure**: `node --test test/media-wave.test.mjs` → FAIL (rules absent).
- [ ] **Step 3: Append the three rules** to the END of the `rules` array in `packages/rules-en/rules.json` (after `agency-hiding.deleted-subject`), exactly:

```json
{
  "ruleId": "euphemism.institutional",
  "family": "manipulative-wording",
  "technique": "Exaggeration or Minimisation",
  "type": "lexical",
  "level": "note",
  "confidence": 0.6,
  "note": "an institutional euphemism — a fixed administrative phrase standing where the plain event would be",
  "terms": ["collateral damage", "enhanced interrogation", "surgical strike", "surgical strikes", "workforce reduction", "workforce reductions"],
  "expected": ["(name the plain event in plain words: what happened, to whom)"]
},
{
  "ruleId": "editorializing.stance",
  "family": "manipulative-wording",
  "technique": "Loaded Language",
  "type": "lexical",
  "level": "info",
  "confidence": 0.6,
  "note": "an editorializing stance marker — instructs the reader how to judge the fact before the fact arrives",
  "terms": ["it should be noted", "it is worth noting", "it's worth noting", "it is important to note", "it's important to note", "needless to say", "tellingly", "unsurprisingly", "in a stunning move", "in a bizarre twist", "in a shocking turn", "make no mistake"],
  "expected": ["(delete the stance word; state the fact and let the reader weigh it)"]
},
{
  "ruleId": "puffery.peacock",
  "family": "manipulative-wording",
  "technique": "Exaggeration or Minimisation",
  "type": "lexical",
  "level": "info",
  "confidence": 0.5,
  "note": "a puffery epithet — the praise sits in the adjective, not in a checkable fact",
  "terms": ["world-class", "critically acclaimed", "award-winning", "renowned", "famed", "storied", "visionary", "cutting-edge", "game-changing", "state-of-the-art", "best-in-class", "iconic"],
  "expected": ["(swap the epithet for the checkable specific: which award, acclaimed by whom, measured against what)"]
}
```

- [ ] **Step 4: Mirror + full gate**

```bash
cp packages/rules-en/rules.json impl/python/rules_en.json
node --test test/media-wave.test.mjs   # PASS
npm test                               # note: pack-bands "lands whole" test now FAILS by design — acceptable ONLY on this branch mid-wave; if anything else fails, stop and fix
```

(The atomicity test in Task 1 will fail from here until Task 5 completes. That is the test doing its job — do NOT weaken it; just don't merge mid-wave.)

- [ ] **Step 5: Commit**: `git add -A && git commit -m "rules-en: euphemism, editorializing stance, puffery — the lexical media trio"`

---

### Task 3: Pattern quartet — sourcing.anonymous, combat.attack-verb, exoneration.formula, insinuation.raises-questions

**Files:**
- Modify: `test/media-wave.test.mjs` (append), `packages/rules-en/rules.json` (append), copy python mirror.

- [ ] **Step 1: Append failing tests** to `test/media-wave.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify failure**: `node --test test/media-wave.test.mjs` → the new blocks FAIL.
- [ ] **Step 3: Append the four rules** (same append point, exact JSON):

```json
{
  "ruleId": "sourcing.anonymous",
  "family": "manipulative-wording",
  "technique": "Obfuscation, Intentional Vagueness, Confusion",
  "type": "pattern",
  "level": "info",
  "confidence": 0.6,
  "note": "an anonymous-source descriptor — the fact rides on someone the reader cannot identify, count, or check",
  "pattern": "\\b(?:person|people|those|officials?|sources?)\\s+familiar\\s+with\\s+the\\s+(?:matter|situation)\\b|\\bsources?\\s+with\\s+(?:direct\\s+|first[- ]?hand\\s+)?knowledge\\s+of\\s+the\\s+matter\\b|\\ba\\s+source\\s+close\\s+to\\b|\\bsources\\s+close\\s+to\\s+the\\s+(?:matter|situation|talks|negotiations?|deal|campaign|investigation)\\b",
  "expected": ["(name the source — or state plainly why the reader is being asked to trust someone they cannot see)"]
},
{
  "ruleId": "combat.attack-verb",
  "family": "manipulative-wording",
  "technique": "Loaded Language",
  "type": "pattern",
  "level": "info",
  "confidence": 0.55,
  "note": "combat framing — wording that stages a disagreement as an attack scene; the violence lives in the verb, not in any reported act",
  "pattern": "\\b(?:rip|rips|ripped|ripping)\\s+into\\b|\\b(?:lash|lashes|lashed|lashing)\\s+out\\s+at\\b|\\b(?:hit|hits|hitting)\\s+(?:out|back)\\s+at\\b|\\b(?:fire|fires|fired|firing)\\s+back\\s+at\\b|\\b(?:clap|claps|clapped|clapping)\\s+back\\s+at\\b|\\b(?:spark|sparks|sparked|sparking)\\s+(?:outrage|fury|backlash)\\b",
  "expected": ["(report the speech act: said, criticized, responded — and quote what was actually said)"]
},
{
  "ruleId": "exoneration.formula",
  "family": "manipulative-wording",
  "technique": "Obfuscation, Intentional Vagueness, Confusion",
  "type": "pattern",
  "level": "note",
  "confidence": 0.7,
  "note": "an exonerative formula — the deed is in the sentence but the doer is not ('an officer-involved shooting' names no one who shot)",
  "pattern": "\\b(?:officer|police|deputy|trooper)[- ]involved\\s+(?:shooting|incident)s?\\b|\\b(?:altercation|scuffle)s?\\s+ensued\\b|\\bscuffles?\\s+broke\\s+out\\b|\\bshots?\\s+rang\\s+out\\b|\\buse[- ]of[- ]force\\s+incidents?\\b",
  "expected": ["(name the actor and the act: 'an officer shot him', not 'an officer-involved shooting')"]
},
{
  "ruleId": "insinuation.raises-questions",
  "family": "manipulative-wording",
  "technique": "Obfuscation, Intentional Vagueness, Confusion",
  "type": "pattern",
  "level": "note",
  "confidence": 0.6,
  "note": "a question-frame — the words assert that questions or doubts exist while the asker and the question itself are deleted",
  "pattern": "\\brais(?:es|ed|ing|e)\\s+(?:serious|troubling|disturbing|grave)\\s+(?:questions?|doubts?)\\s+(?:about|over)\\b|\\bquestions\\s+(?:linger(?:s|ed|ing)?|swirl(?:s|ed|ing)?)\\s+(?:about|over|around)\\b",
  "expected": ["(state the actual question and who is asking it, or make the claim outright)"]
}
```

- [ ] **Step 4: Mirror + gate**: `cp packages/rules-en/rules.json impl/python/rules_en.json && node --test test/media-wave.test.mjs` → PASS. Then `npm test` (only the atomicity test may fail).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "rules-en: sourcing fog, combat framing, exoneration formulas, insinuation frames"`

---

### Task 4: Attribution seam — attribution.factive, implicative.shortfall, weasel.attribution growth

**Files:**
- Modify: `test/media-wave.test.mjs`, `packages/rules-en/rules.json` (two appends + ONE in-place edit of `weasel.attribution.pattern`), python mirror.

- [ ] **Step 1: Append failing tests**:

```js
// --- attribution.factive ---
test("attribution.factive marks the endorsement verb", () => {
  assert.deepEqual(spansOf("The memo revealed that the audit was shelved.", "attribution.factive"), ["revealed that"]);
  assert.deepEqual(spansOf("She pointed out that the data was stale.", "attribution.factive"), ["pointed out that"]);
  assert.deepEqual(spansOf("The paper debunked the claim.", "attribution.factive"), ["debunked"]);
});
test("attribution.factive refuses first-person confession and plot registers", () => {
  for (const t of [
    "The novel's final chapter reveals that the letters were forged.", // present-tense branch cut (measured FP)
    "I want to set the record straight about what happened.",           // branch cut
    "The pandemic laid bare the inequalities in the system.",           // branch cut
    "Both sides made clear that they wanted a deal.",                   // branch cut
  ]) assert.equal(idsFor(t).includes("attribution.factive"), false, t);
});

// --- implicative.shortfall ---
test("implicative.shortfall marks the unmet-duty verb", () => {
  assert.deepEqual(spansOf("The minister failed to mention the audit.", "implicative.shortfall"), ["failed to mention"]);
  assert.deepEqual(spansOf("The agency refused to confirm the number.", "implicative.shortfall"), ["refused to confirm"]);
  assert.deepEqual(spansOf("They didn't even bother to call.", "implicative.shortfall"), ["didn't even bother to"]);
});
test("implicative.shortfall never marks honest contrition", () => {
  for (const t of [
    "We failed to respond to your ticket, and we are sorry.",   // respond cut from the fail-branch
    "We failed to disclose the breach for three weeks.",        // disclose cut
    "He did not comment on the case.",                          // the neutral form
    "She declined to comment.",
  ]) assert.equal(idsFor(t).includes("implicative.shortfall"), false, t);
});

// --- weasel.attribution growth ---
test("weasel.attribution now hears the wider newsroom chorus", () => {
  assert.deepEqual(spansOf("Observers warn the truce is fragile.", "weasel.attribution"), ["Observers warn"]);
  assert.deepEqual(spansOf("Economists predict a shallow recession.", "weasel.attribution"), ["Economists predict"]);
  assert.deepEqual(spansOf("It is often said that markets hate surprises.", "weasel.attribution"), ["It is often said"]);
  assert.deepEqual(spansOf("He is widely regarded as the favourite.", "weasel.attribution"), ["is widely regarded as"]);
  assert.deepEqual(spansOf("The plan has been widely described as a gamble.", "weasel.attribution"), ["has been widely described as"]);
});
test("weasel.attribution's described-as branch requires the crowd quantifier", () => {
  for (const t of [
    "The startup has been described as 'the next Stripe' by Forbes.",  // named describer — guard holds
    "Economists Reinhart and Rogoff argue the opposite.",              // named authorities — no adjacency match
  ]) assert.equal(idsFor(t).includes("weasel.attribution"), false, t);
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3a: Append two rules**:

```json
{
  "ruleId": "attribution.factive",
  "family": "manipulative-wording",
  "technique": "Obfuscation, Intentional Vagueness, Confusion",
  "type": "pattern",
  "level": "info",
  "confidence": 0.5,
  "note": "a factive attribution — a said-substitute whose verb presupposes the attributed claim is true, endorsing it inside what reads as neutral reporting",
  "pattern": "\\brevealed\\s+that\\b|\\bpoint(?:s|ed)\\s+out\\s+that\\b|\\bdebunk(?:s|ed)\\b|\\brefut(?:es|ed)\\b",
  "expected": ["(attribute neutrally — 'said', 'stated', 'disputed' — or assert the fact in your own voice with the evidence that earns it)"]
},
{
  "ruleId": "implicative.shortfall",
  "family": "manipulative-wording",
  "technique": "Loaded Language",
  "type": "pattern",
  "level": "info",
  "confidence": 0.55,
  "note": "an implicative shortfall — the verb presupposes a duty went unmet ('failed to comment' implies commenting was owed; the neutral report is 'did not comment')",
  "pattern": "\\b(?:fail|neglect)(?:s|ed)\\s+to\\s+(?:comment|mention)\\b|\\brefus(?:es|ed)\\s+to\\s+(?:say|comment|answer|confirm)\\b|\\b(?:did|does)(?:\\s+not|n'?t)\\s+(?:even\\s+)?bother\\s+to\\b",
  "expected": ["(report the event without the verdict: 'did not comment', 'declined to say')"]
}
```

- [ ] **Step 3b: Replace `weasel.attribution`'s `pattern` in place** (rule stays where it is; level/confidence/note unchanged) with:

```
\\b(?:experts?|scientists?|studies|research|sources?|critics?|analysts?|observers?|commentators?|economists?|historians?|scholars?|pundits?|reports|many(?:\\s+people)?|some(?:\\s+people)?)\\s+(?:say|says|said|agree|agrees|show|shows|claim|claims|believe|believes|argue|argues|suggest|suggests|warn|warns|warned|fear|feared|note|noted|predict|predicts|predicted|caution|cautioned)\\b|\\bit\\s+is\\s+(?:widely\\s+)?(?:believed|thought|understood|known)\\b|\\bit\\s+is\\s+often\\s+(?:said|reported)\\b|\\b(?:is|are|was|were)\\s+widely\\s+(?:regarded|described|seen|considered)\\s+as\\b|\\b(?:has|have)\\s+been\\s+(?:widely|often|repeatedly|variously)\\s+described\\s+as\\b
```

- [ ] **Step 4: Mirror + gate + existing-cases check**: `cp packages/rules-en/rules.json impl/python/rules_en.json && npm test`. CRITICAL: the 15 committed conformance cases must still pass UNCHANGED (review verified no wave rule fires on them; if a case breaks here, STOP — that is a design violation, not a test to update).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "rules-en: factive attribution, implicative shortfall, and a wider weasel chorus"`

---

### Task 5: First seeds of attack-on-reputation — attribution.doubt-verb, distancing.doubt-marker

**Files:**
- Modify: `test/media-wave.test.mjs`, `packages/rules-en/rules.json`, python mirror.

- [ ] **Step 1: Append failing tests**:

```js
// --- attribution.doubt-verb (first seed of attack-on-reputation) ---
test("attribution.doubt-verb marks claimed/insisted that", () => {
  assert.deepEqual(spansOf("The minister claimed that the figures were audited.", "attribution.doubt-verb"), ["claimed that"]);
  assert.deepEqual(spansOf("He insisted that nothing was wrong.", "attribution.doubt-verb"), ["insisted that"]);
  assert.deepEqual(spansOf("They claim that the tests passed.", "attribution.doubt-verb"), ["They claim that"]);
});
test("attribution.doubt-verb refuses factives, praise idioms, and term-of-art senses", () => {
  for (const t of [
    "He conceded that his rival had a point.",           // factive — cut
    "The hotel boasts that every room has a sea view.",  // praise idiom — cut (narrower verdict shipped)
    "The patent claims a hinge mechanism.",              // noun/term-of-art
    "The policy insists that guests wear masks.",        // demand sense — present tense is pronoun-guarded
    "Claims that are filed late are void.",
  ]) assert.equal(idsFor(t).includes("attribution.doubt-verb"), false, t);
});
test("the tense seam is pinned: present collective goes to weasel, past to doubt-verb", () => {
  assert.deepEqual(idsFor("Sources claim that the deal is dead.").sort(), ["weasel.attribution"]);
  assert.deepEqual(idsFor("Sources claimed that the deal is dead.").sort(), ["attribution.doubt-verb"]);
});

// --- distancing.doubt-marker (second seed) ---
test("distancing.doubt-marker marks the writer's distancing word", () => {
  assert.deepEqual(spansOf("We won't be lectured by these so-called experts.", "distancing.doubt-marker"), ["so-called"]);
  assert.deepEqual(spansOf("The self-styled prophet drew a crowd.", "distancing.doubt-marker"), ["self-styled"]);
  assert.deepEqual(spansOf("A quote unquote independent review.", "distancing.doubt-marker"), ["quote unquote"]);
});
test("distancing.doubt-marker leaves neutral promotion reporting alone", () => {
  for (const t of [
    "The drug was touted as a breakthrough.",   // 'touted as' cut — weasel-shaped, neutral in journalism
    "A highly touted prospect joined the club.",
    "Would-be buyers lined up outside.",        // 'would-be' never seeded
  ]) assert.equal(idsFor(t).includes("distancing.doubt-marker"), false, t);
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Append the two rules**:

```json
{
  "ruleId": "attribution.doubt-verb",
  "family": "attack-on-reputation",
  "technique": "Doubt",
  "type": "pattern",
  "level": "note",
  "confidence": 0.6,
  "note": "a doubt-casting attribution verb — 'said' reports the speech; 'claimed that' / 'insisted that' ship a verdict on the speaker inside the report",
  "pattern": "\\b(?:claim(?:ed|ing)|insist(?:ed|ing))\\s+that\\b|\\b(?:he|she|it|they)\\s+(?:claims?|insists?)\\s+that\\b",
  "expected": ["(swap in 'said' — report the words and let the reader judge them)"]
},
{
  "ruleId": "distancing.doubt-marker",
  "family": "attack-on-reputation",
  "technique": "Doubt",
  "type": "lexical",
  "level": "info",
  "confidence": 0.55,
  "note": "a doubt marker — the writer's own distancing word delivers a verdict on a title or label; the word itself contains no argument for the dispute (technical 'so-called' = 'known as' is the known false positive; 'allegedly/purportedly' belong to hedge.deniable)",
  "terms": ["so-called", "self-styled", "self-proclaimed", "self-appointed", "self-anointed", "styles himself as", "styles herself as", "styles itself as", "styles themselves as", "quote-unquote", "quote unquote"],
  "expected": ["(argue the dispute: say who holds the title, who contests it, and why — or accept the label)"]
}
```

- [ ] **Step 4: Bump the pack + mirror + FULL gate** — edit `packages/rules-en/rules.json` top-level `"version": "0.1.2"` → `"0.2.0"`, then:

```bash
cp packages/rules-en/rules.json impl/python/rules_en.json
npm test                                   # ALL green now, including the atomicity test
python3 impl/python/test_conformance.py    # 15/15
(cd impl/go && go test ./...)              # ok — also proves every new pattern compiles under RE2
```

- [ ] **Step 5: Commit**: `git add -A && git commit -m "rules-en 0.2.0: seed attack-on-reputation — the doubt verbs and doubt markers, carefully scoped"`

---

### Task 6: Taxonomy integration — lessons, counts, the rewritten refusal

**Files:**
- Modify: `spec/taxonomy.yaml`

One pass owns every count and every lesson. Follow the file's existing style exactly (id / semeval_technique / what / why_it_works / examples / lineage).

- [ ] **Step 1: Update family headers**
  - `manipulative-wording`: `seeded_tells: 7` → `seeded_tells: 16`.
  - `attack-on-reputation`: delete `status: "(no seed rule yet)"`, add `seeded_tells: 2`, and replace `why_not_seeded` with:

```yaml
    why_seeding_is_narrow: >
      Reputation attacks usually need a target and context to be read correctly
      ('is this a slur or a description?') — that is intent-modelling the
      words-only core refuses, so bare loaded labels ('regime', 'militants')
      stay unmarked forever. The two seeded tells clear a narrower bar the
      family text always promised to wait for: the mark lands on the WRITER'S
      OWN visible operator word (a distancing marker, a doubt-casting verb),
      and the pattern guarantees a target is grammatically present. The reader
      can re-read the operator; nothing about the target is inferred.
```

- [ ] **Step 2: Add the eleven lessons.** Nine under `manipulative-wording` tells, two under `attack-on-reputation` (new `tells:` key there). Each lesson verbatim:

```yaml
      - id: sourcing.anonymous
        semeval_technique: "Obfuscation, Intentional Vagueness, Confusion"
        what: "An anonymous-source descriptor — 'people familiar with the matter', 'a source close to' — the fact rides on someone the reader cannot identify, count, or check."
        why_it_works: "Borrowed testimony without a witness: the formula sounds like sourcing discipline while removing every handle a reader could use to weigh the source."
        examples:
          - marked: "People familiar with the matter said the deal was dead."
            tell: "People familiar with the matter"
            plain: "Two executives who attended the board meeting said the deal was dead."
          - marked: "A source close to the campaign confirmed the shake-up."
            tell: "A source close to"
            plain: "The campaign's deputy manager confirmed the shake-up."
        lineage: "SemEval-2023 · Manipulative Wording › Obfuscation, Intentional Vagueness, Confusion (disclosure phrases like 'on condition of anonymity' are deliberately NOT marked — they are the transparency, not the vagueness)"

      - id: combat.attack-verb
        semeval_technique: "Loaded Language"
        what: "Combat framing — 'rips into', 'lashes out at', 'sparks outrage' — wording that stages a disagreement as an attack scene; the violence lives in the verb, not in any reported act."
        why_it_works: "The fight arrives before the content does: the reader's conflict response fires on the staging, and whatever was actually said is received as a blow rather than a statement."
        examples:
          - marked: "The senator ripped into the ruling."
            tell: "ripped into"
            plain: "The senator said the ruling misread the statute, citing two precedents."
          - marked: "The ad sparked outrage online."
            tell: "sparked outrage"
            plain: "Within a day, 14,000 posts criticised the ad; the network pulled it."
        lineage: "SemEval-2023 · Manipulative Wording › Loaded Language (bare 'slams' and 'blasts' — headline journalism's favourites — are deliberately NOT seeded: their literal senses cannot be screened from the words alone)"

      - id: euphemism.institutional
        semeval_technique: "Exaggeration or Minimisation"
        what: "An institutional euphemism — 'collateral damage', 'enhanced interrogation', 'workforce reduction' — a fixed administrative phrase standing where the plain event would be."
        why_it_works: "The phrase cools the event before the reader can feel it: administrative vocabulary files a harm under procedure, and the reaction that plain words would earn never arrives."
        examples:
          - marked: "The strike caused collateral damage in two villages."
            tell: "collateral damage"
            plain: "The strike killed nine civilians in two villages."
          - marked: "The company announced a workforce reduction."
            tell: "workforce reduction"
            plain: "The company dismissed 1,200 employees."
        lineage: "SemEval-2023 · Manipulative Wording › Exaggeration or Minimisation (deliberately NOT seeded: 'extraordinary rendition' and 'pacification campaign' — the standard accountability and historiographic referring terms; 'black site(s)' — exposé vocabulary that dramatizes rather than cools; 'kinetic military action' — survives mostly as ironic mention; 'negative patient outcome' — dominant register is outcomes research)"

      - id: exoneration.formula
        semeval_technique: "Obfuscation, Intentional Vagueness, Confusion"
        what: "An exonerative formula — 'an officer-involved shooting', 'an altercation ensued', 'shots rang out' — the deed is in the sentence but the doer is not, without a single passive verb for the structural detector to catch."
        why_it_works: "The deed-noun's grammar requires a doer the words never supply, so the harm reads like weather: something that occurred rather than something someone did."
        examples:
          - marked: "An officer-involved shooting occurred at dawn."
            tell: "officer-involved shooting"
            plain: "An officer shot a 24-year-old man at dawn."
          - marked: "An altercation ensued and a bystander was hurt."
            tell: "altercation ensued"
            plain: "The guard shoved the vendor, and a bystander was knocked down."
        lineage: "SemEval-2023 · Manipulative Wording › Obfuscation, Intentional Vagueness, Confusion (RhetorLint-authored pattern under a SemEval technique — the contrition.rehearsed precedent; structural kin: agency-hiding.deleted-subject. Seedable only where a deed-noun demands a doer; 'died in police custody' is deliberately NOT marked — intransitive 'died' states a death, not a deed, and marking it would presume an act the sentence never states)"

      - id: insinuation.raises-questions
        semeval_technique: "Obfuscation, Intentional Vagueness, Confusion"
        what: "A question-frame — 'raises serious questions about', 'questions swirl around' — the words assert that questions or doubts exist while the asker and the question itself are deleted."
        why_it_works: "An accusation with no accuser and no claim: nothing specific is stated, so nothing specific can be answered, while the shadow of the unstated question does the arguing."
        examples:
          - marked: "The filing raises serious questions about the timeline."
            tell: "raises serious questions about"
            plain: "The filing shows the contract was signed two weeks before the vote; the auditor asks whether the board knew."
          - marked: "Questions swirled around the campaign's finances."
            tell: "Questions swirled around"
            plain: "Three donors asked the campaign to explain a $2m transfer; it has not yet done so."
        lineage: "SemEval-2023 · Manipulative Wording › Obfuscation, Intentional Vagueness, Confusion (the loaded adjective is mandatory — bare or 'new' question-raising is neutral temporal reporting, and 'questions remain' is honest open-state reporting; both deliberately unmarked)"

      - id: implicative.shortfall
        semeval_technique: "Loaded Language"
        what: "An implicative shortfall — 'failed to comment', 'refused to confirm', 'didn't even bother to' — the verb presupposes a duty went unmet; the neutral report is 'did not comment'."
        why_it_works: "The verdict rides inside the verb: 'failed' smuggles in the premise that commenting was owed, so the subject arrives pre-judged before any fact is weighed. The mark is subject-blind — it fires on 'I failed to mention the move' too, where the presupposition is the same."
        examples:
          - marked: "The minister failed to mention the audit."
            tell: "failed to mention"
            plain: "The minister did not mention the audit."
          - marked: "The agency refused to confirm the number."
            tell: "refused to confirm"
            plain: "The agency declined to confirm the number."
        lineage: "SemEval-2023 · Manipulative Wording › Loaded Language (RhetorLint-authored pattern under a SemEval technique; 'refused to deny' — the strongest of the class — awaits its own verification wave)"

      - id: editorializing.stance
        semeval_technique: "Loaded Language"
        what: "An editorializing stance marker — 'tellingly', 'make no mistake', 'it should be noted' — instructs the reader how to judge the fact before the fact arrives."
        why_it_works: "The judgment is installed ahead of the evidence: by the time the fact lands, the reader has already been told what kind of fact it is."
        examples:
          - marked: "Tellingly, he skipped the hearing."
            tell: "Tellingly"
            plain: "He skipped the hearing; his office says he was in Brussels."
          - marked: "Make no mistake, this changes everything."
            tell: "Make no mistake"
            plain: "This changes the filing deadline and the fee schedule; the rest of the rules stand."
        lineage: "SemEval-2023 · Manipulative Wording › Loaded Language ('curiously' is deliberately NOT seeded — its manner sense is not stance at all; 'conveniently' and 'predictably' await a sentence-initial pattern rule)"

      - id: attribution.factive
        semeval_technique: "Obfuscation, Intentional Vagueness, Confusion"
        what: "A factive attribution — 'revealed that', 'pointed out that', 'debunked' — a said-substitute whose verb presupposes the attributed claim is true, endorsing it inside what reads as neutral reporting."
        why_it_works: "The endorsement is invisible because it wears reporting's clothes: 'revealed that X' asserts X while seeming only to attribute it, so the outlet's verdict arrives disguised as someone else's words."
        examples:
          - marked: "The memo revealed that the audit was shelved."
            tell: "revealed that"
            plain: "The memo said the audit was shelved; the auditor disputes this."
          - marked: "The paper debunked the claim."
            tell: "debunked"
            plain: "The paper published a rebuttal; the original authors stand by their data."
        lineage: "SemEval-2023 · Manipulative Wording › Obfuscation, Intentional Vagueness, Confusion (debunk/refute are success verbs and do NOT presuppose under negation; present-tense 'reveals that' is deliberately NOT marked — the plot-summary and document-description registers use it literally)"

      - id: puffery.peacock
        semeval_technique: "Exaggeration or Minimisation"
        what: "A puffery epithet — 'world-class', 'award-winning', 'visionary' — the praise sits in the adjective, not in a checkable fact."
        why_it_works: "Status is conferred, not demonstrated: the epithet carries the conclusion of an argument that never appears, and repetition across copy makes it feel established."
        examples:
          - marked: "A world-class team of visionary engineers."
            tell: "world-class"
            plain: "The team's compiler holds the SPEC benchmark record; two members are IEEE fellows."
          - marked: "The award-winning series returns."
            tell: "award-winning"
            plain: "The series, which won the 2025 Peabody, returns."
        lineage: "SemEval-2023 · Manipulative Wording › Exaggeration or Minimisation ('legendary' is deliberately NOT seeded — its literal mythological register dominates; known noise: academic 'state-of-the-art accuracy')"
```

And under `attack-on-reputation`, after the rewritten refusal, a new `tells:` list:

```yaml
    tells:

      - id: attribution.doubt-verb
        semeval_technique: "Doubt"
        what: "A doubt-casting attribution verb — 'said' reports the speech; 'claimed that' / 'insisted that' ship a verdict on the speaker inside the report. Reuters and AP style guides both warn that 'claim' suggests the writer doubts the speaker."
        why_it_works: "The doubt is priced into the grammar of the report itself: the reader receives the speaker pre-discounted, without any stated reason to discount them — and swapping in 'said' loses nothing but the verdict."
        examples:
          - marked: "The minister claimed that the figures were audited."
            tell: "claimed that"
            plain: "The minister said the figures were audited; the auditor's office declined to confirm."
          - marked: "He insisted that nothing was wrong."
            tell: "insisted that"
            plain: "Asked three times, he said nothing was wrong."
        lineage: "SemEval-2023 · Attack on Reputation › Doubt (deliberate misses, recorded: 'conceded/admitted that' — factive admissions where 'said' would delete a true fact; 'boasts/brags that' — praise idiom for venues and products; legal term-of-art 'a lawsuit claiming that' remains a documented residual leak)"

      - id: distancing.doubt-marker
        semeval_technique: "Doubt"
        what: "A doubt marker — 'so-called', 'self-styled', 'quote unquote' — the writer's own distancing word delivers a verdict on a title or label; the word itself contains no argument for the dispute."
        why_it_works: "The sneer pre-loads the verdict: the reader receives the writer's judgment of the title before — or instead of — any argument for it."
        examples:
          - marked: "We won't be lectured by these so-called experts."
            tell: "so-called"
            plain: "The panel disagrees with us; here is where their analysis and ours diverge."
          - marked: "The self-styled prophet drew a crowd."
            tell: "self-styled"
            plain: "He calls himself a prophet; no congregation has ordained him."
        lineage: "SemEval-2023 · Attack on Reputation › Doubt (typographic scare quotes are the sneer this rule REFUSES — deterministic text cannot tell citation from sneer; 'so-called' is the speakable form of scare quotes and is where the words-only line lands. Technical 'so-called' = 'known as' is the priced-in false positive; 'touted as' and 'billed as' are deliberately NOT seeded — neutral promotion-reporting verbs)"
```

- [ ] **Step 3: Move the two seeded techniques out of the family's "not yet seeded" listing** — in `attack-on-reputation`'s `semeval_techniques` block, keep the other three (Name Calling or Labelling, Guilt by Association, Appeal to Hypocrisy) listed as unseeded and remove "Doubt" and "Questioning the Reputation"… **Correction:** "Questioning the Reputation" stays unseeded (implicative.shortfall re-filed to manipulative-wording); remove ONLY "Doubt" from the unseeded listing, renaming the key to `semeval_techniques_not_yet_seeded` to match the `call` family's convention.
- [ ] **Step 4: Gate + commit**: `npm test` green; `git add spec/taxonomy.yaml && git commit -m "taxonomy: the media wave's eleven lessons, and attack-on-reputation's carefully scoped first seeds"`

---

### Task 7: Conformance corpus — pin bump + new ground-truth cases

**Files:**
- Create: `scripts/gen-conformance.mjs`
- Modify: `conformance/cases.json`

- [ ] **Step 1: Write the generator** `scripts/gen-conformance.mjs`:

```js
// Generate conformance-case JSON for given inputs from the JS reference
// engine, in the corpus's flat-mark shape. The output is a PROPOSAL: every
// generated case must be hand-read before it is committed as ground truth.
import { readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";

const rules = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));
const inputs = process.argv.slice(2);
const cases = inputs.map((input) => {
  const r = analyze(input, { rules });
  return {
    input,
    density: r.density,
    strip: r.strip,
    marks: r.marks.map((m) => ({
      ruleId: m.ruleId, family: m.family, technique: m.technique, actual: m.actual,
      start: m.position.start.offset, end: m.position.end.offset,
      note: m.note, confidence: m.confidence, level: m.level, expected: m.expected,
    })),
  };
});
process.stdout.write(JSON.stringify(cases, null, 1) + "\n");
```

- [ ] **Step 2: Generate the new cases** for exactly these 16 inputs (one command, quoted args). Positives (1–11) and cross-rule/negative pins (12–16):

```
 1. People familiar with the matter said the merger was dead.
 2. The senator ripped into the ruling and sparked outrage online.
 3. The strike caused collateral damage in two villages.
 4. An officer-involved shooting occurred at dawn; an altercation ensued.
 5. The filing raises serious questions about the timeline.
 6. The minister failed to mention the audit.
 7. Tellingly, the report was released on a Friday.
 8. The memo revealed that the audit was shelved.
 9. A world-class team of visionary engineers.
10. The minister claimed that the figures were audited.
11. We won't be lectured by these so-called experts.
12. Sources claim that the deal is dead.
13. Sources claimed that the deal is dead.
14. The plan has been widely described as a visionary gamble.
15. Experts noted that inflation slowed.
16. The startup has been described as the next big thing by Forbes.
```

- [ ] **Step 3: HAND-VERIFY every generated case** against the spec before committing — the honesty gate. Expected marks: 1→sourcing.anonymous +weasel? NO — "People familiar with the matter **said**" also matches weasel's `people ... say`? It does NOT: weasel needs subject immediately adjacent to verb (`people said` — here "familiar with the matter" intervenes). Expect sourcing.anonymous only. 2→combat ×2. 3→euphemism. 4→exoneration ×2. 5→insinuation. 6→implicative.shortfall. 7→editorializing.stance. 8→attribution.factive. 9→puffery ×2. 10→attribution.doubt-verb. 11→distancing.doubt-marker. 12→weasel only. 13→attribution.doubt-verb only. 14→weasel ("has been widely described as") + puffery ("visionary") — two marks, different spans. 15→weasel only (factive has no "noted"). 16→NO marks (guard holds). If the engine output disagrees with this table, STOP and reconcile against the spec — do not commit surprising ground truth.
- [ ] **Step 4: Splice into `conformance/cases.json`**: append the 16 verified cases to `cases`; change `"rules": "@rhetorlint/rules-en@0.1.2"` → `"@rhetorlint/rules-en@0.2.0"`. The 15 existing cases stay byte-identical.
- [ ] **Step 5: Three-engine gate**:

```bash
npm test && python3 impl/python/test_conformance.py && (cd impl/go && go test ./...)
```

Expected: JS all green; Python 31/31; Go ok. (Python's runner prints the case count — it reads the same cases.json.)
- [ ] **Step 6: Commit**: `git add -A && git commit -m "conformance: 16 media-wave cases pin the new ground truth across three engines"`

---

### Task 8: CLI 0.2.0 — ranges that can actually receive the wave

**Files:**
- Modify: `packages/cli/package.json`, `test/cli.test.mjs`

- [ ] **Step 1: Extend the range test** in `test/cli.test.mjs`, directly after the existing caret-range test (reuse its `CLI_MANIFEST`; add the pack read beside the existing imports):

```js
const RULES_PACK = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));

test("the CLI's caret ranges actually reach the in-repo pack", () => {
  // ^0.1.2 does NOT admit 0.2.0: for 0.x, caret pins the minor. A range that
  // cannot resolve the pack in this repo re-creates the 2026-07-24 incident.
  const range = CLI_MANIFEST.dependencies["@rhetorlint/rules-en"];
  const [maj, min, pat] = range.replace(/^\^/, "").split(".").map(Number);
  const [pMaj, pMin, pPat] = RULES_PACK.version.split(".").map(Number);
  assert.ok(
    maj === pMaj && min === pMin && pPat >= pat,
    `${range} cannot resolve rules-en@${RULES_PACK.version} — bump the CLI's range with the pack`
  );
});
```

- [ ] **Step 2: Run to verify failure**: `node --test test/cli.test.mjs` → the new test FAILS (`^0.1.2` vs pack 0.2.0).
- [ ] **Step 3: Bump `packages/cli/package.json`**: `"version": "0.1.1"` → `"0.2.0"`; `"@rhetorlint/rules-en": "^0.1.2"` → `"^0.2.0"` (`@rhetorlint/core` stays `^0.1.2` — the engine did not move).
- [ ] **Step 4: Run**: `npm test` → all green.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "cli 0.2.0: a range that can receive the media wave (the 07-24 lesson, now a test)"`

---

### Task 9: Widget + Explorer sync (the door's contents)

**Files:**
- Modify: `apps/widget/manifest.json`, `apps/explorer/index.html`, `test/widget-build.test.mjs`
- Regenerate: `apps/widget/content.js`, `apps/widget/bookmarklet.html` (via build)

- [ ] **Step 1: Extend the drift guard** in `test/widget-build.test.mjs`, next to the existing CORE_VERSION explorer test (reuse its `EXPLORER` path + `CORE_PACKAGE` import pattern):

```js
const RULES_PACKAGE = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));

test("the explorer's hand-inlined pack matches the canonical pack version", () => {
  const src = readFileSync(EXPLORER, "utf8");
  assert.ok(
    src.includes(`"version": "${RULES_PACKAGE.version}"`),
    `explorer inlines a stale pack — re-sync apps/explorer/index.html to rules-en@${RULES_PACKAGE.version}`
  );
});
```

- [ ] **Step 2: Run to verify failure** (explorer still inlines 0.1.2's shape — if it carries no version string at all, the test fails for that reason; the fix in Step 3 is to inline the full pack object including `id`/`version`).
- [ ] **Step 3: Re-sync the explorer.** In `apps/explorer/index.html`:
  - Replace the inlined rules block (the object containing the eleven `"ruleId":` entries, roughly lines 510–712) with the full contents of `packages/rules-en/rules.json` 0.2.0 (all 22 rules, including pack `id`/`version`/`locale`/`note`).
  - Update the static copy at ~line 496: "ships **11** rules across **5** of them" → "ships **22** rules across **6** of them" (the `packRules`/`packFams` spans keep their ids).
  - In the `WORKED` examples map (~line 1024 region), add one worked line per new ruleId, same shape as existing entries:

```js
"sourcing.anonymous": "People familiar with the matter said the merger was dead.",
"combat.attack-verb": "The senator ripped into the ruling.",
"euphemism.institutional": "The strike caused collateral damage in two villages.",
"exoneration.formula": "An officer-involved shooting occurred at dawn.",
"insinuation.raises-questions": "The filing raises serious questions about the timeline.",
"implicative.shortfall": "The minister failed to mention the audit.",
"editorializing.stance": "Tellingly, the report was released on a Friday.",
"attribution.factive": "The memo revealed that the audit was shelved.",
"puffery.peacock": "A world-class team of visionary engineers.",
"attribution.doubt-verb": "The minister claimed that the figures were audited.",
"distancing.doubt-marker": "We won't be lectured by these so-called experts.",
```

  - If the family presentation data (~line 860) hardcodes attack-on-reputation as awaiting rules, update its copy to reflect the two seeds (keep the refusal sentence for bare labels).
- [ ] **Step 4: Widget**: bump `apps/widget/manifest.json` `"version": "0.1.1"` → `"0.2.0"`, then `npm run build:widget` (regenerates `content.js` + `bookmarklet.html` from the real engine + new pack).
- [ ] **Step 5: Gate**: `npm test` → all green (widget staleness + explorer drift guards included). Spot-check the explorer by loading it and pasting "The minister claimed that the figures were audited." — expect a doubt-verb mark: `open apps/explorer/index.html` (manual sanity, 30 seconds).
- [ ] **Step 6: Commit**: `git add -A && git commit -m "widget+explorer 0.2.0: the door's contents now speak the media wave"`

---

### Task 10: README + the Pages door workflow

**Files:**
- Modify: `README.md`
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: README updates** (surgical, keep voice):
  - Status section: "eleven rules in all" copy → reflect 22 rules across 6 seeded families, attack-on-reputation's narrow seeding, justification still unseeded.
  - Readers bullet: add the hosted links (they go live after merge): explorer at `https://cambridgetcg.github.io/rhetorlint-spec/` and bookmarklet at `https://cambridgetcg.github.io/rhetorlint-spec/bookmarklet.html`.
- [ ] **Step 2: Create `.github/workflows/pages.yml`**:

```yaml
name: pages

# The People Door. The explorer IS the paste-a-text people page — it just
# never had a URL. Serve it as the site root, with the bookmarklet beside it.
# Everything stays on-device in the visitor's browser; this workflow only
# copies two already-committed, self-contained files.

on:
  push:
    branches: [main]
    paths:
      - "apps/explorer/index.html"
      - "apps/widget/bookmarklet.html"
      - ".github/workflows/pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - name: assemble the door
        run: |
          mkdir -p _site
          cp apps/explorer/index.html _site/index.html
          cp apps/widget/bookmarklet.html _site/bookmarklet.html
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Gate + commit**: `npm test`; `git add -A && git commit -m "docs+pages: the people door — the explorer gets a URL"`

---

### Task 11: PR, CI across three engines, merge, open the door

- [ ] **Step 1: Push + PR**:

```bash
git push -u origin feat/media-wave-0.2.0
gh pr create --repo cambridgetcg/rhetorlint-spec --title "The media wave: rules-en 0.2.0, 11 new tells + the people door" --body "$(cat <<'EOF'
Spec: docs/superpowers/specs/2026-07-27-media-tell-pack-design.md
- 11 new rules (9 manipulative-wording incl. exoneration formulas; first 2 carefully-scoped seeds of attack-on-reputation) + weasel.attribution growth
- Every rule adversarially verified on 3 lenses; zero measured FPs on a 105-item live-headline corpus
- Conformance grows 15 → 31 cases, three engines value-identical
- cli 0.2.0 (caret ranges that can actually receive the wave — the 07-24 lesson, now a test)
- People door: GitHub Pages serves the explorer + bookmarklet

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(If `gh` is authed as the wrong account: `gh auth switch -u cambridgetcg` first.)
- [ ] **Step 2: Wait for CI green** (ci.yml runs JS + Python + Go). Poll: `gh pr checks --repo cambridgetcg/rhetorlint-spec --watch`.
- [ ] **Step 3: Merge**: `gh pr merge --repo cambridgetcg/rhetorlint-spec --squash --delete-branch` — squash keeps main's story clean; the branch commits live on in the PR.
- [ ] **Step 4: Enable Pages** (first time only):

```bash
gh api -X POST repos/cambridgetcg/rhetorlint-spec/pages -f build_type=workflow || \
gh api -X PUT repos/cambridgetcg/rhetorlint-spec/pages -f build_type=workflow
```

Then confirm the pages workflow ran on the merge commit (`gh run list --repo cambridgetcg/rhetorlint-spec --workflow=pages`) and `curl -sI https://cambridgetcg.github.io/rhetorlint-spec/ | head -3` → 200.

---

### Task 12: Release — tag, OIDC, verify from the registry

- [ ] **Step 1: Tag the release** (on updated main):

```bash
git checkout main && git pull && git tag release-media-wave-0.2.0 && git push origin release-media-wave-0.2.0
```

This triggers `release.yml`: it publishes only what the registry lacks → `@rhetorlint/rules-en@0.2.0` and `@rhetorlint/cli@0.2.0` (core 0.1.2 already live, skipped). This is also the FIRST live proof of the trusted-publisher OIDC path Yu registered on 07-24.
- [ ] **Step 2: Watch**: `gh run watch --repo cambridgetcg/rhetorlint-spec` on the release run. If OIDC fails again, capture the verbose log lines, do NOT retry-shuffle claims (the 07-24 lesson), record the failure in the handoff doc, and fall back to noting that Yu's security-key interactive publish (`./scripts/publish-npm-interactive.zsh`) is the remaining step.
- [ ] **Step 3: Verify from a clean install, not the checkout**:

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null && npm i @rhetorlint/cli >/dev/null
npm ls @rhetorlint/core @rhetorlint/rules-en   # expect core 0.1.2, rules-en 0.2.0
echo "The minister claimed that the figures were audited, people familiar with the matter said." | npx rhetorlint --json
```

Expect marks for `attribution.doubt-verb` and `sourcing.anonymous`. Also `npm view @rhetorlint/rules-en version` → `0.2.0`, `npm view @rhetorlint/cli version` → `0.2.0`.

---

### Task 13: The exposé run (report, not repo)

- [ ] **Step 1:** Pull fresh headlines (same RSS set as the corpus agent: BBC, Guardian, NYT, Fox, Al Jazeera, NPR) into the scratchpad and run the NEW pack over them with the real engine. Deterministic machine output only — no editorial picks beyond "today's feeds, in order".
- [ ] **Step 2:** Report to Yu: total density, which new rules fired on which outlets' copy, the top marked passages verbatim with rule + note. The machine does the exposing; the report just relays what it found. Include the door URL so he can paste any article himself.

---

## Self-Review (done at write time)

- **Spec coverage:** all 11 rules (T2–T5), weasel growth (T4), taxonomy lessons + counts + refusal rewrite + not-seeded notes (T6), conformance incl. seam/double-mark/noted pins (T7), cli caret fix + test (T8), widget/explorer sync + drift guard (T9), README + Pages (T10–T11), release (T12). Wave-2 backlog intentionally unimplemented. Deprecate-0.1.1/PyPI remain standing items outside the wave (spec's "for the record" section).
- **Placeholder scan:** none — every rule JSON, lesson, test, and workflow is verbatim.
- **Type consistency:** `marksFor`/`idsFor`/`spansOf` defined once in T2, reused T3–T5; `MEDIA_WAVE_RULE_IDS` (T1) matches the 11 ruleIds landed in T2–T5; conformance case count 15+16=31 matches T7's gate.
