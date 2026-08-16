import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSupported, validate } from "../../test/helpers/schema-validator.mjs";
import {
  DATASET_SCHEMA,
  HALT_ENV,
  buildSnapshot,
  checkCommittedRelease,
  runCli,
  writeSnapshot,
} from "./build.mjs";

const HERE = new URL(".", import.meta.url);
const RELEASE = new URL("./release/", HERE);
const RELEASE_PATH = fileURLToPath(RELEASE);
const SCHEMA = JSON.parse(readFileSync(new URL("./row.schema.json", HERE), "utf8"));
const CORPUS = JSON.parse(readFileSync(new URL("../../conformance/cases.json", HERE), "utf8"));
const FIXTURE = JSON.parse(readFileSync(
  new URL("../../examples/claim-feedback/fixtures/corrected-claim.json", HERE),
  "utf8",
));

function walk(root, current = root) {
  const paths = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...walk(root, path));
    else paths.push(relative(root, path).split(sep).join("/"));
  }
  return paths.sort();
}

function parseJsonl(bytes) {
  const text = bytes.toString("utf8");
  assert.ok(text.endsWith("\n"), "JSONL ends with one LF");
  assert.equal(text.includes("\r"), false, "JSONL uses LF, not CRLF");
  return text.trimEnd().split("\n").map((line) => JSON.parse(line));
}

test("the snapshot is all 31 conformance cases and no invented training split", async () => {
  assert.doesNotThrow(() => assertSupported(SCHEMA));
  const snapshot = await buildSnapshot();
  assert.equal(snapshot.rows.length, 31);
  assert.equal(snapshot.rows.length, CORPUS.cases.length);
  assert.equal(snapshot.manifest.train_rows, 0);
  assert.equal(snapshot.manifest.split, "test");

  const ids = new Set();
  snapshot.rows.forEach((row, index) => {
    assert.deepEqual(validate(row, SCHEMA), [], `row ${index}`);
    assert.equal(row.schema, DATASET_SCHEMA);
    assert.equal(row.split, "test");
    assert.deepEqual(row.tasks, [
      "reference-output-reproduction",
      "reference-mark-span-reproduction",
      "reference-strip-reproduction",
    ]);
    assert.equal(row.input_text, CORPUS.cases[index].input);
    assert.deepEqual(row.expected, {
      density: CORPUS.cases[index].density,
      strip: CORPUS.cases[index].strip,
      marks: CORPUS.cases[index].marks,
    });
    assert.equal(row.provenance.source_repository, "https://github.com/cambridgetcg/rhetorlint-spec");
    assert.equal(row.provenance.source_revision, "5450687cbd46e52359c6d12e408c22ee1b38c5ea");
    assert.equal(row.provenance.source_case_index, index);
    assert.equal(row.provenance.independent_human_labels, false);
    assert.equal(row.provenance.input_ascii, true);
    for (const mark of row.expected.marks) {
      assert.equal(row.input_text.slice(mark.start, mark.end), mark.actual);
    }
    assert.equal(ids.has(row.row_id), false, `unique row_id ${row.row_id}`);
    ids.add(row.row_id);
  });
  assert.deepEqual(snapshot.manifest.measured_frame, {
    unique_inputs: 31,
    minimum_input_characters: 28,
    maximum_input_characters: 117,
    marks: 50,
    marked_cases: 26,
    zero_mark_cases: 5,
    rules_in_pack: 22,
    rules_observed: 22,
    families_observed: 6,
    strip_outputs_changed: 10,
  });
  assert.equal(snapshot.sourceManifest.source_repository.source_lock_enforced, true);
  assert.equal(snapshot.sourceManifest.method.cross_engine_checks.run_by_builder, false);
});

test("the JSONL and schema round-trip without target or split drift", async () => {
  const snapshot = await buildSnapshot();
  const rows = parseJsonl(snapshot.files.get("data/test-00000-of-00001.jsonl"));
  assert.deepEqual(rows, snapshot.rows);
  for (const row of rows) assert.deepEqual(validate(row, SCHEMA), []);

  const extra = structuredClone(rows[0]);
  extra.truth_label = true;
  assert.match(validate(extra, SCHEMA).join("\n"), /truth_label/);

  const train = structuredClone(rows[0]);
  train.split = "train";
  assert.match(validate(train, SCHEMA).join("\n"), /permitted set/);
});

test("Claim Feedback contributes a digest-only exclusion receipt and zero rows", async () => {
  const snapshot = await buildSnapshot();
  const admission = snapshot.admission;
  assert.equal(admission.status, "excluded");
  assert.equal(admission.content_rows_admitted, 0);
  assert.equal(admission.supplied_mirror_choice, "deny");
  assert.equal(admission.supplied_training_choice, "allow");
  assert.equal(admission.independent_admission_performed, false);
  assert.equal(admission.carried_action_authority, false);
  assert.match(admission.reasons.join("\n"), /mirror: deny/);
  assert.match(admission.reasons.join("\n"), /one fictional correction turn/);
  assert.equal(snapshot.manifest.claim_feedback_content_rows, 0);

  const receiptText = JSON.stringify(admission);
  assert.equal(receiptText.includes(FIXTURE.claim.text), false);
  assert.equal(receiptText.includes(FIXTURE.challenge.text), false);
  assert.equal(receiptText.includes(FIXTURE.response.replacement_claim), false);
  assert.equal(Object.hasOwn(admission, "source_packet_sha256"), false);
  assert.deepEqual(admission.effects, {
    network_requests: 0,
    hub_repositories_created: 0,
    hub_uploads: 0,
    models_run: 0,
    training_runs: 0,
    karma_writes: 0,
  });
});

