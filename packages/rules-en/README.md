# @rhetorlint/rules-en

The English **marker pack** for RhetorLint: declarative surface matchers plus contestable effect hypotheses and verification questions. Technique labels record SemEval-2023 lineage where mapped; the mapping does not validate these matchers, domains, interpretations, or effects.

## Rule shape

```json
{
  "ruleId": "agency-hiding.deleted-subject",
  "displayName": "passive with omitted semantic agent",
  "family": "agency-hiding",
  "technique": "Obfuscation (structural — RhetorLint extension)",
  "taxonomyMappingStatus": "rhetorlint-extension",
  "type": "structural",
  "detector": "agentless-passive",
  "level": "info",
  "confidence": 0.7,
  "note": "a passive construction with an omitted agent — this phrase does not name who performed the action",
  "expected": ["(name the actor if known, or state that the actor is unknown)"],
  "effectHypotheses": [{
    "id": "actor-attribution.reduce",
    "dimension": "actor-attribution",
    "operation": "reduce",
    "description": "May make actor identification or responsibility attribution harder for a recipient.",
    "conditions": ["The actor is not named nearby or already known, and actor attribution matters to the task."],
    "alternatives": ["The actor may be unknown, irrelevant, named elsewhere, or conventionally omitted."],
    "measures": ["actor identified", "responsibility assignment"]
  }],
  "verificationProbes": [{
    "id": "passive.identify-actor",
    "question": "Who performed the action, is that actor known, and what evidence supports the attribution?",
    "evidenceNeeded": ["records identifying the actor"]
  }]
}
```

**Check-types** (kept small on purpose, the Vale lesson):

| `type` | how it matches | example families |
|--------|----------------|------------------|
| `lexical` | word-boundary match against a `terms` list | intensifiers, absolutes, softener hedges |
| `pattern` | a regular expression | weasel attribution, whataboutism, rehearsed contrition |
| `structural` | a named built-in `detector` (currently `agentless-passive`) | agency-hiding |

Simple regex and word-lists cover most families. The structural check-type currently detects some passive constructions with omitted agents. It does not establish that the agent was deliberately hidden; context and grammar awareness remain future work.

## Inquiry metadata

Every seeded rule declares:

| field | meaning |
|---|---|
| `effectHypotheses` | Possible, recipient-specific effects stated with modality. Each names applicability conditions, plausible alternative readings, and observable measures. |
| `verificationProbes` | Questions and evidence needs that can feed contextual testing or external fact-checking. They are not conclusions. |
| `expected` | A candidate clarity prompt for review. It is not a verified replacement and may not preserve meaning. |
| `displayName` | Neutral label for prose and interfaces. Prefer it over intent-laden legacy rule IDs. |
| `taxonomyMappingStatus` | `aligned-candidate`, `approximate-candidate`, or `rhetorlint-extension`. Candidate mappings still require context and are not findings. |

`@rhetorlint/core/inquiry` joins this metadata to canonical marks without
changing the stable mark schema. Phrase text is omitted by default. Actual
effects require a downstream study with a declared recipient/substrate, task,
context, intervention, observed outcome, method, uncertainty, and limits.

Two optional fields qualify a `pattern` rule:

| field | meaning |
|-------|---------|
| `caseSensitive` | `true` compiles the pattern with letter case honoured; absent means case-insensitive, which is the default for every other rule. Only `@rhetorlint/core >= 0.1.2` reads it. |
| `minEngine` | the lowest core version that honours every field the rule depends on. An engine below that floor may refuse the rule, warn, or drop it; it must not assume the rule still means what it says. |

The same pattern string is compiled by the JavaScript, Python and Go engines, so it may only use syntax all three share. Go's RE2 has no lookaround — `(?!…)` will not compile there.

The pack's package-level peer floor is `@rhetorlint/core >= 0.1.3`. Older cores
can still match much of the wording, but they do not emit the neutral display
name, candidate/context-required classification status, or taxonomy mapping
status and therefore do not implement this pack's full interpretation boundary.
The rule-level `minEngine` below describes a narrower matcher requirement.

### The engine floor on `shouting.caps`

`shouting.caps` is the one rule about letter case, so it is the one rule that sets `caseSensitive: true` and declares `minEngine: "0.1.2"`. An engine below that floor ignores the flag and compiles the pattern case-insensitively — where a rule for ALL-CAPS would otherwise match any run of two or more ordinary lowercase words and bury the intended matches.

So the pattern is built to match **nothing** under a case-insensitive compile. Each shouted word must open and close with `[A-Z]` around `[^\x00-\x40\x5b-\x7f]` — everything except the ASCII characters outside `A–Z`. Compiled case-insensitively that class rejects letters of either case, and the rule falls silent instead of firehosing. Under-marking is the doctrine: on an old engine the marker is lost, never invented. That class also admits accented capitals inside a word, so `CAFÉS ARE OPEN` is one run.

## The seed families

11 rules across 5 of the taxonomy's 7 families:

| family | rules |
|--------|-------|
| `manipulative-wording` | `intensifier.loaded` · `hedge.softener` · `hedge.deniable` · `weasel.attribution` · `contrition.rehearsed` · `lure.free-offer` · `shouting.caps` |
| `simplification` | `absolute.universal` |
| `distraction` | `deflection.whataboutism` |
| `call` | `urgency.appeal-to-time` |
| `agency-hiding` | `agency-hiding.deleted-subject` |

`attack-on-reputation` and `justification` are named in the taxonomy and not yet seeded here.

The human-readable, teachable version — with definitions, worked examples, and SemEval lineage — lives in [`spec/taxonomy.yaml`](../../spec/taxonomy.yaml). This JSON is its compiled, runtime form.

## Authoring note

Rules are authored for **bounded surface matching over coverage**: they err toward under-marking, and every match points at a phrase a reader can see. The legacy `confidence` number is an uncalibrated, author-assigned match weight, not a probability of intent, effect, deception, or truth.

Controls matter as much as positive examples. A safety rule (“Never print credentials”), epistemic uncertainty (“The server may have failed”), scientific passive (“The sample was heated”), genuine emergency (“ACT NOW: leave the building”), quotation, or legitimate comparison may match a surface pattern without supporting the pack's most concerning interpretation. Context, alternatives, and disagreement must stay visible.

Some stable 0.1 IDs and family names preserve historical taxonomy wording:
`hedge.deniable`, `weasel.attribution`, `contrition.rehearsed`,
`lure.free-offer`, and `agency-hiding.deleted-subject`, under families such as
`manipulative-wording`. They are identifiers, not intent or effect findings.
Current engines emit a neutral `displayName`,
`classificationStatus: "rule-pack-candidate-context-required"`, and the mapping
status with every mark.

MIT.
