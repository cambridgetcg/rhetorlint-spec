#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DATASET_SCHEMA = "rhetorlint.conformance-evaluation-row/0.1";
export const RELEASE_SCHEMA = "rhetorlint.conformance-hf-release/0.2";
export const ADMISSION_SCHEMA = "rhetorlint.claim-feedback-dataset-admission/0.1";
export const SOURCE_MANIFEST_SCHEMA = "rhetorlint.conformance-source-manifest/0.2";
export const HALT_ENV = "RHETORLINT_DATASET_HALT";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..", "..");
const COMMITTED_RELEASE = join(HERE, "release");
const SOURCE_REPOSITORY = "https://github.com/cambridgetcg/rhetorlint-spec";
const SOURCE_REVISION = "fcc205e42d9857e05b668c5ff7847f8ffba0930e";
const PATHS = Object.freeze({
  cases: join(REPO, "conformance", "cases.json"),
  core: join(REPO, "packages", "core", "index.mjs"),
  rules: join(REPO, "packages", "rules-en", "rules.json"),
  fixture: join(REPO, "examples", "claim-feedback", "fixtures", "corrected-claim.json"),
  rowSchema: join(HERE, "row.schema.json"),
  builder: fileURLToPath(import.meta.url),
  license: join(REPO, "LICENSE"),
  notice: join(REPO, "NOTICE"),
});
const SOURCE_LOCK = Object.freeze({
  cases: "sha256:c90aaaa4cc471fa6653e4bba1646d3dafb76a42cf3104a86d1d26aac5fd5e472",
  core: "sha256:7dd2d7f9d8437e9883962591e34285229f5df8f4ccfdc31478a3bf8642037472",
  rules: "sha256:b2201836c8d0050600066215fa73bb93fb1560f7bec54c35a7d4a87dd28f000a",
  fixture: "sha256:cc8cbca3750d4bf7917c2161c95db3abc2787ee0995463470f79143f924a9e5c",
  license: "sha256:a1613ba5d78294b212dfdb6691181c104c4620a848ebc17a5307d769418b0d29",
  notice: "sha256:5b8345db04a6820b9e96a31dccb4e940a0196232dff39fe9ab2ff0ef5d724c72",
});
const TASKS = Object.freeze([
  "reference-output-reproduction",
  "reference-mark-span-reproduction",
  "reference-strip-reproduction",
]);
const ROW_LIMITS = Object.freeze([
  "Expected outputs come from the JavaScript reference engine, not independent human annotation.",
  "These rows test exact RhetorLint behavior; they do not establish factual truth, deception, intent, ego, or trustworthiness.",
  "All source inputs are ASCII; cross-engine matching and offsets are not claimed for non-ASCII text.",
  "Seventy-six conformance cases are too small for model training, generalisation, fairness, or calibration claims.",
  "Strip text, expected suggestions, and confidence values are rule-pack outputs, not human corrections, preferred answers, or calibrated probabilities.",
  "Only six rule-pack families appear; the unseeded justification taxonomy family is absent.",
]);

