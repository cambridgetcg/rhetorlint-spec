# The RhetorLint Spec

Three language-agnostic artifacts keep implemented surface-linked matches and
effect hypotheses distinct, while marking recipient-effect evidence and factual
evidence as downstream requirements rather than silently collapsing them into
one score.

## [`taxonomy.yaml`](taxonomy.yaml) — markers and hypotheses

The portable, human-readable catalogue of rhetorical markers, grouped into families and aligned to the SemEval-2023 persuasion taxonomy where a mapping exists. Each seeded marker carries a contestable effect hypothesis and a verification probe. Those are prompts for inquiry, not claims about what happened to a recipient.

- **the catalogue** a rule pack compiles into visible-pattern matchers, and
- **the syllabus** a learner reads to know what to watch for.

That is the highest-leverage decision in the framework: the cross-language artifact and the curriculum are the same file.

## [`output.schema.json`](output.schema.json) — the result object

Every implementation, in any language, emits this one JSON shape. Analyzing the demo passage — *"We take your privacy extremely seriously, and regrettably, mistakes were made. We are reaching out to affected users."* — returns exactly this, with three of the four marks elided for length; `node scripts/demo.mjs` prints the whole object.

```jsonc
{
  "rhetorlint": "0.1",
  "source":  { "chars": 117, "words": 18, "locale": "en" },
  "density": { "tells": 4, "per100Words": 22.2 },   // pattern count, not effect/truth
  "marks": [{
    "ruleId":   "agency-hiding.deleted-subject",     // family.tell
    "displayName": "passive with omitted semantic agent",
    "family":   "agency-hiding",                     // one of 7 (6 SemEval parents + agency-hiding)
    "technique":"Obfuscation (structural — RhetorLint extension)",
    "classificationStatus": "rule-pack-candidate-context-required",
    "taxonomyMappingStatus": "rhetorlint-extension",
    "actual":   "were made",                         // the visible phrase
    "position": { "start": { "line": 1, "column": 69, "offset": 68 },
                  "end":   { "line": 1, "column": 78, "offset": 77 } },
    "note":     "a passive construction with an omitted agent — this phrase does not name who performed the action",
    "expected": ["(name the actor if known, or state that the actor is unknown)"],
    "confidence": 0.7,                                // uncalibrated rule weight
    "level":    "info"
  }],
  "strip":   "We take your privacy seriously, and regrettably, mistakes [who?] were made. We are reaching out to affected users.",
  "rewrite": null,                                    // only non-null with a model adapter
  // `rules` is the pack's own `version` field verbatim; the engine hard-codes nothing
  "engine":  { "name": "@rhetorlint/core", "version": "0.1.3", "rules": "@rhetorlint/rules-en@0.1.3" }
}
```

`line` and `column` are optional; `offset` is not. An engine that emits only `offset` still conforms.

The span and position are direct surface observations. `ruleId`, `displayName`,
`family`, `technique`, `classificationStatus`, `taxonomyMappingStatus`, `note`,
`expected`, `confidence`, and `level` are configured, rule-pack-authored
interpretations or reviewer fields. Canonical output keeps them for 0.1
compatibility; consumers must not relabel the whole mark as raw observation or
a contextual classification finding.

### Invariants an implementation MUST hold

1. **Marks point at visible text.** `actual` is exactly the input substring at `position`.
2. **No person-reading.** Nothing in canonical output asserts a speaker's intent, identity, consciousness, or truthfulness.
3. **Interpretations stay configured and contestable.** Taxonomy labels and reviewer fields come from a versioned rule pack; a match does not prove that they apply in context.
4. **No effect finding.** A mark does not establish an effect on any recipient.
5. **No fabricated rewrite.** `rewrite` is `null` unless a caller explicitly supplies a model adapter; the core does not verify that output.
6. **Confidence is uncalibrated.** It is an author-assigned rule-match weight, never a probability of intent, effect, deception, or truth.
7. **Density is only a count.** It varies with pack composition and passage length and must not become a general governance score.
8. **Family is one of the seven** enumerated in the schema.

## [`inquiry.schema.json`](inquiry.schema.json) — hypotheses and questions

`@rhetorlint/core/inquiry` joins each canonical mark back to the matching rule's structured metadata:

