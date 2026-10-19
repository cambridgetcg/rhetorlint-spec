import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../packages/core/index.mjs";
import {
  BEGIN, END, GUARD_BEGIN, GUARD_END, GUARD_LEXICON, LEXICON, TARGETS, boundaryProbes, guardProblems,
  lexiconProbes, lexiconProblems, loadGuardLexicon, loadLexicon
} from "../scripts/gen-agency-lexicon.mjs";

// spec/agency-lexicon.json is the one place the accountable-passive detector's
// words live, and spec/guard-lexicon.json the one place the strip and
// absolute.universal guards' words live; scripts/gen-agency-lexicon.mjs writes
// both into the JavaScript, Python and Go engines. Two declarations, one truth,
// now a test: --check fails when any engine's generated block differs from its
// lexicon, and the probes below hold the JavaScript engine to every word the
// agency lexicon lists or excludes, and to every edge of the walks that read
// them (test/analyze.test.mjs probes the guard lexicon's words).

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const GEN = join(ROOT, "scripts", "gen-agency-lexicon.mjs");
const RULES = JSON.parse(readFileSync(join(ROOT, "packages", "rules-en", "rules.json"), "utf8"));
const LEX = loadLexicon(ROOT);
const GUARD = loadGuardLexicon(ROOT);
const GUARD_JSON = JSON.parse(readFileSync(join(ROOT, GUARD_LEXICON), "utf8"));
const AGENCY = "agency-hiding.deleted-subject";
const agency = (text) => analyze(text, { rules: RULES }).marks.filter((m) => m.ruleId === AGENCY).map((m) => m.actual);

function check(root) {
  return spawnSync(process.execPath, [GEN, "--check", ...(root ? ["--root", root] : [])], { encoding: "utf8" });
}

/** A scratch checkout holding the lexicon and the three engines, removed after `fn`. */
function withCopy(fn) {
  const dir = mkdtempSync(join(tmpdir(), "agency-lexicon-"));
  try {
    for (const path of [LEXICON, GUARD_LEXICON, ...TARGETS.map((t) => t.path)]) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      cpSync(join(ROOT, path), join(dir, path));
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the lexicon keeps the rules its JSON shape cannot express", () => {
  assert.deepEqual(lexiconProblems(LEX), []);
  assert.deepEqual(guardProblems(GUARD_JSON, LEX.negators), []);
});

test("the guards read the agency lexicon's negators and their own local ones, as one vocabulary", () => {
  assert.deepEqual(GUARD.negators, [...new Set([...LEX.negators, ...GUARD_JSON.localNegators])].sort());
  for (const n of LEX.negators) assert.ok(GUARD.negators.includes(n), `${n} is an agency negator the guards do not read`);
});

test("the lexicon checker refuses a negator in the skip list and a head class without a why", () => {
  const broken = structuredClone(LEX);
  broken.skip = [...broken.skip, "not"].sort();
  delete broken.headWhy.error;
  const problems = lexiconProblems(broken).join("\n");
  assert.match(problems, /skip: "not" is a negator/);
  assert.match(problems, /headWhy\.error: needs a why/);
});

test("the guard checker refuses a word read two ways after 'Never', an unsorted or shared negator and a line break", () => {
  const broken = structuredClone(GUARD_JSON);
  broken.neverPassThrough = [...broken.neverPassThrough, "the"].sort();
  broken.localNegators = [...broken.localNegators, "aaa"];
  broken.clauseBreaks += "\n";
  delete broken.neverNonVerbsWhy;
  let problems = guardProblems(broken, LEX.negators).join("\n");
  assert.match(problems, /neverPassThrough: "the" is also in neverNonVerbs/);
  assert.match(problems, /localNegators: must be sorted/);
  assert.match(problems, /clauseBreaks: "\\n" is not ASCII punctuation/);
  assert.match(problems, /neverNonVerbsWhy: needs a why/);
  problems = guardProblems({ ...GUARD_JSON, localNegators: ["hardly", "not"], negators: ["no"] }, LEX.negators).join("\n");
  assert.match(problems, /localNegators: "not" is already an agency negator/);
  assert.match(problems, /negators: the guards' negators are derived/);
});

test("the lexicon checker refuses a word in two classes, an unknown head class and an excluded word that is listed", () => {
  const broken = structuredClone(LEX);
  broken.classes[0].participles = [...broken.classes[0].participles, "withheld"].sort();
  broken.classes[1].head = "nouns";
  broken.excluded[0].words = [...broken.excluded[0].words, "was"].sort();
  const problems = lexiconProblems(broken).join("\n");
  assert.match(problems, /"withheld" is in both fault and conceal/);
  assert.match(problems, /head "nouns" is not a class in heads/);
  assert.match(problems, /"was" is excluded but also listed/);
});

test("the lexicon checker refuses a negator in the adverb slot and a character set it cannot render", () => {
  const broken = structuredClone(LEX);
  broken.adverbs = [...broken.adverbs, "never"].sort();
  broken.whitespace += "\u00a0";
  broken.headStops += "a";
  const problems = lexiconProblems(broken).join("\n");
  assert.match(problems, /adverbs: "never" is a negator/);
  assert.match(problems, /whitespace: "\u00a0" is not one of space, tab, LF, CR, FF or VT/);
  assert.match(problems, /headStops: "a" is not ASCII punctuation or a line break/);
});

test("every engine's generated block matches the lexicon (--check exits 0)", () => {
  const r = check();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, new RegExp(`${TARGETS.length} engines match`));
});

