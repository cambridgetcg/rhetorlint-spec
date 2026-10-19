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
const CORE_VERSION = "0.1.4";

const RULE_FAMILIES = new Set([
  "manipulative-wording", "simplification", "distraction",
  "attack-on-reputation", "justification", "call", "agency-hiding"
]);
const RULE_LEVELS = new Set(["info", "note", "warning"]);
const RULE_TYPES = new Set(["lexical", "pattern", "structural"]);
const RULE_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PACK_ID = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const LOCALE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

const MAX_RULES = 512;
const MAX_PACK_ID_CHARS = 128;
const MAX_RULE_ID_CHARS = 128;
const MAX_LOCALE_CHARS = 64;
const MAX_METADATA_CHARS = 4096;
const MAX_EXPECTED_ITEMS = 32;
const MAX_EXPECTED_CHARS = 2048;
const MAX_TERMS = 256;
const MAX_TERM_CHARS = 256;
const MAX_PATTERN_CHARS = 4096;

const PACK_KEYS = new Set(["id", "version", "locale", "note", "rules"]);
const RULE_BASE_KEYS = [
  "ruleId", "family", "technique", "type", "level", "confidence", "note", "expected"
];
const RULE_KEYS = {
  lexical: new Set([...RULE_BASE_KEYS, "terms"]),
  pattern: new Set([...RULE_BASE_KEYS, "pattern", "caseSensitive", "minEngine"]),
  structural: new Set([...RULE_BASE_KEYS, "detector"])
};
const ZERO_LENGTH_PATTERN_PROBES = ["", "a", "A", "0", "_", " ", "\n", "word", "example"];

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

function isObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidPack(path, message) {
  throw new TypeError(`invalid rule pack at ${path}: ${message}`);
}

function boundedString(value, path, maximum, pattern) {
  if (typeof value !== "string" || value.length === 0) {
    invalidPack(path, "must be a non-empty string");
  }
  if (value.length > maximum) {
    invalidPack(path, `must contain at most ${maximum} characters`);
  }
  if (pattern && !pattern.test(value)) {
    invalidPack(path, "has an unsupported format");
  }
  return value;
}

function semverParts(value, path) {
  const version = boundedString(value, path, 128, SEMVER);
  const match = SEMVER.exec(version);
  return match.slice(1, 4).map(Number);
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function exactKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalidPack(path, `property '${key}' is not supported`);
  }
}

function snapshotDataObject(value, path) {
  if (!isObject(value)) return value;
  const snapshot = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      invalidPack(path, "symbol properties are not supported");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      invalidPack(`${path}.${key}`, "must be an enumerable data property");
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function snapshotDataArray(value, path, maximum, itemName = "items") {
  if (!Array.isArray(value)) return value;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value")) {
    invalidPack(path, "must have a fixed data length");
  }
  const length = lengthDescriptor.value;
  if (length > maximum) {
    invalidPack(path, `must contain at most ${maximum} ${itemName}`);
  }

  const allowedKeys = new Set(["length"]);
  const snapshot = [];
  for (let index = 0; index < length; index++) {
    const key = String(index);
    allowedKeys.add(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      invalidPack(`${path}[${index}]`, "must be an enumerable data item (sparse arrays are unsupported)");
    }
    snapshot.push(descriptor.value);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      invalidPack(path, "array properties other than dense numeric items are not supported");
    }
  }
  return snapshot;
}

function snapshotRulePack(value) {
  const pack = snapshotDataObject(value, "$pack");
  if (!isObject(pack) || !Array.isArray(pack.rules)) return pack;

  pack.rules = snapshotDataArray(pack.rules, "rules", MAX_RULES, "rules").map((value, index) => {
    const path = `rules[${index}]`;
    const rule = snapshotDataObject(value, path);
    if (!isObject(rule)) return rule;
    if (Array.isArray(rule.terms)) {
      rule.terms = snapshotDataArray(rule.terms, `${path}.terms`, MAX_TERMS, "terms");
    }
    if (Array.isArray(rule.expected)) {
      rule.expected = snapshotDataArray(
        rule.expected,
        `${path}.expected`,
        MAX_EXPECTED_ITEMS
      );
    }
    return rule;
  });
  return pack;
}

