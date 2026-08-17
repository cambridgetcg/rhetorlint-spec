import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { webcrypto } from "node:crypto";

import { analyze } from "../packages/core/index.mjs";
import { toSignal } from "../packages/core/signals.mjs";
import {
  createClaimFeedbackProjection,
} from "../examples/claim-feedback/claim-feedback-projection.mjs";
import {
  buildClaimFeedback,
  sha256 as nodeSha256,
  stableJson,
} from "../examples/claim-feedback/claim-feedback.mjs";
import {
  createBrowserSha256,
  decodeBoundedJson,
  MAX_INPUT_BYTES,
} from "../apps/claim-feedback-door/claim-feedback-browser.mjs";
import RULES from "../doors/cloudflare-claim-feedback/runtime/rules.mjs";
import METHOD from "../doors/cloudflare-claim-feedback/runtime/method.mjs";

const ROOT = new URL("../", import.meta.url);
const FIXTURE = JSON.parse(readFileSync(
  new URL("examples/claim-feedback/fixtures/corrected-claim.json", ROOT),
  "utf8",
));
const clone = (value) => JSON.parse(JSON.stringify(value));
const browserSha256 = createBrowserSha256(webcrypto.subtle);
const browserProjection = createClaimFeedbackProjection({
  analyze,
  toSignal,
  rules: RULES,
  method: METHOD,
  sha256: browserSha256,
});

function rebindClaim(input, claimText, language = "en") {
  input.claim.text = claimText;
  input.claim.language = language;
  input.crawl.body_utf8 = `<main><p>${claimText}</p></main>`;
  input.crawl.claim_sha256 = nodeSha256(claimText);
  input.crawl.body_sha256 = nodeSha256(input.crawl.body_utf8);
  input.claim.sources[0].content_sha256 = input.crawl.body_sha256;
  input.reuse.applies_to_sha256 = [
    input.crawl.claim_sha256,
    input.crawl.body_sha256,
    ...input.challenge.evidence.map((item) => item.body_sha256),
    nodeSha256(input.response.replacement_claim),
  ];
}

function branchInputs() {
  const variants = [["correction", clone(FIXTURE)]];
  const unanswered = clone(FIXTURE);
  unanswered.response = null;
  variants.push(["challenge-open", unanswered]);

  const unchecked = clone(FIXTURE);
  unchecked.crawl.access.robots = {
    decision: "not-checked",
    url: null,
    observed_at: null,
    content_sha256: null,
  };
  unchecked.reuse.license_url = null;
  unchecked.reuse.policy_url = null;
  variants.push(["robots-unchecked", unchecked]);

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

  const scheduled = clone(FIXTURE);
  scheduled.reuse.withdrawn_at = "2026-08-16T11:00:00.000Z";
  variants.push(["withdrawal-scheduled", scheduled]);

  const dense = clone(FIXTURE);
  rebindClaim(dense, "Experts say this always works. ".repeat(220).trim());
  variants.push(["dense-bounded-text", dense]);
  return variants;
}

test("Node and browser SHA-256 agree on exact UTF-8 bytes", async () => {
  for (const value of ["", "plain ASCII", "意義 😏", "x".repeat(MAX_INPUT_BYTES)]) {
    assert.equal(await browserSha256(value), nodeSha256(value));
  }
  await assert.rejects(() => browserSha256("broken\ud800"), /unpaired/);
});

test("the browser byte door enforces its fixed ceiling before decode and parse", () => {
  const base = '{"ok":true}';
  const exact = base.padEnd(MAX_INPUT_BYTES, " ");
  assert.deepEqual(decodeBoundedJson(exact), { ok: true });
  assert.throws(
    () => decodeBoundedJson(`${exact} `),
    new RegExp(`exceeds ${MAX_INPUT_BYTES}`),
  );
  assert.throws(() => decodeBoundedJson(new Uint8Array([0xc3, 0x28])), /encoded data|encoding/i);
  assert.throws(() => decodeBoundedJson("{"), /JSON/);
  assert.throws(() => decodeBoundedJson("\ud800"), /unpaired/);
  assert.throws(() => decodeBoundedJson({}), /pasted text|selected byte snapshot/);
});

test("the generated browser method hashes the exact shared sources", () => {
  assert.equal(METHOD.engine.source_sha256, nodeSha256(readFileSync(new URL("packages/core/index.mjs", ROOT))));
  assert.equal(METHOD.signal_projection.source_sha256, nodeSha256(readFileSync(new URL("packages/core/signals.mjs", ROOT))));
  assert.equal(METHOD.rules.source_sha256, nodeSha256(readFileSync(new URL("packages/rules-en/rules.json", ROOT))));
  assert.equal(
    METHOD.packet_projection.source_sha256,
    nodeSha256(readFileSync(new URL("examples/claim-feedback/claim-feedback-projection.mjs", ROOT))),
  );
  assert.deepEqual(
    readFileSync(new URL("doors/cloudflare-claim-feedback/runtime/claim-feedback-projection.mjs", ROOT)),
    readFileSync(new URL("examples/claim-feedback/claim-feedback-projection.mjs", ROOT)),
  );
});

