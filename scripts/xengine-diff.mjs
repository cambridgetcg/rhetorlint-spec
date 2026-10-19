// The three-engine differential: JavaScript, Python and Go must agree beyond
// the conformance cases.
//
// conformance/cases.json pins 68 inputs value for value. This script feeds a
// wider, committed input set (conformance/differential/inputs.jsonl) to all
// three engines and compares, per input:
//   - the multiset of marks as (ruleId, actual), on every input;
//   - the strip output, on every input;
//   - the offsets of those marks. On ASCII input the three native units
//     (UTF-16, code points, bytes) coincide and are compared raw; elsewhere
//     each engine's offsets are converted to code points first.
//
// Plain-ASCII input (printable ASCII plus tab, LF and CR) must show zero
// differences. Every other difference must equal, entry for entry, the record
// in conformance/differential/divergences.json. That record is a two-way
// ratchet: a new divergence fails, and a resolved one fails until it is
// removed, so the file always says exactly where the engines part today.
//
// JS runs in-process; Python runs as one `python3 -I` subprocess reading JSON
// lines; Go runs through the env-gated TestXEngineDump in
// impl/go/rhetorlint_test.go. Zero dependencies beyond Node, Python and Go.
//
// usage:
//   node scripts/xengine-diff.mjs                      check (CI runs this)
//   node scripts/xengine-diff.mjs --build-inputs       regenerate inputs.jsonl
//   node scripts/xengine-diff.mjs --write-divergences  re-record divergences.json
//   node scripts/xengine-diff.mjs --local <file>       report on an uncommitted set
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../packages/core/index.mjs";
import { boundaryProbes, lexiconProbes } from "./gen-agency-lexicon.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const at = (path) => join(ROOT, path);
const INPUTS = "conformance/differential/inputs.jsonl";
const DIVERGENCES = "conformance/differential/divergences.json";
const RULES = "packages/rules-en/rules.json";
const ENGINES = ["js", "python", "go"];

