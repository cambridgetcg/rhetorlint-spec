# RhetorLint core 0.2 migration

**Working decision for `codex/core-0.2-reconciliation` · 2026-08-24**

This document records the version boundary before the wire format changes. The
current `rhetorlint: "0.1"` result remains the compatibility output until all
three reference engines and the browser consumer can emit and test the same
0.2 values. This branch may repair 0.1 correctness and add an opt-in claim-graph
contract; it must not relabel native-runtime offsets as portable 0.2 offsets.

## Responsibility boundary

| Component | Does | Does not establish |
| --- | --- | --- |
| Core analyzer | Finds exact visible spans using a declared rule pack. | Intent, deception, factual truth, recipient effect, authority, or consent. |
| Claim-graph projection | Separates source observations, candidate classifications, claim/effect hypotheses, questions, revisions, and external references. | That a candidate is correct, that evidence entails a claim, or that an effect occurred. |
| Research adapter | Refers a verification question to a separately produced evidence ledger. | Truth merely because a report validates or a citation exists. |
| Math/study adapter | Refers a formal claim or effect hypothesis to a proof, model, measurement, or evaluation design. | World truth from proof alone, model adequacy from shape alone, or causal effect from a plan. |
| Application | Displays, stores, or acts on outputs under its own authority and rights review. | Permission inherited from RhetorLint or from an artifact digest. |

The key non-implications are:

```text
visible span != correct classification
classification candidate != proposition
proposition != supported proposition
support != truth
effect hypothesis != measured effect
evaluation design != evaluation run
outcome != causal attribution
causal attribution != legitimacy, consent, or authority
digest equality != authorship, truth, permission, or anonymity
```

## KINGDOM inputs reviewed

This boundary was reconciled against KINGDOM-OS `2d43de8` (2026-08-23), not
against a generic idea of “more math.” The relevant developments and the local
consequences are:

