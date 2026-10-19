#!/usr/bin/env node
// Write spec/agency-lexicon.json and spec/guard-lexicon.json into the three
// engines. Zero dependencies.
//
// The accountable-passive detector (agency-hiding.deleted-subject) reads closed
// word lists: auxiliaries, adverbs, the head-word skip list, the negators, the
// participle classes and their head nouns, and three character sets (the
// whitespace between words, the characters that end the head walk and start
// the clause the negator reader reads, and the clause breaks that end the 'by'
// window). The engine-side guards read more: the negators of the two-word
// window that strip and the absolute.universal guard share, its clause breaks,
// and the imperative 'Never' guard's closed lists. Copied by hand into
// JavaScript, Python and Go, three lists drift; generated from one file, they
// cannot drift unseen. Each engine holds each lexicon between two marker lines:
//
//   // BEGIN GENERATED AGENCY LEXICON      (# in Python)
//   ...
//   // END GENERATED AGENCY LEXICON
//   // BEGIN GENERATED GUARD LEXICON
//   ...
//   // END GENERATED GUARD LEXICON
//
//   node scripts/gen-agency-lexicon.mjs            rewrite the six blocks
//   node scripts/gen-agency-lexicon.mjs --check    exit 1 if any block differs from its lexicon
//   ... --root <dir>                               read and write another checkout (tests use it)
//
// The module also exports lexiconProbes(): one sentence per participle that the
// detector must mark, and one with a 'by' agent that it must not;
// boundaryProbes(): sentences at each edge of the hand-written walks, built from
// the lexicon's numbers and character sets; and guardProbes(): one sentence per
// word of the guard lexicon and per clause break. The three-engine differential
// (scripts/xengine-diff.mjs) takes all three as inputs, and
// test/agency-lexicon.test.mjs and test/analyze.test.mjs hold the JavaScript
// engine to them.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const LEXICON = "spec/agency-lexicon.json";
export const GUARD_LEXICON = "spec/guard-lexicon.json";
export const BEGIN = "BEGIN GENERATED AGENCY LEXICON";
export const END = "END GENERATED AGENCY LEXICON";
export const GUARD_BEGIN = "BEGIN GENERATED GUARD LEXICON";
export const GUARD_END = "END GENERATED GUARD LEXICON";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WIDTH = 100;

const WORD = /^[a-z]+$/;
const PHRASE = /^[a-z]+(?: [a-z]+)*$/;

