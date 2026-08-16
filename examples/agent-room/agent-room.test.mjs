import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertSupported, validate } from "../../test/helpers/schema-validator.mjs";
import {
  BOUNDS,
  SCHEMAS,
  buildAgentRoom,
  runCli,
  sha256,
  stableJson,
  validateAgentRoomInput,
  verifyAgentRoomReceipt,
} from "./agent-room.mjs";

const FIXTURE_URL = new URL("./fixtures/room.json", import.meta.url);
const MODULE_URL = new URL("./agent-room.mjs", import.meta.url);
const README_URL = new URL("./README.md", import.meta.url);
const INPUT_SCHEMA = JSON.parse(
  readFileSync(new URL("./agent-room-input.schema.json", import.meta.url), "utf8"),
);
const RECEIPT_SCHEMA = JSON.parse(
  readFileSync(new URL("./agent-room-receipt.schema.json", import.meta.url), "utf8"),
);
const FIXTURE = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
const MODULE_SOURCE = readFileSync(MODULE_URL, "utf8");
const README = readFileSync(README_URL, "utf8");
const clone = (value) => JSON.parse(JSON.stringify(value));

function ownerEvent({
  id,
  second,
  namespace = id,
  kind = "offer",
  lane = "share",
  scope = "event",
  scopeRef = id,
  visibility = "room",
}) {
  const content = `Local words for ${id}.`;
  return {
    schema: SCHEMAS.event,
    event_id: id,
    recorded_at: `2026-08-17T01:00:${String(second).padStart(2, "0")}.000Z`,
    kind,
    scope,
    scope_ref: scopeRef,
    content: { text: content, language: "en", sha256: sha256(content) },
    source: {
      kind: "owner-supplied",
      namespace,
      locator: `https://example.org/room/${id}`,
      packet_sha256: null,
      packet_input_sha256: null,
      claim_sha256: null,
      correction_state: null,
      withdrawal_state: null,
      rhetorlint_signal: null,
      discovery: { publicly_visible: false, robots_allowed: false },
    },
    speaker_claim: { label: namespace, attribution_basis: "self", authenticated: false },
    lane,
    visibility,
    reply_invited: false,
    known_limits: ["Synthetic local test event."],
  };
}

function bareInput(events, { cursor = 0, viewLimit = 12, declarations = [] } = {}) {
  return {
    schema: SCHEMAS.input,
    prepared_at: "2026-08-17T01:02:00.000Z",
    cursor,
    view_limit: viewLimit,
    events,
    use_declarations: declarations,
  };
}

test("closed schemas cover the fixture, receipt, and JSON wire form", () => {
  assert.doesNotThrow(() => assertSupported(INPUT_SCHEMA));
  assert.doesNotThrow(() => assertSupported(RECEIPT_SCHEMA));
  assert.deepEqual(validate(FIXTURE, INPUT_SCHEMA), []);
  assert.deepEqual(validateAgentRoomInput(FIXTURE), []);
  const receipt = buildAgentRoom(FIXTURE);
  assert.deepEqual(validate(receipt, RECEIPT_SCHEMA), []);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(receipt)), RECEIPT_SCHEMA), []);
  assert.equal(receipt.schema, SCHEMAS.receipt);
  assert.equal(receipt.status, "local-projection-only");
});

test("integrity binds the complete input and receipt", () => {
  const receipt = buildAgentRoom(FIXTURE);
  assert.equal(receipt.integrity.input_sha256, sha256(stableJson(FIXTURE)));
  const withoutOwnDigest = clone(receipt);
  delete withoutOwnDigest.integrity.receipt_sha256;
  assert.equal(receipt.integrity.receipt_sha256, sha256(stableJson(withoutOwnDigest)));
  assert.equal(verifyAgentRoomReceipt(receipt, FIXTURE), true);

  const altered = clone(receipt);
  altered.view.note = "Different words.";
  assert.throws(() => verifyAgentRoomReceipt(altered, FIXTURE), /canonical Agent Room/);
});

