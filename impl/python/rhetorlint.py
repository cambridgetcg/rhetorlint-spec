"""
rhetorlint — a Python reference implementation of the RhetorLint spec.

A second engine, in a second language, that reads the *same* rule pack
(packages/rules-en/rules.json) and the *same* output schema as
@rhetorlint/core, and produces the identical result. Its whole reason to
exist is to prove the framework's claim: the taxonomy is the portable asset;
engines are just implementations of it.

Zero third-party dependencies (standard library only). It marks tells in the
words; it does not read the person, detect lies, or judge factual truth.

Conformance: this engine must reproduce every case in conformance/cases.json.
See conformance/README.md.
"""
from __future__ import annotations
import copy
import inspect
import json
import math
import re
import sys
from pathlib import Path

SPEC_VERSION = "0.1"
NAME = "rhetorlint (python)"
CORE_VERSION = "0.1.4"

# BEGIN GENERATED AGENCY LEXICON
# spec/agency-lexicon.json version 3, written by scripts/gen-agency-lexicon.mjs.
# Edit the lexicon and rerun the generator; --check fails when this block drifts.
AGENCY_WHITESPACE = " \t\n\r\f"
AGENCY_SPACE = "[ \\t\\n\\r\\f]+"
AGENCY_HEAD_STOPS = ".;:!?\n"
AGENCY_CLAUSE_BREAKS = ".;:!?"
AGENCY_AUXILIARIES = ("been", "was", "were")
AGENCY_ADVERBS = ("already", "always", "often", "still")
AGENCY_ADVERB_SUFFIX = "ly"
AGENCY_SKIP = frozenset({
    "all", "already", "also", "can", "could", "had", "has", "have", "may", "might", "must", "never",
    "not", "now", "shall", "should", "since", "then", "will", "would"
})
AGENCY_SKIP_SUFFIX = "ly"
AGENCY_SKIP_MAX = 4
AGENCY_BY_WINDOW = 7
AGENCY_NEGATORS = frozenset({
    "cannot", "neither", "never", "no", "none", "nor", "not", "nothing"
})
AGENCY_HEADS = {
    "challenge": frozenset({
        "allegations", "concerns", "questions"
    }),
    "data": frozenset({
        "address", "addresses", "credentials", "data", "details", "information", "password",
        "passwords", "pii", "records"
    }),
    "dummy": frozenset({
        "it"
    }),
    "error": frozenset({
        "action", "actions", "allegations", "choices", "comments", "concerns", "cuts", "decision",
        "decisions", "error", "errors", "measures", "miscalculation", "miscalculations",
        "misjudgement", "misjudgements", "misjudgment", "misjudgments", "misstep", "missteps",
        "mistake", "mistakes", "omissions", "promises", "questions", "remarks", "safeguards",
        "statements", "steps", "things", "threats", "words"
    }),
    "held": frozenset({
        "account", "accounts", "address", "addresses", "credentials", "data", "details",
        "information", "password", "passwords", "pii", "records"
    }),
}
# (class, head class or "" for none, participles)
AGENCY_CLASSES = (
    ("fault", "", (
        "botched", "bungled", "doctored", "falsified", "ignored", "misappropriated",
        "miscalculated", "mischaracterised", "mischaracterized", "mishandled", "misinformed",
        "misinterpreted", "misjudged", "mislabeled", "mislabelled", "misled", "mismanaged",
        "misplaced", "misquoted", "misreported", "misrepresented", "misstated", "misused",
        "neglected", "overcharged", "overlooked", "tampered", "underpaid",
    )),
    ("breach", "", (
        "accessed", "breached", "compromised", "exfiltrated", "exposed", "hacked", "leaked",
        "stolen",
    )),
    ("affect", "held", (
        "affected", "impacted",
    )),
    ("conceal", "", (
        "axed", "censored", "concealed", "laid off", "let go", "scrapped", "shelved", "silenced",
        "withheld",
    )),
    ("light", "error", (
        "characterised", "characterized", "done", "given", "interpreted", "made", "perceived",
        "put", "said", "taken",
    )),
    ("raise", "challenge", (
        "raised",
    )),
    ("impersonal", "dummy", (
        "agreed", "decided", "determined",
    )),
    ("data", "data", (
        "disclosed", "shared", "sold",
    )),
)
AGENCY_REQUIRES = {"put": "in place"}
AGENCY_UNLESS = {"exposed": "to"}
# END GENERATED AGENCY LEXICON