function freezeDeep(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

// The record of this release. The project maintainer decided it; an AI agent
// prepared it, reviewed its provenance and uploaded it, outside this builder.
// Keep the two apart: never record the agent's choices as the maintainer's.
// release_decision.words quotes the maintainer exactly; what the agent read
// into those words (visibility, packages, order) sits in release_reading.
// A later release replaces this record after its own review; it is not edited
// to describe a release that did not happen.
export const PUBLICATION = freezeDeep({
  status: "public-release",
  release_decision: {
    date: "2026-10-20",
    decided_by: "the project maintainer",
    words: "go for both npm publish and huggingface dataset",
  },
  release_reading: {
    read_by: "Claude Code, an AI agent",
    reading: "release this snapshot as a public Hugging Face dataset, staged privately first, after npm releases of @rhetorlint/core@0.1.4 and @rhetorlint/rules-en@0.2.1 that carry the engine and rule pack it is locked to",
  },
  release_confirmation: {
    date: "2026-10-22",
    confirmed_by: "the project maintainer",
    chose: "a public dataset after private staging, and npm releases of @rhetorlint/core@0.1.4, @rhetorlint/rules-en@0.2.1 and @rhetorlint/cli@0.2.0 with two deprecations of older versions",
    options_offered_by: "Claude Code, an AI agent",
  },
  prepared_by: "Claude Code, an AI agent",
  provenance_reviewed_by: "Claude Code, an AI agent",
  uploaded_by: "Claude Code, an AI agent",
  provenance_review: {
    date: "2026-10-20",
    reviewer: "Claude Code (AI agent)",
    scope: "all 76 inputs in conformance/cases.json and every free-text field of the matching rows, checked for origin, quotation of published text, personal data, allegations about named parties, and content unfit for a public dataset",
    method: [
      "a script confirmed that the rows equal the source cases one to one, with 0 mismatches",
      "every input and every distinct note, suggestion, technique and strip string was read",
      "each input was traced to its earliest commit in the history of conformance/cases.json and that commit's message",
      "inputs were scanned for word runs shared with the repository's tracked files and with local uncommitted corpora",
      "17 inputs that could be real quotations were searched on the web; five of them (cases 0, 12, 68, 69 and 70) were also searched as exact phrases",
    ],
    finding: "No blocker to a public MIT release was found: no private personal data, no allegation about a named party, no unfit content, and no third-party text long enough to matter. This is one AI agent's review, not a legal opinion.",
    outside_text: [
      {
        source_case_index: 12,
        words: 11,
        origin: "adapts the bitcoin.org introduction ('the issuing of bitcoins is carried out collectively by the network'), with 'bitcoins' changed to 'coins'",
        origin_licence: "MIT, as stated in the bitcoin.org footer",
        entered: "a false positive from the field run recorded on 2026-07-23, kept as a negative control",
      },
      {
        source_case_index: 42,
        words: 5,
        origin: "repeats the last words of a sentence in the US Office of Personnel Management's 2015 breach notice",
        origin_licence: "a US federal work, not subject to copyright in the United States (17 U.S.C. 105)",
        entered: "2026-10-19, from a measurement specimen quoted in the Open Lens lexicon",
      },
      {
        source_case_index: 46,
        words: 7,
        origin: "repeats a clause of measurement/items/inv-breach-apology.txt, an invented item an AI agent wrote for the repository",
        origin_licence: "CC-BY-SA-4.0, as the project offers that item (measurement/NOTICE section 4)",
        entered: "2026-10-19, after the item",
      },
      {
        source_case_index: 49,
        words: 9,
        origin: "repeats the start of a sentence of measurement/items/inv-science-abstract.txt, an invented item an AI agent wrote for the repository",
        origin_licence: "CC-BY-SA-4.0, as the project offers that item (measurement/NOTICE section 4)",
        entered: "2026-10-19, after the item",
      },
      {
        source_case_index: 50,
        words: 10,
        origin: "closely follows a sentence of measurement/items/inv-recipe.txt, an invented item an AI agent wrote for the repository, sharing an 8-word run",
        origin_licence: "CC-BY-SA-4.0, as the project offers that item (measurement/NOTICE section 4)",
        entered: "2026-10-19, after the item",
      },
    ],
    notes: [
      "'Mistakes were made' (cases 0, 6, 39 and 58 to 61) is a well-known political phrase; no speaker is named.",
      "Cases 68 to 70 read like breach notices; the repository records them as constructed probes, and no verbatim source was found.",
      "Case 30 names Forbes as the source of praise for an unnamed startup; it quotes no Forbes text and alleges nothing.",
      "The only personal name is the bare first name in case 47; no row holds an email address, phone number, postal address or account number.",
      "Several inputs are short stock phrases with no single source.",
    ],
    limits: [
      "A web search that finds nothing does not prove a sentence was never published; paywalled archives, books and ad libraries were not searched.",
      "The overlap scan finds verbatim or near-verbatim word runs, not paraphrase.",
      "Two earlier sources could not be checked for overlap: the uncommitted 105-item headline corpus used to measure the rules behind cases 15 to 30 (those inputs are listed in the committed plan, docs/superpowers/plans/2026-07-27-media-wave.md), and the pages scanned in the field run, recorded on 2026-07-23, behind cases 10 to 14.",
      "Copyright, licence and defamation judgments here are reasoned, not legal advice.",
    ],
  },
  // Added after the provenance review, by the agent preparing the release; it
  // is reasoning, not a licence grant or the maintainer's word.
  fragment_licence_reasoning: {
    by: "Claude Code, an AI agent",
    date: "2026-10-20",
    source_case_indexes: [46, 49, 50],
    reasoning: "the 7 to 10 stock words these cases share with the measurement items are too short to carry the items' share-alike terms, so the MIT offer that covers the repository's conformance fixture covers these cases too",
  },
  npm_packages: [
    { spec: "@rhetorlint/core@0.1.4", file: "index.mjs", source: "core" },
    { spec: "@rhetorlint/rules-en@0.2.1", file: "rules.json", source: "rules" },
  ],
});

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertRunning() {
  if (process.env[HALT_ENV] === "1") {
    throw new Error(`stopped by ${HALT_ENV}=1 before dataset input read`);
  }
}

function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort(compareCodeUnits).map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
}

