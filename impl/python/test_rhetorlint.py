"""Focused behavioral regressions for the Python reference engine."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rhetorlint  # noqa: E402


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