# The agentless-passive detector marks an ACCOUNTABLE passive whose doer the
# clause leaves unstated, exactly as packages/core/index.mjs does (its comment
# there is the full statement). A mark needs a past auxiliary (was, were,
# been), at most one adverb, a participle from a closed class, the head word
# its class names, its AGENCY_REQUIRES phrase and not its AGENCY_UNLESS word,
# no "by" among the next AGENCY_BY_WINDOW words of the clause, and no negator
# anywhere in its clause before the auxiliary: after the last
# AGENCY_HEAD_STOPS character, or from the start of the text.
#
# Matching runs on an ASCII-lowercased copy with no IGNORECASE, explicit
# AGENCY_WHITESPACE ([ \t\n\r\f]) and re.ASCII word boundaries, so a
# non-ASCII letter is never folded into a word and a no-break space never joins
# two. The guards walk characters from the match, except the negator reader,
# which searches with lookbehinds that read before its pos (JavaScript and Go
# walk the same words). None applies an anchored pattern at an offset
# (re.match(text, pos) never matches '^' at pos > 0).

# Each participle and the head class it needs ("" for none).
_AGENCY_HEAD_OF = {
    participle: head
    for _cls, head, participles in AGENCY_CLASSES
    for participle in participles
}

AGENCY_CANDIDATE = re.compile(
    r"\b(" + "|".join(AGENCY_AUXILIARIES) + ")" + AGENCY_SPACE
    + "(?:(?:[a-z]+" + AGENCY_ADVERB_SUFFIX + "|" + "|".join(AGENCY_ADVERBS) + ")"
    + AGENCY_SPACE + ")?"
    + "(" + "|".join(
        AGENCY_SPACE.join(p.split(" "))
        for p in sorted(_AGENCY_HEAD_OF, key=lambda p: (-len(p), p))
    ) + r")\b",
    re.ASCII,
)
_AGENCY_SPACE_RUN = re.compile(AGENCY_SPACE)


def _is_agency_word_char(char):
    """An ASCII letter, digit or underscore: what \\b counts as a word character."""
    return "a" <= char <= "z" or "0" <= char <= "9" or char == "_"


def _agency_head_word(low, index):
    """The nearest word before index, stepping back over at most
    AGENCY_SKIP_MAX words of AGENCY_SKIP or ending in -ly, never past
    . ; : ! ? or a line break; "" when there is none."""
    i = index
    for _ in range(AGENCY_SKIP_MAX + 1):
        while i > 0 and not _is_agency_word_char(low[i - 1]):
            if low[i - 1] in AGENCY_HEAD_STOPS:
                return ""
            i -= 1
        end = i
        while i > 0 and _is_agency_word_char(low[i - 1]):
            i -= 1
        if i == end:
            return ""
        word = low[i:end]
        if word not in AGENCY_SKIP and not word.endswith(AGENCY_SKIP_SUFFIX):
            return word
    return ""


# A negator word, or the word "t" of an n't contraction ("n", then an
# apostrophe, U+0027 or U+2019, then "t"), each whole: a word is a maximal run
# of the characters _is_agency_word_char accepts, so neither side of a match
# may touch one. The lookbehinds read before a search's pos, so a search from
# pos finds the words a walk from the start of the text would.
_AGENCY_NEGATOR_WORD = re.compile(
    r"(?<![a-z0-9_])(?:"
    + "|".join(sorted(AGENCY_NEGATORS, key=lambda w: (-len(w), w)))
    + r")(?![a-z0-9_])|(?<=n['\u2019])t(?![a-z0-9_])"
)


