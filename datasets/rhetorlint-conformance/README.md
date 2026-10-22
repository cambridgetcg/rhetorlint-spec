# RhetorLint conformance dataset builder

This directory builds one small, Hugging Face-compatible **evaluation
snapshot** from the repository's canonical `conformance/cases.json`.

It does not create a training corpus. The 76 expected outputs were generated
by the JavaScript reference engine. Separate JavaScript, Python, and Go
conformance gates cover the scopes named in the release card; this data-only
builder executes none of them. The rows are useful for exact implementation
checks and small ML pipeline smoke tests. They are not independent human
labels, factuality labels, or evidence that a model generalises.

The committed upload-shaped tree is [`release/`](release/README.md). It contains
plain JSONL, a closed row schema, source and release digests, a digest-only
Claim Feedback admission receipt, and no withdrawal mechanism. That receipt
admits zero content rows: the only current Claim Feedback fixture says
`mirror: deny`; this builder performs no independent admission.

## Commands

From the repository root:

```sh
npm run ml-dataset:check
npm run test:ml-dataset
npm run ml-dataset:build -- /absolute/path/to/new-empty-output
```

`build` refuses an existing output path, writes one private directory, and
stops. `check` only compares the committed release with a fresh in-memory
build. Neither command has network, Hugging Face login/upload, model, crawler,
KARMA, timer, or training capability.

The off-switch is checked before dataset inputs are read and again at the
write door:

```sh
RHETORLINT_DATASET_HALT=1 npm run ml-dataset:check
```

## Publication boundary

`release/` is a public release. On 2026-10-20 the project maintainer said "go
for both npm publish and huggingface dataset". Claude Code, an AI agent, read
that as a public Hugging Face dataset, staged privately first, after npm
releases of `@rhetorlint/core@0.1.4` and `@rhetorlint/rules-en@0.2.1`, whose
`index.mjs` and `rules.json` are the engine and rule pack this snapshot is
locked to. The versions, the visibility and the order are that agent's reading,
not the maintainer's words. On 2026-10-22 the maintainer confirmed them,
choosing among options the agent offered: a public dataset after private
staging, and npm releases of core 0.1.4, rules-en 0.2.1 and cli 0.2.0 with two
deprecations of older versions.
Claude Code, an AI agent, prepared the release and reviewed the provenance of
all 76 inputs. It found no blocker; that is one AI agent's review, not a legal
opinion. The upload, staged privately first, is a separate step that Claude
Code takes with the Hugging Face CLI, outside this builder. The source
repository is private at release, so the card names the revision as plain text
and points to the npm packages for the engine and rule pack.

`PUBLICATION` in `build.mjs` holds the maintainer's words, the agent's reading
of them, the maintainer's confirmation, the review (scope, method, outside text, notes and limits), the
agent's licence reasoning for cases 46, 49 and 50, and the npm package specs;
the build writes
them into `release/metadata/source-manifest.json`. The builder itself still has
no network or upload capability, and `manifest.json`'s `effects` describe only
the build.

A later refresh is a new release, not an edit of this one. It must:

- set a new `SOURCE_REVISION` and `SOURCE_LOCK` and rebuild with
  `npm run ml-dataset:build`;
- review the provenance of every new or changed input, and replace the review
  in `PUBLICATION`;
- record its own release decision in the maintainer's own words, and who
  prepared and uploaded it, without recording an agent's choice as the
  maintainer's;
- name the npm releases that carry the new engine and rule pack, and confirm
  their `index.mjs` and `rules.json` match the recorded digests before upload;
  and
- review the namespace, visibility, token scope, withdrawal state and current
  Hub behaviour again, and stage privately first.

Hugging Face keeps repository history, so deleting a file from the latest
revision must not be described as erasing old revisions, caches, forks,
downloads or trained models.

The Hub can load the release JSONL without custom code. Croissant is not
hand-authored here. Check the Hub-generated Croissant after the upload rather
than assuming it.
