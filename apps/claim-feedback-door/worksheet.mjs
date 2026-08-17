import { analyze } from "./runtime/core.mjs";
import { toSignal } from "./runtime/signals.mjs";
import {
  BOUNDS,
  createClaimFeedbackProjection,
} from "./runtime/claim-feedback-projection.mjs";
import RULES from "./runtime/rules.mjs";
import METHOD from "./runtime/method.mjs";
import {
  createBrowserSha256,
  decodeBoundedJson,
  MAX_INPUT_BYTES,
} from "./claim-feedback-browser.mjs";

if (MAX_INPUT_BYTES !== BOUNDS.max_input_bytes) {
  throw new Error("Browser and projection input bounds differ");
}

const projection = createClaimFeedbackProjection({
  analyze,
  toSignal,
  rules: RULES,
  method: METHOD,
  sha256: createBrowserSha256(globalThis.crypto?.subtle),
});

const fileInput = document.querySelector("#claim-file");
const textInput = document.querySelector("#claim-json");
const runButton = document.querySelector("#run-review");
const stopButton = document.querySelector("#stop-review");
const clearButton = document.querySelector("#clear-review");
const status = document.querySelector("#worksheet-status");
const errorBox = document.querySelector("#worksheet-error");
const results = document.querySelector("#worksheet-results");
const packetJson = document.querySelector("#packet-json");

const laneTargets = Object.freeze({
  claim: document.querySelector("#lane-claim"),
  crawl: document.querySelector("#lane-crawl"),
  wording: document.querySelector("#lane-wording"),
  response: document.querySelector("#lane-response"),
  karma: document.querySelector("#lane-karma"),
  training: document.querySelector("#lane-training"),
});

let generation = 0;
let running = false;
let retainedInput = null;
let retainedPacket = null;

function setStatus(message, state = "idle") {
  status.textContent = message;
  status.dataset.state = state;
}

function setError(error) {
  const message = error instanceof SyntaxError
    ? "Input is not valid JSON"
    : error instanceof Error
      ? error.message
      : "Unknown input error";
  errorBox.textContent = `Could not build a packet: ${message.slice(0, 320)}`;
  errorBox.hidden = false;
  setStatus("Stopped without a packet.", "error");
}

function clearRenderedPacket() {
  retainedInput = null;
  retainedPacket = null;
  errorBox.textContent = "";
  errorBox.hidden = true;
  results.hidden = true;
  packetJson.textContent = "";
  for (const target of Object.values(laneTargets)) target.replaceChildren();
}

function addField(target, label, value, className = "") {
  const row = document.createElement("div");
  row.className = "result-row";
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value === null ? "null" : String(value);
  if (className) detail.className = className;
  row.append(term, detail);
  target.append(row);
}

function addList(target, label, values) {
  const row = document.createElement("div");
  row.className = "result-row";
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  const list = document.createElement("ul");
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = String(value);
    list.append(item);
  }
  detail.append(list);
  row.append(term, detail);
  target.append(row);
}

function reviewLine(name, review) {
  if (review === null) return `${name}: not supplied`;
  const tells = review.signal?.density?.tells;
  return tells === undefined
    ? `${name}: ${review.status}`
    : `${name}: ${review.status}; ${tells} wording pattern(s) in this text only`;
}

