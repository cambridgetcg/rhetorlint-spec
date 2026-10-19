# Conformance

`cases.json` is the ground truth. **Any engine that claims to implement
RhetorLint must reproduce every case in it exactly** — same marks, same
character offsets, same density, same `strip`.

This is what makes RhetorLint a *spec* and not just one library: three engines
in three languages read the same rule pack and reproduce this corpus value for
value. Add a fourth engine in any language, point it at this file, and you'll
know immediately whether it conforms.

## How it's checked

| engine | test | command |
|--------|------|---------|
| JavaScript (`@rhetorlint/core`) | `test/conformance.test.mjs` | `node --test test/conformance.test.mjs` |
| Python (`impl/python/rhetorlint.py`) | `impl/python/test_conformance.py` | `python3 impl/python/test_conformance.py` |
| Go (`impl/go/rhetorlint.go`) | `impl/go/rhetorlint_test.go` | `go -C impl/go test ./...` |

All three run in CI; `npm run test:conformance` runs the first two. The JS
engine also regenerates the corpus (it's the reference), so if the engine and
the fixture ever disagree, the JS test fails first. Beyond the cases, CI also
runs the [three-engine differential](#beyond-the-cases-the-three-engine-differential)
over a wider input set.

Comparison is on parsed **values**, not on serialised bytes. Each language's
JSON encoder writes a whole-numbered density its own way — Python emits
`"per100Words": 25.0` where JS and Go emit `25` — and a spec cannot fairly
demand otherwise across languages.

## What a case contains

```jsonc
{
  "input": "Mistakes were made and concerns were raised.",
  "density": { "tells": 2, "per100Words": 28.6 },
  "strip":   "Mistakes [who?] were made and concerns [who?] were raised.",
  "marks": [
    { "ruleId": "agency-hiding.deleted-subject", "family": "agency-hiding",
      "technique": "…", "actual": "were made", "start": 9, "end": 18,
      "note": "…", "confidence": 0.6, "level": "note", "expected": ["…"] }
    // the second mark — "were raised", 32–43 — elided here; the real case carries both
  ]
}
```

Marks in a case are flattened: `start` and `end` sit on the mark, not inside a
`position` object. That is a fixture convenience, not the output shape — an
engine emits the nested `position` of `spec/output.schema.json`.

## The agency semantics change in core 0.1.4

Core 0.1.4 narrows `agency-hiding.deleted-subject`. Before, it marked a be-verb
followed by any `-ed`/`-en` word or a listed irregular participle, unless `by`
followed. Now it marks an accountable past passive whose doer the clause does
not name: `was`, `were` or `been`, at most one adverb, a participle from a
closed class (a fault, a breach, a concealment; a light verb after an error or
decision noun, as in `mistakes were made`; `raised` after `concerns`,
`questions` or `allegations`; `decided` after `it`; `shared`, `sold` or
`disclosed` after a data noun; `affected` or `impacted` after a data or account
noun), no `by` among the next seven words of the clause, and no negator
anywhere in its clause before the auxiliary (`Your data was never sold`, `No
customer data was accessed`, `No credit card numbers, bank account details or
passwords were stolen`). The words, the numbers and the characters the walks
stop at live in
`spec/agency-lexicon.json`, and `scripts/gen-agency-lexicon.mjs` writes them
into all three engines. The pack says the same thing: the rule's note now
names those verbs, its level is `note` and its confidence 0.6.

Regenerating the corpus changed nine of the 39 cases, each read by hand:

- Cases 0, 6 and 22 keep their agency marks (`were made`, `were raised`, `was
  shelved`). Only each mark's note, level and confidence changed.
- Six cases lose their agency mark and nothing else; their density and strip
  follow.
  - Case 7, `It is widely believed that experts agree.`: weasel.attribution
    already marks the unnamed authority twice, and the agency mark counted the
    same words a third time.
  - Case 13, `Shipments are often delayed.`: a present-tense habitual with no
    act to attribute. It is now a clean control.
  - Case 21, `Tellingly, the report was released on a Friday.`: releasing a
    report is not an accountable act from the words alone.
    editorializing.stance remains.
  - Case 24, `The minister claimed that the figures were audited.`: auditing is
    a neutral procedure. attribution.doubt-verb remains.
  - Case 28, `The plan has been widely described as a visionary gamble.`:
    description is not an accountable act. weasel.attribution and
    puffery.peacock remain.
  - Case 30, `...the next big thing by Forbes.`: the agent is named. The old
    corpus pinned this false positive as ground truth; it is now a clean
    control.

Cases 39 to 57 are new. Eight are positives: `Mistakes,
frankly, were made.`, `Customer data was quietly accessed.`, `Your data was
shared with partners.`, `PII may have been compromised.`, `Records were
withheld from investigators.`, `It was decided that the program would end.`,
`Hundreds of workers were laid off.` and `Additional safeguards have been put
in place.` (the span is `been put`). Eleven are unmarked controls:

- `My name is Fred.`, `JavaScript is required.` and `This option is ignored
  when the flag is unset.`: no past passive, or a present procedural one;
- `Soil water content was measured at 5 cm depth.` and `Data were collected
  from 200 participants.`: methods-section procedure. `collected`, `retained`
  and `transferred` are left out of the lexicon on purpose;
- `The soup can be frozen for up to 3 months.`: a modal passive;
- `The report was shelved by Friday.`: a pinned under-mark. `by` names when,
  not who, and the rule stays silent rather than guess;
- `Lives were lost in the earthquake.` and `Your account was closed at your
  request.`: harm and news verbs, silent by design, because the words alone
  cannot say a doer exists;
- `He got fired up about the album.`: `got` is not an auxiliary the detector
  reads;
- `This is guaranteed to double your savings.`: absolute.universal still marks
  `guaranteed`, and the `is guaranteed` agency mark it once drew is gone. The
  absolute.universal guard's cases used `Guaranteed to double your savings.`
  (case 36) to avoid it.

Cases 58 to 67 pin the edges of the detector's walks and its later
narrowing. `Mistakes were made a b c d e f by them.` is silent and the same
with one more word marks `were made`: `by` as the seventh word after the
participle still names an agent, as the eighth it does not. `Mistakes have
also since then been made.` marks `been made` and `Mistakes may also since
then have been made.` is silent: the head walk steps back over four
auxiliary-chain words and no more. `No customer data was accessed.`,
`Passwords haven't been compromised.` and `Your data was never sold.` (which
keeps its absolute.universal `never`) are negated passives, unmarked.
`Approximately 4,000 accounts may have been affected.` marks `been affected`
after a held-in-trust head, and `Twelve patients were affected.` is silent.
`Never have more than two drinks.` is advice: `have` can begin an imperative,
so the absolute.universal guard leaves it unmarked.

Cases 68 to 75 pin the negator reading of `spec/agency-lexicon.json` version
3, which replaced a five-word window before the head noun with the whole
clause: every word from the last `.`, `;`, `:`, `!`, `?` or line break (or the
start of the text) up to the auxiliary. A breach notice's denial is not an
agentless accusation, however long its subject: `No credit card numbers, bank
account details or passwords were stolen.`, `No Social Security numbers or
other sensitive personal information were exposed.` and `At this time, we do
not believe that any of your personal information has been compromised.` are
silent, where the window marked all three. A comma starts no clause, because a
long subject is a comma list, so `We saw no alerts, but data were stolen.` is
silent too: a pinned under-mark, recorded in `measurement/contrast.json`
beside the Reagan specimen (`But we did not achieve what we wished, and serious
mistakes were made...`), which the clause reading also leaves unmarked. `We
saw no alerts; data were stolen.` and the same with a line break mark `were
stolen`: a new clause starts there. `Data was accessed and no records were
leaked.` marks only `was accessed`, since a negator after a passive is not
read for it. `Customer data was exposed today.` marks `was exposed`: the
`exposed to` exception wants the whole word `to`.

The recall given up is stated, not hidden: `Your account was closed`, `Jobs
were cut`, `Lives were lost` and other harm verbs, relative clauses (`the
mistakes that have been made`), progressive passives (`were being
withheld`), and a passive whose words a no-break space separates are no
longer marked. On the committed gold annotations, the accountable-passive set
(`node scripts/measure.mjs`, `gold recall`) falls from 39 to 20 of 41 spans
found by any rule, against the guard revision just before the detector; by
the agency rule itself, 19 of 41. The spans lost include disclosure and
publication true positives in the target genre (`was inadvertently
published`, `was emailed` outside official systems, `should not have been
made public`) and a vague remedy (`appropriate steps will be taken`); they
wait for a fresh bench. The negator reading also silences a hedged denial the
committed labels still call a true positive (`There is currently no evidence
that this information has been misused.`), so any-rule recall on the legacy
gold set falls from 18 to 17 of 59.

## Known portability caveats (honest)

The corpus is ASCII and **conformance is defined over plain ASCII input**:
printable ASCII plus tab, LF and CR. Outside that, the three engines part in
three independent ways. None is fixed. If you are writing a fourth engine, read
all three before you start, because you cannot conform to something the
reference engines themselves disagree on. The third reaches into ASCII itself:
a vertical tab parts Go from the other two, and U+001F parts Python from them.

### 1. Offsets are counted in three different units

The spec says "character offset"; each language reads that as its own native
unit. JavaScript counts UTF-16 code units, Python counts code points, Go counts
**bytes**. One accented Latin letter is enough to part them — this is not an
astral-plane edge case:

| input | JS | Python | Go |
|-------|----|--------|----|
| `Mistakes were made.` | 9–18 | 9–18 | 9–18 |
| `Café mistakes were made.` | 14–23 | 14–23 | **15–24** |
| `Mistakes 😀 were made.` | **12–21** | **11–20** | **14–23** |

(offsets of the single `were made` mark; `source.chars` parts the same way —
24/24/25 and 22/21/24.) Any non-ASCII character at all shifts Go against the
other two; an astral character parts all three. A future spec version must pin
offsets to one unit — likely code points — and until it does, offsets are
comparable across engines only on ASCII text.

### 2. The rules match differently on non-ASCII text

`\b` and `\w` are Unicode-aware in Python's `re`, and ASCII-only in Go's RE2 and
in JS regexes built without the `u` flag. Case-insensitive matching folds the
whole Unicode range in Python and Go, and only ASCII in JS. So the engines
disagree about whether to mark at all:

```
It may have été confirmed.     Python: hedge.deniable "may have été"    JS: nothing    Go: nothing
This is Kind of a problem.     Python: hedge.softener "Kind of"         JS: nothing    Go: nothing
```

The first line parts on `\w`: `\w+` after `have` swallows `été` in Python and
matches nothing in the other two. The second parts on case folding and `\b`
together — that `K` is U+212A KELVIN SIGN. Python folds it to `k` and counts it
as a word character; JS folds nothing outside ASCII; Go folds the letter but its
ASCII `\b` then refuses the boundary.

Go's folding also widens `\w` itself. Under `(?i)`, RE2 folds `k` and `s` into
their whole case orbits, so `(?i)\w` takes U+212A KELVIN SIGN and U+017F LONG S
(`ſ`). Where no `\b` stands in the way, Go then sides with Python against JS:

```
It may have ſeen the file.     Python: hedge.deniable "may have ſeen"    Go: hedge.deniable "may have ſeen"    JS: nothing
```

That is a mark JS does not make, so here the safe direction is JS's alone.
The agency detector no longer parts this way: since core 0.1.4 it matches an
ASCII-lowercased copy with no case-insensitive flag, explicit `[ \t\n\r\f]`
whitespace and closed ASCII word lists, so a look-alike letter inside one of
its own participles joins nothing: `Your data was ſhared.` and `Data was
acceſſed.` (long s) and `Customer data was leaKed.` (U+212A) are unmarked in
all three (Python and Go once folded the long s of `ſhared` and marked).
absolute.universal still parts on `\b`: `CaféNever fails.` is marked by JS
and Go, not by Python, and `No fees, alwayſ free.` by Python alone.

### 3. `\s` is three different whitespace classes

Every rule that spells a phrase as `act\s+now` inherits its language's idea of
whitespace. (The agency detector does not: it spells whitespace as
`[ \t\n\r\f]`, so a no-break space, a vertical tab or U+0085 between the
auxiliary and the participle joins nothing in any engine, a documented
under-mark.) The three classes differ:

| character | JS `\s` | Python `\s` | Go `\s` |
|-----------|:-------:|:-----------:|:-------:|
| U+000B VERTICAL TAB (ASCII) | yes | yes | **no** |
| U+001C–U+001F information separators (ASCII) | no | **yes** | no |
| U+0085 NEXT LINE | no | **yes** | no |
| U+00A0 NO-BREAK SPACE, U+1680, U+2000–U+200A (incl. U+2009 THIN SPACE), U+2028, U+2029, U+202F, U+205F, U+3000 | yes | yes | **no** |
| U+FEFF ZERO WIDTH NO-BREAK SPACE | **yes** | no | no |

Go's RE2 `\s` is exactly `[\t\n\f\r ]`. JS and Python are Unicode-aware but
not identically so: Python's class is whatever `str.isspace()` accepts.

So `Let us act now.` with a no-break space is an urgency mark in JS and Python
and nothing in Go; `Mistakes were made.` with a no-break space before `made`
is nothing in all three. Text pasted from a word processor or
a web page carries U+00A0 often. A vertical tab does the same thing inside
ASCII. Word counts, and so `density.per100Words`, also use each language's own
whitespace: JS's `\S+`, Python's `\S+` and Go's `strings.Fields` already
disagree on U+FEFF and U+0085.

Under-marking is the doctrine, so in each of these splits the engine that marks
less fails in the safe direction. No one engine is always that engine. JS and
Go under-mark on accented letters. JS alone does on long s and on a Kelvin
sign inside a word. Go alone does on the vertical tab and on the spaces JS and
Python share, U+00A0 among them. On U+FEFF only JS marks, and on U+0085 and
U+001F only Python does. And
failing safe is not agreeing: no locale pack with non-ASCII orthography can be
conformance-tested until the spec pins matching semantics as well as offsets.
Do not read the ASCII corpus as evidence that these engines agree on French,
Turkish, or Greek. They do not.

## Beyond the cases: the three-engine differential

The 76 cases pin values. The differential asks a wider question: do the three
engines agree with each other on input nobody wrote an expectation for?

```
node scripts/xengine-diff.mjs                      # check; CI runs this after the Go step
node scripts/xengine-diff.mjs --build-inputs       # regenerate inputs.jsonl from its sources
node scripts/xengine-diff.mjs --write-divergences  # re-record divergences.json, keeping reasons
node scripts/xengine-diff.mjs --local <file>       # report on an uncommitted input set
```

JS runs in-process. Python runs as one `python3 -I` subprocess that reads JSON
lines. Go runs through `TestXEngineDump` in `impl/go/rhetorlint_test.go`, which
is skipped unless `XENGINE_IN` and `XENGINE_OUT` are set, so `go test ./...`
alone never runs it. The whole check takes about two seconds.

**Inputs.** `differential/inputs.jsonl` holds one `{id, source, text}` per line.
It is built from committed, licence-clean sources only:
- the inputs of `cases.json`;
- the paragraphs of `measurement/items/*.txt`, when present. These rows keep
  their item's licence, not the repository's MIT licence: see
  `measurement/items.json` and `measurement/NOTICE`;
- the texts of `measurement/contrast.json`, when present;
- the constructed probes in `scripts/xengine-diff.mjs`. These are non-ASCII
  text built around the characters above: U+00A0 and other spaces, U+2019,
  U+2011, dashes, accented letters, emoji, U+017F, U+212A, plus vertical tab
  and other ASCII controls. They also put predicate adjectives, numerals and
  irregular participles after a be-verb inside non-ASCII sentences;
- two sentences per participle of `spec/agency-lexicon.json`, from
  `lexiconProbes()` in `scripts/gen-agency-lexicon.mjs`: one the agency
  detector must mark, and the same with `by the board` after the participle,
  which it must not. A word dropped from or added to one engine's generated
  copy of the lexicon parts the engines here.

Duplicate texts are kept once. The file holds inputs only, never expected
values, and the check fails when it is stale against its sources. It sits
outside the dataset `SOURCE_LOCK`. Every character outside printable ASCII is
written as a `\uXXXX` escape, so a no-break space is visible in review. Text
that cannot be committed, such as man pages or private documents, goes through
`--local`. That takes JSON lines, either strings or `{id, text}` objects, or a
JSON array. It reports what it finds and ratchets nothing.

**What is compared, per input:**

| field | how | where |
|-------|-----|-------|
| marks | the multiset of `(ruleId, actual)` | every input |
| strip | the exact string | every input |
| offsets | each mark's span, in code points | every input where the marks agree |

Offsets are converted before they are compared, because each engine counts in
its own unit: JS in UTF-16 code units, Python in code points, Go in bytes (see
caveat 1). On ASCII input the three units coincide, so there the comparison is
on raw offsets. Density, `source.words` and `source.chars` are not compared.

**The rule.** On plain ASCII input every difference fails, and none may be
recorded. Every other difference must equal its entry in
`differential/divergences.json`. Each entry gives the input, the engine that
parts (`js`, `python`, `go`, or `all`), the fields, what each engine produced
that the others did not, and a reason. The record is a two-way ratchet:
- a new divergence fails;
- an entry whose engines now agree fails until it is removed;
- an entry that changed shape fails;
- an entry without a reason fails.

So the file always says exactly where the engines part today. After an engine
change, run `--write-divergences`, read the diff, and write a reason for any new
entry. Every entry in it today comes from caveat 2 or 3; the check prints how
many there are.
