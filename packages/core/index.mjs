/**
 * @rhetorlint/core — a reference implementation of the RhetorLint spec.
 *
 * Marks countable rhetorical tells in the WORDS of a passage, reports a
 * density metric, and produces a deterministic de-spun "strip". It runs
 * fully on-device with zero dependencies.
 *
 * What it refuses to do, by design:
 *   - It does not read the person. No tone/intent/deception inference.
 *   - It does not decide whether a claim is factually true.
 *   - It does not fabricate a paraphrase. `rewrite` is left null unless an
 *     optional model adapter is supplied; the core only marks and strips.
 *
 * Every mark points at a real, visible phrase. Confidence is a heuristic
 * language-pattern likelihood, never a probability that anyone is lying.
 *
 * Spec: ../../spec/output.schema.json   Version: 0.1
 */

export const SPEC_VERSION = "0.1";
const NAME = "@rhetorlint/core";
const CORE_VERSION = "0.1.1";

/** Words the -ed/-en passive heuristic should treat as predicate adjectives, not passives. */
const NOT_PASSIVE = new Set([
  "tired", "glad", "aware", "worried", "excited", "interested", "scared",
  "bored", "pleased", "married", "gifted", "talented", "detailed", "limited",
  "dedicated", "committed", "supposed", "used", "based"
]);

/** Irregular past participles the "\w+ed|\w+en" pattern would otherwise miss. */
const IRREGULAR_PP =
  "made|taken|done|given|seen|known|held|shown|drawn|chosen|written|broken|spoken|" +
  "built|sent|kept|left|lost|found|told|brought|dealt|put|set|paid|felt|met|led|read|" +
  "hit|cut|hurt|shut|split|spread|cast|cost|let";

const AGENTLESS_PASSIVE = new RegExp(
  // be-verb  (+ optional adverb)  + participle  NOT followed by "by <agent>"
  "\\b(is|are|was|were|been|being|be)\\s+(?:\\w+ly\\s+)?" +
  "(\\w+(?:ed|en)|" + IRREGULAR_PP + ")\\b" +
  "(?!\\s+by\\b)",
  "gi"
);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A compiled matcher for one rule. Returns [{index, length, actual}]. */
function matchesFor(rule, text) {
  const out = [];
  if (rule.type === "lexical") {
    const alt = rule.terms.map(escapeRegExp).join("|");
    const re = new RegExp("\\b(?:" + alt + ")\\b", "gi");
    for (const m of text.matchAll(re)) out.push({ index: m.index, length: m[0].length, actual: m[0] });
  } else if (rule.type === "pattern") {
    const re = new RegExp(rule.pattern, "gi");
    for (const m of text.matchAll(re)) {
      if (m[0].length === 0) continue;
      out.push({ index: m.index, length: m[0].length, actual: m[0] });
    }
  } else if (rule.type === "structural" && rule.detector === "agentless-passive") {
    for (const m of text.matchAll(AGENTLESS_PASSIVE)) {
      const participle = (m[2] || "").toLowerCase();
      if (NOT_PASSIVE.has(participle)) continue;
      out.push({ index: m.index, length: m[0].length, actual: m[0] });
    }
  }
  return out;
}

/** Build {line, column, offset} for a character offset. */
function pointAt(text, offset) {
  let line = 1, last = -1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) { line++; last = i; }
  }
  return { line, column: offset - last, offset };
}

function countWords(text) {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * The ruleIds whose phrases `strip` may remove without breaking grammar.
 * Deliberately conservative: only adverbial spin (intensifiers, deniable
 * adverbs) is subtracted. Verb-phrase hedges and structural tells are left
 * MARKED for the reader to judge — strip subtracts spin, it never paraphrases.
 */
const REMOVABLE = new Set(["intensifier.loaded", "hedge.deniable"]);

/**
 * analyze(text, options) -> a RhetorLint result object (see the spec).
 *
 * options:
 *   rules    the rule pack ({ id, version, locale, rules }). Required.
 *   locale   overrides the reported locale (defaults to the pack's).
 *   rewrite  an optional synchronous fn(text, marks) -> string. If omitted,
 *            result.rewrite is null (the core never invents a paraphrase).
 */
export function analyze(text, options = {}) {
  const pack = options.rules;
  if (!pack || !Array.isArray(pack.rules)) {
    throw new Error("analyze() needs a rule pack: analyze(text, { rules })");
  }
  const marks = [];
  for (const rule of pack.rules) {
    for (const hit of matchesFor(rule, text)) {
      marks.push({
        ruleId: rule.ruleId,
        family: rule.family,
        technique: rule.technique,
        actual: hit.actual,
        position: { start: pointAt(text, hit.index), end: pointAt(text, hit.index + hit.length) },
        note: rule.note,
        expected: rule.expected || [],
        confidence: rule.confidence,
        level: rule.level || "info"
      });
    }
  }

  // Sort by position, then drop exact-span duplicates from the same rule.
  marks.sort((a, b) => a.position.start.offset - b.position.start.offset ||
                       a.position.end.offset - b.position.end.offset);
  const seen = new Set();
  const deduped = marks.filter((m) => {
    const key = m.ruleId + ":" + m.position.start.offset + ":" + m.position.end.offset;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const words = countWords(text);
  const per100 = words ? Math.round((deduped.length / words) * 1000) / 10 : 0;

  let rewrite = null;
  if (typeof options.rewrite === "function") {
    rewrite = options.rewrite(text, deduped);
    if (rewrite && typeof rewrite.then === "function") {
      // The synchronous API rejects thenables, but still owns the Promise it
      // just received. Consume a later rejection so the guidance error below
      // cannot turn into an unrelated unhandled-rejection crash.
      Promise.resolve(rewrite).catch(() => {});
      throw new TypeError(
        "analyze() rewrite adapter must return a string synchronously; async adapters are not supported"
      );
    }
    if (typeof rewrite !== "string") {
      throw new TypeError("analyze() rewrite adapter must return a string");
    }
  }

  return {
    rhetorlint: SPEC_VERSION,
    source: { chars: text.length, words, locale: options.locale || pack.locale || "en" },
    density: { tells: deduped.length, per100Words: per100 },
    marks: deduped,
    strip: strip(text, deduped),
    rewrite,
    engine: { name: NAME, version: CORE_VERSION, rules: pack.id + "@" + pack.version }
  };
}

/**
 * strip(text, marks) -> deterministic de-spun text.
 *
 * Removes hedge and intensifier phrases and flags each agentless passive
 * with a visible [who?]. No model, no paraphrase — it only subtracts spin
 * and points at what was hidden, so a reader can see the difference.
 */
export function strip(text, marks) {
  // Apply right-to-left so earlier offsets stay valid as we splice.
  const ordered = [...marks].sort((a, b) => b.position.start.offset - a.position.start.offset);
  let out = text;
  for (const m of ordered) {
    const s = m.position.start.offset, e = m.position.end.offset;
    if (REMOVABLE.has(m.ruleId)) {
      out = out.slice(0, s) + out.slice(e);
    } else if (m.ruleId === "agency-hiding.deleted-subject") {
      out = out.slice(0, s) + "[who?] " + out.slice(s);
    }
  }
  // Tidy the seams left by removal.
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\s+$/gm, "")
    .trim();
}
