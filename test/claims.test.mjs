import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The READMEs state how many rules and families ship. Those numbers drifted
// once already: packages/rules-en/README.md said "11 rules across 5 of the
// taxonomy's 7 families" for a whole release that shipped 22 across 6. A
// stated count is a claim, so it is held to rules.json here.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pack = JSON.parse(read("packages/rules-en/rules.json"));
const schema = JSON.parse(read("spec/output.schema.json"));

// The schema's family enum is the taxonomy's family list
// (test/taxonomy-agreement.test.mjs holds the two together).
const families = schema.$defs.mark.properties.family.enum;
const shipped = families.filter((f) => pack.rules.some((r) => r.family === f));
const unseeded = families.filter((f) => !shipped.includes(f));
const unknown = pack.rules.filter((r) => !families.includes(r.family)).map((r) => r.ruleId);

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** "22", "twenty-two", "Seven" -> number; anything else -> NaN. */
function count(word) {
  const w = word.toLowerCase();
  if (/^[0-9]+$/.test(w)) return Number(w);
  if (UNITS.includes(w)) return UNITS.indexOf(w);
  const [tens, unit] = w.split("-");
  const t = TENS.indexOf(tens);
  if (t < 2) return NaN;
  if (unit === undefined) return t * 10;
  const u = UNITS.indexOf(unit);
  return u >= 1 && u <= 9 ? t * 10 + u : NaN;
}

function claim(file, pattern) {
  const m = read(file).match(pattern);
  assert.ok(m, `${file} no longer states the counts this test checks (${pattern}); ` +
    "if the wording changed, point test/claims.test.mjs at the new wording rather than dropping the check");
  return m;
}

test("the count parser reads digits and number words", () => {
  assert.deepEqual(["22", "twenty-two", "Seven", "six", "eleven", "thirty"].map(count), [22, 22, 7, 6, 11, 30]);
  assert.ok(Number.isNaN(count("several")));
});

test("every shipped rule belongs to a family the schema names", () => {
  assert.deepEqual(unknown, []);
});

test("README.md states the shipped rule and family counts", () => {
  const [sentence, taxonomyFamilies, shippingFamilies, rules] = claim("README.md",
    /The taxonomy carries (\S+) families; (\S+) of them ship at least one rule, (\S+) rules in all\./);
  assert.equal(count(taxonomyFamilies), families.length, sentence);
  assert.equal(count(shippingFamilies), shipped.length, sentence);
  assert.equal(count(rules), pack.rules.length, sentence);
});

test("packages/rules-en/README.md states the shipped rule and family counts", () => {
  const [sentence, rules, shippingFamilies, taxonomyFamilies] = claim("packages/rules-en/README.md",
    /^(\S+) rules across (\S+) of the taxonomy's (\S+) families:$/m);
  assert.equal(count(rules), pack.rules.length, sentence);
  assert.equal(count(shippingFamilies), shipped.length, sentence);
  assert.equal(count(taxonomyFamilies), families.length, sentence);
});

test("packages/rules-en/README.md's rules table is rules.json, family by family", () => {
  const file = "packages/rules-en/README.md";
  const lines = read(file).split("\n");
  const start = lines.findIndex((l) => / rules across .* families:$/.test(l));
  assert.ok(start >= 0, `${file}: the rules table's count line is missing`);
  let i = start + 1;
  while (lines[i] === "") i++;
  const rows = [];
  for (; lines[i]?.startsWith("|"); i++) {
    const m = lines[i].match(/^\| `([a-z-]+)` \| (.*) \|$/);
    if (m) rows.push([m[1], [...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1])]);
  }
  const expected = shipped.map((f) => [f, pack.rules.filter((r) => r.family === f).map((r) => r.ruleId)]);
  assert.deepEqual(rows, expected, `${file}: regenerate the table from packages/rules-en/rules.json`);

  const [sentence, named] = claim(file, /^(.+) (?:is|are) named in the taxonomy and not yet seeded here\.$/m);
  assert.deepEqual([...named.matchAll(/`([^`]+)`/g)].map((x) => x[1]), unseeded, sentence);
});