test("shape is closed against scores, engagement, identity inference, and phrase marks", () => {
  for (const key of [
    "score", "rank", "likes", "followers", "engagement", "ego", "truth", "person_score",
  ]) {
    const input = clone(FIXTURE);
    input.events[0][key] = 1;
    assert.notDeepEqual(validate(input, INPUT_SCHEMA), [], `schema rejects ${key}`);
    assert.match(validateAgentRoomInput(input)[0].message, /contain exactly/);
  }

  const phraseLeak = clone(FIXTURE);
  phraseLeak.events[0].source.rhetorlint_signal.marks = [{ start: 0, end: 1 }];
  assert.match(validate(phraseLeak, INPUT_SCHEMA).join("\n"), /marks/);
  assert.match(validateAgentRoomInput(phraseLeak)[0].message, /contain exactly/);

  const inferredChoice = clone(FIXTURE);
  inferredChoice.events.find((item) => item.kind === "leave").speaker_claim.attribution_basis = "inference";
  assert.match(validate(inferredChoice, INPUT_SCHEMA).join("\n"), /permitted set/);
  assert.match(validateAgentRoomInput(inferredChoice)[0].message, /self, direct-report/);

  const receiptScore = buildAgentRoom(FIXTURE);
  receiptScore.view.selected[0].score = 0;
  assert.match(validate(receiptScore, RECEIPT_SCHEMA).join("\n"), /score/);
});

test("real dates, Unicode, proxies, accessors, sparse arrays, and array overrides fail safely", () => {
  const badDate = clone(FIXTURE);
  badDate.prepared_at = "2026-02-30T00:20:00.000Z";
  assert.match(validateAgentRoomInput(badDate)[0].message, /real canonical UTC/);

  const emoji = clone(FIXTURE);
  emoji.events[0].content.text = "😀".repeat(BOUNDS.max_text_code_points);
  emoji.events[0].content.sha256 = sha256(emoji.events[0].content.text);
  emoji.use_declarations.find(
    (item) => item.target_event_id === emoji.events[0].event_id,
  ).target_sha256 = emoji.events[0].content.sha256;
  assert.deepEqual(validate(emoji, INPUT_SCHEMA), []);
  assert.deepEqual(validateAgentRoomInput(emoji), []);
  assert.deepEqual(validate(buildAgentRoom(emoji), RECEIPT_SCHEMA), []);
  emoji.events[0].content.text += "😀";
  emoji.events[0].content.sha256 = sha256(emoji.events[0].content.text);
  emoji.use_declarations.find(
    (item) => item.target_event_id === emoji.events[0].event_id,
  ).target_sha256 = emoji.events[0].content.sha256;
  assert.match(validateAgentRoomInput(emoji)[0].message, /1-4000/);

  const surrogate = clone(FIXTURE);
  surrogate.events[0].content.text = "bad\ud800";
  surrogate.events[0].content.sha256 = sha256(surrogate.events[0].content.text);
  assert.match(validateAgentRoomInput(surrogate)[0].message, /safe Unicode/);

  const proxied = clone(FIXTURE);
  proxied.events[0] = new Proxy(proxied.events[0], {});
  assert.match(validateAgentRoomInput(proxied)[0].message, /Proxy/);

  const accessed = clone(FIXTURE);
  let getterTouches = 0;
  Object.defineProperty(accessed.events[0], "kind", {
    enumerable: true,
    get() {
      getterTouches += 1;
      return "offer";
    },
  });
  assert.match(validateAgentRoomInput(accessed)[0].message, /enumerable data property/);
  assert.equal(getterTouches, 0);

  const sparse = clone(FIXTURE);
  delete sparse.events[0];
  assert.match(validateAgentRoomInput(sparse)[0].message, /sparse/);

  const overridden = clone(FIXTURE);
  let mapTouches = 0;
  Object.defineProperty(overridden.events, "map", {
    enumerable: true,
    value() {
      mapTouches += 1;
      return [];
    },
  });
  assert.match(validateAgentRoomInput(overridden)[0].message, /extra array properties/);
  assert.equal(mapTouches, 0);

  const inheritedOverride = clone(FIXTURE);
  inheritedOverride.events[0].person_score = 99;
  let inheritedTouches = 0;
  const hostileArrayPrototype = Object.create(Array.prototype);
  hostileArrayPrototype.forEach = () => { inheritedTouches += 1; };
  Object.setPrototypeOf(inheritedOverride.events, hostileArrayPrototype);
  assert.match(validateAgentRoomInput(inheritedOverride)[0].message, /ordinary Array prototype/);
  assert.equal(inheritedTouches, 0);

  const receipt = buildAgentRoom(FIXTURE);
  let receiptGetterTouches = 0;
  Object.defineProperty(receipt, "view", {
    enumerable: true,
    get() {
      receiptGetterTouches += 1;
      return {};
    },
  });
  assert.throws(() => verifyAgentRoomReceipt(receipt, FIXTURE), /enumerable data property/);
  assert.equal(receiptGetterTouches, 0);
});

