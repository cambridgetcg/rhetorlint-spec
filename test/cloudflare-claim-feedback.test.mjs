import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  checkCloudflareBundles,
  writeBundle,
} from "../scripts/build-cloudflare-claim-feedback.mjs";

const ROOT = new URL("../", import.meta.url);
const ACTIVE = new URL("doors/cloudflare-claim-feedback/", ROOT);
const RESTING = new URL("doors/cloudflare-resting-baseline/", ROOT);

const ACTIVE_PATHS = Object.freeze([
  ".well-known/claim-feedback.json",
  "404.html",
  "README.md",
  "_headers",
  "contracts/claim-feedback-input.schema.json",
  "contracts/claim-feedback-packet.schema.json",
  "examples/corrected-claim.json",
  "index.html",
  "llms.txt",
  "release-lock.json",
  "robots.txt",
  "sitemap.xml",
  "style.css",
]);

const RESTING_PATHS = Object.freeze([
  "404.html",
  "README.md",
  "_headers",
  "index.html",
  "release-lock.json",
  "rest.css",
  "robots.txt",
]);

const SOURCE_PATHS = Object.freeze([
  ".gitattributes",
  "LICENSE",
  "package.json",
  "apps/claim-feedback-door/index.html",
  "apps/claim-feedback-door/llms.txt",
  "apps/claim-feedback-door/style.css",
  "examples/claim-feedback/README.md",
  "examples/claim-feedback/claim-feedback-input.schema.json",
  "examples/claim-feedback/claim-feedback-packet.schema.json",
  "examples/claim-feedback/claim-feedback.mjs",
  "examples/claim-feedback/fixtures/corrected-claim.json",
  "packages/core/index.mjs",
  "packages/core/package.json",
  "packages/core/signals.mjs",
  "packages/rules-en/rules.json",
  "scripts/build-cloudflare-claim-feedback.mjs",
  "scripts/deploy-cloudflare-claim-feedback.zsh",
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function walk(directory, current = directory) {
  const files = new Map();
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name))) {
    const item = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, current);
    const info = lstatSync(item);
    const path = relative(fileURLToPath(directory), fileURLToPath(item)).split(sep).join("/");
    assert.equal(info.isSymbolicLink(), false, `${path}: release entries cannot be symlinks`);
    if (info.isDirectory()) {
      for (const [nested, value] of walk(directory, item)) files.set(nested, value);
    } else {
      assert.equal(info.isFile(), true, `${path}: release entries must be ordinary files`);
      files.set(path, readFileSync(item));
    }
  }
  return files;
}

function parseHeaderRules(source) {
  const rules = [];
  let current = null;
  for (const line of source.split("\n")) {
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const match = line.match(/^\s+([^:]+):\s*(.*)$/);
    assert.ok(match && current, `invalid _headers line: ${line}`);
    current.headers.push({ name: match[1].toLowerCase(), value: match[2] });
  }
  return rules;
}

function headerPatternMatches(pattern, path) {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(path);
}

function assertNoOverlappingGuardHeaders(source, paths) {
  const protectedNames = new Set([
    "cache-control",
    "content-security-policy",
    "cross-origin-opener-policy",
    "permissions-policy",
    "referrer-policy",
    "x-content-type-options",
    "x-robots-tag",
  ]);
  const rules = parseHeaderRules(source);
  for (const path of paths) {
    const seen = new Set();
    for (const rule of rules.filter((item) => headerPatternMatches(item.pattern, path))) {
      for (const header of rule.headers) {
        if (!protectedNames.has(header.name)) continue;
        assert.equal(seen.has(header.name), false, `${path}: duplicate ${header.name}`);
        seen.add(header.name);
      }
    }
    assert.ok(seen.has("cache-control"), `${path}: missing cache-control`);
    assert.ok(seen.has("content-security-policy"), `${path}: missing content-security-policy`);
  }
}

function text(directory, path) {
  return readFileSync(new URL(path, directory), "utf8");
}

function json(directory, path) {
  return JSON.parse(text(directory, path));
}

function assertLocked(directory, expectedPaths) {
  const files = walk(directory);
  assert.deepEqual([...files.keys()].sort(), [...expectedPaths].sort());
  const lock = JSON.parse(files.get("release-lock.json").toString("utf8"));
  const actual = Object.fromEntries(
    [...files.entries()]
      .filter(([path]) => path !== "release-lock.json")
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, value]) => [path, sha256(value)]),
  );
  assert.deepEqual(lock.releaseFilesSha256, actual);
  assert.match(lock.schema, /^claim-feedback\.cloudflare-release\/0\.1$/);
  return { files, lock };
}

