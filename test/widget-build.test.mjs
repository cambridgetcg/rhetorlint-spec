import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BUILD = fileURLToPath(new URL("../apps/widget/build.mjs", import.meta.url));
const CONTENT = fileURLToPath(new URL("../apps/widget/content.js", import.meta.url));
const BOOKMARKLET = fileURLToPath(new URL("../apps/widget/bookmarklet.html", import.meta.url));

test("the committed widget artifacts are in sync with their sources (rebuild is a no-op)", () => {
  const contentBefore = readFileSync(CONTENT, "utf8");
  const bookmarkletBefore = readFileSync(BOOKMARKLET, "utf8");
  const r = spawnSync("node", [BUILD], { encoding: "utf8" });
  assert.equal(r.status, 0, "build should succeed: " + r.stderr);
  const contentAfter = readFileSync(CONTENT, "utf8");
  const bookmarkletAfter = readFileSync(BOOKMARKLET, "utf8");
  assert.equal(contentAfter, contentBefore, "content.js is stale — run `node apps/widget/build.mjs` and commit");
  assert.equal(bookmarkletAfter, bookmarkletBefore, "bookmarklet.html is stale — run `node apps/widget/build.mjs` and commit");
});

test("the generated content.js embeds the real engine and rules", () => {
  const src = readFileSync(CONTENT, "utf8");
  assert.match(src, /function analyze\b/, "engine inlined");
  assert.match(src, /const RULES =/, "rules inlined");
  assert.match(src, /agency-hiding\.deleted-subject/, "the structural tell is present");
  assert.match(src, /Obfuscation, Intentional Vagueness/, "synced to the current rule labels");
  assert.match(src, /e\.key === "R" \|\| e\.key === "r"/, "the advertised Alt+Shift+R hotkey is wired");
  assert.doesNotMatch(src, /captione[e]r/i, "the retired brand is absent");
  assert.doesNotMatch(src, /\bexport\s/, "no stray ES export keyword survived inlining");
});
