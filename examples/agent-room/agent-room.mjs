/**
 * Agent Room 0.1
 *
 * A bounded local projector over owner-supplied events and digest-bound Claim
 * Feedback references. It does not crawl, rank people, publish, send, train,
 * write KARMA, or write a dataset.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { resolve } from "node:path";
import { types as utilTypes } from "node:util";
import { fileURLToPath } from "node:url";

export const SCHEMAS = Object.freeze({
  input: "agent-room.input/0.1",
  event: "agent-room.event/0.1",
  use_declaration: "agent-room.use-declaration/0.1",
  receipt: "agent-room.receipt/0.1",
});

export const BOUNDS = Object.freeze({
  max_input_bytes: 262_144,
  max_events: 128,
  max_use_declarations: 128,
  max_view: 12,
  max_text_code_points: 4_000,
  max_list_items: 16,
  max_json_depth: 32,
  max_json_nodes: 30_000,
  max_cursor: 999_999_999,
});

const INPUT_KEYS = [
  "schema", "prepared_at", "cursor", "view_limit", "events", "use_declarations",
];
const EVENT_KEYS = [
  "schema", "event_id", "recorded_at", "kind", "scope", "scope_ref", "content",
  "source", "speaker_claim", "lane", "visibility", "reply_invited", "known_limits",
];
const CONTENT_KEYS = ["text", "language", "sha256"];
const SOURCE_KEYS = [
  "kind", "namespace", "locator", "packet_sha256", "packet_input_sha256", "claim_sha256",
  "correction_state", "withdrawal_state", "rhetorlint_signal", "discovery",
];
const SIGNAL_KEYS = ["schema", "signal_sha256", "language", "status", "total_marks"];
const DISCOVERY_KEYS = ["publicly_visible", "robots_allowed"];
const SPEAKER_KEYS = ["label", "attribution_basis", "authenticated"];
const DECLARATION_KEYS = [
  "schema", "declaration_id", "declared_at", "target_event_id", "target_sha256", "search",
  "retrieval", "model_input", "training", "mirror", "license_url", "rights_source",
  "withdrawal_url", "material_review", "known_limits",
];
const MATERIAL_KEYS = [
  "status", "reviewed_at", "recorder", "contains_personal_data", "contains_sensitive_data",
  "contains_third_party_material", "known_limits",
];

const EVENT_KINDS = new Set([
  "offer", "reply", "correction", "refusal", "rest", "leave", "withdrawal",
]);
const LANES = Object.freeze(["share", "question", "reply", "correction"]);
const LANE_SET = new Set([...LANES, "quiet"]);
const ATTRIBUTION_BASES = new Set(["self", "direct-report"]);
const USE_CHOICES = new Set(["not-offered", "offered-for-independent-review"]);
const SIGNAL_STATUSES = new Set([
  "patterns-marked", "no-supported-patterns", "unsupported-language",
]);
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const LANGUAGE_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
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

function assertPlainJson(root) {
  const seen = new Set();
  let nodes = 0;

  function visit(value, path, depth) {
    nodes += 1;
    if (nodes > BOUNDS.max_json_nodes) throw new RangeError("input JSON graph is too large");
    if (depth > BOUNDS.max_json_depth) throw new RangeError("input JSON graph is too deep");
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError(`${path} must contain a finite JSON number`);
      return;
    }
    if (!value || typeof value !== "object") throw new TypeError(`${path} must contain JSON data only`);
    if (utilTypes.isProxy(value)) throw new TypeError(`${path} must not contain a Proxy`);
    if (seen.has(value)) throw new TypeError(`${path} must not contain a cycle or shared object`);
    seen.add(value);
    if (Object.getOwnPropertySymbols(value).length) {
      throw new TypeError(`${path} must not contain symbol properties`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError(`${path} must use the ordinary Array prototype`);
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${path} must not contain sparse slots`);
      }
      const permitted = new Set(["length"]);
      for (let index = 0; index < value.length; index += 1) permitted.add(String(index));
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key === "string" && !permitted.has(key)) {
          throw new TypeError(`${path} must not contain extra array properties`);
        }
      }
    } else if (!isPlainObject(value)) {
      throw new TypeError(`${path} must contain plain objects only`);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "length" && Array.isArray(value)) continue;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${path}.${key} must be an enumerable data property`);
      }
      visit(descriptor.value, `${path}.${key}`, depth + 1);
    }
    seen.delete(value);
  }

  visit(root, "$input", 0);
}

function exactKeys(value, keys, path) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be a plain object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${path} must contain exactly: ${expected.join(", ")}`);
  }
}

function text(value, path, { min = 1, max = BOUNDS.max_text_code_points } = {}) {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || Array.from(value).length < min
    || Array.from(value).length > max
    || UNSAFE_TEXT_RE.test(value)
    || hasUnpairedSurrogate(value)
  ) {
    throw new TypeError(`${path} must be ${min}-${max} trimmed, safe Unicode code points`);
  }
  return value;
}

function identifier(value, path) {
  text(value, path, { max: 128 });
  if (!ID_RE.test(value)) throw new TypeError(`${path} must be a simple lowercase identifier`);
  return value;
}

function digest(value, path) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    throw new TypeError(`${path} must be sha256:<64 lowercase hex characters>`);
  }
  return value;
}

function nullableDigest(value, path) {
  return value === null ? null : digest(value, path);
}

function timestamp(value, path) {
  text(value, path, { max: 40 });
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError(`${path} must be a real canonical UTC timestamp with milliseconds`);
  }
  return value;
}

function nullableTimestamp(value, path) {
  return value === null ? null : timestamp(value, path);
}

function httpsUrl(value, path) {
  text(value, path, { max: 2_000 });
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${path} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new TypeError(`${path} must be a credential-free HTTPS URL`);
  }
  return value;
}

function nullableHttpsUrl(value, path) {
  return value === null ? null : httpsUrl(value, path);
}

function oneOf(value, allowed, path) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new TypeError(`${path} must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function integer(value, path, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${path} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function stringList(value, path, { min = 0, max = BOUNDS.max_list_items } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${path} must contain ${min}-${max} strings`);
  }
  return value.map((item, index) => text(item, `${path}[${index}]`, { max: 1_000 }));
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const members = [];
    for (let index = 0; index < value.length; index += 1) {
      members.push(canonicalJson(value[index]));
    }
    return `[${members.join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

export function stableJson(value) {
  assertPlainJson(value);
  return canonicalJson(value);
}

function assertSignal(signal, path) {
  exactKeys(signal, SIGNAL_KEYS, path);
  if (signal.schema !== "rhetorlint.signal/0.1") {
    throw new TypeError(`${path}.schema must be rhetorlint.signal/0.1`);
  }
  digest(signal.signal_sha256, `${path}.signal_sha256`);
  text(signal.language, `${path}.language`, { max: 35 });
  if (!LANGUAGE_RE.test(signal.language)) throw new TypeError(`${path}.language must be a language tag`);
  oneOf(signal.status, SIGNAL_STATUSES, `${path}.status`);
  integer(signal.total_marks, `${path}.total_marks`, 0, 100_000);
}

function assertSource(source, path) {
  exactKeys(source, SOURCE_KEYS, path);
  oneOf(source.kind, new Set(["owner-supplied", "claim-feedback-packet"]), `${path}.kind`);
  identifier(source.namespace, `${path}.namespace`);
  httpsUrl(source.locator, `${path}.locator`);
  nullableDigest(source.packet_sha256, `${path}.packet_sha256`);
  nullableDigest(source.packet_input_sha256, `${path}.packet_input_sha256`);
  nullableDigest(source.claim_sha256, `${path}.claim_sha256`);
  if (source.correction_state !== null) {
    oneOf(
      source.correction_state,
      new Set(["challenge-open", "response-recorded", "boundary-recorded", "correction-recorded"]),
      `${path}.correction_state`,
    );
  }
  if (source.withdrawal_state !== null) {
    oneOf(
      source.withdrawal_state,
      new Set(["not-recorded", "withdrawal-recorded", "withdrawal-scheduled"]),
      `${path}.withdrawal_state`,
    );
  }
  exactKeys(source.discovery, DISCOVERY_KEYS, `${path}.discovery`);
  if (typeof source.discovery.publicly_visible !== "boolean") {
    throw new TypeError(`${path}.discovery.publicly_visible must be boolean`);
  }
  if (typeof source.discovery.robots_allowed !== "boolean") {
    throw new TypeError(`${path}.discovery.robots_allowed must be boolean`);
  }

  if (source.kind === "claim-feedback-packet") {
    if (
      source.packet_sha256 === null
      || source.packet_input_sha256 === null
      || source.claim_sha256 === null
      || source.correction_state === null
      || source.withdrawal_state === null
      || source.rhetorlint_signal === null
    ) {
      throw new TypeError(`${path} Claim Feedback references require all digest and state fields`);
    }
    assertSignal(source.rhetorlint_signal, `${path}.rhetorlint_signal`);
  } else if (
    source.packet_sha256 !== null
    || source.packet_input_sha256 !== null
    || source.claim_sha256 !== null
    || source.correction_state !== null
    || source.withdrawal_state !== null
    || source.rhetorlint_signal !== null
  ) {
    throw new TypeError(`${path} owner-supplied sources must leave Claim Feedback fields null`);
  }
}

function assertEvent(event, path) {
  exactKeys(event, EVENT_KEYS, path);
  if (event.schema !== SCHEMAS.event) throw new TypeError(`${path}.schema must be ${SCHEMAS.event}`);
  identifier(event.event_id, `${path}.event_id`);
  timestamp(event.recorded_at, `${path}.recorded_at`);
  oneOf(event.kind, EVENT_KINDS, `${path}.kind`);
  oneOf(event.scope, new Set(["event", "source", "use-declaration"]), `${path}.scope`);
  identifier(event.scope_ref, `${path}.scope_ref`);
  exactKeys(event.content, CONTENT_KEYS, `${path}.content`);
  text(event.content.text, `${path}.content.text`);
  text(event.content.language, `${path}.content.language`, { max: 35 });
  if (!LANGUAGE_RE.test(event.content.language)) {
    throw new TypeError(`${path}.content.language must be a language tag`);
  }
  digest(event.content.sha256, `${path}.content.sha256`);
  if (sha256(event.content.text) !== event.content.sha256) {
    throw new TypeError(`${path}.content.sha256 does not match the supplied text`);
  }
  assertSource(event.source, `${path}.source`);
  exactKeys(event.speaker_claim, SPEAKER_KEYS, `${path}.speaker_claim`);
  text(event.speaker_claim.label, `${path}.speaker_claim.label`, { max: 255 });
  oneOf(event.speaker_claim.attribution_basis, ATTRIBUTION_BASES, `${path}.speaker_claim.attribution_basis`);
  if (event.speaker_claim.authenticated !== false) {
    throw new TypeError(`${path}.speaker_claim.authenticated must remain false`);
  }
  oneOf(event.lane, LANE_SET, `${path}.lane`);
  oneOf(event.visibility, new Set(["room", "withheld"]), `${path}.visibility`);
  if (typeof event.reply_invited !== "boolean") {
    throw new TypeError(`${path}.reply_invited must be boolean`);
  }
  stringList(event.known_limits, `${path}.known_limits`, { min: 1 });

  if (event.kind === "offer") {
    if (event.scope !== "event" || event.scope_ref !== event.event_id) {
      throw new TypeError(`${path} offer must scope itself by event_id`);
    }
    if (event.lane !== "share" && event.lane !== "question") {
      throw new TypeError(`${path} offer lane must be share or question`);
    }
  } else if (event.kind === "leave") {
    if (event.scope !== "source" || event.scope_ref !== event.source.namespace || event.lane !== "quiet") {
      throw new TypeError(`${path} leave must use its own source scope and quiet lane`);
    }
  } else {
    if (event.kind !== "withdrawal" && event.scope !== "event") {
      throw new TypeError(`${path} ${event.kind} must target one event`);
    }
    if (event.kind === "withdrawal" && event.scope === "source") {
      throw new TypeError(`${path} withdrawal must target an event or use declaration`);
    }
    if (event.kind === "correction" && event.lane !== "correction") {
      throw new TypeError(`${path} correction must use the correction lane`);
    }
    if ((event.kind === "reply" || event.kind === "refusal") && event.lane !== "reply") {
      throw new TypeError(`${path} ${event.kind} must use the reply lane`);
    }
    if ((event.kind === "rest" || event.kind === "withdrawal") && event.lane !== "quiet") {
      throw new TypeError(`${path} ${event.kind} must use the quiet lane`);
    }
  }
  if (event.lane === "quiet" && event.reply_invited) {
    throw new TypeError(`${path} quiet control events cannot invite a reply`);
  }
}

function assertMaterialReview(review, path) {
  exactKeys(review, MATERIAL_KEYS, path);
  oneOf(review.status, new Set(["not-reviewed", "declared-clear", "held"]), `${path}.status`);
  nullableTimestamp(review.reviewed_at, `${path}.reviewed_at`);
  text(review.recorder, `${path}.recorder`, { max: 255 });
  for (const key of [
    "contains_personal_data", "contains_sensitive_data", "contains_third_party_material",
  ]) {
    if (typeof review[key] !== "boolean") throw new TypeError(`${path}.${key} must be boolean`);
  }
  stringList(review.known_limits, `${path}.known_limits`, { min: 1 });
  if (review.status === "not-reviewed" && review.reviewed_at !== null) {
    throw new TypeError(`${path}.reviewed_at must be null when not reviewed`);
  }
  if (review.status !== "not-reviewed" && review.reviewed_at === null) {
    throw new TypeError(`${path}.reviewed_at is required for a supplied review`);
  }
}

function assertDeclaration(declaration, path) {
  exactKeys(declaration, DECLARATION_KEYS, path);
  if (declaration.schema !== SCHEMAS.use_declaration) {
    throw new TypeError(`${path}.schema must be ${SCHEMAS.use_declaration}`);
  }
  identifier(declaration.declaration_id, `${path}.declaration_id`);
  timestamp(declaration.declared_at, `${path}.declared_at`);
  identifier(declaration.target_event_id, `${path}.target_event_id`);
  digest(declaration.target_sha256, `${path}.target_sha256`);
  for (const key of ["search", "retrieval", "model_input", "training", "mirror"]) {
    oneOf(declaration[key], USE_CHOICES, `${path}.${key}`);
  }
  nullableHttpsUrl(declaration.license_url, `${path}.license_url`);
  nullableHttpsUrl(declaration.rights_source, `${path}.rights_source`);
  nullableHttpsUrl(declaration.withdrawal_url, `${path}.withdrawal_url`);
  assertMaterialReview(declaration.material_review, `${path}.material_review`);
  stringList(declaration.known_limits, `${path}.known_limits`, { min: 1 });
}

function assertInput(input) {
  assertPlainJson(input);
  exactKeys(input, INPUT_KEYS, "$input");
  if (input.schema !== SCHEMAS.input) throw new TypeError(`$input.schema must be ${SCHEMAS.input}`);
  timestamp(input.prepared_at, "$input.prepared_at");
  integer(input.cursor, "$input.cursor", 0, BOUNDS.max_cursor);
  integer(input.view_limit, "$input.view_limit", 1, BOUNDS.max_view);
  if (!Array.isArray(input.events) || input.events.length > BOUNDS.max_events) {
    throw new TypeError(`$input.events must contain 0-${BOUNDS.max_events} events`);
  }
  if (!Array.isArray(input.use_declarations) || input.use_declarations.length > BOUNDS.max_use_declarations) {
    throw new TypeError(`$input.use_declarations must contain 0-${BOUNDS.max_use_declarations} declarations`);
  }

  input.events.forEach((event, index) => assertEvent(event, `$input.events[${index}]`));
  input.use_declarations.forEach((item, index) => assertDeclaration(item, `$input.use_declarations[${index}]`));
  const eventsById = new Map();
  for (const event of input.events) {
    if (eventsById.has(event.event_id)) throw new TypeError(`duplicate event_id: ${event.event_id}`);
    eventsById.set(event.event_id, event);
    if (event.recorded_at > input.prepared_at) {
      throw new TypeError(`${event.event_id} occurs after prepared_at`);
    }
  }
  const declarationIds = new Set();
  const declarationsById = new Map();
  for (const declaration of input.use_declarations) {
    if (declarationIds.has(declaration.declaration_id)) {
      throw new TypeError(`duplicate declaration_id: ${declaration.declaration_id}`);
    }
    declarationIds.add(declaration.declaration_id);
    declarationsById.set(declaration.declaration_id, declaration);
    const target = eventsById.get(declaration.target_event_id);
    if (!target) throw new TypeError(`${declaration.declaration_id} targets a missing event`);
    if (declaration.target_sha256 !== target.content.sha256) {
      throw new TypeError(`${declaration.declaration_id}.target_sha256 does not match its event`);
    }
    if (declaration.declared_at < target.recorded_at || declaration.declared_at > input.prepared_at) {
      throw new TypeError(`${declaration.declaration_id}.declared_at is outside the event/preparation interval`);
    }
    if (
      declaration.material_review.reviewed_at !== null
      && declaration.material_review.reviewed_at > declaration.declared_at
    ) {
      throw new TypeError(`${declaration.declaration_id} material review occurs after its declaration`);
    }
  }
  for (const event of input.events) {
    if (event.kind === "offer" || event.kind === "leave") continue;
    if (event.kind === "withdrawal" && event.scope === "use-declaration") {
      const declaration = declarationsById.get(event.scope_ref);
      if (!declaration) {
        throw new TypeError(`${event.event_id} targets missing use declaration ${event.scope_ref}`);
      }
      if (declaration.declared_at > event.recorded_at) {
        throw new TypeError(`${event.event_id} must target an earlier use declaration`);
      }
      const declarationTarget = eventsById.get(declaration.target_event_id);
      if (declarationTarget.source.namespace !== event.source.namespace) {
        throw new TypeError(`${event.event_id} can withdraw only its own source declaration`);
      }
      continue;
    }
    const target = eventsById.get(event.scope_ref);
    if (!target) throw new TypeError(`${event.event_id} targets missing event ${event.scope_ref}`);
    const targetOrder = `${target.recorded_at}\u0000${target.event_id}`;
    const eventOrder = `${event.recorded_at}\u0000${event.event_id}`;
    if (target.event_id === event.event_id || targetOrder >= eventOrder) {
      throw new TypeError(`${event.event_id} must target an earlier event in canonical order`);
    }
    if ((event.kind === "correction" || event.kind === "rest" || event.kind === "withdrawal")
      && target.source.namespace !== event.source.namespace) {
      throw new TypeError(`${event.event_id} can ${event.kind} only its own source event`);
    }
  }
  return input;
}

export function validateAgentRoomInput(input) {
  try {
    assertInput(input);
    return [];
  } catch (error) {
    return [{ code: "invalid-input", message: error.message }];
  }
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function chronological(events) {
  return [...events].sort((left, right) => (
    compareCodeUnits(left.recorded_at, right.recorded_at)
    || compareCodeUnits(left.event_id, right.event_id)
  ));
}

function deriveState(events) {
  const superseded = new Map();
  const rested = new Map();
  const withdrawn = new Map();
  const withdrawnDeclarations = new Map();
  const leftAt = new Map();
  const boundaries = [];
  for (const event of chronological(events)) {
    if (event.kind === "correction") superseded.set(event.scope_ref, event.event_id);
    if (event.kind === "rest") {
      rested.set(event.scope_ref, event.event_id);
      boundaries.push({ kind: "rest", event_id: event.event_id, scope_ref: event.scope_ref });
    }
    if (event.kind === "withdrawal") {
      if (event.scope === "use-declaration") withdrawnDeclarations.set(event.scope_ref, event.event_id);
      else withdrawn.set(event.scope_ref, event.event_id);
      boundaries.push({ kind: "withdrawal", event_id: event.event_id, scope_ref: event.scope_ref });
    }
    if (event.kind === "leave") {
      if (!leftAt.has(event.source.namespace)) {
        leftAt.set(event.source.namespace, { recorded_at: event.recorded_at, event_id: event.event_id });
      }
      boundaries.push({ kind: "leave", event_id: event.event_id, scope_ref: event.source.namespace });
    }
  }
  return { superseded, rested, withdrawn, withdrawnDeclarations, leftAt, boundaries };
}

function holdReasons(event, state) {
  const reasons = [];
  if (event.kind === "rest" || event.kind === "leave" || event.kind === "withdrawal") {
    reasons.push("control-event-not-room-content");
  }
  if (event.visibility === "withheld") reasons.push("owner-supplied-visibility-hold");
  if (state.superseded.has(event.event_id)) reasons.push("superseded-by-correction");
  if (state.rested.has(event.event_id)) reasons.push("rest-requested");
  if (state.withdrawn.has(event.event_id)) reasons.push("withdrawal-recorded");
  if (event.source.withdrawal_state === "withdrawal-recorded") {
    reasons.push("claim-feedback-withdrawal-recorded");
  }
  const leave = state.leftAt.get(event.source.namespace);
  if (leave && (
    event.recorded_at > leave.recorded_at
    || (event.recorded_at === leave.recorded_at && event.event_id > leave.event_id)
  )) {
    reasons.push("source-left-before-this-event");
  }
  return reasons;
}

function projectEvent(event, state) {
  return {
    event_id: event.event_id,
    recorded_at: event.recorded_at,
    kind: event.kind,
    scope: event.scope,
    scope_ref: event.scope_ref,
    lane: event.lane,
    content: { ...event.content },
    source: {
      kind: event.source.kind,
      namespace: event.source.namespace,
      locator: event.source.locator,
      packet_sha256: event.source.packet_sha256,
      packet_input_sha256: event.source.packet_input_sha256,
      claim_sha256: event.source.claim_sha256,
      correction_state: event.source.correction_state,
      withdrawal_state: event.source.withdrawal_state,
      rhetorlint_signal: event.source.rhetorlint_signal === null
        ? null
        : { ...event.source.rhetorlint_signal },
      discovery: { ...event.source.discovery },
    },
    speaker_claim: { ...event.speaker_claim },
    reply_invited: event.reply_invited,
    no_reask: event.kind === "refusal",
    selection_reason: "next-in-declared-lane-with-source-cap",
    known_limits: [...event.known_limits],
  };
}

function selectView(events, state, cursor, limit) {
  const held = [];
  const eligible = [];
  for (const event of chronological(events)) {
    const reasons = holdReasons(event, state);
    if (reasons.length) held.push({ event_id: event.event_id, reasons });
    else eligible.push(event);
  }

  const queues = new Map(LANES.map((lane) => [lane, []]));
  for (const event of eligible) queues.get(event.lane).push(event);
  for (const lane of LANES) {
    queues.get(lane).sort((a, b) => compareCodeUnits(a.event_id, b.event_id));
  }
  const schedule = [];
  const longestLane = Math.max(0, ...LANES.map((lane) => queues.get(lane).length));
  for (let position = 0; position < longestLane; position += 1) {
    for (const lane of LANES) {
      const event = queues.get(lane)[position];
      if (event) schedule.push(event);
    }
  }
  const offset = schedule.length ? cursor % schedule.length : 0;
  const rotated = [...schedule.slice(offset), ...schedule.slice(0, offset)];
  const usedSources = new Set();
  const selected = [];
  for (const event of rotated) {
    if (selected.length >= limit) break;
    if (usedSources.has(event.source.namespace)) continue;
    usedSources.add(event.source.namespace);
    selected.push(event);
  }

  const selectedIds = new Set(selected.map((event) => event.event_id));
  const notSelected = eligible
    .filter((event) => !selectedIds.has(event.event_id))
    .map((event) => ({
      event_id: event.event_id,
      reason: usedSources.has(event.source.namespace) ? "source-cap" : "view-limit",
    }));

  return {
    selected: selected.map((event) => projectEvent(event, state)),
    not_selected: notSelected,
    held,
  };
}

function trainingReviews(input, eventsById, state) {
  return input.use_declarations.map((declaration) => {
    const event = eventsById.get(declaration.target_event_id);
    const reasons = [];
    let status = "held-for-independent-review";
    if (state.withdrawnDeclarations.has(declaration.declaration_id)) {
      status = "withdrawal-recorded";
      reasons.push("a same-namespace supplied withdrawal event targets this use declaration; authority is not authenticated");
    } else if (declaration.training === "not-offered") {
      status = "not-offered";
      reasons.push("training use was not offered");
    } else {
      if (declaration.retrieval === "not-offered") reasons.push("retrieval use was not separately offered");
      if (declaration.model_input === "not-offered") reasons.push("model-input use was not separately offered");
      if (declaration.license_url === null) reasons.push("no licence URL was supplied");
      if (declaration.rights_source === null) reasons.push("no rights source was supplied");
      if (declaration.material_review.status !== "declared-clear") {
        reasons.push("the supplied material review is not declared clear");
      }
      if (declaration.material_review.contains_personal_data) reasons.push("personal data was declared");
      if (declaration.material_review.contains_sensitive_data) reasons.push("sensitive data was declared");
      if (declaration.material_review.contains_third_party_material) {
        reasons.push("third-party material was declared");
      }
      if (state.superseded.has(event.event_id)) reasons.push("the target was superseded by a correction");
      if (state.withdrawn.has(event.event_id)) reasons.push("the target was withdrawn from later use");
      if (state.rested.has(event.event_id)) reasons.push("the target is resting; no new use should proceed");
      if (event.source.withdrawal_state === "withdrawal-recorded") {
        reasons.push("the Claim Feedback reference records withdrawal");
      }
      reasons.push("independent human rights, privacy, safety, licence, and provenance review is required");
    }
    return {
      schema: "agent-room.training-review/0.1",
      declaration_id: declaration.declaration_id,
      target_event_id: declaration.target_event_id,
      target_sha256: declaration.target_sha256,
      source_packet_sha256: event.source.packet_sha256,
      status,
      candidate: null,
      reasons,
      metadata: {
        declared_at: declaration.declared_at,
        license_url: declaration.license_url,
        rights_source: declaration.rights_source,
        withdrawal_url: declaration.withdrawal_url,
        material_review_status: declaration.material_review.status,
      },
      human_review_required: status === "held-for-independent-review",
      note: "Public visibility and robots observations are not later-use permission and were not used in this review.",
    };
  });
}

export function buildAgentRoom(input) {
  assertInput(input);
  const state = deriveState(input.events);
  const eventsById = new Map(input.events.map((event) => [event.event_id, event]));
  const view = selectView(input.events, state, input.cursor, input.view_limit);
  const inputSha256 = sha256(stableJson(input));
  const laneCounts = Object.fromEntries(LANES.map((lane) => [
    lane,
    input.events.filter((event) => event.lane === lane && holdReasons(event, state).length === 0).length,
  ]));
  const base = {
    schema: SCHEMAS.receipt,
    status: "local-projection-only",
    pipeline: {
      source: { input_events: input.events.length, network_requests: 0 },
      hydrate: {
        digest_bound_events: input.events.length,
        claim_feedback_references: input.events.filter((event) => event.source.kind === "claim-feedback-packet").length,
        authenticity_established: false,
      },
      filter: { held_events: view.held.length, eligible_events: input.events.length - view.held.length },
      lanes: laneCounts,
      select: {
        method: "cursor-round-robin-declared-lanes-one-source-per-view",
        cursor: input.cursor,
        next_cursor: input.cursor === BOUNDS.max_cursor ? 0 : input.cursor + 1,
        limit: input.view_limit,
        selected_events: view.selected.length,
      },
      side_effects: { status: "disabled", external_state_changes: 0 },
    },
    view: {
      cursor: input.cursor,
      next_cursor: input.cursor === BOUNDS.max_cursor ? 0 : input.cursor + 1,
      limit: input.view_limit,
      selected: view.selected,
      not_selected: view.not_selected,
      held: view.held,
      boundaries: state.boundaries,
      note: "Not selected means only not present in this finite view. It is not a rank, penalty, truth judgment, or statement of worth.",
    },
    training_reviews: trainingReviews(input, eventsById, state),
    boundaries: [
      "Quiet creates no event, debt, inference, follow-up, or training permission.",
      "A supplied packet digest is only a reference here because packet bytes are absent; it does not establish identity, authority, authenticity, truth, consent, or rights.",
      "RhetorLint reviews visible wording only. Its aggregate signal cannot filter, order, select, or authorise later use.",
      "Visibility, robots access, search, retrieval, model input, training, mirroring, publication, and KARMA are separate choices.",
      "No event or view scores a speaker, agent, person, personality, credibility, ego, intent, honesty, or worth.",
    ],
    effects: {
      crawler_requests: 0,
      network_requests: 0,
      messages_sent: 0,
      publications: 0,
      persistent_files_written: 0,
      training_runs: 0,
      training_records_written: 0,
      karma_records_written: 0,
      external_state_changes: 0,
      cli_stdout: "one local receipt when the CLI succeeds",
    },
    integrity: {
      canonicalization: "recursive lexicographic object keys; array order preserved; UTF-8 JSON without whitespace",
      input_sha256: inputSha256,
      digest_scope: "canonical JSON of the complete receipt with integrity.receipt_sha256 omitted",
    },
  };
  return {
    ...base,
    integrity: {
      ...base.integrity,
      receipt_sha256: sha256(stableJson(base)),
    },
  };
}

export function verifyAgentRoomReceipt(receipt, input) {
  const expected = buildAgentRoom(input);
  if (stableJson(receipt) !== stableJson(expected)) {
    throw new TypeError("receipt does not match the canonical Agent Room projection");
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
    descriptor = openSync(inputPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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

export const HELP = `Agent Room 0.1

Usage:
  node examples/agent-room/agent-room.mjs INPUT.json

Reads one bounded local manifest and prints one deterministic receipt. It does
not crawl, send, publish, train, write KARMA, write a dataset, or persist state.
Set AGENT_ROOM_HALT=1 to stop before the input file is opened.
`;

export function runCli(argv = process.argv.slice(2), runtime = {}) {
  const env = runtime.env ?? process.env;
  const stdout = runtime.stdout ?? process.stdout;
  const readInput = runtime.readInput ?? readInputFile;
  if (env.AGENT_ROOM_HALT === "1") {
    throw new Error("stopped by AGENT_ROOM_HALT=1 before input read");
  }
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    stdout.write(HELP);
    return 0;
  }
  if (argv.length !== 1 || argv[0].startsWith("-")) {
    throw new TypeError("expected exactly one INPUT.json path; use --help");
  }
  const input = readInput(resolve(argv[0]));
  stdout.write(`${JSON.stringify(buildAgentRoom(input), null, 2)}\n`);
  return 0;
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (directPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`agent-room: ${error.message}\n`);
    process.exitCode = 1;
  }
}
