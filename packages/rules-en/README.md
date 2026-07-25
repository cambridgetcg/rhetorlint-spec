# @rhetorlint/rules-en

The English **tell-pack** for RhetorLint: declarative rules for the families of rhetorical manipulation, aligned to the SemEval-2023 persuasion taxonomy. Data, not code — so any engine in any language can read it.

## Rule shape

```json
{
  "ruleId": "agency-hiding.deleted-subject",
  "family": "agency-hiding",
  "technique": "Obfuscation (structural — RhetorLint extension)",
  "type": "structural",
  "detector": "agentless-passive",
  "level": "warning",
  "confidence": 0.7,
  "note": "an agentless passive — who acted is deleted from the sentence",
  "expected": ["(name who did it: 'I/we + verb')"]
}
```

**Check-types** (kept small on purpose, the Vale lesson):

| `type` | how it matches | example families |
|--------|----------------|------------------|
| `lexical` | word-boundary match against a `terms` list | intensifiers, absolutes, softener hedges |
| `pattern` | a regular expression | weasel attribution, whataboutism, rehearsed contrition |
| `structural` | a named built-in `detector` (currently `agentless-passive`) | agency-hiding |

Simple regex and word-lists cover most families. The structural check-type is what RhetorLint's deleted-subject / agency-hiding tells need — and the part that wants real grammar awareness over time.

Two optional fields qualify a `pattern` rule:

| field | meaning |
|-------|---------|
| `caseSensitive` | `true` compiles the pattern with letter case honoured; absent means case-insensitive, which is the default for every other rule. Only `@rhetorlint/core >= 0.1.2` reads it. |
| `minEngine` | the lowest core version that honours every field the rule depends on. An engine below that floor may refuse the rule, warn, or drop it; it must not assume the rule still means what it says. |

The same pattern string is compiled by the JavaScript, Python and Go engines, so it may only use syntax all three share. Go's RE2 has no lookaround — `(?!…)` will not compile there.

### The engine floor on `shouting.caps`

`shouting.caps` is the one rule about letter case, so it is the one rule that sets `caseSensitive: true` and declares `minEngine: "0.1.2"`. An engine below that floor ignores the flag and compiles the pattern case-insensitively — where a rule for ALL-CAPS would otherwise match any run of two or more ordinary lowercase words, and bury the real tells.

So the pattern is built to match **nothing** under a case-insensitive compile. Each shouted word must open and close with `[A-Z]` around `[^\x00-\x40\x5b-\x7f]` — everything except the ASCII characters outside `A–Z`. Compiled case-insensitively that class rejects letters of either case, and the rule falls silent instead of firehosing. Under-marking is the doctrine: on an old engine the tell is lost, never invented. That class also admits accented capitals inside a word, so `CAFÉS ARE OPEN` is one run.

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

Rules are authored for **honesty over coverage**: they err toward under-marking, and `confidence` reflects language-pattern likelihood, not certainty about intent. A rule that cannot be evaluated correctly marks nothing rather than over-marks. New tell families and locales are welcome — keep every rule pointing at a phrase a reader can see.

MIT.
