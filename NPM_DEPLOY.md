# Publishing `@rhetorlint/*` to npm — a guide for the deploying agent

Your job: publish each reviewed workspace whose manifest carries a new version,
in dependency order, and verify it. A release may include all three packages or
only one.

The retired `release.yml` never published: eight of its 14 runs logged npm's
OIDC exchange answering "package not found", and no published `@rhetorlint`
version carries provenance. It is gone, with `scripts/publish-npm-ci.mjs`, and
no workflow runs on tag pushes now. On 2026-10-30 every `@rhetorlint` trust
config was revoked, and every package now requires 2FA to publish and
disallows tokens (`mfa=publish`). Two routes remain:

- **[The staged route](#the-staged-route)**, the default: `publish-npm.yml`
  prepares one package from its annotated tag and stages it on npm, and Yu
  approves the stage with 2FA.
- **The hand route** (steps 0–6 below), the fallback:
  `scripts/publish-npm-interactive.zsh` on the device with the npm login and
  its security key.

The three packages that publish (nothing else does):

| order | package | depends on |
|------|---------|-----------|
| 1 | `@rhetorlint/core` | — |
| 2 | `@rhetorlint/rules-en` | — |
| 3 | `@rhetorlint/cli` | `^0.1.4` core, `^0.2.0` rules-en (must be live first) |

> The CLI's ranges are carets on purpose, and it was not always so: `cli@0.1.0`
> shipped with **exact** pins, so every `npm i @rhetorlint/cli` kept installing
> the pre-trial engine even after core 0.1.2 and rules-en 0.1.1 were live. A rule
> pack that improves is the whole point of this tool; the CLI must be allowed to
> receive those improvements. Keep them carets, and re-release the CLI whenever
> a floor rises (an engine feature the CLI's own output depends on).

Core 0.1.4 is the current floor for the coordinated 0.2.0 CLI and rules-en
0.2.1. Rules-en 0.2.1 adds no pack key, so core 0.1.3 and core 0.1.2 (the one
npm has) still parse it, but its agency note ("a past-tense passive of a fault,
breach, concealment or decision verb") describes the 0.1.4 accountable-passive
detector. An older core would put that note on its old, wider marks
("Shipments are often delayed", "The soup can be frozen"), a label that is
false for each of them. Core 0.1.3 was the
floor before, because it preserves modality and attribution in strip output;
allowing core 0.1.2 would install successfully while producing the superseded
strip semantics.

### Core 0.1.4 + rules-en 0.2.1 — prepared 2026-10-19, not published

Prepared on `motifs/honest-marks` (stacked on `motifs/measure`); the letter for
the person who publishes is `HANDOFF-PUBLISH-2026-10-19.md`. On 2026-10-19
`npm view` showed core 0.1.0–0.1.2, rules-en 0.1.0–0.1.2 and cli 0.1.0–0.1.1,
each `latest` the highest. Core 0.1.3, rules-en 0.2.0 and cli 0.2.0 were never
published, so this release would carry all of them.

**Core 0.1.4** contains everything in the 0.1.3 candidate below, plus the
changes listed after this paragraph. Because 0.1.3 was never published, 0.1.4
is also the first core on npm with that candidate's closed rule-pack
validation. A pack core 0.1.2 reads now throws `TypeError: invalid rule pack
at ...` when it has a key the format does not list (`$schema`, `description`,
`author`), a family outside the taxonomy's seven, no `version`, or `level:
"error"`. Every `^0.1.x` consumer gets this on its next install with no pin
change: `cli@0.1.1 --rules house.json` with a `description` key exits 2 with
that TypeError and a stack trace, where core 0.1.2 gave a mark. The version is
Yu's choice. Published as 0.1.4, caret consumers receive both the validator
and the agency narrowing. Published as 0.2.0, `^0.1.x` consumers receive
neither; that needs cli `^0.2.0` for core, a rules-en peer `>=0.2.0`, and a
regenerated explorer, door and dataset snapshot.

- **The accountable-passive detector** behind `agency-hiding.deleted-subject`.
  It marks a `was`, `were` or `been` passive only when its participle is on a
  closed list of fault, breach, concealment and decision verbs, and only when
  no `by` stands among the next seven words of its clause. Some classes also
  need a head noun:
  `raised` after a challenge noun such as `concerns`, `made` after an error or
  decision noun, `affected` after a held-in-trust noun. There must
  be no negator anywhere in the clause before the auxiliary. The lists live in `spec/agency-lexicon.json` and are
  generated into JS, Python and Go by `scripts/gen-agency-lexicon.mjs`. Before
  this, the detector marked a be-verb followed by an -ed or -en word, less a
  stoplist.
- **Strip** keeps a loaded intensifier when a negator is one of the two words
  before it in the clause, or when it sits inside double quotes on its line.
  `The risk is not extremely high.` stays as it is. It still deletes one three
  words from its negator (`not at all extremely high`), after `rarely`, or
  inside single quotes: open O4 rows.
- **One negator vocabulary**, generated into every engine from
  `spec/agency-lexicon.json` and `spec/guard-lexicon.json`: the agency
  detector reads `cannot neither never no nobody none nor not nothing`, and
  the strip and `absolute.universal` guards read those plus `hardly` and
  `without`. So `Nothing is guaranteed.` is unmarked and `Nothing extremely
  bad happened.` keeps its `extremely`.
- **An engine-side `absolute.universal` guard**, keyed by ruleId so the pack
  needs no new key. A negator among the two words before a match leaves it
  unmarked; a comma ends the negator's reach once a word stands between them.
  An imperative clause-initial `Never` before a verb is also left unmarked
  (`Never share your password.`).

**Rules-en 0.2.1** is data only, with no new key.

- Nine rules spell the smart apostrophe (U+2019) and the hyphens U+2010,
  U+2011 and U+2013 beside the ASCII ones.
- The agency rule's note now reads "a past-tense passive of a fault, breach,
  concealment or decision verb". Its level falls from `warning` to `note`, and
  its confidence from 0.7 to 0.6.
- The optional peer rises to `@rhetorlint/core >=0.1.4`. Bump core and
  rules-en together. With core 0.1.2 pinned (fomoengine and
  `@agenttool/browser` pin it), `npm i @rhetorlint/rules-en` fails with
  ERESOLVE on this peer's range. Forced (`--legacy-peer-deps`, `--force`), or
  under an installer that only warns on peers, every old passive mark carries
  the 0.2.1 note: on core 0.1.2, "Shipments are often delayed.", "The soup can
  be frozen." and "Your account was closed last week." all draw it.

**CLI 0.2.0** is unchanged since 07-27 apart from its ranges (`^0.1.4` core,
`^0.2.0` rules-en). Publishing it is a separate decision.

- With 0.2.0 published, a fresh `npm i @rhetorlint/cli` resolves core 0.1.4 with
  rules-en 0.2.1: 22 rules.
- Without it, `cli@0.1.1` stays `latest`. Its ranges are `^0.1.2` for both
  packages, so once core 0.1.4 is live a fresh install resolves **core 0.1.4
  with rules-en 0.1.2**: 11 rules.

That pairing loads and runs. The agency marks narrow, but they keep 0.1.2's
note ("an agentless passive — who acted is deleted from the sentence") at
`warning` 0.7, which is still true of every narrower mark. So publishing core
alone already changes what `cli@0.1.1` users see.

**Consumers.** The estate's known dependents pin exact versions, so nothing
reaches them until someone bumps the pin:

- fomoengine `fly-api`: core 0.1.2 + rules-en 0.1.2; it calls `analyze()` only;
- `@agenttool/browser@0.6.0`: the same pins; it calls `analyze()` and `toSignal()` only;
- `@agenttool/aletheia`: not on npm; its lock held core 0.1.2 at the 09-07
  check.

No known consumer imports `strip()`. But `analyze()` returns a `strip` field,
and Aletheia shows it as `lintText().strip` and `lintArticle().stripPreview`.

When a pin moves to core 0.1.4 + rules-en 0.2.1, these are the measured
changes. Before is `main` (core 0.1.3 + rules-en 0.2.0), from `node
scripts/measure.mjs --consumer origin/main`; the local rows need the
gitignored `measurement/local/`. Each agency mark is one `toSignal` rule count.

| texts | marks per 100 words | agency marks | `[who?]` in strip | SARIF warnings |
|---|---|---|---|---|
| 26 committed items, 21,229 words | 2.21 → 0.53 | 377 → 22 | 377 → 22 | 379 → 2 |
| 19 local reader samples, 10,738 words | 1.19 → 0.47 | 76 → 4 | 76 → 4 | 78 → 2 |
| 70 local held-out files, 566,466 words | 1.78 → 0.45 | 7,500 → 33 | 7,500 → 33 | 7,504 → 4 |

The pair the known consumers pin today, core 0.1.2 + rules-en 0.1.2 (`node
scripts/measure.mjs --consumer d190af1`), is close to `main` on the committed
items: 2.20 marks per 100 words, 377 agency marks and 379 SARIF warnings. Its
strip flags only 359 of its 377 agency marks with `[who?]`, so the "each agency
mark is one `[who?]`" reading of the table holds from core 0.1.3 on.

- **SARIF.** Every agency result moves from `warning` to `note`.
  `contrition.rehearsed` is now the pack's only `warning` rule. On the committed
  items the SARIF warnings fall from 379 to 2.
- **CLI output.** The human report prints the new agency note, and `--json`
  carries `level: "note"` and `confidence: 0.6`.
- **`--max` gates.** The density headline falls, so a gate set against core
  0.1.2 output passes more files.

**Recall given up, on purpose.** Accountable-passive gold recall falls from
39/41 to 19/41 by the agency rule (20/41 by any rule). The detector no longer
marks:

- harm and news verbs (`Your account was closed`, `Jobs were cut`, `Lives were
  lost`);
- disclosure and publication (`was inadvertently published`, `was emailed`);
- modal, present and progressive passives (`steps will be taken`, `is put
  right`, `are being taken`);
- verbs outside the lists (`were targeted`, `was changed`, `have been
  enrolled`);
- head-gated verbs whose head is a relative pronoun or an unlisted noun (`the
  mistakes that were made`, `attempts were made`);
- passives with a negator anywhere earlier in their clause (`we did not achieve
  what we wished, and serious mistakes were made`).

`measurement/contrast.json` keeps each of these as an open row. One honest twin
that core 0.1.2 leaves unmarked is now marked: `40 staff were laid off as we closed
the Leeds office` (`twin.agency.26`).

**After publishing**, run step 5 below. Its first block installs cli 0.2.0, so
it needs that version on the registry; if the CLI is held, run the second
block and this section's check only. Both blocks and the check pass against
this branch's workspace packages. Then add these checks from the clean
install:

```bash
node --input-type=module -e '
import { analyze } from "@rhetorlint/core"
import rules from "@rhetorlint/rules-en" with { type: "json" }
const a = (t) => analyze(t, { rules })
const m = a("Mistakes were made.").marks
if (m.length !== 1 || m[0].level !== "note" || m[0].confidence !== 0.6) process.exit(1)
const allowed = {
  "Shipments are often delayed.": [],
  "Never share your password with anyone.": [],
  "Your data was never sold.": ["absolute.universal"],
}
for (const [t, ok] of Object.entries(allowed))
  if (a(t).marks.some((x) => !ok.includes(x.ruleId))) process.exit(2)
if (a("The risk is not extremely high.").strip !== "The risk is not extremely high.") process.exit(3)
if (!a("Let\u2019s not forget who started this.").marks.some((x) => x.ruleId === "deflection.whataboutism")) process.exit(4)
console.log("core 0.1.4 + rules-en 0.2.1 verified")
'
```

`Your data was never sold.` still draws `absolute.universal` on `never`. That
is the existing absolute rule, not the agency rule, so this check allows it.

**Deprecation**, only after 0.1.4 is installable. Strip output before 0.1.3
deletes hedges, and that includes the `strip` field of `analyze()`. Verified
on core 0.1.2: `analyze("He allegedly stole it.").strip` is `"He stole it."`.
So the message must not say `analyze()` is unaffected:

```bash
npm deprecate '@rhetorlint/core@<0.1.3' "strip output before 0.1.3 deletes hedges ('He allegedly stole it.' -> 'He stole it.') in strip() and in analyze().strip; marks are not affected by this bug. Upgrade to >=0.1.4 (which also narrows agency-hiding marks and validates rule packs strictly; see the release notes)."
```

Every published core version is below 0.1.3, so the exact-pinned consumers
above will print this warning on their next install.

### Core-only meaning-preservation candidate

A core-only 0.1.3 release does **not** require publishing the 0.2.0 rule pack or
CLI. Test it with already-published rules-en 0.1.2 so the correction can reach
existing consumers independently of the media-rule changes.

The candidate is more than the one-line hedge correction. Compared with npm
core 0.1.2, it already includes:

- preserved modality/attribution and whitespace cleanup only at removal seams;
- closed, bounded rule-pack validation, engine-floor checks, and rejection of
  zero-width patterns (not a guarantee of regular-expression complexity);
- longest-first overlapping lexical matches, without mutating the rule pack;
- detached rewrite-adapter marks and snapshotted analysis provenance;
- tighter family types and corrected documentation.

Custom packs previously tolerated by the permissive engine may now be rejected.
Review that compatibility boundary rather than describing the candidate as
only a strip allowlist edit. Public exports, the output schema version, and
runtime dependencies are unchanged; SARIF and signal implementation bytes are
unchanged in this candidate.

#### Reproduce the correction through Aletheia before publication

From this repository, set `ALETHEIA_CHECKOUT` to an ordinary trusted Aletheia
checkout and `PACK_DIR` to an existing absolute scratch directory. No paths or
local tarball dependencies belong in committed consumer metadata.

```sh
npm pack --workspace @rhetorlint/core --pack-destination "$PACK_DIR"
core_v=$(node -p "require('./packages/core/package.json').version")
npm run test:aletheia-consumer -- \
  --aletheia "$ALETHEIA_CHECKOUT" \
  --core-tarball "$PACK_DIR/rhetorlint-core-$core_v.tgz"
```

This explicit release check needs Node 20+, npm, `tar`, and registry access (or
a sufficiently populated npm cache). It is not part of the ordinary offline
unit suite. It executes code from the supplied trusted checkout; a disposable
copy is isolation from the live install, not a security sandbox.

The check copies only source, tests, the public feed registry, and package
metadata into a fresh temporary directory; it rejects symlinks and omits hidden
state and installed dependencies. It first reproduces the known core 0.1.2 loss
of `allegedly`, then installs the supplied candidate and checks allegation,
reported attribution, modal uncertainty, and an adjacent removable intensifier
through **both** `lintText().strip` and `lintArticle({text}).stripPreview`.
Annotations remain present. It also runs Aletheia's existing suite.

The negative control deliberately requires Aletheia's lockfile to contain core
0.1.2 and rules-en 0.1.2. Once that checkout adopts the fix, use its reviewed
pre-upgrade revision for this comparison; a newer baseline fails explicitly,
not as a successful reproduction of the old defect.

`--no-save --package-lock=true` keeps lockfile reading enabled while preventing
metadata writes. **Do not use `--package-lock=false`:** that can re-resolve and
upgrade unrelated dependencies. The check compares installed dependency
versions/integrities (except core), verifies unchanged manifest/lockfile bytes,
prints the supplied tarball's SHA-256, and removes only its own temporary copy.
Neither live Aletheia dependencies nor its metadata are updated.

#### Publication and uptake remain separate

Before publication, run the full release gates below and in
`docs/core-0.2-migration.md`, inspect the core tarball, and review the candidate's
complete delta. After explicit approval, use a **core-scoped** publication:
the staged route with `package=core` (each dispatch carries one package), or
the core workspace alone by hand. Do not invoke the interactive helper: it
also offers the unpublished rules/CLI versions to npm.

After the approved core release is registry-installable, update Aletheia's core
floor to `^0.1.3`, regenerate its registry-backed lockfile, and add permanent
allegation/preview regressions to `test/unit.test.mjs`. Retain rules `^0.1.2` for
this isolated repair. Browser 0.6 understanding bytes stay frozen; browser
uptake needs its own reviewed release. Dependency uptake is not deployment.

#### Local candidate evidence — 2026-09-07

Core source/package bytes were unchanged by this release-check work. The packed
candidate contains nine files and no runtime dependency. Its SHA-256 is:

```text
40705425306737d515f13839a6afa9580964c9517bdea81a74b91fd58985f73c
```

Verified locally with Node 25.2.1 and npm 11.6.2 (not a complete supported-runtime
matrix):

- Full JavaScript suite: 254 passed, zero failed or skipped.
- Python: 31 conformance cases and nine unit tests passed; Go race tests passed.
- Demo, nine-file/31-row dataset snapshot check, generated-asset check, and the
  real Chrome worksheet test passed.
- Packed Aletheia comparison against clean source revision `94c6952`: old-core
  meaning loss reproduced; all four candidate paragraphs retained qualification
  and annotations through both consumer APIs; all 14 consumer tests passed.
  Only core changed in the disposable installation; live dependencies and both
  source metadata files remained unchanged.
- A strict TypeScript 5.9.3 consumer compiled against the packed root, `/sarif`,
  and `/signals` exports using NodeNext resolution with no emit.

The first full run caught stale generated hashes after adding the root test
command. Regeneration changed only three digest lines in the active door's
manifest/lock; the full rerun passed. Existing runtime assets and historical
deployment receipts were not changed. Registry still served core 0.1.2 at the
check; **no package was published and no service was deployed**. Revalidate the
artifact and registry state before a later authorized publication.

`apps/explorer` and `apps/widget` are **not** npm packages (they're the site and
the browser extension). The repo root `rhetorlint-spec` is `"private": true` and
never publishes.

---

## The staged route

`.github/workflows/publish-npm.yml` releases one package per dispatch, from an
annotated tag `<package>-v<version>` (`core-v0.1.3`, `rules-en-v0.2.1`,
`cli-v0.2.0`) on the commit whose `packages/<package>/package.json` carries
that version. Both jobs run only when dispatched on that tag, and both check
out `github.sha`. `prepare` holds no credentials: it tests, packs with
`--ignore-scripts` and writes a receipt of the bytes. `publish` (`dry_run`
off, environment `npm-release`, `id-token: write`) re-checks them, confirms
npm trusts the run (`check-trust`) and runs `npm stage publish` with
provenance. Nothing is public until Yu approves the stage.
`scripts/npm-release.mjs` holds every decision.

GitHub runs the workflow file of the ref you dispatch on, so the tagged commit
must contain `publish-npm.yml` and `scripts/npm-release.mjs`. GitHub accepts a
dispatch only when `publish-npm.yml` is also on `main`, so merge this route to
`main` first; on `main` nothing runs without a dispatch.

**Before the first release, once: Yu lets only release tags into
`npm-release`.** npm's trust config names only the repository, the workflow
file and the environment; it cannot name a ref. A pushed branch could carry a
`publish-npm.yml` without this one's tag checks, enter `npm-release`, pass
npm's exchange and stage any tarball, leaving only Yu's 2FA approval in the
way. The environment's deployment policy, matched against the run's
`GITHUB_REF`, is what ties npm's trust to release tags:

```bash
gh api -X PUT repos/cambridgetcg/rhetorlint-spec/environments/npm-release --input - <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST repos/cambridgetcg/rhetorlint-spec/environments/npm-release/deployment-branch-policies -f name='core-v*' -f type=tag
gh api -X POST repos/cambridgetcg/rhetorlint-spec/environments/npm-release/deployment-branch-policies -f name='rules-en-v*' -f type=tag
gh api -X POST repos/cambridgetcg/rhetorlint-spec/environments/npm-release/deployment-branch-policies -f name='cli-v*' -f type=tag
```

Name the three prefixes: agenttool-packages' `*-v*` would also admit `py-v*`
(PYPI_DEPLOY.md). Two optional settings narrow it further:

- **Immutable release tags**, as agenttool-packages' "release tags are
  immutable" ruleset. A mistaken tag then stays; bump the version instead.

  ```bash
  gh api -X POST repos/cambridgetcg/rhetorlint-spec/rulesets --input - <<'JSON'
  {"name":"release tags are immutable","target":"tag","enforcement":"active","bypass_actors":[],
   "conditions":{"ref_name":{"include":["refs/tags/core-v*","refs/tags/rules-en-v*","refs/tags/cli-v*"],"exclude":[]}},
   "rules":[{"type":"deletion"},{"type":"update"},{"type":"non_fast_forward"}]}
  JSON
  ```

- **No admin bypass:** clear "Allow administrators to bypass configured
  protection rules" on `npm-release`. It is on, and GitHub's docs do not say
  whether it covers tag policies.

None of these stops a credential that can push (the owner's, or any tool
logged in with it) from minting a new matching tag. Step d's own pack is the
last check.

Release in dependency order, **core, then rules-en, then cli**, finishing a
package's step f before starting the next; `plan` refuses to stage the CLI
until its caret ranges are installable. For each package (core shown):

**a. Yu confirms the tag policy, then creates one stage-only trust config.**

```bash
gh api repos/cambridgetcg/rhetorlint-spec/environments/npm-release --jq .deployment_branch_policy
gh api repos/cambridgetcg/rhetorlint-spec/environments/npm-release/deployment-branch-policies --jq '.branch_policies[] | "\(.type) \(.name)"'
```

The first must show `custom_branch_policies` true and `protected_branches`
false; the second exactly `tag core-v*`, `tag rules-en-v*` and `tag cli-v*`.
Otherwise stop, and create no trust config. Then, on the device with the npm
login:

```bash
npx --yes npm@11.17.0 trust github @rhetorlint/core --repo cambridgetcg/rhetorlint-spec --file publish-npm.yml --env npm-release --allow-stage-publish --yes
```

Never add `--allow-publish`: this route only stages. npm expires a config that
no publication validates within 48 hours, so create it on release day.

**b. Tag, then dry-run.** `prepare` runs only `npm run test:<package>`, and
`ci.yml` runs only on `main` and pull requests. So first confirm CI is green
on the commit you reviewed, or run `ci.yml`'s commands there (`npm test`, the
real-Chrome worksheet test, the demo, Python and Go conformance, the
three-engine diff, the Python unit tests) and note any date-dependent failure.

```bash
REVIEWED_COMMIT=<the full SHA you reviewed>
git tag -a core-v0.1.3 -m "@rhetorlint/core 0.1.3" "$REVIEWED_COMMIT"
git push origin core-v0.1.3
gh workflow run publish-npm.yml --repo cambridgetcg/rhetorlint-spec --ref core-v0.1.3 \
  -f package=core -f tag=core-v0.1.3 -f npm_tag=latest -f dry_run=true
```

`node scripts/npm-release.mjs check-inputs --package core --tag core-v0.1.3`
on a clean checkout of the tag runs the same tag checks before you push. The
dry run refuses what the real run would, except npm's trust. Its summary shows
the receipt and the planned action (`stage`); make step d's own pack now and
compare its sha256 with the receipt's. `plan` refuses `npm_tag=latest` for a
version older than npm's `latest`; use `npm_tag=next` for one.

**c. Stage.** Run `npx --yes npm@11.17.0 stage list @rhetorlint/core` first,
and reject any pending stage you cannot trace to your own run of this tag.
Then dispatch again with `-f dry_run=false`. With no matching trust config
(step a missing, expired, or naming other claims), `check-trust` refuses with
"no trusted publisher matches" and nothing is staged. Otherwise the summary
shows the stage id, the SHA-256 and the approval commands.

**d. Yu checks the stage against their own run and pack, then approves with
2FA.** Everything in the summary, the SHA-256 included, comes from the run
that staged, so check it against two things that run did not write:

- **Your run.** The stage id is in the summary of the run you dispatched,
  whose ref must be the tag and whose commit must be `$REVIEWED_COMMIT`:
  `gh api repos/cambridgetcg/rhetorlint-spec/actions/workflows/publish-npm.yml/runs --jq '.workflow_runs[:5][] | "\(.id) \(.head_branch) \(.head_sha) \(.triggering_actor.login) \(.created_at)"'`
- **Your own pack of `$REVIEWED_COMMIT`**, not of a ref name: `git clone
  --branch core-v0.1.3` takes a branch of that name over the tag.

  ```bash
  dir=$(mktemp -d)
  git clone --quiet --no-checkout https://github.com/cambridgetcg/rhetorlint-spec.git "$dir/src"
  git -C "$dir/src" ls-remote --exit-code --heads origin core-v0.1.3 && echo "STOP: a branch is named core-v0.1.3"
  test "$(git -C "$dir/src" rev-parse 'refs/tags/core-v0.1.3^{commit}')" = "$REVIEWED_COMMIT" || echo "STOP: the tag is not the reviewed commit"
  git -C "$dir/src" checkout --quiet --detach "$REVIEWED_COMMIT"
  (cd "$dir/src/packages/core" && npx --yes npm@11.17.0 pack --ignore-scripts --pack-destination "$dir")
  shasum -a 256 "$dir/rhetorlint-core-0.1.3.tgz"
  ```

  A pack of `packages/core` at `1a16766` (identical to tag
  `v0.1.3-rules-0.2.0`'s) gave
  `40705425306737d515f13839a6afa9580964c9517bdea81a74b91fd58985f73c` on
  2026-09-07 (npm 11.6.2) and on 2026-11-06 (npm 11.6.2 and 11.17.0), both on
  Node 25.2.1. The workflow packs on Node 24, which is not yet observed; hence
  step b's comparison.

```bash
npx --yes npm@11.17.0 stage view <stage-id>       # version, dist-tag and date staged must be your run's
npx --yes npm@11.17.0 stage download <stage-id>   # prints the .tgz it wrote
shasum -a 256 <that .tgz>                         # must equal your own pack's
npx --yes npm@11.17.0 stage approve <stage-id>    # or: stage reject <stage-id>
```

If the hashes differ, do not approve: reject the stage, or first unpack both
tarballs and `diff -r` them. For a few minutes after staging, `approve` can
answer E409 ("automated review hasn't finished"); wait and run it again.

**e. Verify, once the approval has landed.** Wait until `npx --yes
npm@11.17.0 view @rhetorlint/core@0.1.3 version` prints `0.1.3`: dispatched
before that, `plan` finds the version absent and tries to stage it again.
Then dispatch exactly as in step c. `verify-existing` checks that npm lists
the receipt's digests, points the dist-tag at the version and serves the same
bytes, retrying for up to ten minutes; the summary records
`already_published_exact`.

After the last package of a coordinated release, run step 5's clean-install
check. After core 0.1.3 alone, install it beside npm's current rules-en and
run step 5's engine block against them (with rules-en 0.1.2, core 0.1.3
packed from `1a16766` passed it on 2026-11-06):

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null
npm i "@rhetorlint/core@0.1.3" "@rhetorlint/rules-en@$(npm view @rhetorlint/rules-en dist-tags.latest)"
npm ls --all                             # core must resolve to 0.1.3 for both
```

**f. Revoke the trust config.** npm expires only a config nothing validated,
so this one stays, and would let any later dispatch on an admitted tag stage
without Yu opening trust again. Remove it; the next release starts at step a.

```bash
npx --yes npm@11.17.0 trust list @rhetorlint/core                # shows the config's id
npx --yes npm@11.17.0 trust revoke @rhetorlint/core --id=<id>
```

**Not yet exercised here.** This workflow has not run in this repository.
It follows `cambridgetcg/agenttool-packages`' `publish-npm.yml`, which staged
`@agenttool/wallet@0.1.4` and verified it on 2026-10-30. The npm behaviours
above (the 48-hour expiry, E409, a stage-only config allowing the exchange
for `npm-command: stage`) come from that release, not from this repository.

**Diagnosing.** A dispatch on any ref but `refs/tags/<tag>` skips both jobs.
`check-inputs` refuses a tag that is lightweight, misnamed, not the run's
commit, or named like a branch (delete the branch). "Not allowed to deploy to
npm-release due to environment protection rules" means a run reached
`publish` from a ref the tag policy does not admit. The stage step prints
npm's `oidc` debug-log lines with token-shaped text as `***`; `ENEEDAUTH`
there means the exchange gave npm no token, so it stopped before signing
provenance: go back to step a.

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

Since 2026-10-30 the packages require 2FA and disallow tokens, so a granular
token cannot publish them, even with bypass 2FA. Log in interactively on the
device that holds the security key:

```bash
npm login                               # browser flow
npm whoami                              # prints your npm username
npm org ls <org-name> 2>/dev/null || true   # you should appear as a member
```

Answer every 2FA prompt there yourself; never put an OTP in a command argument,
log, or agent chat. The hand route has not been exercised since the lockdown.

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
republish the other two — a republish is refused, not merged. It offers every
workspace whose version npm lacks, so to release only some, publish those
workspaces one at a time in the table's order instead:

```bash
npm publish -w @rhetorlint/core        # only if its version moved
npm publish -w @rhetorlint/rules-en    # only if its version moved
npm publish -w @rhetorlint/cli         # only if its version moved; always last
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

No workflow runs on tag pushes, so a tag only records the release. Use the
staged route's form, one annotated tag per package published, on the commit
you published from:

```bash
cd -                                     # back to the repo
core_v=$(node -p "require('./packages/core/package.json').version")
git tag -a "core-v${core_v}" -m "@rhetorlint/core ${core_v}" && git push origin "core-v${core_v}"
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
- **Provenance**: the staged route signs it (`--provenance` from GitHub
  Actions); a hand publish has none.
- If a publish fails with `402 Payment Required` or `403`, the scope/org name
  doesn't match or you lack publish rights in the org — recheck step 1 and 2.