function exactKeys(value, expected, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

function readBoundedRegular(path, maxBytes) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw new Error("this platform does not expose O_NOFOLLOW");
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 0 || stat.size > maxBytes) {
      throw new RangeError(`${path} must be a regular file no larger than ${maxBytes} bytes`);
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error(`${path} changed while being read`);
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (readSync(descriptor, extra, 0, 1, offset) !== 0) {
      throw new Error(`${path} grew while being read`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function assertSourceLock(namedBytes) {
  for (const [name, expected] of Object.entries(SOURCE_LOCK)) {
    const actual = digestBytes(namedBytes[name]);
    if (actual !== expected) {
      throw new TypeError(`${name} differs from source revision ${SOURCE_REVISION}`);
    }
  }
}

function assertConformanceSource(corpus, rules) {
  exactKeys(corpus, ["spec", "rules", "note", "cases"], "$corpus");
  if (corpus.spec !== "0.1" || corpus.rules !== `${rules.id}@${rules.version}`) {
    throw new TypeError("conformance metadata does not match the current rule pack");
  }
  if (!Array.isArray(corpus.cases) || corpus.cases.length !== 76) {
    throw new TypeError("conformance source must contain the reviewed 76-case frame");
  }
  corpus.cases.forEach((item, caseIndex) => {
    const path = `$corpus.cases[${caseIndex}]`;
    exactKeys(item, ["input", "density", "strip", "marks"], path);
    if (typeof item.input !== "string" || item.input.length === 0 || !/^[\x00-\x7f]*$/u.test(item.input)) {
      throw new TypeError(`${path}.input must be nonempty ASCII text`);
    }
    if (!Array.isArray(item.marks)) throw new TypeError(`${path}.marks must be an array`);
    item.marks.forEach((mark, markIndex) => {
      const markPath = `${path}.marks[${markIndex}]`;
      exactKeys(mark, [
        "ruleId", "family", "technique", "actual", "start", "end",
        "note", "confidence", "level", "expected",
      ], markPath);
      if (
        !Number.isInteger(mark.start)
        || !Number.isInteger(mark.end)
        || mark.start < 0
        || mark.end <= mark.start
        || item.input.slice(mark.start, mark.end) !== mark.actual
      ) {
        throw new TypeError(`${markPath} must bind an exact visible input span`);
      }
    });
  });
}

function buildRow(item, caseIndex, method) {
  const inputSha256 = digestBytes(Buffer.from(item.input, "utf8"));
  const suffix = inputSha256.slice("sha256:".length, "sha256:".length + 12);
  const ruleIds = [...new Set(item.marks.map((mark) => mark.ruleId))].sort();
  const families = [...new Set(item.marks.map((mark) => mark.family))].sort();
  return {
    schema: DATASET_SCHEMA,
    row_id: `conformance-${String(caseIndex).padStart(3, "0")}-${suffix}`,
    split: "test",
    tasks: [...TASKS],
    input_text: item.input,
    input_sha256: inputSha256,
    expected: {
      density: { ...item.density },
      strip: item.strip,
      marks: item.marks.map((mark) => ({
        ...mark,
        expected: [...mark.expected],
      })),
    },
    label_summary: { rule_ids: ruleIds, families },
    provenance: {
      source_repository: SOURCE_REPOSITORY,
      source_revision: SOURCE_REVISION,
      source_path: "conformance/cases.json",
      source_case_index: caseIndex,
      source_sha256: method.cases_sha256,
      rules_id: method.rules_id,
      rules_version: method.rules_version,
      rules_source_sha256: method.rules_source_sha256,
      core_source_sha256: method.core_source_sha256,
      expected_outputs_origin: "generated-by-js-reference-engine-and-committed-as-reference-output",
      independent_human_labels: false,
      input_ascii: true,
      cross_engine_scope: "python-compares-full-projection-go-omits-expected-suggestions-and-allows-float-tolerance",
    },
    limits: [...ROW_LIMITS],
  };
}

function buildClaimFeedbackAdmission(fixtureBytes) {
  const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fixtureBytes));
  if (input.schema !== "claim-feedback.input/0.1" || !input.reuse || typeof input.reuse !== "object") {
    throw new TypeError("Claim Feedback fixture must expose its exact reuse declaration");
  }
  if (input.reuse.mirror !== "deny") {
    throw new TypeError("Claim Feedback fixture must remain excluded from mirror packaging");
  }
  return {
    schema: ADMISSION_SCHEMA,
    source_path: "examples/claim-feedback/fixtures/corrected-claim.json",
    source_input_sha256: digestBytes(Buffer.from(canonicalJson(input), "utf8")),
    source_file_sha256: digestBytes(fixtureBytes),
    status: "excluded",
    content_rows_admitted: 0,
    supplied_training_choice: input.reuse.training,
    supplied_mirror_choice: input.reuse.mirror,
    independent_admission_performed: false,
    reasons: [
      "public or private Hub packaging is a mirror use, and the supplied declaration says mirror: deny",
      "the dataset builder performs no rights, privacy, safety, or provenance admission",
      "one fictional correction turn cannot support training or benchmark claims",
    ],
    retained_content: "digests-and-exclusion-reasons-only",
    carried_action_authority: false,
    effects: {
      network_requests: 0,
      hub_repositories_created: 0,
      hub_uploads: 0,
      models_run: 0,
      training_runs: 0,
      karma_writes: 0,
    },
  };
}

function corpusStats(corpus, rules) {
  const inputs = corpus.cases.map((item) => item.input);
  const marks = corpus.cases.flatMap((item) => item.marks);
  const observedRuleIds = new Set(marks.map((mark) => mark.ruleId));
  const observedFamilies = new Set(marks.map((mark) => mark.family));
  return {
    unique_inputs: new Set(inputs).size,
    minimum_input_characters: Math.min(...inputs.map((input) => input.length)),
    maximum_input_characters: Math.max(...inputs.map((input) => input.length)),
    marks: marks.length,
    marked_cases: corpus.cases.filter((item) => item.marks.length > 0).length,
    zero_mark_cases: corpus.cases.filter((item) => item.marks.length === 0).length,
    rules_in_pack: rules.rules.length,
    rules_observed: observedRuleIds.size,
    families_observed: observedFamilies.size,
    strip_outputs_changed: corpus.cases.filter((item) => item.strip !== item.input).length,
  };
}

function npmSpec(source) {
  return PUBLICATION.npm_packages.find((item) => item.source === source).spec;
}

function datasetCard(rowCount, dataSha256, stats) {
  return `---
pretty_name: RhetorLint Conformance Evaluation
license: mit
language:
- en
tags:
- evaluation
- rhetorical-analysis
- provenance
size_categories:
- n<1K
configs:
- config_name: conformance
  default: true
  data_files:
  - split: test
    path: data/test-*.jsonl
---

# RhetorLint Conformance Evaluation

${rowCount} exact cases derived from RhetorLint's committed conformance
fixture. The JSONL shard digest is \`${dataSha256}\`.

## What the rows support

- reproducing the reference engine's exact density, strip text and visible
  mark spans;
- testing reference span-output, multi-label and text-to-text pipeline
  plumbing; and
- comparing RhetorLint implementations on the committed input frame.

This release has only a \`test\` split. It has no \`train\` or \`validation\`
split because 76 reference-generated cases are not a training corpus or a
generalisation benchmark.

## Provenance

The source file treats the inputs as designed repository conformance fixtures,
and most were written for the tests. Cases are numbered by
\`source_case_index\`. Cases 10 to 14 entered with fixes for false positives
and gaps that a field run found, recorded on 2026-07-23. Two inputs repeat
short text from elsewhere: case 12 adapts 11 words of bitcoin.org's
introduction, which that site releases under MIT, and case 42 repeats 5 words
of a 2015 breach notice by a US federal agency, a work not subject to copyright
in the United States. Cases 46, 49 and 50 repeat or closely follow 7 to 10
words of three invented measurement items written for the repository by an AI
agent, which the project offers under CC-BY-SA-4.0.
${PUBLICATION.fragment_licence_reasoning.by}, judged that
${PUBLICATION.fragment_licence_reasoning.reasoning}; that is an AI agent's
reasoning, not a licence grant.

The expected values were generated by the JavaScript reference engine and
committed as reference outputs after project review. This is implementation
conformance, not independent human annotation or a sample of naturally
occurring language.

On ${PUBLICATION.provenance_review.date}, ${PUBLICATION.provenance_reviewed_by}, reviewed all ${rowCount} inputs for
origin, personal data, claims about named parties and unfit content, and found
nothing that blocks a public MIT release. That is one AI agent's review, not a
legal opinion; \`metadata/source-manifest.json\` records its scope, method,
notes and limits.

The locked source is revision \`${SOURCE_REVISION}\` of
\`github.com/cambridgetcg/rhetorlint-spec\`, which is not public at present.
URLs in the rows, schema and manifests that name it are identifiers; they do
not open while it is private. Its rule pack and engine are published on npm as
\`${npmSpec("rules")}\` and \`${npmSpec("core")}\`, whose \`rules.json\` and \`index.mjs\` match the SHA-256
digests in \`metadata/source-manifest.json\`.
The stored technique names follow the project's documented SemEval-2023 to
SemEval-2020 taxonomy mapping; that taxonomy file is not copied here.

This data-only builder does not execute a RhetorLint engine. The repository's
separate JavaScript and Python checks compare the complete committed
projection. Its Go check compares density within a small numeric tolerance,
strip text, and all stored mark fields except the \`expected\` suggestion
arrays. This release does not claim a stronger cross-engine check.

All input strings are ASCII. Complete rows are UTF-8 and may contain Unicode
punctuation in notes. RhetorLint's engines do not currently agree on matching
or offsets for general non-ASCII input.

## Measured frame

- ${stats.unique_inputs} unique inputs, ${stats.minimum_input_characters}–${stats.maximum_input_characters} characters each;
- ${stats.marks} marks across ${stats.marked_cases} marked cases and ${stats.zero_mark_cases} zero-mark controls;
- ${stats.rules_observed}/${stats.rules_in_pack} current English rules observed across ${stats.families_observed} families; and
- ${stats.strip_outputs_changed}/${rowCount} strip outputs differ from their inputs.

The unseeded justification taxonomy family is absent.

The frame is short, rule-designed, highly imbalanced, and not a blind holdout.
The source repository was public for a time before this release, so models may
already have seen many of these inputs, and this public release can carry them
into later training data. Mark offsets are
zero-based, start-inclusive and end-exclusive. ASCII makes UTF-8 byte,
Unicode code-point and UTF-16 indices coincide for these inputs.

## Claim Feedback admission

\`metadata/claim-feedback-admission.json\` records that the sole fictional
Claim Feedback fixture contributed zero content rows. Its supplied reuse lane
says \`mirror: deny\`. This data-only builder performs no independent admission
and keeps only source digests and exclusion reasons.

## Uses and limits

Use this snapshot for conformance and small evaluation-pipeline smoke tests.
Do not use it as a truth, lie, intent, ego, trustworthiness, factuality,
fairness, multilingual, calibration, or model-quality benchmark. A wording
mark is a reading prompt, not evidence that a claim is false or knowingly
deceptive. Strip text, each mark's \`expected\` suggestions, and confidence
values are deterministic rule-pack outputs—not human corrections, preferred
model answers, or calibrated probabilities.

The builder makes no network request, creates no Hugging Face repository, and
runs no model or training; \`manifest.json\`'s \`effects\` describe the build
alone. The upload was a separate step, taken after the provenance review. On
${PUBLICATION.release_decision.date} the project maintainer said:
"${PUBLICATION.release_decision.words}".
${PUBLICATION.release_reading.read_by}, read that as:
${PUBLICATION.release_reading.reading}. On ${PUBLICATION.release_confirmation.date}
the maintainer confirmed it, choosing among options the agent offered:
${PUBLICATION.release_confirmation.chose}. The agent prepared and uploaded this
release.
Deletion from a later Hub revision would not prove erasure of old revisions,
caches, forks, downloads or trained models.
No withdrawal mechanism is implemented; a later release re-checks source and
rights state first.

## Files

- \`data/test-00000-of-00001.jsonl\` — one closed row per conformance case;
- \`schema/row.schema.json\` — row shape;
- \`metadata/source-manifest.json\` — exact source and method receipts;
- \`metadata/claim-feedback-admission.json\` — zero-row exclusion receipt;
- \`manifest.json\` and \`SHA256SUMS\` — exact release inventory and bytes.

Licence: MIT, preserving the repository's LICENSE and NOTICE. The taxonomy
file's additional CC-BY-SA offer is not copied into this dataset. The release
derives from the repository's MIT-offered conformance fixture, rule pack, and
engine; the Provenance section names the short text from elsewhere that some
inputs repeat, and the review behind this release.
`;
}

function makeManifestFiles(files) {
  return [...files.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: digestBytes(bytes),
    }));
}

