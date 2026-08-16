import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { assertSupported, validate } from "../../test/helpers/schema-validator.mjs";
import {
  BOUNDS,
  SCHEMAS,
  buildClaimFeedback,
  runCli,
  sha256,
  stableJson,
  validateClaimFeedbackInput,
  verifyClaimFeedbackPacket,
} from "./claim-feedback.mjs";

const FIXTURE_URL = new URL("./fixtures/corrected-claim.json", import.meta.url);
const MODULE_URL = new URL("./claim-feedback.mjs", import.meta.url);
const INPUT_SCHEMA = JSON.parse(
  readFileSync(new URL("./claim-feedback-input.schema.json", import.meta.url), "utf8"),
);
const PACKET_SCHEMA = JSON.parse(
  readFileSync(new URL("./claim-feedback-packet.schema.json", import.meta.url), "utf8"),
);
const FIXTURE = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

function rebindClaim(input, claimText, language = "en") {
  input.claim.text = claimText;
  input.claim.language = language;
  input.crawl.body_utf8 = `<main><p>${claimText}</p></main>`;
  input.crawl.claim_sha256 = sha256(claimText);
  input.crawl.body_sha256 = sha256(input.crawl.body_utf8);
  input.claim.sources[0].content_sha256 = input.crawl.body_sha256;
  input.reuse.applies_to_sha256 = [
    input.crawl.claim_sha256,
    input.crawl.body_sha256,
    ...input.challenge.evidence.map((item) => item.body_sha256),
    sha256(input.response.replacement_claim),
  ];
}

test("closed schemas cover every current branch and its JSON wire form", () => {
  assert.doesNotThrow(() => assertSupported(INPUT_SCHEMA));
  assert.doesNotThrow(() => assertSupported(PACKET_SCHEMA));

  const variants = [["corrected", clone(FIXTURE)]];
  const unanswered = clone(FIXTURE);
  unanswered.response = null;
  variants.push(["unanswered", unanswered]);

  const unchecked = clone(FIXTURE);
  unchecked.crawl.access.robots = {
    decision: "not-checked",
    url: null,
    observed_at: null,
    content_sha256: null,
  };
  unchecked.reuse.license_url = null;
  unchecked.reuse.policy_url = null;
  variants.push(["owner-supplied-unchecked", unchecked]);

  const unsupported = clone(FIXTURE);
  rebindClaim(unsupported, "個個都亂咁講嘢。", "zh-Hant");
  variants.push(["unsupported-language", unsupported]);

  const boundary = clone(FIXTURE);
  boundary.response.kind = "boundary";
  boundary.response.replacement_claim = null;
  boundary.response.replacement_claim_language = null;
  variants.push(["boundary", boundary]);

  const blocked = clone(FIXTURE);
  blocked.material_review.status = "blocked";
  blocked.material_review.contains_personal_data = true;
  variants.push(["material-blocked", blocked]);

  const scheduledWithdrawal = clone(FIXTURE);
  scheduledWithdrawal.reuse.withdrawn_at = "2026-08-16T11:00:00.000Z";
  variants.push(["withdrawal-scheduled", scheduledWithdrawal]);

  for (const [name, input] of variants) {
    assert.deepEqual(validate(input, INPUT_SCHEMA), [], `${name} input schema`);
    assert.deepEqual(validateClaimFeedbackInput(input), [], `${name} runtime input`);
    const packet = buildClaimFeedback(input);
    assert.deepEqual(validate(packet, PACKET_SCHEMA), [], `${name} packet schema`);
    assert.deepEqual(
      validate(JSON.parse(JSON.stringify(packet)), PACKET_SCHEMA),
      [],
      `${name} packet JSON wire`,
    );
  }
});