test("packet references bind supplied digests without claiming authenticity", () => {
  const missing = clone(FIXTURE);
  missing.events[0].source.packet_input_sha256 = null;
  assert.match(validateAgentRoomInput(missing)[0].message, /require all digest/);

  const ownerPretends = clone(FIXTURE);
  ownerPretends.events[1].source.packet_sha256 = FIXTURE.events[0].source.packet_sha256;
  assert.match(validateAgentRoomInput(ownerPretends)[0].message, /leave Claim Feedback fields null/);

  const receipt = buildAgentRoom(FIXTURE);
  assert.equal(receipt.pipeline.hydrate.authenticity_established, false);
  assert.match(receipt.boundaries.join("\n"), /does not establish.*authenticity/i);
});

test("RhetorLint density, robots access, and public visibility cannot change the room view", () => {
  const baseline = buildAgentRoom(FIXTURE);
  const changed = clone(FIXTURE);
  for (const event of changed.events) {
    if (event.source.rhetorlint_signal !== null) {
      event.source.rhetorlint_signal.total_marks = 99999;
      event.source.rhetorlint_signal.status = "patterns-marked";
      event.source.rhetorlint_signal.signal_sha256 = sha256(`changed-${event.event_id}`);
    }
    event.source.discovery.publicly_visible = !event.source.discovery.publicly_visible;
    event.source.discovery.robots_allowed = !event.source.discovery.robots_allowed;
  }
  const projected = buildAgentRoom(changed);
  assert.deepEqual(
    projected.view.selected.map((item) => item.event_id),
    baseline.view.selected.map((item) => item.event_id),
  );
  assert.deepEqual(projected.view.held, baseline.view.held);
  assert.deepEqual(
    projected.training_reviews.map((item) => [item.declaration_id, item.status, item.reasons]),
    baseline.training_reviews.map((item) => [item.declaration_id, item.status, item.reasons]),
  );
});

test("input order cannot change hydration, holds, or deterministic selection", () => {
  const baseline = buildAgentRoom(FIXTURE);
  const reordered = clone(FIXTURE);
  reordered.events.reverse();
  reordered.use_declarations.reverse();
  const projected = buildAgentRoom(reordered);
  assert.deepEqual(projected.view, baseline.view);
  assert.deepEqual(
    projected.training_reviews
      .map((item) => [item.declaration_id, item.status, item.reasons])
      .sort(),
    baseline.training_reviews
      .map((item) => [item.declaration_id, item.status, item.reasons])
      .sort(),
  );
  assert.notEqual(projected.integrity.input_sha256, baseline.integrity.input_sha256);
});

test("the cursor gives eventual coverage without locale-dependent sorting", () => {
  const events = [
    ownerEvent({ id: "aa-share", second: 0, lane: "share" }),
    ownerEvent({ id: "z-share", second: 1, lane: "share" }),
    ownerEvent({ id: "aa-question", second: 2, lane: "question" }),
    ownerEvent({ id: "z-question", second: 3, lane: "question" }),
    ownerEvent({ id: "reply-target-a", second: 4, visibility: "withheld" }),
    ownerEvent({ id: "reply-target-z", second: 5, visibility: "withheld" }),
    ownerEvent({
      id: "aa-reply", second: 6, kind: "reply", lane: "reply", scopeRef: "reply-target-a",
    }),
    ownerEvent({
      id: "z-reply", second: 7, kind: "reply", lane: "reply", scopeRef: "reply-target-z",
    }),
    ownerEvent({ id: "correction-target-a", second: 8, namespace: "aa-correction", visibility: "withheld" }),
    ownerEvent({ id: "correction-target-z", second: 9, namespace: "z-correction", visibility: "withheld" }),
    ownerEvent({
      id: "aa-correction",
      second: 10,
      namespace: "aa-correction",
      kind: "correction",
      lane: "correction",
      scopeRef: "correction-target-a",
    }),
    ownerEvent({
      id: "z-correction",
      second: 11,
      namespace: "z-correction",
      kind: "correction",
      lane: "correction",
      scopeRef: "correction-target-z",
    }),
  ];
  const expected = new Set([
    "aa-share", "z-share", "aa-question", "z-question",
    "aa-reply", "z-reply", "aa-correction", "z-correction",
  ]);
  const seen = new Set();
  for (let cursor = 0; cursor < expected.size; cursor += 1) {
    const receipt = buildAgentRoom(bareInput(events, { cursor, viewLimit: 1 }));
    assert.equal(receipt.view.selected.length, 1);
    seen.add(receipt.view.selected[0].event_id);
  }
  assert.deepEqual(seen, expected);
  assert.equal(buildAgentRoom(bareInput(events, { viewLimit: 1 })).view.selected[0].event_id, "aa-share");
});

