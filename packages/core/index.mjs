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

// BEGIN GENERATED AGENCY LEXICON
// spec/agency-lexicon.json version 2, written by scripts/gen-agency-lexicon.mjs.
// Edit the lexicon and rerun the generator; --check fails when this block drifts.
const AGENCY_WHITESPACE = " \t\n\r\f";
const AGENCY_SPACE = "[ \\t\\n\\r\\f]+";
const AGENCY_HEAD_STOPS = ".;:!?\n";
const AGENCY_CLAUSE_BREAKS = ".;:!?";
const AGENCY_AUXILIARIES = ["been", "was", "were"];
const AGENCY_ADVERBS = ["already", "always", "often", "still"];
const AGENCY_ADVERB_SUFFIX = "ly";
const AGENCY_SKIP = new Set([
  "all", "already", "also", "can", "could", "had", "has", "have", "may", "might", "must", "never",
  "not", "now", "shall", "should", "since", "then", "will", "would"
]);
const AGENCY_SKIP_SUFFIX = "ly";
const AGENCY_SKIP_MAX = 4;
const AGENCY_BY_WINDOW = 7;
const AGENCY_NEGATORS = new Set([
  "cannot", "neither", "never", "no", "none", "nor", "not", "nothing"
]);
const AGENCY_NEGATOR_WINDOW = 5;
const AGENCY_HEADS = new Map([
  ["challenge", new Set([
    "allegations", "concerns", "questions"
  ])],
  ["data", new Set([
    "address", "addresses", "credentials", "data", "details", "information", "password",
    "passwords", "pii", "records"
  ])],
  ["dummy", new Set([
    "it"
  ])],
  ["error", new Set([
    "action", "actions", "allegations", "choices", "comments", "concerns", "cuts", "decision",
    "decisions", "error", "errors", "measures", "miscalculation", "miscalculations", "misjudgement",
    "misjudgements", "misjudgment", "misjudgments", "misstep", "missteps", "mistake", "mistakes",
    "omissions", "promises", "questions", "remarks", "safeguards", "statements", "steps", "things",
    "threats", "words"
  ])],
  ["held", new Set([
    "account", "accounts", "address", "addresses", "credentials", "data", "details", "information",
    "password", "passwords", "pii", "records"
  ])]
]);
/** [class, head class or "" for none, participles]. */
const AGENCY_CLASSES = [
  ["fault", "", [
    "botched", "bungled", "doctored", "falsified", "ignored", "misappropriated", "miscalculated",
    "mischaracterised", "mischaracterized", "mishandled", "misinformed", "misinterpreted",
    "misjudged", "mislabeled", "mislabelled", "misled", "mismanaged", "misplaced", "misquoted",
    "misreported", "misrepresented", "misstated", "misused", "neglected", "overcharged",
    "overlooked", "tampered", "underpaid"
  ]],
  ["breach", "", [
    "accessed", "breached", "compromised", "exfiltrated", "exposed", "hacked", "leaked", "stolen"
  ]],
  ["affect", "held", [
    "affected", "impacted"
  ]],
  ["conceal", "", [
    "axed", "censored", "concealed", "laid off", "let go", "scrapped", "shelved", "silenced",
    "withheld"
  ]],
  ["light", "error", [
    "characterised", "characterized", "done", "given", "interpreted", "made", "perceived", "put",
    "said", "taken"
  ]],
  ["raise", "challenge", [
    "raised"
  ]],
  ["impersonal", "dummy", [
    "agreed", "decided", "determined"
  ]],
  ["data", "data", [
    "disclosed", "shared", "sold"
  ]]
];
const AGENCY_REQUIRES = new Map([["put", "in place"]]);
const AGENCY_UNLESS = new Map([["exposed", "to"]]);
// END GENERATED AGENCY LEXICON

