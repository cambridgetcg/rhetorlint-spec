import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256 } from "../examples/claim-feedback/claim-feedback.mjs";

const ROOT = new URL("../", import.meta.url);
const RELEASE = new URL("doors/cloudflare-claim-feedback/", ROOT);
const FIXTURE = JSON.parse(readFileSync(
  new URL("examples/claim-feedback/fixtures/corrected-claim.json", ROOT),
  "utf8",
));
const clone = (value) => JSON.parse(JSON.stringify(value));

function chromePath() {
  const candidates = [
    process.env.RHETORLINT_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) ?? null;
}

function releaseFiles() {
  const lock = JSON.parse(readFileSync(new URL("release-lock.json", RELEASE), "utf8"));
  return new Set([...Object.keys(lock.releaseFilesSha256), "release-lock.json"]);
}

function parseHeaders() {
  const source = readFileSync(new URL("_headers", RELEASE), "utf8");
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
    if (!match || current === null) throw new Error(`invalid _headers line: ${line}`);
    current.headers.push([match[1], match[2]]);
  }
  return rules;
}

function patternMatches(pattern, path) {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(path);
}

function mime(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".xml")) return "application/xml; charset=utf-8";
  return "text/plain; charset=utf-8";
}

async function startReleaseServer(requests) {
  const files = releaseFiles();
  const rules = parseHeaders();
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const path = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    requests.push(`/${path}`);
    if (
      request.method !== "GET"
      || path.includes("\\")
      || path.split("/").some((part) => part === ".." || part === ".")
      || !files.has(path)
      || path === "_headers"
    ) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("not found\n");
      return;
    }
    for (const rule of rules.filter((item) => patternMatches(item.pattern, `/${path}`))) {
      for (const [name, value] of rule.headers) response.setHeader(name, value);
    }
    response.setHeader("Content-Type", mime(path));
    response.writeHead(200);
    response.end(readFileSync(new URL(path, RELEASE)));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