function hasObviousZeroLengthMatch(pattern, flags) {
  // This catches empty alternatives, anchors, optional-only expressions, and
  // common lookarounds. A context-specific assertion can evade finite probes,
  // so matchesFor() separately rejects any zero-width match that actually fires.
  return ZERO_LENGTH_PATTERN_PROBES.some((probe) => {
    const match = new RegExp(pattern, flags).exec(probe);
    return match !== null && match[0].length === 0;
  });
}

function validateRulePack(pack) {
  if (!isObject(pack)) {
    throw new Error("analyze() needs a rule pack: analyze(text, { rules })");
  }
  exactKeys(pack, PACK_KEYS, "$pack");
  boundedString(pack.id, "id", MAX_PACK_ID_CHARS, PACK_ID);
  semverParts(pack.version, "version");
  if (pack.locale !== undefined) {
    boundedString(pack.locale, "locale", MAX_LOCALE_CHARS, LOCALE);
  }
  if (pack.note !== undefined) {
    boundedString(pack.note, "note", MAX_METADATA_CHARS);
  }
  if (!Array.isArray(pack.rules)) {
    invalidPack("rules", "must be an array");
  }
  if (pack.rules.length > MAX_RULES) {
    invalidPack("rules", `must contain at most ${MAX_RULES} rules`);
  }

  const ids = new Set();
  const engineVersion = semverParts(CORE_VERSION, "engine.version");
  for (let index = 0; index < pack.rules.length; index++) {
    const rule = pack.rules[index];
    const path = `rules[${index}]`;
    if (!isObject(rule)) invalidPack(path, "must be an object");

    const ruleId = boundedString(rule.ruleId, `${path}.ruleId`, MAX_RULE_ID_CHARS, RULE_ID);
    if (ids.has(ruleId)) invalidPack(`${path}.ruleId`, `duplicates '${ruleId}'`);
    ids.add(ruleId);

    const family = boundedString(rule.family, `${path}.family`, 64);
    if (!RULE_FAMILIES.has(family)) invalidPack(`${path}.family`, `unsupported family '${family}'`);
    if (!RULE_TYPES.has(rule.type)) {
      invalidPack(`${path}.type`, `unsupported matcher type '${String(rule.type)}'`);
    }
    exactKeys(rule, RULE_KEYS[rule.type], path);

    for (const field of ["technique", "note"]) {
      if (rule[field] !== undefined) {
        boundedString(rule[field], `${path}.${field}`, MAX_METADATA_CHARS);
      }
    }
    if (rule.level !== undefined && !RULE_LEVELS.has(rule.level)) {
      invalidPack(`${path}.level`, `unsupported level '${String(rule.level)}'`);
    }
    if (
      rule.confidence !== undefined &&
      (typeof rule.confidence !== "number" || !Number.isFinite(rule.confidence) ||
        rule.confidence < 0 || rule.confidence > 1)
    ) {
      invalidPack(`${path}.confidence`, "must be a finite number between 0 and 1");
    }
    if (rule.expected !== undefined) {
      if (!Array.isArray(rule.expected) || rule.expected.length > MAX_EXPECTED_ITEMS) {
        invalidPack(`${path}.expected`, `must be an array of at most ${MAX_EXPECTED_ITEMS} strings`);
      }
      rule.expected.forEach((item, itemIndex) => {
        boundedString(item, `${path}.expected[${itemIndex}]`, MAX_EXPECTED_CHARS);
      });
    }

    if (rule.type === "lexical") {
      if (!Array.isArray(rule.terms) || rule.terms.length === 0 || rule.terms.length > MAX_TERMS) {
        invalidPack(`${path}.terms`, `must contain between 1 and ${MAX_TERMS} terms`);
      }
      rule.terms.forEach((term, termIndex) => {
        boundedString(term, `${path}.terms[${termIndex}]`, MAX_TERM_CHARS);
        if (term.trim().length === 0) {
          invalidPack(`${path}.terms[${termIndex}]`, "must contain visible characters");
        }
      });
    } else if (rule.type === "pattern") {
      const pattern = boundedString(rule.pattern, `${path}.pattern`, MAX_PATTERN_CHARS);
      if (rule.caseSensitive !== undefined && typeof rule.caseSensitive !== "boolean") {
        invalidPack(`${path}.caseSensitive`, "must be a boolean");
      }
      const flags = rule.caseSensitive ? "g" : "gi";
      try {
        new RegExp(pattern, flags);
      } catch (error) {
        invalidPack(`${path}.pattern`, `is not a valid JavaScript regular expression: ${error.message}`);
      }
      if (hasObviousZeroLengthMatch(pattern, flags)) {
        invalidPack(`${path}.pattern`, "must consume at least one character on every successful branch");
      }
    } else if (rule.detector !== "agentless-passive") {
      invalidPack(`${path}.detector`, `unsupported structural detector '${String(rule.detector)}'`);
    }

    if (rule.minEngine !== undefined) {
      const minimum = semverParts(rule.minEngine, `${path}.minEngine`);
      if (compareSemver(engineVersion, minimum) < 0) {
        invalidPack(
          `${path}.minEngine`,
          `needs core >= ${rule.minEngine}, current core is ${CORE_VERSION}`
        );
      }
    }
  }
}

