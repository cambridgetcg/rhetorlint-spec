# measurement/: does the engine agree with people?

`conformance/` asks whether the three engines (JS, Python, Go) agree with each
other, value for value. `measurement/` asks a different question: when the
reference engine marks a phrase, would a careful reader agree that the phrase
does the work the rule names? The two are kept apart on purpose. Changing a
label here can never change an engine's ground truth, and nothing in
`conformance/` depends on these files.

What this measures is precision (are the marks right?) and, through the gold
spans, a little recall (are the phrases a reader marked found at all?). It does
not measure truth: no label says whether a claim is true, and no label reads the
person who wrote the text.

## Files

| file | what it holds |
|---|---|
| `items/<id>.txt` | the committed texts, LF only, at most 20 KB each |
| `items.json` | one row per item: stratum, register, licence, source URL, retrieval date, sha256, word count, title, publisher, provenance, the licence statement as read on the source page, and the excerpt kept |
| `labels.json` | one reader's label for every mark, keyed by `(item, ruleId, start, end)` |
| `gold.json` | spans a reader marked before looking at the engine's output, for recall |
| `baseline.json` | per-rule FPB and FPW counts of the canonical engine; the ratchet |
| `report.json` | the generated report (`node scripts/measure.mjs --write`) |
| `schema/*.schema.json` | the shapes of items, labels and gold |
| `NOTICE` | licence notices for the third-party texts |
| `local/` | gitignored: uncommittable evidence (see below) |

Offsets are UTF-16 code units, the same unit `packages/core` reports, and each
label's `actual` must equal the item text at those offsets.

## Labels

Each mark gets exactly one label. A label is one reader's judgement in context,
not proof, and the rows say who made it (`by`) and when (`date`).

| label | meaning | example from the committed items |
|---|---|---|
| `TP` | right construction, in use, doing the work the rule names | `was inadvertently published` (us-irs-form-990t-2022): the agency's own disclosure error, with the doer deleted and the act softened |
| `MENTION` | right construction, but the text quotes or exhibits it, as a specimen or in critique | a page that quotes "mistakes were made" to show what a non-apology looks like |
| `DEBATABLE` | right construction; whether it does that work here is a judgement call | `whose accounts were accessed` (us-irs-get-transcript-2015-05): a breach passive, but the statement names the criminals a few sentences earlier |
| `FPB` | right surface construction, benign in context | `the except clause is executed` (py-tutorial-errors): a procedural passive with no actor worth naming |
| `FPW` | wrong construction: the match is not the thing the rule describes | `sections of TEOS are unaffected` (us-irs-form-990t-2022): `unaffected` is an adjective, not a passive |

Strict precision counts only `TP`. Lenient precision counts `TP`, `MENTION` and
`DEBATABLE`. Both come with Wilson 95% intervals, and a rule with fewer than 5
marks in a stratum is reported as `unmeasured`.

Every label also carries a reason from a closed list:

- `accountable-act`: a passive of an act someone answers for (a fault, a breach, concealment, a decision or a vague remedy).
- `quoted-specimen`: the phrase is quoted as an example.
- `procedural-present`: routine procedure or system behaviour, mostly in the present or a modal; it also covers technical invariants ("always closes the file") and methods-section passives.
- `stative-adjective`: the participle describes a state or a name ("is located", "is known as", "unaffected").
- `named-agent`: the doer is named, in the clause or in the sentence next to it.
- `negated-disclaimer`: the phrase sits inside a negation ("not always", "has not been affected").
- `imperative`: an instruction or advice to the reader.
- `boilerplate`: a fixed signpost ("can be found on").
- `other`: none of the above. For a `TP` on a rule other than agency-hiding it means the tell is simply in use.

## Strata and licences