test("the committed release is an exact deterministic snapshot", async () => {
  const receipt = await checkCommittedRelease();
  assert.equal(receipt.status, "match");
  assert.equal(receipt.rows, 31);
  assert.equal(receipt.claim_feedback_content_rows, 0);
  assert.equal(receipt.writes, 0);

  const snapshot = await buildSnapshot();
  const diskPaths = walk(RELEASE_PATH);
  assert.deepEqual(diskPaths, [...snapshot.files.keys()].sort());
  for (const [path, bytes] of snapshot.files) {
    assert.deepEqual(readFileSync(new URL(`./release/${path}`, HERE)), bytes, path);
  }
});

test("manifest and SHA256SUMS bind every release file except the checksum file", async () => {
  const snapshot = await buildSnapshot();
  const manifest = JSON.parse(snapshot.files.get("manifest.json"));
  const checksums = snapshot.files.get("SHA256SUMS").toString("utf8").trim().split("\n");
  const covered = checksums.map((line) => line.slice(66));
  assert.deepEqual(
    covered,
    [...snapshot.files.keys()]
      .filter((path) => path !== "SHA256SUMS")
      .sort(),
  );
  assert.deepEqual(
    manifest.files.map((item) => item.path),
    [...snapshot.files.keys()]
      .filter((path) => !new Set(["manifest.json", "SHA256SUMS"]).has(path))
      .sort(),
  );
  for (const line of checksums) assert.match(line, /^[a-f0-9]{64}  [A-Za-z0-9_./-]+$/);
});

test("build writes one private new directory and refuses replacement", async () => {
  const parent = mkdtempSync(join(tmpdir(), "rhetorlint-hf-test-"));
  try {
    const output = join(parent, "release");
    const receipt = await writeSnapshot(output);
    assert.equal(receipt.files_written, 9);
    assert.equal(receipt.rows, 31);
    assert.equal(receipt.network_requests, 0);
    assert.equal(lstatSync(output).mode & 0o777, 0o700);
    assert.equal(lstatSync(join(output, "README.md")).mode & 0o777, 0o600);
    assert.deepEqual(walk(output), walk(RELEASE_PATH));
    for (const path of walk(output)) {
      assert.deepEqual(readFileSync(join(output, path)), readFileSync(new URL(`./release/${path}`, HERE)));
    }
    await assert.rejects(writeSnapshot(output), /already exists/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("the off-switch wins before dataset input read or direct output creation", async () => {
  const parent = mkdtempSync(join(tmpdir(), "rhetorlint-hf-halt-test-"));
  const target = join(parent, "release");
  const previous = process.env[HALT_ENV];
  let output = "";
  process.env[HALT_ENV] = "1";
  try {
    await assert.rejects(
      runCli(["check"], {
      stdout: { write(value) { output += value; } },
      }),
      /before dataset input read/,
    );
    await assert.rejects(writeSnapshot(target), /before dataset input read/);
    assert.equal(output, "");
    assert.equal(existsSync(target), false);
  } finally {
    if (previous === undefined) delete process.env[HALT_ENV];
    else process.env[HALT_ENV] = previous;
    rmSync(parent, { recursive: true, force: true });
  }
});

test("the data-only builder has no project-code, network, model, Hub, child-process, or timer door", async () => {
  const source = readFileSync(new URL("./build.mjs", HERE), "utf8");
  for (const forbidden of [
    /node:https/u,
    /node:http/u,
    /\bfetch\s*\(/u,
    /node:child_process/u,
    /setInterval\s*\(/u,
    /setTimeout\s*\(/u,
    /huggingface_hub/u,
    /HfApi/u,
    /upload_folder/u,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
  assert.doesNotMatch(source, /from\s+["']\.\.?\//u);
  assert.doesNotMatch(source, /\bimport\s*\(/u);
  const buildBody = source.slice(source.indexOf("export async function buildSnapshot()"));
  assert.ok(
    buildBody.indexOf("assertRunning();") < buildBody.indexOf("readBoundedRegular("),
    "the brake precedes every dataset input read",
  );
  const result = await buildSnapshot();
  assert.deepEqual(result.manifest.effects, {
    network_requests: 0,
    hub_repositories_created: 0,
    hub_uploads: 0,
    models_run: 0,
    training_runs: 0,
    karma_writes: 0,
  });
});

test("check CLI prints one bounded receipt and changes no release byte", async () => {
  const before = new Map(walk(RELEASE_PATH).map((path) => [
    path,
    readFileSync(new URL(`./release/${path}`, HERE)),
  ]));
  let output = "";
  assert.equal(await runCli(["check"], {
    stdout: { write(value) { output += value; } },
  }), 0);
  const receipt = JSON.parse(output);
  assert.equal(receipt.status, "match");
  for (const [path, bytes] of before) {
    assert.deepEqual(readFileSync(new URL(`./release/${path}`, HERE)), bytes);
  }
});
