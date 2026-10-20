import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";
import { parseTaxonomyYaml, TaxonomyYamlError } from "../scripts/taxonomy-yaml.mjs";

// spec/taxonomy.yaml and packages/rules-en/rules.json both declare every tell:
// its id, its family, its SemEval technique. No engine reads the taxonomy, so
// nothing but this test keeps the two declarations telling one truth. It also
// holds the syllabus to the engine: every lesson must mark its own tell and
// every plain rewrite must draw no marks, except where a disagreement is
// declared beside the lesson (plain_also_marks, known_gaps). Declarations are
// strict both ways, so a fixed defect cannot leave a stale excuse behind.

const TAXONOMY = "spec/taxonomy.yaml";
const PACK = "packages/rules-en/rules.json";
const SCHEMA = "spec/output.schema.json";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const taxonomy = parseTaxonomyYaml(read(TAXONOMY));
const pack = JSON.parse(read(PACK));
const schema = JSON.parse(read(SCHEMA));

// SemEval-2023 Task 3's 23 fine techniques under its six coarse parents
// (Piskorski et al. 2023, ACL Anthology 2023.semeval-1.317; 5+5+3+3+3+4),
// spelled as spec/taxonomy.yaml and the packs spell them.
const SEMEVAL_2023 = {
  "Manipulative Wording": ["Loaded Language", "Obfuscation, Intentional Vagueness, Confusion",
    "Exaggeration or Minimisation", "Repetition"],
  "Simplification": ["Causal Oversimplification", "False Dilemma or No Choice",
    "Consequential Oversimplification"],
  "Distraction": ["Straw Man", "Red Herring", "Whataboutism"],
  "Attack on Reputation": ["Name Calling or Labelling", "Guilt by Association", "Doubt",
    "Appeal to Hypocrisy", "Questioning the Reputation"],
  "Justification": ["Flag Waving", "Appeal to Authority", "Appeal to Popularity",
    "Appeal to Values", "Appeal to Fear/Prejudice"],
  "Call": ["Slogans", "Conversation Killer", "Appeal to Time"],
};
// The taxonomy names not-yet-seeded techniques under three spellings.
const NOT_YET_SEEDED_KEYS = [
  "semeval_siblings_not_yet_seeded", "semeval_techniques_not_yet_seeded", "semeval_techniques",
];
const EXTENSION_LABEL = "RhetorLint extension";
const DECLARATION_KEYS = { example: "plain_also_marks", tell: ["known_gaps", "guard_examples"] };
const PLAIN_MARK_KEYS = ["ruleId", "actual", "status", "tag", "reason"];
const GAP_KEYS = ["tell", "tag", "reason"];
const GUARD_KEYS = ["text", "expect", "actual"];
const TAG = /^O[0-9]+$/;

const tellsOf = (tax) =>
  tax.families.flatMap((f) => (f.tells ?? []).map((t) => ({ ...t, family: f.id })));
const list = (xs) => `[${[...xs].join(", ")}]`;
const quoted = (s) => JSON.stringify(s);
const nameOf = (entry) => (typeof entry === "string" ? entry : entry?.name);

function unknownKeys(entry, allowed, where) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [`${where}: must be a mapping`];
  return Object.keys(entry).filter((k) => !allowed.includes(k))
    .map((k) => `${where}: unknown key '${k}' (allowed: ${allowed.join(", ")})`);
}

function needText(value, field, where) {
  return typeof value === "string" && value.trim() !== "" ? [] : [`${where}: '${field}' must be a non-empty string`];
}

/** Tell ids in the taxonomy and ruleIds in the pack are the same set. */
function idProblems(tax, rules) {
  const problems = [];
  const tellIds = tellsOf(tax).map((t) => t.id);
  const ruleIds = rules.rules.map((r) => r.ruleId);
  for (const [ids, file, kind] of [[tellIds, TAXONOMY, "tell id"], [ruleIds, PACK, "ruleId"]]) {
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) problems.push(`${file}: duplicate ${kind}s ${list(new Set(dup))}`);
  }
  const onlyTax = tellIds.filter((id) => !ruleIds.includes(id));
  const onlyPack = ruleIds.filter((id) => !tellIds.includes(id));
  if (onlyTax.length || onlyPack.length) {
    problems.push(`tell ids in ${TAXONOMY} and ruleIds in ${PACK} disagree: ` +
      `only in ${TAXONOMY}: ${list(onlyTax)}; only in ${PACK}: ${list(onlyPack)}`);
  }
  return problems;
}

