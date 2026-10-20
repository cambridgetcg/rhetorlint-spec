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
            # A comma is not a break for strip's negator: only absolute.universal's
            # guard ends a negator's reach there.
            "It isn\u2019t, frankly, extremely high.",
            "We said no, extremely few agreed.",
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
            # The negator is the third word back: the window is two words.
            ("Not bad, and extremely cheap.", "Not bad, and cheap."),
            ("No doubt the team is extremely proud.", "No doubt the team is proud."),
            # The negator is the word before, but a clause break stands between them.
            *[
                ("We said no%s extremely few agreed." % brk, "We said no%s few agreed." % brk)
                for brk in ".;:!?"
            ],
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


def absolutes(text, rules):
    marks = rhetorlint.analyze(text, rules)["marks"]
    return [mark for mark in marks if mark["ruleId"] == "absolute.universal"]


class AbsoluteGuardTests(unittest.TestCase):
    def test_negated_absolute_and_imperative_never_are_unmarked(self):
        rules = rhetorlint.load_default_rules()
        cases = [
            "Returns are not guaranteed; past performance is no indicator.",
            "Results aren't always typical.",
            "Results aren\u2019t always typical.",
            "Not everyone qualifies.",
            "NOT EVERYONE QUALIFIES.",
            "The risk cannot always be priced.",
            "Never share your password with anyone.",
            "NEVER share it.",
            "Never\tshare it.",
            "\"Never share it,\" he said.",
            "Explain real constraints; never manufacture the shortage.",
            *["Check the link%s never click it." % brk for brk in ".;:!?"],
            # A negator followed directly by a comma reaches past the aside.
            "Past performance is not, however, always a guide.",
            "No, never.",
            # An adverb between 'Never' and its verb hands the decision to the verb.
            "Never ever share your password.",
            "Never again leave it unlocked.",
            "Never once doubt it.",
            # A word is compared whole: 'answer' is not 'an'.
            "Never answer it.",
        ]
        for text in cases:
            with self.subTest(text=text):
                self.assertEqual([mark["actual"] for mark in absolutes(text, rules)], [])

    def test_absolutes_the_guards_do_not_reach_stay_marked(self):
        rules = rhetorlint.load_default_rules()
        cases = [
            ("This is guaranteed to double your savings.", "guaranteed"),
            ("Everyone knows this policy works.", "Everyone"),
            ("Our product will always be the best choice.", "always"),
            # The negator is the third word back: the window is two words.
            ("Not bad, and always cheap.", "always"),
            # The negator is the word before, but a clause break stands between them.
            *[("We said no%s everyone agreed." % brk, "everyone") for brk in ".;:!?"],
            # 'never' that does not open its clause, or that no lowercase word follows.
            ("We never share data.", "never"),
            ("Love begins with choice, never obligation.", "never"),
            ("Never Again.", "Never"),
            ("Never.", "Never"),
            ("Never, ever.", "Never"),
            ("Never\nshare it.", "Never"),
            # A line break is not a clause break.
            ("We will\nnever share it.", "never"),
            # A comma ends a negator's reach once a word stands between them.
            ("No risk, guaranteed.", "guaranteed"),
            ("Don't wait, everyone is buying.", "everyone"),
            ("No fees, always free.", "always"),
            ("No contracts, no fees, no exceptions.", "no exceptions"),
            # A clause-initial 'Never' before a word that cannot be its verb is a
            # fragment or an inversion.
            ("Battery life? Never an issue.", "Never"),
            ("Never again will prices be this low.", "Never"),
            ("Never has a product been this good.", "Never"),
            ("Never before have prices been this low.", "Never"),
            ("Never again.", "Never"),
            ("Never ever again.", "Never"),
            ("Never again\nshare it.", "Never"),
        ]
        for text, actual in cases:
            with self.subTest(text=text):
                marks = absolutes(text, rules)
                self.assertEqual([mark["actual"] for mark in marks], [actual])
                start = marks[0]["position"]["start"]["offset"]
                end = marks[0]["position"]["end"]["offset"]
                self.assertEqual(text[start:end], actual)
        # The guard reads absolute.universal only: other rules keep their marks under a negator.
        marks = rhetorlint.analyze("It is not world-class.", rules)["marks"]
        self.assertTrue(any(mark["ruleId"] == "puffery.peacock" for mark in marks))

    def test_guard_lists_are_the_spec_words(self):
        # spec/guard-lexicon.json is the one source; scripts/gen-agency-lexicon.mjs
        # writes it here, and an added or dropped word fails this exactly.
        guard = json.loads((ROOT / "spec" / "guard-lexicon.json").read_text(encoding="utf-8"))
        agency = json.loads((ROOT / "spec" / "agency-lexicon.json").read_text(encoding="utf-8"))
        # One vocabulary: the agency lexicon's negators and the guards' local ones.
        self.assertEqual(rhetorlint._NEGATORS, frozenset(agency["negators"] + guard["localNegators"]))
        self.assertTrue(rhetorlint.AGENCY_NEGATORS <= rhetorlint._NEGATORS)
        self.assertEqual(rhetorlint._CLAUSE_BREAKS, frozenset(guard["clauseBreaks"]))
        self.assertEqual(rhetorlint._NEVER_NON_VERBS, frozenset(guard["neverNonVerbs"]))
        self.assertEqual(rhetorlint._NEVER_PASS_THROUGH, frozenset(guard["neverPassThrough"]))

    def test_each_guard_negator_keeps_an_intensifier_and_an_absolute(self):
        rules = rhetorlint.load_default_rules()
        for negator in sorted(rhetorlint._NEGATORS):
            with self.subTest(negator=negator):
                text = "It was %s extremely bad." % negator
                self.assertEqual(rhetorlint.analyze(text, rules)["strip"], text)
                marks = absolutes("It is %s always so." % negator, rules)
                self.assertEqual([m["actual"] for m in marks if m["actual"] == "always"], [])

    def test_word_after_never_is_read_against_two_closed_lists(self):
        # The imperative 'Never' guard's two closed lists, and the advice openers
        # left off them, from spec/guard-lexicon.json.
        guard = json.loads((ROOT / "spec" / "guard-lexicon.json").read_text(encoding="utf-8"))
        non_verbs = guard["neverNonVerbs"]
        pass_through = guard["neverPassThrough"]
        # Words that can begin advice after "Never", so they are not on the list.
        advice_openers = guard["neverAdviceOpeners"]
        rules = rhetorlint.load_default_rules()

        def actuals(text):
            return [mark["actual"] for mark in absolutes(text, rules)]

        for word in non_verbs:
            with self.subTest(word=word):
                self.assertEqual(actuals("Never %s x." % word), ["Never"])
                # After its lowercase first letter, the word is compared in ASCII
                # lower case: "hAS" is "has".
                mixed = word[0] + word[1:].upper()
                self.assertEqual(actuals("Go; never %s x." % mixed), ["never"])
        for word in advice_openers:
            with self.subTest(word=word):
                self.assertEqual(actuals("Never %s x." % word), [])
        for text in [
            "Never at any time disclose your password.",
            "Never in any circumstances share your PIN.",
            "Never on any account reply to this email.",
            "Never have more than two drinks.",
            "Never so much as glance at it.",
            "Never should you share your password.",
        ]:
            with self.subTest(text=text):
                self.assertEqual(actuals(text), [])
        for adverb in pass_through:
            with self.subTest(adverb=adverb):
                self.assertEqual(actuals("Never %s share it." % adverb), [])
                self.assertEqual(actuals("Never %s %s share it." % (adverb, pass_through[0])), [])
                for word in non_verbs:
                    self.assertEqual(actuals("Never %s %s x." % (adverb, word)), ["Never"], word)
                self.assertEqual(actuals("Never %s." % adverb), ["Never"])
                self.assertEqual(actuals("Never %s Share it." % adverb), ["Never"])


