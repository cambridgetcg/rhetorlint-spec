import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate } from "./helpers/schema-validator.mjs";

const CLI = fileURLToPath(new URL("../packages/cli/cli.mjs", import.meta.url));
const CLI_MANIFEST = JSON.parse(readFileSync(new URL("../packages/cli/package.json", import.meta.url)));
const RULES_MANIFEST = JSON.parse(readFileSync(new URL("../packages/rules-en/package.json", import.meta.url)));
const SCHEMA = JSON.parse(readFileSync(new URL("../spec/output.schema.json", import.meta.url)));
const SPECIMEN =
  "We take your privacy extremely seriously, and regrettably, mistakes were made. " +
  "We are reaching out to affected users.";
const CLEAN = "I made a mistake and I will fix it by Friday.";

function run(args, input) {
  return spawnSync("node", [CLI, ...args], { input, encoding: "utf8" });
}

test("stdin + --json emits a valid RhetorLint result", () => {
  const r = run(["--json"], SPECIMEN);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.rhetorlint, "0.1");
  assert.equal(out.density.tells, 4);
  assert.ok(out.marks.some((m) => m.ruleId === "agency-hiding.deleted-subject"));
  // What the CLI prints is the surface anyone else parses, so it answers to
  // the published schema and not merely to the engine that produced it.
  assert.deepEqual(validate(out, SCHEMA), []);
  assert.deepEqual(validate(JSON.parse(run(["--json"], CLEAN).stdout), SCHEMA), []);
});

test("--sarif emits well-formed SARIF", () => {
  const r = run(["--sarif"], SPECIMEN);
  assert.equal(r.status, 0);
  const sarif = JSON.parse(r.stdout);
  assert.equal(sarif.version, "2.1.0");
  assert.ok(sarif.runs[0].results.length === 4);
});

test("--max gates CI: over threshold exits 1", () => {
  const r = run(["--max", "8", "--quiet"], SPECIMEN);
  assert.equal(r.status, 1, "specimen is ~22/100, over the limit of 8");
});

test("--max gates CI: clean text passes with exit 0", () => {
  const r = run(["--max", "8", "--quiet"], CLEAN);
  assert.equal(r.status, 0, "clean active text has 0 tells");
});

test("the human report names the density and the tells", () => {
  const r = run(["--no-color"], SPECIMEN);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /4 tells/);
  assert.match(r.stdout, /were made/);
});

test("--help and --version work", () => {
  assert.match(run(["--help"]).stdout, /read the subtext/);
  // Against the manifest, not a literal: a hardcoded version here silently
  // becomes a lie the moment the package is bumped, and blocks the bump.
  assert.equal(run(["--version"]).stdout.trim(), CLI_MANIFEST.version);
});

test("the CLI's dependency ranges can receive engine and rule-pack patches", () => {
  // cli@0.1.0 pinned core and rules-en EXACTLY, so `npm i @rhetorlint/cli`
  // kept installing the pre-trial engine after 0.1.2/0.1.1 shipped. A pack
  // that learns is the point of this tool; the CLI must be able to receive it.
  for (const dep of ["@rhetorlint/core", "@rhetorlint/rules-en"]) {
    assert.match(CLI_MANIFEST.dependencies[dep], /^\^/, `${dep} must be a caret range`);
  }
});

test("the coordinated packages require core 0.1.4, whose detector the agency note describes", () => {
  // rules-en 0.2.1's agency note names the accountable-passive detector of core
  // 0.1.4. On core 0.1.3 the same note would label the old detector's wider
  // marks ("Shipments are often delayed."), so the floor rises with the note.
  assert.equal(CLI_MANIFEST.dependencies["@rhetorlint/core"], "^0.1.4");
  assert.equal(RULES_MANIFEST.peerDependencies["@rhetorlint/core"], ">=0.1.4");
});

test("rules-en still parses on core 0.1.3: no pack key or engine floor that core lacks", () => {
  // The keys core 0.1.3 accepts (packages/core/index.mjs PACK_KEYS and
  // RULE_KEYS at 0.1.3), declared here so a new key that would make it reject
  // the whole pack fails. The floor above is about honest labels, not parsing.
  const PACK = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));
  const base = ["ruleId", "family", "technique", "type", "level", "confidence", "note", "expected"];
  const CORE_013 = {
    pack: ["id", "version", "locale", "note", "rules"],
    lexical: [...base, "terms"],
    pattern: [...base, "pattern", "caseSensitive", "minEngine"],
    structural: [...base, "detector"]
  };
  const extra = (keys, allowed) => keys.filter((key) => !allowed.includes(key));
  assert.deepEqual(extra(Object.keys(PACK), CORE_013.pack), []);
  for (const rule of PACK.rules) {
    assert.deepEqual(extra(Object.keys(rule), CORE_013[rule.type]), [], rule.ruleId);
    if (rule.minEngine !== undefined) {
      const [a, b, c] = rule.minEngine.split(".").map(Number);
      assert.ok(a === 0 && (b < 1 || (b === 1 && c <= 3)), `${rule.ruleId} needs core ${rule.minEngine}`);
    }
  }
  assert.ok(PACK.rules.some((rule) => rule.type === "structural" && rule.detector === "agentless-passive"),
    "the detector name core 0.1.3 knows is still the one the pack asks for");
});

test("the CLI's caret ranges actually reach the in-repo pack", () => {
  // ^0.1.2 does NOT admit 0.2.0: for 0.x, caret pins the minor. A range that
  // cannot resolve the pack in this repo re-creates the 2026-07-24 incident
  // in its minor-bump form — carets alone were not enough.
  const RULES_PACK = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));
  const range = CLI_MANIFEST.dependencies["@rhetorlint/rules-en"];
  const [maj, min, pat] = range.replace(/^\^/, "").split(".").map(Number);
  const [pMaj, pMin, pPat] = RULES_PACK.version.split(".").map(Number);
  assert.ok(
    maj === pMaj && min === pMin && pPat >= pat,
    `${range} cannot resolve rules-en@${RULES_PACK.version} — bump the CLI's range with the pack`
  );
});

test("no input is a usage error (exit 2)", () => {
  const r = run([], "");
  assert.equal(r.status, 2);
});

test("an unknown option is rejected", () => {
  assert.equal(run(["--wat"], "x").status, 2);
});
