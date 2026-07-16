#!/usr/bin/env python3
"""Cross-engine conformance test for the Python engine.

Asserts that impl/python/rhetorlint.py reproduces every case in
conformance/cases.json (the ground truth generated from the JS reference
engine). If this passes in both languages, the two engines agree — the
taxonomy is genuinely portable.

Run:  python3 impl/python/test_conformance.py      (exit 0 = conformant)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rhetorlint  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def flat(result):
    return {
        "density": result["density"],
        "strip": result["strip"],
        "marks": [{
            "ruleId": m["ruleId"], "family": m["family"], "technique": m["technique"],
            "actual": m["actual"], "start": m["position"]["start"]["offset"],
            "end": m["position"]["end"]["offset"], "note": m["note"],
            "confidence": m["confidence"], "level": m["level"], "expected": m["expected"],
        } for m in result["marks"]],
    }


def check_bundle():
    """The bundled rules_en.json (what ships in the wheel) must equal canonical."""
    canonical = ROOT / "packages" / "rules-en" / "rules.json"
    bundled = Path(__file__).resolve().parent / "rules_en.json"
    if not bundled.exists():
        print("FAIL: impl/python/rules_en.json missing — cp packages/rules-en/rules.json impl/python/")
        return False
    if json.loads(bundled.read_text()) != json.loads(canonical.read_text()):
        print("FAIL: bundled rules_en.json is STALE — cp packages/rules-en/rules.json impl/python/")
        return False
    return True


def main():
    corpus = json.loads((ROOT / "conformance" / "cases.json").read_text(encoding="utf-8"))
    rules = rhetorlint.load_default_rules()
    if not check_bundle():
        return 1
    fails = 0
    for i, case in enumerate(corpus["cases"]):
        got = flat(rhetorlint.analyze(case["input"], rules))
        want = {"density": case["density"], "strip": case["strip"], "marks": case["marks"]}
        if got != want:
            fails += 1
            print(f"FAIL case {i}: {case['input'][:60]!r}")
            if got["density"] != want["density"]:
                print(f"  density {got['density']} != {want['density']}")
            if got["strip"] != want["strip"]:
                print(f"  strip  {got['strip']!r}\n  want   {want['strip']!r}")
            if got["marks"] != want["marks"]:
                print(f"  marks  {[(m['ruleId'], m['start'], m['end']) for m in got['marks']]}")
                print(f"  want   {[(m['ruleId'], m['start'], m['end']) for m in want['marks']]}")
    total = len(corpus["cases"])
    if fails:
        print(f"\n{fails}/{total} cases FAILED — the Python engine diverges from the spec ground truth")
        return 1
    print(f"python conformance: {total}/{total} cases identical to the ground truth")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
