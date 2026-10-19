import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";

// Smart punctuation must not silence a tell that its ASCII spelling marks.
// rules-en spells the typographic variants inside the pack, with no engine
// change: a pattern writes an apostrophe as ['\u2019] and a hyphen as
// [-\u2010\u2011\u2013] (plus space where the ASCII class had one), and a
// lexical rule lists each hyphenated or apostrophised term once per variant.
// These tests pin the twelve probes all three engines share, and keep the
// doubled spellings from drifting apart: a new ASCII term or pattern literal
// with an apostrophe or hyphen fails here until its variants are spelt too.
// Escapes keep every variant visible in review: U+2011 looks like '-'.

const rules = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));
const marksOf = (text) => analyze(text, { rules }).marks.map((m) => [m.ruleId, m.actual]);
const spansOf = (text, ruleId) =>
  analyze(text, { rules }).marks.filter((m) => m.ruleId === ruleId).map((m) => m.actual);
const show = (s) => JSON.stringify(s).replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

const RSQUO = "\u2019"; // RIGHT SINGLE QUOTATION MARK, the typographic apostrophe
const DASHES = ["\u2010", "\u2011", "\u2013"]; // HYPHEN, NON-BREAKING HYPHEN, EN DASH
const toAscii = (s) => s.replace(/\u2019/g, "'").replace(/[\u2010\u2011\u2013]/g, "-");

/** Every typographic spelling of an ASCII string: apostrophes become U+2019,
 *  and all of its hyphens become one dash at a time. */
function variantsOf(ascii) {
  const curled = ascii.replace(/'/g, RSQUO);
  if (!ascii.includes("-")) return curled === ascii ? [] : [curled];
  return DASHES.map((dash) => curled.replace(/-/g, dash));
}

// The twelve probes, each the same tell as its ASCII twin. Mirrored, ruleId
// and actual only, in impl/python/test_rhetorlint.py and
// impl/go/rhetorlint_test.go; measurement/contrast.json rows typo.01-12 carry
// the same texts, so the three-engine differential reads them too.
const PROBES = [
  ["Let\u2019s not forget their record.", "deflection.whataboutism", "Let\u2019s not forget"],
  ["Don\u2019t miss out on this deal.", "urgency.appeal-to-time", "Don\u2019t miss out"],
  ["It\u2019s worth noting the date.", "editorializing.stance", "It\u2019s worth noting"],
  ["He didn\u2019t even bother to reply.", "implicative.shortfall", "didn\u2019t even bother to"],
  ["Try it risk\u2011free today.", "lure.free-offer", "risk\u2011free"],
  ["These so\u2011called experts.", "distancing.doubt-marker", "so\u2011called"],
  ["An officer\u2013involved shooting.", "exoneration.formula", "officer\u2013involved shooting"],
  ["A world\u2011class team.", "puffery.peacock", "world\u2011class"],
  ["Sources with first\u2011hand knowledge of the matter.", "sourcing.anonymous", "Sources with first\u2011hand knowledge of the matter"],
  ["It\u2019s important to note the timing.", "editorializing.stance", "It\u2019s important to note"],
  ["Act before it\u2019s too late.", "urgency.appeal-to-time", "before it\u2019s too late"],
  ["A self\u2011proclaimed expert.", "distancing.doubt-marker", "self\u2011proclaimed"]
];

// One ASCII phrase per pattern rule whose source spells an apostrophe or a
// hyphen class, covering each such literal. Each must mark as written, and in
// every typographic variant.
const PATTERN_LITERALS = {
  "deflection.whataboutism": ["let's not forget"],
  "urgency.appeal-to-time": ["don't miss out", "before it's too late"],
  "implicative.shortfall": ["didn't even bother to", "doesn't bother to"],
  "lure.free-offer": ["risk-free"],
  "sourcing.anonymous": ["sources with first-hand knowledge of the matter"],
  "exoneration.formula": ["officer-involved shooting", "use-of-force incident"]
};

/**
 * The character classes of a pattern source, and any apostrophe or hyphen
 * written outside one. A hyphen inside a class is literal when it opens or
 * closes the class or is escaped; elsewhere it is a range (a-z, \x00-\x40).
 */
function scanPattern(source) {
  const classes = [];
  const loose = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") {
      if (source[i + 1] === "'" || source[i + 1] === "-") loose.push(source[i + 1]);
      i++;
      continue;
    }
    if (c === "'" || c === "-") {
      loose.push(c);
      continue;
    }
    if (c !== "[") continue;
    const tokens = [];
    let j = i + 1;
    if (source[j] === "^") j++;
    for (; j < source.length && source[j] !== "]"; j++) {
      if (source[j] === "\\") {
        tokens.push(source.slice(j, j + 2));
        j++;
      } else tokens.push(source[j]);
    }
    const literalHyphen = tokens.includes("\\-") || tokens[0] === "-" || tokens[tokens.length - 1] === "-";
    classes.push({ text: source.slice(i, j + 1), tokens, literalHyphen });
    i = j;
  }
  return { classes, loose };
}

