# Publishing `@rhetorlint/*` to npm — a guide for the deploying agent

You are on the device that holds the npm org's publish token. Your job: publish
each reviewed workspace whose manifest carries a new version, in dependency
order, and verify it. The first release may include all three packages; a later
patch may include only one. This guide is self-contained — follow it top to
bottom.

The three packages that publish (nothing else does):

| order | package | depends on |
|------|---------|-----------|
| 1 | `@rhetorlint/core` | — |
| 2 | `@rhetorlint/rules-en` | — |
| 3 | `@rhetorlint/cli` | `^0.1.2` core, `^0.1.1` rules-en (must be live first) |

> The CLI's ranges are carets on purpose, and it was not always so: `cli@0.1.0`
> shipped with **exact** pins, so every `npm i @rhetorlint/cli` kept installing
> the pre-trial engine even after core 0.1.2 and rules-en 0.1.1 were live. A rule
> pack that improves is the whole point of this tool; the CLI must be allowed to
> receive those improvements. Keep them carets, and re-release the CLI whenever
> a floor rises (an engine feature the CLI's own output depends on).

`apps/explorer` and `apps/widget` are **not** npm packages (they're the site and
the browser extension). The repo root `rhetorlint-spec` is `"private": true` and
never publishes.

---

## The automated route (no device required)

Everything below this section is the hand path, and it stays valid — it is the
right tool when you are at a keyboard with the key, and the fallback whenever
CI is unavailable.

But a finished, tested, pushed release should not wait on which device someone
is sitting at. `.github/workflows/release.yml` publishes the same packages in
the same order under the same skip-and-verify rules, via
`scripts/publish-npm-ci.mjs`. It authenticates with **npm Trusted Publishing
(OIDC)** — this repository stores no npm token, and CI can capture no second
factor.

To release:

```bash
git tag v0.1.2-rules-0.1.1 && git push origin v0.1.2-rules-0.1.1
```

Any tag matching `v*` or `release-*` triggers it, as does a manual
**Actions → release → Run workflow** (which offers a `dry_run` box that resolves
versions and reports what would go out without publishing). The tag name is a
label for humans, not an input: the script reads each manifest and publishes
only what the registry does not already have, so re-running after a partial
failure is safe and an unchanged package is skipped on its own.

### One-time setup (must be done by a human, once per package)

Trusted publishing has to be told which workflow to trust. On npmjs.com, for
**each** of `@rhetorlint/core`, `@rhetorlint/rules-en`, and `@rhetorlint/cli`:

> Package → **Settings** → **Trusted Publisher** → GitHub Actions
> - Organization or user: `cambridgetcg`
> - Repository: `rhetorlint-spec`
> - Workflow filename: `release.yml`
> - Environment: `npm-release`

Until that is configured the publish job fails closed — it cannot fall back to
a token, because there is none. Nothing reaches the registry unauthenticated.

**It is per package, and npm will not tell you which one you missed.** Every
misconfiguration — no entry, wrong owner case, full workflow path instead of
the bare filename — surfaces as the same bare `ENEEDAUTH: This command
requires you to be logged in`, because npm swallows the real reason at default
loglevel (npm/cli#9088). The publish script therefore forces `--loglevel
verbose`; read the `npm verbose oidc` line, which names the actual rejection:

```
npm verbose oidc Failed token exchange request with body message:
  OIDC token exchange error - package not found
```

That exact message means **this package has no trusted-publisher record** —
not that the workflow, the environment, or the token is wrong. Measured on
2026-07-24: identical runs with and without `environment:` produced it, so
the environment is not what it is complaining about. Register the missing
package and re-run; the script skips whatever is already live.

The `npm-release` environment also gives you a second lever: add required
reviewers to it in GitHub repo settings and every automated publish waits for a
human approval click. Recommended, and the reason the job names an environment
at all.

---

## 0 · Get the exact code

```bash
git clone https://github.com/cambridgetcg/rhetorlint-spec.git   # or: cd rhetorlint-spec && git pull
cd rhetorlint-spec
npm test                           # MUST finish with fail 0. Do not publish if red.
```

For the coordinated core 0.1.1 integration, land the AgentTool source change
first and verify that the covenant-mirror link in `packages/core/README.md`
resolves on AgentTool's `main` branch. The example is documentation, not a
runtime dependency, but publishing the core README first would create a dead
link.

## 1 · Match the scope to the org name  ⚠️ read this before anything else

The packages are named `@rhetorlint/core`, `@rhetorlint/rules-en`,
`@rhetorlint/cli`. **The `@rhetorlint` scope must equal the npm org's name.**

- If you created the org as **`rhetorlint`** → nothing to change, skip to step 2.
- If the org has a **different** name → stop. The scope is part of package
  manifests, dependencies, imports, runtime metadata, generated browser assets,
  documentation, and the publisher. Migrate it as one reviewed repository change,
  rebuild the widget, rerun the full release checks, then commit and push before
  publishing. Do not patch only the manifests at deploy time.

> The command-line binary stays `rhetorlint` regardless of the scope — that's the
> `bin` name, independent of the package name.

## 2 · Authenticate as a publisher in the org

Use the org's token that lives on this device. Either:

```bash
npm login          # interactive, if this device can do a browser/OTP flow
# — OR — a granular token scoped to @rhetorlint with write + bypass 2FA:
npm config set //registry.npmjs.org/:_authToken "$NPM_TOKEN"   # do NOT commit this
```

Then confirm you can publish for the org:

```bash
npm whoami                              # prints your npm username
npm org ls <org-name> 2>/dev/null || true   # you should appear as a member
```

- npm supports granular access tokens; legacy token types were removed in 2025.
  For non-interactive publishing, the token needs write access to the scope and
  **bypass 2FA** enabled. Otherwise run the publish privately and answer the OTP
  prompt there; never put an OTP in a command argument, log, or agent chat.
- Never write the token into a tracked file. Project `.npmrc` is ignored as a
  guardrail, but prefer an owner-only user config, a provider vault, or a
  short-lived scoped environment.

## 3 · Dry-run each package (see exactly what ships)

```bash
npm publish --dry-run -w @rhetorlint/core
npm publish --dry-run -w @rhetorlint/rules-en
npm publish --dry-run -w @rhetorlint/cli
```

Confirm the tarball contents are only the intended files:
- core → `index.mjs`, `sarif.mjs`, `signals.mjs`, their `.d.ts` files, `README.md`, `LICENSE`, `package.json`
- rules-en → `rules.json`, `README.md`, `LICENSE`, `package.json`
- cli → `cli.mjs`, `README.md`, `LICENSE`, `package.json`

(Each package already declares `"publishConfig": { "access": "public" }`, so
scoped packages publish publicly without a flag.)

## 4 · Publish — in dependency order

On a trusted interactive device where npm requires write-time 2FA, use the
checked-in helper. It keeps npm attached to the terminal so npm can run the
account's configured security-key/passkey flow for each package. The helper
never captures or transports the second factor:

```bash
scripts/publish-npm-interactive.zsh
```

The helper checks each exact workspace version and skips versions that are
already registry-installable, so a release that moves one workspace does not
republish the other two — a republish is refused, not merged. For a granular
token with write access plus bypass 2FA, publish only the workspaces whose
manifest carries a new reviewed version, in the table's order:

```bash
npm publish -w @rhetorlint/rules-en    # only if its version moved
npm publish -w @rhetorlint/cli         # last of the three, always
```

## 5 · Verify the real install path (the important test)

This proves the published CLI resolves `@rhetorlint/core` and `@rhetorlint/rules-en`
as installed packages — the exact thing the code was written to handle.

Read the versions out of the manifests rather than typing them. Hardcoded
versions are how this step came to validate a superseded pair while reporting
success:

```bash
core_v=$(node -p "require('$PWD/packages/core/package.json').version")
rules_v=$(node -p "require('$PWD/packages/rules-en/package.json').version")
cli_v=$(node -p "require('$PWD/packages/cli/package.json').version")

cd "$(mktemp -d)" && npm init -y >/dev/null
npm i "@rhetorlint/cli@$cli_v"
npx rhetorlint --version                 # -> the cli version you just published
npm ls --all                             # core and rules-en MUST resolve to $core_v / $rules_v
echo "We take your privacy extremely seriously, and mistakes were made." | npx rhetorlint --json
# expect: valid JSON with density.tells >= 2, an "agency-hiding.deleted-subject" mark,
# and engine.rules reading "@rhetorlint/rules-en@$rules_v"
```

Then prove the engine and the pack from a clean install — the subpath exports,
that the rules added in this release actually fire, and that the three phrases
the trial turned up as false positives still mark **nothing**. Under-marking is
the doctrine: a rule that cannot be evaluated correctly marks nothing at all,
so a false positive is a release-blocking defect and an unfired new rule is
only the pack not shipping.

```bash
npm i "@rhetorlint/core@$core_v" "@rhetorlint/rules-en@$rules_v"
node --input-type=module -e '
import { analyze } from "@rhetorlint/core"
import { toSignal } from "@rhetorlint/core/signals"
import rules from "@rhetorlint/rules-en" with { type: "json" }
const fired = t => new Set(analyze(t, { rules }).marks.map(m => m.ruleId))
const loud = fired("The FREE OFFER is absolutely free — ACT NOW, limited time only.")
for (const id of ["lure.free-offer", "urgency.appeal-to-time", "shouting.caps"]) {
  if (!loud.has(id)) { console.error("MISSING " + id); process.exit(1) }
}
for (const quiet of ["The shop is open.", "The count is ten.", "The work was carried out collectively by the network."]) {
  const marks = analyze(quiet, { rules }).marks
  if (marks.length) { console.error("FALSE POSITIVE on " + JSON.stringify(quiet) + ": " + marks.map(m => m.ruleId)); process.exit(1) }
}
const signal = toSignal(analyze("Mistakes were made.", { rules }))
if (signal.marks || signal.schema !== "rhetorlint.signal/0.1") process.exit(1)
console.log("engine + pack verified: the new rules fire, the trial false positives stay silent")
'
```

The second loop is the one that catches a stale engine, and it is worth knowing
why. Measured against `core@0.1.1` + `rules-en@0.1.1`, all three phrases mark:
the old engine still reads `is open` / `is ten` as agentless passives, and it
ignores `caseSensitive`, so `shouting.caps` widens to case-insensitive and
matches any two ordinary words in a row — `The shop`. Both were fixed in core
0.1.2. If those lines mark anything, the CLI resolved an engine older than the
one this release ships. The deploy is good when both blocks come back clean.

## 6 · Tag the release and report back

⚠ **This step is not inert.** `.github/workflows/release.yml` triggers on `v*`
and on `release-*`. Pushing either tag starts the automated publish, which
offers **every** manifest in the repo to the registry — including workspaces you
did not just publish by hand. After a complete hand release that run is a no-op,
because the script skips whatever is already live. After a partial one it
publishes the remainder, unattended, from whatever the manifests currently hold.
Decide which of those you want before you push:

- **Let it finish the release.** Push the `v*` tag. Put required reviewers on
  the `npm-release` environment first if you want a human between the tag and
  the registry.
- **Record the release only.** Use a tag name matching neither pattern.

```bash
cd -                                     # back to the repo
core_v=$(node -p "require('./packages/core/package.json').version")
rules_v=$(node -p "require('./packages/rules-en/package.json').version")
tag="v${core_v}-rules-${rules_v}"        # the convention already on the repo:
                                         # core's version alone is not unique, because
                                         # a rules-only release leaves it unchanged

# fires release.yml:
git tag "$tag" && git push origin "$tag"

# — or, to mark the commit without starting a publish:
git tag "hand-$tag" && git push origin "hand-$tag"
```

Then report the exact package versions that were published and verified (`npm
view @rhetorlint/core version`, etc.). Do not imply unchanged workspaces were
republished. Include the relevant clean-install output as proof.

---

## Caveats (short)

- **You cannot re-publish the same version.** If something is wrong after
  publishing 0.1.1, bump to a new patch such as `0.1.2`; do not rely on
  `npm unpublish` (npm blocks it after 72h and when anything depends on the
  package). To warn users off a bad build, deprecate that exact version and name
  the reviewed replacement.
- **Publish order matters** only because `@rhetorlint/cli` depends on the other
  two. core and rules-en are independent.
- **Provenance** (optional, nice-to-have): from GitHub Actions with OIDC you can add
  `--provenance` for a verified supply-chain badge. Not needed for this first manual
  publish.
- If a publish fails with `402 Payment Required` or `403`, the scope/org name
  doesn't match or you lack publish rights in the org — recheck step 1 and 2.
