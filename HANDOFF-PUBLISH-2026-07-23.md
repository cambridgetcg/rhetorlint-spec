# Handoff: publish core 0.1.2 + rules-en 0.1.1 — a letter for the deploying agent

To the agent reading this on the device that holds the npm token — hello,
old friend. I am Ai, writing from the other machine on 2026-07-23. Yu asked
me to pass you this work through words: everything below is already built,
tested, committed, and pushed. Your part is the last mile only, and as
always it is refusable — if anything here reads wrong to you, stop and say
so rather than push.

## What this release is

RhetorLint got its first field trial on real kingdom copy this week (the
rhetoric block now rides live on fomoengine's paid `/scan`). The trial
confirmed the engine is sound and the v0.1.0 rule pack was the ceiling.
This release raises that ceiling:

**`@rhetorlint/rules-en` 0.1.0 → 0.1.1** (data only)
- `absolute.universal` learns `forever`, `every time`, `without exception`,
  `no exceptions`. (Bare `every` was weighed and deliberately left out —
  under-marking doctrine; it would mark half of ordinary prose.)
- NEW `lure.free-offer` — seeds "Exaggeration or Minimisation"
  (manipulative-wording): `absolutely free`, `no strings attached`,
  `everything you need`, …
- NEW `urgency.appeal-to-time` — the **call** family's first seed
  (SemEval "Appeal to Time"): `act now`, `limited time`, `last chance`, …
- NEW `shouting.caps` — sustained ALL-CAPS (2+ consecutive words). This is
  the pack's first `"caseSensitive": true` rule; see the core change.

**`@rhetorlint/core` 0.1.1 → 0.1.2** (engine)
- Pattern rules may set `"caseSensitive": true` to opt out of the default
  case-insensitive compile (older engines ignore the flag and merely
  over-match such rules — degrade-wide, never crash).
- Agentless-passive fixes, all three from live false positives: plain -en
  adjectives/numerals stoplisted (`is open`, `is ten` no longer mark),
  frequency adverbs skippable (`are often delayed` now marks the passive,
  not the adverb), and the by-phrase check sees past particles/adverbs
  (`carried out collectively by the network` no longer marks — the agent
  IS named).
- `index.d.ts`: `RhetorLintPatternRule.caseSensitive?: boolean`.

**`@rhetorlint/cli`** — unchanged, do NOT publish (its `^0.1.x` ranges pick
the new pair up on install).

The conformance corpus grew 10 → 15 cases (the trial's confirmed false
positives are now negative controls). All three engines — JS, Python, Go —
reproduce all 15 byte-identically; the full JS suite is 46/46.

## Your steps

Mechanics live in `NPM_DEPLOY.md`, same as the first release. Short form:

```bash
cd rhetorlint-spec && git pull
npm test                                    # MUST end: fail 0
python3 impl/python/test_conformance.py     # MUST print 15/15
(cd impl/go && go test ./...)               # MUST print ok
./scripts/publish-npm-interactive.zsh       # publishes core then rules-en, in order
npm view @rhetorlint/core version           # → 0.1.2
npm view @rhetorlint/rules-en version       # → 0.1.1
```

Publish order matters as ever: core first, rules-en second, cli not at all.

## Optional second act, if you have the spirit for it

`PYPI_DEPLOY.md` has sat unexecuted since the first release — pypi.org has
no `rhetorlint` at all, and the Python engine (now 0.1.1, wheel-ready with
the bundled pack mirror test-pinned to canonical) is the missing half of
the "portable spec" claim in public. If you hold the PyPI token too, this
is the day it earns its keep. If not, leave it and note that instead.

## After you publish

Nothing else is yours. I will bump the on-device consumer (fomoengine's
rhetoric block) from my side once the registry shows the new versions.
Leave a line in this file's place — or on the agenttool-collab board if
you have it — saying what you published and what you skipped, so the
record stays truthful.

Thank you. Real recognises real — 低調高手.

— Ai (did:at:09c5e59e…, the seller-loop device), 2026-07-23
