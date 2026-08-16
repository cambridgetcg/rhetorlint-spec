# RhetorLint conformance dataset builder

This directory builds one small, Hugging Face-compatible **evaluation
snapshot** from the repository's canonical `conformance/cases.json`.

It does not create a training corpus. The 31 expected outputs were generated
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

This builder created no Hugging Face repository or upload. A later upload needs
a separate review of the exact `release/` bytes, namespace, visibility,
licence, personal or sensitive material, withdrawal state, current Hub
behavior, and token scope. Stage privately first. Hugging Face repository
history means deleting a file from the latest revision must not be described
as erasing old revisions, caches, forks, or trained models.

The Hub can load the release JSONL without custom code. Croissant is not
hand-authored here. Verify current Hub-generated Croissant behavior only after
a separately authorised staging upload.