test("a one-word edit inside any engine's generated block fails --check with exit 1", () => {
  for (const target of TARGETS) {
    withCopy((dir) => {
      const file = join(dir, target.path);
      const source = readFileSync(file, "utf8");
      const at = source.indexOf(BEGIN);
      const until = source.indexOf(END);
      const block = source.slice(at, until);
      assert.ok(block.includes('"shelved"'), `${target.path}: the block lists "shelved"`);
      writeFileSync(file, source.slice(0, at) + block.replace('"shelved"', '"shelves"') + source.slice(until));
      const r = check(dir);
      assert.equal(r.status, 1, `${target.path}: ${r.stderr}${r.stdout}`);
      assert.ok(r.stderr.includes(target.path), r.stderr);
    });
  }
});

test("a one-word edit inside any engine's generated guard block fails --check with exit 1", () => {
  for (const target of TARGETS) {
    withCopy((dir) => {
      const file = join(dir, target.path);
      const source = readFileSync(file, "utf8");
      const at = source.indexOf(GUARD_BEGIN);
      const until = source.indexOf(GUARD_END);
      const block = source.slice(at, until);
      assert.ok(block.includes('"hardly"'), `${target.path}: the guard block lists "hardly"`);
      writeFileSync(file, source.slice(0, at) + block.replace('"hardly"', '"barely"') + source.slice(until));
      const r = check(dir);
      assert.equal(r.status, 1, `${target.path}: ${r.stderr}${r.stdout}`);
      assert.match(r.stderr, new RegExp(`${target.path}: its generated guard lexicon differs`));
    });
  }
});

test("a missing marker fails --check and leaves every engine unwritten", () => {
  for (const end of [END, GUARD_END]) {
    withCopy((dir) => {
      const go = join(dir, TARGETS[2].path);
      writeFileSync(go, readFileSync(go, "utf8").replace(`// ${end}`, "// end of the lexicon"));
      const r = check(dir);
      assert.equal(r.status, 1, r.stderr + r.stdout);
      assert.match(r.stderr, /markers are missing or out of order/);
      const js = join(dir, TARGETS[0].path);
      const before = readFileSync(js, "utf8");
      const write = spawnSync(process.execPath, [GEN, "--root", dir], { encoding: "utf8" });
      assert.notEqual(write.status, 0);
      assert.equal(readFileSync(js, "utf8"), before, "a failed write changes no engine");
    });
  }
});

test("the command line takes --check and one --root, and nothing else", () => {
  for (const args of [["--chek"], ["extra"], ["--root"], ["--root", ""], ["--check=1"], ["--root", ".", "--root", "."]]) {
    const r = spawnSync(process.execPath, [GEN, ...args], { encoding: "utf8" });
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}${r.stdout}`);
    assert.match(r.stderr, /usage:/);
  }
});

test("every participle marks its probe sentence and is silent with a 'by' agent", (t) => {
  const probes = lexiconProbes(LEX);
  const problems = [];
  for (const [id, text, span] of probes) {
    const got = agency(text);
    const want = span === null ? [] : [span];
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`${id}: ${JSON.stringify(text)} marks ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }
  assert.deepEqual(problems, []);
  const participles = LEX.classes.reduce((n, c) => n + c.participles.length, 0);
  assert.equal(probes.length, 2 * participles);
  t.diagnostic(`${participles} participles, ${probes.length} probes`);
});

test("the detector's walks stop where the lexicon says, at every edge", (t) => {
  // boundaryProbes() builds each sentence from the lexicon's numbers and
  // character sets, so these spans are the lexicon's claim about the walks.
  const probes = boundaryProbes(LEX);
  const problems = [];
  for (const [id, text, span] of probes) {
    const got = agency(text);
    const want = span === null ? [] : [span];
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`${id}: ${JSON.stringify(text)} marks ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }
  assert.deepEqual(problems, []);
  assert.equal(new Set(probes.map(([id]) => id)).size, probes.length, "probe ids are unique");
  t.diagnostic(`${probes.length} boundary probes`);
});

test("a gated participle marks only after a head word of its class", () => {
  // The same participles, after a head word that is in no class.
  for (const c of LEX.classes.filter((c) => c.head !== null)) {
    for (const p of c.participles) {
      const word = LEX.requires[p] ? `${p} ${LEX.requires[p]}` : p;
      assert.deepEqual(agency(`The samples were ${word}.`), [], `${c.id}: 'The samples were ${word}.'`);
    }
  }
});

test("the excluded words never mark", () => {
  const frames = [
    (w) => `The files were ${w}.`, (w) => `Mistakes were ${w}.`, (w) => `Your data was ${w}.`,
    (w) => `It was ${w} that the plan would end.`, (w) => `Concerns were ${w}.`
  ];
  const auxiliaries = new Set(LEX.excluded.flatMap((g) => g.words).filter((w) =>
    ["is", "are", "be", "being", "got", "gotten"].includes(w)));
  for (const group of LEX.excluded) {
    for (const word of group.words) {
      const texts = auxiliaries.has(word)
        ? [`Mistakes ${word} made.`, `Customer data ${word} accessed.`, `Records ${word} withheld.`,
           `Mistakes will ${word} made.`, `Records were ${word} withheld.`]
        : frames.map((frame) => frame(word));
      for (const text of texts) assert.deepEqual(agency(text), [], text);
    }
  }
});