def agency_spans(text, rules):
    marks = rhetorlint.analyze(text, rules)["marks"]
    return [
        (mark["actual"], mark["position"]["start"]["offset"], mark["position"]["end"]["offset"])
        for mark in marks
        if mark["ruleId"] == "agency-hiding.deleted-subject"
    ]


class AgencyDetectorTests(unittest.TestCase):
    def test_accountable_past_passives_are_marked_auxiliary_through_participle(self):
        rules = rhetorlint.load_default_rules()
        cases = [
            ("Mistakes were made.", "were made"),
            ("Mistakes, frankly, were made.", "were made"),
            ("Customer data was quietly accessed.", "was quietly accessed"),
            ("Your data was shared with partners.", "was shared"),
            ("PII may have been compromised.", "been compromised"),
            ("Records were withheld from investigators.", "were withheld"),
            ("It was decided that the program would end.", "was decided"),
            ("Hundreds of workers were laid off.", "were laid off"),
            ("Additional safeguards have been put in place.", "been put"),
            ("Concerns were raised about the audit.", "were raised"),
            ("MISTAKES WERE MADE.", "WERE MADE"),
        ]
        for text, actual in cases:
            with self.subTest(text=text):
                at = text.index(actual)
                self.assertEqual(agency_spans(text, rules), [(actual, at, at + len(actual))])

    def test_procedure_named_agents_harm_verbs_and_idioms_stay_unmarked(self):
        rules = rhetorlint.load_default_rules()
        for text in [
            "My name is Fred.",
            "JavaScript is required.",
            "Soil water content was measured at 5 cm depth.",
            "The soup can be frozen for up to 3 months.",
            "This option is ignored when the flag is unset.",
            "The startup has been described as the next big thing by Forbes.",
            "The report was shelved by Friday.",
            "Lives were lost in the earthquake.",
            "Your account was closed at your request.",
            "He got fired up about the album.",
            "Data were collected from 200 participants.",
            "Information was collected via a survey.",
            "Records were retained for seven years.",
            "If no error was raised, the call succeeded.",
            "Records were being withheld.",
            "Mistakes were made\nby the board.",
            # U+212A KELVIN SIGN and U+017F LONG S fold to ASCII under a
            # case-insensitive \w; "hacked" and "shared" are lexicon participles.
            "Mistakes were\u00a0made.",
            "Accounts were hac\u212aed.",
            "Your data was \u017fhared.",
        ]:
            with self.subTest(text=text):
                self.assertEqual(agency_spans(text, rules), [])

    def test_negated_passives_and_unheld_affected_stay_unmarked(self):
        """A negator anywhere in the clause before the auxiliary (in the chain,
        as the head word or before it, however long the subject) denies the
        act; 'affected' and 'impacted' need a head held in trust for someone
        (data, an account)."""
        rules = rhetorlint.load_default_rules()
        for text in [
            "Your data was never sold.",
            "Your information has never been sold.",
            "Passwords have not been compromised.",
            "Passwords haven't been compromised.",
            "Passwords haven\u2019t been compromised.",
            "No customer data was accessed.",
            "Nothing was withheld from investigators.",
            "None of the records were leaked.",
            "Neither passwords nor card numbers were exposed.",
            "No mistakes have been made.",
            "No personal, financial or health information was accessed.",
            "We do not believe their information has been stolen.",
            "No credit card numbers, bank account details or passwords were stolen.",
            "No Social Security numbers or other sensitive personal information were exposed.",
            "No a b c d e mistakes were made.",
            # A comma starts no clause, so this act goes unmarked too: a recorded miss.
            "No one called, but data were stolen.",
            "Twelve patients were affected.",
            "Roughly 2,000 flights were impacted after the storm.",
        ]:
            with self.subTest(text=text):
                self.assertEqual(agency_spans(text, rules), [])
        for text, actual in [
            ("Approximately 4,000 accounts may have been affected.", "been affected"),
            ("Your personal information may have been impacted.", "been impacted"),
            # A negator behind a head stop, in an earlier clause, or after the
            # passive it would deny, is not read.
            ("No: mistakes were made.", "were made"),
            ("No one called; data were stolen.", "were stolen"),
            ("No one called\ndata were stolen.", "were stolen"),
            ("Data was accessed and no records were leaked.", "was accessed"),
            ("No data was accessed. Records were leaked.", "were leaked"),
        ]:
            with self.subTest(text=text):
                at = text.index(actual)
                self.assertEqual(agency_spans(text, rules), [(actual, at, at + len(actual))])
        # The reader searches from where it stopped, so its lookbehinds must
        # read before that point: an n't contraction needs "n" and an
        # apostrophe right before its "t", a "t" that opens the text has
        # neither, and a negator's letters inside a longer word are no negator.
        for low, want in [
            ("data hasn't been accessed", True),
            ("data hasn\u2019t been accessed", True),
            ("data has't been accessed", False),
            ("t been accessed", False),
            ("xno data was accessed", False),
            ("no_data was accessed", False),
            ("nothing was withheld", True),
        ]:
            with self.subTest(low=low):
                index = low.index("been") if "been" in low else low.index("was")
                read = rhetorlint._agency_negation_reader(low)
                self.assertEqual(read(index), want)
        # Read in steps, as the detector does: a head stop between two passives
        # starts a new clause, and a negator before the first carries to the second.
        low = "no data was accessed and records were leaked. records were leaked."
        read = rhetorlint._agency_negation_reader(low)
        self.assertEqual([read(low.index("was")), read(low.index("were")), read(low.rindex("were"))],
                         [True, True, False])

    def test_guards_read_at_the_participle_not_at_the_start_of_the_text(self):
        """Regression pin for a Python-only bug in an earlier prototype: a
        '^'-anchored pattern applied through pattern.match(text, pos) never
        matches at pos > 0, so the 'in place' requirement never held and the
        'exposed to' guard never fired. Every guard reads at the participle's
        end, which is never 0, so each must be seen to work there. (That a
        '^' pattern's match(text, pos) fails for any pos > 0 is the standard
        library's documented behaviour, so it is said here, not tested.)"""
        rules = rhetorlint.load_default_rules()
        self.assertEqual(
            [span[0] for span in agency_spans("Additional safeguards have been put in place.", rules)],
            ["been put"],
        )
        self.assertEqual(agency_spans("Safeguards were put in a box.", rules), [])
        self.assertEqual(agency_spans("Workers were exposed to asbestos.", rules), [])
        self.assertEqual(
            [span[0] for span in agency_spans("Customer records were exposed.", rules)],
            ["were exposed"],
        )
        low = "x safeguards were put in place."
        self.assertTrue(rhetorlint._agency_phrase_follows(low, low.index(" in"), "in place"))
        self.assertFalse(rhetorlint._agency_phrase_follows(low, low.index("in"), "in place"))
        self.assertTrue(rhetorlint._agency_by_follows("x were made by them", len("x were made")))

    def test_generated_lexicon_matches_the_spec(self):
        lexicon = json.loads((ROOT / "spec" / "agency-lexicon.json").read_text(encoding="utf-8"))
        self.assertEqual(list(rhetorlint.AGENCY_AUXILIARIES), lexicon["auxiliaries"])
        self.assertEqual(sorted(rhetorlint.AGENCY_NEGATORS), lexicon["negators"])
        self.assertEqual(
            (rhetorlint.AGENCY_WHITESPACE, rhetorlint.AGENCY_HEAD_STOPS, rhetorlint.AGENCY_CLAUSE_BREAKS),
            (lexicon["whitespace"], lexicon["headStops"], lexicon["clauseBreaks"]),
        )
        self.assertEqual(sorted(rhetorlint.AGENCY_SKIP), lexicon["skip"])
        self.assertEqual(
            {name: sorted(words) for name, words in rhetorlint.AGENCY_HEADS.items()},
            lexicon["heads"],
        )
        self.assertEqual(
            [(cls, head, list(participles)) for cls, head, participles in rhetorlint.AGENCY_CLASSES],
            [(c["id"], c["head"] or "", c["participles"]) for c in lexicon["classes"]],
        )


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
