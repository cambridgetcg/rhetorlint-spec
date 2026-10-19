"""Focused behavioral regressions for the Python reference engine."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rhetorlint  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def test_pack(rule=None):
    return {
        "id": "test-pack",
        "version": "1",
        "locale": "en",
        "rules": [] if rule is None else [rule],
    }


def lexical_rule(rule_id, terms):
    return {
        "ruleId": rule_id,
        "family": "test",
        "technique": "test",
        "type": "lexical",
        "terms": terms,
        "confidence": 0,
    }


class LexicalMatcherTests(unittest.TestCase):
    def test_overlapping_terms_prefer_longest_without_mutating_pack(self):
        terms = ["kind", "kind of"]
        result = rhetorlint.analyze(
            "It is kind of difficult.",
            test_pack(lexical_rule("test.lexical.longest", terms)),
        )

        self.assertEqual([mark["actual"] for mark in result["marks"]], ["kind of"])
        self.assertEqual(terms, ["kind", "kind of"])


# Smart punctuation must not silence a tell. rules-en spells the typographic
# variants in the pack; these twelve probes mirror test/typography.test.mjs and
# impl/go/rhetorlint_test.go (ruleId and actual only: offsets differ by engine
# outside ASCII, so they stay out of conformance/cases.json).
TYPOGRAPHY_PROBES = [
    ("Let\u2019s not forget their record.", "deflection.whataboutism", "Let\u2019s not forget"),
    ("Don\u2019t miss out on this deal.", "urgency.appeal-to-time", "Don\u2019t miss out"),
    ("It\u2019s worth noting the date.", "editorializing.stance", "It\u2019s worth noting"),
    ("He didn\u2019t even bother to reply.", "implicative.shortfall", "didn\u2019t even bother to"),
    ("Try it risk\u2011free today.", "lure.free-offer", "risk\u2011free"),
    ("These so\u2011called experts.", "distancing.doubt-marker", "so\u2011called"),
    ("An officer\u2013involved shooting.", "exoneration.formula", "officer\u2013involved shooting"),
    ("A world\u2011class team.", "puffery.peacock", "world\u2011class"),
    (
        "Sources with first\u2011hand knowledge of the matter.",
        "sourcing.anonymous",
        "Sources with first\u2011hand knowledge of the matter",
    ),
    ("It\u2019s important to note the timing.", "editorializing.stance", "It\u2019s important to note"),
    ("Act before it\u2019s too late.", "urgency.appeal-to-time", "before it\u2019s too late"),
    ("A self\u2011proclaimed expert.", "distancing.doubt-marker", "self\u2011proclaimed"),
]


class TypographyProbeTests(unittest.TestCase):
    def test_typographic_variants_mark_like_their_ascii_spelling(self):
        rules = rhetorlint.load_default_rules()
        for text, rule_id, actual in TYPOGRAPHY_PROBES:
            with self.subTest(text=text):
                result = rhetorlint.analyze(text, rules)
                self.assertEqual(
                    [(mark["ruleId"], mark["actual"]) for mark in result["marks"]],
                    [(rule_id, actual)],
                )


class StripTests(unittest.TestCase):
    def test_no_marks_is_exact_identity(self):
        text = "  Untouched  text.\n"
        self.assertEqual(rhetorlint.analyze(text, test_pack())["strip"], text)

    def test_modal_hedge_is_marked_but_preserved(self):
        text = "It  may be true.\n"
        rule = lexical_rule("hedge.deniable", ["may"])
        result = rhetorlint.analyze(text, test_pack(rule))

        self.assertEqual(len(result["marks"]), 1)
        self.assertEqual(result["strip"], text)

    def test_lexical_intensifier_remains_removable(self):
        rule = lexical_rule("intensifier.loaded", ["extremely"])
        cases = [
            ("It is extremely clear.", "It is clear."),
            (
                "A  extremely   careful claim.\nSecond  line.",
                "A careful claim.\nSecond  line.",
            ),
            ("A extremely, careful claim.", "A, careful claim."),
            ("A, extremely, careful claim.", "A, careful claim."),
            ("Careful, extremely", "Careful,"),
            ("Careful extremely", "Careful"),
            ("Extremely careful", "careful"),
            ("A extremely\nNext  line.", "A\nNext  line."),
            ("A\nextremely clear", "A\nclear"),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                result = rhetorlint.analyze(text, test_pack(rule))
                self.assertEqual(result["strip"], expected)

    def test_negated_or_quoted_intensifier_is_kept(self):
        rules = rhetorlint.load_default_rules()
        cases = [
            "The risk is not extremely high, but it is not negligible.",
            "The update isn't hugely different.",
            "The update isn\u2019t hugely different.",
            "We are not deeply sorry.",
            "The risk cannot be extremely high.",
            "NOT EXTREMELY HIGH",
            "\"It was utterly devastating,\" the flood survivor told reporters.",
            "He said \u201cwe are deeply sorry\u201d and left.",
        ]
        for text in cases:
            with self.subTest(text=text):
                result = rhetorlint.analyze(text, rules)
                intensifiers = [
                    mark for mark in result["marks"] if mark["ruleId"] == "intensifier.loaded"
                ]
                self.assertEqual(len(intensifiers), 1, "preservation must not disable detection")
                self.assertEqual(result["strip"], text)
                self.assertEqual(rhetorlint.strip(text, result["marks"]), text)

    def test_unguarded_intensifier_is_still_removed(self):
        rules = rhetorlint.load_default_rules()
        cases = [
            (
                "This is an incredibly important update for every customer.",
                "This is an important update for every customer.",
            ),
            ("No doubt the team is extremely proud.", "No doubt the team is proud."),
            ("Not one bit: it is extremely clear.", "Not one bit: it is clear."),
            ("\"Fine,\" she said, extremely calmly.", "\"Fine,\" she said, calmly."),
            (
                "He said \u201chello\u201d and was extremely calm.",
                "He said \u201chello\u201d and was calm.",
            ),
            ("He said \"hello\nand it was extremely loud.", "He said \"hello\nand it was loud."),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(rhetorlint.analyze(text, rules)["strip"], expected)


class EngineLabelTests(unittest.TestCase):
    def test_engine_version_names_the_core_revision_it_reproduces(self):
        core = json.loads((ROOT / "packages" / "core" / "package.json").read_text(encoding="utf-8"))
        result = rhetorlint.analyze("marked", test_pack())
        self.assertEqual(result["engine"]["version"], core["version"])


class RewriteAdapterTests(unittest.TestCase):
    def setUp(self):
        self.rules = test_pack(lexical_rule("test.rewrite", ["marked"]))

    def test_sync_adapter_receives_text_and_deduped_marks(self):
        seen = {}

        def rewrite(text, marks):
            seen["text"] = text
            seen["marks"] = marks
            return "A checked rewrite."

        result = rhetorlint.analyze("marked", self.rules, rewrite=rewrite)
        self.assertEqual(result["rewrite"], "A checked rewrite.")
        self.assertEqual(seen["text"], "marked")
        self.assertEqual([mark["actual"] for mark in seen["marks"]], ["marked"])

    def test_adapter_cannot_mutate_canonical_marks_or_strip(self):
        self.rules["rules"][0]["expected"] = ["original"]

        def rewrite(_text, marks):
            marks[0]["actual"] = "changed"
            marks[0]["position"]["start"]["offset"] = 999
            self.rules["rules"][0]["expected"].append("poisoned")
            self.rules["id"] = "changed-pack"
            self.rules["version"] = "9.9.9"
            self.rules["locale"] = "de"
            marks.clear()
            return "A checked rewrite."

        result = rhetorlint.analyze("marked", self.rules, rewrite=rewrite)
        self.assertEqual([mark["actual"] for mark in result["marks"]], ["marked"])
        self.assertEqual(result["marks"][0]["position"]["start"]["offset"], 0)
        self.assertEqual(result["marks"][0]["expected"], ["original"])
        self.assertEqual(result["strip"], "marked")
        self.assertEqual(result["source"]["locale"], "en")
        self.assertEqual(result["engine"]["rules"], "test-pack@1")

    def test_non_string_adapter_result_is_rejected(self):
        with self.assertRaisesRegex(TypeError, "must return a string$"):
            rhetorlint.analyze("marked", self.rules, rewrite=lambda _text, _marks: None)

    def test_async_adapter_is_rejected(self):
        async def rewrite(_text, _marks):
            return "later"

        with self.assertRaisesRegex(TypeError, "synchronously; async adapters are not supported"):
            rhetorlint.analyze("marked", self.rules, rewrite=rewrite)

    def test_non_callable_value_is_ignored_like_javascript(self):
        result = rhetorlint.analyze("marked", self.rules, rewrite="not an adapter")
        self.assertIsNone(result["rewrite"])


if __name__ == "__main__":
    unittest.main()
