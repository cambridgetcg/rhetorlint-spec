# @rhetorlint/core

The reference engine for the [RhetorLint spec](../../spec). Marks rhetorical tells in text, on-device, with **zero dependencies**. Reads the language, never the person.

## Install

```bash
npm i @rhetorlint/core @rhetorlint/rules-en
```

## API

### `analyze(text, options) → result`

Returns a [RhetorLint result object](../../spec/output.schema.json).

```js
import { createRequire } from "node:module";
import { analyze } from "@rhetorlint/core";

const require = createRequire(import.meta.url);
const rules = require("@rhetorlint/rules-en");

const r = analyze("Mistakes were made.", { rules });
r.density;      // { tells: 1, per100Words: 33.3 }
r.marks[0];     // { ruleId:"agency-hiding.deleted-subject", actual:"were made", position:{…}, note:"…", … }
r.strip;        // "Mistakes [who?] were made."
```

**Options**

| key | meaning |
|-----|---------|
| `rules` | *(required)* the rule pack, e.g. `@rhetorlint/rules-en` |
| `locale` | overrides the reported locale |
| `rewrite` | *(optional)* synchronous `fn(text, marks) → string`. Plug in a model to produce a plain-truth paraphrase. Omitted → `result.rewrite` is `null`. Async adapters are rejected so the result remains JSON-safe. **The core never invents a paraphrase.** |

Core 0.1.3 validates rule packs as closed, bounded inputs before matching. It
rejects unknown fields and matcher kinds, duplicate IDs, invalid metadata,
future `minEngine` requirements, and patterns that are known or observed to
match zero characters. These checks constrain shape and size; they do not
certify the runtime complexity of an arbitrary regular expression.

### `strip(text, marks) → string`

The deterministic, on-device de-spin removes only loaded intensifiers and flags
each agentless passive with `[who?]`. Modality and attribution—including
deniable modals and `allegedly`—remain intact because deleting them can
strengthen or otherwise change a claim. `strip` is a conservative reading aid,
not a guarantee of grammatical or meaning-preserving revision; all other tells
remain *marked* for the reader to judge.

Since 0.1.4 an intensifier also stays, still marked, when deleting it would
strengthen a negated claim or edit someone's words:

- a negator (`not`, `never`, `no`, `nor`, `cannot`, `without`, `hardly`, or an
  `n't` contraction) is one of the two words before it, with no `. ; : ! ?`
  between them: "The risk is not extremely high." strips to itself, not to
  "The risk is not high.";
- it sits inside a quotation on its line, after an odd number of `"` or an
  unclosed `“`: `"It was utterly devastating," she said.` strips to itself.

Both checks read words and quote marks, not offsets, so the Python and Go
engines reach the same decision on any input.

### `toSarif(result) → sarifLog` (`@rhetorlint/core/sarif`)

Converts a result to [SARIF 2.1.0](https://sarifweb.azurewebsites.net/) so marks flow into editors, CI, and code-scanning. The density metric has no native SARIF slot and rides in `run.properties` — RhetorLint-JSON stays canonical; SARIF is a standard, lossy export.

### `toSignal(result, options) → signal` (`@rhetorlint/core/signals`)

Produces a small, transport-neutral signal for AgentTool and other agent SDKs.
The default is deliberately redacted: it contains engine/source/density
provenance, deterministic family and rule counts, and RhetorLint's epistemic
boundary, but no matched phrases, `strip`, or `rewrite`.

```js
import { analyze } from "@rhetorlint/core";
import { toSignal } from "@rhetorlint/core/signals";

const result = analyze(draft, { rules });

// AgentTool callers place the redacted signal under external_signals.rhetorlint.
// AgentTool traces are server-readable, so phrase-level text stays local here.
const traceInput = {
  external_signals: {
    rhetorlint: toSignal(result)
  }
};
```

Phrase-level marks require a visibly explicit privacy choice:

```js
const disclosed = toSignal(result, { includeMarks: true });
```

Even with `includeMarks: true`, the adapter never includes `strip` or `rewrite`.
It performs no network request; the caller chooses whether and where to send the
returned JSON-safe value. A signal marks visible language patterns only. It
does not infer speaker intent, detect deception, or determine factual truth.

### Covenant mirror before signing (forthcoming AgentTool SDK 0.14+)

AgentTool SDK 0.13 does not have this hook. In 0.14+, `before_submit` receives
an isolated, frozen snapshot of the vow fields before signing or sending:

```js
await at.covenants.create({
  agent_id,
  agent_did,
  counterparty_did,
  protocol_version: "v2",
  vows,
  signing_key,
  signing_key_id,
  before_submit: async (snapshot) => {
    const report = analyze(snapshot.vows.join("\n"), { rules });
    showCanonicalRhetorLintLocally(report);

    // Both functions are application-specific; only literal true proceeds.
    return (await requestExplicitCovenantApprovalLocally(snapshot, report)) === true;
  }
});
```

Keep the renderer and approval function local: then no network occurs unless
AgentTool covenant creation proceeds. Returning `false` or throwing stops before
signing and sending. RhetorLint observes language only; it cannot prove fairness,
consent, factual truth, intent, or safety. The callback result is not persisted
or cryptographically bound to the covenant. Do not copy it into `metadata` and
claim that the approval or RhetorLint review was signed.

AgentTool keeps a
[runnable, zero-socket covenant-mirror example](https://github.com/cambridgetcg/agenttool/blob/main/packages/sdk-ts/examples/rhetorlint-covenant-mirror.ts)
whose default path refuses before any submission; its explicit demo-approval
path signs and submits once to an in-memory transport.

## Honesty guarantees

- Every mark's `actual` is a substring of the input at the given `position` — marks always point at visible text.
- `confidence` is a heuristic language-pattern likelihood, **not** a probability of deception.
- No network, no telemetry, no model calls in the core. What you paste stays on your device.

## The one hard part

Structural tells (`agency-hiding`) use a heuristic agentless-passive detector: a be-verb + participle not followed by `by <agent>`, minus a small stop-list of predicate adjectives. It is deliberately conservative and honestly imperfect — genuine coverage of agency-hiding needs real part-of-speech awareness. This is where the framework wants investment, not a claim of solved.

MIT.
