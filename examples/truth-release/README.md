# Truth Release 0.1

One sourced public claim becomes:

- a local RhetorLint wording review;
- bounded, channel-aware draft briefs for the selected social channels;
- one noindex canonical-page preview and matching machine-readable record;
- ordinary search and social-preview metadata;
- a XENIA-informed rights, refusal, attribution, and correction envelope.

It stops at **prepared**. It does not approve, post, schedule, track, retry, or
read an account credential. The entire run has one attempt and zero external
effects.

This is an example integration outside RhetorLint's portable `spec/` and core
engine. RhetorLint still does one narrow job: it marks visible wording. It does
not decide truth, intent, identity, consent, authority, or whether anything
should be published.

## The actual flow

```text
one exact claim + sources + limits + rights + correction door
  → validate a closed, 16 KiB input
  → freeze claim and source-record SHA-256 digests
  → run local RhetorLint review
  → prepare at most eight channel drafts
  → prepare one noindex canonical-page preview + recipient-facing JSON preview
  → return the bundle
  → stop

later, outside this tool:
  human source review
  → exact preview and account-scoped approval
  → one bounded adapter attempt per approved part
  → URL/content receipt that makes publication metadata true
  → bounded observation
  → one correction fan-out or close
  → stop
```

The split is deliberate. A prepared draft is not consent to publish it. A
published URL is not evidence that the claim is true. Reach is not worth.

## Try it

Node 18 or newer; no install and no network:

```sh
node examples/truth-release/prepare.mjs \
  examples/truth-release/fixtures/one-claim.json
```

The fixture deliberately uses the reserved `example.org` host and a distinct
claim path, so it cannot collide with the live RhetorLint explorer. Replace the
canonical and machine URLs with real, durable destinations before review.

To make a new local bundle directory:

```sh
node examples/truth-release/prepare.mjs \
  examples/truth-release/fixtures/one-claim.json \
  --out /tmp/rhetorlint-truth-release
```

The output path must not exist. The command writes it atomically and creates:

| file | audience | purpose |
|---|---|---|
| `release.json` | recipient preview | exact claim, sources, limits, recipient choices, correction door, redacted RhetorLint signal |
| `page.html` | preview | noindex evidence-page preview with canonical, Open Graph, card, and draft `Article` metadata |
| `review.json` | local | phrase-level wording marks, attention prompts, all drafts and workflow states |
| `REVIEW.md` | local | readable exact-draft approval sheet |

The prepared pair says **not published**, carries no publication receipt or
`datePublished`, and stays `noindex, nofollow`. Copying it is still a separate
choice, but a real publication turn must first bind exact approval and then add
the receipt, truthful publication date, and indexing choice. The generated
directory is owner-only by default.

Run its focused tests:

```sh
node --test examples/truth-release/prepare.test.mjs
```

## The evidence record

[`release-input.schema.json`](release-input.schema.json) requires one claim and
keeps the facts that are often lost during “content repurposing”:

- exact claim, scope, audience, evidence date, optional intended publication
  date, and review date;
- sources with a precise section/passage locator, one sentence saying what each
  source supports, and an optional supplied content digest;
- known uncertainty and contrary evidence;
- author, commercial interest, creator, rights holder, reuse terms;
- same-origin media with no query parameters, plus creator, rights basis, alt
  text, and synthetic-media disclosure;
- canonical URL and a separate correction/reply URL;
- an explicit list of channels for which drafts may be prepared.

The JSON Schema records the portable structural contract; runtime validation is
authoritative for UTF-8 byte limits, trimming, real dates, cross-field order,
URL normalization, and same-origin checks. The preparer checks those things and
requires the canonical, machine, and media URLs to have a public-host-shaped DNS
name (not an IP, local/reserved suffix, or single-label host), with same-origin,
query-free canonical, machine, and media URLs. This is a syntax boundary, not
proof of public DNS resolution. It **does not fetch or verify a source**. A missing content
digest remains a visible review prompt; the source-record digest binds the
canonical JSON declarations, not the bytes behind their URLs. The public record
says so.

## What “attention” means here

The useful common ground in current first-party platform explanations is not a
secret universal formula. It is:

1. one clear subject for a known audience;
2. an honest opening promise that the piece promptly fulfils;
3. enough native context to understand the claim;
4. original work, useful completion, source-opening, saving, or thoughtful
   response rather than raw clicks;
5. visible authorship, uncertainty, and correction.

The drafts therefore add no manufactured urgency, hashtag bundle, engagement
question, “best time,” posting frequency, or universal three-second rule. A
soft text target is only a drafting convenience. Every future adapter must ask
the selected platform and account for current capabilities and limits.

Platform notes and API doors are kept beside each draft:

