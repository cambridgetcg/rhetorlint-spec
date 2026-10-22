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
  PUBLICATION,
  RELEASE_SCHEMA,
  SOURCE_MANIFEST_SCHEMA,
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
const CORE_PACKAGE = JSON.parse(readFileSync(new URL("../../packages/core/package.json", HERE), "utf8"));
const RULES = JSON.parse(readFileSync(new URL("../../packages/rules-en/rules.json", HERE), "utf8"));

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

test("the snapshot is all 76 conformance cases and no invented training split", async () => {
  assert.doesNotThrow(() => assertSupported(SCHEMA));
  const snapshot = await buildSnapshot();
  assert.equal(snapshot.rows.length, 76);
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
    assert.equal(row.provenance.source_revision, "fcc205e42d9857e05b668c5ff7847f8ffba0930e");
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
    unique_inputs: 76,
    minimum_input_characters: 16,
    maximum_input_characters: 117,
    marks: 68,
    marked_cases: 46,
    zero_mark_cases: 30,
    rules_in_pack: 22,
    rules_observed: 22,
    families_observed: 6,
    strip_outputs_changed: 18,
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

test("the publication record names the npm releases that carry the locked engine and rule pack", async () => {
  assert.equal(Object.isFrozen(PUBLICATION), true);
  assert.equal(Object.isFrozen(PUBLICATION.provenance_review.outside_text[0]), true);
  const bySource = new Map(PUBLICATION.npm_packages.map((item) => [item.source, item]));
  assert.deepEqual([...bySource.keys()].sort(), ["core", "rules"]);
  assert.equal(bySource.get("core").spec, `${CORE_PACKAGE.name}@${CORE_PACKAGE.version}`);
  assert.equal(bySource.get("core").file, CORE_PACKAGE.main);
  assert.equal(bySource.get("rules").spec, `${RULES.id}@${RULES.version}`);
  assert.equal(bySource.get("rules").file, "rules.json");

  const { sourceManifest } = await buildSnapshot();
  assert.deepEqual(sourceManifest.published_sources, {
    registry: "npm",
    packages: [
      {
        package: `${CORE_PACKAGE.name}@${CORE_PACKAGE.version}`,
        file: "index.mjs",
        sha256: sourceManifest.sources.core.sha256,
        digest_recorded_at: "sources.core.sha256",
      },
      {
        package: `${RULES.id}@${RULES.version}`,
        file: "rules.json",
        sha256: sourceManifest.sources.rules.sha256,
        digest_recorded_at: "sources.rules.sha256",
      },
    ],
  });
});

test("the release states its public status, decision, review and authority apart", async () => {
  const { manifest, sourceManifest } = await buildSnapshot();
  assert.equal(manifest.schema, RELEASE_SCHEMA);
  assert.equal(RELEASE_SCHEMA, "rhetorlint.conformance-hf-release/0.2");
  assert.equal(sourceManifest.schema, SOURCE_MANIFEST_SCHEMA);
  assert.equal(SOURCE_MANIFEST_SCHEMA, "rhetorlint.conformance-source-manifest/0.2");
  assert.equal(manifest.status, "public-release");
  assert.equal(sourceManifest.status, "public-release");
  assert.equal(sourceManifest.source_repository.visibility_at_release, "private");

  const review = sourceManifest.input_provenance.project_authorship_review;
  assert.equal(
    Object.hasOwn(sourceManifest.input_provenance, "project_authorship_reconfirmation_required_before_publication"),
    false,
  );
  assert.equal(review.date, "2026-10-20");
  assert.equal(review.reviewer, "Claude Code (AI agent)");
  assert.match(review.finding, /one AI agent's review, not a legal opinion/);
  assert.deepEqual(review.outside_text.map((item) => item.source_case_index), [12, 42, 46, 49, 50]);
  for (const item of review.outside_text) {
    assert.ok(CORPUS.cases[item.source_case_index], `case ${item.source_case_index} exists`);
    assert.equal(
      CORPUS.cases[item.source_case_index].input.split(/\s+/u).length,
      item.words,
      `case ${item.source_case_index} word count`,
    );
  }
  assert.ok(review.method.length > 0 && review.limits.length > 0);
  assert.equal(review.method.some((step) => /searched on the web as exact phrases/.test(step)), false);
  assert.equal(review.limits.some((limit) => /^An exact-phrase search/.test(limit)), false);
  for (const item of review.outside_text) assert.doesNotMatch(item.origin, /the project wrote/);

  // The source file records no field run, but cases 10 to 14 came from one.
  assert.equal(Object.hasOwn(sourceManifest.input_provenance, "sampled_external_corpus_recorded"), false);
  assert.match(sourceManifest.input_provenance.field_run_inputs, /^cases 10 to 14 /);
  const fragments = sourceManifest.input_provenance.fragment_licence_reasoning;
  assert.equal(fragments.by, "Claude Code, an AI agent");
  assert.deepEqual(fragments.source_case_indexes, [46, 49, 50]);

  const authority = sourceManifest.authority;
  assert.equal(Object.hasOwn(authority, "upload_authorized"), false);
  assert.equal(authority.hub_repository_created_by_builder, false);
  assert.equal(authority.hub_upload_by_builder, false);
  // The maintainer's words, verbatim; the agent's reading of them sits apart.
  assert.deepEqual(authority.release_decision, {
    date: "2026-10-20",
    decided_by: "the project maintainer",
    words: "go for both npm publish and huggingface dataset",
  });
  assert.equal(authority.release_reading.read_by, "Claude Code, an AI agent");
  assert.equal(authority.release_confirmation.confirmed_by, "the project maintainer");
  assert.equal(authority.release_confirmation.options_offered_by, "Claude Code, an AI agent");
  assert.match(authority.release_confirmation.chose, /^a public dataset after private staging/);
  assert.match(authority.release_reading.reading, /public Hugging Face dataset/);
  assert.match(authority.release_reading.reading, /@rhetorlint\/core@0\.1\.4 and @rhetorlint\/rules-en@0\.2\.1/);
  assert.equal(authority.prepared_by, "Claude Code, an AI agent");
  assert.match(authority.upload_carried_out_by, /^Claude Code, an AI agent, .*outside the builder$/);
  assert.equal(authority.model_or_training_authorized, false);
  assert.equal(authority.carried_action_authority, false);
  // The maintainer decided; the agent did the work. Neither field names the other.
  assert.doesNotMatch(JSON.stringify(authority.release_decision), /Claude|agent/);
  assert.doesNotMatch(authority.upload_carried_out_by, /maintainer/);
});

test("the card is valid Hub metadata and says what is true once public", async () => {
  const card = (await buildSnapshot()).files.get("README.md").toString("utf8");
  const front = card.match(/^---\n([\s\S]*?)\n---\n/u);
  assert.ok(front, "YAML front matter opens the card");
  assert.match(front[1], /^license: mit$/mu);
  assert.match(front[1], /^configs:\n- config_name: conformance\n  default: true\n  data_files:\n  - split: test\n    path: data\/test-\*\.jsonl$/mu);

  for (const gone of [
    "Reconfirm input",
    "public release still requires",
    "local review material",
    "until a separate exact",
    "records no sampled external corpus",
    "](https://github.com/",
    "in the public domain",
    "that the project wrote",
    "Models may already have seen the repository.",
    "The frame is short, public,",
    "Provenance names",
  ]) {
    assert.equal(card.includes(gone), false, `card no longer says: ${gone}`);
  }
  const flat = card.replace(/\s+/gu, " ");
  for (const said of [
    "case 12 adapts 11 words of bitcoin.org's introduction, which that site releases under MIT",
    "Cases 10 to 14 entered with fixes for false positives and gaps that a field run found, recorded on 2026-07-23.",
    "case 42 repeats 5 words of a 2015 breach notice by a US federal agency, a work not subject to copyright in the United States.",
    "Cases 46, 49 and 50 repeat or closely follow 7 to 10 words of three invented measurement items written for the repository by an AI agent, which the project offers under CC-BY-SA-4.0.",
    "Claude Code, an AI agent, judged that the 7 to 10 stock words these cases share with the measurement items are too short to carry the items' share-alike terms, so the MIT offer that covers the repository's conformance fixture covers these cases too; that is an AI agent's reasoning, not a licence grant.",
    "On 2026-10-20, Claude Code, an AI agent, reviewed all 76 inputs",
    "That is one AI agent's review, not a legal opinion",
    "`github.com/cambridgetcg/rhetorlint-spec`, which is not public at present. URLs in the rows, schema and manifests that name it are identifiers; they do not open while it is private.",
    "The source repository was public for a time before this release, so models may already have seen many of these inputs, and this public release can carry them into later training data.",
    `published on npm as \`${RULES.id}@${RULES.version}\` and \`${CORE_PACKAGE.name}@${CORE_PACKAGE.version}\`, whose \`rules.json\` and \`index.mjs\` match the SHA-256 digests in \`metadata/source-manifest.json\``,
    "The builder makes no network request, creates no Hugging Face repository, and runs no model or training; `manifest.json`'s `effects` describe the build alone.",
    "The upload was a separate step, taken after the provenance review. On 2026-10-20 the project maintainer said: \"go for both npm publish and huggingface dataset\". Claude Code, an AI agent, read that as: release this snapshot as a public Hugging Face dataset, staged privately first, after npm releases of @rhetorlint/core@0.1.4 and @rhetorlint/rules-en@0.2.1 that carry the engine and rule pack it is locked to. On 2026-10-22 the maintainer confirmed it, choosing among options the agent offered: a public dataset after private staging, and npm releases of @rhetorlint/core@0.1.4, @rhetorlint/rules-en@0.2.1 and @rhetorlint/cli@0.2.0 with two deprecations of older versions. The agent prepared and uploaded this release.",
    "Deletion from a later Hub revision would not prove erasure of old revisions, caches, forks, downloads or trained models.",
    "No withdrawal mechanism is implemented; a later release re-checks source and rights state first.",
    "the Provenance section names the short text from elsewhere that some inputs repeat, and the review behind this release.",
  ]) {
    assert.ok(flat.includes(said), `card says: ${said}`);
  }
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
  assert.equal(receipt.rows, 76);
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
    assert.equal(receipt.rows, 76);
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