/*
 * The agentless-passive detector marks an ACCOUNTABLE passive whose doer the
 * clause leaves unstated: "Mistakes were made", "Customer data was quietly
 * accessed", "Records were withheld". Subject absence alone is not the tell:
 * methods sections, documentation and news are full of honest passives. So a
 * mark needs all of:
 *   1. a past passive auxiliary (AGENCY_AUXILIARIES: was, were, been), then at
 *      most one adverb (an ASCII word ending in -ly, or AGENCY_ADVERBS), then
 *   2. a participle from a closed class: a fault, a breach, a concealment (no
 *      head word needed); a light verb after an error, decision or statement
 *      noun ("mistakes were made"); "decided" after "it"; or a verb that hands
 *      data to someone else after a data noun ("your data was shared");
 *   3. its AGENCY_REQUIRES phrase ("put" only in "put in place"), and not its
 *      AGENCY_UNLESS word ("exposed to" names an exposure, not a breach);
 *   4. no "by" among the next AGENCY_BY_WINDOW words of the clause: the agent
 *      is named ("...by Forbes"), or the clause says when ("by Friday"), and
 *      either way the rule stays silent;
 *   5. no negator (AGENCY_NEGATORS, or an n't contraction) in the auxiliary
 *      chain ("have not been", "hasn't been"), as the head word ("Nothing was
 *      withheld") or among the AGENCY_NEGATOR_WINDOW words before the head
 *      ("No customer data was", "None of the records were"): a negated
 *      passive denies the act, it does not hide a doer.
 * The head word is the nearest word before the auxiliary, stepping back over
 * at most AGENCY_SKIP_MAX words of AGENCY_SKIP or ending in -ly, never past
 * AGENCY_HEAD_STOPS (. ; : ! ? or a line break); the negator walk reads the
 * same words and stops at the same characters. The "by" window ends at
 * AGENCY_CLAUSE_BREAKS (. ; : ! ?) but reads on across a line break, since
 * hard-wrapped text breaks lines mid-clause: each window stops where stopping
 * marks less.
 *
 * Portability: matching runs on an ASCII-lowercased copy (A-Z to a-z and
 * nothing else, so its length is the text's in every offset unit), with no
 * case-insensitive flag, explicit AGENCY_WHITESPACE ([ \t\n\r\f]) and ASCII
 * word boundaries. A no-break space or a vertical tab does not join two words,
 * and a non-ASCII letter is never folded into one, so JavaScript, Python and
 * Go read the same words. The word lists, the numbers and the three character
 * sets are generated from spec/agency-lexicon.json.
 */

/** Each participle and the head class it needs ("" for none). */
const AGENCY_HEAD_OF = new Map(
  AGENCY_CLASSES.flatMap(([, head, participles]) => participles.map((p) => [p, head]))
);

const AGENCY_CANDIDATE = new RegExp(
  "\\b(" + AGENCY_AUXILIARIES.join("|") + ")" + AGENCY_SPACE +
  "(?:(?:[a-z]+" + AGENCY_ADVERB_SUFFIX + "|" + AGENCY_ADVERBS.join("|") + ")" + AGENCY_SPACE + ")?" +
  "(" + [...AGENCY_HEAD_OF.keys()]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
    .map((p) => p.split(" ").join(AGENCY_SPACE))
    .join("|") + ")\\b",
  "g"
);
const AGENCY_SPACE_RUN = new RegExp(AGENCY_SPACE);

/** An ASCII letter, digit or underscore: what \b counts as a word character. */
function isAgencyWordCode(code) {
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95;
}

/** The head word before `index` in the lowercased text, or "" (see above). */
function agencyHeadWord(low, index) {
  let i = index;
  for (let seen = 0; seen <= AGENCY_SKIP_MAX; seen++) {
    while (i > 0 && !isAgencyWordCode(low.charCodeAt(i - 1))) {
      if (AGENCY_HEAD_STOPS.includes(low[i - 1])) return "";
      i--;
    }
    const end = i;
    while (i > 0 && isAgencyWordCode(low.charCodeAt(i - 1))) i--;
    if (i === end) return "";
    const word = low.slice(i, end);
    if (!AGENCY_SKIP.has(word) && !word.endsWith(AGENCY_SKIP_SUFFIX)) return word;
  }
  return "";
}

/** True when the word "t" at `start` ends an n't contraction: "n", then an apostrophe (U+0027 or U+2019). */
function agencyContraction(low, start) {
  return start >= 2 && (low.slice(start - 2, start) === "n'" || low.slice(start - 2, start) === "n\u2019");
}