test("the twelve typographic probes mark exactly what their ASCII twins mark", () => {
  for (const [text, ruleId, actual] of PROBES) {
    assert.deepEqual(marksOf(text), [[ruleId, actual]], `${show(text)}`);
    assert.deepEqual(marksOf(toAscii(text)), [[ruleId, toAscii(actual)]], `ASCII twin of ${show(text)}`);
  }
});

test("every lexical term with an apostrophe or hyphen lists, and marks, each typographic variant", () => {
  const problems = [];
  for (const rule of rules.rules.filter((r) => r.type === "lexical")) {
    for (const term of rule.terms.filter((t) => /['-]/.test(t))) {
      if (spansOf(term, rule.ruleId)[0] !== term) problems.push(`${rule.ruleId}: ${show(term)} does not mark itself`);
      for (const variant of variantsOf(term)) {
        if (!rule.terms.includes(variant)) problems.push(`${rule.ruleId}: ${show(term)} has no variant ${show(variant)} in terms`);
        else if (spansOf(variant, rule.ruleId)[0] !== variant) problems.push(`${rule.ruleId}: ${show(variant)} does not mark`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every typographic lexical term is the variant of an ASCII term in the same list", () => {
  const problems = [];
  for (const rule of rules.rules.filter((r) => r.type === "lexical")) {
    for (const term of rule.terms.filter((t) => /[^\x20-\x7e]/.test(t))) {
      const ascii = toAscii(term);
      if (!rule.terms.includes(ascii) || !variantsOf(ascii).includes(term)) {
        problems.push(`${rule.ruleId}: ${show(term)} is not a listed variant of an ASCII term (${show(ascii)})`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every apostrophe and hyphen in a pattern admits its typographic variants", () => {
  const problems = [];
  for (const rule of rules.rules.filter((r) => r.type === "pattern")) {
    const { classes, loose } = scanPattern(rule.pattern);
    for (const c of loose) {
      problems.push(`${rule.ruleId}: ${show(c)} outside a character class; write ${c === "'" ? "['\\u2019]" : "[-\\u2010\\u2011\\u2013]"}`);
    }
    for (const { text, tokens, literalHyphen } of classes) {
      if (tokens.includes("'") && !tokens.includes(RSQUO)) problems.push(`${rule.ruleId}: ${show(text)} admits ' but not U+2019`);
      if (literalHyphen) {
        for (const dash of DASHES.filter((d) => !tokens.includes(d))) {
          problems.push(`${rule.ruleId}: ${show(text)} admits '-' but not ${show(dash)}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every pattern literal with an apostrophe or hyphen marks in each typographic variant", () => {
  const problems = [];
  const sensitive = rules.rules
    .filter((r) => r.type === "pattern")
    .filter((r) => {
      const { classes, loose } = scanPattern(r.pattern);
      return loose.length > 0 || classes.some((c) => c.tokens.includes("'") || c.literalHyphen);
    })
    .map((r) => r.ruleId);
  assert.deepEqual(Object.keys(PATTERN_LITERALS).sort(), sensitive.sort(),
    "PATTERN_LITERALS names exactly the pattern rules that spell an apostrophe or a hyphen class");
  for (const [ruleId, phrases] of Object.entries(PATTERN_LITERALS)) {
    for (const ascii of phrases) {
      assert.match(ascii, /['-]/, `${ruleId}: ${show(ascii)} has no apostrophe or hyphen to vary`);
      for (const text of [ascii, ...variantsOf(ascii)]) {
        const spans = spansOf(text, ruleId);
        if (spans.length !== 1 || spans[0] !== text) problems.push(`${ruleId}: ${show(text)} marks ${show(spans)}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the variants live in the pack, so no rule that spells one needs an engine floor", () => {
  for (const rule of rules.rules) {
    const spelt = rule.type === "pattern" ? rule.pattern : rule.type === "lexical" ? rule.terms.join("\n") : "";
    if (!/[\u2019\u2010\u2011\u2013]/.test(spelt)) continue;
    assert.equal(rule.minEngine, undefined, `${rule.ruleId}: typographic variants must not raise the engine floor`);
    assert.equal(rule.caseSensitive, undefined, `${rule.ruleId}: typographic variants must not depend on caseSensitive`);
  }
});
