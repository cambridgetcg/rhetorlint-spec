import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../packages/core/index.mjs";
import {
  BEGIN, END, LEXICON, TARGETS, lexiconProbes, lexiconProblems, loadLexicon
} from "../scripts/gen-agency-lexicon.mjs";

// spec/agency-lexicon.json is the one place the accountable-passive detector's
// words live; scripts/gen-agency-lexicon.mjs writes them into the JavaScript,
// Python and Go engines. Two declarations, one truth, now a test: --check fails
// when any engine's generated block differs from the lexicon, and the probes
// below hold the JavaScript engine to every word the lexicon lists or excludes.

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const GEN = join(ROOT, "scripts", "gen-agency-lexicon.mjs");
const RULES = JSON.parse(readFileSync(join(ROOT, "packages", "rules-en", "rules.json"), "utf8"));
const LEX = loadLexicon(ROOT);
const AGENCY = "agency-hiding.deleted-subject";
const agency = (text) => analyze(text, { rules: RULES }).marks.filter((m) => m.ruleId === AGENCY).map((m) => m.actual);

function check(root) {
  return spawnSync(process.execPath, [GEN, "--check", ...(root ? ["--root", root] : [])], { encoding: "utf8" });
}

/** A scratch checkout holding the lexicon and the three engines, removed after `fn`. */
function withCopy(fn) {
  const dir = mkdtempSync(join(tmpdir(), "agency-lexicon-"));
  try {
    for (const path of [LEXICON, ...TARGETS.map((t) => t.path)]) {
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

test("a missing marker fails --check and leaves every engine unwritten", () => {
  withCopy((dir) => {
    const go = join(dir, TARGETS[2].path);
    writeFileSync(go, readFileSync(go, "utf8").replace(`// ${END}`, "// end of the lexicon"));
    const r = check(dir);
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /markers are missing or out of order/);
    const js = join(dir, TARGETS[0].path);
    const before = readFileSync(js, "utf8");
    const write = spawnSync(process.execPath, [GEN, "--root", dir], { encoding: "utf8" });
    assert.notEqual(write.status, 0);
    assert.equal(readFileSync(js, "utf8"), before, "a failed write changes no engine");
  });
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