/** The whitespace a lexicon may name, each with its escape inside a regex class. */
const SPACE_ESCAPES = { " ": " ", "\t": "\\t", "\n": "\\n", "\r": "\\r", "\f": "\\f", "\v": "\\v" };
/** What a stop or a clause break may be: ASCII punctuation, or a line break. */
const STOP = /^[!-/:-@[-`{-~\n]$/;

/** The checks both lexicons share, reporting through `say`. */
function checkers(say) {
  return {
    words(list, where, pattern = WORD) {
      if (!Array.isArray(list) || list.length === 0) return say(`${where}: must be a non-empty array`);
      for (const w of list) if (typeof w !== "string" || !pattern.test(w)) say(`${where}: ${JSON.stringify(w)} is not lowercase ASCII`);
      const sorted = [...list].sort();
      if (JSON.stringify(sorted) !== JSON.stringify(list)) say(`${where}: must be sorted`);
      if (new Set(list).size !== list.length) say(`${where}: has duplicates`);
    },
    count(value, where) {
      if (!Number.isInteger(value) || value < 1) say(`${where}: must be a positive integer`);
    },
    chars(value, where, allowed, what) {
      if (typeof value !== "string" || value.length === 0) return say(`${where}: must be a non-empty string`);
      for (const c of value) if (!allowed(c)) say(`${where}: ${JSON.stringify(c)} is not ${what}`);
      if (new Set(value).size !== value.length) say(`${where}: has duplicates`);
    },
    why(value, where) {
      if (typeof value !== "string" || !value.trim()) say(`${where}: needs a why`);
    }
  };
}

/** Every rule the lexicon must keep that JSON alone cannot express. */
export function lexiconProblems(lex) {
  const problems = [];
  const say = (message) => problems.push(message);
  const { words, count, chars, why } = checkers(say);
  count(lex.version, "version");
  chars(lex.whitespace, "whitespace", (c) => Object.hasOwn(SPACE_ESCAPES, c), "one of space, tab, LF, CR, FF or VT");
  chars(lex.headStops, "headStops", (c) => STOP.test(c), "ASCII punctuation or a line break");
  chars(lex.clauseBreaks, "clauseBreaks", (c) => STOP.test(c), "ASCII punctuation or a line break");
  words(lex.auxiliaries, "auxiliaries");
  words(lex.adverbs, "adverbs");
  words(lex.skip, "skip");
  words(lex.negators, "negators");
  for (const w of lex.adverbs || []) {
    if ((lex.negators || []).includes(w)) say(`adverbs: ${JSON.stringify(w)} is a negator, and a negated passive is not marked`);
  }
  // The head walk and the negator reader both stop only at a head stop, so a
  // word the walk steps over always lies in the clause the reader reads: a
  // negator there silences the passive whatever the head, and listing it as a
  // skip word could never change a mark.
  for (const w of lex.skip || []) {
    if ((lex.negators || []).includes(w)) say(`skip: ${JSON.stringify(w)} is a negator, which already silences the passive`);
  }
  why(lex.negatorWhy, "negatorWhy");
  for (const key of ["adverbSuffix", "skipSuffix"]) {
    if (typeof lex[key] !== "string" || !WORD.test(lex[key])) say(`${key}: must be lowercase ASCII`);
  }
  count(lex.skipMax, "skipMax");
  count(lex.byWindow, "byWindow");
  if (!lex.heads || typeof lex.heads !== "object") say("heads: must be an object");
  for (const [name, list] of Object.entries(lex.heads || {})) {
    if (!WORD.test(name)) say(`heads: class name ${JSON.stringify(name)} is not lowercase ASCII`);
    words(list, `heads.${name}`);
    why(lex.headWhy?.[name], `headWhy.${name}`);
  }
  for (const name of Object.keys(lex.headWhy || {})) {
    if (!Object.hasOwn(lex.heads || {}, name)) say(`headWhy.${name}: is not a class in heads`);
  }
  const seen = new Map();
  for (const [i, c] of (lex.classes || []).entries()) {
    const where = `classes[${i}]`;
    if (typeof c.id !== "string" || !WORD.test(c.id)) say(`${where}: id must be lowercase ASCII`);
    if (c.head !== null && !Object.hasOwn(lex.heads || {}, c.head)) say(`${where}: head ${JSON.stringify(c.head)} is not a class in heads`);
    why(c.why, where);
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
    why(group.why, `excluded[${i}]`);
    for (const w of group.words || []) if (used.has(w)) say(`excluded[${i}]: ${JSON.stringify(w)} is excluded but also listed`);
  }
  return problems;
}

/** Every rule the guard lexicon must keep that JSON alone cannot express. */
export function guardProblems(guard) {
  const problems = [];
  const say = (message) => problems.push(message);
  const { words, count, chars, why } = checkers(say);
  count(guard.version, "version");
  chars(guard.clauseBreaks, "clauseBreaks", (c) => STOP.test(c) && c !== "\n", "ASCII punctuation");
  for (const key of ["negators", "neverNonVerbs", "neverPassThrough", "neverAdviceOpeners"]) {
    words(guard[key], key);
    why(guard[`${key}Why`], `${key}Why`);
  }
  // Each word after "Never" is read once: stepped over, a fragment or an
  // inversion, or (named or not) the verb of advice.
  const seen = new Map();
  for (const key of ["neverNonVerbs", "neverPassThrough", "neverAdviceOpeners"]) {
    for (const w of guard[key] || []) {
      if (seen.has(w)) say(`${key}: ${JSON.stringify(w)} is also in ${seen.get(w)}`);
      seen.set(w, key);
    }
  }
  return problems;
}

function load(root, path, problemsOf) {
  const lex = JSON.parse(readFileSync(join(root, path), "utf8"));
  const problems = problemsOf(lex);
  if (problems.length) throw new Error(`${path} is invalid:\n  ${problems.join("\n  ")}`);
  return lex;
}

export function loadLexicon(root = ROOT) {
  return load(root, LEXICON, lexiconProblems);
}

export function loadGuardLexicon(root = ROOT) {
  return load(root, GUARD_LEXICON, guardProblems);
}

// ---- rendering ---------------------------------------------------------------

const q = (s) => JSON.stringify(s);

/** The lexicon's whitespace as a regex source: one or more of its characters. */
const spaceClass = (lex) => `[${[...lex.whitespace].map((c) => SPACE_ESCAPES[c]).join("")}]+`;

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

const header = (c, lex, begin = BEGIN, path = LEXICON) => [
  `${c} ${begin}`,
  `${c} ${path} version ${lex.version}, written by scripts/gen-agency-lexicon.mjs.`,
  `${c} Edit the lexicon and rerun the generator; --check fails when this block drifts.`
];
const guardHeader = (c, guard) => header(c, guard, GUARD_BEGIN, GUARD_LEXICON);

function renderJs(lex) {
  const set = (items) => `new Set([\n${wrap(items.map(q), "  ")}\n])`;
  return [
    ...header("//", lex),
    `const AGENCY_WHITESPACE = ${q(lex.whitespace)};`,
    `const AGENCY_SPACE = ${q(spaceClass(lex))};`,
    `const AGENCY_HEAD_STOPS = ${q(lex.headStops)};`,
    `const AGENCY_CLAUSE_BREAKS = ${q(lex.clauseBreaks)};`,
    `const AGENCY_AUXILIARIES = [${lex.auxiliaries.map(q).join(", ")}];`,
    `const AGENCY_ADVERBS = [${lex.adverbs.map(q).join(", ")}];`,
    `const AGENCY_ADVERB_SUFFIX = ${q(lex.adverbSuffix)};`,
    `const AGENCY_SKIP = ${set(lex.skip)};`,
    `const AGENCY_SKIP_SUFFIX = ${q(lex.skipSuffix)};`,
    `const AGENCY_SKIP_MAX = ${lex.skipMax};`,
    `const AGENCY_BY_WINDOW = ${lex.byWindow};`,
    `const AGENCY_NEGATORS = ${set(lex.negators)};`,
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
    `AGENCY_WHITESPACE = ${q(lex.whitespace)}`,
    `AGENCY_SPACE = ${q(spaceClass(lex))}`,
    `AGENCY_HEAD_STOPS = ${q(lex.headStops)}`,
    `AGENCY_CLAUSE_BREAKS = ${q(lex.clauseBreaks)}`,
    `AGENCY_AUXILIARIES = (${lex.auxiliaries.map(q).join(", ")})`,
    `AGENCY_ADVERBS = (${lex.adverbs.map(q).join(", ")})`,
    `AGENCY_ADVERB_SUFFIX = ${q(lex.adverbSuffix)}`,
    `AGENCY_SKIP = ${set(lex.skip, "")}`,
    `AGENCY_SKIP_SUFFIX = ${q(lex.skipSuffix)}`,
    `AGENCY_SKIP_MAX = ${lex.skipMax}`,
    `AGENCY_BY_WINDOW = ${lex.byWindow}`,
    `AGENCY_NEGATORS = ${set(lex.negators, "")}`,
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
    "const (",
    `\tagencyWhitespace   = ${q(lex.whitespace)}`,
    `\tagencySpace        = ${q(spaceClass(lex))}`,
    `\tagencyHeadStops    = ${q(lex.headStops)}`,
    `\tagencyClauseBreaks = ${q(lex.clauseBreaks)}`,
    ")",
    "",
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
    `var agencyNegators = ${set(lex.negators, "")}`,
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

function renderGuardJs(guard) {
  const set = (items) => `new Set([\n${wrap(items.map(q), "  ")}\n])`;
  return [
    ...guardHeader("//", guard),
    `const NEGATORS = ${set(guard.negators)};`,
    `const CLAUSE_BREAKS = ${q(guard.clauseBreaks)};`,
    `const NEVER_NON_VERBS = ${set(guard.neverNonVerbs)};`,
    `const NEVER_PASS_THROUGH = ${set(guard.neverPassThrough)};`,
    `// ${GUARD_END}`
  ].join("\n");
}