test("schemas reject shape drift, person scores, phrase leaks, rows, and effects", () => {
  const extraInput = clone(FIXTURE);
  extraInput.crawl.access.person_score = 1;
  assert.match(validate(extraInput, INPUT_SCHEMA).join("\n"), /person_score/);

  const incomplete = clone(FIXTURE);
  delete incomplete.crawl.access.crawler_user_agent;
  assert.match(validate(incomplete, INPUT_SCHEMA).join("\n"), /crawler_user_agent/);

  const phraseLeak = buildClaimFeedback(FIXTURE);
  phraseLeak.wording_review.claim.signal.marks = [];
  assert.match(validate(phraseLeak, PACKET_SCHEMA).join("\n"), /marks/);

  const score = buildClaimFeedback(FIXTURE);
  score.training_candidate.person_score = 1;
  assert.match(validate(score, PACKET_SCHEMA).join("\n"), /person_score/);

  const row = buildClaimFeedback(FIXTURE);
  row.training_candidate.candidate = {};
  assert.match(validate(row, PACKET_SCHEMA).join("\n"), /expected null/);

  const effect = buildClaimFeedback(FIXTURE);
  effect.effects.network_requests = 1;
  assert.match(validate(effect, PACKET_SCHEMA).join("\n"), /permitted set/);
});

