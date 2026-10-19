// A fail-closed reader for exactly the YAML subset that spec/taxonomy.yaml
// uses, so the taxonomy can be checked against the rule packs with zero
// runtime dependencies.
//
// The subset:
//   * block mappings with plain keys ([A-Za-z_][A-Za-z0-9_]*);
//   * block sequences whose items are mappings ("- key: value");
//   * double-quoted scalars without escapes (no backslash anywhere);
//   * integers (no sign other than "-", no leading zero, no "_");
//   * slug plain scalars ([a-z][a-z0-9.-]*, never a YAML 1.1 boolean or null);
//   * single-line flow sequences of double-quoted strings;
//   * bare folded scalars (">") whose lines share one indent, with no blank,
//     more-indented or '#'-led lines inside them;
//   * full-line comments and comments after a value.
//
// Anything else throws an error that starts "line N:". Anchors, aliases, tags,
// single quotes, literal '|' blocks, flow mappings, tabs in indentation,
// duplicate keys and lone CR characters are all outside the subset, so the file
// cannot drift into syntax this reader would misread. (CRLF line endings, as a
// Windows checkout may produce, read as LF, exactly as YAML reads them.) So are
// characters YAML refuses (C0/C1 controls, DEL, U+FFFE/U+FFFF) and the ones it
// reads as line breaks (NEL, U+2028, U+2029). The only whitespace this reader
// trims or skips is the ASCII space: YAML reads a no-break or ideographic space
// as content, so a line holding one is never treated as blank.
// scripts/check-taxonomy-yaml.py confirms the reader agrees with PyYAML's
// safe_load.
//
// Run directly, it prints the parsed document as JSON:
//   node scripts/taxonomy-yaml.mjs [path]   (default: spec/taxonomy.yaml)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class TaxonomyYamlError extends Error {
  constructor(line, message) {
    super(`line ${line}: ${message}`);
    this.name = "TaxonomyYamlError";
    this.line = line;
  }
}

const fail = (line, message) => { throw new TaxonomyYamlError(line, message); };

// YAML 1.1 resolves these plain words to booleans or null (PyYAML does), so a
// slug spelled like one would not round-trip as a string.
const IMPLICIT_WORD = /^(?:y|n|yes|no|true|false|on|off|null|~)$/i;
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*):(?: +(.*))?$/;
const SLUG = /^[a-z][a-z0-9.-]*$/;
const INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
// Outside YAML's printable set (tab, LF and CR aside), or a non-LF line break.
const REFUSED_CHAR = /[^\t\n\r\x20-\x7E\xA0-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]|[\u2028\u2029]/u;
const BLANK = /^ *$/;
const trimSpaces = (s) => s.replace(/^ +| +$/g, "");

/** Drop a trailing comment ('#' after a space, outside double quotes). */
function stripTrailingComment(value, line) {
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === "#" && !quoted && (i === 0 || value[i - 1] === " ")) {
      return trimSpaces(value.slice(0, i));
    }
  }
  if (quoted) fail(line, "unterminated double-quoted scalar");
  return trimSpaces(value);
}

function flowSequence(value, line) {
  const inner = trimSpaces(value.slice(1, -1));
  if (inner === "") return [];
  const items = [];
  let rest = inner;
  for (;;) {
    const m = rest.match(/^"([^"]*)" *(,?) */);
    if (!m) fail(line, "a flow sequence may hold only double-quoted strings separated by commas");
    items.push(m[1]);
    rest = rest.slice(m[0].length);
    if (m[2] === "") break;
    if (rest === "") fail(line, "trailing comma in a flow sequence is outside the subset");
  }
  if (rest !== "") fail(line, "a flow sequence may hold only double-quoted strings separated by commas");
  return items;
}

function scalar(value, line) {
  if (value.includes("\\")) fail(line, "backslash escapes are outside the subset");
  if (value.startsWith('"')) {
    if (/^"[^"]*"$/.test(value)) return value.slice(1, -1);
    fail(line, "a double-quoted scalar must be the whole value");
  }
  if (INTEGER.test(value)) {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) fail(line, `integer ${value} is outside the safe range`);
    return n;
  }
  if (value.startsWith("[")) {
    if (value.endsWith("]")) return flowSequence(value, line);
    fail(line, "a flow sequence must open and close on one line");
  }
  const shown = JSON.stringify(value.slice(0, 24));
  if (IMPLICIT_WORD.test(value)) fail(line, `${shown} would load as a boolean or null; quote it`);
  if (SLUG.test(value)) return value;
  if (value.startsWith("'")) fail(line, `single-quoted scalars are outside the subset: ${shown}`);
  if (value.startsWith("&")) fail(line, `anchors are outside the subset: ${shown}`);
  if (value.startsWith("*")) fail(line, `aliases are outside the subset: ${shown}`);
  if (value.startsWith("!")) fail(line, `tags are outside the subset: ${shown}`);
  if (value.startsWith("|")) fail(line, `literal '|' block scalars are outside the subset: ${shown}`);
  if (value.startsWith(">")) fail(line, `only a bare '>' folded scalar is in the subset: ${shown}`);
  if (value.startsWith("{")) fail(line, `flow mappings are outside the subset: ${shown}`);
  fail(line, `plain (unquoted) scalars other than slugs and integers are outside the subset: ${shown}`);
}