/** Each tell's family and semeval_technique equal its rule's, verbatim. */
function labelProblems(tax, rules) {
  const byId = new Map(rules.rules.map((r) => [r.ruleId, r]));
  const problems = [];
  for (const t of tellsOf(tax)) {
    const r = byId.get(t.id);
    if (!r) continue; // reported by idProblems
    if (r.family !== t.family) {
      problems.push(`${t.id}: family is ${quoted(t.family)} in ${TAXONOMY} but ${quoted(r.family)} in ${PACK}`);
    }
    if (r.technique !== t.semeval_technique) {
      problems.push(`${t.id}: technique is ${quoted(t.semeval_technique)} in ${TAXONOMY} ` +
        `but ${quoted(r.technique)} in ${PACK}`);
    }
  }
  return problems;
}

/** Per family: seeded_tells (where stated) == tells listed == rules shipped. */
function countProblems(tax, rules) {
  const problems = [];
  for (const f of tax.families) {
    const listed = (f.tells ?? []).length;
    const shipped = rules.rules.filter((r) => r.family === f.id).length;
    if (f.seeded_tells !== undefined && f.seeded_tells !== listed) {
      problems.push(`${f.id}: seeded_tells says ${f.seeded_tells} but ${TAXONOMY} lists ${listed} tells`);
    }
    if (listed !== shipped) {
      problems.push(`${f.id}: ${TAXONOMY} lists ${listed} tells but ${PACK} ships ${shipped} rules`);
    }
  }
  const known = new Set(tax.families.map((f) => f.id));
  for (const r of rules.rules) {
    if (!known.has(r.family)) problems.push(`${r.ruleId}: family ${quoted(r.family)} in ${PACK} is not a family in ${TAXONOMY}`);
  }
  return problems;
}

/** The taxonomy's family ids are exactly the output schema's family enum. */
function familyEnumProblems(tax, outputSchema) {
  const families = tax.families.map((f) => f.id);
  const enumFamilies = outputSchema.$defs.mark.properties.family.enum;
  const onlyTax = families.filter((f) => !enumFamilies.includes(f));
  const onlyEnum = enumFamilies.filter((f) => !families.includes(f));
  if (!onlyTax.length && !onlyEnum.length && families.length === enumFamilies.length) return [];
  return [`families in ${TAXONOMY} and the family enum in ${SCHEMA} disagree: ` +
    `only in ${TAXONOMY}: ${list(onlyTax)}; only in ${SCHEMA}: ${list(onlyEnum)}`];
}

/**
 * Per SemEval parent, the techniques its tells ship plus the techniques it
 * names as not yet seeded are exactly that parent's SemEval-2023 list, with no
 * technique both seeded and "not yet seeded". A family outside SemEval must
 * say so in every technique label it ships.
 */
function semevalCoverage(tax) {
  const problems = [];
  let seededTotal = 0;
  let namedOnlyTotal = 0;
  const parentsSeen = [];
  for (const f of tax.families) {
    const where = `${TAXONOMY} family ${f.id}`;
    const expected = SEMEVAL_2023[f.semeval_parent];
    const seeded = new Set((f.tells ?? []).map((t) => t.semeval_technique));
    if (!expected) {
      for (const t of f.tells ?? []) {
        if (!String(t.semeval_technique).includes(EXTENSION_LABEL)) {
          problems.push(`${where}: parent ${quoted(f.semeval_parent)} is not a SemEval-2023 parent, ` +
            `so ${t.id}'s technique must carry "${EXTENSION_LABEL}"`);
        }
      }
      continue;
    }
    parentsSeen.push(f.semeval_parent);
    const spellings = NOT_YET_SEEDED_KEYS.filter((k) => f[k] !== undefined)
      .map((k) => ({ key: k, names: f[k].map(nameOf) }));
    for (const s of spellings.slice(1)) {
      if (list([...s.names].sort()) !== list([...spellings[0].names].sort())) {
        problems.push(`${where}: ${spellings[0].key} ${list(spellings[0].names)} and ${s.key} ${list(s.names)} disagree`);
      }
    }
    const named = new Set(spellings.flatMap((s) => s.names));
    for (const n of named) {
      if (seeded.has(n)) problems.push(`${where}: ${quoted(n)} is seeded but also listed as not yet seeded`);
    }
    const union = new Set([...seeded, ...named]);
    const missing = expected.filter((n) => !union.has(n));
    const extra = [...union].filter((n) => !expected.includes(n));
    if (missing.length || extra.length) {
      problems.push(`${where}: seeded + not-yet-seeded techniques do not cover SemEval-2023 ` +
        `${quoted(f.semeval_parent)}: missing ${list(missing)}; not in SemEval ${list(extra)}`);
    }
    seededTotal += [...seeded].filter((n) => expected.includes(n)).length;
    namedOnlyTotal += [...named].filter((n) => expected.includes(n) && !seeded.has(n)).length;
  }
  const absent = Object.keys(SEMEVAL_2023).filter((p) => !parentsSeen.includes(p));
  if (absent.length) problems.push(`${TAXONOMY}: no family for SemEval-2023 parents ${list(absent)}`);
  const total = Object.values(SEMEVAL_2023).flat().length;
  return { problems, seeded: seededTotal, namedOnly: namedOnlyTotal, total };
}