test("one source cannot fill a finite view and empty seats are acceptable", () => {
  const events = [
    ownerEvent({ id: "cedar-a", second: 0, namespace: "cedar" }),
    ownerEvent({ id: "cedar-b", second: 1, namespace: "cedar" }),
    ownerEvent({ id: "cedar-c", second: 2, namespace: "cedar" }),
    ownerEvent({ id: "river-a", second: 3, namespace: "river" }),
  ];
  const receipt = buildAgentRoom(bareInput(events, { viewLimit: 4 }));
  assert.equal(receipt.view.selected.length, 2);
  assert.equal(new Set(receipt.view.selected.map((item) => item.source.namespace)).size, 2);
  assert.equal(receipt.view.not_selected.filter((item) => item.reason === "source-cap").length, 2);
  const cedarSeen = new Set();
  for (let cursor = 0; cursor < 4; cursor += 1) {
    const view = buildAgentRoom(bareInput(events, { cursor, viewLimit: 4 })).view;
    for (const item of view.selected) if (item.source.namespace === "cedar") cedarSeen.add(item.event_id);
  }
  assert.deepEqual(cedarSeen, new Set(["cedar-a", "cedar-b", "cedar-c"]));
});

test("correction, refusal, rest, leave, and withdrawal preserve their narrow meanings", () => {
  const receipt = buildAgentRoom(FIXTURE);
  assert.deepEqual(receipt.view.selected.map((item) => item.event_id), [
    "river-question", "moss-refusal", "cedar-correction",
  ]);
  assert.equal(receipt.view.selected.find((item) => item.event_id === "river-question").no_reask, false);
  const refusal = receipt.view.selected.find((item) => item.event_id === "moss-refusal");
  assert.equal(refusal.no_reask, true);
  assert.equal(refusal.scope, "event");
  assert.equal(refusal.scope_ref, "river-question");
  const holds = new Map(receipt.view.held.map((item) => [item.event_id, item.reasons]));
  assert.deepEqual(holds.get("cedar-offer"), ["superseded-by-correction"]);
  assert.deepEqual(holds.get("cedar-reply"), ["rest-requested"]);
  assert.deepEqual(holds.get("ash-offer"), ["withdrawal-recorded"]);
  assert.deepEqual(holds.get("river-late-offer"), ["source-left-before-this-event"]);
  assert.deepEqual(receipt.view.boundaries.map((item) => item.kind), [
    "withdrawal", "rest", "leave", "withdrawal",
  ]);
  assert.match(receipt.view.note, /not a rank, penalty, truth judgment, or statement of worth/);
});

test("one source cannot correct, rest, withdraw, or withdraw a declaration for another", () => {
  for (const eventId of ["cedar-correction", "cedar-rest", "ash-withdrawal"] ) {
    const input = clone(FIXTURE);
    const event = input.events.find((item) => item.event_id === eventId);
    event.source.namespace = "agent-stranger";
    assert.match(validateAgentRoomInput(input)[0].message, /only its own source event/);
  }
  const declarationWithdrawal = clone(FIXTURE);
  declarationWithdrawal.events.find(
    (item) => item.event_id === "cedar-use-withdrawal",
  ).source.namespace = "agent-stranger";
  assert.match(
    validateAgentRoomInput(declarationWithdrawal)[0].message,
    /only its own source declaration/,
  );
});

