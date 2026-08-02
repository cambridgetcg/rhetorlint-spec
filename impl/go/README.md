# rhetorlint (Go)

A third reference engine for the [RhetorLint spec](../../spec), in Go. Reads the
**same** rule pack (`packages/rules-en/rules.json`) and reproduces the **same**
[reference corpus](../../conformance) as the JavaScript and Python engines by
parsed value over ASCII input.

Standard library only. No third-party dependencies.

## Run

```bash
echo "We take your privacy extremely seriously." | go -C impl/go run .
```

## Conformance

```bash
go -C impl/go test ./...  # 15/15 cases match the JS reference outputs
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

Offsets here are **byte** offsets (Go strings are UTF-8). They equal the JS
(UTF-16) and Python (code-point) offsets only for ASCII input; the corpus is ASCII.
See [`../../conformance/README.md`](../../conformance/README.md).

## Guarantees (identical to the other engines)

Marks point at visible text; only the span and position are direct
observations. Current marks carry a neutral display name,
candidate/context-required classification status, and taxonomy mapping status.
There is no person-reading, recipient-effect finding, truth-score, or fabricated
rewrite (`rewrite` is `null`). `confidence` is an uncalibrated, author-assigned
match weight, never a probability of intent, effect, deception, or truth.
