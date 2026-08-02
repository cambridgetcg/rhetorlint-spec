# RhetorLint

**An inquiry format designed for agents across substrates to inspect rhetoric and clear the ground for truth-seeking.**

RhetorLint turns observable patterns in text into a shared, versioned record. Human readers and software agents implemented across different model and runtime substrates can inspect the same marked spans, compare contestable hypotheses about how wording may alter salience, certainty, agency, attention, or action, and ask what contextual or external evidence is needed next.

The framework supports truth-seeking; it does not manufacture truth. The matched span is a surface observation; its rule ID, family, technique, note, and review prompt are rule-pack interpretations. An effect is established only by recipient- and context-specific evidence. A factual conclusion still requires evidence about the claim itself.

This repository contains the open, language-agnostic schemas and taxonomy, a zero-dependency reference engine, and reference implementations in JavaScript, Python, and Go.

## The focus: from rhetoric to inquiry

RhetorLint keeps four epistemic layers separate:

| Layer | Current role | What it does not claim |
|---|---|---|
| **Surface-linked rule match** | An exact visible span plus configured taxonomy labels and review fields. Implemented by `analyze()`; only the span and position are direct observations. | That the rule-pack interpretation is contextually correct, or that it establishes intent, deception, harm, or truth. |
| **Interpretation hypothesis** | Conditions, alternative readings, and measurable dimensions from the rule pack. Implemented by `toInquiry()`. | That the proposed effect occurred. |
| **Effect evidence** | Downstream requirement, not yet a RhetorLint record: compare a declared recipient/substrate, task, context, intervention, and outcome. | Universal psychology or cross-substrate equivalence. |
| **External fact evidence** | Downstream requirement, not yet a RhetorLint record: gather sources, measurements, contradictions, and provenance through a fact-checking process. | That rhetorical style alone proves or disproves a claim. |

The working chain is:

`visible wording → marker → contestable effect hypothesis` *(implemented)* `→ contextual test → external claim evidence → warranted conclusion` *(downstream)*

The 0.1 schemas stop at hypotheses and verification probes. A downstream study must record the operational context needed to inspect and reproduce a comparison. A participant's declared substrate belongs in that context; it is not proof of identity, consciousness, competence, consent, or authority. RhetorLint neither ranks substrates nor requires metaphysical agreement.

## The shape (open the method, not the app)

The durable asset is **data + schemas**, not any one engine:

| Layer | What it is |
|-------|-----------|
| **`spec/`** | The language-agnostic contracts: [`output.schema.json`](spec/output.schema.json) for surface-linked rule matches, [`inquiry.schema.json`](spec/inquiry.schema.json) for hypotheses and verification probes, and [`taxonomy.yaml`](spec/taxonomy.yaml) for the teachable catalogue and lineage. |
| **`@rhetorlint/core`** | The browser-first, zero-dependency JS reference engine plus SARIF, redacted signal, and inquiry projections. The core performs no network I/O; callers control adapters and exports. |
| **`@rhetorlint/rules-en`** | The English marker pack: declarative matchers, neutral display names, candidate taxonomy-mapping status, applicability conditions, alternative readings, possible measures, and verification questions. The matchers are also read by the Python and Go engines in [`impl/`](impl). |

The marker vocabulary is shared. Effect evidence and factual evidence remain attributable to the participants and methods that supplied them.

## Try it

```bash
node scripts/demo.mjs
```

```
  We take your privacy extremely seriously, and regrettably, mistakes were made. We are reaching out to affected users.

  density: 4 markers / 18 words = 22.2 per 100 words

  · stock contrition phrase [approximate-candidate]  "We take your privacy extremely seriously"
      legacy id contrition.rehearsed
      a stock contrition phrase — the matched phrase names no specific act or remedy
  · intensifier [aligned-candidate]  "extremely"
      legacy id intensifier.loaded
      an intensifier — adds emphasis without adding evidence
  · passive with omitted semantic agent [rhetorlint-extension]  "were made"
      legacy id agency-hiding.deleted-subject
      a passive construction with an omitted agent — this phrase does not name who performed the action
  · qualifier or distancing phrase [approximate-candidate]  "reaching out to"
      legacy id hedge.softener
      a qualifier or distancing phrase — leaves the commitment less specific

  counterfactual (deterministic, on-device):
  We take your privacy seriously, and regrettably, mistakes [who?] were made. We are reaching out to affected users.

  SARIF export: 4 results
```

## Use it in code

```js
import { createRequire } from "node:module";
import { analyze } from "@rhetorlint/core";
import { toSarif } from "@rhetorlint/core/sarif";
import { toSignal } from "@rhetorlint/core/signals";
import { toInquiry } from "@rhetorlint/core/inquiry";

const require = createRequire(import.meta.url);
const rules = require("@rhetorlint/rules-en");

const result = analyze("Mistakes were made.", { rules });
// -> { rhetorlint:"0.1", density:{tells:1, per100Words:33.3}, marks:[…], strip:"Mistakes [who?] were made." }
// the [who?] marker sits at the passive span it questions, not at the start of the sentence

const sarif = toSarif(result); // flows into editors, CI, code-scanning
const signal = toSignal(result); // redacted aggregate for explicit agent traces
const inquiry = toInquiry(result, { rules });
// -> phrase-redacted hypotheses + verification questions, metadata change-detection fingerprint,
//    and an explicit "declared, not semantically verified" assurance boundary
```