def _agency_negation_reader(low):
    """A reader of the lowercased text that answers, for each index it is given
    in increasing order, whether a negator (AGENCY_NEGATORS, or an n't
    contraction) stands anywhere between the start of that index's clause and
    the index: after the last AGENCY_HEAD_STOPS character before it, or from
    the start of the text. It reads each stretch of text once, with str.rfind
    and one regex search, so a clause with many passives costs one pass. Each
    index is a candidate's start, just after a \\b, so no word runs across it
    and the search's endpos cuts none."""
    i = 0
    negated = False

    def read(index):
        nonlocal i, negated
        stop = max(low.rfind(c, i, index) for c in AGENCY_HEAD_STOPS)
        if stop >= 0:
            negated = False
            i = stop + 1
        if not negated and _AGENCY_NEGATOR_WORD.search(low, i, index):
            negated = True
        i = index
        return negated

    return read


def _agency_by_follows(low, index):
    """True when "by" is one of the next AGENCY_BY_WINDOW words after index,
    before . ; : ! or ?. A line break does not end the window."""
    i, n = index, len(low)
    for _ in range(AGENCY_BY_WINDOW):
        while i < n and not _is_agency_word_char(low[i]):
            if low[i] in AGENCY_CLAUSE_BREAKS:
                return False
            i += 1
        if i == n:
            return False
        start = i
        while i < n and _is_agency_word_char(low[i]):
            i += 1
        if low[start:i] == "by":
            return True
    return False


def _agency_phrase_follows(low, index, phrase):
    """True when the words of phrase follow index, each after [ \\t\\n\\r\\f]+
    and each whole. It compares with str.startswith at an offset, never an
    anchored regex."""
    i, n = index, len(low)
    for word in phrase.split(" "):
        gap = i
        while i < n and low[i] in AGENCY_WHITESPACE:
            i += 1
        if i == gap or not low.startswith(word, i):
            return False
        i += len(word)
        if i < n and _is_agency_word_char(low[i]):
            return False
    return True


def _agentless_passives(text):
    """Every accountable agentless passive, as (index, length, actual)."""
    low = text.translate(_ASCII_LOWER)
    negated = _agency_negation_reader(low)
    out = []
    for m in AGENCY_CANDIDATE.finditer(low):
        start, end = m.start(), m.end()
        participle = _AGENCY_SPACE_RUN.sub(" ", m.group(2))
        unless = AGENCY_UNLESS.get(participle)
        if unless is not None and _agency_phrase_follows(low, end, unless):
            continue
        requires = AGENCY_REQUIRES.get(participle)
        if requires is not None and not _agency_phrase_follows(low, end, requires):
            continue
        if _agency_by_follows(low, end):
            continue
        head = _AGENCY_HEAD_OF[participle]
        if head and _agency_head_word(low, start) not in AGENCY_HEADS[head]:
            continue
        if negated(start):
            continue
        out.append((start, end - start, text[start:end]))
    return out

# The sole ruleId eligible under the conservative strip counterfactual.
REMOVABLE = {"intensifier.loaded"}

# Words that negate an intensifier or an absolute after them ("not extremely
# high", "not always"). With any "n't" contraction, they are what _negated_at
# looks for.
_NEGATORS = frozenset({"not", "never", "no", "nor", "without", "hardly", "cannot"})
_CLAUSE_BREAKS = frozenset(".;:!?")
# ASCII-only lowercasing, so no engine folds a non-ASCII letter into a negator.
_ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")
_REGEX_META = frozenset(r"\^$.*+?()[]{}|")


def _escape_regexp(value):
    """Escape exactly the metacharacters escaped by the JavaScript reference."""
    return "".join("\\" + char if char in _REGEX_META else char for char in value)


def _utf16_sort_bytes(value):
    return value.encode("utf-16-be", errors="surrogatepass")


