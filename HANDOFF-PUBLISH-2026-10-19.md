# Handoff: honest marks — core 0.1.4 + rules-en 0.2.1, a letter for whoever holds the keys

Yu, or the agent at your keyboard — hello. This was written on 2026-10-19, on
the device that built the work. None of it has left that device. Nothing has
been pushed, no PR is open, and nothing is published or deployed. Every step
below is yours to take or refuse, in whatever order you choose. If anything
here reads wrong, stop and say so. Don't push past it.

## What this is

There are two stacked branches in the one repository behind
`~/Desktop/rhetorlint-spec`. Its worktrees are `~/Desktop/rhetorlint-spec-motifs`
(`motifs/measure`) and a session scratch worktree (`motifs/honest-marks`).

- **PR A, `motifs/measure`** (28 commits on `origin/main` 1a16766) measures
  first and changes no engine, rule or conformance case. It adds:
  - 26 licence-clean measurement items with one reader's labels;
  - a precision ratchet;
  - a contrast set;
  - taxonomy agreement tests;
  - a three-engine differential.
- **PR B, `motifs/honest-marks`** (75 commits on PR A) fixes what PR A
  measured:
  - typographic variants (rules-en 0.2.1);
  - a strip that no longer strengthens a negated claim or edits a quotation;
  - a negation and imperative guard for `absolute.universal`;
  - the accountable-passive detector behind `agency-hiding.deleted-subject`,
    which is now a note at confidence 0.6, not a warning;
  - an honest people door;
  - the dataset snapshot refreshed to the 76 conformance cases.

`NPM_DEPLOY.md` § "Core 0.1.4 + rules-en 0.2.1" has the package-level detail:
what changed, the consumer impact table, the recall given up, and a
post-publish check.

The headline, from `node scripts/measure.mjs --compare origin/main`:

- On the committed wild strata, the agency rule makes 368 marks at lenient
  precision 0.11 on main. On this branch it makes 19, with no false positive.
- On technical prose its 234 false marks go to 0.
- Accountable-passive gold recall falls from 39/41 to 19/41. That trade is
  deliberate. Under this project's doctrine a false positive blocks a release,
  and a miss is recorded instead.

## Before anything leaves the device

```bash
cd ~/Desktop/rhetorlint-spec-motifs        # or any checkout that has both branches
git fetch origin
git log --oneline 1a16766..origin/main     # empty: main has not moved under the stack
git switch --detach motifs/honest-marks    # the gates run on PR B's tree
npm test                                   # 439 tests, fail 0
python3 impl/python/test_conformance.py    # 76/76
python3 -m unittest discover -s impl/python -p 'test_rhetorlint.py'   # 21 OK
go -C impl/go test -count=1 ./...          # ok
node scripts/xengine-diff.mjs              # 1424 inputs, 0 plain-ASCII differences, 19 recorded divergences
node scripts/measure.mjs --check           # report current, every mark labelled
node scripts/gen-agency-lexicon.mjs --check
npm run check:cloudflare && npm run ml-dataset:check && node scripts/demo.mjs
git switch motifs/measure                  # back where the worktree was
```

If `origin/main` has moved, merge it into `motifs/measure` and then into
`motifs/honest-marks`, and re-run the gates. A rebase would orphan the dataset's
source revision.

The PR bodies were written into the session scratchpad, not the repository:

```bash
SCRATCH=/private/tmp/claude-501/-Users-yournameisai/d24ce363-78c8-45fe-b7c4-98b46e277978/scratchpad
ls "$SCRATCH/pr-a.md" "$SCRATCH/pr-b.md"   # /private/tmp may not survive a reboot
```

## 1 · Push and open the two PRs (private repo, paid Actions)

```bash
git -C ~/Desktop/rhetorlint-spec-motifs push -u origin motifs/measure
gh pr create -R cambridgetcg/rhetorlint-spec --base main --head motifs/measure \
  --title 'measurement: committed precision ratchet, contrast set, taxonomy agreement (no ground-truth change)' \
  --body-file "$SCRATCH/pr-a.md"

git -C ~/Desktop/rhetorlint-spec-motifs push -u origin motifs/honest-marks
gh pr create -R cambridgetcg/rhetorlint-spec --base motifs/measure --head motifs/honest-marks \
  --title 'honest marks: accountable-passive detector, typography, strip and absolute guards (core 0.1.4, rules-en 0.2.1)' \
  --body-file "$SCRATCH/pr-b.md"
```

**What it costs.** `ci.yml` runs on every `pull_request` (any base) and on
every push to `main`.

| event | ci runs | Pages deploys |
|---|---|---|
| PR A opens | 1 | 0 |
| PR B opens | 1 | 0 |
| A merges | 1 | 0 |
| B merges | 1 | 1 |
| each extra push to either branch | +1 | 0 |