export async function buildSnapshot() {
  assertRunning();
  const casesBytes = readBoundedRegular(PATHS.cases, 1_000_000);
  const rulesBytes = readBoundedRegular(PATHS.rules, 1_000_000);
  const coreBytes = readBoundedRegular(PATHS.core, 1_000_000);
  const fixtureBytes = readBoundedRegular(PATHS.fixture, 256_000);
  const builderBytes = readBoundedRegular(PATHS.builder, 1_000_000);
  const schemaBytes = readBoundedRegular(PATHS.rowSchema, 256_000);
  const licenseBytes = readBoundedRegular(PATHS.license, 64_000);
  const noticeBytes = readBoundedRegular(PATHS.notice, 64_000);
  assertSourceLock({
    cases: casesBytes,
    rules: rulesBytes,
    core: coreBytes,
    fixture: fixtureBytes,
    license: licenseBytes,
    notice: noticeBytes,
  });
  const corpus = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(casesBytes));
  const rules = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rulesBytes));
  assertConformanceSource(corpus, rules);
  if (npmSpec("rules") !== `${rules.id}@${rules.version}`) {
    throw new TypeError("PUBLICATION must name the npm release of the locked rule pack");
  }
  const stats = corpusStats(corpus, rules);

  const method = {
    cases_sha256: digestBytes(casesBytes),
    rules_id: rules.id,
    rules_version: rules.version,
    rules_source_sha256: digestBytes(rulesBytes),
    core_source_sha256: digestBytes(coreBytes),
  };
  const rows = corpus.cases.map((item, index) => buildRow(item, index, method));
  const jsonl = Buffer.from(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  const admission = buildClaimFeedbackAdmission(fixtureBytes);
  const publishedDigests = {
    core: method.core_source_sha256,
    rules: method.rules_source_sha256,
  };
  const sourceManifest = {
    schema: SOURCE_MANIFEST_SCHEMA,
    status: PUBLICATION.status,
    source_repository: {
      url: SOURCE_REPOSITORY,
      revision: SOURCE_REVISION,
      immutable_tree: `${SOURCE_REPOSITORY}/tree/${SOURCE_REVISION}`,
      visibility_at_release: "private",
      source_lock_enforced: true,
    },
    published_sources: {
      registry: "npm",
      packages: PUBLICATION.npm_packages.map((item) => ({
        package: item.spec,
        file: item.file,
        sha256: publishedDigests[item.source],
        digest_recorded_at: `sources.${item.source}.sha256`,
      })),
    },
    selection: {
      source_frame: "all committed conformance cases in source order",
      source_case_count: corpus.cases.length,
      emitted_row_count: rows.length,
      omitted_source_cases: 0,
      split: "test",
      train_rows: 0,
      validation_rows: 0,
    },
    measured_frame: stats,
    input_provenance: {
      represented_by_source_as: "designed repository conformance fixtures",
      field_run_inputs: "cases 10 to 14 entered with fixes for false positives and gaps that a field run found, recorded on 2026-07-23; see project_authorship_review",
      project_authorship_review: PUBLICATION.provenance_review,
      fragment_licence_reasoning: PUBLICATION.fragment_licence_reasoning,
    },
    sources: {
      conformance_cases: {
        path: "conformance/cases.json",
        sha256: method.cases_sha256,
        bytes: casesBytes.length,
      },
      rules: {
        path: "packages/rules-en/rules.json",
        id: rules.id,
        version: rules.version,
        sha256: method.rules_source_sha256,
        bytes: rulesBytes.length,
      },
      core: {
        path: "packages/core/index.mjs",
        sha256: method.core_source_sha256,
        bytes: coreBytes.length,
      },
      claim_feedback_fixture: {
        path: "examples/claim-feedback/fixtures/corrected-claim.json",
        sha256: digestBytes(fixtureBytes),
        content_rows_admitted: 0,
      },
    },
    method: {
      builder_path: "datasets/rhetorlint-conformance/build.mjs",
      builder_sha256: digestBytes(builderBytes),
      row_schema_sha256: digestBytes(schemaBytes),
      expected_outputs_origin: "generated by the JavaScript reference engine and committed as reference output",
      independent_human_labels: false,
      cross_engine_checks: {
        run_by_builder: false,
        javascript_scope: "separate test compares the committed projection with the JavaScript reference engine",
        python_scope: "separate test compares the complete parsed projection",
        go_scope: "separate test checks density with numeric tolerance, strip, and mark fields except expected suggestions",
        required_before_publication: [
          "npm run test:conformance",
          "go -C impl/go test ./...",
        ],
      },
    },
    authority: {
      hub_repository_created_by_builder: false,
      hub_upload_by_builder: false,
      release_decision: PUBLICATION.release_decision,
      release_reading: PUBLICATION.release_reading,
      release_confirmation: PUBLICATION.release_confirmation,
      prepared_by: PUBLICATION.prepared_by,
      upload_carried_out_by: `${PUBLICATION.uploaded_by}, with the Hugging Face CLI outside the builder`,
      model_or_training_authorized: false,
      carried_action_authority: false,
    },
    refresh_policy: "explicit source and provenance review, then a new deterministic snapshot",
  };

  const files = new Map();
  files.set("LICENSE", Buffer.from(licenseBytes));
  files.set("NOTICE", Buffer.from(noticeBytes));
  files.set("data/test-00000-of-00001.jsonl", jsonl);
  files.set("schema/row.schema.json", Buffer.from(schemaBytes));
  files.set("metadata/source-manifest.json", jsonBytes(sourceManifest));
  files.set("metadata/claim-feedback-admission.json", jsonBytes(admission));
  files.set("README.md", Buffer.from(datasetCard(rows.length, digestBytes(jsonl), stats), "utf8"));

  const manifest = {
    schema: RELEASE_SCHEMA,
    status: PUBLICATION.status,
    config: "conformance",
    split: "test",
    rows: rows.length,
    train_rows: 0,
    claim_feedback_content_rows: 0,
    license: "MIT",
    measured_frame: stats,
    files: makeManifestFiles(files),
    checksums: {
      algorithm: "sha256",
      path: "SHA256SUMS",
      covers: "every release file except SHA256SUMS",
    },
    effects: {
      network_requests: 0,
      hub_repositories_created: 0,
      hub_uploads: 0,
      models_run: 0,
      training_runs: 0,
      karma_writes: 0,
    },
  };
  files.set("manifest.json", jsonBytes(manifest));
  const checksums = makeManifestFiles(files)
    .map((item) => `${item.sha256.slice("sha256:".length)}  ${item.path}`)
    .join("\n");
  files.set("SHA256SUMS", Buffer.from(`${checksums}\n`, "utf8"));

  return { files, rows, manifest, admission, sourceManifest };
}

