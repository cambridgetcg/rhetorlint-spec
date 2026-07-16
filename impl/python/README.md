# rhetorlint (Python)

A second reference engine for the [RhetorLint spec](../../spec), in Python.
It exists to prove the framework is portable: it reads the **same** rule pack
(`packages/rules-en/rules.json`) and the same output schema as
[`@rhetorlint/core`](../../packages/core), and reproduces the same
[conformance corpus](../../conformance) — byte for byte.

Standard library only. No third-party dependencies.

## Use

```python
from rhetorlint import analyze, load_default_rules

result = analyze("Mistakes were made.", load_default_rules())
result["density"]      # {'tells': 1, 'per100Words': 33.3}
result["marks"][0]     # {'ruleId': 'agency-hiding.deleted-subject', 'actual': 'Mistakes were made', ...}
result["strip"]        # '[who?] Mistakes were made.'
```

```bash
echo "We take your privacy extremely seriously." | python3 impl/python/rhetorlint.py
```

## Conformance

```bash
python3 impl/python/test_conformance.py   # 10/10 cases identical to the JS ground truth
```

## Guarantees (identical to the JS engine)

- Marks point at visible text; `actual` is a substring of the input at `position`.
- No person-reading, no truth-score, no fabricated rewrite (`rewrite` is `None`).
- `confidence` is a heuristic language-pattern likelihood, not a lie probability.

See [`../../conformance/README.md`](../../conformance/README.md) for the
character-offset portability caveat (BMP text is exact; astral characters are a
future spec-version concern).

## Packaging

`pyproject.toml` declares a `rhetorlint` console script. Publishing to PyPI is a
follow-up: the package will bundle a copy of `rules.json` as package data (today
the module resolves the canonical copy from the repo, which is the point — both
engines read the one source of truth).
