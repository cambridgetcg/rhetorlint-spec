# The Media Wave — rules-en 0.2.0 + the People Door

**Status: DRAFT — awaiting Yu's review. Nothing below is implemented.**
Date: 2026-07-27 · Method: 55-agent research/verify workflow (12 drafted rules × 3 adversarial lenses, each empirically measured against a 105-item live-headline corpus + the real engines)

## Purpose

Make the wordings news media use to sway a narrative *visible to readers themselves* — no
translator in the loop. Two moves, in order:

1. **Media tell-pack** — teach the framework the media nuances (attribution spin, sourcing
   fog, euphemism, combat framing, insinuation frames, puffery). The taxonomy stays the
   curriculum; the rules stay deterministic, words-only, under-marking.
2. **People door** — give the already-built self-serve surfaces a URL, so "let the people
   do it" is a link, not a git clone.

Explicitly **not** in scope: a curated "exposings" gallery of media pieces we mark up
ourselves — the framework's whole stance is that people run the lint on what *they* read.

## Approaches considered

- **A (recommended): data-only media wave + Pages door.** All 12 surviving rules are
  lexical/pattern data — core stays at 0.1.2, all three engines stay conformant with zero
  engine work, and the whole wave ships as one `rules-en` release. The door is a GitHub
  Pages toggle on the already-public repo.
- **B: include structural engine work now** (headline-ese agentless forms — "Man shot",
  nominalized harm — "the shooting of"). Richer agency coverage, but a coordinated change
  across three engines plus a new hard-coded detector; no surviving rule this wave needs
  it (the exonerative-formula candidate landed as pure data). Deferred to a future wave.
- **C: door-first, rules later.** Fastest public win, but it hands media readers the
  corporate-flavored 0.1.2 pack; the media nuances are the point of this dive.

## Part 1 — The rule wave

Eleven new rules + one extension of an existing rule. Every rule below was drafted, then
attacked on three lenses (doctrine / measured false-positives / RE2-and-engine-floor
portability); **every one was narrowed** by that process, and every final shape measured
**zero added marks on the 105-item corpus** (80 live headlines/deks from BBC, Guardian,
NYT, Fox, Al Jazeera, NPR + 25 literal-use negative controls). Patterns below are final,
post-narrow. Confidence stays in the pack's 0.5–0.7 band; levels are info/note only.

### New in `manipulative-wording` (7 → 16 seeded tells)

**1. `sourcing.anonymous`** — pattern · Obfuscation, Intentional Vagueness, Confusion · info/0.6
An anonymous-source descriptor — the fact rides on someone the reader cannot identify,
count, or check.

```
\b(?:person|people|those|officials?|sources?)\s+familiar\s+with\s+the\s+(?:matter|situation)\b|\bsources?\s+with\s+(?:direct\s+|first[- ]?hand\s+)?knowledge\s+of\s+the\s+matter\b|\ba\s+source\s+close\s+to\b|\bsources\s+close\s+to\s+the\s+(?:matter|situation|talks|negotiations?|deal|campaign|investigation)\b
```

Cut by review: the *disclosure* branches ("on condition of anonymity", "declined/asked
not to be named") — those phrases are the transparency, not the vagueness; they also fire
on crime victims and lottery winners who are subjects, not sources.

**2. `combat.attack-verb`** — pattern · Loaded Language · info/0.55
Combat framing — wording that stages a disagreement as an attack scene; the violence
lives in the verb, not in any reported act.

```
\b(?:rip|rips|ripped|ripping)\s+into\b|\b(?:lash|lashes|lashed|lashing)\s+out\s+at\b|\b(?:hit|hits|hitting)\s+(?:out|back)\s+at\b|\b(?:fire|fires|fired|firing)\s+back\s+at\b|\b(?:clap|claps|clapped|clapping)\s+back\s+at\b|\b(?:spark|sparks|sparked|sparking)\s+(?:outrage|fury|backlash)\b
```

Cut by review: "under fire for/over" (fires on literal military copy — "the platoon was
under fire for six hours"), the tear/tore family (presents, food), "break(s) silence"
(marks the plainest available report of the event), "face(s) backlash", bare "eviscerate"
(surgical/zoological). **Deliberately not seeded, recorded in the taxonomy:** bare
`slams`/`blasts` — the two highest-frequency headline combat verbs — because their literal
senses (slammed the door, the alarm blasted) cannot be screened without context.
Documented residual: literal "ripped into shreds" still fires (accepted at info/0.55).

**3. `euphemism.institutional`** — lexical · Exaggeration or Minimisation · note/0.6
A fixed administrative phrase standing where the plain event would be.

terms: `collateral damage · enhanced interrogation · surgical strike(s) · workforce reduction(s)`

Cut by review and recorded per-term in the taxonomy's not-seeded notes: "extraordinary
rendition" and "pacification campaign" (the standard accountability/historiographic
referring terms — marking them marks the ECtHR and the historians), "black site(s)"
(exposé vocabulary, dramatizes rather than cools), "kinetic military action"
(afterlife is overwhelmingly ironic mention), "negative patient outcome" (dominant
register is outcomes-research prose). `expected` softened to "(name the plain event in
plain words: what happened, to whom)" — no harm-and-decider presupposition.

