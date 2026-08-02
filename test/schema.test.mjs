import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";
import { toSarif } from "../packages/core/sarif.mjs";
import { validate, assertSupported } from "./helpers/schema-validator.mjs";

const SCHEMA = JSON.parse(
  readFileSync(new URL("../spec/output.schema.json", import.meta.url))
);
const RULES = JSON.parse(
  readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url))
);
const MARK = SCHEMA.$defs.mark;

/**
 * Inputs chosen to walk the corners of the schema, not to pin mark counts:
 * every family the pack seeds, a source with no words at all, a mark that
 * starts at offset 0, and text that spans lines so line/column are exercised.
 */
const SPECIMENS = [
  {
    label: "the classic specimen",
    text:
      "We take your privacy extremely seriously, and regrettably, mistakes were made. " +
      "We are reaching out to affected users."
  },
  { label: "a direct active sentence", text: "I made a mistake and I will fix it by Friday." },
  { label: "empty input", text: "" },
  { label: "whitespace only", text: "   \n\t  " },
  { label: "a mark at offset 0", text: "ACT NOW — the upgrade is absolutely free." },
  {
    label: "absolutes and intensifiers",
    text: "Everyone knows this is incredibly important and nobody disagrees."
  },
  {
    label: "borrowed authority and deniable hedging",
    text: "Experts say the outage may have affected some users."
  },
  {
    label: "whataboutism",
    text: "But what about the other side? The real question is who benefits."
  },
  {
    label: "several lines",
    text: "Line one is fine.\nMISTAKES WERE MADE here, regrettably.\nSign up today only."
  },
  {
    label: "text outside the BMP",
    text: "We are reaching out to café users 🙂 — mistakes were made."
  }
];

const CLASSIC = analyze(SPECIMENS[0].text, { rules: RULES });

/** What JSON keeps: an optional left undefined is absent, not a change. */
function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v)])
  );
}

test("the published schema uses no construct this validator quietly ignores", () => {
  // A keyword added to a branch no instance happens to reach would otherwise
  // sit unchecked while the suite still reported conformance.
  assertSupported(SCHEMA);
});

for (const specimen of SPECIMENS) {
  test(`${specimen.label}: the result satisfies spec/output.schema.json`, () => {
    const result = analyze(specimen.text, { rules: RULES });
    assert.deepEqual(
      validate(result, SCHEMA),
      [],
      "the schema is the spec's published contract; the engine may not drift from it"
    );

    // The contract is what leaves the process, so check the wire form too: a
    // value JSON cannot carry (NaN, Infinity) would pass in memory and reach a
    // reader as null. An undefined optional simply vanishes, which is legal.
    const wire = JSON.parse(JSON.stringify(result));
    assert.deepEqual(wire, withoutUndefined(result), "nothing may change on the wire");
    assert.deepEqual(validate(wire, SCHEMA), []);

    for (const mark of result.marks) {
      const slice = specimen.text.slice(mark.position.start.offset, mark.position.end.offset);
      assert.equal(slice, mark.actual, `mark '${mark.ruleId}' must point at its own text`);
    }
  });
}

test("a source with no words still reports a schema-legal density", () => {
  for (const text of ["", "   \n\t  "]) {
    const result = analyze(text, { rules: RULES });
    assert.deepEqual(validate(result, SCHEMA), []);
    assert.deepEqual(result.marks, [], "nothing can be marked in text with no words");
    assert.equal(result.density.tells, 0);
    assert.equal(result.density.per100Words, 0, "no words means no division, not NaN");
  }
});

test("a mark at offset 0 keeps a legal point (offset 0, line 1, column 1)", () => {
  const result = analyze(SPECIMENS[4].text, { rules: RULES });
  const first = result.marks.find((m) => m.position.start.offset === 0);
  assert.ok(first, "the opening phrase is marked, so offset 0 is exercised");
  assert.equal(first.position.start.line, 1);
  assert.equal(first.position.start.column, 1);
  assert.deepEqual(validate(first, MARK, { root: SCHEMA, path: "mark" }), []);
});

