# RhetorLint Claim Graph 0.1

`rhetorlint.claim-graph/0.1` is an opt-in interchange contract for carrying a
RhetorLint mark into a bounded inquiry without promoting the mark into a fact
about a claim, speaker, or recipient. It has no runtime, network, persistence,
scoring, ranking, or decision effect.

The contract is the closed JSON Schema at
[`../../spec/claim-graph.schema.json`](../../spec/claim-graph.schema.json). The
fictional [`fixtures/bounded-inquiry.json`](fixtures/bounded-inquiry.json)
shows two exact source spans, two candidate rule classifications, separately
authored claim and effect hypotheses, verification questions, opaque evidence
and evaluation-design references, and one superseding revision that keeps the
earlier hypothesis visible.

## The lanes stay separate

```text
caller-verified source bytes
  -> immutable surface-span observation
  -> rule-pack candidate classification
  -> optional claim hypothesis
  -> optional recipient-specific effect hypothesis
  -> verification question
  -> opaque external evidence or evaluation-design reference
```

- An **observation** says only that a selected span occurs at declared UTF-16
  offsets in exact UTF-8 source bytes. It carries the source digest and a
  digest of the selected text, but no phrase text.
- A **classification** links that observation to exact declared engine and
  rule-pack source bytes. Its only status is
  `rule-pack-candidate-context-required`. The closed classification object has
  no truth, intent, effect, causal, confidence, score, authority, or consent
  field.
- A **claim hypothesis** is scoped and always
  `claim-candidate-not-adjudicated`. Four orthogonal declarations keep its
  role (`assertion`, `definition`, `theorem-claim`, `conjecture`, or
  `design-commitment`), subject domain, representation form, and method kind
  separate. `methodKind: none` declares that no method applies;
  `not-specified` preserves an unknown or unrecorded method, and `other` avoids
  forcing computation, simulation, testimony, or mixed methods into proof,
  model, or measurement. A `theorem-claim` does not mean proved, and
  `methodKind: proof` does not mean a proof was supplied or checked. Conditions
  and alternatives may be empty where they do not apply; explicit absence is
  preferable to inventing them for a stipulative definition. Opaque
  mathematical treatment cards (including a KINGDOM Math Passport) or
  formal-verification references carry method details without embedding or
  validating them here.
- An **effect hypothesis** names a recipient or substrate, conditions,
  alternatives, and qualitative measure candidates that are explicitly not
  operationalized measurements. It is always
  `hypothesis-recipient-specific-evidence-required`; recording it is not an
  observation that an effect occurred. Evaluation designs have their own
  typed reference list rather than being embedded or implied by a measure.
- A **verification question** is always `question-not-verdict`. Evidence
  needed is a request, not an evidence status.
- An **external reference** is only a stable ID, kind, opaque locator, and
  caller-verified artifact digest. Kinds distinguish generic evidence,
  research reports, mathematical treatment cards, formal verification, and
  evaluation designs.
  The graph does not fetch a reference, quote it, decide what it supports,
  assess source independence, prove mathematics, or validate an evaluation.

The arrays for observations, classifications, hypotheses, questions, and
external references may be empty. An empty lane is preferable to invented
metadata. Hypothesis, effect, and question metadata is caller-supplied in 0.1;
rule-pack authorship is represented only by an exact classification binding.

## Exact anchoring without automatic disclosure

Each source artifact, including a valid zero-byte source, declares:

- exact byte length and `sha256:` digest;
- UTF-8 decoding with no Unicode normalization;
- an opaque locator; and
- `contentDisclosure: not-included`.

Each observation repeats the source digest and records half-open
`[startOffset, endOffset)` positions in UTF-16 code units, matching the current
JavaScript core's offsets. `spanSha256` is SHA-256 over the UTF-8 encoding of
the selected JavaScript substring, without normalization. A consumer with the
same bytes can therefore check both the source and the selected span.

The schema checks digest syntax only. `caller-verified-exact-bytes` is the
producer's declaration that it recomputed the digest; it is not proof that the
producer did so. SHA-256 binds bytes, not authorship, time, identity,
provenance, interpretation, or truth. A short phrase digest may also be
guessable by dictionary search, so omission is not anonymity or a complete
privacy guarantee.

The engine and rule-pack bindings use the same mechanism. This replaces a
metadata-only FNV fingerprint as the artifact-binding seam without requiring
a synchronous browser hashing API. It still does not prove that the declared
engine ran, that the rule pack produced the candidate, or that any authored
hypothesis is sound.

## Stable IDs and revisions

IDs have a bounded `namespace:local-id` shape and remain stable across graph
revisions. Producers must keep IDs unique across all node arrays and resolve
every typed reference to the expected node kind.

Revisions append nodes. A correction or refinement adds a new node and lists
the earlier node in `supersededNodeIds`; it does not edit or delete the earlier
observation or hypothesis. The example narrows an over-broad hypothesis in
revision 2 while retaining revision 1. `headRevisionId` identifies the current
declared view.

JSON Schema cannot prove global ID uniqueness, reference resolution, ordered
lineage, offset ordering or range, cross-field digest coherence, or append-only
storage. A producer or storage adapter must enforce those rules and reject a
graph whose head, predecessor chain, creation links, source anchors, or
supersession references do not resolve. Checking offsets against source length
and recomputing source/span digests requires the exact disclosed bytes, which
the graph deliberately omits. `create`, `append`, and `supersede` must add at
least one node; `supersede` and `withdraw` must identify at least one previously
retained node, never one first added in the same revision. The focused test
demonstrates these checks for the fixture. A signed or content-addressed
history, if ever needed, belongs in a later contract; this one does not imply
it.

## Fixed non-effects

Every graph carries a closed `doesNotEstablish` object. A schema-valid graph
does not establish:

- factual truth;
- speaker intent;
- recipient effect;
- causality;
- authority; or
- consent.

It also creates no permission, KARMA receipt, reputation record, person model,
or binding decision. External evidence may later be evaluated by a separate,
declared research process; this graph only retains exact references to it.

## Checks and future runtime wiring

Run the standalone test directly:

```sh
node --test test/claim-graph.test.mjs
```

The test also runs through the root `npm test` command. A future package-facing
projection would still need explicit exports, types, rule metadata, digest
input, privacy controls, and its own versioned review. None of that runtime
wiring is implied by this schema.
