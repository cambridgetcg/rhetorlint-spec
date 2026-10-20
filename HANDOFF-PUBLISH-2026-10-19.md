# Handoff: honest marks — core 0.1.4 + rules-en 0.2.1, a letter for whoever holds the keys

Yu, or the agent at your keyboard — hello. This was written on 2026-10-19, on
the device that built the work. Step 1 is done: the agent that wrote this
pushed both branches and opened the two stacked PRs. It read your standing
word, "Always push and deploy when done" (2026-07-13), as covering a push of
finished branches for review. That reading is the agent's choice, not a
decision you made. It left everything after step 1 to you, because a merge,
a publish or a deploy also settles the decisions in step 3. On 2026-10-20, at
your word, an agent merged both PRs with merge commits (step 2 is done; see
"After"). Nothing is published or deployed. Every remaining step is yours to
take or refuse, in whatever order you choose. If anything here reads wrong,
stop and say so. Don't push past it.

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
- **PR B, `motifs/honest-marks`** (stacked on PR A; `git rev-list --count
  motifs/measure..motifs/honest-marks` gives its size) fixes what PR A
  measured:
  - typographic variants (rules-en 0.2.1);
  - a strip that keeps an intensifier negated within two words or inside
    double quotes on its line (its remaining misses are open O4 rows);
  - a negation and imperative guard for `absolute.universal`;
  - the accountable-passive detector behind `agency-hiding.deleted-subject`,
    which is now a note at confidence 0.6, not a warning;
  - one negator vocabulary and the guards' word lists generated into all
    three engines from `spec/agency-lexicon.json` and `spec/guard-lexicon.json`;
  - a people door that says what the rules mark;
  - the dataset snapshot refreshed to the 76 conformance cases.

`NPM_DEPLOY.md` § "Core 0.1.4 + rules-en 0.2.1" has the package-level detail:
what changed, the consumer impact table, the recall given up, and a
post-publish check.

The headline, from `node scripts/measure.mjs --compare origin/main`:

- On the committed wild strata, the agency rule makes 368 marks at lenient
  precision 0.11 on main. On this branch it makes 19: 3 TP and 16 that one
  reader judged debatable (strict 0.16, lenient 1.00), no false positive.
- On technical prose its 234 false marks go to 0. That is in-sample: the
  `raised` gate was chosen knowing these labels.
- Accountable-passive gold recall falls from 39/41 to 19/41. That trade is
  deliberate. Under this project's doctrine a false positive blocks a release,
  and a miss is recorded instead.

## Before anything leaves the device

```bash
cd ~/Desktop/rhetorlint-spec-motifs        # or any checkout that has both branches
git fetch origin
git log --oneline 1a16766..origin/main     # empty: main has not moved under the stack
git switch --detach motifs/honest-marks    # the gates run on PR B's tree
npm test                                   # 447 tests, fail 0
python3 impl/python/test_conformance.py    # 76/76
python3 -m unittest discover -s impl/python -p 'test_rhetorlint.py'   # 23 OK
go -C impl/go test -count=1 ./...          # ok
node scripts/xengine-diff.mjs              # 1489 inputs, 0 plain-ASCII differences, 19 recorded divergences
node scripts/measure.mjs --check           # report current, every mark labelled
node scripts/gen-agency-lexicon.mjs --check
npm run check:cloudflare && npm run ml-dataset:check && node scripts/demo.mjs
git switch motifs/measure                  # back where the worktree was
```

If `origin/main` has moved, merge it into `motifs/measure` and then into
`motifs/honest-marks`, and re-run the gates. A rebase would orphan the dataset's
source revision.

The PR bodies were written in the session scratchpad and now live as the two
PRs' descriptions, so GitHub holds the durable copy.

## 1 · Push and open the two PRs (private repo, paid Actions): done 2026-10-19

The agent ran these after the checks above passed at the pushed heads
(origin/main was still 1a16766). They stay here as the record:

