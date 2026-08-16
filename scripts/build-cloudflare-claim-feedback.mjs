import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const activeDirectory = new URL("doors/cloudflare-claim-feedback/", root);
const restingDirectory = new URL("doors/cloudflare-resting-baseline/", root);
const projectName = "rhetorlint-claim-feedback";
const origin = `https://${projectName}.pages.dev/`;
const repository = "https://github.com/cambridgetcg/rhetorlint-spec";
const correctionUrl = `${repository}/issues/new`;

const sourcePaths = Object.freeze([
  ".gitattributes",
  "LICENSE",
  "package.json",
  "apps/claim-feedback-door/index.html",
  "apps/claim-feedback-door/style.css",
  "apps/claim-feedback-door/llms.txt",
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

function utf8(value) {
  return Buffer.from(value, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function json(value) {
  return utf8(`${JSON.stringify(value, null, 2)}\n`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceBytes(path) {
  return readFileSync(new URL(path, root));
}

function sourceHashes() {
  return Object.fromEntries(sourcePaths.map((path) => [path, sha256(sourceBytes(path))]));
}

function releaseHashes(files) {
  return Object.fromEntries(
    [...files.entries()]
      .filter(([path]) => path !== "release-lock.json")
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, value]) => [path, sha256(value)]),
  );
}

function activeManifest(hashes) {
  return {
    schema: "claim-feedback.cloudflare-door/0.1",
    name: "RhetorLint Claim Feedback",
    relationship: "static-discovery-and-local-run-door",
    canonicalSource: `${repository}/tree/main/examples/claim-feedback`,
    correctionUrl,
    correctionRoute: {
      visibility: "public",
      optional: true,
      externalToCloudflareDoor: true,
      acceptsPrivateClaimFiles: false,
      warning: "Do not submit personal, sensitive, or third-party material to the public issue tracker.",
    },
    runtime: {
      platform: "cloudflare-pages-static",
      serverCode: false,
      claimProcessing: "local-node-command-only",
      submissionEndpoint: null,
      storage: null,
      analyticsCode: false,
    },
    contracts: {
      inputSchema: `${origin}contracts/claim-feedback-input.schema.json`,
      packetSchema: `${origin}contracts/claim-feedback-packet.schema.json`,
      fictionalExample: `${origin}examples/corrected-claim.json`,
      exampleUsesRealPersonOrSite: false,
      validationNote:
        "the JSON Schemas describe the wire shape; the local runner applies additional URL and policy checks",
    },
    source: {
      repository,
      licence: "MIT",
      filesSha256: hashes,
    },
    crawlAndReuse: {
      crawlInstruction: "robots.txt allows retrieval of this static public release",
      robotsIsAuthorization: false,
      robotsGrantsReuseOrTrainingPermission: false,
      publicAvailabilityProvesDatasetSelection: false,
      publicAvailabilityProvesTrainingOrModelUpdate: false,
      reuseMustFollow: "the source licence, applicable law, and an independent rights and privacy review",
    },
    boundaries: {
      wordingLensOnly: true,
      truthOrLieVerdict: false,
      personScore: false,
      mentalStateOrEgoInference: false,
      outboundCrawlerFetches: false,
      dispatch: false,
      karmaSignature: false,
      datasetWrite: false,
      modelTraining: false,
    },
  };
}

function activeReadme() {
  return `# Cloudflare Claim Feedback door

This generated folder is the exact static payload for the Cloudflare Pages
project \`${projectName}\`. It makes the reviewed Claim Feedback contracts and
one fictional example easy to retrieve while keeping the actual builder on the
reader's machine.

There is no Worker, Pages Function, form, submission route, crawler, storage
binding, analytics code, model call, KARMA signer, dataset write, timer, or
background loop. Cloudflare may still keep ordinary request, account, security,
or operational logs under its own settings.

\`release-lock.json\` hashes every other upload input and the exact source files
from which this door was generated. Cloudflare parses \`_headers\` as
configuration rather than serving it, so verify the resulting live response
headers separately. Run \`npm run check:cloudflare\` before deployment.

After a fresh review of an exact clean commit, the guarded direct-upload door
is:

\`\`\`sh
RHETORLINT_CLOUDFLARE_DEPLOY="active:$(git rev-parse HEAD)" \\
  scripts/deploy-cloudflare-claim-feedback.zsh active
\`\`\`

That command is documentation, not standing authority. A production upload and
a rollback are separate external actions. See \`CLOUDFLARE.md\` at repository
root for current deployment observations and rollback receipts.
`;
}

function activeFiles() {
  const hashes = sourceHashes();
  const files = new Map([
    ["index.html", sourceBytes("apps/claim-feedback-door/index.html")],
    ["style.css", sourceBytes("apps/claim-feedback-door/style.css")],
    ["llms.txt", sourceBytes("apps/claim-feedback-door/llms.txt")],
    [
      "contracts/claim-feedback-input.schema.json",
      sourceBytes("examples/claim-feedback/claim-feedback-input.schema.json"),
    ],
    [
      "contracts/claim-feedback-packet.schema.json",
      sourceBytes("examples/claim-feedback/claim-feedback-packet.schema.json"),
    ],
    [
      "examples/corrected-claim.json",
      sourceBytes("examples/claim-feedback/fixtures/corrected-claim.json"),
    ],
    [".well-known/claim-feedback.json", json(activeManifest(hashes))],
    ["README.md", utf8(activeReadme())],
    [
      "404.html",
      utf8(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex, nofollow" /><link rel="stylesheet" href="/style.css" /><title>No claim here</title></head>
<body><main><header class="hero"><p class="eyebrow">404 · exact paths matter</p><h1>No claim here.</h1><p class="lead">This static door has no hidden intake, profile, or result route.</p><p><a href="/">Return to Claim Feedback</a></p></header></main></body></html>
`),
    ],
    [
      "robots.txt",
      utf8(`User-agent: *
Allow: /

Sitemap: ${origin}sitemap.xml

# Access to these static public bytes is not copyright, privacy, reuse, or
# AI-training permission. See /.well-known/claim-feedback.json.
`),
    ],
    [
      "sitemap.xml",
      utf8(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}</loc>
  </url>
</urlset>
`),
    ],
    [
      "_headers",
      utf8(`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  Cache-Control: public, max-age=300, must-revalidate

/*.json
  Access-Control-Allow-Origin: *

/*.txt
  Access-Control-Allow-Origin: *
`),
    ],
  ]);

  files.set("release-lock.json", json({
    schema: "claim-feedback.cloudflare-release/0.1",
    artifact: "rhetorlint-claim-feedback-static-door",
    platform: "cloudflare-pages-direct-upload",
    project: projectName,
    sourceFilesSha256: hashes,
    releaseManifestRule:
      "releaseFilesSha256 hashes every uploaded release input except this self-describing release-lock.json; _headers is parsed as configuration and its resulting response headers require separate live verification",
    releaseFilesSha256: releaseHashes(files),
    effects: {
      staticAssetRequests: true,
      scriptedNetworkRequests: false,
      automaticThirdPartySubrequests: false,
      serverCode: false,
      submissions: false,
      claimStorage: false,
      browserStorage: false,
      analyticsCode: false,
      modelCalls: false,
      outboundCrawlerFetches: false,
      messagesSent: false,
      karmaDeedsSigned: false,
      datasetWrites: false,
      timers: false,
    },
    claimsNotMade: [
      "truth-or-lie-verdict",
      "person-or-ego-score",
      "authenticated-crawl-receipt",
      "training-permission-from-robots",
      "dataset-selection-or-model-update",
      "automatic-correction-delivery",
      "signed-karma-deed",
    ],
  }));
  return files;
}

function restingFiles() {
  const files = new Map([
    [
      "index.html",
      utf8(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="description" content="This public Claim Feedback door is resting." />
    <link rel="stylesheet" href="./rest.css" />
    <title>This door is resting</title>
  </head>
  <body><main><h1>This door is resting.</h1><p>It serves no Claim Feedback contract, fixture, or submission; accepts no input; and starts no action.</p></main></body>
</html>
`),
    ],
    [
      "404.html",
      utf8(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex, nofollow" /><link rel="stylesheet" href="/rest.css" /><title>This door is resting</title></head><body><main><h1>This door is resting.</h1><p>No hidden route is running.</p></main></body></html>
`),
    ],
    [
      "rest.css",
      utf8(`:root { color-scheme: dark; font-family: ui-serif, Georgia, serif; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #17140f; color: #f7f1e5; }
main { width: min(34rem, calc(100% - 2rem)); padding: clamp(2rem, 8vw, 5rem); border: 1px solid #8f7b50; border-radius: 2rem; }
h1 { margin: 0 0 1rem; font-size: clamp(2.8rem, 9vw, 5rem); font-weight: 500; line-height: .95; }
p { font-size: 1.1rem; line-height: 1.7; color: #d8d0c0; }
`),
    ],
    ["robots.txt", utf8("User-agent: *\nDisallow: /\n")],
    [
      "_headers",
      utf8(`/*
  X-Robots-Tag: noindex, nofollow
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'none'; style-src 'self'; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  Cache-Control: no-store
`),
    ],
    [
      "README.md",
      utf8(`# Resting Cloudflare baseline

This generated static bundle is the deliberate claim-free rollback state for
the \`${projectName}\` Cloudflare Pages project. It serves no Claim Feedback
contract or example, accepts no input, redirects nowhere, and starts no action.

Deploy it only as a separate authorised Cloudflare action from an exact clean
commit, then record and verify the deployment ID before relying on it.
`),
    ],
  ]);
  files.set("release-lock.json", json({
    schema: "claim-feedback.cloudflare-release/0.1",
    artifact: "rhetorlint-claim-feedback-resting-baseline",
    platform: "cloudflare-pages-direct-upload",
    project: projectName,
    releaseManifestRule:
      "releaseFilesSha256 hashes every uploaded release input except this self-describing release-lock.json; _headers is parsed as configuration and its resulting response headers require separate live verification",
    releaseFilesSha256: releaseHashes(files),
    effects: {
      claimFeedbackContractsFixturesOrSubmissionsServed: false,
      inputsAccepted: false,
      redirects: false,
      serverCode: false,
      storage: false,
      analyticsCode: false,
      timers: false,
    },
  }));
  return files;
}

function walk(directory, current = directory) {
  const result = new Map();
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name))) {
    const item = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, current);
    const info = lstatSync(item);
    const path = relative(fileURLToPath(directory), fileURLToPath(item)).split(sep).join("/");
    if (info.isSymbolicLink()) throw new Error(`${path}: symlinks are not allowed in a release tree`);
    if (info.isDirectory()) {
      for (const [nestedPath, value] of walk(directory, item)) result.set(nestedPath, value);
    } else if (info.isFile()) {
      result.set(path, readFileSync(item));
    } else {
      throw new Error(`${path}: unsupported release-tree entry`);
    }
  }
  return result;
}