function listReleaseFiles(root, current = root) {
  const found = [];
  for (const entry of readdirSync(current, { withFileTypes: true }).sort(
    (a, b) => compareCodeUnits(a.name, b.name),
  )) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new TypeError(`release contains a symbolic link: ${relative(root, path)}`);
    if (entry.isDirectory()) found.push(...listReleaseFiles(root, path));
    else if (entry.isFile()) found.push(relative(root, path).split(sep).join("/"));
    else throw new TypeError(`release contains a non-regular entry: ${relative(root, path)}`);
  }
  return found;
}

export async function checkCommittedRelease() {
  assertRunning();
  const snapshot = await buildSnapshot();
  const expected = [...snapshot.files.keys()].sort(compareCodeUnits);
  const actual = listReleaseFiles(COMMITTED_RELEASE).sort(compareCodeUnits);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new TypeError("committed release inventory differs from the deterministic snapshot");
  }
  for (const path of expected) {
    const disk = readBoundedRegular(join(COMMITTED_RELEASE, path), 10_000_000);
    const wanted = snapshot.files.get(path);
    if (!disk.equals(wanted)) throw new TypeError(`committed release drift: ${path}`);
  }
  return {
    kind: "rhetorlint-conformance-release-check",
    status: "match",
    files: expected.length,
    rows: snapshot.rows.length,
    claim_feedback_content_rows: snapshot.admission.content_rows_admitted,
    writes: 0,
    network_requests: 0,
    hub_uploads: 0,
    models_run: 0,
    training_runs: 0,
  };
}