- **Readers** — the [browser widget](apps/widget): select text on any page, press **Alt+Shift+R**, and inspect configured patterns. On-device; nothing leaves your browser. (A zero-install bookmarklet too.)
- **Developers and agents** — `@rhetorlint/core` embeds anywhere JS runs, emits versioned surface-linked matches, and projects phrase-redacted signals and inquiry prompts by default.
- **Comms & content teams** — the [`rhetorlint` CLI](packages/cli) can apply an explicitly chosen marker-density policy. Density depends on passage length and pack composition; it is not a truth, intent, harm, or quality score. `--sarif` includes marked snippets and may be uploaded by downstream code-scanning systems.
- **Educators & learners** — the [learning explorer](apps/explorer/index.html) turns each family into a lesson; the taxonomy is CC-BY-SA so you can copy it freely.
- **Researchers** — technique labels record SemEval lineage where mapped. That makes joins possible with explicit mapping caveats; it does not validate RhetorLint's regexes, domains, or effect hypotheses.

```bash
echo "Mistakes were made." | npm run cli -- --json     # the CLI, on stdin
npm run build:widget                                    # generate the extension + bookmarklet
npm run update:explorer                                 # re-inline the canonical pack in the standalone learning page
```

## What it refuses to do

- **No person-reading.** It does not infer a speaker's mind, intent, honesty, consciousness, or identity from wording.
- **No effect verdict.** A rule carries a hypothesis, conditions, alternatives, and possible measures. Actual recipient impact requires contextual or empirical evidence for that recipient and substrate.
- **No truth-score.** It does not adjudicate whether a factual claim is true. Its questions feed a separate fact-checking process; a downstream result may be expressed as [ClaimReview](https://schema.org/ClaimReview) structured data.
- **No false precision.** The legacy `confidence` field is an uncalibrated, author-assigned match weight—not a probability of intent, effect, deception, or truth.
- **No hidden taxonomy verdict.** Current marks say `classificationStatus: "rule-pack-candidate-context-required"` and distinguish aligned candidates, approximate candidates, and RhetorLint extensions. Legacy IDs and SemEval family names remain stable identifiers, not conclusions.
- **No score-only governance.** Density must not be the sole basis for a binding, disciplinary, contractual, reputational, or other high-stakes decision.

## Taxonomy lineage

The families map to the SemEval-2023 Task 3 persuasion inventory (Piskorski et al. 2023), which descends from Da San Martino et al. 2019 via SemEval-2020 Task 11. This is label lineage, not validation of RhetorLint's phrase matchers, generic-domain use, interpretations, or effects. `taxonomyMappingStatus` says whether the rule concept is an aligned candidate, an approximate candidate, or a RhetorLint extension; both candidate values still require context. One family is RhetorLint's own structural extension: **agency-hiding**, currently a heuristic for passives with omitted agents. `contrition.rehearsed` is a RhetorLint-authored legacy ID placed under the nearest SemEval label. Prefer each rule's neutral `displayName` in prose and preserve the mapping status when grouping.

## Reference-output portability — three engines, one ASCII corpus

Three independent engines read the same rule pack and reproduce the same [reference expected outputs](conformance) over the ASCII corpus—every mark, offset, density, and `strip`, value for value:

| engine | language | conformance |
|--------|----------|-------------|
| [`@rhetorlint/core`](packages/core) | JavaScript (browser + Node, zero deps) | `test/conformance.test.mjs` |
| [`impl/python/rhetorlint.py`](impl/python) | Python (stdlib only) | `python3 impl/python/test_conformance.py` |
| [`impl/go/rhetorlint.go`](impl/go) | Go (stdlib only) | `go -C impl/go test ./...` |

```bash
npm run test:conformance     # 15/15 cases — JS and Python only
go -C impl/go test ./...     # the third engine; CI runs all three on every push
```

Agreement is on **values**, not on serialised bytes: the same density that JS and Go write as `"per100Words": 25` Python writes as `25.0`, because that is what each language's JSON encoder does with a whole-numbered float. The suites compare parsed values, which is the only comparison a spec can fairly demand across languages. Offsets agree over the corpus because the corpus is ASCII; [`conformance/README.md`](conformance/README.md) sets out exactly where non-ASCII input parts the engines.

`conformance/cases.json` is a generated reference fixture, not factual or semantic ground truth. Go's RE2 regex has no lookahead, so it reimplements one omitted-agent check in code and still reproduces the same ASCII values. This proves implementation agreement with the reference. It does not prove that a marker is contextually correct, that an effect occurred, or that a claim is true.

## Layout

```
spec/            taxonomy · match + inquiry schemas       the portable contracts
conformance/     cases.json                               ASCII reference outputs
packages/core/   engine · SARIF · signals · inquiry       JS engine + projections
packages/rules-en/ rules.json                             English markers + hypotheses
packages/cli/    cli.mjs                                  JSON/SARIF + marker-density policy
impl/python/     rhetorlint.py                             the Python reference engine
impl/go/         rhetorlint.go                             the Go reference engine
apps/explorer/   index.html                               the learning wing (self-contained)
apps/widget/     manifest.json · build.mjs · src/panel.js the browser widget (extension + bookmarklet)
test/            *.test.mjs                               contracts, engines, CLI, widget
scripts/         demo + conformance/explorer regeneration
```

## Status

`0.1` — a seed. Eleven English rules now pair surface-linked matches with structured effect hypotheses and verification probes. `analyze()` emits exact spans together with legacy rule-pack interpretations and reviewer fields; `toInquiry()` performs the explicit structured join. Effect-study records, factual-evidence resolution, semantic evaluation, Unicode-normalised cross-engine offsets, and calibrated match probabilities remain unfinished. The pack under-marks by design, and zero markers carry no positive verdict.

MIT (engine + rules) · CC-BY-SA-4.0 (taxonomy corpus).