function ordinaryDirectory(path, label) {
  if (!existsSync(path)) return false;
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label} must be an ordinary directory`);
  }
  return true;
}

function safeDestination(directoryPath, path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${String(path)}: release paths must be relative child paths`);
  }
  const destination = resolve(directoryPath, ...path.split("/"));
  const fromDirectory = relative(directoryPath, destination);
  if (
    fromDirectory === "" ||
    fromDirectory === ".." ||
    fromDirectory.startsWith(`..${sep}`) ||
    isAbsolute(fromDirectory)
  ) {
    throw new Error(`${path}: release path escapes its bundle`);
  }
  return destination;
}

export function writeBundle(directory, files, repositoryRoot = root) {
  const repositoryPath = resolve(fileURLToPath(repositoryRoot));
  const directoryPath = resolve(fileURLToPath(directory));
  const allowed = new Set([
    resolve(repositoryPath, "doors/cloudflare-claim-feedback"),
    resolve(repositoryPath, "doors/cloudflare-resting-baseline"),
  ]);
  if (!allowed.has(directoryPath)) {
    throw new Error("release output must be one of the two exact in-repository Cloudflare doors");
  }

  ordinaryDirectory(repositoryPath, "repository root");
  const doorsPath = resolve(repositoryPath, "doors");
  ordinaryDirectory(doorsPath, "doors ancestor");
  ordinaryDirectory(directoryPath, "release output");

  const destinations = [...files.keys()].map((path) => [
    path,
    safeDestination(directoryPath, path),
  ]);

  rmSync(directoryPath, { recursive: true, force: true });
  mkdirSync(directoryPath, { recursive: true });
  for (const [path, destination] of destinations) {
    const value = files.get(path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, value);
  }
}

