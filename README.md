# captioneer-spec

**A portable way to see manipulation in language — and refuse the pseudoscience of "reading the person."**

Captioneer marks countable rhetorical tells in the *words*: a deleted subject that hides who acted, a hedge that lowers a promise you can later deny, an absolute that claims more than anyone could know. Every mark points at a real, visible phrase. It never claims to detect a liar, and it never decides whether a claim is factually true.

This repo is the **open framework** behind [captioneer.io](https://captioneer.io): a specification you can implement in any language, plus a zero-dependency reference engine.

> A real "lie detector" reads a person and returns a verdict. There is no such thing — decades of research say body language, micro-expressions, and voice "stress" don't reliably reveal deception. So Captioneer reads the one place manipulation actually leaves a trace: the language.

## The shape (open the method, not the app)

The durable asset is **data + a schema**, not any one engine — the lesson of Vale and retext. Three layers:

| Layer | What it is |
|-------|-----------|
| **`spec/`** | The language-agnostic core. [`taxonomy.yaml`](spec/taxonomy.yaml) — the families of tells, aligned to the SemEval-2023 persuasion taxonomy, readable as a syllabus. [`output.schema.json`](spec/output.schema.json) — the one result object every implementation emits. |
| **`@captioneer/core`** | A browser-first, zero-dependency JS reference engine that implements the spec. Runs fully on-device. |
| **`@captioneer/rules-en`** | The English tell-pack as declarative rules — compiled into the engine *and* readable by any future Python/Go/Rust engine. |

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
import { analyze } from "@captioneer/core";
import { toSarif } from "@captioneer/core/sarif";
import rules from "@captioneer/rules-en" assert { type: "json" };

const result = analyze("Mistakes were made.", { rules });
// -> { captioneer:"0.1", density:{tells:1, per100Words:33.3}, marks:[…], strip:"[who?] Mistakes were made." }

const sarif = toSarif(result); // flows into editors, CI, code-scanning
```

- **Readers** — the [browser widget](apps/widget): select text on any page, press **Alt+Shift+C**, see the marks. On-device; nothing leaves your browser. (A zero-install bookmarklet too.)
- **Developers** — `@captioneer/core` embeds anywhere JS runs (browser, Node, Deno), emits the versioned JSON.
- **Comms & content teams** — the [`captioneer` CLI](packages/cli) as a spin-check in CI: `captioneer --max 8 comms/*.md` exits non-zero when a file is too thick with spin. `--sarif` surfaces marks in VS Code and GitHub code-scanning.
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

The families map to the SemEval-2023 Task 3 persuasion inventory (Piskorski et al. 2023), which descends from Da San Martino et al. 2019 (the Propaganda Techniques Corpus) via SemEval-2020 Task 11. Captioneer's *structural* tells — deleted subject, agentless passive, rehearsed contrition — are its own extension, mapped to the nearest parent and marked as such.

## Layout

```
spec/            taxonomy.yaml · output.schema.json      the portable core
packages/core/   index.mjs · sarif.mjs                    the reference engine
packages/rules-en/ rules.json                             the English tell-pack
packages/cli/    cli.mjs                                   the CLI (JSON/SARIF, CI spin-gate)
apps/explorer/   index.html                               the learning wing (self-contained)
apps/widget/     manifest.json · build.mjs · src/panel.js the browser widget (extension + bookmarklet)
test/            *.test.mjs                                proves the engine, CLI, and widget build
scripts/demo.mjs                                           a 20-line taste
```

## Status

`0.1` — a seed. It marks eight tell families honestly and under-marks by design. The hard, unfinished work is the structural check-type (agency-hiding beyond simple passive needs real grammar awareness). Contributions of tell families and locales welcome once the contribution guide lands.

MIT (engine + rules) · CC-BY-SA-4.0 (taxonomy corpus). Built for [captioneer.io](https://captioneer.io).
