import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BUILD = fileURLToPath(new URL("../apps/widget/build.mjs", import.meta.url));
const CONTENT = fileURLToPath(new URL("../apps/widget/content.js", import.meta.url));

test("the committed widget content.js is in sync with the engine (rebuild is a no-op)", () => {
  const before = readFileSync(CONTENT, "utf8");
  const r = spawnSync("node", [BUILD], { encoding: "utf8" });
  assert.equal(r.status, 0, "build should succeed: " + r.stderr);
  const after = readFileSync(CONTENT, "utf8");
  assert.equal(after, before, "content.js is stale — run `node apps/widget/build.mjs` and commit");
});

test("the generated content.js embeds the real engine and rules", () => {
  const src = readFileSync(CONTENT, "utf8");
  assert.match(src, /function analyze\b/, "engine inlined");
  assert.match(src, /const RULES =/, "rules inlined");
  assert.match(src, /agency-hiding\.deleted-subject/, "the structural tell is present");
  assert.match(src, /Obfuscation, Intentional Vagueness/, "synced to the current rule labels");
  assert.doesNotMatch(src, /\bexport\s/, "no stray ES export keyword survived inlining");
});