/**
 * True when a negator stands in the auxiliary chain before `index`, is the
 * head word, or is one of the AGENCY_NEGATOR_WINDOW words before the head. It
 * walks the words agencyHeadWord walks, never past AGENCY_HEAD_STOPS; when
 * agencyHeadWord finds no head, only the chain is read.
 */
function agencyNegated(low, index) {
  let i = index;
  let left = -1; // words still to read before the head; -1 until the head is read
  for (let seen = 0; left !== 0; seen++) {
    while (i > 0 && !isAgencyWordCode(low.charCodeAt(i - 1))) {
      if (AGENCY_HEAD_STOPS.includes(low[i - 1])) return false;
      i--;
    }
    const end = i;
    while (i > 0 && isAgencyWordCode(low.charCodeAt(i - 1))) i--;
    if (i === end) return false;
    const word = low.slice(i, end);
    if (AGENCY_NEGATORS.has(word) || (word === "t" && agencyContraction(low, i))) return true;
    if (left > 0) left--;
    else if (!AGENCY_SKIP.has(word) && !word.endsWith(AGENCY_SKIP_SUFFIX)) left = AGENCY_NEGATOR_WINDOW;
    else if (seen === AGENCY_SKIP_MAX) return false;
  }
  return false;
}

/** True when "by" is one of the next AGENCY_BY_WINDOW words after `index`, before . ; : ! or ?. */
function agencyByFollows(low, index) {
  let i = index;
  for (let words = 0; words < AGENCY_BY_WINDOW; words++) {
    while (i < low.length && !isAgencyWordCode(low.charCodeAt(i))) {
      if (AGENCY_CLAUSE_BREAKS.includes(low[i])) return false;
      i++;
    }
    if (i === low.length) return false;
    const start = i;
    while (i < low.length && isAgencyWordCode(low.charCodeAt(i))) i++;
    if (low.slice(start, i) === "by") return true;
  }
  return false;
}

/** True when the words of `phrase` follow `index`, each after [ \t\n\r\f]+, each whole. */
function agencyPhraseFollows(low, index, phrase) {
  let i = index;
  for (const word of phrase.split(" ")) {
    const gap = i;
    while (i < low.length && AGENCY_WHITESPACE.includes(low[i])) i++;
    if (i === gap || !low.startsWith(word, i)) return false;
    i += word.length;
    if (i < low.length && isAgencyWordCode(low.charCodeAt(i))) return false;
  }
  return true;
}

/** Every accountable agentless passive in `text`, spanning auxiliary through participle. */
function agentlessPassives(text) {
  const low = asciiLower(text);
  const out = [];
  for (const m of low.matchAll(AGENCY_CANDIDATE)) {
    const start = m.index, end = start + m[0].length;
    const participle = m[2].split(AGENCY_SPACE_RUN).join(" ");
    const unless = AGENCY_UNLESS.get(participle);
    if (unless !== undefined && agencyPhraseFollows(low, end, unless)) continue;
    const requires = AGENCY_REQUIRES.get(participle);
    if (requires !== undefined && !agencyPhraseFollows(low, end, requires)) continue;
    if (agencyByFollows(low, end)) continue;
    const head = AGENCY_HEAD_OF.get(participle);
    if (head !== "" && !AGENCY_HEADS.get(head).has(agencyHeadWord(low, start))) continue;
    if (agencyNegated(low, start)) continue;
    out.push({ index: start, length: end - start, actual: text.slice(start, end) });
  }
  return out;
}

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
    for (const hit of agentlessPassives(text)) out.push(hit);
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

/** The characters that end a clause, for the negator window and the imperative "Never". */
const CLAUSE_BREAKS = ".;:!?";

/**
 * True when a negator is one of the two words before `offset`, with no
 * . ; : ! or ? between them. It walks back over characters and words, never a
 * count of code units, so JS (UTF-16), Python (code points) and Go (bytes)
 * decide alike on any input.
 *
 * With `commaEndsScope` (the absolute.universal guard; strip leaves it off),
 * a comma also ends the negator's reach once a word stands between them: the
 * "No" of "No risk, guaranteed." negates "risk", not "guaranteed". A negator
 * followed directly by a comma reaches past the aside, so "not, however,
 * guaranteed" and "No, never" stay negated.
 */
