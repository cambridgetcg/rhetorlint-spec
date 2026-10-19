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
      "note": "…", "confidence": 0.7, "level": "warning", "expected": ["…"] }
    // the second mark — "were raised", 32–43 — elided here; the real case carries both
  ]
}
```

Marks in a case are flattened: `start` and `end` sit on the mark, not inside a
`position` object. That is a fixture convenience, not the output shape — an
engine emits the nested `position` of `spec/output.schema.json`.

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
| `Des décisions regrettables were made.` | 27–36 | 27–36 | **28–37** |
| `Mistakes 😀 were made.` | **12–21** | **11–20** | **14–23** |

(offsets of the single `were made` mark; `source.chars` parts the same way —
37/37/38 and 22/21/24.) Any non-ASCII character at all shifts Go against the
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
Civilians were Killed.     Python: agency "were Killed"    Go: agency "were Killed"    JS: nothing
Lives were loſt.           Python: agency "were loſt"      Go: agency "were loſt"      JS: nothing
```

(`K` is U+212A again.) Both are agency marks that JS does not make, so here
the safe direction is JS's alone.

### 3. `\s` is three different whitespace classes

Every rule that spells a phrase as `act\s+now` inherits its language's idea of
whitespace, and so does the passive detector's `\s+` between the be-verb and
the participle. The three classes differ:

| character | JS `\s` | Python `\s` | Go `\s` |
|-----------|:-------:|:-----------:|:-------:|
| U+000B VERTICAL TAB (ASCII) | yes | yes | **no** |
| U+001C–U+001F information separators (ASCII) | no | **yes** | no |
| U+0085 NEXT LINE | no | **yes** | no |
| U+00A0 NO-BREAK SPACE, U+1680, U+2000–U+200A (incl. U+2009 THIN SPACE), U+2028, U+2029, U+202F, U+205F, U+3000 | yes | yes | **no** |
| U+FEFF ZERO WIDTH NO-BREAK SPACE | **yes** | no | no |

Go's RE2 `\s` is exactly `[\t\n\f\r ]`. JS and Python are Unicode-aware but
not identically so: Python's class is whatever `str.isspace()` accepts.

So `Mistakes were made.` with a no-break space before `made` is an agency mark
in JS and Python and nothing in Go, and `Let us act now.` with a no-break space
is an urgency mark in JS and Python only. Text pasted from a word processor or
a web page carries U+00A0 often. A vertical tab does the same thing inside
ASCII. Word counts, and so `density.per100Words`, also use each language's own
whitespace: JS's `\S+`, Python's `\S+` and Go's `strings.Fields` already
disagree on U+FEFF and U+0085.

Under-marking is the doctrine, so in each of these splits the engine that marks
less fails in the safe direction. No one engine is always that engine. JS and
Go under-mark on accented letters. JS alone does on long s, and on a Kelvin
sign inside a participle. Go alone does on the vertical tab and on the spaces
JS and Python share, U+00A0 among them. On U+FEFF only JS marks, and on U+0085
and U+001F only Python does. And
failing safe is not agreeing: no locale pack with non-ASCII orthography can be
conformance-tested until the spec pins matching semantics as well as offsets.
Do not read the ASCII corpus as evidence that these engines agree on French,
Turkish, or Greek. They do not.

## Beyond the cases: the three-engine differential

The 37 cases pin values. The differential asks a wider question: do the three
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
  and other ASCII controls. They also include non-ASCII sentences that put
  every word of the passive detector's `NOT_PASSIVE` list after a be-verb, so
  that word lists drifting apart between engines shows up.

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
