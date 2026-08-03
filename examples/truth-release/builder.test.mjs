import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { assertSupported, validate } from "../../test/helpers/schema-validator.mjs";
import {
  ARTIFACT_BOUNDS,
  SCHEMAS,
  createAdapterPreview,
  prepareTruthRelease,
  verifyAdapterPreview,
} from "./builder.mjs";
import { renderPublicPage, renderReviewMarkdown } from "./prepare.mjs";

const BUILDER_PATH = new URL("./builder.mjs", import.meta.url).pathname;
const FIXTURE_URL = new URL("./fixtures/one-claim.json", import.meta.url);
const PREVIEW_SCHEMA = JSON.parse(
  readFileSync(new URL("./adapter-preview.schema.json", import.meta.url), "utf8"),
);
const PREVIEW_REQUEST_SCHEMA = JSON.parse(
  readFileSync(new URL("./adapter-preview-request.schema.json", import.meta.url), "utf8"),
);

function fixture() {
  return JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
}

function prepare(input = fixture()) {
  return prepareTruthRelease(input, { now: "2026-08-03T10:00:00.000Z" });
}

function previewRequest(bundle, channel) {
  const draft = bundle.drafts.find((item) => item.channel === channel) ?? bundle.drafts[0];
  return {
    schema: SCHEMAS.adapter_preview_request,
    channel,
    expected_source_record_digest: bundle.source_record_digest,
    expected_draft_digest: draft.draft_digest,
  };
}

