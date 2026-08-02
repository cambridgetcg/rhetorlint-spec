# @rhetorlint/cli

Inspect configured rhetorical patterns from the command line. RhetorLint emits
human-readable, JSON, or SARIF output and can apply a caller-chosen
marker-density policy. Analysis runs locally with no model calls, network
requests, or telemetry.

RhetorLint reads the language, never the person. A mark identifies a visible
configured pattern; it does not establish intent, recipient effects,
deception, harm, or factual truth.

## Install

```bash
npm install --save-dev @rhetorlint/cli
npx rhetorlint --help
```

It also works without adding a dependency:

```bash
npx @rhetorlint/cli --version
```

## Use

Analyze files or pipe text on standard input:

```bash
rhetorlint statement.txt
echo "Mistakes were made." | rhetorlint --json
rhetorlint --sarif press-release.txt > rhetorlint.sarif
rhetorlint --max 8 comms/*.md
```

`--max <n>` exits with status 1 when any input exceeds the specified number of
configured markers per 100 words. Density depends on passage length, pack
composition, overlaps, and domain. It is not a truth, intent, harm, or quality
score and must not be the sole basis for a binding or high-stakes decision.
Usage errors exit 2.

| option | effect |
|---|---|
| `--json` | emit the canonical RhetorLint JSON result |
| `--sarif` | emit SARIF 2.1.0 for editors and code scanning |
| `--max <n>` | fail when configured marker density exceeds the caller's threshold |
| `--rules <path>` | use a custom JSON rule pack |
| `--quiet` | suppress the human report |
| `--no-color` | disable ANSI colour |
| `--version` | print the CLI version |
| `--help` | print command help |

SARIF includes exact matched snippets; a downstream editor or code-scanning
service may upload them. The CLI installs `@rhetorlint/core` and the English rule pack
`@rhetorlint/rules-en`. The specification and source are available in the
[RhetorLint repository](https://github.com/cambridgetcg/rhetorlint-spec).

MIT.
