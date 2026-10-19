import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";
import { assertSupported, validate } from "./helpers/schema-validator.mjs";

// measurement/contrast.json holds minimal pairs: what the WORDS of each
// sentence should get from one rule, and whether the engine gets it today.
// A row's status is a claim about the engine, so this test keeps it true in
// both directions: a regression breaks a `holds` row, and a fix that makes a
// `known-defect` row hold fails until the row is flipped. The open backlog
// then cannot drift from what the engine actually does.

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

const RULES = JSON.parse(read("packages/rules-en/rules.json"));
const SCHEMA = JSON.parse(read("measurement/schema/contrast.schema.json"));
const RAW = read("measurement/contrast.json");
const CONTRAST = JSON.parse(RAW);
const ROWS = CONTRAST.rows;

/** Rules held to at least five must-mark rows and five innocent twins. */
const DEEP_RULES = ["agency-hiding.deleted-subject", "absolute.universal", "intensifier.loaded"];

/** What the engine does with one row, judged against the row's expectation. */
function judge(row) {
  const result = analyze(row.text, { rules: RULES });
  const spans = result.marks.filter((mark) => mark.ruleId === row.ruleId).map((mark) => mark.actual);
  if (row.expect === "mark") {
    return { holds: spans.includes(row.actual), fires: spans.length > 0, got: `marks ${JSON.stringify(spans)}` };
  }
  if (row.expect === "silent") {
    return { holds: spans.length === 0, fires: spans.length > 0, got: `marks ${JSON.stringify(spans)}` };
  }
  return { holds: result.strip === row.strip, fires: false, got: `strip ${JSON.stringify(result.strip)}` };
}

function wanted(row) {
  if (row.expect === "mark") return `mark ${JSON.stringify(row.actual)}`;
  if (row.expect === "silent") return "no mark";
  return `strip ${JSON.stringify(row.strip)}`;
}

const VERDICTS = new Map(ROWS.map((row) => [row.id, judge(row)]));