export function parseTaxonomyYaml(text) {
  if (typeof text !== "string") throw new TypeError("parseTaxonomyYaml() text must be a string");
  if (text.startsWith("\uFEFF")) fail(1, "a byte-order mark is outside the subset");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((s, i) => {
    if (s.includes("\r")) fail(i + 1, "a CR outside a CRLF line ending is outside the subset");
    const refused = s.match(REFUSED_CHAR);
    if (refused) {
      const code = refused[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      fail(i + 1, `character U+${code} is a control character YAML refuses, or a line break other than LF; outside the subset`);
    }
    if (/^ *\t/.test(s)) fail(i + 1, "tab indentation is outside the subset");
  });

  let i = 0; // index of the current line; its line number is i + 1
  const skippable = (s) => BLANK.test(s) || /^ *#/.test(s);
  const indentOf = (s) => s.match(/^ */)[0].length;
  function peek() {
    while (i < lines.length && skippable(lines[i])) i++;
    return i < lines.length ? lines[i] : null;
  }

  function block(indent) {
    return lines[i].slice(indent).startsWith("-") ? sequence(indent) : mapping(indent);
  }

  function sequence(indent) {
    const out = [];
    for (let s = peek(); s !== null && indentOf(s) === indent; s = peek()) {
      const body = s.slice(indent);
      if (!body.startsWith("-")) fail(i + 1, "a mapping key cannot follow sequence items at the same indent");
      // "- # note" is an empty (null) item in YAML, not a comment line.
      if (!/^- [^ #]/.test(body)) fail(i + 1, "a sequence item must be '- key: value' (one space after the dash)");
      // Re-read "- key: v" as a mapping whose keys sit at indent + 2.
      lines[i] = " ".repeat(indent + 2) + body.slice(2);
      out.push(mapping(indent + 2));
    }
    const s = peek();
    if (s !== null && indentOf(s) > indent) fail(i + 1, "bad indentation in a sequence");
    return out;
  }

  function folded(keyIndent, keyLine) {
    const parts = [];
    let contentIndent = null;
    while (i < lines.length) {
      const s = lines[i];
      if (BLANK.test(s)) {
        let j = i;
        while (j < lines.length && BLANK.test(lines[j])) j++;
        if (contentIndent !== null && j < lines.length && indentOf(lines[j]) >= contentIndent) {
          fail(i + 1, "a blank line inside a folded scalar is outside the subset");
        }
        break;
      }
      const ind = indentOf(s);
      if (contentIndent === null) {
        if (ind <= keyIndent) break;
        contentIndent = ind;
      }
      if (ind < contentIndent) break;
      if (ind > contentIndent) fail(i + 1, "a more-indented line inside a folded scalar is outside the subset");
      const t = s.slice(ind);
      if (t.startsWith("#")) fail(i + 1, "a '#' line inside a folded scalar is content in YAML, not a comment; outside the subset");
      if (/ $/.test(t)) fail(i + 1, "trailing spaces inside a folded scalar are outside the subset");
      parts.push(t);
      i++;
    }
    if (parts.length === 0) fail(keyLine, "a '>' folded scalar has no content");
    // Folded, clip chomping: keep the final line break, if the text has one
    // (a scalar that ends the file without a newline has none).
    return parts.join(" ") + (i < lines.length ? "\n" : "");
  }

  function mapping(indent) {
    const out = {};
    for (let s = peek(); s !== null && indentOf(s) >= indent; s = peek()) {
      const n = i + 1;
      if (indentOf(s) > indent) fail(n, "bad indentation");
      const m = s.slice(indent).match(KEY_LINE);
      if (!m) fail(n, "expected 'key: value'");
      const [, key, rest] = m;
      if (IMPLICIT_WORD.test(key)) fail(n, `key '${key}' would load as a boolean or null`);
      if (key === "__proto__") fail(n, "key '__proto__' is outside the subset");
      if (Object.hasOwn(out, key)) fail(n, `duplicate key '${key}'`);
      i++;
      const value = rest === undefined ? "" : stripTrailingComment(rest, n);
      if (value === "") {
        const next = peek();
        if (next === null || indentOf(next) <= indent) fail(n, `'${key}' has no value (null is outside the subset)`);
        out[key] = block(indentOf(next));
      } else if (value === ">") {
        out[key] = folded(indent, n);
      } else {
        out[key] = scalar(value, n);
      }
    }
    return out;
  }

  const first = peek();
  if (first === null) fail(Math.max(1, lines.length), "empty document");
  if (indentOf(first) !== 0) fail(i + 1, "the document must start with a top-level key at column 1");
  const doc = mapping(0);
  if (peek() !== null) fail(i + 1, "trailing content");
  return doc;
}

export function readTaxonomyYaml(path) {
  return parseTaxonomyYaml(readFileSync(path, "utf8"));
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (directPath === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ??
    fileURLToPath(new URL("../spec/taxonomy.yaml", import.meta.url));
  try {
    process.stdout.write(JSON.stringify(readTaxonomyYaml(target)) + "\n");
  } catch (error) {
    process.stderr.write(`${target}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
