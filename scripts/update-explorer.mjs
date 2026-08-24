import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const explorerUrl = new URL("apps/explorer/index.html", root);

function replaceGenerated(source, name, body) {
  const startMarker = `  /* BEGIN GENERATED EXPLORER ${name} */`;
  const endMarker = `  /* END GENERATED EXPLORER ${name} */`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`explorer ${name.toLowerCase()} markers are missing or out of order`);
  }
  return source.slice(0, start) +
    `${startMarker}\n${body}\n${endMarker}` +
    source.slice(end + endMarker.length);
}

function indent(value) {
  return value
    .trimEnd()
    .split("\n")
    .map((line) => line.length === 0 ? "" : `  ${line}`)
    .join("\n");
}

let explorer = readFileSync(explorerUrl, "utf8");
const rules = JSON.parse(
  readFileSync(new URL("packages/rules-en/rules.json", root), "utf8")
);
const rulesBody = indent(`const RULES = ${JSON.stringify(rules, null, 2)};`);

const engine = readFileSync(new URL("packages/core/index.mjs", root), "utf8")
  .replace(/^export\s+/gm, "");
const engineBody = indent(engine);

explorer = replaceGenerated(explorer, "RULES", rulesBody);
explorer = replaceGenerated(explorer, "ENGINE", engineBody);
writeFileSync(explorerUrl, explorer);

console.log(
  `updated explorer from ${rules.id}@${rules.version} and packages/core/index.mjs`
);
