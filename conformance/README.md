# Conformance

`cases.json` is the ground truth. **Any engine that claims to implement
RhetorLint must reproduce every case in it exactly** — same marks, same
character offsets, same density, same `strip`.

This is what makes RhetorLint a *spec* and not just one library: the JS
reference engine and the Python engine both read the same rule pack and both
reproduce this same corpus, so their outputs are identical. Add a third engine
in any language, point it at this file, and you'll know immediately whether it
conforms.

## How it's checked

| engine | test | command |
|--------|------|---------|
| JavaScript (`@rhetorlint/core`) | `test/conformance.test.mjs` | `node --test test/conformance.test.mjs` |
| Python (`impl/python/rhetorlint.py`) | `impl/python/test_conformance.py` | `python3 impl/python/test_conformance.py` |

Both run in CI. The JS engine also regenerates the corpus (it's the reference),
so if the engine and the fixture ever disagree, the JS test fails first.

## What a case contains

```jsonc
{
  "input": "Mistakes were made and concerns were raised.",
  "density": { "tells": 2, "per100Words": 28.6 },
  "strip":   "[who?] Mistakes [who?] were made and concerns were raised.",
  "marks": [
    { "ruleId": "agency-hiding.deleted-subject", "family": "agency-hiding",
      "technique": "…", "actual": "were made", "start": 9, "end": 18,
      "note": "…", "confidence": 0.7, "level": "warning", "expected": ["…"] }
  ]
}
```

## Known portability caveat (honest)

Offsets are **character offsets**. JavaScript strings are indexed by UTF-16 code
units; Python strings by Unicode code points. For text in the Basic Multilingual
Plane (which includes all of English) they are identical, and the corpus is
ASCII, so the two engines agree exactly. For text containing astral characters
(emoji, some CJK extensions) the offsets could differ by engine. A future spec
version should pin offsets to a single unit (likely Unicode code points); until
then, conformance is defined over BMP text. `\w`-based rules are also ASCII-word
oriented and behave identically across the two engines on English input.
