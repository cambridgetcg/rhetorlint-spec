import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(
  new URL("../apps/explorer/index.html", import.meta.url),
  "utf8"
);
const RULES = JSON.parse(
  readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url))
);
const START = "  /* BEGIN GENERATED EXPLORER RULES */";
const END = "  /* END GENERATED EXPLORER RULES */";

function embeddedRules() {
  const start = SOURCE.indexOf(START);
  const end = SOURCE.indexOf(END);
  assert.ok(start >= 0 && end > start, "generated explorer rule markers must exist in order");
  const block = SOURCE.slice(start + START.length, end).trim();
  const match = /^const RULES = ([\s\S]+);$/.exec(block);
  assert.ok(match, "generated explorer rule block must be one JSON assignment");
  return JSON.parse(match[1]);
}

test("the standalone explorer embeds the complete canonical rule pack", () => {
  assert.deepEqual(embeddedRules(), RULES);
});

test("the explorer's inlined browser script parses", () => {
  const match = /<script>([\s\S]+)<\/script>/.exec(SOURCE);
  assert.ok(match, "explorer must contain its standalone script");
  assert.doesNotThrow(() => new Function(match[1]));
});

test("the explorer teaches hypotheses, alternatives, measures, and evidence probes", () => {
  for (const label of [
    "Contestable effect hypothesis",
    "Alternative readings:",
    "Observable measures:",
    "Verification probe",
    "Evidence needed:"
  ]) {
    assert.match(SOURCE, new RegExp(label));
  }
});
