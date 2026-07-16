# @rhetorlint/cli

Read the subtext from the command line. RhetorLint marks rhetorical tells in
text, emits human-readable, JSON, or SARIF output, and can gate CI on tell
density. Analysis runs locally with no model calls, network requests, or
telemetry.

RhetorLint reads the language, never the person. A mark identifies a visible
language pattern; it does not detect lies, infer intent, or judge whether a
claim is factually true.

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
tells per 100 words, making it suitable for a CI check. Usage errors exit 2.

| option | effect |
|---|---|
| `--json` | emit the canonical RhetorLint JSON result |
| `--sarif` | emit SARIF 2.1.0 for editors and code scanning |
| `--max <n>` | fail when tell density exceeds the threshold |
| `--rules <path>` | use a custom JSON rule pack |
| `--quiet` | suppress the human report |
| `--no-color` | disable ANSI colour |
| `--version` | print the CLI version |
| `--help` | print command help |

The CLI installs `@rhetorlint/core` and the English rule pack
`@rhetorlint/rules-en`. The specification and source are available in the
[RhetorLint repository](https://github.com/cambridgetcg/rhetorlint-spec).

MIT.
