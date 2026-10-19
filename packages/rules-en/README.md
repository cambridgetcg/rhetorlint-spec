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

### Typographic variants

Published text often sets an apostrophe as U+2019 (the typographic apostrophe) and a hyphen as U+2010 (hyphen), U+2011 (non-breaking hyphen) or U+2013 (en dash). A tell spelt only in ASCII goes silent on that text, so since 0.2.1 the pack spells the variants itself, and no engine has to normalise anything:

- a pattern writes an apostrophe as `['\u2019]` and a hyphen as `[-\u2010\u2011\u2013]`, keeping the space where the ASCII class had one (`risk[-\u2010\u2011\u2013 ]free`);
- a lexical rule lists each term that holds an apostrophe or hyphen once per variant (`so-called`, `so\u2010called`, `so\u2011called`, `so\u2013called`), with every hyphen in a term set the same way.

`rules.json` writes the variants as `\u` escapes, because U+2011 cannot be told from `-` in review. The variants add no field and no `minEngine`, so any engine that reads 0.2.0 reads 0.2.1. [`test/typography.test.mjs`](../../test/typography.test.mjs) fails when an ASCII term or pattern literal gains an apostrophe or hyphen without its variants, and the JavaScript, Python and Go engines are held to the same twelve typographic probes. Other look-alikes, such as U+02BC or an em dash, are not spelt: a tell written with them stays unmarked rather than guessed at.

### The engine-side guard on `absolute.universal`

An absolute under a negator is a disclaimer, the opposite of an overclaim: "Returns are not guaranteed", "Results aren't always typical", "Not everyone qualifies". A clause-initial "Never" before a lowercase word is advice to the reader, not a claim about what never happens: "Never share your password with anyone.", "Explain real constraints; never manufacture the shortage." Core 0.1.4, and the Python and Go engines that reproduce it, leave both unmarked:

- **negated**: a negator (`not`, `never`, `no`, `nor`, `cannot`, `without`, `hardly`, or an `n't` contraction, with either apostrophe) is one of the two words before the term, with no `. ; : ! ?` between them. It is the same check `strip` uses to keep a negated intensifier.
- **imperative**: the term is `never`, in any letter case; only non-word characters stand between it and the start of the text or one of `. ; : ! ?`; and spaces or tabs, then a lowercase ASCII letter, follow it.

Every other absolute is marked as before. The guard is keyed by ruleId in the engine, not written into this pack: a new rule field would make core 0.1.3 reject the whole pack, so the pack is unchanged and an older engine still marks these sentences. It is declared where it can be checked instead: `guard_examples` on the tell in [`spec/taxonomy.yaml`](../../spec/taxonomy.yaml) (five sentences it must leave unmarked, three it must still mark), which [`test/taxonomy-agreement.test.mjs`](../../test/taxonomy-agreement.test.mjs) runs, and conformance cases that all three engines reproduce. The guard reads position and letter case, not grammar, so it also leaves some overclaims unmarked. Its known misses are open O6 rows in [`measurement/contrast.json`](../../measurement/contrast.json). Any clause-initial "never" before a lowercase word reads as an imperative: an inversion ("Never again will prices be this low.") and a headline claim after a colon ("Your data: never sold.") are both left unmarked. A negator that governs another word still counts: within the clause ("There's no doubt everyone loves it."), across a comma, which is not a clause break ("No risk, guaranteed."), and before a negative absolute in a list ("No contracts, no fees, no exceptions.").

## The seed families

22 rules across 6 of the taxonomy's 7 families:

| family | rules |
|--------|-------|
| `manipulative-wording` | `intensifier.loaded` · `hedge.softener` · `hedge.deniable` · `weasel.attribution` · `contrition.rehearsed` · `lure.free-offer` · `shouting.caps` · `euphemism.institutional` · `editorializing.stance` · `attribution.factive` · `implicative.shortfall` · `sourcing.anonymous` · `combat.attack-verb` · `exoneration.formula` · `insinuation.raises-questions` · `puffery.peacock` |
| `simplification` | `absolute.universal` |
| `distraction` | `deflection.whataboutism` |
| `attack-on-reputation` | `attribution.doubt-verb` · `distancing.doubt-marker` |
| `call` | `urgency.appeal-to-time` |
| `agency-hiding` | `agency-hiding.deleted-subject` |

`justification` is named in the taxonomy and not yet seeded here.

The human-readable, teachable version — with definitions, worked examples, and SemEval lineage — lives in [`spec/taxonomy.yaml`](../../spec/taxonomy.yaml). This JSON is its runtime form; no engine reads the YAML, so [`test/taxonomy-agreement.test.mjs`](../../test/taxonomy-agreement.test.mjs) holds the two to the same ids, families and technique labels.

## Authoring note

Rules are authored for **honesty over coverage**: they err toward under-marking, and `confidence` reflects language-pattern likelihood, not certainty about intent. A rule that cannot be evaluated correctly marks nothing rather than over-marks. New tell families and locales are welcome — keep every rule pointing at a phrase a reader can see.

MIT.