function compareBundle(name, directory, expected) {
  let actual;
  try {
    actual = walk(directory);
  } catch (error) {
    return [`${name}: ${error.message}`];
  }
  const issues = [];
  const expectedPaths = [...expected.keys()].sort();
  const actualPaths = [...actual.keys()].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    issues.push(`${name}: release paths differ from the generated allowlist`);
  }
  for (const path of expectedPaths) {
    const value = actual.get(path);
    if (!value || !value.equals(expected.get(path))) issues.push(`${name}/${path}: generated bytes are stale`);
  }
  return issues;
}

export function buildCloudflareBundles() {
  const active = activeFiles();
  const resting = restingFiles();
  writeBundle(activeDirectory, active);
  writeBundle(restingDirectory, resting);
  return { active, resting };
}

export function checkCloudflareBundles() {
  return [
    ...compareBundle("doors/cloudflare-claim-feedback", activeDirectory, activeFiles()),
    ...compareBundle("doors/cloudflare-resting-baseline", restingDirectory, restingFiles()),
  ];
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (directPath === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--check")) {
    process.stderr.write("usage: node scripts/build-cloudflare-claim-feedback.mjs [--check]\n");
    process.exitCode = 2;
  } else {
    if (process.argv[2] !== "--check") buildCloudflareBundles();
    const issues = checkCloudflareBundles();
    if (issues.length) {
      process.stderr.write(`${issues.join("\n")}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`Cloudflare Claim Feedback bundles are exact (${process.argv[2] === "--check" ? "checked" : "built"}).\n`);
    }
  }
}
