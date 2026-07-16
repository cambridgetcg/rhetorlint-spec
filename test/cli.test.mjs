import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../packages/cli/cli.mjs", import.meta.url));
const SPECIMEN =
  "We take your privacy extremely seriously, and regrettably, mistakes were made. " +
  "We are reaching out to affected users.";
const CLEAN = "I made a mistake and I will fix it by Friday.";

function run(args, input) {
  return spawnSync("node", [CLI, ...args], { input, encoding: "utf8" });
}

test("stdin + --json emits a valid Captioneer result", () => {
  const r = run(["--json"], SPECIMEN);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.captioneer, "0.1");
  assert.equal(out.density.tells, 4);
  assert.ok(out.marks.some((m) => m.ruleId === "agency-hiding.deleted-subject"));
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
  assert.match(run(["--version"]).stdout, /0\.1\.0/);
});

test("no input is a usage error (exit 2)", () => {
  const r = run([], "");
  assert.equal(r.status, 2);
});

test("an unknown option is rejected", () => {
  assert.equal(run(["--wat"], "x").status, 2);
});