test("the specimen matrix exercises the rules the pack ships", () => {
  const seen = new Set();
  const families = new Set();
  for (const specimen of SPECIMENS) {
    for (const mark of analyze(specimen.text, { rules: RULES }).marks) {
      seen.add(mark.ruleId);
      families.add(mark.family);
    }
  }
  // Floors, not equalities: a rule pack may grow without this going red. The
  // three newest rules are named because they shipped in the release whose
  // headline claim is schema conformance.
  assert.ok(seen.size >= 8, `matrix covers too few rules: ${[...seen].join(", ")}`);
  assert.ok(families.size >= 4, `matrix covers too few families: ${[...families].join(", ")}`);
  for (const ruleId of ["lure.free-offer", "urgency.appeal-to-time", "shouting.caps"]) {
    assert.ok(seen.has(ruleId), `no specimen exercises '${ruleId}'`);
  }
});

test("every rule in the pack declares metadata the schema will accept", () => {
  // Checked at the pack, not through a mark: a rule with an unlisted family or
  // a malformed ruleId would emit illegal output the first time it fires.
  for (const rule of RULES.rules) {
    const where = `rule '${rule.ruleId}'`;
    const properties = MARK.properties;
    assert.deepEqual(
      validate(rule.ruleId, properties.ruleId, { root: SCHEMA, path: `${where}.ruleId` }), []
    );
    assert.deepEqual(
      validate(rule.family, properties.family, { root: SCHEMA, path: `${where}.family` }), []
    );
    assert.deepEqual(
      validate(rule.displayName, properties.displayName, {
        root: SCHEMA,
        path: `${where}.displayName`
      }),
      []
    );
    assert.deepEqual(
      validate(rule.taxonomyMappingStatus, properties.taxonomyMappingStatus, {
        root: SCHEMA,
        path: `${where}.taxonomyMappingStatus`
      }),
      []
    );
    assert.deepEqual(
      validate(rule.level ?? "info", properties.level, { root: SCHEMA, path: `${where}.level` }), []
    );
    assert.deepEqual(
      validate(rule.confidence, properties.confidence, { root: SCHEMA, path: `${where}.confidence` }), []
    );
    if (rule.technique !== undefined) {
      assert.deepEqual(
        validate(rule.technique, properties.technique, { root: SCHEMA, path: `${where}.technique` }), []
      );
    }
    if (rule.expected !== undefined) {
      assert.deepEqual(
        validate(rule.expected, properties.expected, { root: SCHEMA, path: `${where}.expected` }), []
      );
    }
  }
});

test("SARIF export survives JSON and carries every mark back", () => {
  for (const specimen of [SPECIMENS[0], SPECIMENS[4], SPECIMENS[8]]) {
    const result = analyze(specimen.text, { rules: RULES });
    const sarif = toSarif(result);
    assert.deepEqual(JSON.parse(JSON.stringify(sarif)), sarif, `${specimen.label}: SARIF must survive JSON`);

    const run = sarif.runs[0];
    assert.equal(run.results.length, result.marks.length);
    assert.deepEqual(run.properties.density, result.density);

    // SARIF is a lossy export, but the span, the id and the visible phrase are
    // the parts a reader acts on — those must come back intact.
    const recovered = run.results.map((res) => {
      const region = res.locations[0].physicalLocation.region;
      return {
        ruleId: res.ruleId,
        family: res.properties.family,
        actual: region.snippet.text,
        confidence: res.properties.confidence,
        position: {
          start: { offset: region.charOffset },
          end: { offset: region.charOffset + region.charLength }
        }
      };
    });
    for (const [i, mark] of recovered.entries()) {
      assert.deepEqual(
        validate(mark, MARK, { root: SCHEMA, path: `sarif.results[${i}]` }),
        [],
        "a mark rebuilt from SARIF must still satisfy the schema"
      );
      assert.equal(mark.ruleId, result.marks[i].ruleId);
      assert.equal(mark.actual, result.marks[i].actual);
      assert.deepEqual(mark.position, {
        start: { offset: result.marks[i].position.start.offset },
        end: { offset: result.marks[i].position.end.offset }
      });
      // technique rides as null when a rule declares none; the schema has no
      // null there, so SARIF is checked directly rather than fed back in.
      assert.equal(run.results[i].properties.technique, result.marks[i].technique ?? null);
    }
  }
});