// Constructed probes. Each carries one character the engines may read
// differently (or none, with the non-ASCII character away from any match, so
// agreement is asserted too). Escapes keep every invisible character visible.
const PROBES = [
  // U+00A0 NO-BREAK SPACE: \s matches it in JS and Python, not in Go's RE2.
  ["nbsp-agency", "Mistakes were\u00a0made."],
  ["nbsp-agency-twice", "Mistakes\u00a0were\u00a0made."],
  ["nbsp-urgency", "Let us act\u00a0now."],
  ["nbsp-hedge", "The system may\u00a0have failed."],
  ["nbsp-weasel", "Experts\u00a0say the plan works."],
  ["nbsp-lure", "Join today: 100%\u00a0free, no strings attached."],
  ["nbsp-whataboutism", "What\u00a0about their record?"],
  ["nbsp-intensifier-seam", "We are extremely\u00a0sorry."],
  ["nbsp-lexical-phrase", "No\u00a0one was told."],
  ["nbsp-sourcing", "People familiar with the\u00a0matter said so."],
  ["nbsp-shouting", "THIS\u00a0IS\u00a0OUTRAGEOUS"],
  // Other Unicode spaces and separators.
  ["thin-agency", "Mistakes were\u2009made."],
  ["thin-urgency", "Act\u2009now \u2013 stocks are low."],
  ["thin-elsewhere", "Prices rose 5\u2009% and the plan was shelved."],
  ["narrow-nbsp-agency", "Mistakes were\u202fmade."],
  ["ideographic-space-agency", "Mistakes were\u3000made."],
  ["line-separator-agency", "Your data was\u2028shared."],
  ["nel-agency", "Your data was\u0085shared."],
  ["bom-agency", "Your data was\ufeffshared."],
  // The same three characters in a rule spelt with \s: here the engines part
  // (conformance/README.md caveat 3), where the agency detector's own
  // whitespace class keeps them together above.
  ["bom-urgency", "Let us act\ufeffnow."],
  ["nel-urgency", "Let us act\u0085now."],
  ["zero-width-space-agency", "Your data was\u200bshared."],
  // Quotation marks and apostrophes.
  ["rsquo-urgency", "Don\u2019t miss out on this deal."],
  ["rsquo-editorializing", "It\u2019s worth noting that sales fell."],
  ["rsquo-whataboutism", "Let\u2019s not forget who started it."],
  ["rsquo-possessive-agency", "The company\u2019s data was accessed."],
  ["rsquo-plural-possessive", "Customers\u2019 accounts were suspended."],
  ["rsquo-contrition", "We\u2019re committed to your safety."],
  ["single-quotes-agency", "\u2018Mistakes were made,\u2019 she said."],
  ["double-quotes-agency", "\u201cShots were fired,\u201d the report said."],
  // U+2011 NON-BREAKING HYPHEN and dashes.
  ["nb-hyphen-lure", "Start your risk\u2011free trial."],
  ["nb-hyphen-distancing", "These so\u2011called experts say otherwise."],
  ["nb-hyphen-exoneration", "An officer\u2011involved shooting was investigated."],
  ["nb-hyphen-puffery", "A world\u2011class team was hired."],
  ["en-dash-by-nobody", "Mistakes were made \u2013 by nobody."],
  ["en-dash-reportedly", "Shots were fired \u2013 reportedly by police."],
  ["en-dash-range", "Between 2019\u20132021 the records were destroyed."],
  ["em-dash-agency", "The files were deleted\u2014quietly."],
  // Accented letters: \w and \b are Unicode in Python, ASCII in JS and Go.
  ["accent-elsewhere", "Caf\u00e9 data was accessed."],
  ["accent-before-match", "Des d\u00e9cisions regrettables were made."],
  ["accent-hedge-word", "It may have \u00e9t\u00e9 confirmed."],
  ["accent-in-participle", "The files were d\u00e9l\u00e8ted overnight."],
  ["accent-caps-lead", "\u00c9RRORS WERE MADE AT THE TOP"],
  ["accent-caps-inside", "THE D\u00c9B\u00c2CLE WAS COVERED UP"],
  ["accent-decomposed", "Cafe\u0301 records were altered."],
  ["combining-after-match", "Mistakes were made\u0301."],
  ["accent-weasel", "\u00c9conomistes disagree; experts say it works."],
  // Astral characters: UTF-16 surrogate pairs, four UTF-8 bytes.
  ["emoji-inside", "Mistakes \ud83d\ude00 were made."],
  ["emoji-between", "Mistakes were \ud83d\ude2c made."],
  ["emoji-urgency", "Act now \ud83d\udd25 limited time only!"],
  ["emoji-lead", "\ud83d\ude00 Your data was shared."],
  ["emoji-strip-seam", "We take your privacy extremely seriously \ud83d\ude4f."],
  ["emoji-zwj-sequence", "The \ud83d\udc68\u200d\ud83d\udcbb team were fired."],
  // Case folding: U+017F LATIN SMALL LETTER LONG S and U+212A KELVIN SIGN.
  ["long-s-irregular", "Lives were lo\u017ft."],
  ["long-s-participle", "Your data was \u017fhared."],
  ["long-s-lexical", "It \u017feems the plan worked."],
  ["kelvin-participle", "Civilians were \u212ailled."],
  ["kelvin-lexical", "This is \u212aind of a problem."],
  // A look-alike letter inside a lexicon participle: the agency detector folds
  // only A-Z, so no engine marks these (killed and lost, above, are excluded
  // verbs and would be silent anyway). A long s inside a \w+ that no \b
  // guards parts JS from Python and Go (caveat 2).
  ["long-s-lexicon-participle", "Data was acce\u017f\u017fed."],
  ["kelvin-lexicon-participle", "Accounts were hac\u212aed."],
  ["kelvin-lexicon-participle-leaked", "Customer data was lea\u212aed."],
  ["long-s-hedge-word", "It may have \u017feen the file."],
  // absolute.universal finds its terms with \b: Python's is Unicode, so a
  // letter like e-acute against the term hides it from Python alone, and a
  // long s folds into the term in Python alone.
  ["accent-against-absolute", "Caf\u00e9Never fails."],
  ["long-s-absolute", "No fees, alway\u017f free."],
  // Non-ASCII away from any match: the engines must agree on every mark.
  // These put predicate adjectives, numerals and irregular participles after
  // a be-verb; the agency lexicon's own words are probed one by one below
  // (lexiconProbes, from scripts/gen-agency-lexicon.mjs), and the edges of the
  // detector's walks by boundaryProbes, from the same file.
  ["context-tired-glad-aware-open", "Zo\u00eb was tired, Zo\u00eb was glad, and Zo\u00eb was aware that the caf\u00e9 was open."],
  ["context-worried-excited-interested", "Ren\u00e9e was worried; later she was excited and was interested."],
  ["context-scared-bored-pleased", "The ni\u00f1os were scared, then were bored, and were pleased at noon."],
  ["context-married-gifted-talented", "Jos\u00e9 is married; Ana is gifted; L\u00fc is talented."],
  ["context-detailed-limited-dedicated", "The report is detailed and is limited to 2024 \u2013 it is dedicated to S\u00f8ren."],
  ["context-committed-supposed-used-based", "We are committed to this; we were supposed to finish; the tool is used daily \u2013 it is based in Malm\u00f6."],
  ["context-open-even-sudden", "The door is open, the score is even, the change was sudden \u2013 se\u00f1or."],
  ["context-seven-ten-eleven", "The total is seven, the floor is ten, and the team is eleven \u2013 ol\u00e9."],
  ["context-golden-wooden", "The crown is golden and the bench is wooden in the ch\u00e2teau."],
  ["context-often", "It is often said that the caf\u00e9 is often full."],
  ["context-irregular", "In Z\u00fcrich, mistakes were made, data was sent and kept, and lives were lost."],
  ["context-by-agent", "The report was written by the comit\u00e9."],
  ["context-by-particle", "The issuing is carried out collectively by the r\u00e9seau."],
  // ASCII control characters (ASCII, so not "non-ASCII", but not plain text
  // either): Go's \s omits U+000B, and only Python's \s takes U+001F.
  ["vertical-tab-agency", "Your data was\u000bshared."],
  ["vertical-tab-urgency", "Act\u000bnow."],
  ["form-feed-agency", "Your data was\u000cshared."],
  ["unit-separator-agency", "Your data was\u001fshared."],
  ["unit-separator-urgency", "Let us act\u001fnow."],
  // Strip guards: an intensifier under a negator, or inside a quotation, is
  // kept. The guards read words and quote marks, never a count of units, so
  // the engines must agree even where their offsets part. (Probes that repeat
  // a contrast row are dropped as duplicates; they stay here as the set.)
  ["strip-negated", "The risk is not extremely high, but it is not negligible."],
  ["strip-negated-contraction", "The update isn't hugely different."],
  ["strip-negated-sorry", "We are not deeply sorry."],
  ["strip-quoted", "\"It was utterly devastating,\" the flood survivor told reporters."],
  ["strip-curly-quoted", "He said \u201cwe are deeply sorry\u201d and left."],
  ["strip-unguarded", "This is an incredibly important update for every customer."],
  ["strip-rsquo-contraction", "The update isn\u2019t hugely different."],
  ["strip-emoji-between-negator", "Not \ud83d\ude00 extremely high."],
  ["strip-nbsp-after-negator", "Not\u00a0extremely high."],
  ["strip-emoji-in-curly-quote", "He said \u201c\ud83d\ude00 we are deeply sorry\u201d and left."],
  // The guards' edges, where one engine could drift alone: the two-word
  // window, each clause break, a comma (not a break), line-scoped quotes.
  ["strip-negator-second-word", "The risk cannot be extremely high."],
  ["strip-negator-third-word", "Not bad, and extremely cheap."],
  ["strip-negator-behind-period", "We said no. extremely few agreed."],
  ["strip-negator-behind-semicolon", "We said no; extremely few agreed."],
  ["strip-negator-behind-colon", "We said no: extremely few agreed."],
  ["strip-negator-behind-bang", "We said no! extremely few agreed."],
  ["strip-negator-behind-question", "We said no? extremely few agreed."],
  ["strip-negator-behind-comma", "We said no, extremely few agreed."],
  ["strip-negator-uppercase", "NOT EXTREMELY HIGH"],
  ["strip-quote-closed", "\"Fine,\" she said, extremely calmly."],
  ["strip-quote-previous-line", "He said \"hello\nand it was extremely loud."],
  ["strip-quote-crlf", "He said \"we are\r\nextremely sorry\" and left."],
  ["strip-curly-quote-closed", "He said \u201chello\u201d and was extremely calm."],
  // The absolute.universal guard: an absolute under a negator, or a
  // clause-initial "Never" before a lowercase word, is not marked. It reuses
  // the strip guards' word walk, so the same edges apply, plus the imperative's:
  // what may stand before "Never" and what must follow it.
  ["abs-negated", "Returns are not guaranteed; past performance is no indicator."],
  ["abs-negated-contraction", "Results aren't always typical."],
  ["abs-negated-capital", "Not everyone qualifies."],
  ["abs-negator-uppercase", "NOT EVERYONE QUALIFIES."],
  ["abs-negator-second-word", "The risk cannot always be priced."],
  ["abs-negator-third-word", "Not bad, and always cheap."],
  ["abs-negator-behind-period", "We said no. everyone agreed."],
  ["abs-negator-behind-semicolon", "We said no; everyone agreed."],
  ["abs-negator-behind-colon", "We said no: everyone agreed."],
  ["abs-negator-behind-bang", "We said no! everyone agreed."],
  ["abs-negator-behind-question", "We said no? everyone agreed."],
  ["abs-negator-behind-comma", "We said no, everyone agreed."],
  ["abs-never-imperative", "Never share your password with anyone."],
  ["abs-never-imperative-uppercase", "NEVER share it."],
  ["abs-never-after-period", "Check the link. never click it."],
  ["abs-never-after-semicolon", "Explain real constraints; never manufacture the shortage."],
  ["abs-never-after-colon", "Check the link: never click it."],
  ["abs-never-after-bang", "Check the link! never click it."],
  ["abs-never-after-question", "Check the link? never click it."],
  ["abs-never-after-comma", "Love begins with choice, never obligation."],
  ["abs-never-mid-clause", "We never share data."],
  ["abs-never-quoted-start", "\"Never share it,\" he said."],
  ["abs-never-tab-after", "Never\tshare it."],
  ["abs-never-newline-after", "Never\nshare it."],
  ["abs-never-newline-before", "We will\nnever share it."],
  ["abs-never-capital-next", "Never Again."],
  ["abs-never-digit-next", "Never 2 late."],
  ["abs-never-alone", "Never."],
  ["abs-never-text-end", "We said never"],
  ["abs-never-inversion", "Never again will prices be this low."],
  ["abs-unguarded", "This is guaranteed to double your savings."],
  ["abs-rsquo-contraction", "Results aren\u2019t always typical."],
  ["abs-nbsp-after-negator", "Not\u00a0everyone qualifies."],
  ["abs-emoji-between-negator", "Not \ud83d\ude00 always."],
  ["abs-curly-quote-never", "\u201cNever share it,\u201d he said."],
  ["abs-emoji-before-never", "\ud83d\udd12 Never share your password."],
  ["abs-nbsp-after-never", "Never\u00a0share it."],
  ["abs-accented-word-before-never", "Caf\u00e9 never closes."],
  ["abs-greek-word-before-never", "\u03a9 never fails."],
  // The guard's comma rule: a comma ends a negator's reach once a word stands
  // between them, but not when it follows the negator directly; strip's
  // negator still reads past a comma. And the imperative's closed lists: a word
  // that cannot be the verb, the adverbs stepped over, and how a word is cut.
  ["abs-comma-after-noun", "No fees, always free."],
  ["abs-comma-after-verb", "Don't wait, everyone is buying."],
  ["abs-comma-after-word-tab", "No risk,\tguaranteed."],
  ["abs-comma-right-after-negator", "Past performance is not, however, always a guide."],
  ["abs-comma-right-after-word-one", "No, never."],
  ["abs-comma-strip-unchanged", "It isn't, frankly, extremely high."],
  ["abs-never-fragment", "Battery life? Never an issue."],
  ["abs-never-inversion-has", "Never has a product been this good."],
  ["abs-never-inversion-before", "Never before have prices been this low."],
  ["abs-never-ever-imperative", "Never ever share your password."],
  ["abs-never-adverb-then-end", "Never ever again."],
  ["abs-never-adverb-newline", "Never again\nshare it."],
  ["abs-never-adverb-capital", "Never again Share it."],
  ["abs-never-mixed-case-next", "Go; never hAS it."],
  ["abs-never-prefix-word", "Never answer it."],
  ["abs-never-contraction-next", "Never can't stop."],
  ["abs-comma-curly-quoted-values", "Values are \u201cnever\u201d, \u201calways\u201d and \u201cauto\u201d."],
  ["abs-comma-emoji-after-word", "No fees, \ud83d\ude00 always free."],
  ["abs-fullwidth-comma", "No risk\uff0c guaranteed."],
  ["abs-never-nbsp-after-adverb", "Never again\u00a0will prices fall."],
  ["abs-never-accented-next", "Never \u00e9t\u00e9 again."],
  ["abs-never-rsquo-in-next", "Never can\u2019t stop."],
  // The agency detector's clause negator, and the tests a one-engine change
  // once slipped past, in natural sentences (boundaryProbes builds the same
  // edges from the lexicon): breach notices that deny the act however long the
  // subject; the whole-word test after 'exposed' ('to' is not 'today') and
  // after 'put' ('in place' is not 'into place'); a line break that starts the
  // clause after a carriage return; and non-ASCII characters that start no
  // clause.
  ["agency-denial-card-numbers", "No credit card numbers, bank account details or passwords were stolen."],
  ["agency-denial-ssn", "No Social Security numbers or other sensitive personal information were exposed."],
  ["agency-denial-earlier-clause", "No one called, but data were stolen."],
  ["agency-exposed-today", "Customer data was exposed today."],
  ["agency-put-into-place", "Safeguards were put into place."],
  ["agency-negator-crlf", "No one called\r\ndata were stolen."],
  ["agency-negator-nbsp", "No\u00a0card numbers were stolen."],
  ["agency-negator-ideographic-stop", "No\u3002data was accessed."],
  ["agency-negator-line-separator", "No\u2028data was accessed."],
  ["agency-negator-emoji", "No \ud83d\ude00 data was accessed."]
];

