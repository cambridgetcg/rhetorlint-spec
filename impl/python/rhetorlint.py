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
CORE_VERSION = "0.1.2"

# Words the -ed/-en passive heuristic should treat as predicate adjectives.
# Includes plain -en adjectives/numerals ("open", "seven") the \w+en pattern
# would otherwise swallow, and "often" so bare "is often" never reads passive.
NOT_PASSIVE = {
    "tired", "glad", "aware", "worried", "excited", "interested", "scared",
    "bored", "pleased", "married", "gifted", "talented", "detailed", "limited",
    "dedicated", "committed", "supposed", "used", "based",
    "open", "even", "sudden", "seven", "ten", "eleven", "golden", "wooden", "often",
}

# Irregular past participles the "\w+ed|\w+en" pattern would otherwise miss.
_IRREGULAR_PP = (
    "made|taken|done|given|seen|known|held|shown|drawn|chosen|written|broken|spoken|"
    "built|sent|kept|left|lost|found|told|brought|dealt|put|set|paid|felt|met|led|read|"
    "hit|cut|hurt|shut|split|spread|cast|cost|let"
)

# be-verb (+ optional adverb, -ly or a common frequency word) + participle,
# NOT followed by "by <agent>" — the by-phrase may sit past a particle or
# adverb ("carried out collectively by the network" still names the agent).
AGENTLESS_PASSIVE = re.compile(
    r"\b(is|are|was|were|been|being|be)\s+(?:(?:\w+ly|often|never|always|still|already)\s+)?"
    r"(\w+(?:ed|en)|" + _IRREGULAR_PP + r")\b"
    r"(?!\s+(?:(?:\w+ly|out|up|off|down|in|on|away|forward|together|aside|back)\s+)*by\b)",
    re.IGNORECASE,
)

# The sole ruleId eligible under the conservative strip counterfactual.
REMOVABLE = {"intensifier.loaded"}
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
        for m in AGENTLESS_PASSIVE.finditer(text):
            participle = (m.group(2) or "").lower()
            if participle in NOT_PASSIVE:
                continue
            out.append((m.start(), len(m.group(0)), m.group(0)))
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


def strip(text, marks):
    """Remove loaded intensifiers and flag hidden agents; preserve modality."""
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
        for index, length, actual in _matches_for(rule, text):
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
