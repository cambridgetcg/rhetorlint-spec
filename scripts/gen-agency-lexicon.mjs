#!/usr/bin/env node
// Write spec/agency-lexicon.json into the three engines. Zero dependencies.
//
// The accountable-passive detector (agency-hiding.deleted-subject) reads closed
// word lists: auxiliaries, adverbs, the head-word skip list, the participle
// classes and their head nouns. Copied by hand into JavaScript, Python and Go,
// three lists drift; generated from one file, they cannot drift unseen. Each
// engine holds the lists between two marker lines:
//
//   // BEGIN GENERATED AGENCY LEXICON      (# in Python)
//   ...
//   // END GENERATED AGENCY LEXICON
//
//   node scripts/gen-agency-lexicon.mjs            rewrite the three blocks
//   node scripts/gen-agency-lexicon.mjs --check    exit 1 if any block differs from the lexicon
//   ... --root <dir>                               read and write another checkout (tests use it)
//
// The module also exports lexiconProbes(): one sentence per participle that the
// detector must mark, and one with a 'by' agent that it must not. The three-engine
// differential (scripts/xengine-diff.mjs) takes them as inputs.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LEXICON = "spec/agency-lexicon.json";
export const BEGIN = "BEGIN GENERATED AGENCY LEXICON";
export const END = "END GENERATED AGENCY LEXICON";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WIDTH = 100;

const WORD = /^[a-z]+$/;
const PHRASE = /^[a-z]+(?: [a-z]+)*$/;

/** Every rule the lexicon must keep that JSON alone cannot express. */
export function lexiconProblems(lex) {
  const problems = [];
  const say = (message) => problems.push(message);
  const words = (list, where, pattern = WORD) => {
    if (!Array.isArray(list) || list.length === 0) return say(`${where}: must be a non-empty array`);
    for (const w of list) if (typeof w !== "string" || !pattern.test(w)) say(`${where}: ${JSON.stringify(w)} is not lowercase ASCII`);
    const sorted = [...list].sort();
    if (JSON.stringify(sorted) !== JSON.stringify(list)) say(`${where}: must be sorted`);
    if (new Set(list).size !== list.length) say(`${where}: has duplicates`);
  };
  const count = (value, where) => {
    if (!Number.isInteger(value) || value < 1) say(`${where}: must be a positive integer`);
  };
  count(lex.version, "version");
  words(lex.auxiliaries, "auxiliaries");
  words(lex.adverbs, "adverbs");
  words(lex.skip, "skip");
  for (const key of ["adverbSuffix", "skipSuffix"]) {
    if (typeof lex[key] !== "string" || !WORD.test(lex[key])) say(`${key}: must be lowercase ASCII`);
  }
  count(lex.skipMax, "skipMax");
  count(lex.byWindow, "byWindow");
  if (!lex.heads || typeof lex.heads !== "object") say("heads: must be an object");
  for (const [name, list] of Object.entries(lex.heads || {})) {
    if (!WORD.test(name)) say(`heads: class name ${JSON.stringify(name)} is not lowercase ASCII`);
    words(list, `heads.${name}`);
  }
  const seen = new Map();
  for (const [i, c] of (lex.classes || []).entries()) {
    const where = `classes[${i}]`;
    if (typeof c.id !== "string" || !WORD.test(c.id)) say(`${where}: id must be lowercase ASCII`);
    if (c.head !== null && !Object.hasOwn(lex.heads || {}, c.head)) say(`${where}: head ${JSON.stringify(c.head)} is not a class in heads`);
    if (typeof c.why !== "string" || !c.why.trim()) say(`${where}: needs a why`);
    words(c.participles, `${where}.participles`, PHRASE);
    for (const p of c.participles || []) {
      if (seen.has(p)) say(`participle ${JSON.stringify(p)} is in both ${seen.get(p)} and ${c.id}`);
      seen.set(p, c.id);
    }
  }
  if (!seen.size) say("classes: must name at least one participle");
  for (const key of ["requires", "unless"]) {
    for (const [p, phrase] of Object.entries(lex[key] || {})) {
      if (!seen.has(p)) say(`${key}.${p}: is not a participle`);
      if (typeof phrase !== "string" || !PHRASE.test(phrase)) say(`${key}.${p}: must be lowercase ASCII words`);
    }
  }
  const used = new Set([...lex.auxiliaries || [], ...seen.keys()]);
  for (const [i, group] of (lex.excluded || []).entries()) {
    words(group.words, `excluded[${i}].words`);
    if (typeof group.why !== "string" || !group.why.trim()) say(`excluded[${i}]: needs a why`);
    for (const w of group.words || []) if (used.has(w)) say(`excluded[${i}]: ${JSON.stringify(w)} is excluded but also listed`);
  }
  return problems;
}

