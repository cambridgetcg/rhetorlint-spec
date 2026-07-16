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

## The seed families

`intensifier.loaded` · `absolute.universal` · `hedge.softener` · `hedge.deniable` · `weasel.attribution` · `deflection.whataboutism` · `contrition.rehearsed` · `agency-hiding.deleted-subject`

The human-readable, teachable version — with definitions, worked examples, and SemEval lineage — lives in [`spec/taxonomy.yaml`](../../spec/taxonomy.yaml). This JSON is its compiled, runtime form.

## Authoring note

Rules are authored for **honesty over coverage**: they err toward under-marking, and `confidence` reflects language-pattern likelihood, not certainty about intent. New tell families and locales are welcome — keep every rule pointing at a phrase a reader can see.

MIT.
