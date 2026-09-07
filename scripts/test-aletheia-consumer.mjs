import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const USAGE = "Usage: npm run test:aletheia-consumer -- --aletheia <checkout> --core-tarball <core.tgz>";
const CORE = JSON.parse(readFileSync(new URL("../packages/core/package.json", import.meta.url), "utf8"));
const BASELINE_CORE = "0.1.2";
const RULES_VERSION = "0.1.2";
const METADATA = ["package.json", "package-lock.json"];

const CASES = [
  {
    text: "He allegedly stole it. The report names no witnesses, and investigators have not announced any findings about this disputed allegation.",
    qualifier: "allegedly"
  },
  {
    text: "The outage reportedly affected users. The operator is still reviewing the logs and has not confirmed the cause or the full extent.",
    qualifier: "reportedly"
  },
  {
    text: "The server may have failed. The operator is still reviewing the logs and has not confirmed the cause or the full extent.",
    qualifier: "may have failed"
  },
  {
    text: "He allegedly made extremely serious errors. The reviewers have not reached a conclusion, and the investigation continues with no final findings.",
    qualifier: "allegedly",
    strip: "He allegedly made serious errors. The reviewers have not reached a conclusion, and the investigation continues with no final findings."
  }
];

function regularFile(path) {
  assert.ok(lstatSync(path).isFile(), `expected a regular file: ${path}`);
  return readFileSync(path);
}

