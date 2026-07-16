import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";

const rules = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));
const corpus = JSON.parse(readFileSync(new URL("../conformance/cases.json", import.meta.url)));

function flat(r) {
  return {
    density: r.density,
    strip: r.strip,
    marks: r.marks.map((m) => ({
      ruleId: m.ruleId, family: m.family, technique: m.technique, actual: m.actual,
      start: m.position.start.offset, end: m.position.end.offset,
      note: m.note, confidence: m.confidence, level: m.level, expected: m.expected
    }))
  };
}

// The JS reference engine must reproduce its own committed ground truth,
// so the corpus can't silently drift from the engine (or vice versa).
for (const [i, c] of corpus.cases.entries()) {
  test(`conformance case ${i}: ${c.input.slice(0, 40)}`, () => {
    const got = flat(analyze(c.input, { rules }));
    assert.deepEqual(got, { density: c.density, strip: c.strip, marks: c.marks });
  });
}

test("the corpus is non-trivial (guards against an empty fixture)", () => {
  assert.ok(corpus.cases.length >= 8);
  assert.ok(corpus.cases.some((c) => c.density.tells > 0));
  assert.ok(corpus.cases.some((c) => c.density.tells === 0), "includes clean controls");
});