export function loadLexicon(root = ROOT) {
  const lex = JSON.parse(readFileSync(join(root, LEXICON), "utf8"));
  const problems = lexiconProblems(lex);
  if (problems.length) throw new Error(`${LEXICON} is invalid:\n  ${problems.join("\n  ")}`);
  return lex;
}

// ---- rendering ---------------------------------------------------------------

const q = (s) => JSON.stringify(s);

/** Items joined by ", " and wrapped at WIDTH, each line indented by `pad`. */
function wrap(items, pad) {
  const lines = [];
  let line = "";
  for (const item of items) {
    const next = line ? `${line}, ${item}` : item;
    if (line && pad.length + next.length + 1 > WIDTH) {
      lines.push(`${pad}${line},`);
      line = item;
    } else line = next;
  }
  if (line) lines.push(`${pad}${line}`);
  return lines.join("\n");
}

const header = (c, lex) => [
  `${c} ${BEGIN}`,
  `${c} ${LEXICON} version ${lex.version}, written by scripts/gen-agency-lexicon.mjs.`,
  `${c} Edit the lexicon and rerun the generator; --check fails when this block drifts.`
];

function renderJs(lex) {
  const set = (items) => `new Set([\n${wrap(items.map(q), "  ")}\n])`;
  return [
    ...header("//", lex),
    `const AGENCY_AUXILIARIES = [${lex.auxiliaries.map(q).join(", ")}];`,
    `const AGENCY_ADVERBS = [${lex.adverbs.map(q).join(", ")}];`,
    `const AGENCY_ADVERB_SUFFIX = ${q(lex.adverbSuffix)};`,
    `const AGENCY_SKIP = ${set(lex.skip)};`,
    `const AGENCY_SKIP_SUFFIX = ${q(lex.skipSuffix)};`,
    `const AGENCY_SKIP_MAX = ${lex.skipMax};`,
    `const AGENCY_BY_WINDOW = ${lex.byWindow};`,
    "const AGENCY_HEADS = new Map([",
    Object.keys(lex.heads).sort().map((name) =>
      `  [${q(name)}, new Set([\n${wrap(lex.heads[name].map(q), "    ")}\n  ])]`).join(",\n"),
    "]);",
    "/** [class, head class or \"\" for none, participles]. */",
    "const AGENCY_CLASSES = [",
    lex.classes.map((c) =>
      `  [${q(c.id)}, ${q(c.head ?? "")}, [\n${wrap(c.participles.map(q), "    ")}\n  ]]`).join(",\n"),
    "];",
    `const AGENCY_REQUIRES = new Map([${Object.entries(lex.requires).map(([k, v]) => `[${q(k)}, ${q(v)}]`).join(", ")}]);`,
    `const AGENCY_UNLESS = new Map([${Object.entries(lex.unless).map(([k, v]) => `[${q(k)}, ${q(v)}]`).join(", ")}]);`,
    `// ${END}`
  ].join("\n");
}

