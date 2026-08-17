/**
 * A small, transport-neutral projection of a canonical RhetorLint result.
 *
 * The default signal is deliberately redacted: it carries provenance and
 * aggregate counts, but no matched phrases or rewritten/stripped text. Callers
 * must pass the literal boolean `includeMarks: true` to disclose phrase-level
 * marks. `strip` and `rewrite` never cross this adapter.
 */

export const SIGNAL_SCHEMA = "rhetorlint.signal/0.1";

const BOUNDARY_DOES_NOT = [
  "infer-speaker-intent",
  "detect-deception",
  "determine-factual-truth"
];

const BOUNDARY_NOTE =
  "RhetorLint marks visible language patterns. It does not infer speaker intent, " +
  "detect deception, or determine whether a claim is factually true.";

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`toSignal() needs ${name} to be an object`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string") {
    throw new TypeError(`toSignal() needs ${name} to be a string`);
  }
  return value;
}

function requireNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`toSignal() needs ${name} to be a finite number`);
  }
  return value;
}

function requireInteger(value, name) {
  const number = requireNumber(value, name);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`toSignal() needs ${name} to be a non-negative integer`);
  }
  return number;
}

function optionalString(target, key, value, name) {
  if (value === undefined) return;
  target[key] = requireString(value, name);
}

function copyPoint(value, name) {
  const point = requireObject(value, name);
  const copy = { offset: requireInteger(point.offset, `${name}.offset`) };
  if (point.line !== undefined) copy.line = requireInteger(point.line, `${name}.line`);
  if (point.column !== undefined) copy.column = requireInteger(point.column, `${name}.column`);
  return copy;
}

function copyMark(value, index) {
  const name = `result.marks[${index}]`;
  const mark = requireObject(value, name);
  const position = requireObject(mark.position, `${name}.position`);
  const copy = {
    ruleId: requireString(mark.ruleId, `${name}.ruleId`),
    family: requireString(mark.family, `${name}.family`),
    actual: requireString(mark.actual, `${name}.actual`),
    position: {
      start: copyPoint(position.start, `${name}.position.start`),
      end: copyPoint(position.end, `${name}.position.end`)
    }
  };

  optionalString(copy, "technique", mark.technique, `${name}.technique`);
  optionalString(copy, "note", mark.note, `${name}.note`);
  optionalString(copy, "level", mark.level, `${name}.level`);

  if (mark.expected !== undefined) {
    if (!Array.isArray(mark.expected)) {
      throw new TypeError(`toSignal() needs ${name}.expected to be an array`);
    }
    copy.expected = mark.expected.map((item, itemIndex) =>
      requireString(item, `${name}.expected[${itemIndex}]`)
    );
  }
  if (mark.confidence !== undefined) {
    copy.confidence = requireNumber(mark.confidence, `${name}.confidence`);
  }

  return copy;
}

function copyEngine(value) {
  if (value == null) return null;
  const engine = requireObject(value, "result.engine");
  const copy = {};
  optionalString(copy, "name", engine.name, "result.engine.name");
  optionalString(copy, "version", engine.version, "result.engine.version");
  optionalString(copy, "rules", engine.rules, "result.engine.rules");
  return copy;
}

function sortedCounts(marks, key) {
  const counts = new Map();
  for (let index = 0; index < marks.length; index++) {
    const mark = requireObject(marks[index], `result.marks[${index}]`);
    const id = requireString(mark[key], `result.marks[${index}].${key}`);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([id, count]) => ({ id, count }));
}

/**
 * Convert a canonical RhetorLint result into a JSON-safe external signal.
 *
 * By default the signal contains only aggregate counts and provenance. Passing
 * `{ includeMarks: true }` adds cloned phrase-level marks. It never includes
 * `strip` or `rewrite`.
 */
export function toSignal(result, options = {}) {
  const canonical = requireObject(result, "a canonical RhetorLint result");
  if (!Array.isArray(canonical.marks)) {
    throw new TypeError("toSignal() needs result.marks to be an array");
  }

  const source = requireObject(canonical.source, "result.source");
  const density = requireObject(canonical.density, "result.density");
  const signal = {
    schema: SIGNAL_SCHEMA,
    kind: "rhetorlint.analysis",
    boundary: {
      observes: "visible-language-patterns",
      doesNot: [...BOUNDARY_DOES_NOT],
      note: BOUNDARY_NOTE
    },
    rhetorlint: requireString(canonical.rhetorlint, "result.rhetorlint"),
    engine: copyEngine(canonical.engine),
    source: {
      chars: requireInteger(source.chars, "result.source.chars"),
      words: requireInteger(source.words, "result.source.words"),
      locale: requireString(source.locale, "result.source.locale")
    },
    density: {
      tells: requireInteger(density.tells, "result.density.tells"),
      per100Words: requireNumber(density.per100Words, "result.density.per100Words")
    },
    summary: {
      families: sortedCounts(canonical.marks, "family"),
      rules: sortedCounts(canonical.marks, "ruleId")
    }
  };

  // Only the literal boolean true opts into phrase disclosure.
  if (options && options.includeMarks === true) {
    signal.marks = canonical.marks.map(copyMark);
  }

  return signal;
}