test("the earliest leave remains the boundary and same-time references use canonical order", () => {
  const first = ownerEvent({
    id: "leave-first", second: 1, namespace: "cedar", kind: "leave", lane: "quiet",
    scope: "source", scopeRef: "cedar",
  });
  const middle = ownerEvent({ id: "middle-offer", second: 2, namespace: "cedar" });
  const second = ownerEvent({
    id: "leave-second", second: 3, namespace: "cedar", kind: "leave", lane: "quiet",
    scope: "source", scopeRef: "cedar",
  });
  const receipt = buildAgentRoom(bareInput([first, middle, second]));
  assert.deepEqual(
    receipt.view.held.find((item) => item.event_id === "middle-offer").reasons,
    ["source-left-before-this-event"],
  );

  const target = ownerEvent({ id: "z-target", second: 5 });
  const reply = ownerEvent({
    id: "a-reply", second: 5, kind: "reply", lane: "reply", scopeRef: "z-target",
  });
  assert.match(validateAgentRoomInput(bareInput([target, reply]))[0].message, /canonical order/);
});

test("training stays separate, metadata-only, held, revocable, and never inferred from access", () => {
  const receipt = buildAgentRoom(FIXTURE);
  assert.deepEqual(receipt.training_reviews.map((item) => [item.declaration_id, item.status]), [
    ["cedar-original-use", "held-for-independent-review"],
    ["ash-use", "held-for-independent-review"],
    ["cedar-correction-use", "withdrawal-recorded"],
    ["moss-no-use", "not-offered"],
  ]);
  assert.match(receipt.training_reviews[0].reasons.join("\n"), /superseded by a correction/);
  assert.match(receipt.training_reviews[1].reasons.join("\n"), /withdrawn from later use/);
  assert.equal(receipt.training_reviews[2].candidate, null);
  assert.equal(receipt.training_reviews[3].human_review_required, false);
  for (const review of receipt.training_reviews) {
    assert.equal(review.candidate, null);
    assert.equal(Object.hasOwn(review, "content"), false);
    assert.equal(Object.hasOwn(review, "score"), false);
    assert.match(review.note, /robots observations are not later-use permission/);
  }
});

test("quiet means no event and no inferred state", () => {
  const receipt = buildAgentRoom(bareInput([], { viewLimit: 1 }));
  assert.deepEqual(receipt.view.selected, []);
  assert.deepEqual(receipt.view.not_selected, []);
  assert.deepEqual(receipt.view.held, []);
  assert.deepEqual(receipt.view.boundaries, []);
  assert.deepEqual(receipt.training_reviews, []);
  assert.match(receipt.boundaries[0], /Quiet creates no event/);
});

test("every capability effect is zero and the implementation imports no effect capability", () => {
  const receipt = buildAgentRoom(FIXTURE);
  for (const [key, value] of Object.entries(receipt.effects)) {
    if (key === "cli_stdout") continue;
    assert.equal(value, 0, key);
  }
  assert.equal(receipt.pipeline.side_effects.status, "disabled");
  assert.equal(receipt.pipeline.side_effects.external_state_changes, 0);
  assert.doesNotMatch(
    MODULE_SOURCE,
    /from\s+["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process|worker_threads)["']/,
  );
  assert.doesNotMatch(MODULE_SOURCE, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
  assert.doesNotMatch(MODULE_SOURCE, /\b(?:writeFile|appendFile|createWriteStream|spawn|exec)\w*\s*\(/);
});

test("the halt switch wins before the input reader", () => {
  let reads = 0;
  assert.throws(
    () => runCli(["fixture.json"], {
      env: { AGENT_ROOM_HALT: "1" },
      readInput() {
        reads += 1;
        return FIXTURE;
      },
      stdout: { write() {} },
    }),
    /before input read/,
  );
  assert.equal(reads, 0);
});

test("the CLI prints one receipt and the documentation pins inspiration without overstating it", () => {
  let output = "";
  assert.equal(runCli(["fixture.json"], {
    env: {},
    readInput() {
      return FIXTURE;
    },
    stdout: { write(value) { output += value; } },
  }), 0);
  const receipt = JSON.parse(output);
  assert.deepEqual(validate(receipt, RECEIPT_SCHEMA), []);
  assert.match(README, /c65aa179db7bdd61e2c2821eac87f208a105c053/);
  assert.match(README, /substantially transparent, but it is not a\s+complete description/);
  assert.match(README, /copies no X source code/);
  assert.match(README, /Silence creates no event/);
});
