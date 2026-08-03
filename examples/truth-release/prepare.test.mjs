import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { assertSupported, validate } from "../../test/helpers/schema-validator.mjs";
import {
  BOUNDS,
  prepareTruthRelease,
  renderPublicPage,
  renderReviewMarkdown,
  validateReleaseInput,
} from "./prepare.mjs";

const FIXTURE_URL = new URL("./fixtures/one-claim.json", import.meta.url);
const INPUT_SCHEMA = JSON.parse(
  readFileSync(new URL("./release-input.schema.json", import.meta.url), "utf8"),
);
const BUNDLE_SCHEMA = JSON.parse(
  readFileSync(new URL("./release-bundle.schema.json", import.meta.url), "utf8"),
);

function fixture() {
  return JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
}

function prepare(input = fixture()) {
  return prepareTruthRelease(input, { now: "2026-08-03T10:00:00.000Z" });
}

test("the input and output schemas use only enforced constructs", () => {
  assert.doesNotThrow(() => assertSupported(INPUT_SCHEMA));
  assert.doesNotThrow(() => assertSupported(BUNDLE_SCHEMA));
  assert.deepEqual(validate(fixture(), INPUT_SCHEMA), []);

  const empty = fixture();
  empty.title = "";
  empty.sources = [];
  empty.channel_selection = ["bluesky", "bluesky"];
  const structural = validate(empty, INPUT_SCHEMA).join("\n");
  assert.match(structural, /string length 0 is below the minimum/);
  assert.match(structural, /item count 0 is below the minimum/);
  assert.match(structural, /items must be unique/);
});

