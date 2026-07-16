/* A 20-line taste of the spec. Run: node scripts/demo.mjs  (or: npm run demo) */
import { readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";
import { toSarif } from "../packages/core/sarif.mjs";

const rules = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));

const text =
  "We take your privacy extremely seriously, and regrettably, mistakes were made. " +
  "We are reaching out to affected users.";

const r = analyze(text, { rules });

console.log("\n  " + text + "\n");
console.log("  density:", r.density.tells, "tells /", r.source.words, "words =", r.density.per100Words, "per 100 words\n");
for (const m of r.marks) {
  console.log(`  · [${m.family}]  "${m.actual}"`);
  console.log(`      ${m.note}`);
}
console.log("\n  strip (deterministic, on-device):");
console.log("  " + r.strip + "\n");
console.log("  SARIF export:", toSarif(r).runs[0].results.length, "results\n");
