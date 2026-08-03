# Build on Truth Release

You can try, inspect, fork, or extend this example without joining KINGDOM,
registering an identity, adopting XENIA, creating a social account, or running
a service. Node 18 or newer is enough. Every command below is local and finite.

## The first ten minutes

From the RhetorLint repository root:

```sh
npm run truth-release -- start /tmp/my-truth-release
npm run truth-release -- check /tmp/my-truth-release/claim.json
npm run truth-release -- prepare /tmp/my-truth-release/claim.json --out /tmp/my-truth-release/prepared
npm run truth-release -- preview /tmp/my-truth-release/prepared --channel bluesky
```

Then open:

- `/tmp/my-truth-release/claim.json` — the one record you edit;
- `/tmp/my-truth-release/prepared/REVIEW.md` — the human review sheet;
- `/tmp/my-truth-release/prepared/page.html` — the noindex evidence-page
  preview;
- `/tmp/my-truth-release/prepared/release.json` — the phrase-redacted public
  record.

`start` and `prepare` refuse to overwrite a path. `check` and `preview` write
only to the terminal. None of the four commands fetches, posts, schedules,
tracks, retries, or reads a credential.

Before projecting a channel, `preview` verifies that `release.json`,
`page.html`, and `REVIEW.md` still match the bounded owner-held `review.json`.
It rejects symlinks, missing files, oversized files, or altered projections and
does not launch the page.

## The four commands

| command | accepts | returns | persistent files created | network / dispatch effects |
|---|---|---|---:|---:|
| `start NEW_DIRECTORY` | one absent path | private practice claim + local guide | 2 | 0 |
| `check INPUT.json` | one regular non-symlink file, at most 16 KiB | closed validation report | 0 | 0 |
| `prepare INPUT.json --out NEW_DIRECTORY` | one valid claim + one absent path | four owner-only review files | 4 | 0 |
| `preview PREPARED_DIRECTORY --channel CHANNEL` | one owner-held bundle + one selected channel | `truth-release.adapter-preview/0.1` JSON | 0 | 0 |

Use `npm run truth-release -- --help` for the exact grammar. Option-looking or
extra arguments fail instead of being guessed.

## The builder interface

Code in this repository can import the same implementation used by the command:

```js
import {
  SCHEMAS,
  createAdapterPreview,
  prepareTruthRelease,
  validateReleaseInput,
  verifyAdapterPreview,
} from "./examples/truth-release/builder.mjs";

const issues = validateReleaseInput(input);
if (issues.length) throw new Error(JSON.stringify(issues));

const bundle = prepareTruthRelease(input, {
  now: "2026-08-03T10:00:00.000Z",
});
const draft = bundle.drafts.find((item) => item.channel === "mastodon");
const request = {
  schema: SCHEMAS.adapter_preview_request,
  channel: "mastodon",
  expected_source_record_digest: bundle.source_record_digest,
  expected_draft_digest: draft.draft_digest,
};
const preview = createAdapterPreview(bundle, request);

verifyAdapterPreview(preview, {
  bundle,
  request,
  // Hold this expected value separately when the preview crosses a boundary.
  expected_preview_digest: preview.integrity.preview_digest,
});
```

The public builder surface is versioned by the JSON contracts, not by a claim
that this repository is a published package:

- `truth-release.input/0.1` — one closed source record;
- `truth-release.bundle/0.1` — full owner-held prepared review;
- `truth-release.public/0.1` — phrase-redacted recipient preview;
- `truth-release.adapter-preview-request/0.1` — one channel plus the source
  and draft digests the caller expects;
- `truth-release.adapter-preview/0.1` — one selected, digest-bound channel
  preview with approval false, adapter absent, attempts zero, and external
  effects zero.

This is an **example-local 0.1 interface**, not a published or stability-promised
npm package. An outside project should pin an exact RhetorLint Git commit and
import or vendor that exact version under the MIT licence. Do not silently
follow mutable `main` in a publishing path.

## The extension seam

The safe seam is the adapter preview, not a platform request. It contains:

- the exact canonical claim and claim digest;
- the selected draft parts and draft digest;
- media declarations, alt text, audience, and commercial interest;
- official platform information, its observation/review dates, and an explicit
  instruction to reopen it;
- the fields a later literal approval must bind;
- explicit zeroes for attempts and external effects.

The preview digest binds every canonical preview field except its own
`integrity.preview_digest`; the exact digest scope and canonicalization travel
beside it. It does not authenticate a person, source, approval, or authority.
Keep the separately expected source, draft, and preview digests at the boundary
where you verify a handoff.

It deliberately contains no account, credential, token, endpoint request,
approval receipt, scheduler, retry policy, or analytics identity. A preview can
therefore feed a terminal view, GUI, code review, or test fixture without
quietly gaining a send button.

A real publication adapter is a separate capability and review. It must add
current platform/account discovery, minimum OAuth scope, an exact account and
visibility preview, literal byte-bound approval, a pre-effect brake check, one
bounded attempt, and a returned URL/ID/time/digest receipt. Do not add that
capability to this example by importing an HTTP client.

## A small contribution workflow

1. Start from one issue: a confusing field, missing channel-safe projection, or
   reproducible bug.
2. Add a failing test beside the owning module.
3. Change the smallest implementation home; do not copy the preparer into an
   integration.
4. Run:

   ```sh
   npm run test:truth-release
   npm test
   npm run test:conformance
   (cd impl/go && go test ./...)
   ```

5. In your fork—or in a pull request when a maintainer has invited one—name
   what changed, what stayed separate, the exact tests, and whether any network
   or dispatch effect was introduced. For this builder path, the expected
   answer to the last question is `no`. This example makes no promise that an
   upstream submission will be accepted or answered.

Schema changes should add a new explicit version when meanings or required
fields change. Keep old fixtures while a supported version remains readable.

## Good first extensions

- a read-only terminal or browser renderer for
  `truth-release.adapter-preview/0.1`;
- more adversarial fixtures for URL, digest, layout, disclosure, or rights
  boundaries;
- a local source-opening checklist that records what a human reviewed without
  fetching on their behalf;
- a separate preview-only platform renderer whose tests make all network calls
  fail immediately.

Not every contribution needs code. A clearer field name, one official source,
an accessibility correction, a failing example, or a translation can lower the
doorstep too.