| stratum | items | licence | what it is for |
|---|---|---|---|
| `pastiche` | 6 | CC-BY-SA-4.0 | spin and ham pastiches written by an agent **after reading `rules.json`**. They are rules-aware, so they flatter the rules: reported, and never used to gate anything |
| `wild-pd` | 1 | US-federal-public-domain | an excerpt of the archives.gov Declaration transcript |
| `target-genre` | 13 | US-federal-public-domain, OGL-UK-3.0 | breach and incident statements by the IRS, CMS and UK government departments: the genre the agency-hiding rule is about |
| `technical` | 6 | PSF-2.0 | excerpts of the Python documentation: procedural text full of benign passives, as a negative control |

The report also pools `legacy` (pastiche and wild-pd, the 7 items carried over
from the first empirical reading) and `wild` (everything except pastiche).
Proposed floors are checked on `wild` only: lenient precision of at least 0.80
for a `warning` rule, 0.67 for `note` and 0.50 for `info`, at least 5 marks, and
no `FPW` at all. These floors are reported as `release_blockers` and never gate
a build. The precision numbers come from one reader on a small corpus.

Only text whose licence was confirmed on the source's own page is committed.
Wire-credited, contractor-authored and third-party-quoted passages are left out.
Quotations of officials speaking in office are kept, because they are the
agency's own words.

## Gold

`gold.json` holds two sets of spans:

- `legacy-semeval`: the first reader's manipulative spans in the four spin pastiches, each tagged with its nearest SemEval-2023 technique. These have no intended rule, so they count only toward any-rule recall.
- `accountable-passive-v1`: passives of accountable acts with no doer in their clause, in the target-genre items, intended for `agency-hiding.deleted-subject`.

Neither set is blind, because both annotators had read `rules.json`. The second
set was annotated from the text alone before any detector ran on these items,
and `before_detectors` records this. Recall is reported per intended rule. A
gold span found only by some other rule is listed separately as an incidental
overlap.

## Running it

```
node scripts/measure.mjs              # per-rule x stratum table for the canonical engine
node scripts/measure.mjs --check      # exit 1 if report.json is stale or a mark is unlabelled
node scripts/measure.mjs --write      # regenerate report.json (deterministic, no timings)
node scripts/measure.mjs --table      # markdown for a PR body
node scripts/measure.mjs --compare <git-rev>   # that revision's core and rules on today's items and labels
node scripts/measure.mjs --local      # add the uncommitted strata in measurement/local/ to the printout
node --test test/measurement.test.mjs
```

`test/measurement.test.mjs` fails when:

- a mark the engine makes on a committed item has no label. It prints ready-to-review proposal rows, the way `scripts/gen-conformance.mjs` proposes cases;
- a label's `actual` or a gold span's `text` differs from the item at its offsets;
- any rule's FPB+FPW count differs from `baseline.json`. A rise is a regression to fix. A fall is a gain: lock it in by updating `baseline.json` in the same commit;
- `report.json` is stale.

## Adding an item

1. Confirm the licence on the source's own page. It must be one of `CC-BY-SA-4.0`, `US-federal-public-domain`, `OGL-UK-3.0` or `PSF-2.0`, and you should quote the statement into `licence_evidence`. Leave out wire-credited, contractor-authored and third-party-quoted passages.
2. Save the text as `items/<id>.txt`: plain text, LF line endings, at most 20 KB, no email addresses, nothing reworded. Record what you cut in `excerpt`.
3. Add its row to `items.json` with the sha256 and the whitespace word count. Add an attribution to `NOTICE` if the licence asks for one.
4. If the item is target-genre, annotate any gold spans **before** running a detector on it.
5. Run `node --test test/measurement.test.mjs`. Hand-label every proposal row it prints and add the rows to `labels.json`. Do not copy the engine's view: label what the phrase does in context.
6. Run `node scripts/measure.mjs --write`. If false positives were added, update `baseline.json` and say why in the commit message.

## measurement/local/

This directory is gitignored, and nothing in it is ever committed or written
into `report.json`. It holds evidence that cannot be redistributed or is not
ours to publish: the estate site snapshots, the Fable listings, Orwell, the
Wikipedia, Equifax and Target pages, man pages, the held-out sets, the honest
twins, the Open Lens specimens, the frontier differential inputs and the
prototype engines used for union labelling. `--local` reads whatever is there
and prints it.