- [YouTube recommendations](https://support.google.com/youtube/answer/16533387?hl=en), [content performance](https://support.google.com/youtube/answer/16559650?hl=en), [corrections](https://support.google.com/youtube/answer/57404?hl=en), [Data API quota](https://developers.google.com/youtube/v3/determine_quota_cost)
- [TikTok recommendations](https://support.tiktok.com/en/using-tiktok/exploring-videos/how-tiktok-recommends-content), [sharing review rules](https://developers.tiktok.com/doc/content-sharing-guidelines), [Direct Post API](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)
- [Instagram ranking](https://about.instagram.com/blog/announcements/instagram-ranking-explained), [publishing API](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [recommendation eligibility](https://www.facebook.com/help/instagram/653964212890722)
- [LinkedIn feed](https://www.linkedin.com/pulse/how-does-linkedin-feed-work-tim-jurka-oxraf), [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-03), [community rules](https://www.linkedin.com/legal/professional-community-policies)
- [Bluesky custom feeds](https://bsky.social/about/blog/7-27-2023-custom-feeds), [post records](https://docs.bsky.app/docs/advanced-guides/posts), [limits](https://docs.bsky.app/docs/advanced-guides/rate-limits)
- [Mastodon timelines](https://docs.joinmastodon.org/methods/timelines/), [status API](https://docs.joinmastodon.org/methods/statuses/), [instance limits](https://docs.joinmastodon.org/api/rate-limits/)
- [X timeline](https://help.x.com/en/using-x/x-timeline), [Create Post API](https://docs.x.com/x-api/posts/create-post), [automation rules](https://help.x.com/en/rules-and-policies/x-automation?lang=browser)

Every generated draft records that this guidance was observed on **2026-08-03**
and is due to be reopened after **2026-11-03**. Those dates are review prompts,
not promises that a platform will recommend a post.

## RhetorLint's responsibility

The preparer reviews every supplied prose field that can enter the public page
or drafts: title, claim, scope, summary, “why now,” audience, call to action,
commercial interest, reuse words, source titles/locators/support descriptions,
uncertainties, contrary evidence, media alt text, and synthetic disclosure.
Phrase-level marks stay under
`review.rhetorlint.local_marks`. The public resource receives only
`rhetorlint.signal/0.1`, whose default projection removes phrases, strip, and
rewrite.

Urgency, puffery, shouting, free-offer, and absolute marks create a visible
review prompt. They do not automatically block or approve the text: a real
deadline can be relevant, and a pattern matcher cannot know whether the source
earns it.

## XENIA's responsibility

The bundle pins the released [`xenia.rights/0.1`](https://github.com/cambridgetcg/xenia/blob/npm-xenia-v0.1.0-beta.6/RIGHTS.md)
baseline as a **design reference**. It makes these choices visible:

- read, ignore, reply/correct, or reuse under the stated licence;
- ignoring has no penalty or follow-up;
- no account credential, tracking parameter, audience profile, third-party
  media request, or hidden secondary publication is created;
- authorship, creator, rights holder, audience, media basis, and correction are
  separate fields.

The public JSON and HTML carry the read, ignore, reply/correct, and declared
reuse choices. All remain non-binding statements by this preparer; supplied
licence terms still need a real rights holder. Ignoring creates no follow-up.
The reference does not declare that RhetorLint or a release has adopted or
conforms to XENIA. A project-level adoption is a separate current choice.

XENIA Surface 0.1 can later advertise a deployed JSON/HTML release feed as one
bounded same-origin public resource. Merely generating these files does not
meet Surface response-header and error-contract requirements, so this example
makes no Surface claim.

## Where SEO belongs

SEO becomes the stable receipt and discovery layer after the social turn has a
real publication receipt:

- one useful canonical evidence page;
- title, description, canonical URL, ordinary `Article` JSON-LD, and matching
  Open Graph/card text, first emitted as an explicit noindex draft;
- visible sources, dates, scope, limits, rights, commercial interest, and
  correction path;
- one sitemap entry and a small number of relevant internal links at the site
  that actually publishes it.

It is not another content mill. The preparer makes no thin landing pages and
does not emit `ClaimReview`; use that type only when a genuine fact-checking
process meets its contract. After publication, a separate bounded turn must add
the true date and receipt, switch indexing on deliberately, and update the
sitemap. Search engines may still decline to crawl, index, or rank the page.

## Future platform adapters

Start with a separate preview-only adapter for Bluesky and Mastodon. Their API
doors are comparatively direct and neither requires the whole system to depend
on one global recommendation feed. Then add LinkedIn and YouTube after app
permission work; Instagram and TikTok after professional-account/review work;
keep X optional.

Every adapter needs its own review because it adds a capability this example
does not have. The minimum contract is:

1. use the platform's official API and minimum OAuth permissions;
2. fetch current account capabilities and limits;
3. show the exact rendered preview, account, audience, visibility, alt text,
   and disclosures;
4. proceed only after literal approval bound to those exact bytes;
5. make one bounded attempt per approved part, with no automatic retry, and
   return the platform ID, URL, time, and content digest for each;
6. never auto-like, auto-follow, bulk-reply, trend-hijack, or endlessly rewrite;
7. permit one material correction/update, record the outcome, and stop.

## Honest limits

- Source URLs and supporting descriptions are supplied claims; their contents
  are not fetched.
- RhetorLint deliberately under-marks and can mark harmless literal language.
- A draft can fit its local soft target and still fail a platform's current
  account-specific rules.
- SHA-256 binds exact bytes; it does not prove truth, identity, authority, or
  consent.
- The generated page is a noindex preview, not a deployment or publication
  receipt. The operator still owns approval, hosting, publication metadata,
  sitemap, internal links, corrections, and removal.
