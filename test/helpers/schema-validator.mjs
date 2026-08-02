/**
 * A JSON Schema validator sized exactly to spec/output.schema.json.
 *
 * The schema is the spec's public contract and this repository ships zero
 * dependencies, so the contract is enforced here or nowhere. Implemented:
 * $ref into $defs, type (including union types), required, properties,
 * additionalProperties: false, items, minItems, enum, pattern, minimum, maximum.
 *
 * Every other keyword throws. A validator that read past what it does not
 * understand would report a pass for a constraint it never checked, and the
 * gap would masquerade as conformance — so an unimplemented construct is a
 * loud error, never a silent success. `assertSupported` walks a whole schema
 * up front, which keeps a newly added keyword from hiding in a branch no
 * instance happens to reach.
 *
 * Instances are judged as JSON: a property whose value is `undefined` counts
 * as absent, because that is what serialisation makes of it. A value JSON
 * cannot carry (NaN, Infinity, a function) fails against every schema.
 */

/** Keywords that constrain nothing. `$defs` only holds what `$ref` resolves into. */
const ANNOTATIONS = new Set([
  "$schema", "$id", "$comment", "$defs", "title", "description", "default", "examples"
]);

/** Keywords this validator enforces. Anything in neither set throws. */
const CONSTRAINTS = new Set([
  "$ref", "type", "required", "properties", "additionalProperties", "items",
  "minItems", "enum", "pattern", "minimum", "maximum"
]);

const JSON_TYPES = new Set([
  "object", "array", "string", "number", "integer", "boolean", "null"
]);

/** The JSON type of a value, or null when JSON cannot carry it at all. */
function jsonTypeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string": return "string";
    case "boolean": return "boolean";
    case "object": return "object";
    case "number":
      if (!Number.isFinite(value)) return null;
      return Number.isInteger(value) ? "integer" : "number";
    default: return null;
  }
}

/** Values are quoted in messages so an empty string reads as one. */
function describe(value) {
  const type = typeof value;
  if (type === "string") return JSON.stringify(value);
  if (type === "number" || type === "boolean" || value === null) return String(value);
  if (type === "object") return Array.isArray(value) ? "an array" : "an object";
  return "a " + type;
}

function resolveRef(ref, root, path) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    throw new Error(`only local '#/' pointers are implemented; got ${describe(ref)} at ${path}`);
  }
  let target = root;
  for (const token of ref.slice(2).split("/")) {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (target === null || typeof target !== "object" || !(key in target)) {
      throw new Error(`$ref '${ref}' at ${path} does not resolve`);
    }
    target = target[key];
  }
  return target;
}

/** Refuse a subschema this validator would otherwise pass by ignoring it. */
function assertImplemented(schema, path) {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`schema at ${path} must be an object; boolean schemas are not implemented`);
  }
  for (const keyword of Object.keys(schema)) {
    if (!CONSTRAINTS.has(keyword) && !ANNOTATIONS.has(keyword)) {
      throw new Error(`JSON Schema keyword '${keyword}' at ${path} is not implemented`);
    }
  }
  if ("additionalProperties" in schema && schema.additionalProperties !== false) {
    throw new Error(
      `only 'additionalProperties: false' is implemented; got ` +
      `${JSON.stringify(schema.additionalProperties)} at ${path}`
    );
  }
  if ("items" in schema && Array.isArray(schema.items)) {
    throw new Error(`tuple form of 'items' is not implemented at ${path}`);
  }
  if ("minItems" in schema && (!Number.isInteger(schema.minItems) || schema.minItems < 0)) {
    throw new Error(`'minItems' must be a non-negative integer at ${path}`);
  }
  if ("required" in schema && !Array.isArray(schema.required)) {
    throw new Error(`'required' must be an array at ${path}`);
  }
  if ("type" in schema) {
    for (const name of [].concat(schema.type)) {
      if (!JSON_TYPES.has(name)) throw new Error(`unknown type '${name}' at ${path}`);
    }
  }
  if ("enum" in schema) {
    if (!Array.isArray(schema.enum)) throw new Error(`'enum' must be an array at ${path}`);
    for (const member of schema.enum) {
      if (member !== null && typeof member === "object") {
        throw new Error(`only primitive enum members are implemented at ${path}`);
      }
    }
  }
}

function check(value, schema, path, root, errors) {
  assertImplemented(schema, path);

  if ("$ref" in schema) check(value, resolveRef(schema.$ref, root, path), path, root, errors);

  const type = jsonTypeOf(value);
  if (type === null) {
    errors.push(`${path}: ${describe(value)} is not JSON data`);
    return;
  }

  if ("type" in schema) {
    const allowed = [].concat(schema.type);
    // An integer satisfies "number"; a fractional number never satisfies "integer".
    if (!allowed.some((name) => name === type || (name === "number" && type === "integer"))) {
      errors.push(`${path}: expected ${allowed.join(" or ")}, got ${type}`);
    }
  }

  if ("enum" in schema && !schema.enum.includes(value)) {
    errors.push(
      `${path}: ${describe(value)} is outside the permitted set ` +
      `[${schema.enum.map(describe).join(", ")}]`
    );
  }

  if ("pattern" in schema && type === "string" && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: ${describe(value)} does not match /${schema.pattern}/`);
  }

  if (type === "integer" || type === "number") {
    if ("minimum" in schema && value < schema.minimum) {
      errors.push(`${path}: ${value} is below the minimum ${schema.minimum}`);
    }
    if ("maximum" in schema && value > schema.maximum) {
      errors.push(`${path}: ${value} is above the maximum ${schema.maximum}`);
    }
  }

  if (type === "object") {
    const present = Object.keys(value).filter((key) => value[key] !== undefined);
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!present.includes(key)) errors.push(`${path}: required property '${key}' is missing`);
    }
    for (const key of present) {
      if (Object.hasOwn(properties, key)) {
        check(value[key], properties[key], `${path}.${key}`, root, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: property '${key}' is not permitted here`);
      }
    }
  }

  if (type === "array") {
    if ("minItems" in schema && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} items, got ${value.length}`);
    }
    if ("items" in schema) {
      value.forEach((item, i) => check(item, schema.items, `${path}[${i}]`, root, errors));
    }
  }
}

/**
 * validate(instance, schema, options) -> the list of violations; empty is a pass.
 *
 * options:
 *   root  the document $ref pointers resolve against, when `schema` is a
 *         subschema lifted out of it. Defaults to `schema`.
 *   path  how the instance is named in messages. Defaults to "$".
 */
export function validate(instance, schema, options = {}) {
  const errors = [];
  check(instance, schema, options.path || "$", options.root || schema, errors);
  return errors;
}

/**
 * Walk every subschema and throw on the first construct this validator does
 * not enforce, whether or not an instance ever reaches that branch.
 */
export function assertSupported(schema, path = "$") {
  assertImplemented(schema, path);
  for (const [key, sub] of Object.entries(schema.properties || {})) {
    assertSupported(sub, `${path}.properties.${key}`);
  }
  for (const [key, sub] of Object.entries(schema.$defs || {})) {
    assertSupported(sub, `${path}.$defs.${key}`);
  }
  if ("items" in schema) assertSupported(schema.items, `${path}.items`);
}
