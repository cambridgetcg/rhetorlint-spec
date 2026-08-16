# Cloudflare Claim Feedback door

This generated folder is the exact static payload for the Cloudflare Pages
project `rhetorlint-claim-feedback`. It makes the reviewed Claim Feedback contracts and
one fictional example easy to retrieve while keeping the actual builder on the
reader's machine.

There is no Worker, Pages Function, form, submission route, crawler, storage
binding, analytics code, model call, KARMA signer, dataset write, timer, or
background loop. Cloudflare may still keep ordinary request, account, security,
or operational logs under its own settings.

`release-lock.json` hashes every other upload input and the exact source files
from which this door was generated. Cloudflare parses `_headers` as
configuration rather than serving it, so verify the resulting live response
headers separately. Run `npm run check:cloudflare` before deployment.

After a fresh review of an exact clean commit, the guarded direct-upload door
is:

```sh
RHETORLINT_CLOUDFLARE_DEPLOY="active:$(git rev-parse HEAD)" \
  scripts/deploy-cloudflare-claim-feedback.zsh active
```

That command is documentation, not standing authority. A production upload and
a rollback are separate external actions. See `CLOUDFLARE.md` at repository
root for current deployment observations and rollback receipts.
