#!/usr/bin/env node
/**
 * captioneer — read the subtext from the command line.
 *
 * Marks rhetorical tells in text files or stdin, on-device, zero deps.
 * Emits a human report, the Captioneer JSON, or SARIF; can gate CI on a
 * spin-density threshold. It reads the words, never the person.
 *
 *   captioneer statement.txt
 *   captioneer --json < speech.md
 *   captioneer --sarif press-release.txt > captioneer.sarif
 *   captioneer --max 8 comms/*.md        # exit 1 if any file exceeds 8 tells/100 words
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const VERSION = "0.1.0";

/* Load dependencies so the CLI works BOTH published (bare specifiers resolve
   to the installed @captioneer packages) AND from a raw checkout with no
   install (fall back to the sibling packages). No pre-publish edit needed. */
async function loadCore() {
  try { return await import("@captioneer/core"); }
  catch { return await import("../core/index.mjs"); }
}
async function loadSarif() {
  try { return await import("@captioneer/core/sarif"); }
  catch { return await import("../core/sarif.mjs"); }
}
function loadDefaultRules() {
  try { return createRequire(import.meta.url)("@captioneer/rules-en"); }
  catch { return JSON.parse(readFileSync(new URL("../rules-en/rules.json", import.meta.url))); }
}

const HELP = `captioneer ${VERSION} — read the subtext

Usage:
  captioneer [options] [files...]        analyze files, or stdin if none

Options:
  --json            emit the Captioneer JSON result
  --sarif           emit SARIF 2.1.0 (for editors / CI / code-scanning)
  --max <n>         exit 1 if tells-per-100-words exceeds n (a CI spin-gate)
  --rules <path>    use a custom rule pack instead of @captioneer/rules-en
  --quiet           suppress the human report (useful with --max)
  --no-color        disable ANSI color
  -v, --version     print version
  -h, --help        print this help

It marks manipulation in the words. It does not read the person, detect lies,
or judge whether a claim is factually true.`;

function parseArgs(argv) {
  const o = { files: [], json: false, sarif: false, max: null, rules: null, quiet: false, color: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") o.json = true;
    else if (a === "--sarif") o.sarif = true;
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--no-color") o.color = false;
    else if (a === "--max") o.max = Number(argv[++i]);
    else if (a === "--rules") o.rules = argv[++i];
    else if (a === "-v" || a === "--version") o.version = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("-")) { o.error = `unknown option: ${a}`; }
    else o.files.push(a);
  }
  return o;
}

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

const C = (on) => on
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
      mark: (s) => `\x1b[43m\x1b[30m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`,
      cyan: (s) => `\x1b[36m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m` }
  : new Proxy({}, { get: () => (s) => s });

function report(name, result, c) {
  const d = result.density;
  const band = d.per100Words >= 15 ? c.red : d.per100Words >= 6 ? c.cyan : c.green;
  const lines = [];
  lines.push("");
  lines.push(c.bold(name));
  lines.push(`  ${band(d.tells + " tells")} ${c.dim("/")} ${result.source.words} words ${c.dim("=")} ${band(d.per100Words + " per 100")}`);
  if (result.marks.length) lines.push("");
  for (const m of result.marks) {
    lines.push(`  ${c.mark(" " + m.actual + " ")}  ${c.dim(m.ruleId)}`);
    lines.push(`    ${c.dim(m.note)}`);
  }
  return lines.join("\n");
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { process.stdout.write(HELP + "\n"); return 0; }
  if (o.version) { process.stdout.write(VERSION + "\n"); return 0; }
  if (o.error) { process.stderr.write(o.error + "\n\n" + HELP + "\n"); return 2; }

  let rules;
  try {
    rules = o.rules ? JSON.parse(readFileSync(o.rules)) : loadDefaultRules();
  } catch (e) {
    process.stderr.write(`could not load rules: ${e.message}\n`);
    return 2;
  }

  const inputs = o.files.length
    ? o.files.map((f) => { try { return { name: f, text: readFileSync(f, "utf8") }; }
        catch (e) { process.stderr.write(`skipping ${f}: ${e.message}\n`); return null; } }).filter(Boolean)
    : [{ name: "(stdin)", text: readStdin() }];

  if (!inputs.length || inputs.every((i) => !i.text.trim())) {
    process.stderr.write("no input. Pass files or pipe text on stdin. Try --help.\n");
    return 2;
  }

  const { analyze } = await loadCore();
  const { toSarif } = await loadSarif();

  const c = C(o.color && process.stdout.isTTY && !o.json && !o.sarif);
  const results = inputs.map((i) => ({ name: i.name, result: analyze(i.text, { rules }) }));

  if (o.json) {
    const payload = results.length === 1 ? results[0].result
      : results.map((r) => ({ file: r.name, ...r.result }));
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else if (o.sarif) {
    // One SARIF run per file, merged into one log.
    const runs = results.flatMap((r) => toSarif(r.result).runs);
    process.stdout.write(JSON.stringify({ version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs }, null, 2) + "\n");
  } else if (!o.quiet) {
    process.stdout.write(results.map((r) => report(r.name, r.result, c)).join("\n") + "\n");
  }

  // CI gate: fail if any file is too thick with spin.
  if (o.max != null && Number.isFinite(o.max)) {
    const over = results.filter((r) => r.result.density.per100Words > o.max);
    if (over.length) {
      if (!o.json && !o.sarif) {
        process.stderr.write(`\n${over.length} file(s) over ${o.max} tells/100 words:\n`);
        for (const r of over) process.stderr.write(`  ${r.name}: ${r.result.density.per100Words}\n`);
      }
      return 1;
    }
  }
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  process.stderr.write(String(e && e.stack || e) + "\n");
  process.exit(2);
});
