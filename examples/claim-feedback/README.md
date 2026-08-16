# Claim Feedback 0.1

**Crawl claims, not people. Expose mismatches, not souls. Speed correction,
not punishment.**

This example turns one supplied crawl receipt into a bounded feedback packet:

```text
exact claim + captured bytes
  → separate local RhetorLint reviews of each supplied text
  → evidence challenge
  → attributed reply or correction
  → unsigned KARMA draft
  → held, metadata-and-digest AI-training review proposal
  → stop
```

It is a local bridge, not a crawler. It reads one JSON file, recomputes the
supplied UTF-8 body and claim digests, checks that quoted spans are literal,
prints one packet, and stops. It makes no request, sends no message, writes no
file, signs no deed, and adds nothing to a dataset.

## Try the complete fictional turn

From the repository root, with Node 18 or newer:

```sh
npm run claim-feedback -- examples/claim-feedback/fixtures/corrected-claim.json
npm run test:claim-feedback
```

The fixture uses reserved `example.org` URLs. It shows an advertised 48-hour
feedback promise, a supplied 503 endpoint receipt, a narrow challenge, and a
source-attributed correction. It is not a report about a real person or site.

The command is finite, makes no network request or persistent write, and emits
one report on standard output. Its explicit off-switch is:

```sh
CLAIM_FEEDBACK_HALT=1 npm run claim-feedback -- INPUT.json
```

The switch is checked before the input file is read.

## Six lanes that must not collapse

1. **Claim** — exact words, scope, sources, uncertainty, correction and
   withdrawal doors, and digest. This packet's ordered history keeps the
   original visible after a correction; the print-only builder is not a
   persistent append-only store.
2. **Crawler receipt** — supplied method, requested and final URL, time,
   crawler name/version/user-agent, HTTP status, media type, bounded UTF-8
   bytes and digest. The builder verifies the supplied bytes; it cannot
   authenticate the crawler identity or prove that a remote fetch happened.
3. **Wording review** — RhetorLint reviews the claim, challenge, reply, and
   replacement claim separately. Its shared signals are phrase-redacted and
   never aggregated by speaker or person. A mark is a reading prompt, never a
   truth, lie, motive, intent, ego or person verdict. Each text names its own
   language; an unsupported language gets `unsupported-language`, not a false
   green light. Zero English marks says only: “No supported wording patterns
   were marked by this English pack.” Exact core, signal-projection, rules and
   packet-projection bytes are hashed, as are each full analysis result and
   shared redacted signal.
4. **Challenge and response** — literal evidence is separate from its named
   interpretation. Speaker claim, attribution basis, a recoverable HTTPS
   source locator, confidence and known limits travel with both challenge and
   response. A correction appends a changed claim; it does not erase the
   original.
5. **Material review** — personal data, sensitive data, and third-party
   material are three explicit booleans with a recorder, time, source and
   limits. A pass is impossible when any is declared present. This small local
   review is still not an independent rights or privacy decision.
6. **Later use** — `search`, `retrieval`, `model_input`, `training`, and
   `mirror` are five separate choices, bound to exact digests. KARMA and
   training outputs stay inert drafts.

The packet can expose a supplied advertised/observed mismatch, a changed
digest, weak or absent support, an unanswered challenge, and whether a later
correction exists. Those facts still do not prove knowing deception. A “lie”
requires evidence of both falsity and knowing intent; this example does not
infer either from a pattern match or status code.

## Robots is not training permission