/** A compiled matcher for one rule. Returns [{index, length, actual}]. */
function matchesFor(rule, text) {
  const out = [];
  if (rule.type === "lexical") {
    // Sort a copy: longer overlapping terms win without rewriting authored pack order.
    const alt = rule.terms
      .map(escapeRegExp)
      .sort((left, right) =>
        right.length - left.length ||
        (left < right ? -1 : left > right ? 1 : 0)
      )
      .join("|");
    const re = new RegExp("\\b(?:" + alt + ")\\b", "gi");
    for (const m of text.matchAll(re)) out.push({ index: m.index, length: m[0].length, actual: m[0] });
  } else if (rule.type === "pattern") {
    // Patterns match case-insensitively unless the rule opts out — a rule whose
    // whole point is letter case (ALL-CAPS shouting) sets caseSensitive: true.
    const re = new RegExp(rule.pattern, rule.caseSensitive ? "g" : "gi");
    for (const m of text.matchAll(re)) {
      if (m[0].length === 0) {
        invalidPack(`rule '${rule.ruleId}'.pattern`, "produced a zero-length match");
      }
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
 * The ruleIds whose phrases `strip` may remove without deleting modality or
 * attribution. Deliberately conservative: only loaded intensifiers are
 * subtracted. Epistemic/deontic modality, attribution, verb-phrase hedges, and
 * structural tells stay MARKED for the reader to judge.
 */
const REMOVABLE = new Set(["intensifier.loaded"]);

/** Words that negate an intensifier or an absolute after them ("not extremely
 *  high", "not always"). With any "n't" contraction, they are what `negatedAt`
 *  looks for. */
const NEGATORS = new Set(["not", "never", "no", "nor", "without", "hardly", "cannot"]);

/** A word character for the strip and mark guards: an ASCII letter or digit,
 *  or an apostrophe (U+0027 or U+2019). Every other character separates words. */
function isGuardWordChar(code) {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) || code === 39 || code === 0x2019;
}

function isNegator(word) {
  // ASCII-only lowercasing, so no engine folds a non-ASCII letter into a negator.
  const w = word.replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/^['\u2019]+|['\u2019]+$/g, "");
  return NEGATORS.has(w) || w.endsWith("n't") || w.endsWith("n\u2019t");
}

/**
 * True when a negator is one of the two words before `offset`, with no
 * . ; : ! or ? between them. It walks back over characters and words, never a
 * count of code units, so JS (UTF-16), Python (code points) and Go (bytes)
 * decide alike on any input.
 */
function negatedAt(text, offset) {
  let i = offset;
  for (let words = 0; words < 2; words++) {
    while (i > 0 && !isGuardWordChar(text.charCodeAt(i - 1))) {
      if (".;:!?".includes(text[i - 1])) return false;
      i--;
    }
    if (i === 0) return false;
    const end = i;
    while (i > 0 && isGuardWordChar(text.charCodeAt(i - 1))) i--;
    if (isNegator(text.slice(i, end))) return true;
  }
  return false;
}

/**
 * The ruleIds whose matches are read in their clause before they are marked.
 * An absolute under a negator ("not guaranteed", "isn't always", "Not
 * everyone") is a disclaimer, the opposite of an overclaim; a clause-initial
 * "Never" before a lowercase word ("Never share your password.") is advice to
 * the reader, not a claim about what never happens. Neither is marked. The
 * guard lives in the engine, beside REMOVABLE, because a new pack key would
 * make an older core reject the whole pack; spec/taxonomy.yaml declares it as
 * guard_examples, which test/taxonomy-agreement.test.mjs holds the engine to.
 */
const NEGATION_SCOPED = new Set(["absolute.universal"]);

/** True when a NEGATION_SCOPED match at [start, end) is negated or an imperative "Never". */
function negationScopedAt(text, start, end) {
  return negatedAt(text, start) || imperativeNeverAt(text, start, end);
}

/**
 * True when [start, end) is the word "never", in any letter case, that opens
 * its clause and is followed by spaces or tabs and an ASCII lowercase letter.
 * It opens its clause when only non-word characters stand between it and the
 * start of the text or one of . ; : ! ? ("Never share", "...; never
 * manufacture"). Like negatedAt it walks characters, never a count of units.
 */
function imperativeNeverAt(text, start, end) {
  if (text.slice(start, end).replace(/[A-Z]/g, (c) => c.toLowerCase()) !== "never") return false;
  let i = start;
  while (i > 0 && !isGuardWordChar(text.charCodeAt(i - 1)) && !".;:!?".includes(text[i - 1])) i--;
  if (i > 0 && isGuardWordChar(text.charCodeAt(i - 1))) return false;
  let j = end;
  while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
  if (j === end || j === text.length) return false;
  const next = text.charCodeAt(j);
  return next >= 97 && next <= 122;
}

/**
 * True when `offset` sits inside a quotation on its own line: an odd number of
 * straight double quotes before it, or a U+201C opening quote that no U+201D
 * has closed. It counts characters, so it is unit-free like negatedAt.
 */
function quotedAt(text, offset) {
  const line = text.slice(offset === 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1, offset);
  return (line.split('"').length - 1) % 2 === 1 ||
    line.lastIndexOf("\u201c") > line.lastIndexOf("\u201d");
}

function cloneMark(mark) {
  return {
    ...mark,
    position: {
      start: { ...mark.position.start },
      end: { ...mark.position.end }
    },
    expected: [...mark.expected]
  };
}

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
  if (typeof text !== "string") {
    throw new TypeError("analyze() text must be a string");
  }
  if (!isObject(options)) {
    throw new TypeError("analyze() options must be an object");
  }
  // Read each option once so accessor-backed option bags cannot change the
  // selected pack, locale, or adapter between validation and use.
  const inputPack = options.rules;
  const requestedLocale = options.locale;
  const rewriteAdapter = options.rewrite;
  if (
    requestedLocale !== undefined &&
    (typeof requestedLocale !== "string" || requestedLocale.length === 0 ||
      requestedLocale.length > MAX_LOCALE_CHARS || !LOCALE.test(requestedLocale))
  ) {
    throw new TypeError(
      `analyze() options.locale must be a valid locale of at most ${MAX_LOCALE_CHARS} characters`
    );
  }
  const pack = snapshotRulePack(inputPack);
  validateRulePack(pack);
  // Snapshot reported provenance before the caller-controlled rewrite runs.
  // A rewrite closure may retain and mutate `options` or `pack`; those later
  // mutations must not rewrite the already-completed analysis record.
  const reportedLocale = requestedLocale || pack.locale || "en";
  const rulesProvenance = pack.id + "@" + pack.version;
  const marks = [];
  for (const rule of pack.rules) {
    const scoped = NEGATION_SCOPED.has(rule.ruleId);
    for (const hit of matchesFor(rule, text)) {
      if (scoped && negationScopedAt(text, hit.index, hit.index + hit.length)) continue;
      marks.push({
        ruleId: rule.ruleId,
        family: rule.family,
        technique: rule.technique,
        actual: hit.actual,
        position: { start: pointAt(text, hit.index), end: pointAt(text, hit.index + hit.length) },
        note: rule.note,
        expected: rule.expected ? [...rule.expected] : [],
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
  const stripped = strip(text, deduped);

  let rewrite = null;
  if (typeof rewriteAdapter === "function") {
    rewrite = rewriteAdapter(text, deduped.map(cloneMark));
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
    source: { chars: text.length, words, locale: reportedLocale },
    density: { tells: deduped.length, per100Words: per100 },
    marks: deduped,
    strip: stripped,
    rewrite,
    engine: { name: NAME, version: CORE_VERSION, rules: rulesProvenance }
  };
}

/**
 * strip(text, marks) -> deterministic de-spun text.
 *
 * Removes loaded intensifiers and flags each agentless passive with a visible
 * [who?]. No model, no paraphrase — it only subtracts spin and points at what
 * was hidden, so a reader can see the difference. An intensifier under a
 * negator, or inside a quotation, stays: deleting it would strengthen the
 * claim ("not extremely high" is not "not high") or edit someone's words.
 */
export function strip(text, marks) {
  if (marks.length === 0) return text;

  // Apply right-to-left so earlier offsets stay valid as we splice.
  const ordered = [...marks].sort((a, b) => b.position.start.offset - a.position.start.offset);
  let out = text;
  let changed = false;
  for (const m of ordered) {
    const s = m.position.start.offset, e = m.position.end.offset;
    if (REMOVABLE.has(m.ruleId)) {
      // Judged on the source text: edits so far all lie at or after s.
      if (negatedAt(text, s) || quotedAt(text, s)) continue;
      out = joinRemovalSeam(out.slice(0, s), out.slice(e));
      changed = true;
    } else if (m.ruleId === "agency-hiding.deleted-subject") {
      out = out.slice(0, s) + "[who?] " + out.slice(s);
      changed = true;
    }
  }
  return changed ? out : text;
}

/** Tidy only horizontal whitespace and duplicate commas touching one removed span. */
function joinRemovalSeam(left, right) {
  const leftWhitespace = /[\t ]+$/.exec(left)?.[0] || "";
  const rightWhitespace = /^[\t ]+/.exec(right)?.[0] || "";
  let leftCore = left.slice(0, left.length - leftWhitespace.length);
  let rightCore = right.slice(rightWhitespace.length);

  if (leftWhitespace && rightWhitespace) {
    if (leftCore.length === 0 && rightCore.length === 0) {
      return "";
    }
    if (leftCore.length === 0 || /[\r\n]$/.test(leftCore)) {
      leftCore += leftWhitespace;
    } else if (rightCore.length === 0 || /^[\r\n]/.test(rightCore)) {
      // Whitespace at the end of a removed span is part of that seam; do not
      // turn it into trailing whitespace or flatten the following line break.
    } else {
      leftCore += " ";
    }
  } else if (leftWhitespace) {
    if (rightCore.length !== 0 && !/^[,.;:!?\r\n]/.test(rightCore)) {
      leftCore += leftWhitespace;
    }
  } else if (rightWhitespace) {
    if (leftCore.length !== 0 && !/[\r\n]$/.test(leftCore)) {
      rightCore = rightWhitespace + rightCore;
    }
  }

  if (leftCore.endsWith(",") && rightCore.startsWith(",")) {
    rightCore = rightCore.slice(1);
  }
  return leftCore + rightCore;
}