test("one bounded claim becomes a schema-valid prepared bundle", () => {
  const input = fixture();
  const bundle = prepare(input);

  assert.deepEqual(validateReleaseInput(input), []);
  assert.deepEqual(validate(bundle, BUNDLE_SCHEMA), []);
  assert.equal(bundle.status, "prepared");
  assert.equal(bundle.claim.text, input.claim, "the canonical claim remains exact");
  assert.match(bundle.claim.utf8_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(bundle.source_record_digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(bundle.bounds.max_external_effects, 0);
  assert.equal(bundle.bounds.max_attempts_per_action, 1);
  assert.equal(bundle.review.human_approval.dispatch_authorized, false);
  assert.equal(bundle.public_resource.claim.id, input.id);
  assert.equal(bundle.public_resource.publication_state, "prepared-not-published");
  assert.equal(bundle.public_resource.dates.publication_receipt, null);
});

test("phrase-level RhetorLint marks stay in local review and the public signal stays redacted", () => {
  const input = fixture();
  input.title = "ACT NOW — this is a guaranteed breakthrough";
  input.sources[0].supports = "ACT NOW to receive this free offer.";
  const bundle = prepare(input);
  const local = bundle.review.rhetorlint.local_marks;
  const signalJson = JSON.stringify(bundle.public_resource.rhetorlint_signal);

  assert.ok(local.some((mark) => mark.rule_id === "urgency.appeal-to-time"));
  assert.ok(local.some((mark) => mark.rule_id === "absolute.universal"));
  assert.ok(local.some((mark) => mark.field === "sources[0].supports"));
  assert.ok(bundle.review.issues.some((issue) => issue.code === "attention-language-needs-context"));
  assert.ok(!signalJson.includes("ACT NOW"));
  assert.ok(!Object.hasOwn(bundle.public_resource.rhetorlint_signal, "marks"));
  assert.ok(!Object.hasOwn(bundle.public_resource.rhetorlint_signal, "strip"));
  assert.ok(!Object.hasOwn(bundle.public_resource.rhetorlint_signal, "rewrite"));
});

test("channel drafts preserve the exact claim and authorize no dispatch", () => {
  const input = fixture();
  const bundle = prepare(input);

  assert.equal(bundle.drafts.length, input.channel_selection.length);
  for (const draft of bundle.drafts) {
    assert.equal(draft.canonical_claim, input.claim);
    assert.equal(draft.claim_digest, bundle.claim.utf8_sha256);
    assert.equal(draft.dispatch.authorized, false);
    assert.equal(draft.dispatch.adapter_present, false);
    assert.equal(draft.dispatch.external_effects, 0);
    assert.deepEqual(draft.media, input.media);
    assert.equal(draft.commercial_interest, input.commercial_interest);
    assert.equal(draft.intended_audience, input.audience);
    assert.ok(draft.parts.length <= BOUNDS.max_parts_per_draft);
    assert.equal(
      draft.dispatch.future_external_effect_bound,
      draft.layout.status === "human-layout-required" ? null : draft.parts.length,
    );
    assert.ok(draft.body.includes(input.canonical_url));
    assert.match(draft.draft_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      draft.digest_scope,
      "canonical JSON of channel, format, opening, body, parts, layout, alt_text, media, commercial_interest, intended_audience, and canonical_claim",
    );
    assert.ok(draft.official_information.every((url) => url.startsWith("https://")));
    assert.equal(draft.guidance_observed_at, "2026-08-03");
    assert.equal(draft.guidance_review_after, "2026-11-03");
  }
  assert.ok(bundle.review.attention.every((item) => item.status !== "ready"));
});

test("the draft digest binds media, disclosure, commercial interest, and audience", () => {
  const input = fixture();
  input.channel_selection = ["instagram"];
  input.media = [{
    url: "https://example.org/evidence/rhetorlint-visible-words/card.png",
    creator: "Cambridge TCG",
    rights_basis: "CC BY 4.0 supplied declaration",
    alt: "A proof sheet about reading visible words",
    synthetic: true,
    synthetic_disclosure: "AI-assisted illustration",
  }];
  const original = prepare(input).drafts[0].draft_digest;

  const mediaChanged = structuredClone(input);
  mediaChanged.media[0].synthetic_disclosure = "Human-made illustration";
  assert.notEqual(prepare(mediaChanged).drafts[0].draft_digest, original);

  const interestChanged = structuredClone(input);
  interestChanged.commercial_interest = "The author sells related training.";
  assert.notEqual(prepare(interestChanged).drafts[0].draft_digest, original);

  const audienceChanged = structuredClone(input);
  audienceChanged.audience = "Public-interest editors";
  assert.notEqual(prepare(audienceChanged).drafts[0].draft_digest, original);
});

test("an overlong unbroken short-post token stops for human layout", () => {
  const input = fixture();
  input.claim = "x".repeat(1_000);
  input.channel_selection = ["bluesky"];
  const bundle = prepare(input);
  const draft = bundle.drafts[0];

  assert.equal(draft.layout.status, "human-layout-required");
  assert.deepEqual(draft.parts, []);
  assert.equal(draft.dispatch.future_external_effect_bound, null);
  assert.ok(bundle.review.issues.some((issue) => issue.code === "channel-layout-needs-human"));
});

test("calendar dates are real and future public evidence dates stop at review", () => {
  const impossible = fixture();
  impossible.evidence_updated_at = "2026-02-30";
  assert.ok(
    validateReleaseInput(impossible).some(
      (issue) =>
        issue.path === "$.evidence_updated_at" && issue.message.includes("real calendar date"),
    ),
  );

  const future = fixture();
  future.evidence_updated_at = "2026-08-04";
  future.sources[0].observed_at = "2026-08-04";
  const issues = prepare(future).review.issues;
  assert.ok(issues.some((issue) => issue.code === "evidence-date-in-future"));
  assert.ok(issues.some((issue) => issue.code === "source-observation-in-future"));

  for (const now of [
    "2026-02-30T10:00:00.000Z",
    "2026-04-31T00:00:00Z",
    "2026-01-01T24:00:00Z",
  ]) {
    assert.throws(
      () => prepareTruthRelease(fixture(), { now }),
      /real uppercase-UTC ISO timestamp/,
    );
  }
  assert.equal(
    prepareTruthRelease(fixture(), { now: "2026-08-03T10:00:00Z" }).prepared_at,
    "2026-08-03T10:00:00Z",
  );
});

test("unpinned source bytes remain visible as a human review gap", () => {
  const input = fixture();
  for (const source of input.sources) source.content_sha256 = null;
  const bundle = prepare(input);
  const gaps = bundle.review.issues.filter((issue) => issue.code === "source-bytes-not-pinned");

  assert.equal(gaps.length, input.sources.length);
  assert.equal(bundle.evidence.source_contents_fetched, false);
  assert.equal(bundle.public_resource.evidence.source_contents_fetched_by_preparer, false);
});

test("SEO is one ordinary canonical Article companion, never an automatic ClaimReview", () => {
  const bundle = prepare();
  const html = renderPublicPage(bundle);

  assert.equal(bundle.seo.json_ld["@type"], "Article");
  assert.notEqual(bundle.seo.json_ld["@type"], "ClaimReview");
  assert.ok(!html.includes('"@type":"ClaimReview"'));
  assert.equal(bundle.seo.robots, "noindex, nofollow");
  assert.equal(bundle.seo.publication_state, "prepared-preview");
  assert.ok(!Object.hasOwn(bundle.seo.json_ld, "datePublished"));
  assert.ok(html.includes("Not published"));
  assert.ok(html.includes(`<link rel="canonical" href="${bundle.seo.canonical_url}">`));
  assert.ok(html.includes("Machine-readable release"));
  assert.ok(html.includes("Correction and reply"));
  assert.ok(!html.includes("<script src="));
});

test("XENIA is a pinned design reference, not inferred adoption or conformance", () => {
  const bundle = prepare();

  assert.equal(bundle.rights.xenia.profile, "xenia.rights/0.1");
  assert.equal(bundle.rights.adoption, "not-declared-by-this-bundle");
  assert.match(bundle.rights.xenia.relationship, /does not declare XENIA adoption or conformance/);
  assert.equal(bundle.rights.data_and_pressure.tracking_parameters_created, false);
  assert.equal(bundle.rights.data_and_pressure.third_party_media_requests_created, false);
  assert.equal(bundle.rights.data_and_pressure.silence_or_ignore_is_complete, true);
  assert.equal(bundle.public_resource.rights.xenia_design_reference.profile, "xenia.rights/0.1");
  assert.equal(bundle.public_resource.rights.xenia_adoption, "not-declared-by-this-bundle");
  assert.ok(bundle.public_resource.rights.choices.every((choice) => choice.binding === false));
  assert.match(renderPublicPage(bundle), /Your choices/);
});

test("media must stay same-origin and free of tracking parameters", () => {
  const external = fixture();
  external.media = [{
    url: "https://tracker.example/pixel.png",
    creator: "Example",
    rights_basis: "supplied test declaration",
    alt: "A test pixel",
    synthetic: false,
    synthetic_disclosure: null,
  }];
  assert.ok(
    validateReleaseInput(external).some(
      (issue) => issue.path === "$.media[0].url" && issue.message.includes("same-origin"),
    ),
  );
  assert.throws(() => prepare(external), /same-origin/);

  const query = fixture();
  query.media = [{ ...external.media[0], url: `${query.canonical_url}card.png?viewer=1` }];
  assert.throws(() => prepare(query), /query parameters/);

  const trackedCanonical = fixture();
  trackedCanonical.canonical_url = `${trackedCanonical.canonical_url}?utm_source=private-id`;
  assert.throws(() => prepare(trackedCanonical), /query parameters/);

  for (const host of [
    "127.0.0.1",
    "[::1]",
    "localhost",
    "router.local",
    "192.168.1.5",
    "169.254.169.254",
  ]) {
    const privateOrigin = fixture();
    privateOrigin.canonical_url = `https://${host}/release/`;
    privateOrigin.machine_url = `https://${host}/release/release.json`;
    assert.throws(() => prepare(privateOrigin), /public-host-shaped/);
  }
});

test("the output schema and renderer preserve the public redaction and URL boundary", () => {
  const bundle = prepare();
  const phraseLeak = structuredClone(bundle);
  phraseLeak.public_resource.rhetorlint_signal.marks = [];
  assert.match(validate(phraseLeak, BUNDLE_SCHEMA).join("\n"), /property 'marks' is not permitted/);
  assert.throws(() => renderPublicPage(phraseLeak), /phrase-redacted/);

  const unsafeUrl = structuredClone(bundle);
  unsafeUrl.public_resource.canonical_url = "javascript:alert(1)";
  assert.match(validate(unsafeUrl, BUNDLE_SCHEMA).join("\n"), /does not match/);
  assert.throws(() => renderPublicPage(unsafeUrl), /HTTPS URL/);

  const privateUrl = structuredClone(bundle);
  privateUrl.public_resource.canonical_url = "https://127.0.0.1/release/";
  privateUrl.seo.canonical_url = privateUrl.public_resource.canonical_url;
  assert.throws(() => renderPublicPage(privateUrl), /public-host-shaped/);

  const badDigest = structuredClone(bundle);
  badDigest.public_resource.evidence.sources[0].content_sha256 = "not-a-digest";
  assert.match(validate(badDigest, BUNDLE_SCHEMA).join("\n"), /does not match/);

  const falseFactCheck = structuredClone(bundle);
  falseFactCheck.seo.json_ld["@type"] = "ClaimReview";
  assert.match(validate(falseFactCheck, BUNDLE_SCHEMA).join("\n"), /outside the permitted set/);

  const alteredClaim = structuredClone(bundle);
  alteredClaim.public_resource.claim.text = "A different claim with a stale digest.";
  assert.deepEqual(validate(alteredClaim, BUNDLE_SCHEMA), []);
  assert.throws(() => renderPublicPage(alteredClaim), /canonical prepared projection/);

  const staleClaimDigest = structuredClone(bundle);
  staleClaimDigest.claim.text = "A different root claim with a stale digest.";
  staleClaimDigest.public_resource.claim.text = staleClaimDigest.claim.text;
  assert.throws(() => renderPublicPage(staleClaimDigest), /must bind the exact claim text/);

  const alteredOg = structuredClone(bundle);
  alteredOg.seo.open_graph.url = "https://example.org/a-different-page/";
  assert.deepEqual(validate(alteredOg, BUNDLE_SCHEMA), []);
  assert.throws(() => renderPublicPage(alteredOg), /seo must match/);

  const alteredJsonLd = structuredClone(bundle);
  alteredJsonLd.seo.json_ld["@id"] = "https://example.org/a-different-page/#article";
  assert.deepEqual(validate(alteredJsonLd, BUNDLE_SCHEMA), []);
  assert.throws(() => renderPublicPage(alteredJsonLd), /seo must match/);

  const alteredCitation = structuredClone(bundle);
  alteredCitation.seo.json_ld.citation[0] = "https://example.org/unrelated";
  assert.deepEqual(validate(alteredCitation, BUNDLE_SCHEMA), []);
  assert.throws(() => renderPublicPage(alteredCitation), /seo must match/);
});

test("supplied markup stays inert in the HTML page and Markdown review", () => {
  const input = fixture();
  input.title = '<img src="https://tracker.example/pixel"> ![load](https://tracker.example/pixel)';
  input.summary = "``` </script><script>alert(1)</script>";
  const bundle = prepare(input);
  const html = renderPublicPage(bundle);
  const markdown = renderReviewMarkdown(bundle);

  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes('<img src="https://tracker.example/pixel"'));
  assert.ok(!html.includes("</script><script>alert"));
  assert.match(markdown, /````text/);
  assert.ok(!markdown.split("\n").some((line) => line.startsWith("<img")));
});

test("closed input, source, and channel bounds fail before preparation", () => {
  const tooMany = fixture();
  tooMany.sources = Array.from({ length: BOUNDS.max_sources + 1 }, (_, index) => ({
    ...tooMany.sources[0],
    id: `source-${index}`,
  }));
  assert.ok(validateReleaseInput(tooMany).some((issue) => issue.path === "$.sources"));
  assert.throws(() => prepare(tooMany), /at most 8 sources/);

  const extra = fixture();
  extra.engagement_score = 99;
  assert.ok(validateReleaseInput(extra).some((issue) => issue.path === "$.engagement_score"));

  const insecure = fixture();
  insecure.canonical_url = "http://example.test/release";
  assert.ok(validateReleaseInput(insecure).some((issue) => issue.path === "$.canonical_url"));
});

test("the CLI writes a new owner-only bundle and refuses to overwrite it", () => {
  const root = mkdtempSync(join(tmpdir(), "truth-release-test-"));
  const out = join(root, "prepared");
  try {
    const first = spawnSync(
      process.execPath,
      [new URL("./prepare.mjs", import.meta.url).pathname, FIXTURE_URL.pathname, "--out", out],
      { encoding: "utf8" },
    );
    assert.equal(first.status, 0, first.stderr);
    assert.equal(statSync(out).mode & 0o777, 0o700);
    for (const name of ["release.json", "review.json", "page.html", "REVIEW.md"]) {
      assert.ok(readFileSync(join(out, name)).length > 0, `${name} was written`);
      assert.equal(statSync(join(out, name)).mode & 0o777, 0o600);
    }

    const second = spawnSync(
      process.execPath,
      [new URL("./prepare.mjs", import.meta.url).pathname, FIXTURE_URL.pathname, "--out", out],
      { encoding: "utf8" },
    );
    assert.equal(second.status, 2);
    assert.match(second.stderr, /already exists/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI rejects duplicate, dangling, and option-looking output arguments", () => {
  const script = new URL("./prepare.mjs", import.meta.url).pathname;
  for (const args of [
    [FIXTURE_URL.pathname, "--out"],
    [FIXTURE_URL.pathname, "--out", "--out", "other"],
    [FIXTURE_URL.pathname, "--out", "--surprise"],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2, `${args.join(" ")} must fail`);
    assert.match(result.stderr, /Usage:/);
  }
});

test("the preparer contains no transport, recurring timer, or account adapter", () => {
  const source = readFileSync(new URL("./prepare.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bhttps?\.request\s*\(/);
  assert.doesNotMatch(source, /\bsetInterval\s*\(/);
  assert.doesNotMatch(source, /from\s+["']node:child_process["']/);
});