function ownMarks(text, ruleId, rules) {
  return analyze(text, { rules }).marks.filter((m) => m.ruleId === ruleId);
}

/**
 * Each example's tell sits inside its marked text, and the marked text fires
 * the tell's own rule on a span overlapping the tell, unless known_gaps
 * declares that example. A declared gap that now fires is a failure too.
 */
function lessonProblems(tax, rules) {
  const problems = [];
  let examples = 0;
  let firing = 0;
  let gaps = 0;
  for (const t of tellsOf(tax)) {
    for (const k of Object.keys(t)) {
      if (/^(known_gap|guard_example|plain_also_mark)/.test(k) && !DECLARATION_KEYS.tell.includes(k)) {
        problems.push(`${t.id}: '${k}' is not a declaration this test reads (did you mean ${DECLARATION_KEYS.tell.join(" or ")}?)`);
      }
    }
    const declared = t.known_gaps ?? [];
    for (const [i, g] of declared.entries()) {
      const where = `${t.id} known_gaps[${i}]`;
      problems.push(...unknownKeys(g, GAP_KEYS, where), ...needText(g.tell, "tell", where),
        ...needText(g.reason, "reason", where));
      if (!TAG.test(g.tag ?? "")) problems.push(`${where}: 'tag' must name the open defect (O<n>)`);
      const hits = (t.examples ?? []).filter((ex) => ex.tell === g.tell).length;
      if (hits !== 1) problems.push(`${where}: tell ${quoted(g.tell)} matches ${hits} examples of ${t.id}, not 1`);
    }
    for (const [i, ex] of (t.examples ?? []).entries()) {
      examples++;
      const where = `LESSON ${t.id} example ${i + 1} (${quoted(ex.marked)})`;
      const hay = ex.marked.toLowerCase();
      const needle = ex.tell.toLowerCase();
      const at = hay.indexOf(needle);
      if (at < 0) { problems.push(`${where}: tell ${quoted(ex.tell)} is not inside the marked text`); continue; }
      if (hay.indexOf(needle, at + 1) >= 0) problems.push(`${where}: tell ${quoted(ex.tell)} occurs more than once`);
      const own = ownMarks(ex.marked, t.id, rules);
      const onTell = own.some((m) => m.position.start.offset < at + ex.tell.length && m.position.end.offset > at);
      const gap = declared.some((g) => g.tell === ex.tell);
      if (onTell && gap) problems.push(`${where}: ${t.id} now marks ${quoted(ex.tell)} — remove known_gaps entry`);
      else if (onTell) firing++;
      else if (gap) gaps++;
      else {
        problems.push(`${where}: ${t.id} does not mark its tell ${quoted(ex.tell)} ` +
          `(its marks here: ${list(own.map((m) => quoted(m.actual)))}) — fix the rule or declare it in known_gaps`);
      }
    }
  }
  return { problems, examples, firing, gaps };
}

/**
 * Each plain rewrite draws exactly the marks its plain_also_marks declares:
 * no undeclared mark, and no declaration the engine no longer needs.
 */
