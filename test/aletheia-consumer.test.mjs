import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkConsumer, copyConsumer } from "../scripts/test-aletheia-consumer.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/test-aletheia-consumer.mjs", import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "rhetorlint-consumer-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const destination = join(root, "copy");
  mkdirSync(join(source, "src"), { recursive: true });
  mkdirSync(join(source, "test"));
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "@agenttool/aletheia" }));
  writeFileSync(join(source, "package-lock.json"), JSON.stringify({ packages: {
    "node_modules/@rhetorlint/core": { version: "0.1.2" },
    "node_modules/@rhetorlint/rules-en": { version: "0.1.2" }
  } }));
  writeFileSync(join(source, "feeds.json"), JSON.stringify({ feeds: [] }));
  writeFileSync(join(source, "src", "lint.mjs"), "export const fixture = true;\n");
  writeFileSync(join(source, "test", "unit.test.mjs"), "// fixture test\n");
  return { source, destination };
}

test("consumer check help and missing arguments do not launch an install", () => {
  const help = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--aletheia <checkout> --core-tarball <core.tgz>/);
  const missing = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Usage:/);
});

test("consumer copy includes source and tests without private state or dependencies", t => {
  const { source, destination } = fixture(t);
  writeFileSync(join(source, ".env"), "not-a-credential\n");
  writeFileSync(join(source, "src", ".private"), "private fixture\n");
  mkdirSync(join(source, "node_modules"));
  writeFileSync(join(source, "node_modules", "fixture"), "installed fixture\n");
  copyConsumer(source, destination);
  assert.equal(readFileSync(join(destination, "src", "lint.mjs"), "utf8"), "export const fixture = true;\n");
  assert.ok(existsSync(join(destination, "test", "unit.test.mjs")));
  assert.ok(existsSync(join(destination, "package-lock.json")));
  assert.ok(existsSync(join(destination, "feeds.json")));
  assert.ok(!existsSync(join(destination, ".env")));
  assert.ok(!existsSync(join(destination, "src", ".private")));
  assert.ok(!existsSync(join(destination, "node_modules")));
});

test("consumer copy rejects symlinked source rather than resolving live dependencies", t => {
  const { source, destination } = fixture(t);
  symlinkSync(join(source, "src", "lint.mjs"), join(source, "src", "alias.mjs"));
  assert.throws(() => copyConsumer(source, destination), /refuses symlinks/);
});

test("consumer check rejects a changed negative control before reading a tarball", t => {
  const { source } = fixture(t);
  writeFileSync(join(source, "package-lock.json"), JSON.stringify({ packages: {
    "node_modules/@rhetorlint/core": { version: "0.1.3" }
  } }));
  assert.throws(() => checkConsumer(source, join(source, "missing.tgz")), /negative control needs locked core 0.1.2/);
});

test("consumer check rejects a different project before reading a tarball", t => {
  const { source } = fixture(t);
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "different-project" }));
  assert.throws(() => checkConsumer(source, join(source, "missing.tgz")), /expected an Aletheia checkout/);
});