test("the generated Cloudflare trees exactly match their reviewed sources", () => {
  assert.deepEqual(checkCloudflareBundles(), []);
  const active = assertLocked(ACTIVE, ACTIVE_PATHS);
  const resting = assertLocked(RESTING, RESTING_PATHS);

  assert.deepEqual(Object.keys(active.lock.sourceFilesSha256).sort(), [...SOURCE_PATHS].sort());
  for (const [path, digest] of Object.entries(active.lock.sourceFilesSha256)) {
    assert.equal(sha256(readFileSync(new URL(path, ROOT))), digest, path);
  }
  assert.equal(active.lock.artifact, "rhetorlint-claim-feedback-static-door");
  assert.equal(resting.lock.artifact, "rhetorlint-claim-feedback-resting-baseline");
  assert.match(active.lock.releaseManifestRule, /every uploaded release input/);
  assert.match(active.lock.releaseManifestRule, /_headers is parsed as configuration/);
});

test("the active door is static, local-run only, and has no intake surface", () => {
  const html = text(ACTIVE, "index.html");
  const headers = text(ACTIVE, "_headers");
  const lock = json(ACTIVE, "release-lock.json");

  assert.match(html, /Words can come back/);
  assert.match(html, /Run the actual builder locally/);
  assert.match(html, /cannot receive, fetch, store, send,\s+score, sign, or train/i);
  assert.match(html, /Cloudflare.*ordinary request,\s+security, or account logs/is);
  assert.match(html, /RhetorLint mark is a wording prompt, not a truth or lie verdict/);
  for (const path of ACTIVE_PATHS.filter((path) => path.endsWith(".html"))) {
    const source = text(ACTIVE, path);
    assert.doesNotMatch(source, /<script\b|<form\b|<input\b|<textarea\b|contenteditable|<iframe\b/i, path);
    assert.doesNotMatch(source, /onclick=|onload=|onerror=/i, path);
  }
  for (const path of ACTIVE_PATHS.filter((path) => path.endsWith(".css"))) {
    assert.doesNotMatch(text(ACTIVE, path), /@import\b|url\s*\(/i, path);
  }

  assert.match(headers, /script-src 'none'/);
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /form-action 'none'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /browsing-topics=\(\)/);
  assert.match(headers, /Access-Control-Allow-Origin: \*/);
  assertNoOverlappingGuardHeaders(headers, [
    "/index.html",
    "/404.html",
    "/style.css",
    "/llms.txt",
    "/.well-known/claim-feedback.json",
    "/contracts/claim-feedback-input.schema.json",
  ]);

  assert.equal(lock.effects.staticAssetRequests, true);
  for (const [effect, value] of Object.entries(lock.effects).filter(([effect]) => effect !== "staticAssetRequests")) {
    assert.equal(value, false, effect);
  }
  assert.ok(lock.claimsNotMade.includes("truth-or-lie-verdict"));
  assert.ok(lock.claimsNotMade.includes("person-or-ego-score"));
  assert.ok(lock.claimsNotMade.includes("dataset-selection-or-model-update"));
});

