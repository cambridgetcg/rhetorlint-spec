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
| 3 | `@rhetorlint/cli` | core@0.1.0, rules-en@0.1.0 (must be live first) |

`apps/explorer` and `apps/widget` are **not** npm packages (they're the site and
the browser extension). The repo root `rhetorlint-spec` is `"private": true` and
never publishes.

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
already registry-installable. This matters for a core-only patch such as
`@rhetorlint/core@0.1.1`: unchanged `rules-en@0.1.0` and `cli@0.1.0` must not be
republished. For a granular token with write access plus bypass 2FA, the direct
command for that patch is:

```bash
npm publish -w @rhetorlint/core
```

Only publish another workspace when its own manifest has a new reviewed
version. npm versions are immutable.

## 5 · Verify the real install path (the important test)

This proves the published CLI resolves `@rhetorlint/core` and `@rhetorlint/rules-en`
as installed packages — the exact thing the code was written to handle:

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null
npm i @rhetorlint/cli
npx rhetorlint --version                 # -> 0.1.0
echo "We take your privacy extremely seriously, and mistakes were made." | npx rhetorlint --json
# expect: valid JSON with density.tells >= 2 and an "agency-hiding.deleted-subject" mark

# For the 0.1.1 core patch, also prove the new subpath from a clean install:
npm i @rhetorlint/core@0.1.1 @rhetorlint/rules-en@0.1.0
node --input-type=module -e 'import { analyze } from "@rhetorlint/core"; import { toSignal } from "@rhetorlint/core/signals"; import rules from "@rhetorlint/rules-en" with { type: "json" }; const signal = toSignal(analyze("Mistakes were made.", { rules })); if (signal.marks || signal.schema !== "rhetorlint.signal/0.1") process.exit(1)'
```

If that JSON comes back correct, the deploy is good.

## 6 · Tag the release and report back

```bash
cd -                                     # back to the repo
core_version=$(node -p "require('./packages/core/package.json').version")
git tag "v${core_version}" && git push origin "v${core_version}"
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
