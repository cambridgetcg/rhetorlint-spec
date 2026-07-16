# The RhetorLint Spec

Two files, language-agnostic. This is the framework; engines are implementations of it.

## [`taxonomy.yaml`](taxonomy.yaml) — the families of tells

The portable, human-readable catalogue of rhetorical tells, grouped into families and aligned to the SemEval-2023 persuasion taxonomy. It is simultaneously:

- **the spec** an engine reads to know what to mark, and
- **the syllabus** a learner reads to know what to watch for.

That is the highest-leverage decision in the framework: the cross-language artifact and the curriculum are the same file.

## [`output.schema.json`](output.schema.json) — the result object

Every implementation, in any language, emits this one JSON shape:

```jsonc
{
  "rhetorlint": "0.1",
  "source":  { "chars": 118, "words": 18, "locale": "en" },
  "density": { "tells": 4, "per100Words": 22.2 },   // the headline metric
  "marks": [{
    "ruleId":   "agency-hiding.deleted-subject",     // family.tell
    "family":   "agency-hiding",                     // one of 7 (6 SemEval parents + agency-hiding)
    "technique":"Obfuscation (structural — RhetorLint extension)",
    "actual":   "were made",                         // the visible phrase
    "position": { "start": { "offset": 60 }, "end": { "offset": 69 } },
    "note":     "an agentless passive — who acted is deleted",
    "expected": ["(name who did it)"],
    "confidence": 0.7,                                // heuristic, NOT a lie probability
    "level":    "warning"
  }],
  "strip":   "…deterministic de-spun text…",
  "rewrite": null,                                    // only non-null with a model adapter
  "engine":  { "name": "@rhetorlint/core", "version": "0.1.0", "rules": "@rhetorlint/rules-en@0.1.0" }
}
```

### Invariants an implementation MUST hold

1. **Marks point at visible text.** `actual` is exactly the input substring at `position`.
2. **No person-reading.** Nothing in the output describes the speaker's intent, tone, or truthfulness — only what the words do.
3. **No fabricated rewrite.** `rewrite` is `null` unless a model adapter was explicitly supplied.
4. **Confidence is heuristic.** It is a language-pattern likelihood, never a probability of deception.
5. **Family is one of the seven** enumerated in the schema.

### Interop

The result is designed to convert cleanly to [SARIF 2.1.0](https://sarifweb.azurewebsites.net/) (see `@rhetorlint/core/sarif`). It is deliberately *not* [ClaimReview](https://schema.org/ClaimReview): RhetorLint analyzes rhetoric in text, it does not rate the truth of a claim. The two are complementary, not the same layer.

## Versioning

`rhetorlint` in the output is the spec version (semver). `0.x` may change shapes; `1.0` will freeze the result object and the family enum.