test("the correction-recorded fixture keeps six separate, digest-bound lanes", () => {
  assert.deepEqual(validateClaimFeedbackInput(FIXTURE), []);
  const packet = buildClaimFeedback(FIXTURE);

  assert.equal(packet.schema, SCHEMAS.packet);
  assert.equal(packet.status, "correction-recorded");
  assert.equal(packet.source_claim.text, FIXTURE.claim.text);
  assert.equal(packet.source_claim.original_preserved, true);
  assert.equal(packet.crawl_receipt.literal_claim_match, true);
  assert.equal(packet.challenge.evidence[0].http_status, 503);
  assert.equal(packet.response.replacement_claim, FIXTURE.response.replacement_claim);
  assert.equal(packet.correction_state.latest_recorded_claim, FIXTURE.response.replacement_claim);
  assert.deepEqual(packet.correction_state.history.map((item) => item.kind), [
    "original", "correction",
  ]);
  assert.equal(packet.withdrawal_state.status, "not-recorded");
  assert.equal(packet.withdrawal_state.withdrawal_url, FIXTURE.claim.withdrawal_url);
  assert.equal(packet.material_review.status, "passed");

  assert.equal(packet.wording_review.person_aggregation, false);
  assert.match(packet.wording_review.method.engine.source_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(packet.wording_review.method.signal_projection.source_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(packet.wording_review.method.rules.source_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(packet.wording_review.method.packet_projection.source_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(packet.wording_review.method.offset_units, "UTF-16 code units");
  assert.equal(packet.wording_review.claim.status, "patterns-marked");
  assert.match(packet.wording_review.claim.analysis_result_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(packet.wording_review.claim.shared_signal_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(packet.wording_review.claim.signal.summary.rules, [
    { id: "absolute.universal", count: 1 },
  ]);
  for (const review of [
    packet.wording_review.claim,
    packet.wording_review.challenge,
    packet.wording_review.response,
    packet.wording_review.replacement_claim,
  ]) {
    assert.equal(Object.hasOwn(review.signal, "marks"), false);
    assert.equal(Object.hasOwn(review.signal, "strip"), false);
    assert.equal(Object.hasOwn(review.signal, "rewrite"), false);
  }

  assert.deepEqual(
    packet.karma_draft.records.map((item) => item.proposed_deed_kind),
    ["action", "consequence", "response", "correction"],
  );
  const correctionDraft = packet.karma_draft.records[3];
  assert.equal(Object.hasOwn(correctionDraft, "representation_change"), false);
  assert.match(correctionDraft.text, new RegExp(FIXTURE.crawl.claim_sha256));
  assert.ok(correctionDraft.text.includes(FIXTURE.response.replacement_claim));
  assert.match(correctionDraft.text, new RegExp(sha256(FIXTURE.response.replacement_claim)));
  assert.ok(correctionDraft.source.includes(FIXTURE.response.source));
  assert.ok(correctionDraft.source.includes(packet.integrity.input_sha256));
  assert.match(packet.karma_draft.records[2].known_limits, /did not dispatch/);
  assert.match(correctionDraft.known_limits, /not a repair/);
  assert.match(correctionDraft.known_limits, /does not prove .*published/);
  assert.equal(packet.karma_draft.status, "unsigned-draft-only");
  assert.match(packet.karma_draft.records[2].text, /Challenge kind \(advertised-observed-mismatch\)/);
  assert.equal(packet.karma_draft.records[2].response_type, "dispute");
  assert.equal(packet.karma_draft.importable, false);
  assert.equal(packet.karma_draft.deeds_signed, 0);
  assert.equal(packet.karma_draft.ledger_writes, 0);
  for (const record of packet.karma_draft.records) {
    assert.equal(Object.hasOwn(record, "signature_b64"), false);
    assert.equal(Object.hasOwn(record, "agent_id"), false);
    assert.deepEqual(Object.keys(record).sort(), [
      "attribution_basis", "causal_confidence", "claimed_relation", "effect_basis",
      "epistemic_confidence", "evidence", "evidence_status", "expectation_ref",
      "known_limits", "local_ref", "parent_local_ref", "proposed_deed_kind", "purpose",
      "response_type", "source", "speaker_claim", "text",
    ]);
  }

  assert.equal(packet.training_candidate.status, "held-for-independent-review");
  assert.equal(packet.training_candidate.declared_conditions_met, true);
  assert.equal(packet.training_candidate.review_proposal.assessed_at, FIXTURE.reuse.assessed_at);
  assert.equal(
    packet.training_candidate.review_proposal.supplied_rights.withdrawn_at,
    FIXTURE.reuse.withdrawn_at,
  );
  assert.equal(packet.training_candidate.candidate, null);
  assert.deepEqual(packet.training_candidate.review_proposal.evidence_sha256, [
    FIXTURE.challenge.evidence[0].body_sha256,
  ]);
  assert.equal(
    packet.training_candidate.review_proposal.supplied_material_review.status,
    "passed",
  );
  assert.match(packet.training_candidate.reasons.join("\n"), /independent rights/);
  assert.equal(packet.training_candidate.human_review_required, true);
  assert.equal(packet.training_candidate.current_declaration_recheck_required, true);
  assert.equal(packet.training_candidate.dataset_writes, 0);
  assert.equal(packet.effects.network_requests, 0);
  assert.equal(packet.effects.persistent_files_written, 0);
  assert.equal(packet.effects.external_state_changes_by_builder, 0);
  assert.equal(packet.effects.cli_stdout, "one report when the CLI succeeds");
  assert.equal(
    packet.crawl_receipt.access.crawler_user_agent,
    FIXTURE.crawl.access.crawler_user_agent,
  );
  assert.equal(packet.crawl_receipt.method, "GET");
  assert.equal(packet.crawl_receipt.final_url, FIXTURE.crawl.final_url);
  assert.equal(packet.crawl_receipt.access.crawler_name, FIXTURE.crawl.access.crawler_name);
});

test("integrity binds the complete input and packet", () => {
  const packet = buildClaimFeedback(FIXTURE);
  assert.equal(packet.integrity.input_sha256, sha256(stableJson(FIXTURE)));
  const withoutOwnDigest = clone(packet);
  delete withoutOwnDigest.integrity.packet_sha256;
  assert.equal(packet.integrity.packet_sha256, sha256(stableJson(withoutOwnDigest)));
  assert.equal(verifyClaimFeedbackPacket(packet, FIXTURE), true);

  const altered = clone(packet);
  altered.challenge.text = "A different challenge";
  assert.throws(
    () => verifyClaimFeedbackPacket(altered, FIXTURE),
    /canonical projection/,
  );
});

test("KARMA handoff preserves the challenge kind without calling every reply a dispute", () => {
  const evidenceRequest = clone(FIXTURE);
  evidenceRequest.challenge.kind = "evidence-request";
  const challenge = buildClaimFeedback(evidenceRequest).karma_draft.records[2];
  assert.match(challenge.text, /Challenge kind \(evidence-request\)/);
  assert.equal(challenge.response_type, "reply");

  const boundaryInput = clone(FIXTURE);
  boundaryInput.response.kind = "boundary";
  boundaryInput.response.replacement_claim = null;
  boundaryInput.response.replacement_claim_language = null;
  boundaryInput.reuse.applies_to_sha256.pop();
  const boundary = buildClaimFeedback(boundaryInput).karma_draft.records[3];
  assert.match(boundary.text, /^Claimed boundary:/);
  assert.match(boundary.known_limits, /does not .*establish authority/);

  const inferredBoundary = clone(boundaryInput);
  inferredBoundary.response.attribution_basis = "inference";
  assert.throws(() => buildClaimFeedback(inferredBoundary), /boundary cannot be inferred/);

  const tooLong = clone(FIXTURE);
  tooLong.response.replacement_claim = "x".repeat(1_700);
  tooLong.reuse.applies_to_sha256[3] = sha256(tooLong.response.replacement_claim);
  assert.match(validateClaimFeedbackInput(tooLong)[0].message, /\$karma\.text/);
  assert.throws(() => buildClaimFeedback(tooLong), /\$karma\.text/);

  for (const kind of ["reply", "dispute", "settlement", "redaction-request", "boundary"]) {
    const nonCorrection = clone(FIXTURE);
    nonCorrection.response.kind = kind;
    nonCorrection.response.replacement_claim = null;
    nonCorrection.response.replacement_claim_language = null;
    nonCorrection.reuse.applies_to_sha256.pop();
    const proposal = buildClaimFeedback(nonCorrection).training_candidate.review_proposal;
    assert.equal(proposal.corrected_claim_sha256, null, `${kind} correction digest`);
    assert.equal(proposal.correction_source, null, `${kind} correction source`);
  }
});

test("the builder rejects altered claim and evidence bytes", () => {
  const claimTamper = clone(FIXTURE);
  claimTamper.claim.text = "We review some reports.";
  assert.match(validateClaimFeedbackInput(claimTamper)[0].message, /claim_sha256/);
  assert.throws(() => buildClaimFeedback(claimTamper), /claim_sha256/);

  const evidenceTamper = clone(FIXTURE);
  evidenceTamper.challenge.evidence[0].body_utf8 =
    evidenceTamper.challenge.evidence[0].body_utf8.replace("disabled", "enabled");
  assert.throws(() => buildClaimFeedback(evidenceTamper), /body_sha256/);

  const excerptTamper = clone(FIXTURE);
  excerptTamper.challenge.evidence[0].excerpt = "A sentence that is not in the body.";
  assert.throws(() => buildClaimFeedback(excerptTamper), /must appear literally/);

  const sourceTamper = clone(FIXTURE);
  sourceTamper.claim.sources[0].content_sha256 = null;
  assert.throws(() => buildClaimFeedback(sourceTamper), /sources must bind/);

  const borrowedChallenge = clone(FIXTURE);
  borrowedChallenge.challenge.attribution_basis = "direct-report";
  borrowedChallenge.challenge.speaker_claim = "Someone else";
  assert.throws(() => buildClaimFeedback(borrowedChallenge), /recorder's self-attributed challenge/);

  const unlocatableChallenge = clone(FIXTURE);
  unlocatableChallenge.challenge.source = "recorder memory";
  assert.throws(() => buildClaimFeedback(unlocatableChallenge), /HTTPS source locator/);

  const unlocatableResponse = clone(FIXTURE);
  unlocatableResponse.response.source = "unretained conversation";
  assert.throws(() => buildClaimFeedback(unlocatableResponse), /HTTPS source locator/);

  const futureEvidence = clone(FIXTURE);
  futureEvidence.challenge.evidence[0].observed_at = "2026-08-16T09:03:00.000Z";
  assert.throws(() => buildClaimFeedback(futureEvidence), /must not follow .*challenge\.made_at/);
});

test("the direct API rejects accessors, proxies, and hidden data before they can drift", () => {
  const accessor = clone(FIXTURE);
  let reads = 0;
  Object.defineProperty(accessor.claim, "text", {
    enumerable: true,
    get() {
      reads += 1;
      return FIXTURE.claim.text;
    },
  });
  assert.throws(() => buildClaimFeedback(accessor), /not an accessor/);
  assert.equal(reads, 0, "descriptor inspection must not invoke the getter");

  const proxied = clone(FIXTURE);
  proxied.claim = new Proxy(proxied.claim, {});
  assert.throws(() => buildClaimFeedback(proxied), /must not be a Proxy/);

  const hidden = clone(FIXTURE);
  Object.defineProperty(hidden.claim, "hidden_profile", { value: "not JSON-visible" });
  assert.throws(() => buildClaimFeedback(hidden), /enumerable data property/);

  const sparse = clone(FIXTURE);
  sparse.claim.uncertainties = new Array(1);
  assert.throws(() => buildClaimFeedback(sparse), /dense JSON array/);

  const inheritedMethods = clone(FIXTURE);
  let inheritedCalls = 0;
  Object.setPrototypeOf(inheritedMethods.claim.sources, Object.assign(
    Object.create(Array.prototype),
    {
      forEach() { inheritedCalls += 1; },
      some() { inheritedCalls += 1; return true; },
    },
  ));
  assert.throws(() => buildClaimFeedback(inheritedMethods), /standard Array prototype/);
  assert.equal(inheritedCalls, 0, "validation must not dispatch through an input array prototype");

  const ownKeysAccessor = clone(FIXTURE);
  let ownKeysReads = 0;
  Object.defineProperty(ownKeysAccessor.claim.sources, "keys", {
    enumerable: true,
    get() {
      ownKeysReads += 1;
      return Array.prototype.keys;
    },
  });
  assert.throws(() => buildClaimFeedback(ownKeysAccessor), /dense JSON array/);
  assert.equal(ownKeysReads, 0, "array shape checks must not invoke an own keys accessor");

  for (const loneSurrogate of ["\ud800", "\udc00"]) {
    const malformed = clone(FIXTURE);
    malformed.challenge.text = loneSurrogate;
    assert.throws(() => buildClaimFeedback(malformed), /unpaired UTF-16 surrogate/);
    assert.throws(() => sha256(loneSurrogate), /unpaired UTF-16 surrogate/);
  }

  let nested = [];
  for (let index = 0; index < BOUNDS.max_json_depth + 2; index += 1) nested = [nested];
  assert.throws(() => stableJson(nested), /exceeds JSON depth/);

  const packetAccessor = buildClaimFeedback(FIXTURE);
  let packetReads = 0;
  Object.defineProperty(packetAccessor.challenge, "text", {
    enumerable: true,
    get() {
      packetReads += 1;
      return FIXTURE.challenge.text;
    },
  });
  assert.throws(() => verifyClaimFeedbackPacket(packetAccessor, FIXTURE), /not an accessor/);
  assert.equal(packetReads, 0);
});

test("bounded pattern-dense text validates and builds on the same domain", () => {
  const dense = clone(FIXTURE);
  rebindClaim(dense, `${"always ".repeat(1_141)}always`);
  assert.equal(dense.claim.text.length, 7_993);
  assert.deepEqual(validateClaimFeedbackInput(dense), []);
  const packet = buildClaimFeedback(dense);
  assert.equal(packet.wording_review.claim.status, "patterns-marked");
  assert.equal(verifyClaimFeedbackPacket(packet, dense), true);
});

test("training remains held pending every supplied condition and an independent review", () => {
  const denied = clone(FIXTURE);
  denied.reuse.training = "deny";
  let candidate = buildClaimFeedback(denied).training_candidate;
  assert.equal(candidate.status, "held-for-independent-review");
  assert.equal(candidate.candidate, null);
  assert.equal(candidate.declared_conditions_met, false);
  assert.ok(candidate.reasons.includes("training use is not explicitly allowed"));

  const uncovered = clone(FIXTURE);
  uncovered.reuse.applies_to_sha256.pop();
  candidate = buildClaimFeedback(uncovered).training_candidate;
  assert.equal(candidate.status, "held-for-independent-review");
  assert.match(candidate.reasons.join("\n"), /does not cover 1 required digest/);

  const unanswered = clone(FIXTURE);
  unanswered.response = null;
  candidate = buildClaimFeedback(unanswered).training_candidate;
  assert.equal(candidate.status, "held-for-independent-review");
  assert.match(candidate.reasons.join("\n"), /source-attributed correction/);
  assert.equal(buildClaimFeedback(unanswered).status, "challenge-open");

  const withdrawn = clone(FIXTURE);
  withdrawn.reuse.withdrawn_at = "2026-08-16T10:01:00.000Z";
  candidate = buildClaimFeedback(withdrawn).training_candidate;
  assert.equal(candidate.status, "held-for-independent-review");
  assert.match(candidate.reasons.join("\n"), /withdrawn/);

  const futureWithdrawal = clone(FIXTURE);
  futureWithdrawal.reuse.withdrawn_at = "2026-08-16T11:00:00.000Z";
  candidate = buildClaimFeedback(futureWithdrawal).training_candidate;
  assert.equal(candidate.declared_conditions_met, true);

  const notYetEffective = clone(FIXTURE);
  notYetEffective.reuse.effective_at = "2026-08-16T11:00:00.000Z";
  candidate = buildClaimFeedback(notYetEffective).training_candidate;
  assert.equal(candidate.declared_conditions_met, false);
  assert.match(candidate.reasons.join("\n"), /not yet effective/);

  const inferredCorrection = clone(FIXTURE);
  inferredCorrection.response.attribution_basis = "inference";
  assert.throws(() => buildClaimFeedback(inferredCorrection), /self-attributed or directly reported/);

  const impossibleWithdrawal = clone(FIXTURE);
  impossibleWithdrawal.reuse.withdrawn_at = "2026-08-16T09:59:59.000Z";
  assert.throws(() => buildClaimFeedback(impossibleWithdrawal), /must not precede effective_at/);

  const blockedMaterial = clone(FIXTURE);
  blockedMaterial.material_review.status = "blocked";
  blockedMaterial.material_review.contains_personal_data = true;
  candidate = buildClaimFeedback(blockedMaterial).training_candidate;
  assert.equal(candidate.declared_conditions_met, false);
  assert.match(candidate.reasons.join("\n"), /material review has not passed/);
  assert.match(candidate.reasons.join("\n"), /personal data/);

  const falsePass = clone(FIXTURE);
  falsePass.material_review.contains_third_party_material = true;
  assert.throws(() => buildClaimFeedback(falsePass), /passed material review/);

  const reviewBeforeCorrection = clone(FIXTURE);
  reviewBeforeCorrection.material_review.reviewed_at = "2026-08-16T09:59:59.000Z";
  assert.throws(() => buildClaimFeedback(reviewBeforeCorrection), /latest reviewed record/);

  const rightsBeforeCorrection = clone(FIXTURE);
  rightsBeforeCorrection.reuse.assessed_at = "2026-08-16T09:59:59.000Z";
  assert.throws(() => buildClaimFeedback(rightsBeforeCorrection), /latest covered record/);

  const reviewAfterAssessment = clone(FIXTURE);
  reviewAfterAssessment.material_review.reviewed_at = "2099-01-01T00:00:00.000Z";
  assert.throws(
    () => buildClaimFeedback(reviewAfterAssessment),
    /assessed_at must not precede .*material_review\.reviewed_at/,
  );
});

test("one unauthenticated payload cannot authorize its own training use", () => {
  const selfAuthorizing = clone(FIXTURE);
  selfAuthorizing.response.speaker_claim = "Unverified payload";
  selfAuthorizing.reuse.declaring_party = "Unverified payload";
  selfAuthorizing.reuse.authority_basis = "I authorize myself";
  selfAuthorizing.reuse.license_url = "https://attacker.invalid/not-a-licence";
  selfAuthorizing.reuse.policy_url = null;
  selfAuthorizing.reuse.source = "https://attacker.invalid/self-assertion";

  const review = buildClaimFeedback(selfAuthorizing).training_candidate;
  assert.equal(review.status, "held-for-independent-review");
  assert.equal(review.declared_conditions_met, true);
  assert.equal(review.candidate, null);
  assert.match(review.reasons.join("\n"), /independent rights/);
  assert.ok(review.not_established.includes("the declaring party's identity or rights authority"));
});

test("robots is recorded as crawl preference, never training permission", () => {
  const packet = buildClaimFeedback(FIXTURE);
  assert.match(packet.crawl_receipt.access.note, /not .*AI-training consent/i);
  assert.match(packet.crawl_receipt.access.note, /unauthenticated/i);
  assert.equal(
    packet.crawl_receipt.access.crawler_user_agent,
    "ExampleClaimCrawler/0.1 (+https://example.org/crawler)",
  );
  assert.equal(packet.reuse_declaration.training, "allow");

  const noBasis = clone(FIXTURE);
  noBasis.crawl.access.basis = "not-established";
  const candidate = buildClaimFeedback(noBasis).training_candidate;
  assert.equal(candidate.status, "held-for-independent-review");
  assert.match(candidate.reasons.join("\n"), /collection basis/);

  const unidentified = clone(FIXTURE);
  delete unidentified.crawl.access.crawler_user_agent;
  assert.throws(() => buildClaimFeedback(unidentified), /crawler_user_agent/);

  const robotsAsAuthority = clone(FIXTURE);
  robotsAsAuthority.crawl.access.basis = "robots-allowed";
  assert.throws(() => buildClaimFeedback(robotsAsAuthority), /owner-supplied/);

  const ownerPublishedButDisallowed = clone(FIXTURE);
  ownerPublishedButDisallowed.crawl.access.basis = "owner-published";
  ownerPublishedButDisallowed.crawl.access.robots.decision = "disallowed";
  const held = buildClaimFeedback(ownerPublishedButDisallowed).training_candidate;
  assert.equal(held.declared_conditions_met, false);
  assert.match(held.reasons.join("\n"), /crawl was disallowed/);

  const ownerSuppliedDespiteRobots = clone(FIXTURE);
  ownerSuppliedDespiteRobots.crawl.access.robots.decision = "disallowed";
  assert.equal(
    buildClaimFeedback(ownerSuppliedDespiteRobots).training_candidate.declared_conditions_met,
    true,
  );

  const robotsQuery = clone(FIXTURE);
  robotsQuery.crawl.access.robots.url = "https://example.org/robots.txt?copy=1";
  assert.throws(() => buildClaimFeedback(robotsQuery), /query-free/);

  const futureRobots = clone(FIXTURE);
  futureRobots.crawl.access.robots.observed_at = "2026-08-16T09:00:01.000Z";
  assert.throws(() => buildClaimFeedback(futureRobots), /must not follow retrieved_at/);
});

test("unsupported languages are named instead of receiving a false clean result", () => {
  const input = clone(FIXTURE);
  rebindClaim(input, "個個都亂咁講嘢。", "zh-Hant");
  const review = buildClaimFeedback(input).wording_review.claim;
  assert.equal(review.status, "unsupported-language");
  assert.equal(review.signal, null);
  assert.match(review.note, /not run/i);

  const mixed = clone(FIXTURE);
  mixed.challenge.text = "個個都亂咁講嘢。";
  mixed.challenge.language = "zh-Hant";
  const mixedReview = buildClaimFeedback(mixed).wording_review;
  assert.equal(mixedReview.claim.status, "patterns-marked");
  assert.equal(mixedReview.challenge.status, "unsupported-language");

  const mixedCorrection = clone(FIXTURE);
  mixedCorrection.response.text = "依句回覆係廣東話。";
  mixedCorrection.response.language = "zh-Hant";
  mixedCorrection.response.replacement_claim_language = "en";
  const correctionReview = buildClaimFeedback(mixedCorrection).wording_review;
  assert.equal(correctionReview.response.status, "unsupported-language");
  assert.notEqual(correctionReview.replacement_claim.status, "unsupported-language");
});

test("zero English marks use the narrow pack wording", () => {
  const input = clone(FIXTURE);
  rebindClaim(input, "I made a mistake and I will fix it by Friday.");
  const review = buildClaimFeedback(input).wording_review.claim;
  assert.equal(review.status, "none-marked-by-pack");
  assert.equal(review.note, "No supported wording patterns were marked by this English pack.");
});

test("claim, challenge, reply, and correction wording stay separate and redacted", () => {
  const input = clone(FIXTURE);
  input.challenge.text = "ACT NOW and accept this guaranteed challenge.";
  input.response.text = "Obviously, this reply fixes everything.";
  input.response.replacement_claim = "Every report is definitely fixed.";
  input.reuse.applies_to_sha256 = [
    input.crawl.claim_sha256,
    input.crawl.body_sha256,
    ...input.challenge.evidence.map((item) => item.body_sha256),
    sha256(input.response.replacement_claim),
  ];

  const reviews = buildClaimFeedback(input).wording_review;
  for (const review of [
    reviews.claim,
    reviews.challenge,
    reviews.response,
    reviews.replacement_claim,
  ]) {
    assert.equal(review.status, "patterns-marked");
    assert.equal(Object.hasOwn(review.signal, "marks"), false);
  }
  assert.equal(reviews.person_aggregation, false);
});

test("the command is one-shot, print-only, and has an off-switch before input read", () => {
  const before = statSync(FIXTURE_URL);
  const beforeBytes = readFileSync(FIXTURE_URL);
  let output = "";
  assert.equal(runCli([new URL(FIXTURE_URL).pathname], {
    env: {},
    stdout: { write: (chunk) => { output += chunk; } },
  }), 0);
  assert.equal(JSON.parse(output).schema, SCHEMAS.packet);
  const after = statSync(FIXTURE_URL);
  assert.deepEqual(readFileSync(FIXTURE_URL), beforeBytes);
  assert.equal(after.size, before.size);
  assert.equal(after.mode, before.mode);
  assert.equal(after.mtimeMs, before.mtimeMs);

  assert.throws(
    () => runCli(["/definitely/not/read.json"], {
      env: { CLAIM_FEEDBACK_HALT: "1" },
      stdout: { write: () => { throw new Error("must not write"); } },
    }),
    /stopped .* before input read/,
  );
});

test("the current module imports only local read capabilities", () => {
  const source = readFileSync(MODULE_URL, "utf8");
  const builtins = [...source.matchAll(/from "(node:[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(builtins, ["node:crypto", "node:fs", "node:path", "node:util", "node:url"]);
  const fsNames = source
    .match(/import\s+\{([^}]*)\}\s+from "node:fs";/)[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  assert.deepEqual(fsNames, [
    "closeSync", "constants", "fstatSync", "lstatSync", "openSync", "readFileSync", "readSync",
  ]);
  assert.doesNotMatch(source, /\b(?:fetch|writeFile|appendFile|createWriteStream|setInterval|setTimeout)\s*\(/);
  assert.doesNotMatch(source, /\b(?:import\s*\(|getBuiltinModule|eval\s*\(|new Function\s*\()/);
  assert.ok(Buffer.byteLength(JSON.stringify(FIXTURE), "utf8") < BOUNDS.max_input_bytes);
});
