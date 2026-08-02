import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const explorerUrl = new URL("apps/explorer/index.html", root);
const rulesUrl = new URL("packages/rules-en/rules.json", root);
const startMarker = "  /* BEGIN GENERATED EXPLORER RULES */";
const endMarker = "  /* END GENERATED EXPLORER RULES */";

const source = readFileSync(explorerUrl, "utf8");
const rules = JSON.parse(readFileSync(rulesUrl, "utf8"));
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);

if (start < 0 || end < 0 || end <= start) {
  throw new Error("explorer rule-pack generation markers are missing or out of order");
}

const json = JSON.stringify(rules, null, 2)
  .split("\n")
  .map((line) => "  " + line)
  .join("\n");
const generated = `${startMarker}\n  const RULES = ${json.trimStart()};\n${endMarker}`;
const next =
  source.slice(0, start) +
  generated +
  source.slice(end + endMarker.length);

writeFileSync(explorerUrl, next);
console.log(`updated explorer with ${rules.rules.length} rules from ${rules.id}@${rules.version}`);
