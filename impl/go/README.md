# rhetorlint (Go)

A third reference engine for the [RhetorLint spec](../../spec), in Go. Reads the
**same** rule pack (`packages/rules-en/rules.json`) and reproduces the **same**
[conformance corpus](../../conformance) as the JavaScript and Python engines —
byte for byte on ASCII/BMP text.

Standard library only. No third-party dependencies.

## Run

```bash
echo "We take your privacy extremely seriously." | go -C impl/go run .
```

## Conformance

```bash
go -C impl/go test ./...  # 10/10 cases identical to the JS ground truth
```

## The RE2 lesson

Go's `regexp` is RE2, which — by design — has **no lookahead**. The JS/Python
engines use one: `(?!\s+by\b)`, to *not* flag `"the report was written by the
committee"` as an agent-hiding passive (the agent is named). Go can't express
that in the pattern, so this engine matches the be-verb + participle **without**
the lookahead, then checks in code whether `" by <agent>"` follows and skips it
if so. Same result, different mechanism — which is exactly the kind of thing a
conformance suite is for: it proves the *output* is identical even when the
*implementation* can't be.

Offsets here are **byte** offsets (Go strings are UTF-8). For ASCII/BMP text
they equal the JS (UTF-16) and Python (code-point) offsets; the corpus is ASCII.
See [`../../conformance/README.md`](../../conformance/README.md).

## Guarantees (identical to the other engines)

Marks point at visible text; no person-reading; no truth-score; no fabricated
rewrite (`rewrite` is `null`); `confidence` is a heuristic language-pattern
likelihood, never a probability of deception.
