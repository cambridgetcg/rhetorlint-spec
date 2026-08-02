# rhetorlint (Python)

A second reference engine for the [RhetorLint spec](../../spec), in Python.
It exists to test reference portability: it reads the **same** rule pack
(`packages/rules-en/rules.json`) and the same output schema as
[`@rhetorlint/core`](../../packages/core), and reproduces the same parsed
values in the ASCII [reference corpus](../../conformance).

Standard library only. No third-party dependencies.

## Use

```python
from rhetorlint import analyze, load_default_rules

result = analyze("Mistakes were made.", load_default_rules())
result["density"]      # {'tells': 1, 'per100Words': 33.3}
result["marks"][0]     # {'ruleId': 'agency-hiding.deleted-subject', 'actual': 'were made', ...}
result["strip"]        # 'Mistakes [who?] were made.'
```

```bash
echo "We take your privacy extremely seriously." | python3 impl/python/rhetorlint.py
```

## Conformance

```bash
python3 impl/python/test_conformance.py   # 15/15 cases match the JS reference outputs
```

## Guarantees (identical to the JS engine)

- Marks point at visible text; `actual` is a substring of the input at `position`.
- Only the span and position are direct observations. Current marks carry a
  neutral `displayName`, candidate/context-required classification status, and
  taxonomy mapping status.
- No person-reading, no truth-score, no fabricated rewrite (`rewrite` is `None`).
- `confidence` is an uncalibrated, author-assigned match weight, not a probability of intent, effect, deception, or truth.

See [`../../conformance/README.md`](../../conformance/README.md) for the
character-offset and matching caveats. Agreement across JS, Python, and Go is
currently defined only for ASCII input; one non-ASCII character can part them.

## Packaging

`pyproject.toml` declares a `rhetorlint` console script. Publishing to PyPI is a
follow-up: the package will bundle a copy of `rules.json` as package data (today
the module resolves the canonical copy from the repo, which is the point — all
engines read the same rule-pack artifact).