function renderGuardPython(guard) {
  const set = (items) => `frozenset({\n${wrap(items.map(q), "    ")}\n})`;
  return [
    ...guardHeader("#", guard),
    `_NEGATORS = ${set(guard.negators)}`,
    `_CLAUSE_BREAKS = frozenset(${q(guard.clauseBreaks)})`,
    `_NEVER_NON_VERBS = ${set(guard.neverNonVerbs)}`,
    `_NEVER_PASS_THROUGH = ${set(guard.neverPassThrough)}`,
    `# ${GUARD_END}`
  ].join("\n");
}

function renderGuardGo(guard) {
  const set = (items) => `map[string]bool{\n${wrap(items.map((w) => `${q(w)}: true`), "\t")},\n}`;
  return [
    ...guardHeader("//", guard),
    `const clauseBreaks = ${q(guard.clauseBreaks)}`,
    "",
    `var negators = ${set(guard.negators)}`,
    "",
    `var neverNonVerbs = ${set(guard.neverNonVerbs)}`,
    "",
    `var neverPassThrough = ${set(guard.neverPassThrough)}`,
    "",
    `// ${GUARD_END}`
  ].join("\n");
}

export const TARGETS = [
  { path: "packages/core/index.mjs", comment: "//", render: renderJs, renderGuard: renderGuardJs },
  { path: "impl/python/rhetorlint.py", comment: "#", render: renderPython, renderGuard: renderGuardPython },
  { path: "impl/go/rhetorlint.go", comment: "//", render: renderGo, renderGuard: renderGuardGo }
];

