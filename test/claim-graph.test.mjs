import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

import { assertSupported, validate } from "./helpers/schema-validator.mjs";

const SCHEMA = JSON.parse(
  readFileSync(new URL("../spec/claim-graph.schema.json", import.meta.url), "utf8")
);
const FIXTURE_URL = new URL(
  "../examples/claim-graph/fixtures/bounded-inquiry.json",
  import.meta.url
);
const GRAPH = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));

function clone(value) {
  return structuredClone(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function expectInvalid(value, pattern) {
  const errors = validate(value, SCHEMA);
  assert.ok(errors.some((error) => pattern.test(error)), errors.join("\n"));
}

function ids(items) {
  return new Set(items.map((item) => item.id));
}

/**
 * Cross-reference and append semantics intentionally sit outside JSON Schema.
 * This fixture checker demonstrates the producer/storage checks the public
 * contract requires without creating a package-facing runtime API.
 */
function checkGraphLinks(graph) {
  const collections = [
    graph.sourceArtifacts,
    graph.rhetorlintBindings,
    graph.observations,
    graph.classifications,
    graph.claimHypotheses,
    graph.effectHypotheses,
    graph.verificationQuestions,
    graph.externalRefs,
  ];
  const nodes = collections.flat();
  const nodeById = new Map();
  for (const node of nodes) {
    assert.equal(nodeById.has(node.id), false, `duplicate node id ${node.id}`);
    nodeById.set(node.id, node);
  }

  const sourceIds = ids(graph.sourceArtifacts);
  const bindingIds = ids(graph.rhetorlintBindings);
  const observationIds = ids(graph.observations);
  const classificationIds = ids(graph.classifications);
  const claimIds = ids(graph.claimHypotheses);
  const effectIds = ids(graph.effectHypotheses);
  const externalIds = ids(graph.externalRefs);
  const externalById = new Map(graph.externalRefs.map((reference) => [reference.id, reference]));
  const revisions = new Map(graph.revisionLog.map((revision) => [revision.id, revision]));

  assert.equal(revisions.size, graph.revisionLog.length, "revision ids must be unique");
  assert.equal(graph.headRevisionId, graph.revisionLog.at(-1).id);

  const added = new Set();
  const superseded = new Set();
  graph.revisionLog.forEach((revision, index) => {
    assert.equal(revision.sequence, index + 1, "revision sequence must be contiguous");
    assert.equal(
      revision.previousRevisionId,
      index === 0 ? null : graph.revisionLog[index - 1].id,
      "revision predecessor must resolve to the preceding retained revision"
    );
    assert.equal(revision.operation === "create", index === 0, "only revision 1 creates");
    if (revision.operation !== "withdraw") {
      assert.ok(revision.addedNodeIds.length > 0, `${revision.operation} must add a node`);
    }
    if (revision.operation === "supersede" || revision.operation === "withdraw") {
      assert.ok(
        revision.supersededNodeIds.length > 0,
        `${revision.operation} must name retained nodes`
      );
    } else {
      assert.equal(
        revision.supersededNodeIds.length,
        0,
        `${revision.operation} cannot supersede a node`
      );
    }
    for (const id of revision.supersededNodeIds) {
      assert.ok(added.has(id), `superseded node ${id} must have been added earlier`);
      assert.equal(superseded.has(id), false, `node ${id} may be superseded only once`);
      superseded.add(id);
    }
    for (const id of revision.addedNodeIds) {
      assert.ok(nodeById.has(id), `added node ${id} must resolve`);
      assert.equal(added.has(id), false, `node ${id} may be added only once`);
      added.add(id);
    }
  });

  for (const node of nodes) {
    assert.ok(revisions.has(node.createdInRevisionId), `${node.id} revision must resolve`);
    assert.ok(
      revisions.get(node.createdInRevisionId).addedNodeIds.includes(node.id),
      `${node.id} must be listed by its creation revision`
    );
  }

  for (const observation of graph.observations) {
    assert.ok(sourceIds.has(observation.anchor.sourceArtifactId));
    const source = graph.sourceArtifacts.find(
      (candidate) => candidate.id === observation.anchor.sourceArtifactId
    );
    assert.equal(observation.anchor.sourceSha256, source.sha256);
    assert.ok(observation.anchor.endOffset > observation.anchor.startOffset);
  }
  for (const classification of graph.classifications) {
    assert.ok(observationIds.has(classification.observationId));
    assert.ok(bindingIds.has(classification.rhetorlintBindingId));
  }
  for (const hypothesis of graph.claimHypotheses) {
    hypothesis.classificationIds.forEach((id) => assert.ok(classificationIds.has(id)));
    hypothesis.externalRefIds.forEach((id) => assert.ok(externalIds.has(id)));
  }
  for (const hypothesis of graph.effectHypotheses) {
    hypothesis.classificationIds.forEach((id) => assert.ok(classificationIds.has(id)));
    hypothesis.claimHypothesisIds.forEach((id) => assert.ok(claimIds.has(id)));
    hypothesis.externalRefIds.forEach((id) => assert.ok(externalIds.has(id)));
    hypothesis.evaluationDesignRefIds.forEach((id) => {
      assert.equal(externalById.get(id)?.kind, "evaluation-design");
    });
  }
  for (const question of graph.verificationQuestions) {
    question.classificationIds.forEach((id) => assert.ok(classificationIds.has(id)));
    question.claimHypothesisIds.forEach((id) => assert.ok(claimIds.has(id)));
    question.effectHypothesisIds.forEach((id) => assert.ok(effectIds.has(id)));
    question.externalRefIds.forEach((id) => assert.ok(externalIds.has(id)));
  }
}

test("claim graph schema is explicit, closed, bounded, and uses supported keywords", () => {
  assert.equal(SCHEMA.$id.endsWith("/spec/claim-graph.schema.json"), true);
  assert.equal(GRAPH.schema, "rhetorlint.claim-graph/0.1");
  assertSupported(SCHEMA);
  assert.deepEqual(validate(GRAPH, SCHEMA), []);

  const extra = clone(GRAPH);
  extra.classifications[0].truthStatus = "supported";
  expectInvalid(extra, /truthStatus.*not permitted/);

  const oversized = clone(GRAPH);
  oversized.externalRefs = Array.from({ length: 129 }, (_, index) => ({
    ...clone(GRAPH.externalRefs[0]),
    id: `ref:oversized-${index}`,
  }));
  expectInvalid(oversized, /above the maximum 128/);

  const nonText = clone(GRAPH);
  nonText.sourceArtifacts[0].mediaType = "image/png";
  expectInvalid(nonText, /outside the permitted set/);
});

test("zero-byte sources and zero-mark analyses remain representable", () => {
  const empty = clone(GRAPH);
  empty.graphId = "graph:empty-source";
  empty.headRevisionId = "revision:empty-001";
  empty.sourceArtifacts = [{
    ...empty.sourceArtifacts[0],
    id: "source:empty-v1",
    createdInRevisionId: "revision:empty-001",
    locator: "caller:empty-source",
    byteLength: 0,
    sha256: sha256(Buffer.alloc(0)),
  }];
  empty.rhetorlintBindings = [{
    ...empty.rhetorlintBindings[0],
    id: "binding:empty-analysis",
    createdInRevisionId: "revision:empty-001",
  }];
  empty.observations = [];
  empty.classifications = [];
  empty.claimHypotheses = [];
  empty.effectHypotheses = [];
  empty.verificationQuestions = [];
  empty.externalRefs = [];
  empty.revisionLog = [{
    id: "revision:empty-001",
    sequence: 1,
    previousRevisionId: null,
    recordedAt: "2026-08-24T10:10:00.000Z",
    operation: "create",
    addedNodeIds: ["source:empty-v1", "binding:empty-analysis"],
    supersededNodeIds: [],
    reason: "Record a clean analysis of an exact empty source without inventing a mark.",
  }];

  assert.deepEqual(validate(empty, SCHEMA), []);
  checkGraphLinks(empty);
});

test("closed constants prevent candidate, question, and effect status collapse", () => {
  assert.deepEqual(GRAPH.doesNotEstablish, {
    truth: "not-established",
    intent: "not-established",
    effect: "not-established",
    causality: "not-established",
    authority: "not-established",
    consent: "not-established",
  });
  for (const classification of GRAPH.classifications) {
    assert.deepEqual(Object.keys(classification).sort(), [
      "classificationStatus",
      "createdInRevisionId",
      "family",
      "id",
      "observationId",
      "rhetorlintBindingId",
      "ruleId",
      "taxonomyMappingStatus",
      "technique",
    ]);
    assert.equal(classification.classificationStatus, "rule-pack-candidate-context-required");
  }
  assert.equal(JSON.stringify(GRAPH).includes('"confidence"'), false);
  assert.equal(JSON.stringify(GRAPH).includes('"score"'), false);

  const assertedEffect = clone(GRAPH);
  assertedEffect.effectHypotheses[0].status = "effect-observed";
  expectInvalid(assertedEffect, /outside the permitted set/);

  const verdict = clone(GRAPH);
  verdict.verificationQuestions[0].status = "confirmed";
  expectInvalid(verdict, /outside the permitted set/);

  const interpretedReference = clone(GRAPH);
  interpretedReference.externalRefs[0].supports = "claim:unnamed-authority-context-v2";
  expectInvalid(interpretedReference, /supports.*not permitted/);

  const established = clone(GRAPH);
  established.doesNotEstablish.truth = "established";
  expectInvalid(established, /outside the permitted set/);
});

test("claim axes and qualitative effect measures stay typed but non-probative", () => {
  const claimProperties = SCHEMA.$defs.claimHypothesis.properties;
  assert.deepEqual(claimProperties.claimRole.enum, [
    "assertion",
    "definition",
    "theorem-claim",
    "conjecture",
    "design-commitment",
  ]);
  assert.deepEqual(claimProperties.subjectDomain.enum, [
    "ordinary-language",
    "mathematics",
    "empirical-science",
    "philosophy",
    "cross-domain",
    "other",
  ]);
  assert.deepEqual(claimProperties.representationForm.enum, [
    "natural-language",
    "formal-expression",
    "diagram",
    "other",
  ]);
  assert.deepEqual(claimProperties.methodKind.enum, [
    "none",
    "not-specified",
    "proof",
    "model",
    "measurement",
    "other",
  ]);
  assert.deepEqual(SCHEMA.$defs.externalRef.properties.kind.enum, [
    "evidence",
    "research-report",
    "mathematical-treatment-card",
    "formal-verification",
    "evaluation-design",
  ]);
  assert.equal(GRAPH.claimHypotheses[0].claimRole, "assertion");
  assert.equal(
    GRAPH.effectHypotheses[0].measureStatus,
    "qualitative-candidates-not-operationalized"
  );
  assert.equal(Object.hasOwn(GRAPH.effectHypotheses[0], "measures"), false);

  const invalidRegister = clone(GRAPH);
  invalidRegister.claimHypotheses[0].claimRole = "theorem";
  expectInvalid(invalidRegister, /outside the permitted set/);

  const ambiguousAuthorship = clone(GRAPH);
  ambiguousAuthorship.claimHypotheses[0].metadataSource = "rule-pack-authored";
  expectInvalid(ambiguousAuthorship, /outside the permitted set/);

  const definition = clone(GRAPH);
  Object.assign(definition.claimHypotheses[0], {
    claimRole: "definition",
    subjectDomain: "mathematics",
    representationForm: "formal-expression",
    methodKind: "none",
    conditions: [],
    alternatives: [],
  });
  assert.deepEqual(validate(definition, SCHEMA), [], "definitions need no invented alternative");

  const operationalized = clone(GRAPH);
  operationalized.effectHypotheses[0].measureStatus = "validated-measurement";
  expectInvalid(operationalized, /outside the permitted set/);

  const wrongRefKind = clone(GRAPH);
  wrongRefKind.externalRefs.find(
    (reference) => reference.id === "ref:reader-study-design"
  ).kind = "evidence";
  assert.deepEqual(validate(wrongRefKind, SCHEMA), [], "kind resolution is a graph check");
  assert.throws(() => checkGraphLinks(wrongRefKind));
});

test("source and span digests anchor exact bytes without embedding source text", () => {
  const sourceBytes = readFileSync(
    new URL("../examples/claim-graph/fixtures/bounded-inquiry.source.txt", import.meta.url)
  );
  const sourceText = sourceBytes.toString("utf8");
  const source = GRAPH.sourceArtifacts[0];

  assert.equal(source.byteLength, sourceBytes.byteLength);
  assert.equal(source.sha256, sha256(sourceBytes));
  assert.equal(source.contentDisclosure, "not-included");
  assert.equal(JSON.stringify(GRAPH).includes("Experts say"), false);

  for (const observation of GRAPH.observations) {
    const { startOffset, endOffset, spanSha256 } = observation.anchor;
    assert.ok(endOffset <= sourceText.length);
    assert.equal(spanSha256, sha256(Buffer.from(sourceText.slice(startOffset, endOffset), "utf8")));
  }

  const badDigest = clone(GRAPH);
  badDigest.sourceArtifacts[0].sha256 = "fnv1a64:0123456789abcdef";
  expectInvalid(badDigest, /does not match/);
});

test("external references remain opaque while their declared bytes are checkable", () => {
  const study = GRAPH.externalRefs.find((reference) => reference.kind === "evaluation-design");
  const studyBytes = readFileSync(
    new URL("../examples/claim-graph/fixtures/reader-study-design.md", import.meta.url)
  );
  assert.equal(study.artifactSha256, sha256(studyBytes));
  assert.deepEqual(Object.keys(study).sort(), [
    "artifactSha256",
    "assurance",
    "createdInRevisionId",
    "digestVerification",
    "id",
    "kind",
    "locator",
  ]);
  assert.equal(study.assurance, "opaque-reference-not-resolved-or-evaluated");
});

test("stable references and superseding revisions retain earlier nodes", () => {
  checkGraphLinks(GRAPH);
  assert.equal(GRAPH.headRevisionId, "revision:002");
  assert.ok(
    GRAPH.claimHypotheses.some((claim) => claim.id === "claim:unnamed-authority-context-v1"),
    "superseded claim remains present"
  );
  assert.deepEqual(GRAPH.revisionLog[1].supersededNodeIds, [
    "claim:unnamed-authority-context-v1",
  ]);

  const unresolved = clone(GRAPH);
  unresolved.classifications[0].observationId = "observation:missing";
  assert.deepEqual(validate(unresolved, SCHEMA), [], "schema checks shape, not graph resolution");
  assert.throws(() => checkGraphLinks(unresolved));

  const reversedAnchor = clone(GRAPH);
  reversedAnchor.observations[1].anchor.endOffset =
    reversedAnchor.observations[1].anchor.startOffset;
  assert.deepEqual(validate(reversedAnchor, SCHEMA), [], "schema cannot compare offsets");
  assert.throws(() => checkGraphLinks(reversedAnchor));

  const incoherentDigest = clone(GRAPH);
  incoherentDigest.observations[0].anchor.sourceSha256 = sha256("different source");
  assert.deepEqual(validate(incoherentDigest, SCHEMA), [], "schema cannot join digest fields");
  assert.throws(() => checkGraphLinks(incoherentDigest));

  const erased = clone(GRAPH);
  erased.claimHypotheses = erased.claimHypotheses.filter(
    (claim) => claim.id !== "claim:unnamed-authority-context-v1"
  );
  assert.deepEqual(validate(erased, SCHEMA), [], "schema cannot enforce append-only retention");
  assert.throws(() => checkGraphLinks(erased), /added node .* must resolve/);

  const withdrawn = clone(GRAPH);
  withdrawn.headRevisionId = "revision:003";
  withdrawn.revisionLog.push({
    id: "revision:003",
    sequence: 3,
    previousRevisionId: "revision:002",
    recordedAt: "2026-08-24T10:15:00.000Z",
    operation: "withdraw",
    addedNodeIds: [],
    supersededNodeIds: ["effect:source-inspection"],
    reason: "Withdraw the effect hypothesis without deleting its record.",
  });
  assert.deepEqual(validate(withdrawn, SCHEMA), []);
  checkGraphLinks(withdrawn);

  withdrawn.revisionLog[2].supersededNodeIds = [];
  assert.deepEqual(validate(withdrawn, SCHEMA), [], "schema checks shape, not operation semantics");
  assert.throws(() => checkGraphLinks(withdrawn), /withdraw must name retained nodes/);

  const emptySupersede = clone(GRAPH);
  emptySupersede.revisionLog[1].supersededNodeIds = [];
  assert.deepEqual(validate(emptySupersede, SCHEMA), []);
  assert.throws(() => checkGraphLinks(emptySupersede), /supersede must name retained nodes/);

  const sameRevisionSupersession = clone(GRAPH);
  sameRevisionSupersession.revisionLog[1].supersededNodeIds = [
    "claim:unnamed-authority-context-v2",
  ];
  assert.deepEqual(validate(sameRevisionSupersession, SCHEMA), []);
  assert.throws(
    () => checkGraphLinks(sameRevisionSupersession),
    /must have been added earlier/
  );
});
