# Publishing `@captioneer/*` to npm — a guide for the deploying agent

You are on the device that holds the npm org's publish token. Your job: publish
three packages from this repo to npm, in the right order, and verify them. This
guide is self-contained — follow it top to bottom.

The three packages that publish (nothing else does):

| order | package | depends on |
|------|---------|-----------|
| 1 | `@captioneer/core` | — |
| 2 | `@captioneer/rules-en` | — |
| 3 | `@captioneer/cli` | core@0.1.0, rules-en@0.1.0 (must be live first) |

`apps/explorer` and `apps/widget` are **not** npm packages (they're the site and
the browser extension). The repo root `captioneer-spec` is `"private": true` and
never publishes.

---

## 0 · Get the exact code

```bash
git clone https://github.com/cambridgetcg/captioneer-spec.git   # or: cd captioneer-spec && git pull
cd captioneer-spec
node --test 'test/*.test.mjs'      # MUST print: pass 23, fail 0. Do not publish if red.
```

## 1 · Match the scope to the org name  ⚠️ read this before anything else

The packages are named `@captioneer/core`, `@captioneer/rules-en`,
`@captioneer/cli`. **The `@captioneer` scope must equal the npm org's name.**

- If you created the org as **`captioneer`** → nothing to change, skip to step 2.
- If the org has a **different** name (say `@acme`) → rename the scope everywhere:

  ```bash
  # replace @captioneer with your real @scope across the repo
  SCOPE=@acme
  grep -rl '@captioneer/' --include=package.json --include=*.mjs --include=*.md . \
    | xargs sed -i '' "s|@captioneer/|$SCOPE/|g"     # macOS sed; on Linux use: sed -i
  node --test 'test/*.test.mjs'                       # re-run: still 23/23
  ```
  Then commit that rename and push, so both devices agree on the scope.

> The command-line binary stays `captioneer` regardless of the scope — that's the
> `bin` name, independent of the package name.

## 2 · Authenticate as a publisher in the org

Use the org's token that lives on this device. Either:

```bash
npm login          # interactive, if this device can do a browser/OTP flow
# — OR — a token (recommended for an agent):
npm config set //registry.npmjs.org/:_authToken "$NPM_TOKEN"   # do NOT commit this
```

Then confirm you can publish for the org:

```bash
npm whoami                              # prints your npm username
npm org ls <org-name> 2>/dev/null || true   # you should appear as a member
```

- Use an **Automation** token if the org enforces 2FA — it publishes without an
  OTP prompt. With a normal token + 2FA, add `--otp=<code>` to each publish.
- Never write the token into a file that git tracks. `.npmrc` in the repo is
  gitignored via `node_modules`/env only — prefer `npm config set` (writes to
  `~/.npmrc`) or an `NPM_TOKEN` env var.

## 3 · Dry-run each package (see exactly what ships)

```bash
npm publish --dry-run -w @captioneer/core
npm publish --dry-run -w @captioneer/rules-en
npm publish --dry-run -w @captioneer/cli
```

Confirm the tarball contents are only the intended files:
- core → `index.mjs`, `sarif.mjs`, `README.md`, `package.json`
- rules-en → `rules.json`, `README.md`, `package.json`
- cli → `cli.mjs`, `README.md`, `package.json`

(Each package already declares `"publishConfig": { "access": "public" }`, so
scoped packages publish publicly without a flag.)

## 4 · Publish — in dependency order

```bash
npm publish -w @captioneer/core
npm publish -w @captioneer/rules-en
# only after the two above succeed and are visible:
npm publish -w @captioneer/cli
```

If `npm view @captioneer/core version` doesn't yet return `0.1.0`, wait a few
seconds before publishing the CLI (it resolves core + rules-en at install time).

## 5 · Verify the real install path (the important test)

This proves the published CLI resolves `@captioneer/core` and `@captioneer/rules-en`
as installed packages — the exact thing the code was written to handle:

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null
npm i @captioneer/cli
npx captioneer --version                 # -> 0.1.0
echo "We take your privacy extremely seriously, and mistakes were made." | npx captioneer --json
# expect: valid JSON with density.tells >= 2 and an "agency-hiding.deleted-subject" mark
```

If that JSON comes back correct, the deploy is good.

## 6 · Tag the release and report back

```bash
cd -                                     # back to the repo
git tag v0.1.0 && git push origin v0.1.0
```

Then tell Yu: the three package versions now live (`npm view @captioneer/core version`
etc.) and the install-path check passed. Paste the `npx captioneer` output as proof.

---

## Caveats (short)

- **You cannot re-publish the same version.** If something's wrong after publish,
  bump to `0.1.1` and republish — do not rely on `npm unpublish` (npm blocks it
  after 72h and when anything depends on the package). To warn users off a bad
  build: `npm deprecate @captioneer/core@0.1.0 "use 0.1.1"`.
- **Publish order matters** only because `@captioneer/cli` depends on the other
  two. core and rules-en are independent.
- **Provenance** (optional, nice-to-have): from GitHub Actions with OIDC you can add
  `--provenance` for a verified supply-chain badge. Not needed for this first manual
  publish.
- If a publish fails with `402 Payment Required` or `403`, the scope/org name
  doesn't match or you lack publish rights in the org — recheck step 1 and 2.