/** The source with one generated block replaced, or an error naming what is wrong. */
export function spliceBlock(source, target, block, beginMarker = BEGIN, endMarker = END) {
  const begin = `${target.comment} ${beginMarker}`;
  const end = `${target.comment} ${endMarker}`;
  const at = source.indexOf(begin);
  const until = source.indexOf(end);
  if (at < 0 || until < 0 || until < at) throw new Error(`${target.path}: the ${beginMarker} / ${endMarker} markers are missing or out of order`);
  if (source.indexOf(begin, at + 1) >= 0 || source.indexOf(end, until + 1) >= 0) {
    throw new Error(`${target.path}: the generated-block markers appear more than once`);
  }
  return source.slice(0, at) + block + source.slice(until + end.length);
}

/** The source with both generated blocks rewritten from their lexicons. */
function spliceBoth(source, target, lex, guard) {
  const agency = spliceBlock(source, target, target.render(lex));
  return spliceBlock(agency, target, target.renderGuard(guard), GUARD_BEGIN, GUARD_END);
}

/** Each target whose blocks differ from the lexicons, as messages. */
export function drift(root = ROOT, lex = loadLexicon(root), guard = loadGuardLexicon(root)) {
  const out = [];
  for (const target of TARGETS) {
    const source = readFileSync(join(root, target.path), "utf8");
    for (const [name, path, begin, end, block] of [
      ["agency", LEXICON, BEGIN, END, target.render(lex)],
      ["guard", GUARD_LEXICON, GUARD_BEGIN, GUARD_END, target.renderGuard(guard)]
    ]) {
      try {
        if (spliceBlock(source, target, block, begin, end) !== source) {
          out.push(`${target.path}: its generated ${name} lexicon differs from ${path}; run node scripts/gen-agency-lexicon.mjs`);
        }
      } catch (error) {
        out.push(error.message);
      }
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
  held: (p) => `Your account was ${p}.`,
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

/**
 * Sentences at each edge of the detector's hand-written walks, as [id, text,
 * expected agency span or null]. The word lists are checked by --check; these
 * check the code that reads them: the 'by' window's length and where it ends,
 * where the head walk stops and how many auxiliary-chain words it steps over,
 * where the negator reader's clause starts and that it reads all of it, the
 * n't contraction, the adverb slot, the whole-word test after a requires or
 * unless phrase, what counts as a word character (an ASCII letter, digit or
 * underscore, as \b has it) and the whitespace that may separate the words of
 * a match. Each is built from the lexicon's own words, numbers and character
 * sets, so it follows a change to them, and a one-token change to any engine's
 * walk parts that engine from the expected span here or from the other two in
 * the differential.
 */
export function boundaryProbes(lex = loadLexicon()) {
  const out = [];
  const add = (id, text, span) => out.push([`boundary:${id}`, text, span]);
  const filler = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i % 26))).join(" ");
  // No skip word is a negator (lexiconProblems refuses one), so any of them
  // can stand in the auxiliary chain without silencing the passive.
  const chain = lex.skip;
  if (chain.length < lex.skipMax + 1) throw new Error("boundary probes need skipMax + 1 skip words");
  const name = (c) => c === "\n" ? "line-break" : `u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
  const edges = [...new Set([...lex.headStops, ...lex.clauseBreaks, ","])];

  // The 'by' window: 'by' as its last word silences the passive; one word later it does not.
  add("by-window-last", `Mistakes were made ${filler(lex.byWindow - 1)} by them.`, null);
  add("by-window-past", `Mistakes were made ${filler(lex.byWindow)} by them.`, "were made");
  // The 'by' window ends at a clause break, and reads on across anything else.
  for (const c of edges) {
    add(`by-window-after-${name(c)}`, `Mistakes were made${c}by them.`, lex.clauseBreaks.includes(c) ? "were made" : null);
  }
  // The head walk stops at a head stop: no head, so the error-noun class is silent.
  for (const c of edges) {
    add(`head-after-${name(c)}`, `Mistakes${c}were made.`, lex.headStops.includes(c) ? null : "were made");
  }
  // The head walk steps over skipMax chain words, and no more.
  add("skip-max", `Mistakes ${chain.slice(0, lex.skipMax).join(" ")} been made.`, "been made");
  add("skip-max-past", `Mistakes ${chain.slice(0, lex.skipMax + 1).join(" ")} been made.`, null);
  add("skip-suffix", `Mistakes ${chain.slice(0, lex.skipMax - 1).join(" ")} sad${lex.skipSuffix} been made.`, "been made");
  // The negator reader: a negator anywhere in the clause before the auxiliary,
  // in the chain, as the head word or before it however far back.
  for (const n of lex.negators) {
    add(`negator-chain-${n}`, `Data has ${n} been accessed.`, null);
    add(`negator-head-${n}`, `${n[0].toUpperCase()}${n.slice(1)} data was accessed.`, null);
  }
  add("negator-skip-max", `No data ${chain.slice(0, lex.skipMax).join(" ")} been accessed.`, null);
  add("negator-skip-max-past", `No data ${chain.slice(0, lex.skipMax + 1).join(" ")} been accessed.`, null);
  add("negator-clause-far", `No ${filler(26)} data was accessed.`, null);
  add("negator-subject-list", "No card numbers, bank details or passwords were stolen.", null);
  // The clause starts after a head stop, or at the start of the text; a comma starts none.
  for (const c of edges) {
    add(`negator-after-${name(c)}`, `No${c}data was accessed.`, lex.headStops.includes(c) ? "was accessed" : null);
    add(`negator-earlier-clause-${name(c)}`, `No one called${c} but data were stolen.`, lex.headStops.includes(c) ? "were stolen" : null);
  }
  // Each passive reads its own clause: a negator after the first silences only
  // the second, and a head stop between them starts a new clause.
  add("negator-second-passive", "Data was accessed and no records were leaked.", "was accessed");
  add("negator-first-passive", "No data was accessed and records were leaked.", null);
  add("negator-clause-reset", "No data was accessed. Records were leaked.", "were leaked");
  // A negator after the participle is not read (a recorded over-mark).
  add("negator-after-participle", "Your data was shared with no one.", "was shared");
  // An n't contraction is a negator: "n", an apostrophe (U+0027 or U+2019), then "t".
  add("contraction-ascii", "Data hasn't been accessed.", null);
  add("contraction-rsquo", "Data hasn\u2019t been accessed.", null);
  add("contraction-not-n", "Data has't been accessed.", "been accessed");
  add("contraction-spaced", "Data hasn' t been accessed.", "been accessed");
  add("contraction-no-apostrophe", "Data hasn t been accessed.", "been accessed");
  // The adverb slot: each listed adverb, or one word ending in the suffix after
  // at least one letter; not two adverbs, an unlisted word, a negator or a digit.
  if (lex.adverbs.includes("soon") || "soon".endsWith(lex.adverbSuffix)) throw new Error("the unlisted-adverb probe needs another word");
  for (const a of lex.adverbs) add(`adverb-${a}`, `Customer data was ${a} accessed.`, `was ${a} accessed`);
  add("adverb-suffix", `Customer data was quiet${lex.adverbSuffix} accessed.`, `was quiet${lex.adverbSuffix} accessed`);
  add("adverb-suffix-alone", `Customer data was ${lex.adverbSuffix} accessed.`, null);
  add("adverb-suffix-digit", `Customer data was 2${lex.adverbSuffix} accessed.`, null);
  add("adverb-two", `Customer data was quiet${lex.adverbSuffix} ${lex.adverbs[0]} accessed.`, null);
  add("adverb-unlisted", "Customer data was soon accessed.", null);
  for (const n of lex.negators) add(`adverb-negator-${n}`, `Customer data was ${n} accessed.`, null);
  // A requires or unless phrase holds only as whole words: its last word with a
  // letter after it is another word.
  const frameOf = (p) => PROBE_FRAME[lex.classes.find((c) => c.participles.includes(p)).head ?? ""];
  for (const [p, phrase] of Object.entries(lex.requires)) {
    add(`requires-partial-${p}`, frameOf(p)(`${p} ${phrase}s`), null);
  }
  for (const [p, phrase] of Object.entries(lex.unless)) {
    const be = frameOf(p)(p).match(/\b(?:was|were) /)[0];
    add(`unless-${p}`, frameOf(p)(`${p} ${phrase} it`), null);
    add(`unless-partial-${p}`, frameOf(p)(`${p} ${phrase}s`), be + p);
  }
  // A word character is an ASCII letter, digit or underscore, as \b has it, in
  // every walk: the head word, the negator reader, the 'by' window and the
  // whole-word test after a phrase.
  add("word-underscore-head", "Your user_data was shared.", null);
  add("word-digit-head", "Your data2 was shared.", null);
  add("word-underscore-negator", "No_data was accessed.", "was accessed");
  add("word-digit-negator", "No2 data was accessed.", "was accessed");
  add("word-underscore-before-negator", "Data_no was accessed.", "was accessed");
  add("word-digit-before-negator", "Data2no was accessed.", "was accessed");
  add("word-underscore-by", "Mistakes were made by_them.", "were made");
  add("word-digit-by", "Mistakes were made by2.", "were made");
  add("word-underscore-requires", "Safeguards were put in place_now.", null);
  add("word-underscore-unless", "Customer data was exposed to_all.", "was exposed");
  // Whitespace: each listed character separates the words of a match and of a
  // requires phrase; a vertical tab, unless listed, separates neither.
  for (const c of [...new Set([...lex.whitespace, "\v"])]) {
    const listed = lex.whitespace.includes(c);
    add(`space-${name(c)}`, `Mistakes were${c}made.`, listed ? `were${c}made` : null);
    add(`space-requires-${name(c)}`, `Safeguards were put${c}in place.`, listed ? "were put" : null);
  }
  return out;
}

/**
 * One sentence per word of the guard lexicon, and per clause break, as [id,
 * text]: each negator before an intensifier (strip keeps it) and before an
 * absolute (absolute.universal leaves it unmarked); each word after a
 * clause-initial "Never", alone and after each adverb it steps over; and each
 * clause break between a negator and what it would negate. The word lists are
 * checked by --check; these give the differential the code that reads them, so
 * a change to one engine's walk parts it from the other two.
 */
export function guardProbes(guard = loadGuardLexicon()) {
  const out = [];
  const add = (id, text) => out.push([`guard:${id}`, text]);
  for (const n of guard.negators) {
    add(`negator-${n}-strip`, `It was ${n} extremely bad.`);
    add(`negator-${n}-absolute`, `It is ${n} always so.`);
  }
  for (const w of guard.neverNonVerbs) add(`never-non-verb-${w}`, `Never ${w} x.`);
  for (const w of guard.neverAdviceOpeners) add(`never-advice-opener-${w}`, `Never ${w} x.`);
  for (const a of guard.neverPassThrough) {
    add(`never-pass-through-${a}`, `Never ${a} share it.`);
    add(`never-pass-through-${a}-fragment`, `Never ${a} ${guard.neverNonVerbs[0]} x.`);
  }
  for (const c of guard.clauseBreaks) {
    const id = `u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
    add(`clause-break-${id}-strip`, `We said no${c} extremely few agreed.`);
    add(`clause-break-${id}-absolute`, `We said no${c} everyone agreed.`);
    add(`clause-break-${id}-never`, `Check the link${c} never click it.`);
  }
  return out;
}

