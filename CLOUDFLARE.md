# Cloudflare Claim Feedback door

Status observed 2026-08-17: **live at
<https://rhetorlint-claim-feedback.pages.dev/>** from exact source commit
`0939317a1d64b2da2ca230bd39a9617cf7de7236`.

Project: `rhetorlint-claim-feedback`

This integration follows the account's established Cloudflare Pages Direct
Upload pattern while keeping the factual source in this repository.

## What Cloudflare receives

Only the generated upload inputs in `doors/cloudflare-claim-feedback/`:

- one bounded, on-device browser worksheet;
- the browser adapter and exact shared deterministic projection;
- the two closed Claim Feedback schemas;
- one explicitly fictional `example.org` fixture;
- `llms.txt` and a machine-readable boundary manifest;
- strict response-header instructions, robots, sitemap, custom 404, and exact
  release-file hashes.

The deployable tree contains no Worker, Pages Function, form, submission route,
scripted network request, browser storage, storage binding, analytics code, AI
binding, secret, timer, crawler, KARMA signer, or dataset writer. One explicit
Run processes one supplied record in browser memory and renders it into the
page. The stronger stable-file adapter remains the one-shot local Node command
documented in `examples/claim-feedback/README.md`.

Cloudflare can still retain ordinary request, account, security, abuse, or
operational records under provider settings. “The app sends nothing” is not a
claim that the hosting platform observes nothing.

## Build and verify

```sh
npm run build:cloudflare
npm run check:cloudflare
npm test
npm run test:claim-feedback-browser-real
```

The build wholly regenerates both Cloudflare folders. Each
`release-lock.json` hashes every other upload input. Cloudflare parses
`_headers` as configuration instead of serving that path, so its resulting
live response headers are checked separately. The active lock also hashes the
canonical source files and release scripts from which the browser door was
derived.

## Browser worksheet live receipt — 2026-08-17

Cloudflare Pages Direct Upload, Wrangler `4.103.0`, production branch `main`:

- source commit: `0939317a1d64b2da2ca230bd39a9617cf7de7236`;
- active deployment ID: `1a9ccc8d-b53d-4681-afee-d639596af417`;
- active immutable URL:
  <https://1a9ccc8d.rhetorlint-claim-feedback.pages.dev/>;
- active release-lock SHA-256:
  `5a96310a847b25236dc5146937e88e3ed2431ef996487d3f97fa83f2e8787ec4`;
- retained resting deployment ID: `8762922c-bece-49f5-ac05-69176ab45193`;
- resting release-lock SHA-256:
  `7e71742929f68cb0432983960d9fcedff84bc015cc62591ee4579e0328c40c68`.

Before deployment, GitHub CI passed the complete JavaScript, Python, and Go
suites and the real headless-Chrome abuse gate on the exact source commit. The
guarded deploy then rechecked the named Direct Upload project, production
branch, absence of Pages Functions, disabled Web Analytics, clean Git state,
current `origin/main`, and the exact generated release.

After deployment, all 19 publicly served release files were fetched from both
the production alias and immutable hostname and matched their committed
SHA-256 values. The response CSP permits only the committed same-origin script
graph and keeps `connect-src`, `frame-ancestors`, `worker-src`, and
`form-action` at `'none'`. The `_headers` configuration path returns `404`, and
an unknown route returns the exact committed custom 404 bytes.

The browser proof exercises hostile markup, inert private and link-local URLs,
network interception, transient and durable storage, Stop, changed input,
Clear, repeated `pagehide`, held training review, and unsigned KARMA. This
receipt establishes the tested release bytes and those named checks. It does
not establish the truth of a supplied claim, the identity of a speaker, reuse
permission, correction uptake, or secure erasure from browser or operating
system memory.

## Previous static-door receipt — 2026-08-17

Cloudflare Pages Direct Upload, Wrangler `4.103.0`, production branch `main`:

- resting deployment ID: `8762922c-bece-49f5-ac05-69176ab45193`;
- resting immutable URL:
  <https://8762922c.rhetorlint-claim-feedback.pages.dev/>;
- active deployment ID: `b8c076a1-77b1-4eb9-ad21-6db32fc4e6b0`;
- active immutable URL:
  <https://b8c076a1.rhetorlint-claim-feedback.pages.dev/>;
- active release-lock SHA-256:
  `87312c8ea2e44ffa490a2ac1ebd758e853068e3add08e67be45cd503e796f68e`;
- resting release-lock SHA-256:
  `7e71742929f68cb0432983960d9fcedff84bc015cc62591ee4579e0328c40c68`.

The provider API reports the active deployment as a successful production
release from branch `main` carrying the full source commit above. The resting
receipt remains the successful byte-verified release from commit
`733440216d4d1d25c2b70ea00c1849a2879dba59`. The project and both deployments
report no Pages Functions. Web Analytics is disabled and the served HTML is
byte-identical to the reviewed file, so no analytics script was injected.

Every served active file and every served resting file was fetched from its
immutable URL and compared byte-for-byte with its committed release input.
Root responses, JSON, text, the real nested `404`, and the production alias were
checked separately. The live CSP keeps `script-src` and `connect-src` at
`'none'`; `_headers` itself returns the custom `404` instead of being served.
Cloudflare adds `Access-Control-Allow-Origin: *` on the public `pages.dev`
responses, and returned `Cache-Control: no-store` on the custom `404`; neither
adds an intake or credential-bearing route.

## Release order

1. review one exact clean commit, run the real-browser gate, and confirm the
   Cloudflare account and project;
2. create the separate project only if it does not exist, with production
   branch exactly `main`, then read back its real Pages hostname;
3. confirm Cloudflare Web Analytics is disabled; otherwise Cloudflare may
   inject code and the served HTML will not equal the reviewed bytes;
4. deploy `doors/cloudflare-resting-baseline/` first and keep its verified ID;
5. deploy `doors/cloudflare-claim-feedback/` from the same exact commit;
6. confirm both deployments report no Functions and compare every served
   immutable-host payload with the local release, including security headers
   and a nested 404;
7. record both IDs, exact commit, release-lock hashes, immutable URLs, and live
   observations in this file.

Project creation, if still needed, is explicit:

```sh
wrangler pages project create rhetorlint-claim-feedback --production-branch main
```

The guarded direct-upload door for the active release is:

```sh
RHETORLINT_CLOUDFLARE_DEPLOY="active:$(git rev-parse HEAD)" \
  scripts/deploy-cloudflare-claim-feedback.zsh active
```

The script refuses any dirty worktree or commit other than freshly fetched
`origin/main`. It reads the provider project through Cloudflare's API and
requires the exact name, hostname, production branch, Direct Upload source, Web
Analytics off, and no reported Pages Functions. It then rechecks the generated
allowlist and deploys a `git archive` snapshot of the exact commit. Wrangler
runs non-interactively from a fresh temporary working directory so a future
repository `functions/` folder cannot be discovered. The activation word is
bound to the exact mode and commit. Wrangler's `--commit-dirty=false` remains
metadata; the script's Git, provider, and snapshot checks are the gate.

This is not a recurring deployment loop or standing authority. Rollback is a
separate Cloudflare action. A resting production alias does not erase the
active deployment's immutable URL, browser/CDN copies, or provider records.
Before relying on a recorded resting ID, list current deployments and compare
its exact served bytes again.