test("the machine door separates crawl access, rights, training, and correction", () => {
  const manifest = json(ACTIVE, ".well-known/claim-feedback.json");
  const robots = text(ACTIVE, "robots.txt");
  const llms = text(ACTIVE, "llms.txt");

  assert.equal(manifest.schema, "claim-feedback.cloudflare-door/0.1");
  assert.equal(manifest.runtime.serverCode, false);
  assert.equal(manifest.runtime.submissionEndpoint, null);
  assert.equal(manifest.runtime.storage, null);
  assert.equal(manifest.contracts.validationNote.includes("additional URL and policy checks"), true);
  assert.equal(manifest.crawlAndReuse.robotsIsAuthorization, false);
  assert.equal(manifest.crawlAndReuse.robotsGrantsReuseOrTrainingPermission, false);
  assert.equal(manifest.crawlAndReuse.publicAvailabilityProvesDatasetSelection, false);
  assert.equal(manifest.crawlAndReuse.publicAvailabilityProvesTrainingOrModelUpdate, false);
  assert.equal(manifest.boundaries.personScore, false);
  assert.equal(manifest.boundaries.mentalStateOrEgoInference, false);
  assert.equal(manifest.boundaries.outboundCrawlerFetches, false);
  assert.equal(manifest.correctionUrl, "https://github.com/cambridgetcg/rhetorlint-spec/issues/new");
  assert.deepEqual(manifest.correctionRoute, {
    visibility: "public",
    optional: true,
    externalToCloudflareDoor: true,
    acceptsPrivateClaimFiles: false,
    warning: "Do not submit personal, sensitive, or third-party material to the public issue tracker.",
  });
  assert.match(robots, /^User-agent: \*\nAllow: \//);
  assert.match(robots, /not copyright, privacy, reuse, or\s+# AI-training permission/);
  assert.match(llms, /Robots access is not copyright, privacy, reuse, or AI\s+training permission/);
  assert.match(llms, /no submission endpoint/i);
  assert.match(llms, /Correction visibility: public, optional, and external/);
  assert.match(text(ACTIVE, "index.html"), /Do not paste a private claim file or personal, sensitive, or\s+third-party material/);
});

test("only closed schemas and one reserved fictional example are mirrored", () => {
  const inputSchema = json(ACTIVE, "contracts/claim-feedback-input.schema.json");
  const packetSchema = json(ACTIVE, "contracts/claim-feedback-packet.schema.json");
  const fixtureText = text(ACTIVE, "examples/corrected-claim.json");
  const fixture = JSON.parse(fixtureText);

  assert.equal(inputSchema.additionalProperties, false);
  assert.equal(packetSchema.additionalProperties, false);
  assert.match(fixture.claim.url, /^https:\/\/example\.org\//);
  assert.match(fixtureText, /example\.org/);
  assert.doesNotMatch(fixtureText, /\/Users\/|file:\/\/|localhost|127\.0\.0\.1/i);
});

test("the resting baseline is claim-free, inert, and locked", () => {
  const html = text(RESTING, "index.html");
  const notFound = text(RESTING, "404.html");
  const headers = text(RESTING, "_headers");
  const robots = text(RESTING, "robots.txt");

  assert.match(html, /This door is resting/);
  assert.match(html, /serves no Claim Feedback contract, fixture, or submission/);
  assert.match(notFound, /No hidden route is running/);
  assert.doesNotMatch(`${html}\n${notFound}`, /<script\b|<form\b|<input\b|<textarea\b|http-equiv="refresh"/i);
  assert.match(headers, /script-src 'none'/);
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /Cache-Control: no-store/);
  assertNoOverlappingGuardHeaders(headers, ["/index.html", "/404.html", "/rest.css", "/robots.txt"]);
  assert.equal(robots, "User-agent: *\nDisallow: /\n");
  const lock = json(RESTING, "release-lock.json");
  assert.equal(lock.effects.claimFeedbackContractsFixturesOrSubmissionsServed, false);
});

test("the build refuses a symlinked doors ancestor before deleting anything", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "rhetorlint-cloudflare-build-test-"));
  try {
    const repositoryPath = join(temporaryRoot, "repo");
    const outsidePath = join(temporaryRoot, "outside");
    mkdirSync(repositoryPath);
    mkdirSync(outsidePath);
    const markerPath = join(outsidePath, "keep.txt");
    writeFileSync(markerPath, "keep\n");
    symlinkSync(outsidePath, join(repositoryPath, "doors"), "dir");

    const repositoryUrl = pathToFileURL(`${repositoryPath}${sep}`);
    const outputUrl = new URL("doors/cloudflare-claim-feedback/", repositoryUrl);
    assert.throws(
      () => writeBundle(outputUrl, new Map([["index.html", Buffer.from("safe\n")]]), repositoryUrl),
      /doors ancestor must be an ordinary directory/,
    );
    assert.equal(readFileSync(markerPath, "utf8"), "keep\n");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("the build rejects an escaping release path before replacing its target", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "rhetorlint-cloudflare-path-test-"));
  try {
    const repositoryPath = join(temporaryRoot, "repo");
    const doorsPath = join(repositoryPath, "doors");
    const outputPath = join(doorsPath, "cloudflare-claim-feedback");
    mkdirSync(outputPath, { recursive: true });
    const markerPath = join(outputPath, "keep.txt");
    writeFileSync(markerPath, "keep\n");

    const repositoryUrl = pathToFileURL(`${repositoryPath}${sep}`);
    const outputUrl = new URL("doors/cloudflare-claim-feedback/", repositoryUrl);
    assert.throws(
      () => writeBundle(outputUrl, new Map([["../escape.txt", Buffer.from("unsafe\n")]]), repositoryUrl),
      /release paths must be relative child paths/,
    );
    assert.equal(readFileSync(markerPath, "utf8"), "keep\n");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("the deployment door is executable, exact-commit, snapshotted, and non-interactive", () => {
  const path = new URL("scripts/deploy-cloudflare-claim-feedback.zsh", ROOT);
  const source = readFileSync(path, "utf8");
  assert.notEqual(statSync(path).mode & 0o111, 0);
  assert.match(source, /git fetch --quiet origin main <\/dev\/null/);
  assert.match(source, /refs\/remotes\/origin\/main/);
  assert.match(source, /api\.cloudflare\.com\/client\/v4\/accounts/);
  assert.match(source, /project\.production_branch !== "main"/);
  assert.match(source, /project\.source != null/);
  assert.match(source, /project\.uses_functions === true/);
  assert.match(source, /web_analytics_\(\?:tag\|token\)/);
  assert.match(source, /Cloudflare Web Analytics must be disabled/);
  assert.match(source, /git .*archive --format=tar "\$commit"/);
  assert.match(source, /pages deploy "\$snapshot_dir"/);
  assert.match(source, /WRANGLER_SEND_METRICS=false CI=1/);
  assert.match(source, /--commit-dirty=false <\/dev\/null/);
  assert.doesNotMatch(source, /pages deploy "\$release_dir"/);
});

test("deployable text contains no machine path or common credential shape", () => {
  const forbidden = [
    /\/Users\//,
    /file:\/\//i,
    /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/i,
    /\bgh[pousr]_[A-Za-z0-9_-]{20,}\b/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i,
  ];
  for (const directory of [ACTIVE, RESTING]) {
    for (const [path, value] of walk(directory)) {
      const source = value.toString("utf8");
      for (const pattern of forbidden) assert.doesNotMatch(source, pattern, path);
    }
  }
});