// ---- command line ------------------------------------------------------------

function main(argv) {
  let values, tokens;
  try {
    ({ values, tokens } = parseArgs({
      args: argv,
      options: { check: { type: "boolean" }, root: { type: "string" } },
      strict: true,
      allowPositionals: false,
      tokens: true
    }));
  } catch {
    return usage();
  }
  // parseArgs keeps the last of a repeated option; refuse the repeat instead.
  if (values.root === "" || tokens.filter((t) => t.kind === "option" && t.name === "root").length > 1) return usage();
  const root = values.root !== undefined ? resolve(values.root) : ROOT;
  const lex = loadLexicon(root);
  const guard = loadGuardLexicon(root);
  if (values.check) {
    const problems = drift(root, lex, guard);
    if (problems.length) {
      console.error(`agency lexicon: DRIFT (${problems.length})\n` + problems.map((p) => `- ${p}`).join("\n"));
      return 1;
    }
    console.log(`agency lexicon: ${TARGETS.length} engines match ${LEXICON} version ${lex.version} and ${GUARD_LEXICON} version ${guard.version}`);
    return 0;
  }
  // Splice every engine before writing any, so a missing marker changes nothing.
  const planned = TARGETS.map((target) => {
    const path = join(root, target.path);
    const source = readFileSync(path, "utf8");
    return { target, path, source, next: spliceBoth(source, target, lex, guard) };
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

// Compare real paths: on macOS /tmp is a symlink to /private/tmp, and a script
// run through it must still run (and fail when it should), not exit 0 silently.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`agency lexicon: ${error.message}`);
    process.exitCode = 2;
  }
}