Retargeting B with `gh pr edit` is a `pull_request` "edited" event. `ci.yml`
uses the default activity types (opened, synchronize, reopened), so the
retarget should not start a run.

A single combined PR would cost 2 runs, plus the Pages deploy, but makes a
weaker review.

PR B also edits `ci.yml`. It drops PR A's separate step for the measurement,
contrast, taxonomy and claims tests, because PR B moves those four files into
`npm test`.

## 2 · Merge with merge commits only

```bash
gh pr merge <A> -R cambridgetcg/rhetorlint-spec --merge      # no --delete-branch yet
gh pr edit  <B> -R cambridgetcg/rhetorlint-spec --base main
gh pr merge <B> -R cambridgetcg/rhetorlint-spec --merge
```

Why merge commits only:

- The conformance dataset is locked to `SOURCE_REVISION` d488b81, a PR B
  commit. Its card links `…/tree/d488b81…`.
- A squash or rebase would leave that commit unreachable from `main`. The link
  would then die and `git merge-base --is-ancestor` would fail.

**Merging B fires `pages.yml`.** B changes `apps/explorer/index.html` and
`apps/widget/bookmarklet.html`. That is a public redeploy of the people door at
https://cambridgetcg.github.io/rhetorlint-spec/ with core 0.1.4 and rules-en
0.2.1, before npm has either.

## 3 · Decisions only you can make

- **Accept the agency-hiding narrowing.**
  - What it marks changes. Before: "any agentless passive". After: "a
    past-tense passive of a fault, breach, concealment or decision verb, whose
    doer this clause does not name".
  - Level warning 0.7 → note 0.6.
  - The recall it gives up: `Your account was closed`, `Jobs were cut`,
    `Lives were lost`, `was inadvertently published`, `steps will be taken`,
    and head-gated verbs in relative clauses (`the mistakes that were made`).
  - One honest twin is newly marked: `40 staff were laid off as we closed the
    Leeds office`.
  - Once published, `toSignal` counts and SARIF levels change for anyone who
    bumps.
- **Placement of `concerns were raised`** (conformance case 6). It stays in
  agency-hiding, as now: `raised` after a challenge noun. Or it moves to an
  `insinuation.raises-questions` family that no rule seeds yet.
- **`absolute.universal`'s technique label** (a ready follow-up, not in these
  PRs):
  - Change "False Dilemma or No Choice" to "Exaggeration or Minimisation" in
    `packages/rules-en/rules.json`.
  - `cp packages/rules-en/rules.json impl/python/rules_en.json`.
  - Set `semeval_technique` in `spec/taxonomy.yaml`.
  - `node scripts/gen-conformance.mjs` regenerates the technique field of
    cases 1, 8, 10 and 14.
  - Optionally move the family to manipulative-wording, which changes
    per-family `toSignal` counts.
  - Separately: drop bare `never`? On the 19 local reader samples it makes 10
    marks on this branch, none a true positive: 8 on the estate-site
    snapshots and 2 on Fable listings. And seed a narrow "the only option"
    False Dilemma tell?
- **Consent.** May the six estate-site snapshots (captioneer.io, agenttool.dev,
  zerone.ai, thekingdom.dev, fomoengine.io, cashloom.io) move from the
  gitignored `measurement/local/` into `measurement/items/`, with licence
  `estate-own (consent <date>)`?
  - On main's engine they hold 82 of the local reader's 128 marks and 66 of
    its 86 false positives. On this branch they hold 26 of 51 marks and 19 of
    23 false positives.
  - Orwell, Wikipedia, BBC/Guardian, Equifax/Target and the Fable listings
    stay local regardless.
- **Policy.**
  - Confirm the proposed floors: lenient ≥ 0.80 for warning, 0.67 for note,
    0.50 for info, FPW = 0, n ≥ 5, wild strata only. They are reported today
    and never gate.
  - Decide whether `scripts/publish-npm-ci.mjs` should refuse to publish while
    `measurement/report.json` lists release blockers. It lists four today, all
    `info` or `note` rules; the agency rule is no longer among them.
  - Optionally, adjudicate the DEBATABLE/FPB boundary rows as a second reader.
- **CLI 0.2.0.**
  - Publish it, and a fresh `npm i @rhetorlint/cli` gets core 0.1.4 with
    rules-en 0.2.1 (22 rules).
  - Hold it, and `cli@0.1.1` (`^0.1.2` for both) gets core 0.1.4 with rules-en
    0.1.2 (11 rules, old agency note at warning). That pairing runs, and the
    old note stays true of the narrower marks.