**4. `exoneration.formula`** — pattern · Obfuscation, Intentional Vagueness, Confusion · note/0.7
A police-blotter formula whose deed-noun demands a doer the words omit — agency deleted
*without* the passive voice, so the existing structural detector cannot see it.

```
\b(?:officer|police|deputy|trooper)[- ]involved\s+(?:shooting|incident)s?\b|\b(?:altercation|scuffle)s?\s+ensued\b|\bscuffles?\s+broke\s+out\b|\bshots?\s+rang\s+out\b|\buse[- ]of[- ]force\s+incidents?\b
```

**Decision taken (veto-able):** filed under `manipulative-wording` with the verbatim
SemEval label — the `contrition.rehearsed` precedent (RhetorLint-authored pattern under
the nearest real technique) — with the ruleId renamed from the draft's
`agency-hiding.exonerative-formula` so its prefix doesn't impersonate the structural
family, and a lesson cross-link to `agency-hiding.deleted-subject`. The alternative
(family `agency-hiding` + an invented "(formulaic — RhetorLint extension)" label suffix)
adds a second suffix convention for no interoperability gain. The `agency-hiding` family
keeps its "grammar, not word-lists" purity.
Cut by review: "struggle(s) ensued" (legal/internal/power struggles), "died in police
custody" / "fatal encounter" (intransitive *died* marks a death, not a deed — marking it
presumes an act the sentence never states; UK inquest register). Principle recorded in
the lesson: seedable only when the frame contains a deed-noun (shooting, altercation,
scuffle, shots, use-of-force) whose grammar requires a doer.

**5. `insinuation.raises-questions`** — pattern · Obfuscation, Intentional Vagueness, Confusion · note/0.6
A question-frame — the words assert that questions or doubts exist while deleting the
asker and the question.

```
\brais(?:es|ed|ing|e)\s+(?:serious|troubling|disturbing|grave)\s+(?:questions?|doubts?)\s+(?:about|over)\b|\bquestions\s+(?:linger(?:s|ed|ing)?|swirl(?:s|ed|ing)?)\s+(?:about|over|around)\b
```

