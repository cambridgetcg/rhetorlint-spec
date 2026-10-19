# rhetorlint (Go)

A third reference engine for the [RhetorLint spec](../../spec), in Go. Reads the
**same** rule pack (`packages/rules-en/rules.json`) and reproduces the **same**
[conformance corpus](../../conformance) as the JavaScript and Python engines,
value for value over its current ASCII scope.

Standard library only. No third-party dependencies.

## Run

```bash
echo "We take your privacy extremely seriously." | go -C impl/go run .
```

## Conformance

```bash
go -C impl/go test ./...  # 39/39 ASCII cases identical to the JS ground truth
```

## The RE2 lesson

Go's `regexp` is RE2, which — by design — has **no lookahead**. The JS/Python
engines once used one, `(?!\s+by\b)`, to *not* flag `"the report was written
by the committee"` as an agent-hiding passive (the agent is named), and Go
checked in code instead. Since core 0.1.4 no engine uses lookaround for it: the
accountable-passive detector matches the auxiliary and participle with one
pattern, then all three engines walk the next seven words in code for `by`,
and walk back for the head word, over the same generated word lists
(`spec/agency-lexicon.json`). Same result, same mechanism — and the
conformance suite still proves the *output* is identical, which is what it is
for.

Offsets here are **byte** offsets (Go strings are UTF-8). They equal the JS
(UTF-16) and Python (code-point) offsets for ASCII, which is the corpus's
current conformance scope. Non-ASCII offsets and matching are not portable;
see [`../../conformance/README.md`](../../conformance/README.md).

## Guarantees (identical to the other engines)

Marks point at visible text; no person-reading; no truth-score; no fabricated
rewrite (`rewrite` is `null`); `confidence` is a heuristic language-pattern
likelihood, never a probability of deception.
