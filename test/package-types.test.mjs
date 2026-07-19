import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const CORE_ROOT = new URL("../packages/core/", import.meta.url);
const CORE_PACKAGE = JSON.parse(
  readFileSync(new URL("package.json", CORE_ROOT), "utf8")
);

test("every public core export has a shipped type entrypoint", () => {
  for (const [subpath, entry] of Object.entries(CORE_PACKAGE.exports)) {
    assert.equal(typeof entry.types, "string", `${subpath} must declare a types entrypoint`);
    assert.ok(
      existsSync(new URL(entry.types, CORE_ROOT)),
      `${subpath} types entrypoint ${entry.types} must be included in the package`
    );
    assert.ok(
      CORE_PACKAGE.files.includes(entry.types.replace(/^\.\//, "")),
      `${subpath} types entrypoint ${entry.types} must be listed in files`
    );
  }
});

test("subpath declarations use the consumer-resolvable self-package import", () => {
  for (const subpath of ["./sarif", "./signals"]) {
    const declarationPath = CORE_PACKAGE.exports[subpath].types;
    const declaration = readFileSync(new URL(declarationPath, CORE_ROOT), "utf8");
    assert.match(declaration, /from "@rhetorlint\/core"/);
    assert.doesNotMatch(
      declaration,
      /from "\.\/index\.mjs"/,
      `${declarationPath} must not use a relative .mjs import: NodeNext looks for index.d.mts`
    );
  }
});