function plainProblems(tax, rules) {
  const problems = [];
  const ruleIds = new Set(rules.rules.map((r) => r.ruleId));
  let marked = 0;
  const byStatus = {};
  for (const t of tellsOf(tax)) {
    for (const [i, ex] of (t.examples ?? []).entries()) {
      const where = `PLAIN ${t.id} example ${i + 1} (${quoted(ex.plain)})`;
      for (const k of Object.keys(ex)) {
        if (/^(plain_also|known_gap|guard_example)/.test(k) && k !== DECLARATION_KEYS.example) {
          problems.push(`${where}: '${k}' is not a declaration this test reads (did you mean ${DECLARATION_KEYS.example}?)`);
        }
      }
      const declared = ex.plain_also_marks ?? [];
      for (const [j, d] of declared.entries()) {
        const at = `${where} plain_also_marks[${j}]`;
        problems.push(...unknownKeys(d, PLAIN_MARK_KEYS, at), ...needText(d.actual, "actual", at),
          ...needText(d.reason, "reason", at));
        if (!ruleIds.has(d.ruleId)) problems.push(`${at}: ruleId ${quoted(d.ruleId)} is not a rule in ${PACK}`);
        if (d.status === "known-defect") {
          if (!TAG.test(d.tag ?? "")) problems.push(`${at}: a known-defect must name its open defect in 'tag' (O<n>)`);
        } else if (d.status === "correct") {
          if (d.tag !== undefined) problems.push(`${at}: a correct mark carries no defect tag`);
        } else {
          problems.push(`${at}: status must be 'correct' or 'known-defect', not ${quoted(d.status)}`);
        }
      }
      const actual = analyze(ex.plain, { rules }).marks.map((m) => ({ ruleId: m.ruleId, actual: m.actual }));
      if (actual.length) marked++;
      const unmatched = [...declared];
      for (const m of actual) {
        const k = unmatched.findIndex((d) => d.ruleId === m.ruleId && d.actual === m.actual);
        if (k < 0) {
          problems.push(`${where}: draws an undeclared mark ${m.ruleId} ${quoted(m.actual)} — ` +
            "declare it in plain_also_marks with its status, or fix the engine");
          continue;
        }
        const [d] = unmatched.splice(k, 1);
        const label = d.status === "known-defect" ? d.tag : d.status;
        byStatus[label] = (byStatus[label] ?? 0) + 1;
      }
      for (const d of unmatched) {
        problems.push(`${where}: the engine no longer marks ${d.ruleId} ${quoted(d.actual)} — remove the plain_also_marks entry`);
      }
    }
  }
  return { problems, marked, byStatus };
}

/** Each guard_examples entry is marked or unmarked by its tell's rule as declared. */
function guardProblems(tax, rules) {
  const problems = [];
  let count = 0;
  for (const t of tellsOf(tax)) {
    for (const [i, g] of (t.guard_examples ?? []).entries()) {
      count++;
      const where = `GUARD ${t.id} guard_examples[${i}] (${quoted(g?.text)})`;
      const shape = [...unknownKeys(g, GUARD_KEYS, where), ...needText(g?.text, "text", where)];
      if (g?.actual !== undefined) shape.push(...needText(g.actual, "actual", where));
      if (g?.expect !== "marked" && g?.expect !== "unmarked") shape.push(`${where}: expect must be 'marked' or 'unmarked'`);
      if (g?.expect === "unmarked" && g?.actual !== undefined) shape.push(`${where}: an unmarked guard has no 'actual'`);
      if (shape.length) { problems.push(...shape); continue; }
      const own = ownMarks(g.text, t.id, rules);
      if (g.expect === "unmarked" && own.length) {
        problems.push(`${where}: must stay unmarked by ${t.id} but is marked on ${list(own.map((m) => quoted(m.actual)))}`);
      }
      if (g.expect === "marked") {
        if (!own.length) problems.push(`${where}: must be marked by ${t.id} but is not`);
        else if (g.actual !== undefined && !own.some((m) => m.actual === g.actual)) {
          problems.push(`${where}: must be marked on ${quoted(g.actual)} but ${t.id} marks ${list(own.map((m) => quoted(m.actual)))}`);
        }
      }
    }
  }
  return { problems, count };
}

// --- the shipped files agree ------------------------------------------------

test("taxonomy tell ids are exactly the pack's ruleIds", () => {
  assert.deepEqual(idProblems(taxonomy, pack), []);
  assert.equal(tellsOf(taxonomy).length, pack.rules.length);
});

test("each tell's family and SemEval technique equal its rule's, verbatim", () => {
  assert.deepEqual(labelProblems(taxonomy, pack), []);
});