/** A violation, injected into a known-good result. */
function broken(mutate) {
  const result = JSON.parse(JSON.stringify(CLASSIC));
  mutate(result);
  return validate(result, SCHEMA).join(" | ");
}

test("the validator catches each kind of violation the schema forbids", () => {
  assert.match(broken((r) => { delete r.density; }), /required property 'density' is missing/);
  assert.match(broken((r) => { delete r.marks[0].actual; }), /marks\[0\]: required property 'actual' is missing/);
  assert.match(broken((r) => { r.verdict = "guilty"; }), /property 'verdict' is not permitted here/);
  assert.match(broken((r) => { r.marks[0].intent = "malicious"; }), /marks\[0\]: property 'intent' is not permitted here/);
  assert.match(broken((r) => { r.marks[0].family = "vibes"; }), /outside the permitted set/);
  assert.match(broken((r) => { r.marks[0].level = "critical"; }), /marks\[0\]\.level: "critical" is outside/);
  assert.match(broken((r) => { r.marks[0].ruleId = "Loaded Language"; }), /does not match/);
  assert.match(broken((r) => { r.rhetorlint = "v0.1"; }), /rhetorlint: "v0.1" does not match/);
  assert.match(broken((r) => { r.marks[0].confidence = 1.5; }), /is above the maximum 1/);
  assert.match(broken((r) => { r.marks[0].confidence = -0.1; }), /is below the minimum 0/);
  assert.match(broken((r) => { r.marks[0].position.start.offset = -1; }), /is below the minimum 0/);
  assert.match(broken((r) => { r.marks[0].position.start.offset = 1.5; }), /expected integer, got number/);
  assert.match(broken((r) => { r.marks[0].actual = 42; }), /expected string, got integer/);
  assert.match(broken((r) => { r.marks[0].expected = ["fine", 7]; }), /expected\[1\]: expected string, got integer/);
  assert.match(broken((r) => { r.marks = "none"; }), /marks: expected array, got string/);
  assert.match(broken((r) => { r.source.words = "many"; }), /source\.words: expected integer, got string/);
  assert.match(broken((r) => { r.density.per100Words = Number.NaN; }), /is not JSON data/);
  assert.match(broken((r) => { r.rewrite = 7; }), /rewrite: expected string or null, got integer/);
  assert.match(broken((r) => { r.marks[0].position = { start: { offset: 0 } }; }), /required property 'end' is missing/);
  assert.match(broken((r) => { r.marks[0].position.start.line = 0; }), /line: 0 is below the minimum 1/);

  // Optional-but-legal values stay legal: a null rewrite and an absent strip.
  assert.deepEqual(broken((r) => { r.rewrite = "a caller-supplied model rewrite"; }), "");
  assert.deepEqual(broken((r) => { delete r.strip; }), "");
  assert.deepEqual(broken((r) => { delete r.engine; }), "");
});

test("the validator refuses a schema construct it does not implement", () => {
  const cases = [
    [{ oneOf: [{ type: "string" }] }, /keyword 'oneOf'.*is not implemented/],
    [{ type: "object", minProperties: 1 }, /keyword 'minProperties'.*is not implemented/],
    [{ type: "array", uniqueItems: true }, /keyword 'uniqueItems'.*is not implemented/],
    [{ type: "object", additionalProperties: { type: "string" } }, /only 'additionalProperties: false' is implemented/],
    [{ type: "object", additionalProperties: true }, /only 'additionalProperties: false' is implemented/],
    [{ type: "array", items: [{ type: "string" }] }, /tuple form of 'items' is not implemented/],
    [{ type: "shape" }, /unknown type 'shape'/],
    [{ enum: [{ family: "call" }] }, /only primitive enum members are implemented/],
    [{ $ref: "https://example.com/other.json#/x" }, /only local '#\/' pointers are implemented/],
    [{ $ref: "#/$defs/absent" }, /does not resolve/],
    [true, /must be an object/]
  ];
  for (const [schema, message] of cases) {
    assert.throws(() => validate({ any: "instance" }, schema), message, JSON.stringify(schema));
  }
});