The input keeps crawl access and later reuse apart. The
[Robots Exclusion Protocol](https://datatracker.ietf.org/doc/rfc9309/) expresses
which URI paths a crawler is requested to access and explicitly is not access
authorisation. It also grants no copyright licence or AI-training consent.
For that reason `robots-allowed` is not an accepted collection basis. The
record must say `owner-supplied`, `owner-published`, or `not-established`, and
even the first two are supplied observations rather than authenticated rights.

If a source uses a machine-readable text-and-data-mining reservation, record
that separately as one supplied policy source. The W3C-hosted
[TDM Reservation Protocol report](https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/)
is a Community Group report, not a W3C Standard. No one signal silently fills
all five later-use choices.

Current provider controls also keep uses apart: OpenAI documents
[`OAI-SearchBot`, `GPTBot`, and `ChatGPT-User`](https://developers.openai.com/api/docs/bots);
Anthropic documents
[`Claude-SearchBot`, `ClaudeBot`, and `Claude-User`](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler);
and Google says
[`Google-Extended`](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended)
does not control Google Search inclusion or ranking. These pages were observed
2026-08-16 and must be reopened before deployment. Allowing a named crawler
still promises no crawl, selection, training run, model update, or correction
uptake. An open-corpus adapter would likewise need a separate bounded decision
for [Common Crawl's `CCBot`](https://commoncrawl.org/ccbot).

The training review records whether the supplied input contains:

- a changed, source-attributed correction;
- a supplied material review made after the latest covered record, with no
  personal, sensitive, or third-party material declared;
- explicit retrieval, model-input and training choices of `allow`;
- a supplied licence URL and a declaration effective and unwithdrawn at the
  explicit assessment time;
- an owner-supplied or owner-published collection basis; and
- digest coverage for the captured claim, evidence and correction.

Even when every declared condition is present, the result remains
`held-for-independent-review`. The same unauthenticated JSON cannot approve its
own rights, identity, privacy, licence compatibility, or provenance. The
metadata-and-digest review proposal contains no content row; `candidate`
remains `null`. Neither state writes training data or claims that a model
provider used or removed anything. A later dataset decision must recheck the
declaration after its recorded `assessed_at`; this packet cannot keep a rights
statement current by itself.

## KARMA handoff

The packet proposes this local chain:

```text
action: bounded local scan
  → consequence: what the builder actually retained
  → response/dispute: the recorder's challenge
  → correction, boundary, or attributed response
```

The records use KARMA's meaning fields but deliberately have local parent
labels, no identity, no deed ID and no signature. `importable` is false. They
must never be auto-signed as Fable—or anyone else. An authorised operator may
review the source-linked packet and create a real deed under its own identity in
a separate turn. The correction draft puts the replacement claim and both
claim digests in proposed signed fields; there is no unsigned semantic
sidecar. Drafting a challenge does not prove it was sent, delivered or read.
Any dispatch is a later action, delivery is a later consequence, and a repair
needs its own deed plus a later observed consequence.

## A future crawler adapter

Keep the network capability outside this module. A safe adapter should:

- accept only exact owner-allowlisted claim URLs, never a person or recursive
  social crawl;
- check its own brake before every request;
- make one credential-free request per URL, with fixed count, byte and time
  bounds, no retry, no cross-origin redirect, no tracking query and no cookie;
- retain the exact response bytes, status, digest, tool version, known effects
  and unknown server logs;
- put candidate challenges only in an owner-held local inbox; and
- never contact a target, publish, score, rank, sign KARMA or write a dataset.

A later observation can verify whether a correction or repair took effect.
That consequence is a new record, not something to assume from a promise.

## Code interface

```js
import {
  buildClaimFeedback,
  validateClaimFeedbackInput,
  verifyClaimFeedbackPacket,
} from "./examples/claim-feedback/claim-feedback.mjs";

const issues = validateClaimFeedbackInput(input);
if (issues.length) throw new Error(issues[0].message);

const packet = buildClaimFeedback(input);
verifyClaimFeedbackPacket(packet, input);
```

The closed [input schema](claim-feedback-input.schema.json), closed
[packet schema](claim-feedback-packet.schema.json), and runtime use the
example-local contracts `claim-feedback.input/0.1`,
`claim-feedback.packet/0.1`, `claim-feedback.karma-draft/0.1`, and
`claim-feedback.training-candidate/0.1`. Runtime validation is closed for exact
keys and structurally checks bounds, timestamps, URLs, supplied digests,
literal spans, attribution labels, Unicode safety, method-source and result
digests, and cross-field consistency. Parsed JSON is the safest direct API
input; the runtime also rejects accessors, proxies, sparse arrays, hidden
properties, cycles, excessive depth, and unpaired surrogates. It does not
authenticate a remote fetch, robots decision, speaker, response meaning,
rights holder, licence, consent, or authority.

Truth Release can later supply the source-owned claim, sources, limits, rights
and correction door. Do not merge the two records by treating a prepared Truth
Release as already published or crawled; carry a real publication receipt in a
separate, later turn.
