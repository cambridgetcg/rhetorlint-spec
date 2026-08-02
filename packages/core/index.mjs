/**
 * @rhetorlint/core — a reference implementation of the RhetorLint spec.
 *
 * Marks configured rhetorical patterns in the WORDS of a passage, reports a
 * density metric, and produces a deterministic counterfactual "strip". It runs
 * fully on-device with zero dependencies.
 *
 * What it refuses to do, by design:
 *   - It does not read the person. No tone/intent/deception inference.
 *   - It does not decide whether a claim is factually true.
 *   - It does not fabricate a paraphrase. `rewrite` is left null unless an
 *     optional model adapter is supplied; the core only marks and strips.
 *
 * Every mark points at a real, visible phrase. Confidence is an uncalibrated,
 * author-assigned match weight, never a probability of intent, effect, or truth.
 *
 * Spec: ../../spec/output.schema.json   Version: 0.1
 */

export const SPEC_VERSION = "0.1";
const NAME = "@rhetorlint/core";
const CORE_VERSION = "0.1.3";
const CLASSIFICATION_STATUS = "rule-pack-candidate-context-required";

/** Words the -ed/-en passive heuristic should treat as predicate adjectives, not passives.
 *  Includes plain -en adjectives/numerals ("open", "seven") the \w+en pattern would
 *  otherwise swallow, and "often" so the bare "is often" never reads as a passive. */
const NOT_PASSIVE = new Set([
  "tired", "glad", "aware", "worried", "excited", "interested", "scared",
  "bored", "pleased", "married", "gifted", "talented", "detailed", "limited",
  "dedicated", "committed", "supposed", "used", "based",
  "open", "even", "sudden", "seven", "ten", "eleven", "golden", "wooden", "often"
]);

/** Irregular past participles the "\w+ed|\w+en" pattern would otherwise miss. */
const IRREGULAR_PP =
  "made|taken|done|given|seen|known|held|shown|drawn|chosen|written|broken|spoken|" +
  "built|sent|kept|left|lost|found|told|brought|dealt|put|set|paid|felt|met|led|read|" +
  "hit|cut|hurt|shut|split|spread|cast|cost|let";

const AGENTLESS_PASSIVE = new RegExp(
  // be-verb  (+ optional adverb, -ly or a common frequency word)  + participle,
  // NOT followed by "by <agent>" — where the by-phrase may sit past a particle
  // or adverb ("carried out collectively by the network" still names the agent).
  "\\b(is|are|was|were|been|being|be)\\s+(?:(?:\\w+ly|often|never|always|still|already)\\s+)?" +
  "(\\w+(?:ed|en)|" + IRREGULAR_PP + ")\\b" +
  "(?!\\s+(?:(?:\\w+ly|out|up|off|down|in|on|away|forward|together|aside|back)\\s+)*by\\b)",
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
    // Patterns match case-insensitively unless the rule opts out — a rule whose
    // whole point is letter case (ALL-CAPS shouting) sets caseSensitive: true.
    const re = new RegExp(rule.pattern, rule.caseSensitive ? "g" : "gi");
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
 * The ruleIds whose phrases `strip` may remove as an explicit counterfactual.
 * Deliberately conservative: only standalone lexical intensifiers are removed.
 * Modality, attribution, verb-phrase hedges, and structural markers stay intact
 * because deleting them can change truth conditions or break grammar.
 */
const REMOVABLE = new Set(["intensifier.loaded"]);

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
        displayName: rule.displayName,
        family: rule.family,
        technique: rule.technique,
        classificationStatus: CLASSIFICATION_STATUS,
        taxonomyMappingStatus: rule.taxonomyMappingStatus,
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
 * strip(text, marks) -> deterministic reduction-and-annotation counterfactual.
 *
 * Removes lexical intensifiers and flags each passive with an omitted agent
 * using [who?]. No model and no paraphrase. This is a reading aid, not a
 * meaning-preserving or truth-preserving rewrite.
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
