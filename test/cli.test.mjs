import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate } from "./helpers/schema-validator.mjs";

const CLI = fileURLToPath(new URL("../packages/cli/cli.mjs", import.meta.url));
const CLI_MANIFEST = JSON.parse(readFileSync(new URL("../packages/cli/package.json", import.meta.url)));
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