function renderPython(lex) {
  const set = (items, pad) => `frozenset({\n${wrap(items.map(q), pad + "    ")}\n${pad}})`;
  const map = (obj) => `{${Object.entries(obj).map(([k, v]) => `${q(k)}: ${q(v)}`).join(", ")}}`;
  return [
    ...header("#", lex),
    `AGENCY_AUXILIARIES = (${lex.auxiliaries.map(q).join(", ")})`,
    `AGENCY_ADVERBS = (${lex.adverbs.map(q).join(", ")})`,
    `AGENCY_ADVERB_SUFFIX = ${q(lex.adverbSuffix)}`,
    `AGENCY_SKIP = ${set(lex.skip, "")}`,
    `AGENCY_SKIP_SUFFIX = ${q(lex.skipSuffix)}`,
    `AGENCY_SKIP_MAX = ${lex.skipMax}`,
    `AGENCY_BY_WINDOW = ${lex.byWindow}`,
    "AGENCY_HEADS = {",
    Object.keys(lex.heads).sort().map((name) => `    ${q(name)}: ${set(lex.heads[name], "    ")},`).join("\n"),
    "}",
    "# (class, head class or \"\" for none, participles)",
    "AGENCY_CLASSES = (",
    lex.classes.map((c) =>
      `    (${q(c.id)}, ${q(c.head ?? "")}, (\n${wrap(c.participles.map(q), "        ")},\n    )),`).join("\n"),
    ")",
    `AGENCY_REQUIRES = ${map(lex.requires)}`,
    `AGENCY_UNLESS = ${map(lex.unless)}`,
    `# ${END}`
  ].join("\n");
}

function renderGo(lex) {
  const set = (items, pad) => `map[string]bool{\n${wrap(items.map((w) => `${q(w)}: true`), pad + "\t")},\n${pad}}`;
  const map = (obj) => `map[string]string{${Object.entries(obj).map(([k, v]) => `${q(k)}: ${q(v)}`).join(", ")}}`;
  return [
    ...header("//", lex),
    `var agencyAuxiliaries = []string{${lex.auxiliaries.map(q).join(", ")}}`,
    `var agencyAdverbs = []string{${lex.adverbs.map(q).join(", ")}}`,
    "",
    `const agencyAdverbSuffix = ${q(lex.adverbSuffix)}`,
    "",
    `var agencySkip = ${set(lex.skip, "")}`,
    "",
    `const agencySkipSuffix = ${q(lex.skipSuffix)}`,
    `const agencySkipMax = ${lex.skipMax}`,
    `const agencyByWindow = ${lex.byWindow}`,
    "",
    "var agencyHeads = map[string]map[string]bool{",
    Object.keys(lex.heads).sort().map((name) => `\t${q(name)}: ${set(lex.heads[name], "\t")},`).join("\n"),
    "}",
    "",
    "// agencyClasses holds {class, head class or \"\" for none, participles}.",
    "var agencyClasses = []agencyClass{",
    lex.classes.map((c) =>
      `\t{${q(c.id)}, ${q(c.head ?? "")}, []string{\n${wrap(c.participles.map(q), "\t\t")},\n\t}},`).join("\n"),
    "}",
    "",
    `var agencyRequires = ${map(lex.requires)}`,
    `var agencyUnless = ${map(lex.unless)}`,
    "",
    `// ${END}`
  ].join("\n");
}

export const TARGETS = [
  { path: "packages/core/index.mjs", comment: "//", render: renderJs },
  { path: "impl/python/rhetorlint.py", comment: "#", render: renderPython },
  { path: "impl/go/rhetorlint.go", comment: "//", render: renderGo }
];