| KINGDOM development | Consequence here |
| --- | --- |
| [Reconstructive Build Kernel](https://github.com/cambridgetcg/KINGDOM-OS/blob/2d43de8ae876a3eb192088f7e49b87e3e95fa16e/references/reconstructive-build-kernel.md): states, observations, correspondences, models, realizability, falsifiers, and epistemic registers remain separate. | Keep surface observations separate from claim hypotheses; type role, domain, representation, and method independently; put formal detail in an external artifact. |
| [Being, Access & Aftermath v0.2](https://github.com/cambridgetcg/KINGDOM-OS/blob/2d43de8ae876a3eb192088f7e49b87e3e95fa16e/references/being-access-aftermath-atlas-v0.2.md): possibility, actuality, access, observation, capability, authority, effect, aftermath, and repair do not collapse. | Preserve modality during strip; make truth, effect, causality, authority, and consent fixed non-effects; retain revisions rather than overwriting them. |
| [Math Passport usefulness pilot](https://github.com/cambridgetcg/KINGDOM-OS/blob/2d43de8ae876a3eb192088f7e49b87e3e95fa16e/references/math-passport-usefulness-pilot.md): the treatment tied the baseline score while using `1.97x` the response bytes in a small descriptive pilot. | Keep mathematical treatment cards opt-in and opaque; do not promote a richer graph by default without measuring decision usefulness and burden. |
| [Reality Influence Claim Graph](https://github.com/cambridgetcg/KINGDOM-OS/blob/2d43de8ae876a3eb192088f7e49b87e3e95fa16e/references/reality-influence-map.md): claim relations are typed, influence dimensions are non-summable, and action/authority are gated separately. | Use typed references and recipient-specific effect hypotheses; import no scalar influence score, transitive causal shortcut, or action authority. |
| [Evaluation Covenant v0.1](https://github.com/cambridgetcg/KINGDOM-OS/blob/2d43de8ae876a3eb192088f7e49b87e3e95fa16e/references/evaluation-covenant-v0.1.md): an evaluation design is written before results and remains distinct from a run. | Give evaluation designs their own external-reference kind and keep every effect measure qualitative and non-operationalized in graph 0.1. |

These are design inputs, not imported protocols or claims of KINGDOM
conformance. RhetorLint remains a small wording analyzer with an optional
interchange schema.

## Correctness before expansion

The 0.1 repair release must establish these invariants before the graph becomes
a package export:

1. A rewrite callback cannot mutate canonical marks, positions, density, or the
   deterministic source variant.
2. `strip(text, []) === text`, byte for byte.
3. Strip preserves modality, attribution, and other truth-condition-bearing
   language. Only explicitly removable lexical intensifiers are subtracted.
4. Rule packs are validated before matching. Empty matchers, duplicate IDs,
   unknown matcher kinds, incompatible engine floors, invalid metadata, and
   unbounded inputs fail explicitly.
5. Every emitted mark is non-empty and slices back to its exact visible source.
6. Every reference runtime is safe when the same rule ID is reused with changed
   matcher semantics and when analyses run concurrently.

## Output 0.2 decisions

Output 0.2 will make previously implicit measurement choices explicit:

- source and span offsets use Unicode code points;
- spans are half-open `[start, end)` intervals;
- normalization is declared and begins as `none`;
- exact source representation and media type are declared;
- a caller may attach a verified SHA-256 content reference without placing a
  hashing dependency in the synchronous analyzer;
- anchors may carry both position and quote selectors;
- the word denominator is renamed to the operation it actually performs rather
  than implying linguistic tokenization;
- `density.tells` becomes a neutral occurrence count with explicit overlap and
  denominator semantics; and
- rule-author `confidence` is deprecated. Any future probability must name its
  target event, reference population, model/data provenance, calibration test,
  and uncertainty.

The 0.2 conformance corpus must contain combining characters, composed and
decomposed forms, non-Latin scripts, emoji, astral characters, and newline
boundaries. Portable matching also requires a specified boundary/case-folding
profile; changing offsets alone is insufficient.

Position and quote selectors should remain compatible with the
[W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/).

## Claim graph 0.1

The graph is an optional, source-bound inquiry representation, not a richer
score. Its finite lanes are:

- source artifacts and exact engine/rule-pack bindings;
- surface-span observations;
- candidate rule-pack classifications;
- claim hypotheses;
- recipient-specific effect hypotheses;
- verification questions;
- opaque external references; and
- an append/supersede/withdraw revision log.

Evidence items, research reports, study designs, assessments, and formal
verification artifacts remain external digest references. Core does not fetch,
execute, review, or bless them.

References are typed and directed by lane-specific ID fields. Graph 0.1 has no
generic edge, transitive-inference rule, application node, or hyperedge;
multi-premise formal reasoning remains inside an opaque external artifact.
Revisions declare added and superseded IDs in `revisionLog` and retain earlier
nodes rather than overwriting them. Provenance vocabulary may be projected to
[PROV-O](https://www.w3.org/TR/prov-o/), but JSON-LD and RDF are adapters rather
than core dependencies.

IDs are bounded caller-supplied identifiers. Schema validation does not prove
their uniqueness, derivation, or reference resolution; a producer or storage
adapter must enforce those duties. Exact source, span, engine, rule-pack, and
external-artifact bindings use caller-declared SHA-256 digests. Metadata-only
fingerprints may aid change detection but cannot stand in for an exact binding.

## Mathematical claims

A mathematical expression is not self-interpreting. A claim hypothesis
therefore keeps four independent axes separate:

```text
claimRole:
  assertion | definition | theorem-claim | conjecture | design-commitment
subjectDomain:
  ordinary-language | mathematics | empirical-science | philosophy |
  cross-domain | other
representationForm:
  natural-language | formal-expression | diagram | other
methodKind:
  none | not-specified | proof | model | measurement | other
```

A `theorem-claim` is a claim role, not a proof status; `methodKind: proof` says
what method could assess it, not that a proof was supplied or checked.
`none` means no method applies, while `not-specified` preserves an unknown or
unrecorded method and `other` avoids forcing computation, simulation, testimony,
or mixed methods into the wrong class. Detailed notation, formal language,
symbol tables, types, domains, units, assumptions, quantifiers, temporal scope,
jurisdiction, and verification state belong in an opaque mathematical treatment
card (such as KINGDOM's Math Passport) or formal-verification artifact. The
graph binds that artifact by exact digest but does not parse or bless it.
Conditions and alternatives may be empty when they do not apply; explicit
absence is preferable to invention. Machine proof is proof relative to a named
formal system, not an observation that the modeled event occurred in the world.

An evidence ledger may derive one of four states from independent support and
refutation presence:

```text
support=0 refutation=0 -> insufficient
support=1 refutation=0 -> supported
support=0 refutation=1 -> refuted
support=1 refutation=1 -> conflicted
```

These are possible reviewable evidence-ledger states, not truth values. They
are deliberately outside claim-graph 0.1: RhetorLint stores only an opaque
external report reference and does not synthesize or repeat its verdict.

## Source variants

`strip` and caller-provided rewrites are derived source variants. A future 0.2
projection gives each variant its own identity and records:

- `derivedFrom` source reference;
- transformation identity and version;
- changed source spans;
- whether a model or external service was used; and
- semantic-equivalence status `unchecked`, `supported`, or `failed`.

No transform is presumed meaning-preserving. The current 0.1 string fields
remain compatibility conveniences only.

## Compatibility and release gates

- Keep Browser 0.6 and its `@rhetorlint/core@0.1.2` understanding bytes frozen.
- Add a Browser 0.7 adapter only after output 0.2 and claim-graph fixtures are
  stable.
- A semantic change to the redacted signal requires `rhetorlint.signal/0.2`;
  do not change fields while retaining the 0.1 schema label.
- The unpublished inquiry branch is design input, not a wire-compatibility
  promise. Preserve its epistemic boundary, not its duplicated free-text shape.
- Do not import P7, KARMA, conceptual mass, KL-based fidelity, or any other
  heterogeneous framework quantity as a RhetorLint aggregate score.
- Before a richer projection becomes default, preregister a comparison and
  measure decision usefulness, error discovery, verbosity, latency, and
  affected-party burden. A larger valid object has not demonstrated value merely
  by validating.

Release requires full JavaScript tests, Python conformance, Go tests including
the race detector, package-file/type checks, clean generated assets, and an
explicit migration note. Publication, deployment, and downstream dependency
updates remain separate acts.