const isAscii = (text) => /^[\x00-\x7f]*$/.test(text);
const isPlain = (text) => /^[\x20-\x7e\t\n\r]*$/.test(text);
const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** JSON with every character outside printable ASCII escaped, so a no-break
 *  space or a long s is visible in review and the file is pure ASCII. */
function asciiJson(value, space) {
  return JSON.stringify(value, null, space).replace(
    /[^\x20-\x7e\n]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")
  );
}

function paragraphs(text) {
  return text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
}

function contrastRows(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["rows", "cases", "items"]) if (Array.isArray(data?.[key])) return data[key];
  throw new Error("measurement/contrast.json has no rows array (expected an array, or .rows)");
}

/** Every committable source, in a fixed order. Missing optional sources are
 *  skipped and counted as zero; the integrator re-runs this when they land. */
function collectInputs() {
  const rows = [];
  const seen = new Set();
  const counts = { cases: 0, items: 0, contrast: 0, probes: 0, lexicon: 0, boundary: 0, duplicates: 0 };
  const add = (kind, id, source, text) => {
    if (typeof text !== "string" || text.trim() === "") return;
    if (loneSurrogate.test(text)) throw new Error(`${id}: lone surrogate; the engines cannot share it`);
    if (seen.has(text)) { counts.duplicates++; return; }
    seen.add(text);
    counts[kind]++;
    rows.push({ id, source, text });
  };

  const cases = JSON.parse(readFileSync(at("conformance/cases.json"), "utf8")).cases;
  cases.forEach((c, i) => add("cases", `case:${i}`, "conformance/cases.json", c.input));

  const itemsDir = at("measurement/items");
  if (existsSync(itemsDir)) {
    for (const file of readdirSync(itemsDir).filter((f) => f.endsWith(".txt")).sort()) {
      const name = file.slice(0, -".txt".length);
      paragraphs(readFileSync(join(itemsDir, file), "utf8")).forEach((p, n) =>
        add("items", `item:${name}#${n + 1}`, `measurement/items/${file}`, p));
    }
  }

  if (existsSync(at("measurement/contrast.json"))) {
    const data = JSON.parse(readFileSync(at("measurement/contrast.json"), "utf8"));
    contrastRows(data).forEach((row, n) =>
      add("contrast", `contrast:${row?.id ?? n}`, "measurement/contrast.json", row?.text));
  }

  for (const [name, text] of PROBES) add("probes", `probe:${name}`, "scripts/xengine-diff.mjs", text);
  // One sentence per participle of the agency lexicon that the detector marks,
  // and the same with a 'by' agent, which it must not: a word dropped from, or
  // added to, one engine's generated copy parts the engines here.
  for (const [id, text] of lexiconProbes()) add("lexicon", id, "spec/agency-lexicon.json", text);
  // The edges of the detector's hand-written walks, built from the lexicon's
  // words, numbers and character sets: the 'by' window, the head walk and the
  // chain's length, the clause the negator reader reads, the n't contraction,
  // the adverb slot, the whole-word test after a phrase, what counts as a word
  // character and the whitespace between words.
  // A one-token change to one engine's walk parts it from the other two here.
  for (const [id, text] of boundaryProbes()) add("boundary", id, "spec/agency-lexicon.json", text);
  return { rows, counts };
}

