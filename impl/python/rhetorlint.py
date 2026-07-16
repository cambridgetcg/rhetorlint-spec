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
import json
import math
import re
import sys
from pathlib import Path

SPEC_VERSION = "0.1"
NAME = "rhetorlint (python)"
CORE_VERSION = "0.1.0"

# Words the -ed/-en passive heuristic should treat as predicate adjectives.
NOT_PASSIVE = {
    "tired", "glad", "aware", "worried", "excited", "interested", "scared",
    "bored", "pleased", "married", "gifted", "talented", "detailed", "limited",
    "dedicated", "committed", "supposed", "used", "based",
}

# Irregular past participles the "\w+ed|\w+en" pattern would otherwise miss.
_IRREGULAR_PP = (
    "made|taken|done|given|seen|known|held|shown|drawn|chosen|written|broken|spoken|"
    "built|sent|kept|left|lost|found|told|brought|dealt|put|set|paid|felt|met|led|read|"
    "hit|cut|hurt|shut|split|spread|cast|cost|let"
)

# be-verb (+ optional adverb) + participle, NOT followed by "by <agent>".
AGENTLESS_PASSIVE = re.compile(
    r"\b(is|are|was|were|been|being|be)\s+(?:\w+ly\s+)?"
    r"(\w+(?:ed|en)|" + _IRREGULAR_PP + r")\b"
    r"(?!\s+by\b)",
    re.IGNORECASE,
)

# The ruleIds whose phrases `strip` may remove without breaking grammar.
REMOVABLE = {"intensifier.loaded", "hedge.deniable"}


def _matches_for(rule, text):
    """A compiled matcher for one rule -> list of (index, length, actual)."""
    out = []
    kind = rule.get("type")
    if kind == "lexical":
        alt = "|".join(re.escape(t) for t in rule["terms"])
        rx = re.compile(r"\b(?:" + alt + r")\b", re.IGNORECASE)
        for m in rx.finditer(text):
            out.append((m.start(), len(m.group(0)), m.group(0)))
    elif kind == "pattern":
        rx = re.compile(rule["pattern"], re.IGNORECASE)
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
    """Deterministic de-spun text: subtract adverbial spin, flag hidden agents."""
    ordered = sorted(marks, key=lambda m: m["position"]["start"]["offset"], reverse=True)
    out = text
    for m in ordered:
        s = m["position"]["start"]["offset"]
        e = m["position"]["end"]["offset"]
        if m["ruleId"] in REMOVABLE:
            out = out[:s] + out[e:]
        elif m["ruleId"] == "agency-hiding.deleted-subject":
            out = out[:s] + "[who?] " + out[s:]
    out = re.sub(r"\s{2,}", " ", out)
    out = re.sub(r"\s+([,.;:!?])", r"\1", out)
    out = re.sub(r",\s*,", ",", out)
    out = re.sub(r"\s+$", "", out, flags=re.MULTILINE)
    return out.strip()


def analyze(text, rules=None, locale=None, rewrite=None):
    """analyze(text, rules) -> a RhetorLint result dict (see the spec)."""
    if not rules or not isinstance(rules.get("rules"), list):
        raise ValueError("analyze() needs a rule pack: analyze(text, rules)")

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
                "expected": rule.get("expected", []),
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

    return {
        "rhetorlint": SPEC_VERSION,
        "source": {"chars": len(text), "words": words, "locale": locale or rules.get("locale") or "en"},
        "density": {"tells": len(deduped), "per100Words": per100},
        "marks": deduped,
        "strip": strip(text, deduped),
        "rewrite": rewrite(text, deduped) if callable(rewrite) else None,
        "engine": {"name": NAME, "version": CORE_VERSION, "rules": rules["id"] + "@" + rules["version"]},
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