test("Node and browser project every current semantic branch identically", async () => {
  for (const [name, input] of branchInputs()) {
    const before = JSON.stringify(input);
    const nodePacket = await buildClaimFeedback(input);
    const browserPacket = await browserProjection.buildClaimFeedback(input);
    assert.equal(stableJson(browserPacket), stableJson(nodePacket), name);
    assert.equal(browserPacket.integrity.packet_sha256, nodePacket.integrity.packet_sha256, name);
    assert.equal(JSON.stringify(input), before, `${name}: caller input changed`);
    assert.equal(await browserProjection.verifyClaimFeedbackPacket(browserPacket, input), true, name);
  }
});

test("the shared async projection snapshots inputs, rules, and provenance before yielding", async () => {
  const input = clone(FIXTURE);
  const originalChallenge = input.challenge.text;
  const rules = clone(RULES);
  const method = clone(METHOD);
  let calls = 0;
  const yieldingSha = async (value) => {
    calls += 1;
    if (calls === 1) {
      input.challenge.text = "Accessor-swapped meaning after validation.";
      rules.rules.length = 0;
      method.engine.name = "changed-after-construction";
      await Promise.resolve();
    }
    return nodeSha256(value);
  };
  const isolated = createClaimFeedbackProjection({
    analyze,
    toSignal,
    rules,
    method,
    sha256: yieldingSha,
  });
  const packet = await isolated.buildClaimFeedback(input);
  assert.equal(packet.challenge.text, originalChallenge);
  assert.equal(packet.wording_review.method.engine.name, METHOD.engine.name);
  assert.notEqual(input.challenge.text, packet.challenge.text);
  assert.equal(packet.wording_review.claim.status, "patterns-marked");
});

test("the deployed worksheet has a closed CSP and no network, storage, sharing, or active-content seam", () => {
  const html = readFileSync(new URL("doors/cloudflare-claim-feedback/index.html", ROOT), "utf8");
  const headers = readFileSync(new URL("doors/cloudflare-claim-feedback/_headers", ROOT), "utf8");
  const app = readFileSync(new URL("doors/cloudflare-claim-feedback/worksheet.mjs", ROOT), "utf8");
  const browser = readFileSync(new URL("doors/cloudflare-claim-feedback/claim-feedback-browser.mjs", ROOT), "utf8");
  const projection = readFileSync(new URL("doors/cloudflare-claim-feedback/runtime/claim-feedback-projection.mjs", ROOT), "utf8");
  const css = readFileSync(new URL("doors/cloudflare-claim-feedback/style.css", ROOT), "utf8");

  const cspLine = headers.split("\n").find((line) => line.trim().startsWith("Content-Security-Policy:"));
  assert.ok(cspLine, "response CSP is missing");
  const directives = new Map(cspLine.slice(cspLine.indexOf(":") + 1).trim().split(";").map((part) => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values];
  }));
  for (const name of [
    "connect-src", "media-src", "object-src", "frame-src", "worker-src",
    "frame-ancestors", "base-uri", "form-action",
  ]) assert.deepEqual(directives.get(name), ["'none'"], name);
  assert.deepEqual(directives.get("script-src"), ["'self'"]);
  assert.deepEqual(directives.get("style-src"), ["'self'"]);
  assert.doesNotMatch(cspLine, /unsafe-inline|unsafe-eval|\*|\bdata:|\bblob:|https?:/i);

  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /browser, operating\s+system, extensions, clipboard/is);
  assert.match(html, /autocomplete="off"/);
  assert.match(html, /spellcheck="false"/);
  assert.doesNotMatch(html, /prefetch|preconnect|<form\b|\bmultiple\b|webkitdirectory/i);
  for (const match of html.matchAll(/<a\b([^>]*href="https:[^"]+"[^>]*)>/g)) {
    assert.match(match[1], /rel="noreferrer noopener"/);
  }

  const executable = `${app}\n${browser}\n${projection}`;
  assert.doesNotMatch(executable, /\bfetch\s*\(|\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource|WebTransport)\b|\.sendBeacon\s*\(/);
  assert.doesNotMatch(executable, /\.(?:register|open)\s*\(|\b(?:localStorage|sessionStorage|indexedDB|BroadcastChannel)\s*[.([]/);
  assert.doesNotMatch(executable, /\.(?:clipboard|share|createObjectURL|open|postMessage)\s*\(/);
  assert.doesNotMatch(executable, /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/);
  assert.doesNotMatch(executable, /document\.cookie\s*=|\b(?:localStorage|sessionStorage)\s*\[/);
  assert.doesNotMatch(app, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(css, /@import\b|url\s*\(/i);
  assert.match(app, /textContent/);
  assert.match(app, /held-for-independent-review|training_candidate\.status/);
  assert.match(app, /unsigned-draft-only|karma_draft\.status/);
});
