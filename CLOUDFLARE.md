# Cloudflare Claim Feedback door

Status observed 2026-08-17: **live at
<https://rhetorlint-claim-feedback.pages.dev/>** from exact source commit
`733440216d4d1d25c2b70ea00c1849a2879dba59`.

Project: `rhetorlint-claim-feedback`

This integration follows the account's established Cloudflare Pages Direct
Upload pattern while keeping the factual source in this repository.

## What Cloudflare receives

Only the generated upload inputs in `doors/cloudflare-claim-feedback/`:

- a plain static explanation;
- the two closed Claim Feedback schemas;
- one explicitly fictional `example.org` fixture;
- `llms.txt` and a machine-readable boundary manifest;
- strict response-header instructions, robots, sitemap, custom 404, and exact
  release-file hashes.

The deployable tree contains no Worker, Pages Function, form, submission route,
fetch, storage binding, analytics code, AI binding, secret, timer, crawler,
KARMA signer, or dataset writer. The full builder remains the one-shot local
Node command documented in `examples/claim-feedback/README.md`.

Cloudflare can still retain ordinary request, account, security, abuse, or
operational records under provider settings. “The app sends nothing” is not a
claim that the hosting platform observes nothing.

## Build and verify

```sh
npm run build:cloudflare
npm run check:cloudflare
npm test
```

The build wholly regenerates both Cloudflare folders. Each
`release-lock.json` hashes every other upload input. Cloudflare parses
`_headers` as configuration instead of serving that path, so its resulting
live response headers are checked separately. The active lock also hashes the
canonical source files and release scripts from which the static door was
derived.

## Live receipt — 2026-08-17

Cloudflare Pages Direct Upload, Wrangler `4.103.0`, production branch `main`:

- resting deployment ID: `8762922c-bece-49f5-ac05-69176ab45193`;
- resting immutable URL:
  <https://8762922c.rhetorlint-claim-feedback.pages.dev/>;
- active deployment ID: `35c5a411-4e82-42ad-989e-bafcb620c816`;
- active immutable URL:
  <https://35c5a411.rhetorlint-claim-feedback.pages.dev/>;
- active release-lock SHA-256:
  `b52d888991ccd641da725fa616994561dbf5cb964d265ffafdeddaea3b89c6d5`;
- resting release-lock SHA-256:
  `7e71742929f68cb0432983960d9fcedff84bc015cc62591ee4579e0328c40c68`.

The provider API reports both deployments as successful production releases
from branch `main`; the active deployment carries the full source commit above.
The project and both deployments report no Pages Functions. Web Analytics is
disabled and the served HTML is byte-identical to the reviewed file, so no
analytics script was injected.

Every served active file and every served resting file was fetched from its
immutable URL and compared byte-for-byte with its committed release input.
Root responses, JSON, text, the real nested `404`, and the production alias were
checked separately. The live CSP keeps `script-src` and `connect-src` at
`'none'`; `_headers` itself returns the custom `404` instead of being served.
Cloudflare adds `Access-Control-Allow-Origin: *` on the public `pages.dev`
responses, and returned `Cache-Control: no-store` on the custom `404`; neither
adds an intake or credential-bearing route.

## Release order

1. review one exact clean commit and confirm the Cloudflare account and project;
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