```jsonc
{
  "schema": "rhetorlint.inquiry/0.1",
  "kind": "rhetorlint.inquiry",
  "boundary": {
    "observation": "span-and-position-only",
    "classification": "rule-pack-candidate-context-required",
    "interpretation": "hypotheses-not-findings",
    "effects": "recipient-specific-evidence-required",
    "truth": "questions-not-verdicts"
  },
  "assurance": {
    "metadataSource": "caller-supplied-rule-pack",
    "boundary": "declared-not-semantically-verified",
    "fingerprintUse": "change-detection-not-authentication",
    "analysisPackBinding": "id-version-and-matched-family-only"
  },
  "sourceAccess": {
    "source": "not-included",
    "reference": "none",
    "markedPhrases": "omitted"
  },
  "rhetorlint": "0.1",
  "engine": {
    "name": "@rhetorlint/core",
    "version": "0.1.3",
    "rules": "@rhetorlint/rules-en@0.1.3"
  },
  "rules": "@rhetorlint/rules-en@0.1.3",
  "metadataFingerprint": "fnv1a64:dc3e358d9dd454b9",
  "items": [{
    "markRef": {
      "ruleId": "agency-hiding.deleted-subject",
      "displayName": "passive with omitted semantic agent",
      "family": "agency-hiding",
      "classificationStatus": "rule-pack-candidate-context-required",
      "taxonomyMappingStatus": "rhetorlint-extension",
      "position": { "start": { "offset": 68 }, "end": { "offset": 77 } }
    },
    "effectHypotheses": [{
      "id": "actor-attribution.reduce",
      "dimension": "actor-attribution",
      "operation": "reduce",
      "description": "May make actor identification or responsibility attribution harder for a recipient.",
      "conditions": ["The actor is not named nearby or already known, and actor attribution matters to the task."],
      "alternatives": ["The actor may be unknown, irrelevant, named elsewhere, or conventionally omitted in scientific or process-focused prose."],
      "measures": ["actor identified", "responsibility assignment"]
    }],
    "verificationProbes": [{
      "id": "passive.identify-actor",
      "question": "Who performed the action, is that actor known, and what evidence supports the attribution?",
      "evidenceNeeded": ["records identifying the actor"]
    }]
  }]
}
```

Phrase text is absent by default. The full source is never included.
`sourceAccess` says whether an unverified caller reference was supplied and
whether marked phrases were disclosed. Offsets are not independently
inspectable unless the recipient also holds the matching source out of band.
`includeActual: true` is an explicit technical disclosure switch, not proof of
consent, purpose limitation, or authority. The default still discloses rule IDs
and offsets, so “redacted” does not mean anonymous or harmless.

The adapter validates required structure, non-empty hypothesis, probe, and
evidence arrays, matched rule/family provenance, and pack ID/version agreement
when the analysis names them. It does not bind inquiry metadata to the exact
pack bytes used during analysis; the machine-readable `analysisPackBinding`
says what was actually checked. It cannot prove that free-text metadata obeys
the declared epistemic boundary. `assurance.boundary` makes that limitation
machine-readable. The metadata fingerprint distinguishes changed metadata under
the same pack ID/version for reproducibility; FNV-1a is a change detector, not
collision-resistant authentication.

An effect becomes evidence only when a downstream study names the recipient or self-described substrate, task, context, intervention, observable outcome, method, uncertainty, and limits. A truth conclusion requires independent evidence about the factual claim. Neither is synthesized by the inquiry projection.

### Testing an effect across substrates

A cross-substrate probe should:

1. Bind the exact source and isolate a minimal comparison variant. Record which factual claims are intended to stay constant; do not assume `strip` or a model rewrite preserved them.
2. Declare the recipient's self-described substrate/runtime and the material task, prompt, tools, information, presentation order, and sampling settings. These are experimental context, not identity, consciousness, consent, competence, or authority proofs.
3. Prefer paired, blinded, or randomised comparisons where feasible. Run the same operational task against each variant.
4. Measure inspectable outcomes such as claims extracted, actors attributed, alternatives considered, evidence requested, uncertainty stated, or actions proposed. Do not invent inaccessible inner states.
5. Compare variants within one substrate before comparing across substrates. Preserve disagreement and report missing or incomparable measurements.
6. Attribute every observation and inference, state limitations, and distinguish an illustration from empirical data.
7. Send factual propositions to an independent evidence process. A rhetorical effect can explain why a claim was treated differently; it cannot establish whether that claim is true.

### Interop

The result converts to [SARIF 2.1.0](https://sarifweb.azurewebsites.net/) (see `@rhetorlint/core/sarif`). SARIF contains exact matched snippets and downstream systems may upload them. Candidate wording prompts are deliberately not emitted as auto-fixes.

RhetorLint is deliberately *not* [ClaimReview](https://schema.org/ClaimReview): it produces surface-linked matches and questions that can feed a fact-checking layer, not a factual rating.

## Versioning

`rhetorlint` in canonical output and `schema` in the inquiry projection version separate contracts. `0.x` may change shapes; `1.0` will freeze the respective object.
