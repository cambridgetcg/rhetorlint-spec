/** Browser-only byte and SHA-256 boundary for Claim Feedback. */

const UTF8 = new TextEncoder();
export const MAX_INPUT_BYTES = 65_536;

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

function hex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function createBrowserSha256(subtle) {
  if (!subtle || typeof subtle.digest !== "function") {
    throw new TypeError("This worksheet needs browser Web Crypto SHA-256");
  }
  return async function sha256(value) {
    if (typeof value === "string" && hasUnpairedSurrogate(value)) {
      throw new TypeError("sha256 input contains an unpaired UTF-16 surrogate");
    }
    if (typeof value !== "string" && !(value instanceof Uint8Array)) {
      throw new TypeError("sha256 input must be a string or Uint8Array");
    }
    const bytes = typeof value === "string" ? UTF8.encode(value) : value;
    return `sha256:${hex(await subtle.digest("SHA-256", bytes))}`;
  };
}

export function decodeBoundedJson(value) {
  let bytes;
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) {
      throw new TypeError("input contains an unpaired UTF-16 surrogate");
    }
    bytes = UTF8.encode(value);
  } else if (value instanceof Uint8Array) {
    bytes = value;
  } else {
    throw new TypeError("input must be pasted text or one selected byte snapshot");
  }
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new RangeError(`input exceeds ${MAX_INPUT_BYTES} UTF-8 bytes`);
  }
  const text = typeof value === "string"
    ? value
    : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text);
}