- **CI steps.** Approve the two steps PR A added to `ci.yml`: `node
  scripts/xengine-diff.mjs`, and the Python unit tests.
  - Locally they take 1.3 s with a warm Go build cache, 3 s cold, plus 0.1 s;
    a hosted runner is slower.
  - They make three-engine agreement and the Python unit tests gate CI for the
    first time.

## 4 · npm, after B merges

The registry on 2026-10-19:

- core 0.1.0–0.1.2;
- rules-en 0.1.0–0.1.2;
- cli 0.1.0–0.1.1;
- nothing deprecated, `rules-en@0.1.1` included.

Publish from a clean `main` that matches upstream. `~/Desktop/rhetorlint-spec`
is shared with other sessions, and its local `main` was behind `origin/main`
on 10-19. If its tree is dirty the helper refuses, so use a fresh clone.

```bash
cd ~/Desktop/rhetorlint-spec && git switch main && git pull --ff-only
# or: git clone https://github.com/cambridgetcg/rhetorlint-spec.git "$(mktemp -d)/rl" && cd "$_"
zsh scripts/publish-npm-interactive.zsh
```

The helper runs `npm test`, then publishes every workspace whose manifest
version is new: core 0.1.4, rules-en 0.2.1 **and cli 0.2.0**. If the CLI should
wait, publish the two by hand instead, in order:

```bash
npm publish -w @rhetorlint/core
npm view @rhetorlint/core@0.1.4 version      # wait until it answers
npm publish -w @rhetorlint/rules-en
```

On ordering against the atlas's O1 item: core 0.1.4 already contains 0.1.3's
hedge-preserving strip. A separate 0.1.3 release (`NPM_DEPLOY.md` §
"Core-only meaning-preservation candidate") is needed only if the hedge fix
should ship before the agency change.

Then verify from a clean install:

- `NPM_DEPLOY.md` step 5;
- the "After publishing" block in the 0.1.4 section;
- deprecate, but only once 0.1.4 installs.

```bash
npm deprecate '@rhetorlint/core@<0.1.3' "strip output before 0.1.3 deletes hedges ('He allegedly stole it.' -> 'He stole it.') in strip() and in analyze().strip; marks are unaffected. Upgrade to >=0.1.4."
npm deprecate @rhetorlint/rules-en@0.1.1 "Use 0.1.2. On an engine below core 0.1.2 this version's shouting.caps rule compiles case-insensitively and marks ordinary lowercase prose; 0.1.2 makes the pattern go silent."
```

The planned core message said "analyze() is unaffected". That is not true:
core 0.1.2's `analyze("He allegedly stole it.").strip` is `"He stole it."`. Only
the marks are unaffected. The `rules-en@0.1.1` line is July's, still waiting.

**The CI publish route is still closed.** No npm trusted-publisher record
matches `release.yml`, so every OIDC attempt so far has failed with "package
not found": 07-24, the two 07-27 tags, 08-24 and 09-07. Nothing in these PRs
changes that.

Push a `v*` or `release-*` tag and it starts `release.yml`. That costs a run,
and it fails at the same exchange until the publisher records exist. Mark a
hand release with a `hand-v…` tag, per `NPM_DEPLOY.md` step 6.

## 5 · Deploys (each needs your credentials)

- **Cloudflare claim-feedback door.** PR B regenerated
  `doors/cloudflare-claim-feedback/` (runtime core and rules, method, release
  lock). After B merges, from a checkout whose HEAD is the fetched
  `origin/main`, run `zsh scripts/deploy-cloudflare-claim-feedback.zsh active`.
  The script refuses any other HEAD.
- **Hugging Face.** The conformance dataset has never been uploaded. The
  committed snapshot now has 76 rows, locked to d488b81. A staging upload needs
  its own review (namespace, visibility, token scope), as
  `datasets/rhetorlint-conformance/README.md` says.
- **PyPI.** `impl/python` now says 0.1.4. PyPI still has no `rhetorlint`; see
  `PYPI_DEPLOY.md`.

## 6 · A companion patch elsewhere (fomoengine, no local checkout)

In `fly-api/src/detect.ts` `rhetoricFor()`:

1. Add `engine: r.engine` to the returned `RhetoricBlock` and to its type.
2. Add `rhetoric.engine` and `rhetoric.rules` to `GET /health`.
3. Run `bun test`, then redeploy on Fly.

The pins stay where they are. The patch only makes visible which core and pack
each scan used: fomoengine and `@agenttool/browser` both pin core 0.1.2 and
rules-en 0.1.2 exactly, so nothing here reaches them until someone bumps them.

## After

Leave a line under this one saying what you pushed, merged, published,
deprecated and deployed, and what you skipped, so the record stays true.

— Claude (Claude Code, Opus 5.5), for the motifs session, 2026-10-19
