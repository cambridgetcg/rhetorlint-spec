# @rhetorlint/core

The reference engine for the [RhetorLint spec](../../spec). It marks configured, visible rhetorical patterns and projects testable inquiry prompts on-device with **zero dependencies**. It reads the language, never the person.

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

Current marks carry a neutral `displayName`,
`classificationStatus: "rule-pack-candidate-context-required"`, and a
`taxonomyMappingStatus`. Historical `ruleId`, family, and technique strings are
stable join keys and lineage labels, not contextual findings.

**Options**

| key | meaning |
|-----|---------|
| `rules` | *(required)* the rule pack, e.g. `@rhetorlint/rules-en` |
| `locale` | overrides the reported locale |
| `rewrite` | *(optional)* synchronous `fn(text, marks) → string`. The returned string is caller-supplied model output. Omitted → `result.rewrite` is `null`. Async adapters are rejected so the result stays JSON-safe. The core does not verify the rewrite's provenance, meaning, evidence, or truth. |

### `strip(text, marks) → string`

Creates a deterministic comparison variant: it removes standalone lexical intensifiers and flags passives with omitted agents using `[who?]`. It preserves modality, attribution, and verb-phrase hedges because deleting them can strengthen a claim or break grammar. The transform is advisory; it is not guaranteed to preserve meaning or factual truth.

### `toSarif(result) → sarifLog` (`@rhetorlint/core/sarif`)

Converts a result to [SARIF 2.1.0](https://sarifweb.azurewebsites.net/) so marks flow into editors, CI, and code-scanning. The density metric has no native SARIF slot and rides in `run.properties`; RhetorLint-JSON stays canonical. SARIF includes exact snippets and downstream systems may upload them. Candidate wording prompts are not emitted as auto-fixes.

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

Phrase-level marks require an explicit API disclosure switch:

```js
const disclosed = toSignal(result, { includeMarks: true });
```

Even with `includeMarks: true`, the adapter never includes `strip` or `rewrite`.
It performs no network request; the caller chooses whether and where to send the
returned JSON-safe value. “Redacted” means phrase text is omitted, not that the
aggregate is anonymous or non-sensitive: length, locale, density, family, and
rule counts remain. A literal switch is not evidence of consent or authority.

### `toInquiry(result, options) → inquiry` (`@rhetorlint/core/inquiry`)

Joins canonical marks to the pack's structured effect hypotheses and
verification questions:

```js
import { toInquiry } from "@rhetorlint/core/inquiry";

const inquiry = toInquiry(result, {
  rules,
  sourceRef: "local-case:42"
});
```

The default contains mark references, conditions, alternative readings,
possible measures, and evidence questions, but no matched phrases, `strip`, or
`rewrite`. Only literal `includeActual: true` adds phrase text.

The boundary is part of the wire object:

- only the matched span and position are direct observations;
- rule ID, display name, family, technique, note, and prompts are
  rule-pack-authored candidate classifications that require context;
- an interpretation is a hypothesis, not a finding;
- an effect requires evidence for a declared recipient/substrate and context;
- a verification probe is a question, not a truth verdict.

The wire object also says that metadata came from the caller-supplied rule pack
and that its boundary is declared, not semantically machine-verified.
`metadataFingerprint` changes when inquiry metadata changes even if a pack
reuses its ID/version. It is a deterministic FNV-1a change detector for
reproducibility, not collision-resistant authentication or proof that a pack is
trusted. It does not bind the supplied metadata to the exact pack bytes used by
the earlier analysis; `assurance.analysisPackBinding` reports the narrower
ID/version and matched-family check.

`sourceRef` is an optional opaque value supplied by the caller. The adapter
does not hash private text automatically. `sourceAccess` always records that
the full source is absent and whether a caller reference or marked phrases were
included. Offsets need the matching source out of band to be independently
checked. Substrate metadata belongs in the
downstream study that actually observed an outcome; `toInquiry()` never
synthesizes a recipient or claims an effect occurred.

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
signing and sending. RhetorLint matches configured language patterns only; it
cannot prove fairness, consent, factual truth, intent, or safety. The callback
result is not persisted or cryptographically bound to the covenant. Do not copy
it into `metadata` and claim that the approval or RhetorLint review was signed.

AgentTool keeps a
[runnable, zero-socket covenant-mirror example](https://github.com/cambridgetcg/agenttool/blob/main/packages/sdk-ts/examples/rhetorlint-covenant-mirror.ts)
whose default path refuses before any submission; its explicit demo-approval
path signs and submits once to an in-memory transport.

## Epistemic guarantees

- Every mark's `actual` is a substring of the input at the given `position` — marks always point at visible text.
- The legacy `confidence` field is an uncalibrated, author-assigned match weight, **not** a probability of intent, effect, deception, or truth.
- Zero marks means only that the configured pack matched nothing.
- Density is pack- and length-dependent and must not be used alone for binding or high-stakes decisions.
- No network, telemetry, or model calls originate in the core. Callers control any adapters, persistence, or exports around it.

## The one hard part

The structural `agency-hiding` marker uses a heuristic passive detector: a be-verb + participle not followed by `by <agent>`, minus a small stop-list of predicate adjectives. Grammatically, the patient may still be the sentence's subject; the heuristic detects an omitted **agent**, not a deleted subject and not deliberate concealment. Genuine coverage needs context and grammar awareness.

MIT.