const serialiseInputs = (rows) => rows.map((r) => asciiJson(r)).join("\n") + "\n";

function readInputFile(path) {
  const raw = readFileSync(path, "utf8");
  const values = raw.trimStart().startsWith("[")
    ? JSON.parse(raw)
    : raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const seen = new Set();
  const rows = [];
  let duplicates = 0;
  values.forEach((v, n) => {
    const text = typeof v === "string" ? v : v?.text;
    if (typeof text !== "string") return;
    if (seen.has(text)) { duplicates++; return; }
    if (loneSurrogate.test(text)) throw new Error(`${path} line ${n + 1}: lone surrogate`);
    seen.add(text);
    rows.push({ id: typeof v === "object" && v?.id ? String(v.id) : `local:${n + 1}`, text });
  });
  return { rows, read: values.length, duplicates };
}

// ---- the three engines ------------------------------------------------------

function run(cmd, args, options) {
  return new Promise((done, fail) => {
    const child = execFile(cmd, args, { maxBuffer: 1 << 30, ...options }, (error, stdout, stderr) => {
      if (error) {
        const why = error.code === "ENOENT" ? `${cmd} not found: the differential needs all three engines` : `${stderr}${stdout}`.trim();
        fail(new Error(`${cmd} ${args.join(" ")} failed: ${why}`));
      } else done(stdout);
    });
    child.stdin.end(options.input);
  });
}