test("per family, seeded_tells == tells listed == rules shipped", () => {
  assert.deepEqual(countProblems(taxonomy, pack), []);
});

test("taxonomy family ids are the output schema's family enum", () => {
  assert.deepEqual(familyEnumProblems(taxonomy, schema), []);
});

test("seeded plus not-yet-seeded techniques cover SemEval-2023's 23, per parent", (t) => {
  const all = Object.values(SEMEVAL_2023).flat();
  assert.equal(new Set(all).size, 23, "the reference list itself holds 23 distinct techniques");
  const { problems, seeded, namedOnly, total } = semevalCoverage(taxonomy);
  assert.deepEqual(problems, []);
  assert.equal(seeded + namedOnly, total);
  t.diagnostic(`SemEval-2023 techniques: ${seeded}/${total} seeded, ${namedOnly}/${total} named-only`);
});

test("every lesson marks its own tell, except a declared known gap", (t) => {
  const { problems, examples, firing, gaps } = lessonProblems(taxonomy, pack);
  assert.deepEqual(problems, []);
  assert.equal(firing + gaps, examples);
  t.diagnostic(`${examples} examples: ${firing} lessons mark their tell, ${gaps} known gap(s)`);
});

test("every plain rewrite draws exactly the marks it declares", (t) => {
  const { problems, marked, byStatus } = plainProblems(taxonomy, pack);
  assert.deepEqual(problems, []);
  const order = (k) => (k === "correct" ? -1 : Number(k.slice(1)));
  const declared = Object.entries(byStatus).sort(([a], [b]) => order(a) - order(b))
    .map(([k, n]) => `${n} ${k}`).join(", ") || "none";
  const examples = tellsOf(taxonomy).flatMap((x) => x.examples ?? []).length;
  t.diagnostic(`plain rewrites marked: ${marked}/${examples}, all declared (${declared}); 0 undeclared`);
});

test("every guard example holds", (t) => {
  const { problems, count } = guardProblems(taxonomy, pack);
  assert.deepEqual(problems, []);
  t.diagnostic(`guard examples checked: ${count}`);
});

// --- the checks can fail ----------------------------------------------------

const renamedRule = (from, to) => ({
  ...pack, rules: pack.rules.map((r) => (r.ruleId === from ? { ...r, ruleId: to } : r)),
});
function editTell(id, edit) {
  const tax = structuredClone(taxonomy);
  for (const f of tax.families) for (const t of f.tells ?? []) if (t.id === id) edit(t);
  return tax;
}

test("a ruleId renamed on one side only fails, naming both sides", () => {
  for (const [tax, rules] of [
    [taxonomy, renamedRule("hedge.deniable", "hedge.deniable-x")],
    [editTell("hedge.deniable", (t) => { t.id = "hedge.deniable-x"; }), pack],
  ]) {
    const [message, ...rest] = idProblems(tax, rules);
    assert.equal(rest.length, 0);
    for (const part of [TAXONOMY, PACK, "hedge.deniable", "hedge.deniable-x"]) assert.ok(message.includes(part), message);
  }
});

test("a family or technique changed on one side only fails, naming both sides", () => {
  const rules = { ...pack, rules: pack.rules.map((r) => (r.ruleId === "puffery.peacock" ? { ...r, technique: "Loaded Language" } : r)) };
  const [message] = labelProblems(taxonomy, rules);
  for (const part of [TAXONOMY, PACK, "Exaggeration or Minimisation", "Loaded Language"]) assert.ok(message.includes(part), message);
  const moved = editTell("puffery.peacock", (t) => { t.semeval_technique = "Repetition"; });
  assert.equal(labelProblems(moved, pack).length, 1);
});

test("a known gap that now fires fails with 'remove known_gaps entry'", () => {
  const tax = editTell("intensifier.loaded", (t) => {
    t.known_gaps = [{ tell: "extremely", tag: "O9", reason: "fixture" }];
  });
  const injected = lessonProblems(tax, pack).problems.filter((p) => p.includes("intensifier.loaded"));
  assert.equal(injected.length, 1, injected.join("\n"));
  assert.match(injected[0], /now marks "extremely" — remove known_gaps entry/);
});

