# RhetorLint

**A portable way to see manipulation in language — and refuse the pseudoscience of "reading the person."**

RhetorLint marks countable rhetorical tells in the *words*: a deleted subject that hides who acted, a hedge that lowers a promise you can later deny, an absolute that claims more than anyone could know. Every mark points at a real, visible phrase. It never claims to detect a liar, and it never decides whether a claim is factually true.

This repository is the **open RhetorLint framework**: a specification you can implement in any language, plus a zero-dependency reference engine.

> A real "lie detector" reads a person and returns a verdict. There is no such thing — decades of research say body language, micro-expressions, and voice "stress" don't reliably reveal deception. So RhetorLint reads the one place manipulation actually leaves a trace: the language.

## The shape (open the method, not the app)

The durable asset is **data + a schema**, not any one engine — the lesson of Vale and retext. Three layers:

| Layer | What it is |
|-------|-----------|
| **`spec/`** | The language-agnostic core. [`taxonomy.yaml`](spec/taxonomy.yaml) — the families of tells, aligned to the SemEval-2023 persuasion taxonomy, readable as a syllabus. [`output.schema.json`](spec/output.schema.json) — the one result object every implementation emits. |
| **`@rhetorlint/core`** | A browser-first, zero-dependency JS reference engine that implements the spec. Runs fully on-device. |
| **`@rhetorlint/rules-en`** | The English tell-pack as declarative rules — compiled into the engine *and* readable by any future Python/Go/Rust engine. |

The taxonomy is the framework, the curriculum, and the moat — all at once.

## Try it

```bash
node scripts/demo.mjs
```

```
  We take your privacy extremely seriously, and regrettably, mistakes were made. We are reaching out to affected users.

  density: 4 tells / 18 words = 22.2 per 100 words

  · [manipulative-wording]  "We take your privacy extremely seriously"
      rehearsed contrition — the shape of an apology with the substance removed
  · [manipulative-wording]  "extremely"
      an intensifier — turns up the emotional volume without adding fact
  · [agency-hiding]  "were made"
      an agentless passive — who acted is deleted from the sentence
  · [manipulative-wording]  "reaching out to"
      a hedge — lowers a promise you can later deny
```

## Use it in code

```js
import { createRequire } from "node:module";
import { analyze } from "@rhetorlint/core";
import { toSarif } from "@rhetorlint/core/sarif";
import { toSignal } from "@rhetorlint/core/signals";

const require = createRequire(import.meta.url);
const rules = require("@rhetorlint/rules-en");

const result = analyze("Mistakes were made.", { rules });
// -> { rhetorlint:"0.1", density:{tells:1, per100Words:33.3}, marks:[…], strip:"[who?] Mistakes were made." }

const sarif = toSarif(result); // flows into editors, CI, code-scanning
const signal = toSignal(result); // redacted aggregate for explicit agent traces
```

- **Readers** — the [browser widget](apps/widget): select text on any page, press **Alt+Shift+R**, see the marks. On-device; nothing leaves your browser. (A zero-install bookmarklet too.)
- **Developers** — `@rhetorlint/core` embeds anywhere JS runs (browser, Node, Deno), emits the versioned JSON, and projects explicitly shareable signals without phrase text by default.
- **Comms & content teams** — the [`rhetorlint` CLI](packages/cli) as a spin-check in CI: `rhetorlint --max 8 comms/*.md` exits non-zero when a file is too thick with spin. `--sarif` surfaces marks in VS Code and GitHub code-scanning.
- **Educators & learners** — the [learning explorer](apps/explorer/index.html) turns each family into a lesson; the taxonomy is CC-BY-SA so you can copy it freely.
- **Researchers** — tell labels reuse SemEval-2023 technique names, so output is interoperable with the largest annotated persuasion corpora.

```bash
echo "Mistakes were made." | npm run cli -- --json     # the CLI, on stdin
npm run build:widget                                    # generate the extension + bookmarklet
```

## What it refuses to do

- **Never reads the person.** No tone, intent, or deception inference. Micro-expression and voice-stress "lie detection" is pseudoscience (see NAS 2003 on polygraphy); a tool that claims it manufactures confident accusations.
- **No truth-score.** It does not adjudicate whether a claim is factually true — that is a fact-checker's job (see [ClaimReview](https://schema.org/ClaimReview)), a different tool.
- **No false precision.** Persuasion-technique detection is an open research problem. `confidence` is a heuristic language-pattern likelihood, never a probability that anyone is lying.

## Taxonomy lineage

The families map to the SemEval-2023 Task 3 persuasion inventory (Piskorski et al. 2023), which descends from Da San Martino et al. 2019 (the Propaganda Techniques Corpus) via SemEval-2020 Task 11. RhetorLint's *structural* tells — deleted subject, agentless passive, rehearsed contrition — are its own extension, mapped to the nearest parent and marked as such.

## Proven portable — three engines, one taxonomy

The claim that "engines are just implementations of the spec" is not a promise here — it's a test. Three independent engines, in three languages, read the **same** rule pack and reproduce the **same** [conformance corpus](conformance) byte for byte:

| engine | language | conformance |
|--------|----------|-------------|
| [`@rhetorlint/core`](packages/core) | JavaScript (browser + Node, zero deps) | `test/conformance.test.mjs` |
| [`impl/python/rhetorlint.py`](impl/python) | Python (stdlib only) | `python3 impl/python/test_conformance.py` |
| [`impl/go/rhetorlint.go`](impl/go) | Go (stdlib only) | `go -C impl/go test ./...` |

```bash
npm run test:conformance    # 10/10 cases, identical across engines
```

`conformance/cases.json` is the ground truth. The Go engine is the sharpest proof: Go's RE2 regex has **no lookahead**, so it can't express the `(?!by)` agent-check the other two use — it reimplements that check in code and *still* produces identical output. That's precisely what a conformance suite is for: it pins the output, not the implementation. Point a fourth engine in any language at `cases.json` and you'll know instantly whether it conforms — which is what makes RhetorLint a spec, not just one library.

## Layout

```
spec/            taxonomy.yaml · output.schema.json      the portable core
conformance/     cases.json                               the cross-engine ground truth
packages/core/   index.mjs · sarif.mjs · signals.mjs      JS engine + explicit exports
packages/rules-en/ rules.json                             the English tell-pack
packages/cli/    cli.mjs                                   the CLI (JSON/SARIF, CI spin-gate)
impl/python/     rhetorlint.py                             the Python reference engine
impl/go/         rhetorlint.go                             the Go reference engine
apps/explorer/   index.html                               the learning wing (self-contained)
apps/widget/     manifest.json · build.mjs · src/panel.js the browser widget (extension + bookmarklet)
test/            *.test.mjs                                proves the engines, CLI, widget, conformance
scripts/demo.mjs                                           a 20-line taste
```

## Status

`0.1` — a seed. It marks eight tell families honestly and under-marks by design. The hard, unfinished work is the structural check-type (agency-hiding beyond simple passive needs real grammar awareness). Contributions of tell families and locales welcome once the contribution guide lands.

MIT (engine + rules) · CC-BY-SA-4.0 (taxonomy corpus).