export function copyConsumer(source, destination) {
  for (const name of [...METADATA, "feeds.json", "src", "test"]) {
    cpSync(join(source, name), join(destination, name), {
      recursive: true,
      dereference: false,
      filter(path) {
        const name = basename(path);
        if (name.startsWith(".") || name === "node_modules") return false;
        const stat = lstatSync(path);
        assert.ok(!stat.isSymbolicLink(), `consumer copy refuses symlinks: ${path}`);
        assert.ok(stat.isFile() || stat.isDirectory(), `unsupported consumer file: ${path}`);
        return true;
      }
    });
  }
}

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    timeout: 120_000,
    maxBuffer: 1_000_000,
    env: { ...process.env, npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false" }
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed (${result.signal || result.status})${capture ? `: ${result.stderr}` : ""}`);
  return result.stdout;
}

// This executes ordinary consumer imports from the disposable copy, not workspace source.
const PROBE = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { lintText } from "./src/lint.mjs";
import { lintArticle } from "./src/pulse.mjs";
const require = createRequire(import.meta.url);
const [phase, coreVersion, rulesVersion, serializedCases] = process.argv.slice(1);
const installedCore = JSON.parse(readFileSync(join(dirname(require.resolve("@rhetorlint/core")), "package.json"), "utf8"));
const rules = require("@rhetorlint/rules-en");
assert.equal(installedCore.name, "@rhetorlint/core");
assert.equal(installedCore.version, coreVersion);
assert.equal(rules.version, rulesVersion);
const cases = JSON.parse(serializedCases);
for (const fixture of phase === "baseline" ? cases.slice(0, 1) : cases) {
  assert.ok(fixture.text.split(/\\s+/).length >= 20);
  assert.ok(fixture.text.length < 1200);
  const lint = lintText(fixture.text);
  const article = await lintArticle({ text: fixture.text });
  const hedge = lint.marks.find(mark => mark.ruleId === "hedge.deniable" && mark.actual === fixture.qualifier);
  assert.ok(hedge, "preservation must retain the original hedge annotation");
  assert.equal(fixture.text.slice(hedge.position.start.offset, hedge.position.end.offset), fixture.qualifier);
  assert.ok(article.marks.some(mark => mark.ruleId === "hedge.deniable" && mark.quote === fixture.qualifier));
  const expected = phase === "baseline" ? fixture.text.replace("allegedly ", "") : (fixture.strip ?? fixture.text);
  assert.equal(lint.strip, expected);
  assert.equal(article.stripPreview, expected);
  if (phase === "candidate" && fixture.strip) {
    assert.ok(lint.marks.some(mark => mark.ruleId === "intensifier.loaded"));
  }
}
console.log(JSON.stringify({ phase, core: installedCore.version, rules: rules.version, cases: phase === "baseline" ? 1 : cases.length, result: phase === "baseline" ? "known meaning loss reproduced" : "meaning preserved; annotations retained" }));
`;

function installedDependencies(directory) {
  const lock = JSON.parse(readFileSync(join(directory, "node_modules", ".package-lock.json"), "utf8"));
  assert.ok(lock.packages, "npm must provide an installed dependency snapshot");
  return Object.fromEntries(Object.entries(lock.packages)
    .filter(([path]) => path !== "node_modules/@rhetorlint/core")
    .map(([path, pkg]) => [path, { version: pkg.version, integrity: pkg.integrity }]));
}

export function checkConsumer(source, tarball) {
  const original = METADATA.map(name => regularFile(join(source, name)));
  const manifest = JSON.parse(original[0]);
  const lock = JSON.parse(original[1]);
  assert.equal(manifest.name, "@agenttool/aletheia", "expected an Aletheia checkout");
  assert.equal(lock.packages?.["node_modules/@rhetorlint/core"]?.version, BASELINE_CORE, "negative control needs locked core 0.1.2");
  assert.equal(lock.packages?.["node_modules/@rhetorlint/rules-en"]?.version, RULES_VERSION, "consumer check uses published rules 0.1.2");
  const artifact = regularFile(tarball);
  const packed = JSON.parse(run("tar", ["-xOf", tarball, "package/package.json"], source, true));
  assert.equal(packed.name, CORE.name, "tarball must contain @rhetorlint/core");
  assert.equal(packed.version, CORE.version, "tarball must match the reviewed workspace version");
  const digest = createHash("sha256").update(artifact).digest("hex");

  const temporary = mkdtempSync(join(tmpdir(), "rhetorlint-aletheia-"));
  try {
    copyConsumer(source, temporary);
    run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], temporary);
    const dependencies = installedDependencies(temporary);
    run(process.execPath, ["--input-type=module", "-e", PROBE, "baseline", BASELINE_CORE, RULES_VERSION, JSON.stringify(CASES)], temporary);
    // --no-save prevents metadata writes; keep lock reading on to avoid upgrading other packages.
    run("npm", ["install", tarball, "--no-save", "--package-lock=true", "--ignore-scripts", "--no-audit", "--no-fund"], temporary);
    assert.deepEqual(installedDependencies(temporary), dependencies, "only the core dependency may change");
    for (const [index, name] of METADATA.entries()) {
      assert.deepEqual(regularFile(join(temporary, name)), original[index], `${name} must not acquire a local tarball dependency`);
    }
    run(process.execPath, ["--input-type=module", "-e", PROBE, "candidate", CORE.version, RULES_VERSION, JSON.stringify(CASES)], temporary);
    run("npm", ["--ignore-scripts", "test"], temporary);
    for (const [index, name] of METADATA.entries()) {
      assert.deepEqual(regularFile(join(source, name)), original[index], `source ${name} changed during the check`);
      assert.deepEqual(regularFile(join(temporary, name)), original[index], `test changed ${name}`);
    }
    console.log(JSON.stringify({ artifact: basename(tarball), sha256: digest, core: CORE.version, rules: RULES_VERSION, result: "packed consumer check passed" }));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function main() {
  const { values } = parseArgs({ options: {
    aletheia: { type: "string" },
    "core-tarball": { type: "string" },
    help: { type: "boolean" }
  } });
  if (values.help) return console.log(USAGE);
  assert.ok(values.aletheia && values["core-tarball"], USAGE);
  checkConsumer(resolve(values.aletheia), resolve(values["core-tarball"]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