function run(args) {
  return spawnSync(process.execPath, [BUILDER_PATH, ...args], { encoding: "utf8" });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

function snapshot(directory) {
  return Object.fromEntries(
    readdirSync(directory).sort().map((name) => {
      const path = join(directory, name);
      const stat = statSync(path);
      return [name, {
        bytes: readFileSync(path).toString("base64"),
        mode: stat.mode & 0o777,
        modified: stat.mtimeMs,
      }];
    }),
  );
}

test("the preview-only adapter contract is closed, schema-valid, and zero-effect", () => {
  assert.doesNotThrow(() => assertSupported(PREVIEW_SCHEMA));
  assert.doesNotThrow(() => assertSupported(PREVIEW_REQUEST_SCHEMA));
  const bundle = prepare();
  const request = previewRequest(bundle, "bluesky");
  const preview = createAdapterPreview(bundle, request);

  assert.deepEqual(validate(request, PREVIEW_REQUEST_SCHEMA), []);
  assert.deepEqual(validate(preview, PREVIEW_SCHEMA), []);
  assert.equal(preview.status, "preview-only");
  assert.equal(preview.content.canonical_claim, bundle.claim.text);
  assert.equal(preview.content.claim_digest, bundle.claim.utf8_sha256);
  assert.equal(preview.content.draft_digest, bundle.drafts[0].draft_digest);
  assert.equal(preview.approval.granted, false);
  assert.equal(preview.dispatch.adapter_present, false);
  assert.equal(preview.dispatch.authorized, false);
  assert.equal(preview.dispatch.attempts, 0);
  assert.equal(preview.dispatch.external_effects, 0);
  assert.match(preview.integrity.preview_digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(verifyAdapterPreview(preview, {
    bundle,
    request,
    expected_preview_digest: preview.integrity.preview_digest,
  }), true);
  assert.ok(!Object.hasOwn(preview, "account"));
  assert.ok(!Object.hasOwn(preview, "credential"));
});

test("adapter preview fails closed on altered content, approval, layout, or channel", () => {
  const altered = prepare();
  altered.drafts[0].body = "changed after its digest";
  assert.throws(
    () => createAdapterPreview(altered, previewRequest(altered, "bluesky")),
    /draft_digest|prepared bundle/,
  );

  const approved = prepare();
  approved.review.human_approval.completed = true;
  approved.review.human_approval.dispatch_authorized = true;
  assert.throws(
    () => createAdapterPreview(approved, previewRequest(approved, "bluesky")),
    /human-approval boundary|prepared bundle/,
  );

  const needsLayoutInput = fixture();
  needsLayoutInput.claim = "x".repeat(1_000);
  needsLayoutInput.channel_selection = ["bluesky"];
  const needsLayout = prepare(needsLayoutInput);
  assert.throws(
    () => createAdapterPreview(needsLayout, previewRequest(needsLayout, "bluesky")),
    /needs human layout/,
  );

  const ordinary = prepare();
  assert.throws(
    () => createAdapterPreview(ordinary, previewRequest(ordinary, "unknown")),
    /supported/,
  );
  const singleInput = fixture();
  singleInput.channel_selection = ["bluesky"];
  const single = prepare(singleInput);
  assert.throws(
    () => createAdapterPreview(single, previewRequest(single, "instagram")),
    /exactly one/,
  );

  const stale = prepare();
  const staleRequest = previewRequest(stale, "bluesky");
  staleRequest.expected_draft_digest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => createAdapterPreview(stale, staleRequest), /expected_draft_digest/);

  const preview = createAdapterPreview(ordinary, previewRequest(ordinary, "bluesky"));
  const expectedDigest = preview.integrity.preview_digest;
  preview.guidance.official_information[0] = "https://attacker.example/phish";
  assert.throws(
    () => verifyAdapterPreview(preview, {
      bundle: ordinary,
      request: previewRequest(ordinary, "bluesky"),
      expected_preview_digest: expectedDigest,
    }),
    /preview_digest/,
  );

  const request = previewRequest(ordinary, "bluesky");
  const recomputed = createAdapterPreview(ordinary, request);
  recomputed.format = "different but still a string";
  recomputed.guidance.official_information[0] = "https://attacker.example/phish";
  const { preview_digest: ignoredDigest, ...integrityWithoutDigest } = recomputed.integrity;
  recomputed.integrity.preview_digest = digest({
    ...recomputed,
    integrity: integrityWithoutDigest,
  });
  assert.throws(
    () => verifyAdapterPreview(recomputed, {
      bundle: ordinary,
      request,
      expected_preview_digest: recomputed.integrity.preview_digest,
    }),
    /preview must match its canonical prepared projection/,
  );

  const oversizedPreview = createAdapterPreview(ordinary, request);
  oversizedPreview.format = "x".repeat(ARTIFACT_BOUNDS.max_adapter_preview_bytes);
  assert.throws(
    () => verifyAdapterPreview(oversizedPreview, {
      bundle: ordinary,
      request,
      expected_preview_digest: oversizedPreview.integrity.preview_digest,
    }),
    /adapter preview exceeds/,
  );

  const oversizedBundle = prepare();
  oversizedBundle.padding = "x".repeat(ARTIFACT_BOUNDS.max_bundle_bytes);
  assert.throws(
    () => createAdapterPreview(oversizedBundle, previewRequest(oversizedBundle, "bluesky")),
    /prepared bundle exceeds/,
  );
});

test("prepared HTML names media without automatically loading it", () => {
  const input = fixture();
  input.channel_selection = ["instagram"];
  input.media = [{
    url: "https://example.org/evidence/rhetorlint-visible-words/card.png",
    creator: "Cambridge TCG",
    rights_basis: "CC BY 4.0 supplied declaration",
    alt: "A proof sheet about visible wording",
    synthetic: false,
    synthetic_disclosure: null,
  }];
  const html = renderPublicPage(prepare(input));

  assert.ok(html.includes("Declared media, not loaded automatically"));
  assert.ok(html.includes("A proof sheet about visible wording"));
  assert.ok(html.includes(input.media[0].url));
  assert.doesNotMatch(html, /<(?:img|iframe|audio|video|source)\b/i);
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link[^>]+rel=["'](?:stylesheet|prefetch|preload)/i);
});

test("the readable review shows exact numbered draft parts and layout counts", () => {
  const input = fixture();
  input.channel_selection = ["bluesky"];
  input.claim = (
    "Evidence stays attached to the exact public claim while uncertainty and correction remain visible. "
  ).repeat(8).trim();
  const bundle = prepare(input);
  const draft = bundle.drafts[0];
  const review = renderReviewMarkdown(bundle);

  assert.ok(draft.parts.length > 1);
  draft.parts.forEach((part, index) => {
    const heading = `### Part ${index + 1}/${draft.parts.length} · ${Array.from(part).length} code points`;
    const start = review.indexOf(heading);
    const end = index + 1 < draft.parts.length
      ? review.indexOf(`### Part ${index + 2}/${draft.parts.length}`, start)
      : review.indexOf("Intended audience:", start);
    assert.ok(start >= 0, `${heading} is present`);
    assert.ok(review.slice(start, end).includes(part), `part ${index + 1} is under its heading`);
  });
  assert.equal((review.match(/^### Part /gm) ?? []).length, draft.parts.length);
  assert.ok(review.includes(`Layout: **${draft.layout.status}**`));
});

test("the builder CLI completes start, check, prepare, and preview without mutation", () => {
  const root = mkdtempSync(join(tmpdir(), "truth-release-builder-"));
  const project = join(root, "my-release");
  const prepared = join(project, "prepared");
  try {
    const started = run(["start", project]);
    assert.equal(started.status, 0, started.stderr);
    assert.equal(JSON.parse(started.stdout).network_effects, 0);
    assert.equal(JSON.parse(started.stdout).persistent_files_created, 2);
    assert.equal(JSON.parse(started.stdout).directory_created, true);
    assert.equal(statSync(project).mode & 0o777, 0o700);
    for (const name of ["claim.json", "START-HERE.md"]) {
      assert.equal(statSync(join(project, name)).mode & 0o777, 0o600);
    }
    const beforeRepeat = snapshot(project);
    const repeated = run(["start", project]);
    assert.equal(repeated.status, 2);
    assert.match(JSON.parse(repeated.stderr).message, /already exists/);
    assert.deepEqual(snapshot(project), beforeRepeat);

    const checked = run(["check", join(project, "claim.json")]);
    assert.equal(checked.status, 0, checked.stderr);
    const check = JSON.parse(checked.stdout);
    assert.equal(check.status, "valid-for-preparation");
    assert.equal(check.factual_truth_checked, false);
    assert.equal(check.network_effects, 0);
    assert.equal(check.persistent_files_created, 0);
    assert.equal(check.directory_created, false);
    assert.match(check.checked_at, /^\d{4}-\d{2}-\d{2}T/);

    const built = run(["prepare", join(project, "claim.json"), "--out", prepared]);
    assert.equal(built.status, 0, built.stderr);
    assert.equal(JSON.parse(built.stdout).network_effects, 0);
    assert.equal(JSON.parse(built.stdout).persistent_files_created, 4);
    assert.equal(JSON.parse(built.stdout).directory_created, true);
    assert.equal(statSync(prepared).mode & 0o777, 0o700);
    for (const name of ["release.json", "review.json", "page.html", "REVIEW.md"]) {
      assert.equal(statSync(join(prepared, name)).mode & 0o777, 0o600);
    }

    const beforePreview = snapshot(prepared);
    const previewed = run(["preview", prepared, "--channel", "bluesky"]);
    assert.equal(previewed.status, 0, previewed.stderr);
    const preview = JSON.parse(previewed.stdout);
    assert.deepEqual(validate(preview, PREVIEW_SCHEMA), []);
    assert.equal(preview.dispatch.external_effects, 0);
    assert.deepEqual(snapshot(prepared), beforePreview);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check failures are structured and prepared symlinks fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "truth-release-errors-"));
  try {
    const invalidPath = join(root, "invalid.json");
    const invalid = fixture();
    delete invalid.claim;
    writeFileSync(invalidPath, `${JSON.stringify(invalid)}\n`);
    const checked = run(["check", invalidPath]);
    assert.equal(checked.status, 2);
    const report = JSON.parse(checked.stderr);
    assert.equal(report.status, "invalid");
    assert.ok(report.structural_issues.some((issue) => issue.path === "$"));
    assert.equal(report.network_effects, 0);
    assert.equal(report.persistent_files_created, 0);
    assert.equal(report.directory_created, false);
    assert.match(report.checked_at, /^\d{4}-\d{2}-\d{2}T/);

    const missing = run(["check", join(root, "missing.json")]);
    assert.equal(missing.status, 2);
    const missingReport = JSON.parse(missing.stderr);
    assert.match(missingReport.message, /was not found/);
    assert.doesNotMatch(missingReport.message, /ENOENT|lstat/);

    const project = join(root, "project");
    const prepared = join(project, "prepared");
    assert.equal(run(["start", project]).status, 0);
    assert.equal(run(["prepare", join(project, "claim.json"), "--out", prepared]).status, 0);
    writeFileSync(join(prepared, "page.html"), "tampered local page\n");
    const tampered = run(["preview", prepared, "--channel", "bluesky"]);
    assert.equal(tampered.status, 2);
    assert.match(JSON.parse(tampered.stderr).message, /page\.html does not match/);

    const linked = join(root, "linked-prepared");
    symlinkSync(prepared, linked);
    const previewed = run(["preview", linked, "--channel", "bluesky"]);
    assert.equal(previewed.status, 2);
    assert.match(JSON.parse(previewed.stderr).message, /non-symlink directory/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the builder grammar and package scripts expose one bounded entry door", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0);
  for (const command of ["start", "check", "prepare", "preview"]) {
    assert.match(help.stdout, new RegExp(`builder\\.mjs ${command}`));
  }
  assert.match(help.stdout, /No command fetches, posts, schedules/);

  for (const args of [
    [],
    ["start", "--surprise"],
    ["prepare", FIXTURE_URL.pathname, "--out"],
    ["preview", "/tmp/nope", "--channel", "bluesky", "extra"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2, `${args.join(" ")} must fail`);
    assert.match(result.stderr, /Usage:/);
  }

  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJson.scripts["truth-release"], "node examples/truth-release/builder.mjs");
  assert.equal(
    packageJson.scripts["test:truth-release"],
    "node --test examples/truth-release/prepare.test.mjs examples/truth-release/builder.test.mjs",
  );
});

test("the example-local import door exports only the documented pure surface", async () => {
  const builder = await import("./builder.mjs");
  assert.deepEqual(Object.keys(builder).sort(), [
    "ARTIFACT_BOUNDS",
    "BOUNDS",
    "SCHEMAS",
    "createAdapterPreview",
    "prepareTruthRelease",
    "validateReleaseInput",
    "verifyAdapterPreview",
  ]);
});

test("the builder implementation contains no transport, timer, browser, or child-process adapter", () => {
  const source = readFileSync(new URL("./builder.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bhttps?\.request\s*\(/);
  assert.doesNotMatch(source, /\bsetInterval\s*\(/);
  assert.doesNotMatch(source, /from\s+["']node:child_process["']/);
  assert.doesNotMatch(source, /\bspawn(?:Sync)?\s*\(/);
  assert.doesNotMatch(source, /\bexec(?:File|Sync)?\s*\(/);
});