function validateOutputTarget(value) {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("-")) {
    throw new TypeError("build needs one explicit output directory path");
  }
  const target = resolve(value);
  if (target === parse(target).root || basename(target).length === 0) {
    throw new TypeError("output directory is too broad");
  }
  if (existsSync(target)) throw new TypeError("output directory already exists");
  const parent = dirname(target);
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new TypeError("output parent must be an existing regular directory");
  }
  return target;
}

export async function writeSnapshot(outputPath) {
  assertRunning();
  const target = validateOutputTarget(outputPath);
  const snapshot = await buildSnapshot();
  assertRunning();
  const temporary = mkdtempSync(join(dirname(target), `.${basename(target)}.tmp-`));
  try {
    chmodSync(temporary, 0o700);
    for (const [relativePath, bytes] of [...snapshot.files.entries()].sort(
      ([a], [b]) => compareCodeUnits(a, b),
    )) {
      assertRunning();
      const destination = join(temporary, relativePath);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
    }
    assertRunning();
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return {
    kind: "rhetorlint-conformance-release-build",
    status: "written",
    output: target,
    files_written: snapshot.files.size,
    rows: snapshot.rows.length,
    claim_feedback_content_rows: snapshot.admission.content_rows_admitted,
    network_requests: 0,
    hub_uploads: 0,
    models_run: 0,
    training_runs: 0,
  };
}

export const HELP = `RhetorLint conformance Hugging Face snapshot

Usage:
  node datasets/rhetorlint-conformance/build.mjs check
  node datasets/rhetorlint-conformance/build.mjs build OUTPUT_DIRECTORY

check is read-only. build creates one new private directory and refuses an
existing path. No command has network, Hub upload, model, training, crawler,
KARMA, timer, or recurring-service capability. Set ${HALT_ENV}=1 to stop
before dataset inputs are read and at the write door.
`;

export async function runCli(argv = process.argv.slice(2), runtime = {}) {
  const stdout = runtime.stdout ?? process.stdout;
  assertRunning();
  if (argv.length === 1 && ["help", "--help", "-h"].includes(argv[0])) {
    stdout.write(HELP);
    return 0;
  }
  let receipt;
  if (argv.length === 1 && argv[0] === "check") receipt = await checkCommittedRelease();
  else if (argv.length === 2 && argv[0] === "build") receipt = await writeSnapshot(argv[1]);
  else throw new TypeError("expected: check, or build OUTPUT_DIRECTORY; use --help");
  stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  return 0;
}

// Compare real paths: on macOS /tmp is a symlink to /private/tmp, and a check
// run through it must still check (and fail when it should), not exit 0 silently.
const directPath = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (directPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    process.stderr.write(`rhetorlint-conformance-dataset: ${error.message}\n`);
    process.exitCode = 1;
  }
}
