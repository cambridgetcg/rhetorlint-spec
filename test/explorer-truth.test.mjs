// The explorer (apps/explorer/index.html) is the public people page. It must
// not teach what the engine does not do. These tests hold its hand-written
// presentation data (FAMILIES, WORKED) to the rule pack, the taxonomy and the
// agency lexicon, and render its Learn and Read panels with the page's own
// script to check what a reader actually sees.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { analyze } from "../packages/core/index.mjs";
import { readTaxonomyYaml } from "../scripts/taxonomy-yaml.mjs";

const ROOT = new URL("../", import.meta.url);
const HTML = readFileSync(new URL("apps/explorer/index.html", ROOT), "utf8");
const RULES = JSON.parse(readFileSync(new URL("packages/rules-en/rules.json", ROOT), "utf8"));
const LEXICON = JSON.parse(readFileSync(new URL("spec/agency-lexicon.json", ROOT), "utf8"));
const TAXONOMY = readTaxonomyYaml(fileURLToPath(new URL("spec/taxonomy.yaml", ROOT)));

// The hand-authored part of the page script starts after the generated engine.
const ENGINE_END = "/* END GENERATED EXPLORER ENGINE */";
const AUTHORED = HTML.slice(HTML.indexOf(ENGINE_END));

function literal(name, open, close) {
  const m = AUTHORED.match(new RegExp(`const ${name} = (\\${open}[\\s\\S]*?\\n  \\${close});`));
  assert.ok(m, `the explorer's ${name} literal is missing`);
  // Through JSON, so its arrays are this realm's and compare deeply.
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${m[1]})`)));
}

const FAMILIES = literal("FAMILIES", "[", "]");
const WORKED = literal("WORKED", "{", "}");

const SHIPPED = new Set(RULES.rules.map((r) => r.technique));
const techniquesOf = (familyId) =>
  [...new Set(RULES.rules.filter((r) => r.family === familyId).map((r) => r.technique))];

// The named techniques the taxonomy holds as not yet seeded in a family. A
// family with no tells at all (justification) lists its techniques plainly.
function notYetSeeded(family) {
  const names = [
    ...(family.semeval_siblings_not_yet_seeded || []),
    ...(family.semeval_techniques_not_yet_seeded || []).map((t) => t.name),
  ];
  if (!(family.tells || []).length) {
    names.push(...(family.semeval_techniques || []).map((t) => t.name));
  }
  return [...new Set(names)];
}
const TAXONOMY_NOT_YET = new Map(TAXONOMY.families.map((f) => [f.id, notYetSeeded(f)]));

// A technique name as prose may spell it: "Name Calling or Labelling" is also
// "name-calling" and "labeling"; "Slogans" is also "slogan".
function namePatterns(name) {
  return name.split(/\s+or\s+|\//i).map((part) => {
    const words = part.toLowerCase().split(/[^a-z]+/).filter(Boolean)
      .map((w) => w.replace(/ll/g, "l{1,2}").replace(/s$/, "s?"));
    return new RegExp(`\\b${words.join("[^a-z]+")}\\b`);
  });
}

// A single-quoted example: opened after a space or "(" (so "RhetorLint's" is
// not one) and closed before a space, punctuation or the end.
const QUOTED = /(?<=^|[\s(])'([^']+)'(?=[\s,.;:)]|$)/g;
const quotedIn = (text) => [...(text || "").matchAll(QUOTED)].map((m) => m[1]);

const unescape = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/**
 * Run the page's own script against a minimal DOM, open the Learn tab, and
 * return what the Learn panel and the Read panel's tells list hold. `pack`
 * swaps the inlined rule pack, to prove what is computed from it.
 */
function renderPage(pack = null) {
  let html = HTML;
  if (pack) {
    const begin = "/* BEGIN GENERATED EXPLORER RULES */";
    const end = "/* END GENERATED EXPLORER RULES */";
    html = html.slice(0, html.indexOf(begin) + begin.length) +
      `\nconst RULES = ${JSON.stringify(pack)};\n` + html.slice(html.indexOf(end));
  }
  const open = html.indexOf('<script>\n"use strict";');
  assert.ok(open > 0, "the explorer's page script is missing");
  const source = html.slice(open + "<script>".length, html.indexOf("</script>", open));

  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, innerHTML: "", textContent: "", value: "", className: "", hidden: false, tabIndex: 0,
        style: {}, listeners: {},
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, focus() {},
        addEventListener(type, fn) { this.listeners[type] = fn; },
      });
    }
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    querySelectorAll: () => [],
    documentElement: { setAttribute() {}, removeAttribute() {} },
  };
  const localStorage = { getItem: () => null, setItem() {} };
  vm.runInNewContext(source, { document, localStorage });
  element("tab-learn").listeners.click();
  return { learn: element("learn").innerHTML, marks: element("marks").innerHTML };
}

/** The Learn panel's block for each family, keyed by family id. */
function learnSections(learnHtml) {
  const sections = new Map();
  for (const chunk of learnHtml.split('<div class="learn-fam">').slice(1)) {
    const id = chunk.match(/<span class="fid">([^<]*)<\/span>/)[1];
    sections.set(id, chunk);
  }
  return sections;
}

const scopeLine = (section, lead) => {
  const m = section.match(new RegExp(`<p class="fam-scope"><b>${lead}:</b> ([^<]*)</p>`));
  return m ? unescape(m[1]).split(" · ") : null;
};

test("FAMILIES holds the taxonomy's seven families and no hand-written detection", () => {
  assert.deepEqual(FAMILIES.map((f) => f.id), TAXONOMY.families.map((f) => f.id));
  const allowed = new Set(["id", "label", "what", "notYet", "unmarked"]);
  for (const f of FAMILIES) {
    for (const key of Object.keys(f)) {
      assert.ok(allowed.has(key),
        `${f.id}.${key}: what a family marks is read off RULES at render time, never written into FAMILIES`);
    }
    assert.equal(typeof f.what, "string", `${f.id} needs a 'what'`);
    assert.ok(Array.isArray(f.notYet), `${f.id} needs a notYet list (empty when nothing is pending)`);
  }
});

test("no technique a family lists as not yet marked ships in the pack", () => {
  for (const f of FAMILIES) {
    const shipped = f.notYet.filter((name) => SHIPPED.has(name));
    assert.deepEqual(shipped, [],
      `${f.id}: ${shipped.join(", ")} ships in ${RULES.id}@${RULES.version}, so it is not 'not yet'`);
  }
});

test("every not-yet name is one the taxonomy holds as not yet seeded, and none is left out", () => {
  for (const f of FAMILIES) {
    const taxonomy = TAXONOMY_NOT_YET.get(f.id);
    const unknown = f.notYet.filter((name) => !taxonomy.includes(name));
    assert.deepEqual(unknown, [],
      `${f.id}: ${unknown.join(", ")} is not a not-yet-seeded name in spec/taxonomy.yaml`);
    const missing = taxonomy.filter((name) => !f.notYet.includes(name));
    assert.deepEqual(missing, [],
      `${f.id}: spec/taxonomy.yaml holds ${missing.join(", ")} as not yet seeded; the page must say so`);
  }
});

test("no family's description names a technique the pack does not mark", () => {
  const unseeded = [...TAXONOMY_NOT_YET.values()].flat();
  for (const f of FAMILIES) {
    const what = f.what.toLowerCase();
    for (const name of unseeded) {
      for (const pattern of namePatterns(name)) {
        assert.doesNotMatch(what, pattern,
          `${f.id}: its description names '${name}', which no rule marks; list it in notYet instead`);
      }
    }
  }
});

test("each quoted example in a family's text is marked, or left unmarked, as the text says", () => {
  for (const f of FAMILIES) {
    for (const example of quotedIn(f.what)) {
      const marks = analyze(example, { rules: RULES }).marks.filter((m) => m.family === f.id);
      assert.ok(marks.length, `${f.id}: its description offers '${example}' as marked, but no ${f.id} rule marks it`);
    }
    // "Left unmarked" reads as no mark at all, so no family may mark it.
    for (const example of quotedIn(f.unmarked)) {
      const marks = analyze(example, { rules: RULES }).marks;
      assert.deepEqual(marks.map((m) => `${m.ruleId}: ${m.actual}`), [],
        `${f.id}: '${example}' is offered as unmarked by design, but the pack marks it`);
    }
  }
});

test("the agency-hiding description names the lexicon's passive auxiliaries", () => {
  const f = FAMILIES.find((x) => x.id === "agency-hiding");
  const m = f.what.match(/\ba ([a-z]+), ([a-z]+) or ([a-z]+) passive\b/);
  assert.ok(m, "agency-hiding's description must say which auxiliaries its passive takes ('a was, were or been passive')");
  assert.deepEqual(m.slice(1).sort(), [...LEXICON.auxiliaries].sort(),
    "agency-hiding's description and spec/agency-lexicon.json disagree on the auxiliaries");
  assert.match(f.what, /closed list/, "the description must say the verbs come from a closed list");
});

test("the 'Marks today' line and the planned badge are read off the pack at render time", () => {
  const sections = learnSections(renderPage().learn);
  assert.deepEqual([...sections.keys()], FAMILIES.map((f) => f.id));
  for (const f of FAMILIES) {
    const section = sections.get(f.id);
    const techniques = techniquesOf(f.id);
    if (techniques.length) {
      assert.deepEqual(scopeLine(section, "Marks today"), techniques, `${f.id}: 'Marks today' disagrees with the pack`);
      assert.doesNotMatch(section, /class="planned"/, `${f.id} has rules but shows 'planned'`);
    } else {
      assert.equal(scopeLine(section, "Marks today"), null, `${f.id} has no rules but claims to mark something`);
      assert.match(section, /class="planned"/, `${f.id} has no rules but no 'planned' badge`);
    }
    assert.deepEqual(scopeLine(section, "Not yet marked"), f.notYet.length ? f.notYet : null);
  }

  // Take one family's rules out of the inlined pack: the page must follow.
  const without = { ...RULES, rules: RULES.rules.filter((r) => r.family !== "attack-on-reputation") };
  const attack = learnSections(renderPage(without).learn).get("attack-on-reputation");
  assert.equal(scopeLine(attack, "Marks today"), null, "'Marks today' must come from the inlined pack");
  assert.match(attack, /class="planned"/, "the planned badge must come from the inlined pack");
});

test("every worked example fires its own rule under the current pack", () => {
  const ruleIds = RULES.rules.map((r) => r.ruleId);
  assert.deepEqual(Object.keys(WORKED).filter((id) => !ruleIds.includes(id)), [],
    "WORKED holds an example for a rule the pack does not ship");
  for (const id of ruleIds) {
    assert.ok(WORKED[id], `${id} has no worked example; the Learn tab would show an empty one`);
    const fired = analyze(WORKED[id], { rules: RULES }).marks.filter((m) => m.ruleId === id);
    assert.ok(fired.length, `${id}: its worked example "${WORKED[id]}" does not fire it`);
  }
});

test("a rule's expected text is labelled as guidance, never as an honest plain rewrite", () => {
  const { learn, marks } = renderPage();
  const shown = [...learn.matchAll(/<p class="rewrite-label">([^<]*)<\/p><div class="rewrite">([^<]*)<\/div>/g)];
  const withExpected = RULES.rules.filter((r) => r.expected && r.expected.length);
  assert.equal(shown.length, withExpected.length, "the Learn tab shows each rule's expected text once");
  for (const [, label, text] of shown) {
    assert.equal(label, "Guidance", `"${unescape(text)}" is labelled '${label}'`);
    assert.ok(withExpected.some((r) => r.expected[0] === unescape(text)), `"${unescape(text)}" is not a rule's expected text`);
  }

  const plain = [...marks.matchAll(/<div class="mark-plain"><b>([^<]*)<\/b> ([^<]*)<\/div>/g)];
  assert.ok(plain.length, "the Read tab's specimen shows the expected text of its marks");
  for (const [, label] of plain) assert.equal(label, "Guidance:", `the Read tab labels expected text '${label}'`);
  assert.ok(!HTML.includes("Honest plain rewrite"), "'Honest plain rewrite' must not label bracketed guidance");
});

test("the strip legend claims no more than the strip flags", () => {
  // The corporate example's 'accounts were suspended' is an agentless passive
  // the strip leaves alone: only the passives the agency-hiding rule marks get
  // a [who?].
  const legend = HTML.match(/<p class="strip-legend">([\s\S]*?)<\/p>/)[1];
  assert.doesNotMatch(legend, /each agentless passive/i);
  assert.match(legend, /each passive the agency-hiding rule marks/);
});