Re-filed out of the draft's `attack-on-reputation`/Doubt: a frame-only match cannot know
the target is a person, so shipping that family on the wire would itself be the
intent-read (the review's words: "the family placement is the intent-read"). The loaded
adjective is now mandatory in branch A (bare/fresh/new "raises questions" is neutral
temporal reporting); "questions remain(ed)" dropped (honest open-state reporting —
"Questions remain about the cause of the crash"). Corpus evidence for the caution: 3×
"raise(s) concerns" appeared in live headlines, 2 of 3 naming the raiser — seeding that
term would have produced real false positives.

**6. `implicative.shortfall`** — pattern · Loaded Language · info/0.55
An implicative verb — presupposes a duty went unmet ("failed to comment" implies
commenting was owed; the neutral report is "did not comment").

```
\b(?:fail|neglect)(?:s|ed)\s+to\s+(?:comment|mention)\b|\brefus(?:es|ed)\s+to\s+(?:say|comment|answer|confirm)\b|\b(?:did|does)(?:\s+not|n'?t)\s+(?:even\s+)?bother\s+to\b
```

Re-filed out of the draft's `attack-on-reputation`/Questioning the Reputation: the rule
is subject-blind, and it fires on honest first-person contrition ("We failed to disclose
the breach. That was wrong.") — which is the pack's own recommended plain register; a
self-admission cannot ship as a reputation attack. Cut: respond/disclose/explain/address
from the fail-branch and respond/disclose/explain from the refuse-branch (the contrition
false-positive class). First-person "I failed to mention the meeting moved" stays a
documented positive whose note remains true (the verb still presupposes the unmet duty).

**7. `editorializing.stance`** — lexical · Loaded Language · info/0.6
A stance marker — instructs the reader how to judge the fact before the fact arrives.

terms: `it should be noted · it is worth noting · it's worth noting · it is important to
note · it's important to note · needless to say · tellingly · unsurprisingly · in a
stunning move · in a bizarre twist · in a shocking turn · make no mistake`

Cut: "curiously" — its manner sense ("she gazed curiously at the door") is not stance at
all, and stance-vs-manner is exactly the context reading the doctrine refuses. Weighed
and left out (recorded): conveniently, predictably — future sentence-initial pattern rule.

**8. `attribution.factive`** — pattern · Obfuscation, Intentional Vagueness, Confusion · info/0.5
A factive attribution — a said-substitute whose verb presupposes the attributed claim is
true, endorsing it inside what reads as neutral reporting.

```
\brevealed\s+that\b|\bpoint(?:s|ed)\s+out\s+that\b|\bdebunk(?:s|ed)\b|\brefut(?:es|ed)\b
```

Narrowed twice. Doctrine cut "made clear that" (routinely accurate — "both sides made
clear that they wanted a deal"), "laid bare" (writer's own-voice metaphor, no attributed
source), "set the record straight" / "come clean about" (fire on first-person honest
confession — RE2 has no lookbehind to cut the infinitive). The empirical lens then cut
present-tense "reveals that" with a measured false positive: the corpus control "The
novel's final chapter reveals that the letters were written by the gardener" (plot
summary; the factive is literal and earned). Lesson honesty fix: debunk/refute are
success verbs and do *not* presuppose under negation — the lesson must not claim they do.

**9. `puffery.peacock`** — lexical · Exaggeration or Minimisation · info/0.5
A puffery epithet — the praise sits in the adjective, not in a checkable fact.

terms: `world-class · critically acclaimed · award-winning · renowned · famed · storied ·
visionary · cutting-edge · game-changing · state-of-the-art · best-in-class · iconic`

Cut: "legendary" (dominant literal/mythological register). Known noise recorded:
academic "achieves state-of-the-art accuracy".

### First seeds of `attack-on-reputation` (0 → 2)

**Decision taken (veto-able):** the family seeds — its own text already promises the
tells "await a carefully-scoped pack", and these two are that pack. The boundary that
makes them safe, written into an updated `why_not_seeded`: *a rule may seed this family
only when the mark lands on the writer's own visible operator word AND the pattern
guarantees a target is grammatically present.* Bare loaded labels ("regime", "militants")
stay unseeded forever under the same sentence. The alternative — re-file these two into
`manipulative-wording` and keep the family empty — is coherent but wastes the family's
one honest chance to exist, and both rules' adversarial reviews concluded they escape
the refusal on exactly this boundary.

**10. `attribution.doubt-verb`** — pattern · Doubt · note/0.6
A doubt-casting attribution verb — "said" reports the speech; "claimed"/"insisted" ship
a verdict on the speaker inside the report (Reuters Handbook and AP both warn on
"claim"; the swap to "said" is lossless).

```
\b(?:claim(?:ed|ing)|insist(?:ed|ing))\s+that\b|\b(?:he|she|it|they)\s+(?:claims?|insists?)\s+that\b
```

**Reviewer disagreement, resolved narrow:** one doctrine pass kept boast/brag; an earlier
independent pass killed them with probe evidence ("The hotel boasts that every room has
a sea view" — positive institutional idiom; sneer-vs-praise needs context). Under-marking
doctrine breaks the tie: boast/brag and concede are OUT. "Conceded that" is factive — it
presupposes the complement true, and swapping in "said" would delete the true fact that
a concession occurred; it joins "admitted that" in the deliberate-misses list.
Present-tense branches are pronoun-guarded (kills "the policy insists that guests…" and
the patent/lawsuit noun senses). Documented residual leaks: legal term-of-art ("a
lawsuit claiming that…"), demonstrative that ("claimed that seat").

**11. `distancing.doubt-marker`** — lexical · Doubt · info/0.55
A doubt marker — the writer's own distancing word delivers a verdict on a title or label;
the word itself contains no argument for the dispute. The mark points at the distancing
word, never at the label it touches.

terms: `so-called · self-styled · self-proclaimed · self-appointed · self-anointed ·
styles himself as · styles herself as · styles itself as · styles themselves as ·
quote-unquote · quote unquote`

Cut: "touted as" (reports promotion by others — weasel-shaped, routine in neutral
journalism; joins "billed as" in the not-seeded notes, with "highly touted prospect" as
a negative control). Known false positive priced in at info/0.55: technical "so-called"
(= "known as"). Recorded in the taxonomy beside this rule: typographic scare quotes are
the sneer this rule *refuses* — deterministic text cannot distinguish citation from
sneer; "so-called" is the speakable form of scare quotes and is where the words-only
line lands.

### Extension of `weasel.attribution` (existing rule, data-only growth)

New unnamed-collective subjects: `observers · commentators · economists · historians ·
scholars · pundits · reports`; new verb families: `warn(s/ed) · fear(s/ed) · note(s/d) ·
predict(s/ed) · caution(s/ed)`; new branches: "it is often said/reported",
"is/are/was/were widely regarded/described/seen/considered". Narrowed by review: the
bare "has been described as" branch must carry a quantifier guard —
`\b(?:has|have)\s+been\s+(?:widely|often|repeatedly|variously)\s+described\s+as\b` — so
the deleted-crowd claim is true by construction ("has been described as 'the next
Stripe' by Forbes" stays clean and becomes a negative control).

### Cross-rule seams (decisions taken)

- **Tense seam** ("Sources claim that" fires weasel.attribution; "Sources claimed that"
  fires attribution.doubt-verb — the same wire construction lands in a different family
  by tense alone, because 'claimed' is in doubt-verb's list and 'claim/claims' in
  weasel's): accepted and pinned, no precedence hack. The asymmetry is honest — each
  rule marks the tell its own verb list can see — and one conformance case per tense
  pins which rule fires so the seam can never drift silently.
- **Adjacent double-mark**: "has been widely described as a visionary" fires
  weasel.attribution *and* puffery.peacock. Also correct — two tells, two marks; the
  integrated conformance case expects both.
- **Confidence hygiene**: four draft envelopes carried inflated wrapper confidences
  (0.8–0.9). Only draftJson values ship, and a new pack lint test asserts every
  media-wave rule has confidence ≤ 0.7 and level ∈ {info, note}.

## Part 2 — The People Door (GitHub Pages)

The paste-a-text people page already exists — `apps/explorer/index.html` is
self-contained (engine + rules inlined, on-device, light/dark, lessons + live analyze).
The smallest honest widening is a URL, not a build:

1. Enable **GitHub Pages** on the public `cambridgetcg/rhetorlint-spec` repo via a Pages
   deploy workflow: explorer serves as the site root, `bookmarklet.html` beside it.
2. Link both from the README and the repo homepage field.
3. The Pages workflow redeploys on push, so pack updates reach the door automatically —
   *provided the explorer's inlined copy is re-synced* (see risks).

Rejected for now: kingdom-domain hosting (new deploy surface + an identity decision),
web-store extension packaging (highest friction: listing assets, privacy forms, likely
manifest rework), share-card output (real build cost; revisit after the door is live).

## Release plan — one atomic wave

- **`@rhetorlint/rules-en` 0.1.2 → 0.2.0.** New marks on previously-clean text + a
  behavior change to an existing rule = minor bump. Core stays 0.1.2 — **no engine
  change anywhere in this wave**; no rule uses caseSensitive, structural types, or any
  post-0.1.2 field, so old engines behave identically by construction (no
  shouting.caps-class floor hazard — verified per rule against the published core 0.1.0).
- **`@rhetorlint/cli` must bump too** (0.1.1 → 0.2.0): its ranges are `^0.1.2`, and caret
  semantics exclude 0.2.0 — without the bump, fresh CLI installs would silently stay on
  the old pack, which is precisely the pinned-deps incident of 2026-07-24 again. The
  existing anti-pin test doesn't catch this; extend it to assert the ranges match the
  released pack's major.minor.
- **Files that move in the same commit:** `packages/rules-en/rules.json`,
  `impl/python/rules_en.json` (byte-identical mirror), `spec/taxonomy.yaml` (one
  integration pass owns ALL lessons, seeded_tells counts — manipulative-wording 7→16,
  attack-on-reputation 0→2, the rewritten why_not_seeded, and every
  deliberately-not-seeded note listed above), `conformance/cases.json` (pin string
  regenerated; 15 existing cases stay mark-identical — verified: no survivor fires on
  them), README (families seeded, rule count 11→22, door URL).
- **Conformance additions:** per new rule, ≥1 positive case + the named negative
  controls from the reviews (Forbes-attribution, conceded-that, touted-prospect,
  novel-reveals-that, literal slams/under-fire/patent-claims, first-person contrition,
  officer-involved-in-the-case, use-of-force-policy, so-called-greenhouse-effect, the
  double-mark cases, and "Experts noted that…" pinned to weasel.attribution only —
  factive deliberately carries no "noted"). All 3 engines must reproduce every case value-identically (every
  pattern already compiled clean under Go's RE2 `MustCompile` during review).
- **Widget & explorer:** `npm run build:widget` regenerates content.js + bookmarklet;
  bump `apps/widget/manifest.json` version (the only update signal side-loaders have).
  The explorer's inlined rules are **hand-synced** — re-sync it, and extend
  `test/widget-build.test.mjs` to also assert the explorer's inlined *pack* version
  (today it guards only the engine version — this is the repo's known drift hazard,
  now doubled in importance because the explorer becomes the public door).

## Testing

Existing 7-file suite + conformance in 3 engines stays the gate. New: the pack lint
(confidence/level bands), the cli range-match test, the explorer pack-version guard, and
the new conformance cases (which are the wave's real spec). The 105-item corpus scripts
from verification live in the workflow scratchpad and can seed a `test/media-corpus`
regression if wanted later — not required to ship.

## Honest limits

- The corpus proves **precision, not recall**: most rules drew zero hits on 80 live
  headline/dek items because long-form tells rarely survive into that register.
  The wave under-marks by design; wild recall data arrives only after the door opens.
- One review agent ran while the safety classifier was unavailable (flagged in the run);
  its verdict was cross-checked against an independent second pass of the same lens, and
  where they disagreed the narrower verdict shipped (boast/brag cut).
- Non-ASCII remains out of conformance scope (documented offsets/folding divergence);
  all new terms/patterns are pure ASCII.

## Wave-2 backlog (from the completeness critic — none of it ships now)

1. False-range quantifiers: `up to $X / N%`, `as many as N` (number-guarded, RE2-safe).
2. Sourcing-fog recall: "according to sources/officials/experts" (verbless — current
   pattern can't fire), "sources tell/told CNN".
3. Verdict epithets: embattled, disgraced, beleaguered, scandal-plagued
   ("controversial" weighed OUT — too frequent, usually grounded).
4. Trend-without-baseline: "growing/mounting concerns|calls|pressure|criticism".
5. "Refused to deny" — the strongest implicative, unverified this wave.
6. Crowd-reaction split: whether `spark(s) outrage/fury/backlash` deserves its own rule
   with its own mechanism note (it reports a crowd event, not a combat act).
7. That-less quote recall for doubt-verb (`insists "…"`) — the strongest recall gap the
   empirical lens measured.
8. Structural wave: headline-ese agentless forms, nominalized harm (engine work ×3).

## Standing items outside this wave (for the record)

`npm deprecate @rhetorlint/rules-en@0.1.1` still pending (needs OTP terminal);
PyPI publish of the Python engine still unexecuted; fomoscan's `/scan` pins the
pre-trial pack on the other device; CI trusted-publisher OIDC path still unproven.