class CdpPipe {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.listeners = new Map();
    this.buffer = Buffer.alloc(0);
    child.stdio[4].on("data", (chunk) => this.read(chunk));
    child.once("exit", (code, signal) => {
      const error = new Error(`Chrome exited before CDP closed (${code ?? signal})`);
      for (const item of this.pending.values()) item.reject(error);
      this.pending.clear();
    });
  }

  read(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const end = this.buffer.indexOf(0);
      if (end < 0) return;
      const raw = this.buffer.subarray(0, end).toString("utf8");
      this.buffer = this.buffer.subarray(end + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      if (message.id) {
        const item = this.pending.get(message.id);
        if (!item) continue;
        this.pending.delete(message.id);
        clearTimeout(item.timeout);
        if (message.error) item.reject(new Error(`${message.error.message} (${message.error.code})`));
        else item.resolve(message.result ?? {});
      } else {
        this.events.push(message);
        for (const listener of this.listeners.get(message.method) ?? []) listener(message);
      }
    }
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdio[3].write(`${JSON.stringify(message)}\0`);
    });
  }
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function waitFor(cdp, sessionId, expression, label) {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(40);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function waitUntil(check, label) {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (check()) return;
    await delay(40);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function hostileFixture(origin) {
  const input = clone(FIXTURE);
  const attackPath = `${origin}/__xss_probe__`;
  const payload = `</textarea><img src="${attackPath}" onerror="globalThis.__xssSentinel=1"><script>globalThis.__xssSentinel=2<\/script><svg onload="globalThis.__xssSentinel=3"></svg>`;
  input.claim.url = "https://127.0.0.1/claim";
  input.claim.correction_url = "https://169.254.169.254/correction";
  input.claim.withdrawal_url = "https://attacker.invalid/withdrawal";
  input.claim.text = `${payload} claim`;
  input.crawl.url = input.claim.url;
  input.crawl.final_url = input.claim.url;
  input.crawl.body_utf8 = `<main><p>${input.claim.text}</p></main>`;
  input.crawl.claim_sha256 = sha256(input.claim.text);
  input.crawl.body_sha256 = sha256(input.crawl.body_utf8);
  input.claim.sources[0].url = input.claim.url;
  input.claim.sources[0].content_sha256 = input.crawl.body_sha256;
  input.crawl.access.robots.url = "https://127.0.0.1/robots.txt";

  input.challenge.text = `${payload} challenge`;
  input.challenge.source = "https://169.254.169.254/challenge";
  input.challenge.evidence[0].url = "https://[::1]/evidence";
  input.challenge.evidence[0].body_utf8 = `Evidence: ${payload}`;
  input.challenge.evidence[0].body_sha256 = sha256(input.challenge.evidence[0].body_utf8);
  input.challenge.evidence[0].excerpt = payload;
  input.challenge.evidence[0].interpretation = `${payload} interpretation`;

  input.response.text = `${payload} response`;
  input.response.replacement_claim = `${payload} replacement`;
  input.response.speaker_claim = `${payload.slice(0, 120)} speaker`;
  input.response.source = "https://attacker.invalid/response";
  input.material_review.source = "https://attacker.invalid/material-review";
  input.reuse.source = "https://attacker.invalid/reuse";
  input.reuse.policy_url = "https://attacker.invalid/policy";
  input.reuse.license_url = "https://attacker.invalid/licence";
  input.reuse.applies_to_sha256 = [
    input.crawl.claim_sha256,
    input.crawl.body_sha256,
    input.challenge.evidence[0].body_sha256,
    sha256(input.response.replacement_claim),
  ];
  return { input, payload };
}

const TRIPWIRE = `(() => {
  const events = [];
  Object.defineProperty(globalThis, "__claimFeedbackTestEvents", { value: events });
  const record = (name) => { events.push(name); throw new Error("blocked test capability: " + name); };
  const replace = (target, key, name) => {
    if (!target || typeof target[key] !== "function") return;
    try { Object.defineProperty(target, key, { configurable: true, value: () => record(name) }); }
    catch { events.push("tripwire-install-failed:" + name); }
  };
  replace(globalThis, "fetch", "fetch");
  for (const key of ["XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "BroadcastChannel", "Worker", "SharedWorker"]) {
    if (!(key in globalThis)) continue;
    try { Object.defineProperty(globalThis, key, { configurable: true, value: function () { return record(key); } }); }
    catch { events.push("tripwire-install-failed:" + key); }
  }
  replace(navigator, "sendBeacon", "sendBeacon");
  replace(navigator, "share", "share");
  replace(navigator.serviceWorker, "register", "serviceWorker.register");
  replace(globalThis.indexedDB, "open", "indexedDB.open");
  replace(globalThis.indexedDB, "deleteDatabase", "indexedDB.deleteDatabase");
  replace(globalThis.caches, "open", "caches.open");
  replace(URL, "createObjectURL", "URL.createObjectURL");
  for (const key of ["setItem", "removeItem", "clear"]) replace(Storage.prototype, key, "Storage." + key);
  for (const key of ["pushState", "replaceState"]) replace(History.prototype, key, "History." + key);
  let cookieOwner = Document.prototype;
  while (cookieOwner && !Object.getOwnPropertyDescriptor(cookieOwner, "cookie")) cookieOwner = Object.getPrototypeOf(cookieOwner);
  const cookie = cookieOwner && Object.getOwnPropertyDescriptor(cookieOwner, "cookie");
  if (cookie?.get && cookie?.set && cookie.configurable) {
    Object.defineProperty(cookieOwner, "cookie", {
      configurable: true,
      enumerable: cookie.enumerable,
      get: cookie.get,
      set: () => record("Document.cookie"),
    });
  } else {
    events.push("tripwire-install-failed:Document.cookie");
  }
  if (navigator.clipboard) {
    for (const key of ["read", "readText", "write", "writeText"]) replace(navigator.clipboard, key, "clipboard." + key);
  }
  document.addEventListener("securitypolicyviolation", (event) => events.push("csp:" + event.violatedDirective));
})()`;

const chrome = chromePath();
const skip = chrome === null && process.env.CI !== "true"
  ? "Chrome is not installed on this Mac; CI must run this real-browser gate"
  : false;

test("the generated worksheet remains local and inert in a real browser", { timeout: 45_000, skip }, async (context) => {
  assert.ok(chrome, "CI requires Chrome; set RHETORLINT_CHROME_BIN if it is installed elsewhere");
  const version = spawnSync(chrome, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);

  const requests = [];
  const server = await startReleaseServer(requests);
  const profile = mkdtempSync(join(tmpdir(), "rhetorlint-claim-feedback-chrome-"));
  const child = spawn(chrome, [
    "--headless=new",
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-extensions",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));
  const cdp = new CdpPipe(child);
  const bootAllowlist = new Set([
    "/", "/style.css", "/worksheet.mjs", "/claim-feedback-browser.mjs",
    "/favicon.svg", "/runtime/core.mjs", "/runtime/signals.mjs",
    "/runtime/claim-feedback-projection.mjs", "/runtime/rules.mjs", "/runtime/method.mjs",
  ]);
  const browserRequests = [];
  const interceptionErrors = [];
  const inFlightRequests = new Set();
  let booting = true;

  context.after(async () => {
    try { await cdp.send("Browser.close"); } catch {}
    if (child.exitCode === null) child.kill("SIGTERM");
    await server.close();
    rmSync(profile, { recursive: true, force: true });
  });

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Page.setLifecycleEventsEnabled", { enabled: true }, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  await cdp.send("DOMStorage.enable", {}, sessionId);
  await cdp.send("Log.enable", {}, sessionId);
  cdp.on("Fetch.requestPaused", (event) => {
    const url = new URL(event.params.request.url);
    const allowed = booting
      && url.origin === server.origin
      && bootAllowlist.has(url.pathname)
      && url.search === "";
    browserRequests.push({ url: url.href, allowed });
    const method = allowed ? "Fetch.continueRequest" : "Fetch.failRequest";
    const params = allowed
      ? { requestId: event.params.requestId }
      : { requestId: event.params.requestId, errorReason: "BlockedByClient" };
    cdp.send(method, params, sessionId).catch((error) => interceptionErrors.push(error.message));
  });
  cdp.on("Network.requestWillBeSent", (event) => {
    if (event.sessionId === sessionId) inFlightRequests.add(event.params.requestId);
  });
  for (const method of ["Network.loadingFinished", "Network.loadingFailed"]) {
    cdp.on(method, (event) => {
      if (event.sessionId === sessionId) inFlightRequests.delete(event.params.requestId);
    });
  }
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: TRIPWIRE }, sessionId);
  cdp.events.length = 0;
  const navigation = await cdp.send("Page.navigate", { url: `${server.origin}/` }, sessionId);
  await waitFor(
    cdp,
    sessionId,
    'document.readyState === "complete" && document.querySelector("#worksheet-status")?.textContent.includes("Waiting")',
    "the production worksheet module",
  );
  await waitUntil(
    () => inFlightRequests.size === 0 && cdp.events.some((event) => (
      event.sessionId === sessionId
      && event.method === "Page.lifecycleEvent"
      && event.params.frameId === navigation.frameId
      && event.params.loaderId === navigation.loaderId
      && event.params.name === "networkIdle"
    )),
    "the exact boot graph to reach CDP networkIdle",
  );

  assert.deepEqual(
    [...new Set(requests)].filter((path) => !new Set([...bootAllowlist].map((path) => path === "/" ? "/index.html" : path)).has(path)),
    [],
  );
  assert.deepEqual(browserRequests.filter((item) => !item.allowed), []);
  assert.deepEqual(interceptionErrors, []);
  booting = false;
  requests.length = 0;
  browserRequests.length = 0;
  cdp.events.length = 0;

  const cookieTripwire = await evaluate(cdp, sessionId, `(() => {
    try { document.cookie = "transient=secret"; } catch {}
    return {
      caught: globalThis.__claimFeedbackTestEvents.includes("Document.cookie"),
      cookie: document.cookie,
    };
  })()`);
  assert.deepEqual(cookieTripwire, { caught: true, cookie: "" });
  const storageSelfTestStart = cdp.events.length;
  await evaluate(cdp, sessionId, `(() => {
    localStorage.transient_probe = "secret";
    delete localStorage.transient_probe;
  })()`);
  const isTransientStorageEvent = (event, method) => (
    event.sessionId === sessionId
    && event.method === method
    && event.params.key === "transient_probe"
    && (
      event.params.storageId.securityOrigin === server.origin
      || event.params.storageId.storageKey?.startsWith(server.origin)
    )
  );
  await waitUntil(
    () => cdp.events.slice(storageSelfTestStart).some((event) => isTransientStorageEvent(event, "DOMStorage.domStorageItemAdded"))
      && cdp.events.slice(storageSelfTestStart).some((event) => isTransientStorageEvent(event, "DOMStorage.domStorageItemRemoved")),
    "the exact transient DOMStorage add and remove events",
  );
  const storageSelfTestEvents = new Set([
    cdp.events.slice(storageSelfTestStart).find((event) => isTransientStorageEvent(event, "DOMStorage.domStorageItemAdded")),
    cdp.events.slice(storageSelfTestStart).find((event) => isTransientStorageEvent(event, "DOMStorage.domStorageItemRemoved")),
  ]);
  assert.equal(storageSelfTestEvents.size, 2);
  await evaluate(cdp, sessionId, "globalThis.__claimFeedbackTestEvents.length = 0");

  const loadInput = async (input) => {
    await evaluate(cdp, sessionId, `(() => {
      const field = document.querySelector("#claim-json");
      field.value = ${JSON.stringify(JSON.stringify(input))};
      field.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#run-review").click();
    })()`);
    await waitFor(cdp, sessionId, 'document.querySelector("#worksheet-status")?.dataset.state === "complete"', "one browser packet");
  };

  const holdDigestAndRun = async (input) => {
    await evaluate(cdp, sessionId, `(() => {
      const subtle = crypto.subtle;
      const original = subtle.digest.bind(subtle);
      let pending;
      globalThis.__digestHeld = false;
      Object.defineProperty(subtle, "digest", { configurable: true, value: (...args) => new Promise((resolve, reject) => {
        pending = { args, resolve, reject };
        globalThis.__digestHeld = true;
      }) });
      globalThis.__releaseDigest = () => {
        Object.defineProperty(subtle, "digest", { configurable: true, value: original });
        original(...pending.args).then(pending.resolve, pending.reject);
      };
      const field = document.querySelector("#claim-json");
      field.value = ${JSON.stringify(JSON.stringify(input))};
      field.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#run-review").click();
    })()`);
    await waitFor(cdp, sessionId, "globalThis.__digestHeld === true", "a held browser digest");
  };

  const privateCanary = "PRIVATE_CANARY_31e7b1f4";
  await evaluate(cdp, sessionId, `(() => {
    const field = document.querySelector("#claim-json");
    field.value = ${JSON.stringify(`{"private":"${privateCanary}",`)};
    field.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#run-review").click();
  })()`);
  await waitFor(cdp, sessionId, 'document.querySelector("#worksheet-status")?.dataset.state === "error"', "a bounded JSON error");
  const privateError = await evaluate(cdp, sessionId, `(() => ({
    error: document.querySelector("#worksheet-error").textContent,
    title: document.title,
    url: location.href,
    htmlOutsideInput: [...document.querySelectorAll("body *:not(#claim-json)")].some((node) => node.textContent.includes(${JSON.stringify(privateCanary)})),
  }))()`);
  assert.deepEqual(privateError, {
    error: "Could not build a packet: Input is not valid JSON",
    title: "Claim Feedback · words can come back",
    url: `${server.origin}/`,
    htmlOutsideInput: false,
  });
  await evaluate(cdp, sessionId, 'document.querySelector("#clear-review").click()');

  await loadInput(FIXTURE);
  const safePacket = await evaluate(cdp, sessionId, 'JSON.parse(document.querySelector("#packet-json").textContent)');
  assert.equal(safePacket.training_candidate.status, "held-for-independent-review");
  assert.equal(safePacket.training_candidate.declared_conditions_met, true);
  assert.equal(safePacket.training_candidate.candidate, null);
  assert.equal(safePacket.karma_draft.status, "unsigned-draft-only");
  assert.equal(safePacket.karma_draft.importable, false);
  assert.equal(safePacket.karma_draft.deeds_signed, 0);
  assert.equal(safePacket.karma_draft.ledger_writes, 0);
  await evaluate(cdp, sessionId, 'document.querySelector("#clear-review").click()');

  const { input: hostile, payload } = hostileFixture(server.origin);
  await loadInput(hostile);
  const hostileState = await evaluate(cdp, sessionId, `(() => {
    const root = document.querySelector("#worksheet-results");
    const attributes = [...document.querySelectorAll("*")].flatMap((node) =>
      [...node.attributes].filter((item) => item.name.startsWith("data-") || ["href", "src", "style", "id", "class"].includes(item.name)).map((item) => item.value));
    return {
      visible: root.textContent.includes(${JSON.stringify(payload)}),
      active: root.querySelectorAll("script,img,svg,iframe,object,form").length,
      derivedNavigation: root.querySelectorAll("[href],[src],[action],[style]").length,
      sentinel: globalThis.__xssSentinel ?? null,
      titleLeak: document.title.includes(${JSON.stringify(payload)}),
      metadataLeak: attributes.some((value) => value.includes(${JSON.stringify(payload)})),
    };
  })()`);
  assert.deepEqual(hostileState, {
    visible: true,
    active: 0,
    derivedNavigation: 0,
    sentinel: null,
    titleLeak: false,
    metadataLeak: false,
  });
  assert.deepEqual(requests, []);
  await evaluate(cdp, sessionId, 'document.querySelector("#clear-review").click()');

  await holdDigestAndRun(FIXTURE);
  await evaluate(cdp, sessionId, 'document.querySelector("#stop-review").click()');
  assert.deepEqual(await evaluate(cdp, sessionId, `(() => ({
    hidden: document.querySelector("#worksheet-results").hidden,
    packet: document.querySelector("#packet-json").textContent,
    runDisabled: document.querySelector("#run-review").disabled,
  }))()`), { hidden: true, packet: "", runDisabled: true });
  await evaluate(cdp, sessionId, "globalThis.__releaseDigest()");
  await waitFor(cdp, sessionId, '!document.querySelector("#run-review").disabled', "discarded work to settle");
  assert.equal(await evaluate(cdp, sessionId, '!document.querySelector("#worksheet-results").hidden'), false);

  await holdDigestAndRun(FIXTURE);
  await evaluate(cdp, sessionId, `(() => {
    const field = document.querySelector("#claim-json");
    field.value = "{}";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.equal(await evaluate(cdp, sessionId, 'document.querySelector("#run-review").disabled'), true);
  await evaluate(cdp, sessionId, "globalThis.__releaseDigest()");
  await waitFor(cdp, sessionId, '!document.querySelector("#run-review").disabled', "superseded work to settle");
  assert.deepEqual(await evaluate(cdp, sessionId, `(() => ({
    hidden: document.querySelector("#worksheet-results").hidden,
    packet: document.querySelector("#packet-json").textContent,
    status: document.querySelector("#worksheet-status").textContent,
  }))()`), {
    hidden: true,
    packet: "",
    status: "Text changed. Nothing runs until you choose Run.",
  });

  await loadInput(FIXTURE);
  await evaluate(cdp, sessionId, 'document.querySelector("#clear-review").click()');
  const cleared = await evaluate(cdp, sessionId, `(() => ({
    text: document.querySelector("#claim-json").value,
    file: document.querySelector("#claim-file").value,
    hidden: document.querySelector("#worksheet-results").hidden,
    packet: document.querySelector("#packet-json").textContent,
    error: document.querySelector("#worksheet-error").textContent,
    local: localStorage.length,
    session: sessionStorage.length,
    cookie: document.cookie,
    url: location.href,
    laneChildren: [...document.querySelectorAll("#lane-claim,#lane-crawl,#lane-wording,#lane-response,#lane-karma,#lane-training")].map((node) => node.childElementCount),
    claimStillInBody: document.body.textContent.includes(${JSON.stringify(FIXTURE.claim.text)}),
    events: [...globalThis.__claimFeedbackTestEvents],
  }))()`);
  assert.deepEqual(cleared, {
    text: "",
    file: "",
    hidden: true,
    packet: "",
    error: "",
    local: 0,
    session: 0,
    cookie: "",
    url: `${server.origin}/`,
    laneChildren: [0, 0, 0, 0, 0, 0],
    claimStillInBody: false,
    events: [],
  });

  const durableState = await evaluate(cdp, sessionId, `(async () => ({
    databases: typeof indexedDB.databases === "function" ? (await indexedDB.databases()).length : 0,
    caches: (await globalThis.caches.keys()).length,
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
  }))()`);
  assert.deepEqual(durableState, { databases: 0, caches: 0, registrations: 0 });

  await evaluate(cdp, sessionId, `(() => {
    const field = document.querySelector("#claim-json");
    field.value = ${JSON.stringify(JSON.stringify(FIXTURE))};
    field.dispatchEvent(new Event("input", { bubbles: true }));
    globalThis.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    field.value = ${JSON.stringify(JSON.stringify(FIXTURE))};
    field.dispatchEvent(new Event("input", { bubbles: true }));
    globalThis.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  })()`);
  assert.equal(await evaluate(cdp, sessionId, 'document.querySelector("#claim-json").value'), "");
  assert.deepEqual(requests, []);
  assert.deepEqual(browserRequests, []);
  assert.deepEqual(interceptionErrors, []);
  const monitoredMethods = new Set([
    "Runtime.exceptionThrown", "Runtime.consoleAPICalled", "Log.entryAdded", "Network.loadingFailed",
    "Network.requestWillBeSent", "DOMStorage.domStorageItemAdded", "DOMStorage.domStorageItemUpdated",
    "DOMStorage.domStorageItemRemoved", "DOMStorage.domStorageItemsCleared",
  ]);
  const badEvents = cdp.events.filter((event) => (
    monitoredMethods.has(event.method)
    && !storageSelfTestEvents.has(event)
  ));
  assert.deepEqual(badEvents, [], `${version.stdout.trim()}\n${stderr.join("")}`);
});
