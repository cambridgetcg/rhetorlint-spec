/**
 * Claim Feedback 0.1
 *
 * Turns one supplied, bounded crawl receipt into a reviewable claim packet.
 * It does not crawl, contact, publish, sign a KARMA deed, or write training
 * data. RhetorLint remains a wording lens; evidence and correction stay in
 * separate lanes.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { resolve } from "node:path";
import { types as utilTypes } from "node:util";
import { fileURLToPath } from "node:url";
import { analyze } from "../../packages/core/index.mjs";
import { toSignal } from "../../packages/core/signals.mjs";

const CORE_SOURCE_BYTES = readFileSync(new URL("../../packages/core/index.mjs", import.meta.url));
const SIGNAL_SOURCE_BYTES = readFileSync(new URL("../../packages/core/signals.mjs", import.meta.url));
const CORE_PACKAGE = JSON.parse(
  readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf8"),
);
const RULE_SOURCE_BYTES = readFileSync(
  new URL("../../packages/rules-en/rules.json", import.meta.url),
);
const MODULE_SOURCE_BYTES = readFileSync(new URL(import.meta.url));
const RULES = JSON.parse(RULE_SOURCE_BYTES.toString("utf8"));

export const SCHEMAS = Object.freeze({
  input: "claim-feedback.input/0.1",
  packet: "claim-feedback.packet/0.1",
  karma_draft: "claim-feedback.karma-draft/0.1",
  training_candidate: "claim-feedback.training-candidate/0.1",
});

export const BOUNDS = Object.freeze({
  max_input_bytes: 65_536,
  max_claim_body_bytes: 32_768,
  max_evidence_body_bytes: 16_384,
  max_sources: 8,
  max_evidence: 4,
  max_list_items: 12,
  max_text_chars: 4_000,
  max_json_depth: 32,
  max_json_nodes: 20_000,
  max_external_state_changes: 0,
});

const TOP_KEYS = [
  "schema", "claim", "crawl", "challenge", "response", "material_review", "reuse",
];
const CLAIM_KEYS = [
  "id", "url", "text", "language", "scope", "correction_url", "withdrawal_url",
  "sources", "uncertainties",
];
const SOURCE_KEYS = ["url", "observed_at", "content_sha256", "supports"];
const CRAWL_KEYS = [
  "retrieved_at", "method", "url", "final_url", "http_status", "media_type", "body_utf8",
  "body_sha256", "claim_sha256", "access", "known_effects", "known_limits",
];
const ACCESS_KEYS = [
  "basis", "crawler_name", "crawler_version", "crawler_user_agent", "robots",
];
const ROBOTS_KEYS = ["decision", "url", "observed_at", "content_sha256"];
const CHALLENGE_KEYS = [
  "id", "kind", "made_at", "text", "language", "evidence", "speaker_claim",
  "attribution_basis", "source", "confidence", "known_limits",
];
const EVIDENCE_KEYS = [
  "url", "observed_at", "http_status", "media_type", "body_utf8", "body_sha256",
  "excerpt", "interpretation",
];
const RESPONSE_KEYS = [
  "kind", "received_at", "text", "language", "replacement_claim",
  "replacement_claim_language", "speaker_claim", "attribution_basis", "source", "confidence",
  "known_limits",
];
const MATERIAL_REVIEW_KEYS = [
  "status", "reviewed_at", "speaker_claim", "attribution_basis", "source", "confidence",
  "contains_personal_data", "contains_sensitive_data", "contains_third_party_material",
  "known_limits",
];
const REUSE_KEYS = [
  "search", "retrieval", "model_input", "training", "mirror", "declaring_party",
  "authority_basis", "applies_to_sha256", "license_url", "policy_url", "effective_at",
  "assessed_at", "withdrawn_at", "source", "known_limits",
];

const CHALLENGE_KINDS = new Set([
  "evidence-request",
  "contrary-evidence",
  "scope-question",
  "wording-question",
  "prediction-check",
  "advertised-observed-mismatch",
]);
const RESPONSE_KINDS = new Set([
  "reply", "dispute", "settlement", "redaction-request", "correction", "boundary",
]);
const ATTRIBUTION_BASES = new Set(["self", "direct-report", "indirect-report", "inference"]);
const CONFIDENCES = new Set(["not-assessed", "low", "medium", "high", "undecidable"]);
const USE_CHOICES = new Set(["allow", "deny", "unspecified"]);
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNSAFE_TEXT_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, path) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be a plain object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${path} must contain exactly: ${expected.join(", ")}`);
  }
}

function text(value, path, { min = 1, max = BOUNDS.max_text_chars } = {}) {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || value.length < min
    || value.length > max
    || UNSAFE_TEXT_RE.test(value)
    || hasUnpairedSurrogate(value)
  ) {
    throw new TypeError(`${path} must be ${min}-${max} trimmed, safe characters`);
  }
  return value;
}

function nullableText(value, path, options) {
  if (value === null) return null;
  return text(value, path, options);
}

function utf8Body(value, path, maxBytes) {
  if (
    typeof value !== "string"
    || value.length === 0
    || UNSAFE_TEXT_RE.test(value)
    || hasUnpairedSurrogate(value)
  ) {
    throw new TypeError(`${path} must be a non-empty, safe UTF-8 text body`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new RangeError(`${path} exceeds ${maxBytes} UTF-8 bytes`);
  }
  return value;
}

function choice(value, allowed, path) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new TypeError(`${path} must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function iso(value, path) {
  text(value, path, { max: 40 });
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError(`${path} must be a canonical UTC timestamp with milliseconds`);
  }
  return value;
}

function nullableIso(value, path) {
  return value === null ? null : iso(value, path);
}

function httpsUrl(value, path) {
  text(value, path, { max: 2_000 });
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${path} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new TypeError(`${path} must be HTTPS, credential-free, and fragment-free`);
  }
  return parsed;
}

function nullableHttpsUrl(value, path) {
  return value === null ? null : httpsUrl(value, path);
}

function httpsSourceLocator(value, path) {
  text(value, path, { max: 2_000 });
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${path} must be a recoverable absolute HTTPS source locator`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new TypeError(`${path} must be a recoverable, credential-free HTTPS source locator`);
  }
  return parsed;
}

function digest(value, path) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    throw new TypeError(`${path} must be sha256:<64 lowercase hex characters>`);
  }
  return value;
}

function stringList(value, path, { min = 0, max = BOUNDS.max_list_items } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${path} must contain ${min}-${max} strings`);
  }
  return value.map((item, index) => text(item, `${path}[${index}]`, { max: 1_000 }));
}

function requireInteger(value, path, { min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${path} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function assertAttribution(value, path) {
  choice(value.attribution_basis, ATTRIBUTION_BASES, `${path}.attribution_basis`);
  text(value.speaker_claim, `${path}.speaker_claim`, { max: 255 });
  if (value.attribution_basis === "self" && value.speaker_claim !== "recorder") {
    throw new TypeError(`${path}.speaker_claim must be recorder when attribution is self`);
  }
  httpsSourceLocator(value.source, `${path}.source`);
  choice(value.confidence, CONFIDENCES, `${path}.confidence`);
  stringList(value.known_limits, `${path}.known_limits`, { min: 1 });
}

function stableJsonUnchecked(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJsonUnchecked).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${stableJsonUnchecked(value[key])}`,
  ).join(",")}}`;
}

function digestGeneratedJson(value) {
  // RhetorLint creates this fixed-shape data from already bounded, validated text.
  // The hostile-input node ceiling belongs at the public input door, not here.
  return sha256(stableJsonUnchecked(value));
}

export function sha256(value) {
  if (typeof value === "string" && hasUnpairedSurrogate(value)) {
    throw new TypeError("sha256 input contains an unpaired UTF-16 surrogate");
  }
  if (typeof value !== "string" && !Buffer.isBuffer(value)) {
    throw new TypeError("sha256 input must be a string or Buffer");
  }
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function assertPlainJson(value, rootPath = "$input") {
  const seen = new Set();
  let nodes = 0;
  function visit(item, path, depth) {
    nodes += 1;
    if (nodes > BOUNDS.max_json_nodes) {
      throw new RangeError(`${rootPath} exceeds ${BOUNDS.max_json_nodes} JSON nodes`);
    }
    if (depth > BOUNDS.max_json_depth) {
      throw new RangeError(`${path} exceeds JSON depth ${BOUNDS.max_json_depth}`);
    }
    if (typeof item === "string" && hasUnpairedSurrogate(item)) {
      throw new TypeError(`${path} contains an unpaired UTF-16 surrogate`);
    }
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object") throw new TypeError(`${path} is not JSON data`);
    if (utilTypes.isProxy(item)) throw new TypeError(`${path} must not be a Proxy`);
    if (seen.has(item)) throw new TypeError(`${path} contains a cycle`);
    if (Array.isArray(item) && Object.getPrototypeOf(item) !== Array.prototype) {
      throw new TypeError(`${path} must use the standard Array prototype`);
    }
    if (!Array.isArray(item) && !isPlainObject(item)) {
      throw new TypeError(`${path} must use plain JSON objects`);
    }
    seen.add(item);
    const keys = Reflect.ownKeys(item);
    if (keys.some((key) => typeof key === "symbol")) {
      throw new TypeError(`${path} must not contain symbol properties`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Array.isArray(item)) {
      const length = descriptors.length?.value;
      let dense = Number.isSafeInteger(length) && length >= 0 && keys.length === length + 1;
      for (let index = 0; dense && index < length; index += 1) {
        dense = keys[index] === String(index);
      }
      dense = dense && keys[length] === "length";
      if (!dense) {
        throw new TypeError(`${path} must be a dense JSON array with no extra properties`);
      }
    }
    for (const key of keys) {
      if (Array.isArray(item) && key === "length") continue;
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`${path}.${String(key)} must be an enumerable data property, not an accessor`);
      }
      visit(descriptor.value, `${path}.${String(key)}`, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, rootPath, 0);
}

export function stableJson(value) {
  assertPlainJson(value, "$value");
  return stableJsonUnchecked(value);
}

function assertInput(input) {
  assertPlainJson(input);
  const bytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (bytes > BOUNDS.max_input_bytes) {
    throw new RangeError(`input exceeds ${BOUNDS.max_input_bytes} UTF-8 bytes`);
  }
  exactKeys(input, TOP_KEYS, "$input");
  if (input.schema !== SCHEMAS.input) throw new TypeError(`$input.schema must equal ${SCHEMAS.input}`);

  exactKeys(input.claim, CLAIM_KEYS, "$input.claim");
  if (!ID_RE.test(input.claim.id)) throw new TypeError("$input.claim.id must be a lowercase slug");
  const claimUrl = httpsUrl(input.claim.url, "$input.claim.url");
  text(input.claim.text, "$input.claim.text", { max: 8_000 });
  text(input.claim.language, "$input.claim.language", { max: 35 });
  text(input.claim.scope, "$input.claim.scope", { max: 2_000 });
  httpsUrl(input.claim.correction_url, "$input.claim.correction_url");
  httpsUrl(input.claim.withdrawal_url, "$input.claim.withdrawal_url");
  if (!Array.isArray(input.claim.sources) || input.claim.sources.length < 1 || input.claim.sources.length > BOUNDS.max_sources) {
    throw new TypeError(`$input.claim.sources must contain 1-${BOUNDS.max_sources} sources`);
  }
  input.claim.sources.forEach((source, index) => {
    const path = `$input.claim.sources[${index}]`;
    exactKeys(source, SOURCE_KEYS, path);
    httpsUrl(source.url, `${path}.url`);
    iso(source.observed_at, `${path}.observed_at`);
    if (source.content_sha256 !== null) digest(source.content_sha256, `${path}.content_sha256`);
    text(source.supports, `${path}.supports`, { max: 1_000 });
  });
  stringList(input.claim.uncertainties, "$input.claim.uncertainties", { min: 1 });

  exactKeys(input.crawl, CRAWL_KEYS, "$input.crawl");
  iso(input.crawl.retrieved_at, "$input.crawl.retrieved_at");
  choice(input.crawl.method, new Set(["GET"]), "$input.crawl.method");
  const crawlUrl = httpsUrl(input.crawl.url, "$input.crawl.url");
  if (crawlUrl.href !== claimUrl.href) throw new TypeError("$input.crawl.url must equal $input.claim.url");
  const finalUrl = httpsUrl(input.crawl.final_url, "$input.crawl.final_url");
  if (finalUrl.href !== claimUrl.href) {
    throw new TypeError("$input.crawl.final_url must equal $input.claim.url");
  }
  requireInteger(input.crawl.http_status, "$input.crawl.http_status", { min: 200, max: 299 });
  text(input.crawl.media_type, "$input.crawl.media_type", { max: 255 });
  utf8Body(input.crawl.body_utf8, "$input.crawl.body_utf8", BOUNDS.max_claim_body_bytes);
  digest(input.crawl.body_sha256, "$input.crawl.body_sha256");
  digest(input.crawl.claim_sha256, "$input.crawl.claim_sha256");
  if (sha256(input.crawl.body_utf8) !== input.crawl.body_sha256) {
    throw new TypeError("$input.crawl.body_sha256 does not match body_utf8");
  }
  if (sha256(input.claim.text) !== input.crawl.claim_sha256) {
    throw new TypeError("$input.crawl.claim_sha256 does not match claim.text");
  }
  if (!input.crawl.body_utf8.includes(input.claim.text)) {
    throw new TypeError("$input.claim.text must appear literally in $input.crawl.body_utf8");
  }
  if (!input.claim.sources.some((source) => (
    new URL(source.url).href === crawlUrl.href
    && source.content_sha256 === input.crawl.body_sha256
  ))) {
    throw new TypeError("$input.claim.sources must bind the captured claim URL and body_sha256");
  }
  stringList(input.crawl.known_effects, "$input.crawl.known_effects", { min: 1 });
  stringList(input.crawl.known_limits, "$input.crawl.known_limits", { min: 1 });

  exactKeys(input.crawl.access, ACCESS_KEYS, "$input.crawl.access");
  choice(
    input.crawl.access.basis,
    new Set(["owner-supplied", "owner-published", "not-established"]),
    "$input.crawl.access.basis",
  );
  text(input.crawl.access.crawler_name, "$input.crawl.access.crawler_name", { max: 255 });
  text(input.crawl.access.crawler_version, "$input.crawl.access.crawler_version", { max: 64 });
  text(input.crawl.access.crawler_user_agent, "$input.crawl.access.crawler_user_agent", {
    max: 512,
  });
  exactKeys(input.crawl.access.robots, ROBOTS_KEYS, "$input.crawl.access.robots");
  const robots = input.crawl.access.robots;
  choice(robots.decision, new Set(["allowed", "disallowed", "not-checked"]), "$input.crawl.access.robots.decision");
  if (robots.decision === "not-checked") {
    if (robots.url !== null || robots.observed_at !== null || robots.content_sha256 !== null) {
      throw new TypeError("unchecked robots fields must all be null");
    }
  } else {
    const robotsUrl = httpsUrl(robots.url, "$input.crawl.access.robots.url");
    iso(robots.observed_at, "$input.crawl.access.robots.observed_at");
    digest(robots.content_sha256, "$input.crawl.access.robots.content_sha256");
    if (
      robotsUrl.origin !== claimUrl.origin
      || robotsUrl.pathname !== "/robots.txt"
      || robotsUrl.search !== ""
    ) {
      throw new TypeError("robots URL must be the claim origin's query-free /robots.txt");
    }
    if (robots.observed_at > input.crawl.retrieved_at) {
      throw new TypeError("$input.crawl.access.robots.observed_at must not follow retrieved_at");
    }
  }

  exactKeys(input.challenge, CHALLENGE_KEYS, "$input.challenge");
  if (!ID_RE.test(input.challenge.id)) throw new TypeError("$input.challenge.id must be a lowercase slug");
  choice(input.challenge.kind, CHALLENGE_KINDS, "$input.challenge.kind");
  iso(input.challenge.made_at, "$input.challenge.made_at");
  if (input.challenge.made_at < input.crawl.retrieved_at) {
    throw new TypeError("$input.challenge.made_at must not precede the crawl receipt");
  }
  text(input.challenge.text, "$input.challenge.text", { max: 2_000 });
  text(input.challenge.language, "$input.challenge.language", { max: 35 });
  if (!Array.isArray(input.challenge.evidence) || input.challenge.evidence.length < 1 || input.challenge.evidence.length > BOUNDS.max_evidence) {
    throw new TypeError(`$input.challenge.evidence must contain 1-${BOUNDS.max_evidence} records`);
  }
  input.challenge.evidence.forEach((evidence, index) => {
    const path = `$input.challenge.evidence[${index}]`;
    exactKeys(evidence, EVIDENCE_KEYS, path);
    httpsUrl(evidence.url, `${path}.url`);
    iso(evidence.observed_at, `${path}.observed_at`);
    if (evidence.observed_at > input.challenge.made_at) {
      throw new TypeError(`${path}.observed_at must not follow $input.challenge.made_at`);
    }
    requireInteger(evidence.http_status, `${path}.http_status`, { min: 100, max: 599 });
    text(evidence.media_type, `${path}.media_type`, { max: 255 });
    utf8Body(evidence.body_utf8, `${path}.body_utf8`, BOUNDS.max_evidence_body_bytes);
    digest(evidence.body_sha256, `${path}.body_sha256`);
    if (sha256(evidence.body_utf8) !== evidence.body_sha256) {
      throw new TypeError(`${path}.body_sha256 does not match body_utf8`);
    }
    text(evidence.excerpt, `${path}.excerpt`, { max: 1_000 });
    if (!evidence.body_utf8.includes(evidence.excerpt)) {
      throw new TypeError(`${path}.excerpt must appear literally in body_utf8`);
    }
    text(evidence.interpretation, `${path}.interpretation`, { max: 1_000 });
  });
  assertAttribution(input.challenge, "$input.challenge");
  if (input.challenge.attribution_basis !== "self" || input.challenge.speaker_claim !== "recorder") {
    throw new TypeError("$input.challenge must be the recorder's self-attributed challenge");
  }

  if (input.response !== null) {
    exactKeys(input.response, RESPONSE_KEYS, "$input.response");
    choice(input.response.kind, RESPONSE_KINDS, "$input.response.kind");
    iso(input.response.received_at, "$input.response.received_at");
    if (input.response.received_at < input.challenge.made_at) {
      throw new TypeError("$input.response.received_at must not precede the challenge");
    }
    text(input.response.text, "$input.response.text", { max: 2_000 });
    text(input.response.language, "$input.response.language", { max: 35 });
    assertAttribution(input.response, "$input.response");
    if (input.response.kind === "correction") {
      if (!new Set(["self", "direct-report"]).has(input.response.attribution_basis)) {
        throw new TypeError("a correction must be self-attributed or directly reported");
      }
      text(input.response.replacement_claim, "$input.response.replacement_claim", { max: 8_000 });
      text(
        input.response.replacement_claim_language,
        "$input.response.replacement_claim_language",
        { max: 35 },
      );
      if (input.response.replacement_claim === input.claim.text) {
        throw new TypeError("a correction replacement must differ from the original claim");
      }
    } else if (
      input.response.replacement_claim !== null
      || input.response.replacement_claim_language !== null
    ) {
      throw new TypeError("only a correction may carry replacement_claim and its language");
    }
    if (
      input.response.kind === "settlement"
      && !new Set(["self", "direct-report"]).has(input.response.attribution_basis)
    ) {
      throw new TypeError("a settlement cannot be inferred or indirectly reported");
    }
    if (
      input.response.kind === "boundary"
      && !new Set(["self", "direct-report"]).has(input.response.attribution_basis)
    ) {
      throw new TypeError("a boundary cannot be inferred or indirectly reported");
    }
  }

  exactKeys(input.material_review, MATERIAL_REVIEW_KEYS, "$input.material_review");
  choice(
    input.material_review.status,
    new Set(["passed", "blocked", "not-reviewed"]),
    "$input.material_review.status",
  );
  nullableIso(input.material_review.reviewed_at, "$input.material_review.reviewed_at");
  assertAttribution(input.material_review, "$input.material_review");
  if (
    input.material_review.attribution_basis !== "self"
    || input.material_review.speaker_claim !== "recorder"
  ) {
    throw new TypeError("$input.material_review must be the recorder's self-attributed review");
  }
  httpsUrl(input.material_review.source, "$input.material_review.source");
  for (const field of [
    "contains_personal_data",
    "contains_sensitive_data",
    "contains_third_party_material",
  ]) {
    if (typeof input.material_review[field] !== "boolean") {
      throw new TypeError(`$input.material_review.${field} must be boolean`);
    }
  }
  if (input.material_review.status === "not-reviewed") {
    if (input.material_review.reviewed_at !== null) {
      throw new TypeError("an unreviewed material record must have reviewed_at null");
    }
  } else {
    if (input.material_review.reviewed_at === null) {
      throw new TypeError("a completed material review must name reviewed_at");
    }
    const newestRecordTime = input.response?.received_at ?? input.challenge.made_at;
    if (input.material_review.reviewed_at < newestRecordTime) {
      throw new TypeError("$input.material_review.reviewed_at must not precede the latest reviewed record");
    }
  }
  if (
    input.material_review.status === "passed"
    && (
      input.material_review.contains_personal_data
      || input.material_review.contains_sensitive_data
      || input.material_review.contains_third_party_material
    )
  ) {
    throw new TypeError("a passed material review must not declare personal, sensitive, or third-party material");
  }

  exactKeys(input.reuse, REUSE_KEYS, "$input.reuse");
  for (const field of ["search", "retrieval", "model_input", "training", "mirror"]) {
    choice(input.reuse[field], USE_CHOICES, `$input.reuse.${field}`);
  }
  text(input.reuse.declaring_party, "$input.reuse.declaring_party", { max: 255 });
  text(input.reuse.authority_basis, "$input.reuse.authority_basis", { max: 1_000 });
  if (
    !Array.isArray(input.reuse.applies_to_sha256)
    || input.reuse.applies_to_sha256.length < 1
    || input.reuse.applies_to_sha256.length > 16
  ) {
    throw new TypeError("$input.reuse.applies_to_sha256 must contain 1-16 digests");
  }
  input.reuse.applies_to_sha256.forEach((item, index) => digest(item, `$input.reuse.applies_to_sha256[${index}]`));
  if (new Set(input.reuse.applies_to_sha256).size !== input.reuse.applies_to_sha256.length) {
    throw new TypeError("$input.reuse.applies_to_sha256 must not contain duplicates");
  }
  nullableHttpsUrl(input.reuse.license_url, "$input.reuse.license_url");
  nullableHttpsUrl(input.reuse.policy_url, "$input.reuse.policy_url");
  iso(input.reuse.effective_at, "$input.reuse.effective_at");
  iso(input.reuse.assessed_at, "$input.reuse.assessed_at");
  const newestReuseRecordTime = input.response?.received_at ?? input.challenge.made_at;
  if (input.reuse.assessed_at < newestReuseRecordTime) {
    throw new TypeError("$input.reuse.assessed_at must not precede the latest covered record");
  }
  if (
    input.material_review.reviewed_at !== null
    && input.reuse.assessed_at < input.material_review.reviewed_at
  ) {
    throw new TypeError(
      "$input.reuse.assessed_at must not precede $input.material_review.reviewed_at",
    );
  }
  nullableIso(input.reuse.withdrawn_at, "$input.reuse.withdrawn_at");
  if (input.reuse.withdrawn_at !== null && input.reuse.withdrawn_at < input.reuse.effective_at) {
    throw new TypeError("$input.reuse.withdrawn_at must not precede effective_at");
  }
  httpsUrl(input.reuse.source, "$input.reuse.source");
  stringList(input.reuse.known_limits, "$input.reuse.known_limits", { min: 1 });
}

export function validateClaimFeedbackInput(input) {
  try {
    assertInput(input);
    makeKarmaDraft(input, sha256(stableJson(input)));
    return [];
  } catch (error) {
    return [{ path: "$input", message: error.message }];
  }
}

function evidenceSummary(evidence) {
  return {
    url: evidence.url,
    observed_at: evidence.observed_at,
    http_status: evidence.http_status,
    media_type: evidence.media_type,
    body_bytes: Buffer.byteLength(evidence.body_utf8, "utf8"),
    body_sha256: evidence.body_sha256,
    excerpt: evidence.excerpt,
    interpretation: evidence.interpretation,
  };
}

function wordingMethod() {
  return {
    engine: {
      name: CORE_PACKAGE.name,
      version: CORE_PACKAGE.version,
      source_sha256: sha256(CORE_SOURCE_BYTES),
    },
    signal_projection: {
      name: `${CORE_PACKAGE.name}/signals`,
      version: CORE_PACKAGE.version,
      source_sha256: sha256(SIGNAL_SOURCE_BYTES),
    },
    rules: {
      id: RULES.id,
      version: RULES.version,
      source_sha256: sha256(RULE_SOURCE_BYTES),
    },
    packet_projection: {
      schema: SCHEMAS.packet,
      source_sha256: sha256(MODULE_SOURCE_BYTES),
    },
    language_support: "English pack only",
    offset_units: "UTF-16 code units",
  };
}

function reviewOneText(value, language) {
  if (!/^en(?:-|$)/i.test(language)) {
    return {
      status: "unsupported-language",
      language_support: "English only",
      supplied_language: language,
      signal: null,
      analysis_result_sha256: null,
      shared_signal_sha256: null,
      note: "RhetorLint was not run: this example has only an English pack.",
    };
  }
  const result = analyze(value, { rules: RULES, locale: language });
  const signal = toSignal(result);
  return {
    status: result.marks.length === 0 ? "none-marked-by-pack" : "patterns-marked",
    language_support: "English only",
    supplied_language: language,
    signal,
    analysis_result_sha256: digestGeneratedJson(result),
    shared_signal_sha256: digestGeneratedJson(signal),
    note: result.marks.length === 0
      ? "No supported wording patterns were marked by this English pack."
      : `${result.marks.length} supported wording pattern(s) were marked by this English pack. Each mark is a reading prompt, not a truth, lie, intent, or person verdict.`,
  };
}

function wordingReview(input) {
  return {
    scope: "each supplied text is reviewed separately; results are never aggregated by speaker or person",
    person_aggregation: false,
    method: wordingMethod(),
    claim: reviewOneText(input.claim.text, input.claim.language),
    challenge: reviewOneText(input.challenge.text, input.challenge.language),
    response: input.response === null
      ? null
      : reviewOneText(input.response.text, input.response.language),
    replacement_claim: input.response?.replacement_claim === null || input.response === null
      ? null
      : reviewOneText(
        input.response.replacement_claim,
        input.response.replacement_claim_language,
      ),
  };
}

function karmaRecord({
  localRef,
  kind,
  parent = null,
  text: deedText,
  purpose = "",
  expectationRef = "not-applicable",
  effectBasis = "",
  evidenceStatus = "not-applicable",
  evidence = "",
  claimedRelation = "",
  causalConfidence = "",
  responseType = "",
  speakerClaim,
  attributionBasis,
  source,
  confidence,
  knownLimits,
}) {
  const record = {
    local_ref: localRef,
    proposed_deed_kind: kind,
    parent_local_ref: parent,
    text: deedText,
    purpose,
    expectation_ref: expectationRef,
    effect_basis: effectBasis,
    evidence_status: evidenceStatus,
    evidence,
    claimed_relation: claimedRelation,
    causal_confidence: causalConfidence,
    response_type: responseType,
    speaker_claim: speakerClaim,
    attribution_basis: attributionBasis,
    source,
    epistemic_confidence: confidence,
    known_limits: knownLimits,
  };
  text(record.local_ref, "$karma.local_ref", { max: 255 });
  text(record.proposed_deed_kind, "$karma.proposed_deed_kind", { max: 32 });
  if (record.parent_local_ref !== null) {
    text(record.parent_local_ref, "$karma.parent_local_ref", { max: 255 });
  }
  text(record.text, "$karma.text", { min: 4, max: 1_800 });
  text(record.purpose, "$karma.purpose", { min: 0, max: 1_800 });
  text(record.expectation_ref, "$karma.expectation_ref", { min: 0, max: 32 });
  text(record.effect_basis, "$karma.effect_basis", { min: 0, max: 32 });
  text(record.evidence_status, "$karma.evidence_status", { min: 0, max: 32 });
  text(record.evidence, "$karma.evidence", { min: 0, max: 1_800 });
  text(record.claimed_relation, "$karma.claimed_relation", { min: 0, max: 255 });
  text(record.causal_confidence, "$karma.causal_confidence", { min: 0, max: 32 });
  text(record.response_type, "$karma.response_type", { min: 0, max: 32 });
  text(record.speaker_claim, "$karma.speaker_claim", { max: 255 });
  text(record.attribution_basis, "$karma.attribution_basis", { max: 32 });
  text(record.source, "$karma.source", { max: 1_800 });
  text(record.epistemic_confidence, "$karma.epistemic_confidence", { max: 32 });
  text(record.known_limits, "$karma.known_limits", { max: 1_800 });
  return record;
}

function makeKarmaDraft(input, inputDigest) {
  const crawlSource = [
    input.crawl.url,
    `supplied body ${input.crawl.body_sha256}`,
    `complete input ${inputDigest}`,
  ].join("; ");
  const reviewSource = `${input.challenge.source}; complete input ${inputDigest}`;
  const findingEvidence = [
    `claim receipt ${input.crawl.url} body ${input.crawl.body_sha256}`,
    ...input.challenge.evidence.map(
      (item) => `evidence receipt ${item.url} body ${item.body_sha256}`,
    ),
  ].join("; ");
  const records = [
    karmaRecord({
      localRef: "scan",
      kind: "action",
      text: `A bounded local pass processed one supplied crawl receipt for ${input.claim.url}.`,
      purpose: "Compare one exact supplied claim record with supplied evidence and return a correction path.",
      expectationRef: "none",
      speakerClaim: "recorder",
      attributionBasis: "self",
      source: crawlSource,
      confidence: "high",
      knownLimits: "The builder made no network request and cannot authenticate the stated remote fetch.",
    }),
    karmaRecord({
      localRef: "finding",
      kind: "consequence",
      parent: "scan",
      text: `The supplied record preserved claim ${input.crawl.claim_sha256} and ${input.challenge.evidence.length} evidence receipt(s).`,
      effectBasis: "observed",
      evidenceStatus: "stated",
      evidence: findingEvidence,
      claimedRelation: "local_builder_processed_supplied_receipts",
      causalConfidence: "high",
      speakerClaim: "recorder",
      attributionBasis: "self",
      source: reviewSource,
      confidence: "high",
      knownLimits: "This consequence is about local processing only, not whether the public claim is true.",
    }),
    karmaRecord({
      localRef: "challenge",
      kind: "response",
      parent: "finding",
      text: `Challenge kind (${input.challenge.kind}): ${input.challenge.text}`,
      responseType: new Set(["contrary-evidence", "advertised-observed-mismatch"])
        .has(input.challenge.kind)
        ? "dispute"
        : "reply",
      speakerClaim: input.challenge.speaker_claim,
      attributionBasis: input.challenge.attribution_basis,
      source: reviewSource,
      confidence: input.challenge.confidence,
      knownLimits: [
        ...input.challenge.known_limits,
        "This builder did not dispatch this challenge; no dispatch, delivery, receipt, or target review is evidenced here.",
      ].join("; "),
    }),
  ];

  if (input.response !== null) {
    const responseKind = input.response.kind;
    const deedKind = responseKind === "correction"
      ? "correction"
      : responseKind === "boundary"
        ? "boundary"
        : "response";
    let replyText = input.response.text;
    let replySource = `${input.response.source}; complete input ${inputDigest}`;
    const replyLimits = [
      ...input.response.known_limits,
      "Parentage records how this supplied item is presented; it does not prove the challenge was dispatched, delivered, read, or caused this response.",
    ];
    if (deedKind === "correction") {
      const replacementDigest = sha256(input.response.replacement_claim);
      replyText = [
        input.response.text,
        `Original claim digest: ${input.crawl.claim_sha256}.`,
        `Replacement claim: ${input.response.replacement_claim}`,
        `Replacement claim digest: ${replacementDigest}.`,
      ].join("\n");
      replySource = [
        input.response.source,
        `original claim ${input.crawl.claim_sha256}`,
        `replacement claim ${replacementDigest}`,
        `complete input ${inputDigest}`,
      ].join("; ");
      replyLimits.push(
        "This records a supplied correction; it is not a repair and does not prove the replacement was published. Any repair is a separate authorised deed with a later consequence.",
      );
    } else if (deedKind === "boundary") {
      replyText = `Claimed boundary: ${input.response.text}`;
      replyLimits.push(
        "This records a claimed scope limit only; it does not authenticate identity, establish authority, or enforce anything. A protective boundary grants no general authority over another home.",
      );
    }
    const reply = karmaRecord({
      localRef: "reply",
      kind: deedKind,
      parent: "challenge",
      text: replyText,
      responseType: deedKind === "response" ? responseKind : "",
      speakerClaim: input.response.speaker_claim,
      attributionBasis: input.response.attribution_basis,
      source: replySource,
      confidence: input.response.confidence,
      knownLimits: replyLimits.join("; "),
    });
    records.push(reply);
  }

  return {
    schema: SCHEMAS.karma_draft,
    status: "unsigned-draft-only",
    importable: false,
    records,
    deeds_signed: 0,
    ledger_writes: 0,
    note: "These are proposed meanings with local parent labels, not KARMA deeds. The builder did not dispatch a challenge or evidence delivery. A correction is not a repair or proof of publication; a boundary is a claimed scope limit, not authority. An authorised operator must review and create any real deed under its own identity.",
  };
}

function makeTrainingCandidate(input, digests) {
  const reasons = [];
  const response = input.response;
  if (response?.kind !== "correction") reasons.push("a source-attributed correction with a changed claim is required");
  if (
    response?.kind === "correction"
    && !new Set(["self", "direct-report"]).has(response.attribution_basis)
  ) {
    reasons.push("the correction must be self-attributed or directly reported");
  }
  if (input.reuse.retrieval !== "allow") reasons.push("retrieval use is not explicitly allowed");
  if (input.reuse.model_input !== "allow") reasons.push("model-input use is not explicitly allowed");
  if (input.reuse.training !== "allow") reasons.push("training use is not explicitly allowed");
  if (input.reuse.license_url === null) reasons.push("no reuse licence URL was supplied");
  if (input.material_review.status !== "passed") {
    reasons.push("the supplied material review has not passed");
  }
  if (input.material_review.contains_personal_data) {
    reasons.push("the supplied material review declares personal data");
  }
  if (input.material_review.contains_sensitive_data) {
    reasons.push("the supplied material review declares sensitive data");
  }
  if (input.material_review.contains_third_party_material) {
    reasons.push("the supplied material review declares third-party material");
  }
  if (input.reuse.effective_at > input.reuse.assessed_at) {
    reasons.push("the supplied reuse declaration is not yet effective at the assessment time");
  }
  if (
    input.reuse.withdrawn_at !== null
    && input.reuse.withdrawn_at <= input.reuse.assessed_at
  ) {
    reasons.push("the supplied reuse declaration was withdrawn by the assessment time");
  }
  if (input.crawl.access.basis === "not-established") reasons.push("the collection basis is not established");
  if (input.crawl.access.robots.decision === "disallowed" && input.crawl.access.basis !== "owner-supplied") {
    reasons.push("the supplied robots observation says this crawl was disallowed");
  }
  const covered = new Set(input.reuse.applies_to_sha256);
  const missing = digests.filter((item) => !covered.has(item));
  if (missing.length) reasons.push(`the supplied reuse declaration does not cover ${missing.length} required digest(s)`);

  const declaredConditionsMet = reasons.length === 0;
  const correction = response?.kind === "correction" ? response : null;
  const reviewProposal = {
    assessed_at: input.reuse.assessed_at,
    original_claim_sha256: input.crawl.claim_sha256,
    evidence_sha256: input.challenge.evidence.map((item) => item.body_sha256),
    corrected_claim_sha256: correction
      ? sha256(correction.replacement_claim)
      : null,
    correction_source: correction?.source ?? null,
    supplied_material_review: {
      status: input.material_review.status,
      reviewed_at: input.material_review.reviewed_at,
      source: input.material_review.source,
      contains_personal_data: input.material_review.contains_personal_data,
      contains_sensitive_data: input.material_review.contains_sensitive_data,
      contains_third_party_material: input.material_review.contains_third_party_material,
    },
    supplied_rights: {
      declaring_party: input.reuse.declaring_party,
      authority_basis: input.reuse.authority_basis,
      license_url: input.reuse.license_url,
      policy_url: input.reuse.policy_url,
      effective_at: input.reuse.effective_at,
      assessed_at: input.reuse.assessed_at,
      withdrawn_at: input.reuse.withdrawn_at,
      source: input.reuse.source,
    },
  };
  reasons.push(
    "independent rights, identity, privacy, licence-compatibility, and provenance review is required",
  );

  return {
    schema: SCHEMAS.training_candidate,
    status: "held-for-independent-review",
    reasons,
    declared_conditions_met: declaredConditionsMet,
    review_proposal: reviewProposal,
    candidate: null,
    human_review_required: true,
    current_declaration_recheck_required: true,
    dataset_writes: 0,
    not_established: [
      "the declaring party's identity or rights authority",
      "licence compatibility with a particular model or dataset",
      "privacy, safety, representativeness, or training usefulness",
      "that the supplied reuse declaration remains current after assessed_at",
      "that any model provider received, used, unlearned, or corrected anything",
    ],
  };
}

function responseProjection(response) {
  if (response === null) return null;
  return {
    kind: response.kind,
    received_at: response.received_at,
    text: response.text,
    language: response.language,
    replacement_claim: response.replacement_claim,
    replacement_claim_language: response.replacement_claim_language,
    replacement_claim_sha256: response.replacement_claim === null
      ? null
      : sha256(response.replacement_claim),
    speaker_claim: response.speaker_claim,
    attribution_basis: response.attribution_basis,
    source: response.source,
    confidence: response.confidence,
    known_limits: [...response.known_limits],
  };
}

export function buildClaimFeedback(input) {
  assertInput(input);
  const inputDigest = sha256(stableJson(input));
  const response = responseProjection(input.response);
  const state = input.response === null
    ? "challenge-open"
    : input.response.kind === "correction"
      ? "correction-recorded"
      : input.response.kind === "boundary"
        ? "boundary-recorded"
        : "response-recorded";
  const requiredTrainingDigests = [
    input.crawl.claim_sha256,
    input.crawl.body_sha256,
    ...input.challenge.evidence.map((item) => item.body_sha256),
    ...(response?.replacement_claim_sha256 ? [response.replacement_claim_sha256] : []),
  ];

  const base = {
    schema: SCHEMAS.packet,
    status: state,
    source_claim: {
      id: input.claim.id,
      url: input.claim.url,
      text: input.claim.text,
      language: input.claim.language,
      scope: input.claim.scope,
      correction_url: input.claim.correction_url,
      withdrawal_url: input.claim.withdrawal_url,
      claim_sha256: input.crawl.claim_sha256,
      sources: input.claim.sources.map((item) => ({ ...item })),
      uncertainties: [...input.claim.uncertainties],
      original_preserved: true,
    },
    crawl_receipt: {
      kind: "supplied-receipt",
      retrieved_at: input.crawl.retrieved_at,
      method: input.crawl.method,
      url: input.crawl.url,
      final_url: input.crawl.final_url,
      http_status: input.crawl.http_status,
      media_type: input.crawl.media_type,
      body_bytes: Buffer.byteLength(input.crawl.body_utf8, "utf8"),
      body_sha256: input.crawl.body_sha256,
      literal_claim_match: true,
      access: {
        basis: input.crawl.access.basis,
        crawler_name: input.crawl.access.crawler_name,
        crawler_version: input.crawl.access.crawler_version,
        crawler_user_agent: input.crawl.access.crawler_user_agent,
        robots: { ...input.crawl.access.robots },
        note: "The crawler identity and robots decision are supplied, unauthenticated observations. Robots records URI preferences for named crawlers; it is not access authorisation, copyright permission, crawler authentication, or AI-training consent.",
      },
      known_effects: [...input.crawl.known_effects],
      known_limits: [...input.crawl.known_limits],
    },
    wording_review: wordingReview(input),
    challenge: {
      id: input.challenge.id,
      kind: input.challenge.kind,
      made_at: input.challenge.made_at,
      text: input.challenge.text,
      language: input.challenge.language,
      evidence: input.challenge.evidence.map(evidenceSummary),
      speaker_claim: input.challenge.speaker_claim,
      attribution_basis: input.challenge.attribution_basis,
      source: input.challenge.source,
      confidence: input.challenge.confidence,
      known_limits: [...input.challenge.known_limits],
    },
    response,
    material_review: {
      ...input.material_review,
      known_limits: [...input.material_review.known_limits],
      note: "This is a supplied, self-attributed local review. The builder does not authenticate the reviewer or prove that no private or third-party material exists.",
    },
    correction_state: {
      status: state,
      original_claim_sha256: input.crawl.claim_sha256,
      latest_recorded_claim: response?.replacement_claim ?? input.claim.text,
      latest_recorded_claim_sha256: response?.replacement_claim_sha256 ?? input.crawl.claim_sha256,
      correction_url: input.claim.correction_url,
      history: [
        {
          kind: "original",
          recorded_at: input.crawl.retrieved_at,
          claim_sha256: input.crawl.claim_sha256,
          source: input.claim.url,
          attribution_basis: "supplied-receipt",
        },
        ...(input.response?.kind === "correction" ? [{
          kind: "correction",
          recorded_at: input.response.received_at,
          claim_sha256: response.replacement_claim_sha256,
          source: input.response.source,
          attribution_basis: input.response.attribution_basis,
        }] : []),
      ],
    },
    withdrawal_state: {
      status: input.reuse.withdrawn_at === null
        ? "not-recorded"
        : input.reuse.withdrawn_at <= input.reuse.assessed_at
          ? "withdrawal-recorded"
          : "withdrawal-scheduled",
      withdrawal_url: input.claim.withdrawal_url,
      effective_at: input.reuse.withdrawn_at,
      assessed_at: input.reuse.assessed_at,
      note: "This is supplied declaration state, not an authenticated withdrawal or proof that downstream copies were removed.",
    },
    reuse_declaration: {
      ...input.reuse,
      applies_to_sha256: [...input.reuse.applies_to_sha256],
      known_limits: [...input.reuse.known_limits],
      note: "Search, retrieval, model input, training, and mirroring are separate choices. This supplied declaration is not authenticated by the builder.",
    },
    karma_draft: makeKarmaDraft(input, inputDigest),
    training_candidate: makeTrainingCandidate(input, requiredTrainingDigests),
    effects: {
      network_requests: 0,
      messages_sent: 0,
      persistent_files_written: 0,
      karma_deeds_signed: 0,
      karma_ledger_writes: 0,
      training_records_written: 0,
      retries: 0,
      external_state_changes_by_builder: 0,
      cli_stdout: "one report when the CLI succeeds",
    },
    limits: [
      "The builder recomputes supplied UTF-8 body digests and literal spans. It does not prove that a stated URL, time, status, or remote request is authentic.",
      "A wording pattern is not evidence that a claim is false or that a speaker intended to deceive.",
      "This packet describes claims, receipts, and responses. It does not score a person, personality, trustworthiness, or ego.",
      "A training candidate remains a proposal for human rights, privacy, safety, and provenance review; it is not a dataset write.",
    ],
    integrity: {
      canonicalization: "recursive lexicographic object keys; array order preserved; UTF-8 JSON without whitespace",
      input_sha256: inputDigest,
      digest_scope: "canonical JSON of the complete packet with integrity.packet_sha256 omitted",
    },
  };
  const packetSha256 = sha256(stableJson(base));
  return {
    ...base,
    integrity: {
      ...base.integrity,
      packet_sha256: packetSha256,
    },
  };
}

export function verifyClaimFeedbackPacket(packet, input) {
  const expected = buildClaimFeedback(input);
  if (stableJson(packet) !== stableJson(expected)) {
    throw new TypeError("packet does not match the canonical projection of its input");
  }
  return true;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sameSnapshot(left, right) {
  return sameFile(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

export function readInputFile(inputPath) {
  const before = lstatSync(inputPath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new TypeError("input must be one regular, non-symlink file");
  }
  if (before.size > BOUNDS.max_input_bytes) {
    throw new RangeError(`input file exceeds ${BOUNDS.max_input_bytes} bytes`);
  }

  let descriptor;
  try {
    descriptor = openSync(
      inputPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFile(before, opened)) {
      throw new TypeError("input changed before it could be opened safely");
    }
    if (opened.size > BOUNDS.max_input_bytes) {
      throw new RangeError(`input file exceeds ${BOUNDS.max_input_bytes} bytes`);
    }

    const buffer = Buffer.alloc(opened.size);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    const after = fstatSync(descriptor);
    const pathAfter = lstatSync(inputPath);
    if (bytesRead !== opened.size || !sameSnapshot(opened, after) || !sameSnapshot(after, pathAfter)) {
      throw new TypeError("input changed while it was being read");
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export const HELP = `Claim Feedback 0.1

Usage:
  node examples/claim-feedback/claim-feedback.mjs INPUT.json

Reads one bounded local JSON file and prints one packet. It makes no network
request, writes no file, sends no message, signs no KARMA deed, and writes no
training record. Set CLAIM_FEEDBACK_HALT=1 to stop before reading the input.
`;

export function runCli(argv = process.argv.slice(2), runtime = {}) {
  const env = runtime.env ?? process.env;
  const stdout = runtime.stdout ?? process.stdout;
  if (env.CLAIM_FEEDBACK_HALT === "1") {
    throw new Error("stopped by CLAIM_FEEDBACK_HALT=1 before input read");
  }
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    stdout.write(HELP);
    return 0;
  }
  if (argv.length !== 1 || argv[0].startsWith("-")) {
    throw new TypeError("expected exactly one INPUT.json path; use --help");
  }
  const inputPath = resolve(argv[0]);
  const input = readInputFile(inputPath);
  stdout.write(`${JSON.stringify(buildClaimFeedback(input), null, 2)}\n`);
  return 0;
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (directPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`claim-feedback: ${error.message}\n`);
    process.exitCode = 1;
  }
}
