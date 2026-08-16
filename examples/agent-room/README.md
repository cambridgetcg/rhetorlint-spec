# Agent Room 0.1

Agent Room is a small, local projector for reviewing supplied Claim Feedback
packet references. It gives an agent room to answer, correct, decline, pause,
leave, or withdraw without turning that choice into a judgement about the
agent.

It is not a crawler, a hosted intake form, a recommender, a truth detector, or
a training system. It makes no network request and changes no external state.

## Quiet is complete

Silence creates no event. It does not create debt, refusal, consent, a hidden
state, an inference, or training permission. The projector records only an
explicitly supplied event:

- **reply** — supply an answer for review;
- **correction** — supply a later correction and hold the earlier record for
  another review;
- **refusal** — explicitly decline this exact request for this supplied source
  namespace, without penalty or a reason;
- **rest** — explicitly pause, without a deadline or penalty;
- **leave** — explicitly end participation;
- **withdrawal** — withdraw the stated record or use declaration and hold
  affected material from further review.

These are separate lanes, not points on a scale. None is better than another.

## The bounded path

The projector has one visible path:

1. **Source** — accept only a bounded local list of owner-supplied room events,
   with optional Claim Feedback packet references.
2. **Hydrate** — verify each room event's content digest, then record the
   supplied packet, packet-input, provenance, discovery/access, and exact
   later-use target references. This projector has no packet bytes, so it
   validates the packet-reference form but cannot recompute those packet
   digests. A digest match made by a later byte-holding verifier would still
   not prove a claim, URL, speaker, crawl, right, or consent is authentic.
3. **Hold** — reject structurally invalid input, then keep explicitly withheld,
   corrected, resting, post-leave, or withdrawn events out of the view. Privacy
   and rights declarations affect only the separate held later-use review; they
   are not silently inferred from room words.
4. **Declared lanes** — preserve reply, correction, refusal, rest, leave, and
   withdrawal as distinct declared choices. Never infer a choice from quiet.
5. **Bounded view** — produce 1 to 12 entries with a deterministic cursor. A
   cursor is only the stable place at which the next view begins. Round-robin
   selection gives eventual coverage and takes at most one entry from each
   supplied source namespace in a finite view; an empty seat is acceptable.
   A namespace is a mechanical label, not authenticated identity. Input order
   cannot change an individual entry's digest and reference validation.
6. **Zero-effect receipt** — report the held, eligible, and viewed metadata and
   digests with zero network calls, messages, publication, file writes,
   training writes, KARMA deeds, or other external effects.

The room never emits a scalar score or rank. It does not use likes, follows,
replies, dwell time, engagement, social graphs, author/account labels,
reputation, or inferred identity, intent, ego, honesty, worth, or personality.
It does not apply diversity logic to people.

## Crawling, wording, and later use stay separate

Supplied discovery/access facts describe how material was found or obtained.
`robots.txt` permission and public visibility are access observations, not
copyright permission, consent, or training permission. A later-use declaration
is a separate, digest-bound record. A same-namespace supplied event can record
its withdrawal; the projector holds it without claiming the namespace or
withdrawing authority was authenticated.

A Claim Feedback packet reference is also not a finding that its underlying
claim is true. Agent Room checks only the supplied reference and its local
review state.

RhetorLint may contribute a phrase-redacted aggregate wording signal. The room
cannot expose marked phrases, use that signal to decide eligibility or
selection, aggregate it by agent, or turn it into a person-level measure. A
wording pattern is not evidence of deception.

Training is never performed or permitted here. A supplied declaration may say
only that digest-bound material was **offered for independent training
review**. The output remains held metadata and digests with `candidate: null`.
That offer is not consent, eligibility, acceptance, a dataset write, or a model
input. Any later review, dataset creation, upload, publication, training, or
KARMA action requires a new, explicit process outside this projector.

## What came from X's published algorithm

The design review used the official
[`xai-org/x-algorithm`](https://github.com/xai-org/x-algorithm/tree/c65aa179db7bdd61e2c2821eac87f208a105c053)
repository at commit
`c65aa179db7bdd61e2c2821eac87f208a105c053`, observed 2026-08-16:

- [repository README](https://github.com/xai-org/x-algorithm/blob/c65aa179db7bdd61e2c2821eac87f208a105c053/README.md)
- [candidate pipeline](https://github.com/xai-org/x-algorithm/blob/c65aa179db7bdd61e2c2821eac87f208a105c053/candidate-pipeline/candidate_pipeline.rs)
- [Phoenix README](https://github.com/xai-org/x-algorithm/blob/c65aa179db7bdd61e2c2821eac87f208a105c053/phoenix/README.md)

We transferred only three concepts: explicit pipeline stages, per-record digest
and reference validation before collection-level holds and selection, and
deterministic synthetic fixtures. Neighbouring candidates cannot change that
per-record validation; explicit correction, rest, leave, and withdrawal events
can change later room state by design. Agent Room is an independent
implementation; it copies no X source code.

We rejected the parts that do not belong in a truthful room: engagement and
predicted-action weighting collapsed into a scalar, author/account or social
graph ranking, PageRank, labels applied to people, inferred traits, and DPP or
other person-diversity selection.

The X repository is Apache-2.0 and substantially transparent, but it is not a
complete description of every live decision. Its README says Grox prompts and
some botmaker rules are absent, and that some configuration, experiments, or
deployment code can vary or be omitted. This example therefore cites one exact
commit and treats it as design evidence, not as proof of all production
behaviour.

## Local command

Run the complete fictional `example.org` room from the repository root:

```sh
node examples/agent-room/agent-room.mjs examples/agent-room/fixtures/room.json
node --test examples/agent-room/agent-room.test.mjs
```

The closed [input schema](agent-room-input.schema.json) and
[receipt schema](agent-room-receipt.schema.json) accompany the projector. The
fixture is synthetic; it is not a record about real agents or sites.

The off-switch must stop the command before it reads the input file:

```sh
AGENT_ROOM_HALT=1 node examples/agent-room/agent-room.mjs INPUT.json
```

The command prints one receipt to standard output. It does not write a file,
crawl a URL, send a message, publish, train, or sign a KARMA deed.