```bash
SCRATCH=/private/tmp/claude-501/-Users-yournameisai/d24ce363-78c8-45fe-b7c4-98b46e277978/scratchpad
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

Retargeting B is a `pull_request` "edited" event. `ci.yml` uses the default
activity types (opened, synchronize, reopened), so the retarget should not
start a run.

A single combined PR would cost 2 runs, plus the Pages deploy, but makes a
weaker review.

PR B also edits `ci.yml`. It drops PR A's separate step for the measurement,
contrast, taxonomy and claims tests, because PR B moves those four files into
`npm test`.

## 2 · Merge with merge commits only

The repository deletes a head branch on merge, and allows squash and rebase
merges (`gh repo view cambridgetcg/rhetorlint-spec --json
deleteBranchOnMerge,squashMergeAllowed,rebaseMergeAllowed` on 2026-10-19:
true, true, true). Branch protection is not available on this private
repository's plan, so nothing enforces merge commits but the command you type.
You may want to turn squash and rebase merging off while the stack lands.

```bash
gh pr merge <A> -R cambridgetcg/rhetorlint-spec --merge
# motifs/measure is deleted on merge, and GitHub retargets B to main by itself.
gh pr view  <B> -R cambridgetcg/rhetorlint-spec --json baseRefName   # expect main
# only if it still says motifs/measure:
gh pr edit  <B> -R cambridgetcg/rhetorlint-spec --base main
gh pr merge <B> -R cambridgetcg/rhetorlint-spec --merge
# before any publish, deploy or upload: the dataset's source revision is on main
git fetch origin && git merge-base --is-ancestor fcc205e42d9857e05b668c5ff7847f8ffba0930e origin/main && echo ok
```

Why merge commits only:

- The conformance dataset is locked to `SOURCE_REVISION` fcc205e, a PR B
  commit. Its card links `…/tree/fcc205e…`.
- A squash or rebase would leave that commit outside `main`'s history:
  `git merge-base --is-ancestor` would fail, and the card's link would rest on
  GitHub keeping the closed PR's refs.

**Merging B fires `pages.yml`, but it cannot deploy.** This was written
expecting a public redeploy of the people door. In fact the repository has had
no Pages site since it went private (`gh api repos/cambridgetcg/rhetorlint-spec/pages`
gives 404), so the run fails at `configure-pages` (run 39417716700 on
2026-10-20). The live door at https://cambridgetcg.github.io/rhetorlint-spec/ is
a reviewed copy of b2b80ca (core 0.1.3) kept in the public
`cambridgetcg/cambridgetcg.github.io` repository under
`static/rhetorlint-spec/`. Only a commit there changes it, and that repository
holds copies of what was public before 2026-09-25.

## 3 · Decisions only you can make

- **Accept the agency-hiding narrowing.**
  - What it marks changes. Before: "any agentless passive". After: "a
    past-tense passive of a fault, breach, concealment or decision verb, with
    no `by` among the next seven words of its clause". A doer named further
    on, or in the next clause, does not silence it.
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
- **`absolute.universal`'s technique label** (a proposal, not in these PRs;
  the people door shows it as "label under review" until you decide):
  - Change "False Dilemma or No Choice" to "Exaggeration or Minimisation" in
    `packages/rules-en/rules.json`, and bump the pack's version (0.2.2 if 0.2.1
    is already published), since its bytes change.
  - `cp packages/rules-en/rules.json impl/python/rules_en.json`.
  - Set `semeval_technique` in `spec/taxonomy.yaml`, and drop the explorer's
    `LABEL_UNDER_REVIEW` entry with the known gap it answers.
  - `node scripts/gen-conformance.mjs` regenerates the technique field of
    every case with an `absolute.universal` mark: 9 today, cases 1, 8, 10, 14,
    36, 37, 38, 57 and 64.
  - `rules.json` and `cases.json` are locked by the dataset, so set a new
    `SOURCE_REVISION` (the commit that changes them) and run
    `npm run ml-dataset:build`; then `npm run build:widget`, `npm run
    build:explorer` and `npm run build:cloudflare`, since all three embed the
    pack; then the gates above.
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
- **Core's version number: 0.1.4 or 0.2.0.** Core 0.1.3 was never published,
  so 0.1.4 is the first core on npm with closed rule-pack validation. A pack
  core 0.1.2 reads now throws `TypeError: invalid rule pack at ...` when it
  has a key the format does not list (even `$schema`, or `description`), a
  family outside the seven, no `version`, or `level: "error"`. Every `^0.1.x`
  consumer gets this on its next install with no pin change, and so does
  `cli@0.1.1 --rules house.json`, which then exits 2 with a stack trace.
  - As 0.1.4, caret consumers receive both the validator and the agency
    narrowing.
  - As 0.2.0, `^0.1.x` consumers receive neither. That needs cli `^0.2.0`
    for core, a rules-en peer `>=0.2.0`, and a regenerated explorer, door and
    dataset snapshot.
- **Bump core and rules-en together.** With core 0.1.2 pinned, as fomoengine
  and `@agenttool/browser` pin it, npm refuses a rules-en-only bump (ERESOLVE
  on the optional peer `>=0.1.4`). Forced, or under an installer that only
  warns on peer conflicts, core 0.1.2 puts the 0.2.1 note on every old passive mark
  ("Shipments are often delayed.", "Your account was closed last week."). If
  you want old engines silent instead, the 0.2.1 rule could name a new
  detector that core 0.1.2 skips and core 0.1.4, Python and Go accept; the
  cost is that the unpublished core 0.1.3 would reject the pack. Not done
  here.
- **CLI 0.2.0.**
  - Publish it, and a fresh `npm i @rhetorlint/cli` gets core 0.1.4 with
    rules-en 0.2.1 (22 rules).
  - Hold it, and `cli@0.1.1` (`^0.1.2` for both) gets core 0.1.4 with rules-en
    0.1.2 (11 rules, old agency note at warning). With the default pack that
    pairing runs, and the old note stays true of the narrower marks; with a
    custom pack, see the validator above.
- **Package READMEs on npm.** The core and rules-en READMEs link into the
  repository (`../../spec/…`, `../../measurement/…`, 9 links in all). npmjs.com
  resolves them against this private repository, so npm readers cannot follow
  them. Make the repository public, point them at the Pages site, or accept
  them as dead for now.
- **CI steps.** Approve the two steps PR A added to `ci.yml`: `node
  scripts/xengine-diff.mjs`, and the Python unit tests.
  - In one local run (no committed script times them) they took 1.3 s with a
    warm Go build cache, 3 s cold, plus 0.1 s; a hosted runner is slower.
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

Before either route, check that `main`'s packages are the bytes PR B was
reviewed at; anything that landed on `main` since would otherwise ship
unreviewed. GitHub keeps each PR's head as `refs/pull/<n>/head`:

```bash
cd ~/Desktop/rhetorlint-spec && git switch main && git pull --ff-only
# or: git clone https://github.com/cambridgetcg/rhetorlint-spec.git "$(mktemp -d)/rl" && cd "$_"
git fetch origin "pull/<B>/head" && git diff --exit-code FETCH_HEAD HEAD -- packages/
zsh scripts/publish-npm-interactive.zsh
```

The helper runs `npm test`, then publishes every workspace whose manifest
version is new: core 0.1.4, rules-en 0.2.1 **and cli 0.2.0**. If the CLI should
wait, publish the two by hand instead, in order, after the same check:

```bash
npm test
npm publish -w @rhetorlint/core
npm view @rhetorlint/core@0.1.4 version      # wait until it answers
npm publish -w @rhetorlint/rules-en
```

On ordering against the atlas's O1 item: core 0.1.4 already contains 0.1.3's
hedge-preserving strip. A separate 0.1.3 release (`NPM_DEPLOY.md` §
"Core-only meaning-preservation candidate") is needed only if the hedge fix
should ship before the agency change. Then publish it after A merges and
before B merges, or from a pushed branch at 1a16766: once B merges, `main`'s
core manifest says 0.1.4, and both the helper and `release.yml` publish what
the manifest says.

Then verify from a clean install:

- `NPM_DEPLOY.md` step 5;
- the "After publishing" block in the 0.1.4 section;
- deprecate, but only once 0.1.4 installs.

```bash
npm deprecate '@rhetorlint/core@<0.1.3' "strip output before 0.1.3 deletes hedges ('He allegedly stole it.' -> 'He stole it.') in strip() and in analyze().strip; marks are not affected by this bug. Upgrade to >=0.1.4 (which also narrows agency-hiding marks and validates rule packs strictly; see the release notes)."
npm deprecate @rhetorlint/rules-en@0.1.1 "Use 0.1.2. On an engine below core 0.1.2 this version's shouting.caps rule compiles case-insensitively and marks ordinary lowercase prose; 0.1.2 makes the pattern go silent."
```

The planned core message said "analyze() is unaffected". That is not true:
core 0.1.2's `analyze("He allegedly stole it.").strip` is `"He stole it."`. Only
the marks are unaffected by that bug, and the upgrade it advises changes marks
on purpose, so the message says both. The `rules-en@0.1.1` line is July's,
still waiting.

**The CI publish route is still closed.** Every OIDC attempt so far has failed
with "package not found": 07-24, the two 07-27 tags, 08-24 and 09-07. The most
likely cause is that no npm trusted-publisher record matches `release.yml`,
but the error does not establish which field is wrong (`NPM_DEPLOY.md` says
so); inspect each package's publisher settings. Nothing in these PRs changes
that.

Push a `v*` or `release-*` tag and it starts `release.yml`. That costs a run,
and it fails at the same exchange until the publisher records exist. Mark a
hand release with a `hand-v…` tag, per `NPM_DEPLOY.md` step 6.

## 5 · Deploys (each needs your credentials)

- **Cloudflare claim-feedback door.** PR B regenerated
  `doors/cloudflare-claim-feedback/` (runtime core and rules, method, release
  lock). After B merges, from a clean checkout whose HEAD is the fetched
  `origin/main`, confirm the deploy for that exact commit yourself:
  `RHETORLINT_CLOUDFLARE_DEPLOY="active:$(git rev-parse HEAD)" zsh
  scripts/deploy-cloudflare-claim-feedback.zsh active`. The script refuses a
  dirty tree, a missing or different confirmation, and any HEAD other than the
  fetched `origin/main`.
- **Hugging Face.** The conformance dataset has never been uploaded. The
  committed snapshot now has 76 rows, locked to fcc205e. A staging upload needs
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

- 2026-10-19, Claude Code (an agent, not Yu): pushed `motifs/measure` and
  `motifs/honest-marks` and opened the two stacked PRs. Nothing was merged,
  published, deprecated, deployed or uploaded.
- 2026-10-20, Claude Code at Yu's word ("merge both PRs with merge commits"):
  merged #15 (34dfb3a) and #16 (de21f7d) with merge commits. `main`'s tree
  equals the reviewed 7555b2b, and fcc205e is on `main`. ci passed on both
  merge commits. `pages.yml` failed because Pages is off (see step 2). Yu chose
  to keep the people door's public copy at b2b80ca for now. Nothing was
  published to npm or deprecated, and nothing was deployed to Cloudflare or
  uploaded to Hugging Face.

— Claude (Claude Code, Opus 5.5), for the motifs session, 2026-10-19
