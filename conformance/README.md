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
the fixture ever disagree, the JS test fails first.

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

The corpus is ASCII and **conformance is defined over ASCII input**. Outside
that, the three engines part in two independent ways. Neither is fixed. If you
are writing a fourth engine, read both before you start, because you cannot
conform to something the reference engines themselves disagree on.

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

Under-marking is the doctrine, so JS and Go fail in the safe direction here. But
failing safe is not agreeing, and it means no locale pack with non-ASCII
orthography can be conformance-tested until the spec pins matching semantics as
well as offsets. Do not read the ASCII corpus as evidence that these engines
agree on French, Turkish, or Greek. They do not.