/** A rule whose tell is spelt with an ASCII apostrophe or hyphen can be silenced by smart punctuation. */
function typographySensitive(rule) {
  if (rule.type === "lexical") return rule.terms.some((term) => /['-]/.test(term));
  if (rule.type === "pattern") return /'|\[-/.test(rule.pattern);
  return false;
}

function citedLine(cite) {
  const at = cite.lastIndexOf(":");
  const path = cite.slice(0, at);
  const line = Number(cite.slice(at + 1));
  if (path.split("/").includes("..")) return null;
  const file = new URL(path, ROOT);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8").split("\n")[line - 1];
  return text === undefined || text.trim() === "" ? null : text;
}

test("contrast.json matches measurement/schema/contrast.schema.json", () => {
  assertSupported(SCHEMA);
  assert.deepEqual(validate(CONTRAST, SCHEMA), []);
  assert.deepEqual(
    Object.keys(CONTRAST.tags).sort(),
    [...SCHEMA.$defs.row.properties.tag.enum].sort(),
    "every tag a row may carry is described once in contrast.json 'tags'"
  );
});

test("contrast.json is ASCII, so smart punctuation stays visible in review", () => {
  const offset = RAW.search(/[^\t\n\x20-\x7e]/);
  assert.equal(offset, -1,
    `non-ASCII at offset ${offset}: write it as a \\u escape so U+2011 cannot pass for '-'`);
});

test("every row keeps the rules the schema cannot express", () => {
  const ruleIds = new Set(RULES.rules.map((rule) => rule.ruleId));
  const ids = new Set();
  const keys = new Set();
  const problems = [];
  for (const row of ROWS) {
    const say = (message) => problems.push(`${row.id}: ${message}`);
    if (ids.has(row.id)) say("duplicate id");
    ids.add(row.id);
    const key = [row.ruleId, row.expect, row.text].join("\u0000");
    if (keys.has(key)) say("repeats another row's text, rule and expectation");
    keys.add(key);
    if (!ruleIds.has(row.ruleId)) say(`ruleId '${row.ruleId}' is not in packages/rules-en/rules.json`);

    const ascii = /^[\x20-\x7e]+$/.test(row.text);
    if (row.kind === "typography" && ascii) say("a typography row must contain a non-ASCII character");
    if (row.kind !== "typography" && !ascii) say("text must be printable ASCII unless kind is 'typography'");

    if ((row.expect === "mark") !== (row.actual !== undefined)) say("'actual' goes with expect 'mark', and only with it");
    if (row.actual !== undefined && !row.text.includes(row.actual)) say(`actual ${JSON.stringify(row.actual)} does not occur in the text`);
    if ((row.expect === "strip-preserves") !== (row.strip !== undefined)) say("'strip' goes with expect 'strip-preserves', and only with it");

    if (row.status === "known-defect" && row.tag === undefined) say("a known-defect row needs a tag naming the opportunity that fixes it");
    if (row.status === "priced-in") {
      if (row.expect !== "silent") say("priced-in means an accepted false positive, so expect must be 'silent'");
      if (row.cite === undefined) say("a priced-in row must cite the file:line that accepts its false positive");
    }
    if (row.cite !== undefined && citedLine(row.cite) === null) say(`cite ${row.cite} does not resolve to a non-blank line in this repo`);
  }
  assert.deepEqual(problems, []);
});

test("every rule has contrast on both sides, and smart punctuation is covered", () => {
  const problems = [];
  for (const rule of RULES.rules) {
    const own = ROWS.filter((row) => row.ruleId === rule.ruleId);
    const mustMark = own.filter((row) => row.expect === "mark").length;
    const twins = own.filter((row) => row.expect === "silent").length;
    const floor = DEEP_RULES.includes(rule.ruleId) ? 5 : 1;
    if (mustMark < floor) problems.push(`${rule.ruleId}: ${mustMark} must-mark rows (needs ${floor})`);
    if (twins < floor) problems.push(`${rule.ruleId}: ${twins} innocent-twin rows (needs ${floor})`);
    if (typographySensitive(rule) &&
        !own.some((row) => row.kind === "typography" && row.expect === "mark")) {
      problems.push(`${rule.ruleId}: spelt with an ASCII apostrophe or hyphen but has no typographic must-mark row`);
    }
  }
  assert.deepEqual(problems, []);
});

test("holds rows hold", () => {
  const broken = ROWS
    .filter((row) => row.status === "holds" && !VERDICTS.get(row.id).holds)
    .map((row) => `  ${row.id} [${row.ruleId}] expects ${wanted(row)}, engine gives ${VERDICTS.get(row.id).got}: ${JSON.stringify(row.text)}`);
  assert.equal(broken.length, 0,
    `${broken.length} holds row(s) no longer hold. Fix the regression; if the change is ` +
    `intended, set status known-defect with a tag and say why in reason:\n${broken.join("\n")}`);
});

test("known-defect rows still miss their expectation until a fix flips them", () => {
  const changed = [];
  for (const row of ROWS.filter((r) => r.status === "known-defect")) {
    const verdict = VERDICTS.get(row.id);
    if (verdict.holds) {
      changed.push(`  known defect now holds: flip status (${row.id}, ${row.tag}, ${row.ruleId}): ${JSON.stringify(row.text)}`);
    } else if (row.expect === "mark" && verdict.fires) {
      changed.push(`  known defect now ${verdict.got} where it expects ${wanted(row)}: review actual, then flip status (${row.id}, ${row.tag})`);
    }
  }
  assert.equal(changed.length, 0, `${changed.length} known-defect row(s) changed:\n${changed.join("\n")}`);
});

test("priced-in rows still make the false positive they price in", () => {
  const changed = ROWS
    .filter((row) => row.status === "priced-in" && VERDICTS.get(row.id).holds)
    .map((row) => `  priced-in false positive no longer marks: flip status to holds (${row.id}, cites ${row.cite})`);
  assert.equal(changed.length, 0, changed.join("\n"));
});

test("open known-defect counts per tag", (t) => {
  const open = {};
  for (const tag of Object.keys(CONTRAST.tags)) open[tag] = 0;
  for (const row of ROWS) if (row.status === "known-defect") open[row.tag]++;
  const status = {};
  for (const row of ROWS) status[row.status] = (status[row.status] || 0) + 1;
  t.diagnostic(`contrast: ${ROWS.length} rows (${Object.entries(status).map(([k, n]) => `${k} ${n}`).join(", ")})`);
  t.diagnostic(`open known-defect rows by tag: ${Object.entries(open).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  assert.equal(Object.values(open).reduce((a, b) => a + b, 0), status["known-defect"] || 0);
});