test("an undeclared plain mark fails, and so does a stale declaration", () => {
  const undeclared = editTell("hedge.deniable", (t) => { delete t.examples[0].plain_also_marks; });
  assert.match(plainProblems(undeclared, pack).problems.join("\n"), /undeclared mark agency-hiding\.deleted-subject "were exposed"/);
  const stale = editTell("hedge.softener", (t) => {
    t.examples[0].plain_also_marks = [{ ruleId: "absolute.universal", actual: "never", status: "known-defect", tag: "O6", reason: "fixture" }];
  });
  assert.match(plainProblems(stale, pack).problems.join("\n"), /no longer marks absolute\.universal "never" — remove the plain_also_marks entry/);
});

test("a guard example the engine breaks fails", () => {
  const tax = editTell("absolute.universal", (t) => {
    t.guard_examples = [
      { text: "Everyone knows this policy works.", expect: "unmarked" },
      { text: "Results vary.", expect: "marked" },
      { text: "Everyone knows this policy works.", expect: "marked", actual: "Everyone" },
    ];
  });
  const { problems, count } = guardProblems(tax, pack);
  assert.equal(count, 3);
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems[0], /must stay unmarked by absolute\.universal but is marked on \["Everyone"\]/);
  assert.match(problems[1], /must be marked by absolute\.universal but is not/);
});

test("a technique outside its SemEval parent fails coverage", () => {
  const tax = editTell("deflection.whataboutism", (t) => { t.semeval_technique = "Slogans"; });
  assert.match(semevalCoverage(tax).problems.join("\n"), /Distraction.*not in SemEval \[Slogans\]/);
});

// --- the reader fails closed ------------------------------------------------

const REJECTS = new URL("fixtures/taxonomy-yaml-rejects/", import.meta.url);

test("every reject fixture throws with its line number", () => {
  const files = readdirSync(REJECTS).filter((f) => f.endsWith(".yaml")).sort();
  for (const needed of ["anchor", "tag", "single-quoted", "literal-block", "tab-indent", "duplicate-key"]) {
    assert.ok(files.includes(`${needed}.yaml`), `missing reject fixture ${needed}.yaml`);
  }
  for (const file of files) {
    const text = readFileSync(new URL(file, REJECTS), "utf8");
    const [, line, fragment] = text.match(/^# reject: line (\d+): (.+?)\r?\n/) ?? [];
    assert.ok(line, `${file}: first line must be '# reject: line N: <message>'`);
    assert.throws(() => parseTaxonomyYaml(text), (error) => {
      assert.ok(error instanceof TaxonomyYamlError, `${file}: ${error}`);
      assert.equal(error.line, Number(line), `${file}: ${error.message}`);
      assert.ok(error.message.startsWith(`line ${line}: `) && error.message.includes(fragment), `${file}: ${error.message}`);
      return true;
    });
  }
});

test("the reader reads whitespace and line breaks as YAML does, or refuses", () => {
  // Built with fromCharCode so the invisible characters stay visible in review.
  const [NBSP, NEL, LS, NUL] = [0xa0, 0x85, 0x2028, 0x00].map((c) => String.fromCharCode(c));
  // PyYAML 6.0.3 reads a no-break space as content, never as a blank line.
  assert.deepEqual(parseTaxonomyYaml(`k: >\n  a\n  ${NBSP}\n`), { k: `a ${NBSP}\n` });
  // Clip chomping keeps a final line break only if the text has one.
  assert.deepEqual(parseTaxonomyYaml("k: >\n  a\n  b"), { k: "a b" });
  assert.deepEqual(parseTaxonomyYaml("k: >\n  a\n  b\n"), { k: "a b\n" });
  const refusals = [
    [`k: a${NBSP}\n`, 1, "plain (unquoted) scalars"], // PyYAML reads the no-break space as content
    [`k: 1\n${NBSP}\nj: 2\n`, 2, "expected 'key: value'"], // not a blank line
    [`k: "a${NEL}b"\n`, 1, "U+0085"], // PyYAML folds NEL to a space
    [`k: >\n  a${LS}b\n`, 2, "U+2028"],
    [`k: "a${NUL}b"\n`, 1, "U+0000"],
    ['k: "a"\t\n', 1, "double-quoted scalar"],
  ];
  for (const [text, line, fragment] of refusals) {
    assert.throws(() => parseTaxonomyYaml(text), (error) => {
      assert.ok(error instanceof TaxonomyYamlError, String(error));
      assert.equal(error.line, line, error.message);
      assert.ok(error.message.includes(fragment), error.message);
      return true;
    }, JSON.stringify(text));
  }
});