function renderPacket(packet) {
  clearRenderedPacket();
  retainedPacket = packet;

  addField(laneTargets.claim, "State", packet.status, "plain-status");
  addField(laneTargets.claim, "Exact supplied claim", packet.source_claim.text);
  addField(laneTargets.claim, "Claim digest", packet.source_claim.claim_sha256, "mono");
  addField(laneTargets.claim, "Supplied URL (inert text)", packet.source_claim.url, "mono");
  addList(laneTargets.claim, "Uncertainties", packet.source_claim.uncertainties);

  addField(laneTargets.crawl, "Receipt kind", packet.crawl_receipt.kind);
  addField(laneTargets.crawl, "Crawler claim", `${packet.crawl_receipt.access.crawler_name} ${packet.crawl_receipt.access.crawler_version}`);
  addField(laneTargets.crawl, "Robots claim", packet.crawl_receipt.access.robots.decision);
  addField(laneTargets.crawl, "HTTP claim", `${packet.crawl_receipt.http_status} · ${packet.crawl_receipt.media_type}`);
  addField(laneTargets.crawl, "Body digest", packet.crawl_receipt.body_sha256, "mono");
  addField(laneTargets.crawl, "Boundary", "Supplied and structurally checked; remote fetch, crawler identity, and robots decision are not authenticated.");

  addField(laneTargets.wording, "Scope", packet.wording_review.scope);
  addField(laneTargets.wording, "Person aggregation", String(packet.wording_review.person_aggregation));
  addList(laneTargets.wording, "Separate text lanes", [
    reviewLine("claim", packet.wording_review.claim),
    reviewLine("challenge", packet.wording_review.challenge),
    reviewLine("response", packet.wording_review.response),
    reviewLine("replacement claim", packet.wording_review.replacement_claim),
  ]);
  addField(laneTargets.wording, "Boundary", "A mark is a reading prompt, not a truth, lie, intent, ego, credibility, or person score.");

  addField(laneTargets.response, "Challenge kind", packet.challenge.kind);
  addField(laneTargets.response, "Challenge", packet.challenge.text);
  addField(laneTargets.response, "Response kind", packet.response?.kind ?? "none supplied");
  addField(laneTargets.response, "Response", packet.response?.text ?? "No response supplied.");
  addField(laneTargets.response, "Latest recorded claim", packet.correction_state.latest_recorded_claim);
  addField(laneTargets.response, "History entries", packet.correction_state.history.length);

  addField(laneTargets.karma, "Status", packet.karma_draft.status, "held-status");
  addField(laneTargets.karma, "Importable", String(packet.karma_draft.importable));
  addField(laneTargets.karma, "Proposed records", packet.karma_draft.records.length);
  addField(laneTargets.karma, "Deeds signed", packet.karma_draft.deeds_signed);
  addField(laneTargets.karma, "Ledger writes", packet.karma_draft.ledger_writes);
  addField(laneTargets.karma, "Boundary", "Drafted here only; not sent, delivered, read, signed, imported, or repaired.");

  addField(laneTargets.training, "Status", packet.training_candidate.status, "held-status");
  addField(laneTargets.training, "Candidate", JSON.stringify(packet.training_candidate.candidate));
  addField(laneTargets.training, "Declared conditions met", String(packet.training_candidate.declared_conditions_met));
  addField(laneTargets.training, "Dataset writes", packet.training_candidate.dataset_writes);
  addField(laneTargets.training, "Boundary", "Supplied and unverified—not permission. Independent rights, identity, privacy, licence, and provenance review is still required.");
  addList(laneTargets.training, "Reasons", packet.training_candidate.reasons);

  packetJson.textContent = JSON.stringify(packet, null, 2);
  results.hidden = false;
}

async function selectedInput(token) {
  const selected = fileInput.files?.[0] ?? null;
  if (selected !== null) {
    if (selected.size > BOUNDS.max_input_bytes) {
      throw new RangeError(`selected file exceeds ${BOUNDS.max_input_bytes} bytes`);
    }
    const buffer = await selected.arrayBuffer();
    if (token !== generation) return null;
    if (buffer.byteLength > BOUNDS.max_input_bytes) {
      throw new RangeError(`selected file exceeds ${BOUNDS.max_input_bytes} bytes`);
    }
    return new Uint8Array(buffer);
  }
  if (textInput.value.length === 0) {
    throw new TypeError("Paste one JSON record or select one JSON file first");
  }
  return textInput.value;
}

async function runReview() {
  if (running) return;
  running = true;
  const token = ++generation;
  clearRenderedPacket();
  setStatus("Reading one bounded snapshot…", "working");
  runButton.disabled = true;
  try {
    const source = await selectedInput(token);
    if (source === null || token !== generation) return;
    const input = decodeBoundedJson(source);
    retainedInput = input;
    setStatus("Checking exact digests and separate meaning lanes…", "working");
    const packet = await projection.buildClaimFeedback(input);
    if (token !== generation) return;
    retainedPacket = packet;
    renderPacket(packet);
    setStatus("One packet built in this page. Nothing was sent or stored by the app.", "complete");
  } catch (error) {
    if (token === generation) setError(error);
  } finally {
    running = false;
    runButton.disabled = false;
  }
}

function stopReview() {
  generation += 1;
  runButton.disabled = running;
  clearRenderedPacket();
  setStatus("Stopped. No packet is retained or displayed.", "stopped");
}

function clearWorksheet() {
  generation += 1;
  runButton.disabled = running;
  fileInput.value = "";
  textInput.value = "";
  clearRenderedPacket();
  setStatus("Cleared from this worksheet. This is not a promise of secure RAM or clipboard erasure.", "idle");
}

fileInput.addEventListener("change", () => {
  generation += 1;
  runButton.disabled = running;
  if (fileInput.files?.length) textInput.value = "";
  clearRenderedPacket();
  setStatus("File selected. Nothing runs until you choose Run.", "idle");
});

textInput.addEventListener("input", () => {
  generation += 1;
  runButton.disabled = running;
  if (textInput.value.length) fileInput.value = "";
  clearRenderedPacket();
  setStatus("Text changed. Nothing runs until you choose Run.", "idle");
});

runButton.addEventListener("click", runReview);
stopButton.addEventListener("click", stopReview);
clearButton.addEventListener("click", clearWorksheet);
globalThis.addEventListener("pagehide", clearWorksheet);
