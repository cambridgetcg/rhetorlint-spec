import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";
import { validate } from "./helpers/schema-validator.mjs";

const rules = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));
const corpus = JSON.parse(readFileSync(new URL("../conformance/cases.json", import.meta.url)));
const schema = JSON.parse(readFileSync(new URL("../spec/output.schema.json", import.meta.url)));

/** The corpus stores a span flat; the schema nests it under position. */
function nest(mark) {
  const { start, end, ...rest } = mark;
  return { ...rest, position: { start: { offset: start }, end: { offset: end } } };
}

function flat(r) {
  return {
    density: r.density,
    strip: r.strip,
    marks: r.marks.map((m) => ({
      ruleId: m.ruleId, displayName: m.displayName, family: m.family,
      technique: m.technique, classificationStatus: m.classificationStatus,
      taxonomyMappingStatus: m.taxonomyMappingStatus, actual: m.actual,
      start: m.position.start.offset, end: m.position.end.offset,
      note: m.note, confidence: m.confidence, level: m.level, expected: m.expected
    }))
  };
}

// The JS reference engine must reproduce its committed expected outputs,
// so the corpus can't silently drift from the engine (or vice versa).
for (const [i, c] of corpus.cases.entries()) {
  test(`conformance case ${i}: ${c.input.slice(0, 40)}`, () => {
    const got = flat(analyze(c.input, { rules }));
    assert.deepEqual(got, { density: c.density, strip: c.strip, marks: c.marks });
  });
}

// The corpus is the cross-engine reference fixture. An expectation that violates
// the published schema would teach three engines to agree on illegal output,
// so each case is held to the contract as well as to the JS engine.
for (const [i, c] of corpus.cases.entries()) {
  test(`conformance case ${i} expects schema-legal output`, () => {
    const at = (part) => ({ root: schema, path: `case[${i}].${part}` });
    assert.deepEqual(validate(c.density, schema.properties.density, at("density")), []);
    assert.deepEqual(validate(c.strip, schema.properties.strip, at("strip")), []);
    for (const [j, m] of c.marks.entries()) {
      assert.deepEqual(validate(nest(m), schema.$defs.mark, at(`marks[${j}]`)), []);
    }
  });
}

test("the corpus is non-trivial (guards against an empty fixture)", () => {
  assert.deepEqual(
    validate(corpus.spec, schema.properties.rhetorlint, { root: schema, path: "corpus.spec" }),
    [],
    "the corpus must name a spec version the schema accepts"
  );
  assert.ok(corpus.cases.length >= 8);
  assert.ok(corpus.cases.some((c) => c.density.tells > 0));
  assert.ok(corpus.cases.some((c) => c.density.tells === 0), "includes zero-marker controls");
});
