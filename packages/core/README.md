# @captioneer/core

The reference engine for the [Captioneer spec](../../spec). Marks rhetorical tells in text, on-device, with **zero dependencies**. Reads the language, never the person.

## Install

```bash
npm i @captioneer/core @captioneer/rules-en
```

## API

### `analyze(text, options) → result`

Returns a [Captioneer result object](../../spec/output.schema.json).

```js
import { analyze } from "@captioneer/core";
import rules from "@captioneer/rules-en" assert { type: "json" };

const r = analyze("Mistakes were made.", { rules });
r.density;      // { tells: 1, per100Words: 33.3 }
r.marks[0];     // { ruleId:"agency-hiding.deleted-subject", actual:"Mistakes were made", position:{…}, note:"…", … }
r.strip;        // "[who?] Mistakes were made."
```

**Options**

| key | meaning |
|-----|---------|
| `rules` | *(required)* the rule pack, e.g. `@captioneer/rules-en` |
| `locale` | overrides the reported locale |
| `rewrite` | *(optional)* `fn(text, marks) → string`. Plug in a model to produce a plain-truth paraphrase. Omitted → `result.rewrite` is `null`. **The core never invents a paraphrase.** |

### `strip(text, marks) → string`

The deterministic, on-device de-spin: removes adverbial spin (intensifiers, deniable adverbs) and flags each agentless passive with `[who?]`. It subtracts spin; it does not paraphrase, so it never breaks a sentence's grammar. Verb-phrase hedges and structural tells are left *marked* for the reader to judge.

### `toSarif(result) → sarifLog` (`@captioneer/core/sarif`)

Converts a result to [SARIF 2.1.0](https://sarifweb.azurewebsites.net/) so marks flow into editors, CI, and code-scanning. The density metric has no native SARIF slot and rides in `run.properties` — Captioneer-JSON stays canonical; SARIF is a standard, lossy export.

## Honesty guarantees

- Every mark's `actual` is a substring of the input at the given `position` — marks always point at visible text.
- `confidence` is a heuristic language-pattern likelihood, **not** a probability of deception.
- No network, no telemetry, no model calls in the core. What you paste stays on your device.

## The one hard part

Structural tells (`agency-hiding`) use a heuristic agentless-passive detector: a be-verb + participle not followed by `by <agent>`, minus a small stop-list of predicate adjectives. It is deliberately conservative and honestly imperfect — genuine coverage of agency-hiding needs real part-of-speech awareness. This is where the framework wants investment, not a claim of solved.

MIT.