function negatedAt(text, offset, commaEndsScope = false) {
  let i = offset;
  let commaBefore = false; // a comma between the term and the word being read
  for (let words = 0; words < 2; words++) {
    let comma = false;
    while (i > 0 && !isGuardWordChar(text.charCodeAt(i - 1))) {
      if (CLAUSE_BREAKS.includes(text[i - 1])) return false;
      if (text[i - 1] === ",") comma = true;
      i--;
    }
    if (i === 0) return false;
    const end = i;
    while (i > 0 && isGuardWordChar(text.charCodeAt(i - 1))) i--;
    if (isNegator(text.slice(i, end))) return !commaEndsScope || !commaBefore || comma;
    commaBefore = commaBefore || comma;
  }
  return false;
}

/**
 * The ruleIds whose matches are read in their clause before they are marked.
 * An absolute under a negator ("not guaranteed", "isn't always", "Not
 * everyone") is a disclaimer, the opposite of an overclaim; a clause-initial
 * "Never" before a lowercase verb ("Never share your password.") is advice to
 * the reader, not a claim about what never happens. Neither is marked. The
 * guard lives in the engine, beside REMOVABLE, because a new pack key would
 * make an older core reject the whole pack; spec/taxonomy.yaml declares it as
 * guard_examples, which test/taxonomy-agreement.test.mjs holds the engine to.
 */
const NEGATION_SCOPED = new Set(["absolute.universal"]);

/** True when a NEGATION_SCOPED match at [start, end) is negated or an imperative "Never". */
function negationScopedAt(text, start, end) {
  return negatedAt(text, start, true) || imperativeNeverAt(text, start, end);
}

/** Words that, after a clause-initial "never", open a fragment ("Never an
 *  issue.") or an inversion ("Never has a product been this good."), both
 *  claims, and do not begin advice. A word that can also begin advice is left
 *  out, so the advice stays unmarked and the claim goes unmarked with it:
 *  "Never have regrets." but "Never have I seen…"; "Never at any time
 *  disclose your PIN." but "Never in history has…"; "Never so much as glance
 *  at it."; "Never should you share it." (so, in, at, on, have and should are
 *  not listed: recorded misses, the safe direction). */
const NEVER_NON_VERBS = new Set([
  "a", "an", "the", "any", "before", "such",
  "has", "had", "is", "are", "was", "were", "will", "would", "could",
  "can", "did", "does", "been", "being"
]);

/** Adverbs that may stand between "Never" and its verb: the word after them
 *  decides. "Never ever share it." is advice; "Never again will prices be
 *  this low." is an inversion; "Never again." is a fragment. */
const NEVER_PASS_THROUGH = new Set(["again", "ever", "once"]);

const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * True when [start, end) is the word "never", in any letter case, that opens
 * its clause and is followed by a verb: spaces or tabs, then a word that
 * starts with an ASCII lowercase letter and is not one of NEVER_NON_VERBS.
 * NEVER_PASS_THROUGH words are stepped over the same way first. It opens its
 * clause when only non-word characters stand between it and the start of the
 * text or one of . ; : ! ? ("Never share", "...; never manufacture"). Like
 * negatedAt it walks characters, never a count of units.
 */
function imperativeNeverAt(text, start, end) {
  if (asciiLower(text.slice(start, end)) !== "never") return false;
  let i = start;
  while (i > 0 && !isGuardWordChar(text.charCodeAt(i - 1)) && !CLAUSE_BREAKS.includes(text[i - 1])) i--;
  if (i > 0 && isGuardWordChar(text.charCodeAt(i - 1))) return false;
  let j = end;
  for (;;) {
    const gap = j;
    while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
    if (j === gap || j === text.length) return false;
    const next = text.charCodeAt(j);
    if (next < 97 || next > 122) return false;
    const word = j;
    while (j < text.length && isGuardWordChar(text.charCodeAt(j))) j++;
    const w = asciiLower(text.slice(word, j));
    if (!NEVER_PASS_THROUGH.has(w)) return !NEVER_NON_VERBS.has(w);
  }
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
