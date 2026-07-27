import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pack = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));

// The 2026-07 media wave. Every id here must exist once the wave lands;
// until then the per-rule assertions are simply vacuous.
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
