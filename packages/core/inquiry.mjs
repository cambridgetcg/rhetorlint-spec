/**
 * A privacy-conscious inquiry projection for agents and other consumers.
 *
 * Canonical RhetorLint marks are surface-linked rule matches: only their span
 * and position are direct observations, while labels and reviewer fields come
 * from the rule pack. This adapter joins each mark to contestable hypotheses
 * and verification questions without upgrading either into an observed effect
 * or a truth verdict. Phrase text is omitted unless the caller passes literal
 * `includeActual: true`.
 */

export const INQUIRY_SCHEMA = "rhetorlint.inquiry/0.1";

const BOUNDARY = {
  observation: "span-and-position-only",
  classification: "rule-pack-candidate-context-required",
  interpretation: "hypotheses-not-findings",
  effects: "recipient-specific-evidence-required",
  truth: "questions-not-verdicts"
};

const ASSURANCE = {
  metadataSource: "caller-supplied-rule-pack",
  boundary: "declared-not-semantically-verified",
  fingerprintUse: "change-detection-not-authentication"
};

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`toInquiry() needs ${name} to be an object`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string") {
    throw new TypeError(`toInquiry() needs ${name} to be a string`);
  }
  return value;
}

function requireInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`toInquiry() needs ${name} to be a non-negative integer`);
  }
  return value;
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`toInquiry() needs ${name} to be a positive integer`);
  }
  return value;
}

function copyStrings(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`toInquiry() needs ${name} to be an array`);
  }
  return value.map((item, index) => requireString(item, `${name}[${index}]`));
}

function copyNonEmptyStrings(value, name) {
  const copy = copyStrings(value, name);
  if (copy.length === 0) {
    throw new TypeError(`toInquiry() needs ${name} to contain at least one item`);
  }
  return copy;
}

function copyPoint(value, name) {
  const point = requireObject(value, name);
  const copy = { offset: requireInteger(point.offset, `${name}.offset`) };
  if (point.line !== undefined) copy.line = requirePositiveInteger(point.line, `${name}.line`);
  if (point.column !== undefined) copy.column = requirePositiveInteger(point.column, `${name}.column`);
  return copy;
}

function copyPosition(value, name) {
  const position = requireObject(value, name);
  return {
    start: copyPoint(position.start, `${name}.start`),
    end: copyPoint(position.end, `${name}.end`)
  };
}

function copyEngine(value) {
  if (value == null) return null;
  const engine = requireObject(value, "result.engine");
  const copy = {};
  for (const key of ["name", "version", "rules"]) {
    if (engine[key] !== undefined) {
      copy[key] = requireString(engine[key], `result.engine.${key}`);
    }
  }
  return copy;
}

function copyHypothesis(value, name) {
  const hypothesis = requireObject(value, name);
  return {
    id: requireString(hypothesis.id, `${name}.id`),
    dimension: requireString(hypothesis.dimension, `${name}.dimension`),
    operation: requireString(hypothesis.operation, `${name}.operation`),
    description: requireString(hypothesis.description, `${name}.description`),
    conditions: copyNonEmptyStrings(hypothesis.conditions, `${name}.conditions`),
    alternatives: copyNonEmptyStrings(hypothesis.alternatives, `${name}.alternatives`),
    measures: copyNonEmptyStrings(hypothesis.measures, `${name}.measures`)
  };
}

function copyProbe(value, name) {
  const probe = requireObject(value, name);
  return {
    id: requireString(probe.id, `${name}.id`),
    question: requireString(probe.question, `${name}.question`),
    evidenceNeeded: copyNonEmptyStrings(probe.evidenceNeeded, `${name}.evidenceNeeded`)
  };
}

function canonicalJson(value, name) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalJson(item, `${name}[${index}]`)).join(",")}]`;
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (Number.isFinite(value)) return JSON.stringify(value);
      break;
    case "object": {
      const entries = Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(value[key], `${name}.${key}`)}`
      );
      return `{${entries.join(",")}}`;
    }
  }
  throw new TypeError(`toInquiry() needs ${name} to contain JSON-safe data`);
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function ruleIndex(pack) {
  const rules = requireObject(pack, "options.rules");
  if (!Array.isArray(rules.rules)) {
    throw new TypeError("toInquiry() needs options.rules.rules to be an array");
  }
  const index = new Map();
  const metadata = [];
  for (let i = 0; i < rules.rules.length; i++) {
    const rule = requireObject(rules.rules[i], `options.rules.rules[${i}]`);
    const ruleId = requireString(rule.ruleId, `options.rules.rules[${i}].ruleId`);
    if (index.has(ruleId)) {
      throw new TypeError(`toInquiry() received duplicate ruleId '${ruleId}'`);
    }
    index.set(ruleId, rule);
    metadata.push({
      ruleId,
      family: rule.family ?? null,
      displayName: rule.displayName ?? null,
      taxonomyMappingStatus: rule.taxonomyMappingStatus ?? null,
      effectHypotheses: rule.effectHypotheses ?? null,
      verificationProbes: rule.verificationProbes ?? null
    });
  }
  metadata.sort((left, right) =>
    left.ruleId < right.ruleId ? -1 : left.ruleId > right.ruleId ? 1 : 0
  );
  const id = requireString(rules.id, "options.rules.id");
  const version = requireString(rules.version, "options.rules.version");
  return {
    id,
    version,
    metadataFingerprint: fnv1a64(canonicalJson({ id, version, rules: metadata }, "options.rules")),
    index
  };
}

