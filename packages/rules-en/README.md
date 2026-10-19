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
  "level": "note",
  "confidence": 0.6,
  "note": "a past-tense passive of a fault, breach, concealment or decision verb — the doer is not named in this clause",
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

### The accountable-passive detector behind `agency-hiding.deleted-subject`

Since core 0.1.4 the `agentless-passive` detector marks a `was`, `were` or `been` passive only when its verb is on a closed list of fault, breach, concealment and decision verbs and no `by` stands among the next seven words of its clause: at most one adverb, then a participle of a fault, a breach or a concealment ("Records were withheld"), a light verb after an error or decision noun ("Mistakes were made"), `raised` after a challenge noun ("Concerns were raised"), `agreed`, `decided` or `determined` after `it` ("It was decided that the program would end"), `shared`, `sold` or `disclosed` after a data noun ("Your data was shared"), or `affected` or `impacted` after a data or account noun ("Approximately 4,000 accounts may have been affected"). A `by` among the next seven words of the clause silences it, whether it names an agent ("…by Forbes") or only a time ("shelved by Friday", a known under-mark); a `by` further on does not ("Mistakes were made in the preparation of the quarterly report by the finance team." is marked). A negator anywhere in its clause before the auxiliary, counted from the last `.`, `;`, `:`, `!`, `?` or line break, silences it too, because a negated passive denies the act however long its subject: "Your data was never sold.", "Passwords have not been compromised.", "No credit card numbers, bank account details or passwords were stolen." The clause reading cannot tell which verb a negator negates, so "No one called, but data were stolen." and "But we did not achieve what we wished, and serious mistakes were made in trying to do so." go unmarked: recorded misses in the safe direction. Present and modal `be` passives ("can be frozen"), harm and news verbs ("Lives were lost in the earthquake"), and routine data handling (`collected`, `retained`, `transferred`) are unmarked by design; a modal perfect ("may have been accessed") reads as past and is marked. The listed verbs keep innocent senses the words cannot tell apart, and those are still marked: "Federal income tax was withheld.", "Unknown keys were ignored.", "Repeated measures were taken at baseline.", "Port 8080 was exposed in the Dockerfile." Open O2 rows in [`measurement/contrast.json`](../../measurement/contrast.json) record each class. The word lists are not in this pack: they live in [`spec/agency-lexicon.json`](../../spec/agency-lexicon.json), which a generator writes into every engine, because a new rule field would make core 0.1.3 reject the whole pack. The pack changed only the rule's note, level (`warning` → `note`) and confidence (0.7 → 0.6), so 0.2.1 still parses on core 0.1.3 and on 0.1.2, the core npm has. Its note describes the 0.1.4 detector, though, and an older core would put it on its old, wider marks ("Shipments are often delayed.", "The soup can be frozen."), so the pack's peer floor is core 0.1.4. Bump core and rules-en together: with core 0.1.2 pinned, npm refuses a rules-en-only bump (ERESOLVE on this optional peer's range), and if it is forced, or an installer only warns on peers, every old passive mark carries the new note, which is false of most of them.

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

An absolute under a negator is a disclaimer, the opposite of an overclaim: "Returns are not guaranteed", "Results aren't always typical", "Not everyone qualifies". A clause-initial "Never" before a verb is advice to the reader, not a claim about what never happens: "Never share your password with anyone.", "Explain real constraints; never manufacture the shortage." Core 0.1.4, and the Python and Go engines that reproduce it, leave both unmarked:

- **negated**: a negator (the agency detector's `cannot`, `neither`, `never`, `no`, `nobody`, `none`, `nor`, `not` and `nothing`; `hardly` and `without`; or an `n't` contraction, with either apostrophe) is one of the two words before the term, with no `. ; : ! ?` between them. A comma between them also ends the negator's reach once a word stands between the negator and the comma: "No risk, guaranteed." and "No fees, always free." stay marked. A negator followed directly by a comma still reaches past the aside: "Past performance is not, however, always a guide." stays unmarked. `strip` uses the same window to keep a negated intensifier, without the comma rule, so "It isn't, frankly, extremely high." keeps its "extremely".
- **imperative**: the term is `never`, in any letter case; only non-word characters stand between it and the start of the text or one of `. ; : ! ?`; and spaces or tabs, then a word that starts with a lowercase ASCII letter, follow it. That word must not be one of `a an the any before such has had is are was were will would could can did does been being`, compared whole and in ASCII lower case: after these "Never" opens a fragment or an inversion, a claim, so "Battery life? Never an issue." and "Never has a product been this good." stay marked. Words that can open advice as well as an inversion are not listed, so the advice stays unmarked and the inversion goes unmarked with it: "Never have regrets." but also "Never have I seen prices this low."; "Never at any time disclose your password." but also "Never in history has a deal been better."; likewise `so`, `on` and `should` ("Never should you share your password."). The adverbs `again`, `ever` and `once` are stepped over the same way, and the word after them decides: "Never ever share your password." is advice; "Never again will prices be this low." is an inversion; "Never again." is a fragment.

Every other absolute is marked as before. The guard is keyed by ruleId in the engine, not written into this pack: a new rule field would make core 0.1.3 reject the whole pack, so the pack is unchanged and an older engine still marks these sentences. It is declared where it can be checked instead: `guard_examples` on the tell in [`spec/taxonomy.yaml`](../../spec/taxonomy.yaml) (nine sentences it must leave unmarked, eleven it must still mark), which [`test/taxonomy-agreement.test.mjs`](../../test/taxonomy-agreement.test.mjs) runs, and conformance cases that all three engines reproduce. The guard reads position, punctuation and two closed word lists, not grammar, so it still errs both ways; open O6 rows in [`measurement/contrast.json`](../../measurement/contrast.json) record the known cases. It leaves some overclaims unmarked. A clause-initial "never" before any other lowercase word reads as an imperative, so a headline claim after a colon goes unmarked ("Your data: never sold."; "The result: never fails." is the same miss). Ending the clause test at `:` would also mark advice after a label ("Rule: never share your password."), so the miss is kept. A negator that governs another word still counts when no comma separates it from the absolute ("There's no doubt everyone loves it."). The inversions after `have` and `in` above are recorded misses too. And the comma rule marks two known disclaimers, "Returns are not, and cannot be, guaranteed." and "This isn't, and never was, guaranteed.", where the comma closing the aside ends the negator's reach; and advice after a negated clause, "If you're not sure, always ask." and "If it isn't broken, never fix it.", which were marked before the guard existed and are again. The words that keep a clause-initial "Never" marked also open sentences that claim nothing, and those stay marked: "Never the less, we shipped on time." (a spelling of "nevertheless"), "Never can tell with these things.", "Never is a long time." and "Never being late is the secret to keeping a job." Taking `the`, `can`, `is` or `being` off the list would unmark the fragments and inversions they open, so these are recorded too. A comma after "Never" defeats the imperative test ("Never, ever share your PIN."). Four earlier misses now hold: an inversion, a guarantee after a comma, a list of negatives, and "Nothing is guaranteed.", since the guard reads the agency detector's negators (both lists live in `spec/guard-lexicon.json` and `spec/agency-lexicon.json` in the source repository, generated into every engine).

## The seed families

22 rules across 6 of the taxonomy's 7 families:

| family | rules |
|--------|-------|
| `manipulative-wording` | `intensifier.loaded` · `hedge.softener` · `hedge.deniable` · `weasel.attribution` · `contrition.rehearsed` · `lure.free-offer` · `shouting.caps` · `euphemism.institutional` · `editorializing.stance` · `attribution.factive` · `implicative.shortfall` · `sourcing.anonymous` · `combat.attack-verb` · `exoneration.formula` · `insinuation.raises-questions` · `puffery.peacock` |
| `simplification` | `absolute.universal` |
| `distraction` | `deflection.whataboutism` |
| `attack-on-reputation` | `attribution.doubt-verb` · `distancing.doubt-marker` |
| `call` | `urgency.appeal-to-time` |
| `agency-hiding` | `agency-hiding.deleted-subject` (accountable past passives; see above) |

`justification` is named in the taxonomy and not yet seeded here.

The human-readable, teachable version — with definitions, worked examples, and SemEval lineage — lives in [`spec/taxonomy.yaml`](../../spec/taxonomy.yaml). This JSON is its runtime form; no engine reads the YAML, so [`test/taxonomy-agreement.test.mjs`](../../test/taxonomy-agreement.test.mjs) holds the two to the same ids, families and technique labels.

## Authoring note

Rules are authored for **honesty over coverage**: they err toward under-marking, and `confidence` reflects language-pattern likelihood, not certainty about intent. A rule that cannot be evaluated correctly marks nothing rather than over-marks. New tell families and locales are welcome — keep every rule pointing at a phrase a reader can see.

MIT.
