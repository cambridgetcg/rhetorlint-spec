# Start here

This is a local Truth Release practice folder. Creating it contacted nobody,
opened no account, and authorized no publication.

## Your next three steps

1. Edit `claim.json`. Keep one exact claim, say what each source supports, name
   uncertainty, and replace the `example.org` URLs before any real review.
2. From the RhetorLint repository root, replace `RELEASE` below with this
   folder's path and run:

   ```sh
   node examples/truth-release/builder.mjs check RELEASE/claim.json
   node examples/truth-release/builder.mjs prepare RELEASE/claim.json --out RELEASE/prepared
   node examples/truth-release/builder.mjs preview RELEASE/prepared --channel bluesky
   ```

3. Open `RELEASE/prepared/REVIEW.md` and `page.html`. They are private local
   previews. Neither file is approval or a publication receipt.

The `prepared` path must not already exist. That is the off-switch and the
overwrite guard: each preparation is one finite new bundle.

## Building on top

Read the repository's
[`examples/truth-release/BUILD.md`](https://github.com/cambridgetcg/rhetorlint-spec/blob/main/examples/truth-release/BUILD.md).
The versioned preview interface has no transport or credential field, so an
adapter can begin with exact content without inheriting publication authority.
