/**
 * Claim Feedback Node adapter.
 *
 * The shared projection is transport-neutral. This file owns the stronger
 * direct-object and stable-path boundaries, exact source provenance, SHA-256,
 * and the one-shot stdout CLI.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { resolve } from "node:path";
import { types as utilTypes } from "node:util";
import { fileURLToPath } from "node:url";
import { analyze } from "../../packages/core/index.mjs";
import { toSignal } from "../../packages/core/signals.mjs";
import {
  BOUNDS,
  SCHEMAS,
  createClaimFeedbackProjection,
} from "./claim-feedback-projection.mjs";

export { BOUNDS, SCHEMAS };

const CORE_SOURCE_BYTES = readFileSync(new URL("../../packages/core/index.mjs", import.meta.url));
const SIGNAL_SOURCE_BYTES = readFileSync(new URL("../../packages/core/signals.mjs", import.meta.url));
const CORE_PACKAGE = JSON.parse(
  readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf8"),
);
const RULE_SOURCE_BYTES = readFileSync(
  new URL("../../packages/rules-en/rules.json", import.meta.url),
);
const PROJECTION_SOURCE_BYTES = readFileSync(
  new URL("./claim-feedback-projection.mjs", import.meta.url),
);
const RULES = JSON.parse(RULE_SOURCE_BYTES.toString("utf8"));

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

function assertPlainJson(value, rootPath = "$input") {
  const seen = new Set();
  let nodes = 0;
  function visit(item, path, depth) {
    nodes += 1;
    if (nodes > BOUNDS.max_json_nodes) {
      throw new RangeError(`${rootPath} exceeds ${BOUNDS.max_json_nodes} JSON nodes`);
    }
    if (depth > BOUNDS.max_json_depth) {
      throw new RangeError(`${path} exceeds JSON depth ${BOUNDS.max_json_depth}`);
    }
    if (typeof item === "string" && hasUnpairedSurrogate(item)) {
      throw new TypeError(`${path} contains an unpaired UTF-16 surrogate`);
    }
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object") throw new TypeError(`${path} is not JSON data`);
    if (utilTypes.isProxy(item)) throw new TypeError(`${path} must not be a Proxy`);
    if (seen.has(item)) throw new TypeError(`${path} contains a cycle`);
    if (Array.isArray(item) && Object.getPrototypeOf(item) !== Array.prototype) {
      throw new TypeError(`${path} must use the standard Array prototype`);
    }
    if (!Array.isArray(item) && !isPlainObject(item)) {
      throw new TypeError(`${path} must use plain JSON objects`);
    }
    seen.add(item);
    const keys = Reflect.ownKeys(item);
    if (keys.some((key) => typeof key === "symbol")) {
      throw new TypeError(`${path} must not contain symbol properties`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Array.isArray(item)) {
      const length = descriptors.length?.value;
      let dense = Number.isSafeInteger(length) && length >= 0 && keys.length === length + 1;
      for (let index = 0; dense && index < length; index += 1) {
        dense = keys[index] === String(index);
      }
      dense = dense && keys[length] === "length";
      if (!dense) {
        throw new TypeError(`${path} must be a dense JSON array with no extra properties`);
      }
    }
    for (const key of keys) {
      if (Array.isArray(item) && key === "length") continue;
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`${path}.${String(key)} must be an enumerable data property, not an accessor`);
      }
      visit(descriptor.value, `${path}.${String(key)}`, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, rootPath, 0);
}

function stableJsonUnchecked(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJsonUnchecked).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${stableJsonUnchecked(value[key])}`,
  ).join(",")}}`;
}

export function stableJson(value) {
  assertPlainJson(value, "$value");
  return stableJsonUnchecked(value);
}

export function sha256(value) {
  if (typeof value === "string" && hasUnpairedSurrogate(value)) {
    throw new TypeError("sha256 input contains an unpaired UTF-16 surrogate");
  }
  if (typeof value !== "string" && !Buffer.isBuffer(value)) {
    throw new TypeError("sha256 input must be a string or Buffer");
  }
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

const METHOD = Object.freeze({
  engine: Object.freeze({
    name: CORE_PACKAGE.name,
    version: CORE_PACKAGE.version,
    source_sha256: sha256(CORE_SOURCE_BYTES),
  }),
  signal_projection: Object.freeze({
    name: `${CORE_PACKAGE.name}/signals`,
    version: CORE_PACKAGE.version,
    source_sha256: sha256(SIGNAL_SOURCE_BYTES),
  }),
  rules: Object.freeze({
    id: RULES.id,
    version: RULES.version,
    source_sha256: sha256(RULE_SOURCE_BYTES),
  }),
  packet_projection: Object.freeze({
    schema: SCHEMAS.packet,
    source_sha256: sha256(PROJECTION_SOURCE_BYTES),
  }),
});

const projection = createClaimFeedbackProjection({
  analyze,
  toSignal,
  rules: RULES,
  method: METHOD,
  sha256,
  isProxy: utilTypes.isProxy,
});

function inertSnapshot(value, path = "$input") {
  assertPlainJson(value, path);
  return JSON.parse(stableJsonUnchecked(value));
}

export async function validateClaimFeedbackInput(input) {
  try {
    return await projection.validateClaimFeedbackInput(inertSnapshot(input));
  } catch (error) {
    return [{ path: "$input", message: error.message }];
  }
}

export async function buildClaimFeedback(input) {
  return projection.buildClaimFeedback(inertSnapshot(input));
}

export async function verifyClaimFeedbackPacket(packet, input) {
  return projection.verifyClaimFeedbackPacket(
    inertSnapshot(packet, "$packet"),
    inertSnapshot(input),
  );
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
    descriptor = openSync(
      inputPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
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

export const HELP = `Claim Feedback 0.2

Usage:
  node examples/claim-feedback/claim-feedback.mjs INPUT.json

Reads one bounded local JSON file and prints one packet. It makes no network
request, writes no file, sends no message, signs no KARMA deed, and writes no
training record. Set CLAIM_FEEDBACK_HALT=1 to stop before reading the input.
`;

export async function runCli(argv = process.argv.slice(2), runtime = {}) {
  const env = runtime.env ?? process.env;
  const stdout = runtime.stdout ?? process.stdout;
  if (env.CLAIM_FEEDBACK_HALT === "1") {
    throw new Error("stopped by CLAIM_FEEDBACK_HALT=1 before input read");
  }
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    stdout.write(HELP);
    return 0;
  }
  if (argv.length !== 1 || argv[0].startsWith("-")) {
    throw new TypeError("expected exactly one INPUT.json path; use --help");
  }
  const inputPath = resolve(argv[0]);
  const input = readInputFile(inputPath);
  stdout.write(`${JSON.stringify(await buildClaimFeedback(input), null, 2)}\n`);
  return 0;
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (directPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    process.stderr.write(`claim-feedback: ${error.message}\n`);
    process.exitCode = 1;
  }
}