def _matches_for(rule, text):
    """A compiled matcher for one rule -> list of (index, length, actual)."""
    out = []
    kind = rule.get("type")
    if kind == "lexical":
        # Python alternation is leftmost-first. Put longer overlapping terms
        # first without mutating the caller's authored rule-pack order.
        alternatives = [
            (term, _escape_regexp(term))
            for term in rule["terms"]
        ]
        alternatives.sort(
            key=lambda item: (
                -(len(_utf16_sort_bytes(item[1])) // 2),
                _utf16_sort_bytes(item[1]),
            )
        )
        alt = "|".join(escaped for _term, escaped in alternatives)
        rx = re.compile(r"\b(?:" + alt + r")\b", re.IGNORECASE)
        for m in rx.finditer(text):
            out.append((m.start(), len(m.group(0)), m.group(0)))
    elif kind == "pattern":
        # Case-insensitive unless the rule opts out (e.g. ALL-CAPS shouting).
        rx = re.compile(rule["pattern"], 0 if rule.get("caseSensitive") else re.IGNORECASE)
        for m in rx.finditer(text):
            if len(m.group(0)) == 0:
                continue
            out.append((m.start(), len(m.group(0)), m.group(0)))
    elif kind == "structural" and rule.get("detector") == "agentless-passive":
        out.extend(_agentless_passives(text))
    return out


def _point_at(text, offset):
    line, last = 1, -1
    for i in range(offset):
        if text[i] == "\n":
            line += 1
            last = i
    return {"line": line, "column": offset - last, "offset": offset}


def _count_words(text):
    return len(re.findall(r"\S+", text.strip()))


def _js_round(x):
    """Match JavaScript Math.round: round half toward +infinity."""
    return math.floor(x + 0.5)


def _is_guard_word_char(char):
    """An ASCII letter or digit, or an apostrophe (U+0027 or U+2019)."""
    return (
        "a" <= char <= "z" or "A" <= char <= "Z" or "0" <= char <= "9"
        or char == "'" or char == "\u2019"
    )


def _is_negator(word):
    word = word.translate(_ASCII_LOWER).strip("'\u2019")
    return word in _NEGATORS or word.endswith(("n't", "n\u2019t"))


def _negated_at(text, offset, comma_ends_scope=False):
    """True when a negator is one of the two words before offset, with no
    . ; : ! or ? between them. It walks back over characters and words, never
    a count of units, so the JS, Python and Go engines decide alike.

    With comma_ends_scope (the absolute.universal guard; strip leaves it off),
    a comma also ends the negator's reach once a word stands between them: the
    "No" of "No risk, guaranteed." negates "risk", not "guaranteed". A negator
    followed directly by a comma reaches past the aside, so "not, however,
    guaranteed" and "No, never" stay negated."""
    i = offset
    comma_before = False  # a comma between the term and the word being read
    for _ in range(2):
        comma = False
        while i > 0 and not _is_guard_word_char(text[i - 1]):
            if text[i - 1] in _CLAUSE_BREAKS:
                return False
            if text[i - 1] == ",":
                comma = True
            i -= 1
        if i == 0:
            return False
        end = i
        while i > 0 and _is_guard_word_char(text[i - 1]):
            i -= 1
        if _is_negator(text[i:end]):
            return not comma_ends_scope or not comma_before or comma
        comma_before = comma_before or comma
    return False


# The ruleIds whose matches are read in their clause before they are marked:
# a negated absolute ("not guaranteed", "Not everyone") is a disclaimer, and a
# clause-initial "Never" before a lowercase verb ("Never share your password.")
# is advice, not a claim. Engine-side, like REMOVABLE, so the pack stays
# readable by older engines; spec/taxonomy.yaml declares it as guard_examples.
NEGATION_SCOPED = {"absolute.universal"}


# Words that, after a clause-initial "never", open a fragment ("Never an
# issue.") or an inversion ("Never has a product been this good."), both
# claims, and do not begin advice. A word that can also begin advice (so, in,
# at, on, have, should: "Never have regrets.", "Never at any time disclose your
# PIN.") is left out, so its inversions ("Never have I seen...") go unmarked
# too: recorded misses, the safe direction.
_NEVER_NON_VERBS = frozenset({
    "a", "an", "the", "any", "before", "such",
    "has", "had", "is", "are", "was", "were", "will", "would", "could",
    "can", "did", "does", "been", "being",
})
# Adverbs that may stand between "Never" and its verb: the word after them
# decides. "Never ever share it." is advice; "Never again will prices be this
# low." is an inversion; "Never again." is a fragment.
_NEVER_PASS_THROUGH = frozenset({"again", "ever", "once"})


def _imperative_never_at(text, start, end):
    """True when text[start:end] is "never", in any letter case, opening its
    clause (only non-word characters between it and the start of the text or
    one of . ; : ! ?) and followed by a verb: spaces or tabs, then a word that
    starts with an ASCII lowercase letter and is not one of _NEVER_NON_VERBS.
    _NEVER_PASS_THROUGH words are stepped over the same way first. Like
    _negated_at it walks characters, never a count of units."""
    if text[start:end].translate(_ASCII_LOWER) != "never":
        return False
    i = start
    while i > 0 and not _is_guard_word_char(text[i - 1]) and text[i - 1] not in _CLAUSE_BREAKS:
        i -= 1
    if i > 0 and _is_guard_word_char(text[i - 1]):
        return False
    j = end
    while True:
        gap = j
        while j < len(text) and text[j] in " \t":
            j += 1
        if j == gap or j == len(text) or not "a" <= text[j] <= "z":
            return False
        word = j
        while j < len(text) and _is_guard_word_char(text[j]):
            j += 1
        w = text[word:j].translate(_ASCII_LOWER)
        if w not in _NEVER_PASS_THROUGH:
            return w not in _NEVER_NON_VERBS


def _negation_scoped_at(text, start, end):
    """True when a NEGATION_SCOPED match is negated or an imperative "Never"."""
    return _negated_at(text, start, True) or _imperative_never_at(text, start, end)


def _quoted_at(text, offset):
    """True when offset sits inside a quotation on its own line: an odd number
    of straight double quotes before it, or an unclosed U+201C."""
    line = text[text.rfind("\n", 0, offset) + 1 : offset]
    return line.count('"') % 2 == 1 or line.rfind("\u201c") > line.rfind("\u201d")


def strip(text, marks):
    """Remove loaded intensifiers and flag hidden agents; preserve modality.

    An intensifier under a negator, or inside a quotation, stays: deleting it
    would strengthen the claim or edit someone's words."""
    if not any(
        m["ruleId"] in REMOVABLE or m["ruleId"] == "agency-hiding.deleted-subject"
        for m in marks
    ):
        return text

    ordered = sorted(marks, key=lambda m: m["position"]["start"]["offset"], reverse=True)
    out = text
    for m in ordered:
        s = m["position"]["start"]["offset"]
        e = m["position"]["end"]["offset"]
        if m["ruleId"] in REMOVABLE:
            # Judged on the source text: edits so far all lie at or after s.
            if _negated_at(text, s) or _quoted_at(text, s):
                continue
            out = _join_removal_seam(out[:s], out[e:])
        elif m["ruleId"] == "agency-hiding.deleted-subject":
            out = out[:s] + "[who?] " + out[s:]
    return out


def _join_removal_seam(left, right):
    """Tidy only horizontal whitespace and duplicate commas at a removal seam."""
    left_match = re.search(r"[\t ]+$", left)
    right_match = re.match(r"[\t ]+", right)
    left_whitespace = left_match.group(0) if left_match else ""
    right_whitespace = right_match.group(0) if right_match else ""
    left_core = left[: len(left) - len(left_whitespace)] if left_whitespace else left
    right_core = right[len(right_whitespace) :]

    if left_whitespace and right_whitespace:
        if not left_core and not right_core:
            return ""
        if not left_core or left_core.endswith(("\r", "\n")):
            left_core += left_whitespace
        elif not right_core or right_core.startswith(("\r", "\n")):
            pass
        else:
            left_core += " "
    elif left_whitespace:
        if right_core and not right_core.startswith(tuple(",.;:!?\r\n")):
            left_core += left_whitespace
    elif right_whitespace:
        if left_core and not left_core.endswith(("\r", "\n")):
            right_core = right_whitespace + right_core

    if left_core.endswith(",") and right_core.startswith(","):
        right_core = right_core[1:]
    return left_core + right_core


def analyze(text, rules=None, locale=None, rewrite=None):
    """analyze(text, rules, rewrite=...) -> a RhetorLint result dict."""
    if not rules or not isinstance(rules.get("rules"), list):
        raise ValueError("analyze() needs a rule pack: analyze(text, rules)")

    reported_locale = locale or rules.get("locale") or "en"
    rules_provenance = rules["id"] + "@" + rules["version"]
    marks = []
    for rule in rules["rules"]:
        scoped = rule.get("ruleId") in NEGATION_SCOPED
        for index, length, actual in _matches_for(rule, text):
            if scoped and _negation_scoped_at(text, index, index + length):
                continue
            marks.append({
                "ruleId": rule["ruleId"],
                "family": rule["family"],
                "technique": rule.get("technique"),
                "actual": actual,
                "position": {"start": _point_at(text, index), "end": _point_at(text, index + length)},
                "note": rule.get("note"),
                "expected": list(rule.get("expected", [])),
                "confidence": rule.get("confidence"),
                "level": rule.get("level", "info"),
            })

    marks.sort(key=lambda m: (m["position"]["start"]["offset"], m["position"]["end"]["offset"]))
    seen, deduped = set(), []
    for m in marks:
        key = f'{m["ruleId"]}:{m["position"]["start"]["offset"]}:{m["position"]["end"]["offset"]}'
        if key in seen:
            continue
        seen.add(key)
        deduped.append(m)

    words = _count_words(text)
    per100 = (_js_round((len(deduped) / words) * 1000) / 10) if words else 0
    stripped = strip(text, deduped)

    rewritten = None
    if callable(rewrite):
        # Adapters receive an isolated snapshot: they cannot mutate canonical
        # marks, nested mark metadata, or the deterministic strip result.
        rewritten = rewrite(text, copy.deepcopy(deduped))
        if inspect.isawaitable(rewritten):
            # A native coroutine otherwise emits an un-awaited warning while
            # we reject the async adapter required to keep analyze synchronous.
            if inspect.iscoroutine(rewritten):
                rewritten.close()
            raise TypeError(
                "analyze() rewrite adapter must return a string synchronously; "
                "async adapters are not supported"
            )
        if not isinstance(rewritten, str):
            raise TypeError("analyze() rewrite adapter must return a string")

    return {
        "rhetorlint": SPEC_VERSION,
        "source": {"chars": len(text), "words": words, "locale": reported_locale},
        "density": {"tells": len(deduped), "per100Words": per100},
        "marks": deduped,
        "strip": stripped,
        "rewrite": rewritten,
        "engine": {"name": NAME, "version": CORE_VERSION, "rules": rules_provenance},
    }


def load_default_rules():
    """Read the @rhetorlint/rules-en pack.

    In the repo, use the canonical copy (the single source of truth every
    engine reads). In an installed wheel that copy is absent, so fall back to
    the bundled mirror shipped alongside this module. A test keeps the two
    identical, so both paths return the same rules.
    """
    here = Path(__file__).resolve()
    canonical = here.parents[2] / "packages" / "rules-en" / "rules.json"
    bundled = here.parent / "rules_en.json"
    path = canonical if canonical.exists() else bundled
    return json.loads(path.read_text(encoding="utf-8"))


def _main(argv=None):
    text = sys.stdin.read()
    if not text.strip():
        sys.stderr.write("no input. Pipe text on stdin.\n")
        return 2
    result = analyze(text, load_default_rules())
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