/** The source with its generated block replaced, or an error naming what is wrong. */
export function spliceBlock(source, target, block) {
  const begin = `${target.comment} ${BEGIN}`;
  const end = `${target.comment} ${END}`;
  const at = source.indexOf(begin);
  const until = source.indexOf(end);
  if (at < 0 || until < 0 || until < at) throw new Error(`${target.path}: the ${BEGIN} / ${END} markers are missing or out of order`);
  if (source.indexOf(begin, at + 1) >= 0 || source.indexOf(end, until + 1) >= 0) {
    throw new Error(`${target.path}: the generated-block markers appear more than once`);
  }
  return source.slice(0, at) + block + source.slice(until + end.length);
}

/** Each target whose block differs from the lexicon, as messages. */
export function drift(root = ROOT, lex = loadLexicon(root)) {
  const out = [];
  for (const target of TARGETS) {
    const source = readFileSync(join(root, target.path), "utf8");
    try {
      if (spliceBlock(source, target, target.render(lex)) !== source) {
        out.push(`${target.path}: its generated agency lexicon differs from ${LEXICON}; run node scripts/gen-agency-lexicon.mjs`);
      }
    } catch (error) {
      out.push(error.message);
    }
  }
  return out;
}

// ---- differential probes -----------------------------------------------------

const PROBE_FRAME = {
  "": (p) => `The files were ${p}.`,
  challenge: (p) => `Concerns were ${p}.`,
  error: (p) => `Steps were ${p}.`,
  data: (p) => `Your data was ${p}.`,
  dummy: (p) => `It was ${p} that the plan would end.`
};

/**
 * Two sentences per participle, as [id, text, expected agency span or null]:
 * one the detector must mark, and the same with 'by the board' after the
 * participle, which it must not. A participle's `requires` phrase is spelt out.
 */
export function lexiconProbes(lex = loadLexicon()) {
  const out = [];
  for (const c of lex.classes) {
    const frame = PROBE_FRAME[c.head ?? ""];
    if (!frame) throw new Error(`no probe frame for head class ${c.head}`);
    for (const p of c.participles) {
      const word = lex.requires[p] ? `${p} ${lex.requires[p]}` : p;
      const marked = frame(word);
      const be = marked.match(/\b(?:was|were) /)[0];
      out.push([`lexicon:${p.replace(/ /g, "-")}`, marked, be + p]);
      out.push([`lexicon:${p.replace(/ /g, "-")}:by`, frame(`${word} by the board`), null]);
    }
  }
  return out;
}

// ---- command line ------------------------------------------------------------

function main(argv) {
  const rootAt = argv.indexOf("--root");
  const root = rootAt >= 0 ? resolve(argv[rootAt + 1] ?? "") : ROOT;
  const flags = argv.filter((a, i) => a.startsWith("--") && a !== "--root" && argv[i - 1] !== "--root");
  if (rootAt >= 0 && !argv[rootAt + 1]) return usage();
  if (flags.some((f) => f !== "--check") || argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--root").length) return usage();
  const lex = loadLexicon(root);
  if (flags.includes("--check")) {
    const problems = drift(root, lex);
    if (problems.length) {
      console.error(`agency lexicon: DRIFT (${problems.length})\n` + problems.map((p) => `- ${p}`).join("\n"));
      return 1;
    }
    console.log(`agency lexicon: ${TARGETS.length} engines match ${LEXICON} version ${lex.version}`);
    return 0;
  }
  // Splice every engine before writing any, so a missing marker changes nothing.
  const planned = TARGETS.map((target) => {
    const path = join(root, target.path);
    const source = readFileSync(path, "utf8");
    return { target, path, source, next: spliceBlock(source, target, target.render(lex)) };
  });
  for (const { target, path, source, next } of planned) {
    if (next !== source) writeFileSync(path, next);
    console.log(`${next === source ? "unchanged" : "wrote"} ${target.path}`);
  }
  return 0;
}

function usage() {
  console.error("usage: node scripts/gen-agency-lexicon.mjs [--check] [--root <dir>]");
  return 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`agency lexicon: ${error.message}`);
    process.exitCode = 2;
  }
}