/**
 * Join canonical marks to structured inquiry metadata.
 *
 * `options.rules` is required because canonical marks deliberately stay small.
 * `sourceRef` is a caller-supplied opaque reference; this adapter never hashes
 * or transmits source text. Only literal `includeActual: true` discloses the
 * phrases already present in result.marks.
 */
export function toInquiry(result, options = {}) {
  const canonical = requireObject(result, "a canonical RhetorLint result");
  if (!Array.isArray(canonical.marks)) {
    throw new TypeError("toInquiry() needs result.marks to be an array");
  }
  const pack = ruleIndex(options.rules);
  const engine = copyEngine(canonical.engine);
  const rulesRef = `${pack.id}@${pack.version}`;
  if (engine?.rules !== undefined && engine.rules !== rulesRef) {
    throw new TypeError(
      `toInquiry() rules provenance mismatch: result names '${engine.rules}', options.rules names '${rulesRef}'`
    );
  }

  const inquiry = {
    schema: INQUIRY_SCHEMA,
    kind: "rhetorlint.inquiry",
    boundary: { ...BOUNDARY },
    assurance: {
      ...ASSURANCE,
      analysisPackBinding: engine?.rules === undefined
        ? "matched-family-only"
        : "id-version-and-matched-family-only"
    },
    sourceAccess: {
      source: "not-included",
      reference: options.sourceRef === undefined ? "none" : "caller-supplied-unverified",
      markedPhrases: options.includeActual === true ? "disclosed" : "omitted"
    },
    rhetorlint: requireString(canonical.rhetorlint, "result.rhetorlint"),
    engine,
    rules: rulesRef,
    metadataFingerprint: pack.metadataFingerprint,
    items: canonical.marks.map((value, markIndex) => {
      const name = `result.marks[${markIndex}]`;
      const mark = requireObject(value, name);
      const ruleId = requireString(mark.ruleId, `${name}.ruleId`);
      const rule = pack.index.get(ruleId);
      if (!rule) {
        throw new TypeError(`toInquiry() cannot resolve mark ruleId '${ruleId}' in options.rules`);
      }
      const family = requireString(mark.family, `${name}.family`);
      const ruleFamily = requireString(rule.family, `rule '${ruleId}'.family`);
      if (family !== ruleFamily) {
        throw new TypeError(
          `toInquiry() family provenance mismatch for '${ruleId}': result names '${family}', options.rules names '${ruleFamily}'`
        );
      }
      const displayName = requireString(rule.displayName, `rule '${ruleId}'.displayName`);
      if (mark.displayName !== undefined && mark.displayName !== displayName) {
        throw new TypeError(
          `toInquiry() display-name provenance mismatch for '${ruleId}'`
        );
      }
      const taxonomyMappingStatus = requireString(
        rule.taxonomyMappingStatus,
        `rule '${ruleId}'.taxonomyMappingStatus`
      );
      if (!["aligned-candidate", "approximate-candidate", "rhetorlint-extension"].includes(
        taxonomyMappingStatus
      )) {
        throw new TypeError(
          `toInquiry() received unsupported taxonomyMappingStatus '${taxonomyMappingStatus}' for '${ruleId}'`
        );
      }
      if (
        mark.classificationStatus !== undefined &&
        mark.classificationStatus !== "rule-pack-candidate-context-required"
      ) {
        throw new TypeError(
          `toInquiry() received unsupported classificationStatus '${mark.classificationStatus}' for '${ruleId}'`
        );
      }
      if (
        mark.taxonomyMappingStatus !== undefined &&
        mark.taxonomyMappingStatus !== taxonomyMappingStatus
      ) {
        throw new TypeError(
          `toInquiry() taxonomy mapping provenance mismatch for '${ruleId}'`
        );
      }

      const hypotheses = rule.effectHypotheses;
      const probes = rule.verificationProbes;
      if (!Array.isArray(hypotheses) || hypotheses.length === 0) {
        throw new TypeError(
          `toInquiry() needs rule '${ruleId}'.effectHypotheses to be a non-empty array`
        );
      }
      if (!Array.isArray(probes) || probes.length === 0) {
        throw new TypeError(
          `toInquiry() needs rule '${ruleId}'.verificationProbes to be a non-empty array`
        );
      }

      const item = {
        markRef: {
          ruleId,
          displayName,
          family,
          classificationStatus: "rule-pack-candidate-context-required",
          taxonomyMappingStatus,
          position: copyPosition(mark.position, `${name}.position`)
        },
        effectHypotheses: hypotheses.map((hypothesis, index) =>
          copyHypothesis(hypothesis, `rule '${ruleId}'.effectHypotheses[${index}]`)
        ),
        verificationProbes: probes.map((probe, index) =>
          copyProbe(probe, `rule '${ruleId}'.verificationProbes[${index}]`)
        )
      };
      if (options.includeActual === true) {
        item.actual = requireString(mark.actual, `${name}.actual`);
      }
      return item;
    })
  };

  if (options.sourceRef !== undefined) {
    inquiry.sourceRef = requireString(options.sourceRef, "options.sourceRef");
  }
  return inquiry;
}