const parseLines = (raw) => raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));

function runJs(texts) {
  const rules = JSON.parse(readFileSync(at(RULES), "utf8"));
  return texts.map((text) => {
    const r = analyze(text, { rules });
    return { marks: r.marks.map((m) => [m.ruleId, m.actual, m.position.start.offset, m.position.end.offset]), strip: r.strip };
  });
}

const PYTHON_DRIVER = `
import json, sys
sys.path.insert(0, sys.argv[1])
import rhetorlint
with open(sys.argv[2], encoding="utf-8") as f:
    rules = json.load(f)
out = []
for line in sys.stdin.buffer.read().split(b"\\n"):
    if not line.strip():
        continue
    r = rhetorlint.analyze(json.loads(line), rules)
    out.append(json.dumps({
        "marks": [[m["ruleId"], m["actual"], m["position"]["start"]["offset"], m["position"]["end"]["offset"]] for m in r["marks"]],
        "strip": r["strip"],
    }))
sys.stdout.write("\\n".join(out) + "\\n")
`;

async function runPython(stream) {
  return parseLines(await run("python3", ["-I", "-c", PYTHON_DRIVER, at("impl/python"), at(RULES)], { input: stream }));
}

async function runGo(stream) {
  const dir = mkdtempSync(join(tmpdir(), "xengine-"));
  try {
    writeFileSync(join(dir, "in.jsonl"), stream);
    await run("go", ["test", "-count=1", "-run", "^TestXEngineDump$", "."], {
      cwd: at("impl/go"),
      env: { ...process.env, XENGINE_IN: join(dir, "in.jsonl"), XENGINE_OUT: join(dir, "out.jsonl") }
    });
    return parseLines(readFileSync(join(dir, "out.jsonl"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runEngines(texts) {
  const stream = texts.map((t) => asciiJson(t)).join("\n") + "\n";
  const [python, go] = await Promise.all([runPython(stream), runGo(stream)]);
  const out = { js: runJs(texts), python, go };
  for (const engine of ENGINES) {
    if (out[engine].length !== texts.length) {
      throw new Error(`${engine} returned ${out[engine].length} analyses for ${texts.length} inputs`);
    }
  }
  return out;
}

// ---- comparison -------------------------------------------------------------

/** Maps from each engine's native offset to a code-point offset. Python
 *  already counts code points; JS counts UTF-16 units, Go counts bytes. */
function codePointMaps(text) {
  const js = new Map(), go = new Map();
  let u16 = 0, bytes = 0, cp = 0;
  for (const ch of text) {
    js.set(u16, cp); go.set(bytes, cp);
    u16 += ch.length; bytes += Buffer.byteLength(ch); cp++;
  }
  js.set(u16, cp); go.set(bytes, cp);
  return { js, python: null, go };
}

const sameAll = (values) => values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]));

/** Items of each list not present in all three (multiset difference). */
function notShared(lists) {
  const count = (list) => list.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const counts = lists.map(count);
  const shared = new Map();
  for (const [x, n] of counts[0]) shared.set(x, Math.min(n, ...counts.slice(1).map((c) => c.get(x) || 0)));
  return lists.map((list) => {
    const left = new Map(shared);
    return list.filter((x) => {
      if (left.get(x) > 0) { left.set(x, left.get(x) - 1); return false; }
      return true;
    });
  });
}

/** The differing window of three strings, after their common prefix and suffix. */
function window3(strings) {
  const cps = strings.map((s) => [...s]);
  let head = 0;
  while (cps.every((c) => head < c.length && c[head] === cps[0][head])) head++;
  let tail = 0;
  while (cps.every((c) => tail < c.length - head && c[c.length - 1 - tail] === cps[0][cps[0].length - 1 - tail])) tail++;
  return cps.map((c) => c.slice(head, c.length - tail).join(""));
}

const byEngine = (values) => Object.fromEntries(ENGINES.map((e, i) => [e, values[i]]));

/** null when the three engines agree on this input, else its divergence. */
function compare(text, analyses) {
  const maps = isAscii(text) ? null : codePointMaps(text);
  const view = ENGINES.map((engine, i) => {
    const { marks, strip } = analyses[i];
    const cp = (offset) => (maps?.[engine] ? (maps[engine].has(offset) ? maps[engine].get(offset) : `?${offset}`) : offset);
    return {
      marks: marks.map(([ruleId, actual]) => `${ruleId}: ${actual}`).sort(),
      offsets: marks.map(([ruleId, , start, end]) => `${ruleId} @${cp(start)}-${cp(end)}`).sort(),
      strip
    };
  });
  const fields = [];
  if (!sameAll(view.map((v) => v.marks))) fields.push("marks");
  else if (!sameAll(view.map((v) => v.offsets))) fields.push("offsets");
  if (!sameAll(view.map((v) => v.strip))) fields.push("strip");
  if (fields.length === 0) return null;

  const [js, py, go] = view.map((v) => JSON.stringify(v));
  const engine = js === py ? "go" : js === go ? "python" : py === go ? "js" : "all";
  const record = { text, engine, fields };
  if (fields.includes("marks")) record.marks = byEngine(notShared(view.map((v) => v.marks)));
  if (fields.includes("offsets")) record.offsets = byEngine(notShared(view.map((v) => v.offsets)));
  if (fields.includes("strip")) record.strip = byEngine(window3(view.map((v) => v.strip)));
  return record;
}

const comparable = ({ reason, ...rest }) => JSON.stringify(rest);

/** One divergence per block, one field per line, so the record reads like a table. */
function formatDivergences(note, divergences) {
  const inline = (v) =>
    Array.isArray(v) ? "[" + v.map(inline).join(", ") + "]"
      : v && typeof v === "object" ? "{" + Object.entries(v).map(([k, x]) => `${asciiJson(k)}: ${inline(x)}`).join(", ") + "}"
      : asciiJson(v);
  const block = (d) => "    {\n" + Object.entries(d).map(([k, v]) => `      ${asciiJson(k)}: ${inline(v)}`).join(",\n") + "\n    }";
  return `{\n  "note": ${asciiJson(note)},\n  "divergences": [\n${divergences.map(block).join(",\n")}\n  ]\n}\n`;
}

function describe(id, d) {
  const lines = [`${id}: ${d.engine === "all" ? "all three engines differ" : `${d.engine} differs`} on ${d.fields.join(" + ")}`];
  lines.push(`    text    ${asciiJson(d.text)}`);
  for (const field of ["marks", "offsets", "strip"]) {
    if (!d[field]) continue;
    for (const engine of ENGINES) lines.push(`    ${field.padEnd(8)}${engine.padEnd(7)}${asciiJson(d[field][engine])}`);
  }
  return lines.join("\n");
}

async function differential(rows) {
  const analyses = await runEngines(rows.map((r) => r.text));
  const results = rows.map((row, i) => ({
    ...row,
    jsMarked: analyses.js[i].marks.length > 0,
    jsAgency: analyses.js[i].marks.some(([ruleId]) => ruleId === "agency-hiding.deleted-subject"),
    divergence: compare(row.text, ENGINES.map((e) => analyses[e][i]))
  }));
  return results;
}

function summarise(results) {
  const nonAscii = results.filter((r) => !isAscii(r.text));
  return {
    inputs: results.length,
    jsMarked: results.filter((r) => r.jsMarked).length,
    jsAgency: results.filter((r) => r.jsAgency).length,
    nonAscii: nonAscii.length,
    nonAsciiMarked: nonAscii.filter((r) => r.jsMarked).length,
    asciiControl: results.filter((r) => isAscii(r.text) && !isPlain(r.text)).length,
    plain: results.filter((r) => isPlain(r.text)).length,
    plainDiffs: results.filter((r) => isPlain(r.text) && r.divergence).length,
    divergences: results.filter((r) => !isPlain(r.text) && r.divergence).length
  };
}

function printCounts(label, s) {
  console.log(`${label}: ${s.inputs} inputs; ${s.jsMarked} carry at least one JS mark, ${s.jsAgency} an agency mark`);
  console.log(`  ${s.nonAscii} non-ASCII inputs (${s.nonAsciiMarked} marked); ${s.asciiControl} ASCII with control characters`);
  console.log(`  differences: ${s.plainDiffs} on ${s.plain} plain-ASCII inputs; ${s.divergences} on the other ${s.inputs - s.plain}`);
}

// ---- modes ------------------------------------------------------------------

async function check({ write }) {
  const started = performance.now();
  const failures = [];
  const { rows, counts } = collectInputs();
  const built = serialiseInputs(rows);
  const committed = existsSync(at(INPUTS)) ? readFileSync(at(INPUTS), "utf8") : null;
  if (committed !== built) {
    failures.push(`${INPUTS} is stale against its sources: run node scripts/xengine-diff.mjs --build-inputs`);
  }

  const results = await differential(rows);
  const s = summarise(results);
  printCounts("xengine", s);
  console.log(`  sources: ${counts.cases} cases, ${counts.items} item paragraphs, ${counts.contrast} contrast rows, ${counts.probes} probes, ${counts.lexicon} lexicon probes, ${counts.boundary} boundary probes (${counts.duplicates} duplicates dropped)`);

  for (const r of results) {
    if (isPlain(r.text) && r.divergence) failures.push(`plain-ASCII difference (never recordable)\n  ${describe(r.id, r.divergence)}`);
  }

  const found = results.filter((r) => !isPlain(r.text) && r.divergence);
  const recordedFile = existsSync(at(DIVERGENCES)) ? JSON.parse(readFileSync(at(DIVERGENCES), "utf8")) : { divergences: [] };
  const recorded = new Map(recordedFile.divergences.map((d) => [d.text, d]));

  if (write) {
    const divergences = found.map((r) => ({ ...r.divergence, reason: recorded.get(r.text)?.reason ?? "" }));
    const note = recordedFile.note ?? "";
    writeFileSync(at(DIVERGENCES), formatDivergences(note, divergences));
    const unexplained = divergences.filter((d) => !d.reason).length;
    console.log(`wrote ${DIVERGENCES}: ${divergences.length} divergences${unexplained ? `, ${unexplained} still need a reason` : ""}`);
    return failures;
  }

  const live = new Set(found.map((r) => r.text));
  for (const r of found) {
    const known = recorded.get(r.text);
    if (!known) failures.push(`new divergence: fix the engine, or record it with a reason in ${DIVERGENCES}\n  ${describe(r.id, r.divergence)}`);
    else if (comparable(known) !== comparable(r.divergence)) {
      failures.push(`recorded divergence changed shape\n  now:\n  ${describe(r.id, r.divergence)}\n  recorded:\n  ${describe(r.id, known)}`);
    }
  }
  const inputTexts = new Set(rows.map((r) => r.text));
  for (const d of recordedFile.divergences) {
    if (!d.reason || !String(d.reason).trim()) failures.push(`recorded divergence has no reason: ${asciiJson(d.text)}`);
    if (isPlain(d.text)) failures.push(`plain-ASCII input cannot carry a recorded divergence: ${asciiJson(d.text)}`);
    else if (!inputTexts.has(d.text)) failures.push(`recorded divergence's input is gone from ${INPUTS}; remove it: ${asciiJson(d.text)}`);
    else if (!live.has(d.text)) failures.push(`divergence resolved: the engines now agree, so remove it from ${DIVERGENCES}: ${asciiJson(d.text)}`);
  }
  if (failures.length === 0) {
    console.log(`  recorded divergences reproduced exactly: ${recordedFile.divergences.length}`);
  }
  console.log(`  ${((performance.now() - started) / 1000).toFixed(1)} s`);
  return failures;
}

async function local(path) {
  const started = performance.now();
  const { rows, read, duplicates } = readInputFile(resolve(path));
  const results = await differential(rows);
  const s = summarise(results);
  printCounts(`xengine --local ${path}`, s);
  console.log(`  read ${read} rows, ${duplicates} duplicates dropped`);
  const failures = [];
  for (const r of results) {
    if (!r.divergence) continue;
    if (isPlain(r.text)) failures.push(`plain-ASCII difference\n  ${describe(r.id, r.divergence)}`);
  }
  const rest = results.filter((r) => !isPlain(r.text) && r.divergence);
  const byKind = new Map();
  for (const r of rest) {
    const key = `${r.divergence.engine} differs on ${r.divergence.fields.join(" + ")}`;
    byKind.set(key, (byKind.get(key) || 0) + 1);
  }
  for (const [key, n] of byKind) console.log(`  ${n} x ${key}`);
  for (const r of rest.slice(0, 5)) console.log(`  ${describe(r.id, r.divergence).replace(/\n/g, "\n  ")}`);
  if (rest.length > 5) console.log(`  ... and ${rest.length - 5} more (outside plain ASCII; reported, not ratcheted)`);
  console.log(`  ${((performance.now() - started) / 1000).toFixed(1)} s`);
  return failures;
}

async function main(argv) {
  const usage = "usage: node scripts/xengine-diff.mjs [--build-inputs | --write-divergences | --local <file>]";
  if (argv[0] === "--build-inputs" && argv.length === 1) {
    const { rows, counts } = collectInputs();
    writeFileSync(at(INPUTS), serialiseInputs(rows));
    console.log(`wrote ${INPUTS}: ${rows.length} inputs (${counts.cases} cases, ${counts.items} item paragraphs, ${counts.contrast} contrast rows, ${counts.probes} probes, ${counts.lexicon} lexicon probes, ${counts.boundary} boundary probes; ${counts.duplicates} duplicates dropped)`);
    return 0;
  }
  let failures;
  if (argv.length === 0) failures = await check({ write: false });
  else if (argv[0] === "--write-divergences" && argv.length === 1) failures = await check({ write: true });
  else if (argv[0] === "--local" && argv.length === 2) failures = await local(argv[1]);
  else {
    console.error(usage);
    return 2;
  }
  if (failures.length) {
    console.error(`\nxengine: FAIL (${failures.length})\n` + failures.map((f) => `- ${f}`).join("\n"));
    return 1;
  }
  console.log("xengine: ok");
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`xengine: ${error.message}`);
  process.exitCode = 2;
}
