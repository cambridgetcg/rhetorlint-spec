package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
)

// flatMark is the comparable projection stored in conformance/cases.json.
type flatMark struct {
	RuleID     string   `json:"ruleId"`
	Family     string   `json:"family"`
	Technique  string   `json:"technique"`
	Actual     string   `json:"actual"`
	Start      int      `json:"start"`
	End        int      `json:"end"`
	Note       string   `json:"note"`
	Confidence float64  `json:"confidence"`
	Level      string   `json:"level"`
	Expected   []string `json:"expected"`
}

type density struct {
	Tells       int     `json:"tells"`
	Per100Words float64 `json:"per100Words"`
}

type confCase struct {
	Input   string     `json:"input"`
	Density density    `json:"density"`
	Strip   string     `json:"strip"`
	Marks   []flatMark `json:"marks"`
}

func repoRoot() string {
	_, self, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(self), "..", "..")
}

func flatten(r Result) (density, string, []flatMark) {
	fm := make([]flatMark, 0, len(r.Marks))
	for _, m := range r.Marks {
		fm = append(fm, flatMark{
			RuleID: m.RuleID, Family: m.Family, Technique: m.Technique, Actual: m.Actual,
			Start: m.Position.Start.Offset, End: m.Position.End.Offset,
			Note: m.Note, Confidence: m.Confidence, Level: m.Level, Expected: m.Expected,
		})
	}
	return r.Density, r.Strip, fm
}

func TestConformance(t *testing.T) {
	root := repoRoot()
	corpusRaw, err := os.ReadFile(filepath.Join(root, "conformance", "cases.json"))
	if err != nil {
		t.Fatalf("read cases.json: %v", err)
	}
	var corpus struct {
		Cases []confCase `json:"cases"`
	}
	if err := json.Unmarshal(corpusRaw, &corpus); err != nil {
		t.Fatalf("parse cases.json: %v", err)
	}
	pack, err := LoadDefaultRules()
	if err != nil {
		t.Fatalf("load rules: %v", err)
	}
	if len(corpus.Cases) < 8 {
		t.Fatalf("corpus too small: %d", len(corpus.Cases))
	}

	for i, c := range corpus.Cases {
		d, strip, marks := flatten(Analyze(c.Input, pack))
		if d.Tells != c.Density.Tells || math.Abs(d.Per100Words-c.Density.Per100Words) > 1e-9 {
			t.Errorf("case %d density: got %+v want %+v", i, d, c.Density)
		}
		if strip != c.Strip {
			t.Errorf("case %d strip:\n got  %q\n want %q", i, strip, c.Strip)
		}
		if len(marks) != len(c.Marks) {
			t.Errorf("case %d mark count: got %d want %d", i, len(marks), len(c.Marks))
			continue
		}
		for j := range marks {
			g, w := marks[j], c.Marks[j]
			if g.RuleID != w.RuleID || g.Start != w.Start || g.End != w.End ||
				g.Actual != w.Actual || g.Family != w.Family || g.Technique != w.Technique ||
				g.Note != w.Note || g.Level != w.Level ||
				!reflect.DeepEqual(g.Expected, w.Expected) ||
				math.Abs(g.Confidence-w.Confidence) > 1e-9 {
				t.Errorf("case %d mark %d:\n got  %+v\n want %+v", i, j, g, w)
			}
		}
	}
	t.Logf("go conformance: %d/%d cases checked against the ground truth", len(corpus.Cases), len(corpus.Cases))
}

func testPack(rule Rule) RulePack {
	return RulePack{
		ID: "test-pack", Version: "1", Locale: "en",
		Rules: []Rule{rule},
	}
}

func markActuals(result Result) []string {
	actuals := make([]string, len(result.Marks))
	for i, mark := range result.Marks {
		actuals[i] = mark.Actual
	}
	return actuals
}

func TestMatcherUsesCurrentDefinition(t *testing.T) {
	t.Run("changed lexical terms", func(t *testing.T) {
		rule := Rule{RuleID: "test.cache.lexical", Family: "test", Type: "lexical", Terms: []string{"alpha"}}
		Analyze("alpha beta", testPack(rule))

		rule.Terms = []string{"beta"}
		got := markActuals(Analyze("alpha beta", testPack(rule)))
		if !reflect.DeepEqual(got, []string{"beta"}) {
			t.Fatalf("changed terms reused the old matcher: got %v want [beta]", got)
		}
	})

	t.Run("changed pattern", func(t *testing.T) {
		rule := Rule{RuleID: "test.cache.pattern", Family: "test", Type: "pattern", Pattern: `\balpha\b`}
		Analyze("alpha beta", testPack(rule))

		rule.Pattern = `\bbeta\b`
		got := markActuals(Analyze("alpha beta", testPack(rule)))
		if !reflect.DeepEqual(got, []string{"beta"}) {
			t.Fatalf("changed pattern reused the old matcher: got %v want [beta]", got)
		}
	})

	t.Run("changed case sensitivity", func(t *testing.T) {
		rule := Rule{
			RuleID: "test.cache.case", Family: "test", Type: "pattern",
			Pattern: "alpha", CaseSensitive: true,
		}
		Analyze("alpha", testPack(rule))

		rule.CaseSensitive = false
		got := markActuals(Analyze("ALPHA", testPack(rule)))
		if !reflect.DeepEqual(got, []string{"ALPHA"}) {
			t.Fatalf("changed case setting reused the old matcher: got %v want [ALPHA]", got)
		}
	})
}

func TestAnalyzeConcurrentMatchers(t *testing.T) {
	const workers = 48
	const iterations = 40

	start := make(chan struct{})
	errs := make(chan string, workers)
	var wg sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		term := fmt.Sprintf("term-%d", worker)
		rule := Rule{
			RuleID: "test.cache.concurrent", Family: "test", Type: "lexical",
			Terms: []string{term},
		}
		pack := testPack(rule)
		wg.Add(1)
		go func(term string, pack RulePack) {
			defer wg.Done()
			<-start
			for i := 0; i < iterations; i++ {
				got := markActuals(Analyze(term, pack))
				if !reflect.DeepEqual(got, []string{term}) {
					errs <- fmt.Sprintf("matcher for %q produced %v", term, got)
					return
				}
			}
		}(term, pack)
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestLexicalTermsPreferLongestWithoutMutation(t *testing.T) {
	terms := []string{"kind", "kind of"}
	rule := Rule{
		RuleID: "test.lexical.longest", Family: "test", Type: "lexical",
		Terms: terms,
	}
	got := markActuals(Analyze("It is kind of difficult.", testPack(rule)))
	if !reflect.DeepEqual(got, []string{"kind of"}) {
		t.Fatalf("overlapping terms: got %v want [kind of]", got)
	}
	if !reflect.DeepEqual(terms, []string{"kind", "kind of"}) {
		t.Fatalf("matcher reordered the authored terms: %v", terms)
	}
}

// Smart punctuation must not silence a tell. rules-en spells the typographic
// variants in the pack; these twelve probes mirror test/typography.test.mjs and
// impl/python/test_rhetorlint.py (ruleId and actual only: offsets are bytes
// here, so non-ASCII probes stay out of conformance/cases.json).
func TestTypographyProbes(t *testing.T) {
	pack, err := LoadDefaultRules()
	if err != nil {
		t.Fatalf("load rules: %v", err)
	}
	probes := []struct{ text, ruleID, actual string }{
		{"Let\u2019s not forget their record.", "deflection.whataboutism", "Let\u2019s not forget"},
		{"Don\u2019t miss out on this deal.", "urgency.appeal-to-time", "Don\u2019t miss out"},
		{"It\u2019s worth noting the date.", "editorializing.stance", "It\u2019s worth noting"},
		{"He didn\u2019t even bother to reply.", "implicative.shortfall", "didn\u2019t even bother to"},
		{"Try it risk\u2011free today.", "lure.free-offer", "risk\u2011free"},
		{"These so\u2011called experts.", "distancing.doubt-marker", "so\u2011called"},
		{"An officer\u2013involved shooting.", "exoneration.formula", "officer\u2013involved shooting"},
		{"A world\u2011class team.", "puffery.peacock", "world\u2011class"},
		{"Sources with first\u2011hand knowledge of the matter.", "sourcing.anonymous", "Sources with first\u2011hand knowledge of the matter"},
		{"It\u2019s important to note the timing.", "editorializing.stance", "It\u2019s important to note"},
		{"Act before it\u2019s too late.", "urgency.appeal-to-time", "before it\u2019s too late"},
		{"A self\u2011proclaimed expert.", "distancing.doubt-marker", "self\u2011proclaimed"},
	}
	for _, p := range probes {
		var got [][2]string
		for _, m := range Analyze(p.text, pack).Marks {
			got = append(got, [2]string{m.RuleID, m.Actual})
		}
		want := [][2]string{{p.ruleID, p.actual}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%q: got %q want %q", p.text, got, want)
		}
	}
}

func TestAnalyzeDetachesExpectedMetadataFromPack(t *testing.T) {
	expected := []string{"original"}
	rule := Rule{
		RuleID: "test.expected.detached", Family: "test", Type: "lexical",
		Terms: []string{"marked"}, Expected: expected,
	}
	result := Analyze("marked", testPack(rule))
	expected[0] = "poisoned"
	rule.Expected[0] = "also poisoned"
	if !reflect.DeepEqual(result.Marks[0].Expected, []string{"original"}) {
		t.Fatalf("result expected metadata aliases pack: %v", result.Marks[0].Expected)
	}
}

func TestStripSemanticBoundaryAndIdentity(t *testing.T) {
	t.Run("no marks is exact identity", func(t *testing.T) {
		text := "  Untouched  text.\n"
		got := Analyze(text, RulePack{ID: "empty", Version: "1", Locale: "en"}).Strip
		if got != text {
			t.Fatalf("no-op strip changed text: got %q want %q", got, text)
		}
	})

	t.Run("modal hedge is marked but preserved", func(t *testing.T) {
		text := "It  may be true.\n"
		rule := Rule{
			RuleID: "hedge.deniable", Family: "hedge", Type: "lexical",
			Terms: []string{"may"},
		}
		result := Analyze(text, testPack(rule))
		if len(result.Marks) != 1 {
			t.Fatalf("expected hedge mark, got %d", len(result.Marks))
		}
		if result.Strip != text {
			t.Fatalf("strip changed modal truth conditions: got %q want %q", result.Strip, text)
		}
	})

	t.Run("lexical intensifier remains removable", func(t *testing.T) {
		rule := Rule{
			RuleID: "intensifier.loaded", Family: "intensifier", Type: "lexical",
			Terms: []string{"extremely"},
		}
		cases := []struct {
			input, want string
		}{
			{"It is extremely clear.", "It is clear."},
			{"A  extremely   careful claim.\nSecond  line.", "A careful claim.\nSecond  line."},
			{"A extremely, careful claim.", "A, careful claim."},
			{"A, extremely, careful claim.", "A, careful claim."},
			{"Careful, extremely", "Careful,"},
			{"Careful extremely", "Careful"},
			{"Extremely careful", "careful"},
			{"A extremely\nNext  line.", "A\nNext  line."},
			{"A\nextremely clear", "A\nclear"},
		}
		for _, test := range cases {
			if got := Analyze(test.input, testPack(rule)).Strip; got != test.want {
				t.Errorf("strip intensifier from %q: got %q want %q", test.input, got, test.want)
			}
		}
	})
}

func TestStripKeepsNegatedOrQuotedIntensifier(t *testing.T) {
	pack, err := LoadDefaultRules()
	if err != nil {
		t.Fatalf("load rules: %v", err)
	}
	t.Run("negated or quoted intensifier is kept", func(t *testing.T) {
		for _, text := range []string{
			"The risk is not extremely high, but it is not negligible.",
			"The update isn't hugely different.",
			"The update isn\u2019t hugely different.",
			"We are not deeply sorry.",
			"The risk cannot be extremely high.",
			"NOT EXTREMELY HIGH",
			"\"It was utterly devastating,\" the flood survivor told reporters.",
			"He said \u201cwe are deeply sorry\u201d and left.",
			// A comma is not a break for Strip's negator: only absolute.universal's
			// guard ends a negator's reach there.
			"It isn\u2019t, frankly, extremely high.",
			"We said no, extremely few agreed.",
		} {
			result := Analyze(text, pack)
			intensifiers := 0
			for _, mark := range result.Marks {
				if mark.RuleID == "intensifier.loaded" {
					intensifiers++
				}
			}
			if intensifiers != 1 {
				t.Errorf("%q: %d intensifier marks, want 1 (preservation must not disable detection)", text, intensifiers)
			}
			if result.Strip != text {
				t.Errorf("strip changed %q: got %q", text, result.Strip)
			}
			if got := Strip(text, result.Marks); got != text {
				t.Errorf("Strip changed %q: got %q", text, got)
			}
		}
	})

	t.Run("unguarded intensifier is still removed", func(t *testing.T) {
		tests := []struct{ input, want string }{
			{"This is an incredibly important update for every customer.", "This is an important update for every customer."},
			// The negator is the third word back: the window is two words.
			{"Not bad, and extremely cheap.", "Not bad, and cheap."},
			{"No doubt the team is extremely proud.", "No doubt the team is proud."},
			{"\"Fine,\" she said, extremely calmly.", "\"Fine,\" she said, calmly."},
			{"He said \u201chello\u201d and was extremely calm.", "He said \u201chello\u201d and was calm."},
			{"He said \"hello\nand it was extremely loud.", "He said \"hello\nand it was loud."},
		}
		// The negator is the word before, but a clause break stands between them.
		for _, brk := range []string{".", ";", ":", "!", "?"} {
			tests = append(tests, struct{ input, want string }{
				"We said no" + brk + " extremely few agreed.", "We said no" + brk + " few agreed.",
			})
		}
		for _, test := range tests {
			if got := Analyze(test.input, pack).Strip; got != test.want {
				t.Errorf("strip %q: got %q want %q", test.input, got, test.want)
			}
		}
	})
}

func absoluteActuals(text string, pack RulePack) ([]string, []Mark) {
	actuals := []string{}
	var marks []Mark
	for _, mark := range Analyze(text, pack).Marks {
		if mark.RuleID == "absolute.universal" {
			actuals = append(actuals, mark.Actual)
			marks = append(marks, mark)
		}
	}
	return actuals, marks
}

func TestAbsoluteGuard(t *testing.T) {
	pack, err := LoadDefaultRules()
	if err != nil {
		t.Fatalf("load rules: %v", err)
	}
	t.Run("negated absolute and imperative never are unmarked", func(t *testing.T) {
		texts := []string{
			"Returns are not guaranteed; past performance is no indicator.",
			"Results aren't always typical.",
			"Results aren’t always typical.",
			"Not everyone qualifies.",
			"NOT EVERYONE QUALIFIES.",
			"The risk cannot always be priced.",
			"Never share your password with anyone.",
			"NEVER share it.",
			"Never\tshare it.",
			"\"Never share it,\" he said.",
			"Explain real constraints; never manufacture the shortage.",
			// A negator followed directly by a comma reaches past the aside.
			"Past performance is not, however, always a guide.",
			"No, never.",
			// An adverb between 'Never' and its verb hands the decision to the verb.
			"Never ever share your password.",
			"Never again leave it unlocked.",
			"Never once doubt it.",
			// A word is compared whole: 'answer' is not 'an'.
			"Never answer it.",
		}
		for _, brk := range []string{".", ";", ":", "!", "?"} {
			texts = append(texts, "Check the link"+brk+" never click it.")
		}
		for _, text := range texts {
			if actuals, _ := absoluteActuals(text, pack); len(actuals) != 0 {
				t.Errorf("%q: absolute.universal marks %q, want none", text, actuals)
			}
		}
	})

	t.Run("absolutes the guards do not reach stay marked", func(t *testing.T) {
		tests := []struct{ input, actual string }{
			{"This is guaranteed to double your savings.", "guaranteed"},
			{"Everyone knows this policy works.", "Everyone"},
			{"Our product will always be the best choice.", "always"},
			// The negator is the third word back: the window is two words.
			{"Not bad, and always cheap.", "always"},
			// 'never' that does not open its clause, or that no lowercase word follows.
			{"We never share data.", "never"},
			{"Love begins with choice, never obligation.", "never"},
			{"Never Again.", "Never"},
			{"Never.", "Never"},
			{"Never, ever.", "Never"},
			{"Never\nshare it.", "Never"},
			// A line break is not a clause break.
			{"We will\nnever share it.", "never"},
			// A comma ends a negator's reach once a word stands between them.
			{"No risk, guaranteed.", "guaranteed"},
			{"Don't wait, everyone is buying.", "everyone"},
			{"No fees, always free.", "always"},
			{"No contracts, no fees, no exceptions.", "no exceptions"},
			// A clause-initial 'Never' before a word that cannot be its verb is a
			// fragment or an inversion.
			{"Battery life? Never an issue.", "Never"},
			{"Never again will prices be this low.", "Never"},
			{"Never has a product been this good.", "Never"},
			{"Never before have prices been this low.", "Never"},
			{"Never again.", "Never"},
			{"Never ever again.", "Never"},
			{"Never again\nshare it.", "Never"},
		}
		// The negator is the word before, but a clause break stands between them.
		for _, brk := range []string{".", ";", ":", "!", "?"} {
			tests = append(tests, struct{ input, actual string }{"We said no" + brk + " everyone agreed.", "everyone"})
		}
		for _, test := range tests {
			actuals, marks := absoluteActuals(test.input, pack)
			if len(actuals) != 1 || actuals[0] != test.actual {
				t.Errorf("%q: absolute.universal marks %q, want [%q]", test.input, actuals, test.actual)
				continue
			}
			start, end := marks[0].Position.Start.Offset, marks[0].Position.End.Offset
			if test.input[start:end] != test.actual {
				t.Errorf("%q: mark spans %q, want %q", test.input, test.input[start:end], test.actual)
			}
		}
		// The guard reads absolute.universal only: other rules keep their marks under a negator.
		peacock := false
		for _, mark := range Analyze("It is not world-class.", pack).Marks {
			peacock = peacock || mark.RuleID == "puffery.peacock"
		}
		if !peacock {
			t.Errorf("puffery.peacock lost its mark under a negator")
		}
	})

	t.Run("the word after a clause-initial never is read against two closed lists", func(t *testing.T) {
		// The imperative 'Never' guard's two closed lists, declared here so an
		// engine that drops or adds a word fails.
		nonVerbs := []string{
			"a", "an", "the", "any", "before", "so", "such", "in", "at", "on",
			"has", "have", "had", "is", "are", "was", "were", "will", "would", "could",
			"should", "can", "did", "does", "been", "being",
		}
		passThrough := []string{"again", "ever", "once"}
		expect := func(text string, want ...string) {
			t.Helper()
			actuals, _ := absoluteActuals(text, pack)
			if len(actuals) != len(want) || (len(want) == 1 && actuals[0] != want[0]) {
				t.Errorf("%q: absolute.universal marks %q, want %q", text, actuals, want)
			}
		}
		for _, word := range nonVerbs {
			expect("Never "+word+" x.", "Never")
			// After its lowercase first letter, the word is compared in ASCII
			// lower case: "hAS" is "has".
			expect("Go; never "+word[:1]+strings.ToUpper(word[1:])+" x.", "never")
		}
		for _, adverb := range passThrough {
			expect("Never " + adverb + " share it.")
			expect("Never " + adverb + " " + passThrough[0] + " share it.")
			for _, word := range nonVerbs {
				expect("Never "+adverb+" "+word+" x.", "Never")
			}
			expect("Never "+adverb+".", "Never")
			expect("Never "+adverb+" Share it.", "Never")
		}
	})
}

func agencySpans(text string, pack RulePack) []string {
	var out []string
	for _, m := range Analyze(text, pack).Marks {
		if m.RuleID == "agency-hiding.deleted-subject" {
			out = append(out, fmt.Sprintf("%s@%d-%d", m.Actual, m.Position.Start.Offset, m.Position.End.Offset))
		}
	}
	return out
}

func TestAgencyDetector(t *testing.T) {
	pack, err := LoadDefaultRules()
	if err != nil {
		t.Fatalf("load rules: %v", err)
	}
	t.Run("accountable past passives are marked auxiliary through participle", func(t *testing.T) {
		cases := [][2]string{
			{"Mistakes were made.", "were made"},
			{"Mistakes, frankly, were made.", "were made"},
			{"Customer data was quietly accessed.", "was quietly accessed"},
			{"Your data was shared with partners.", "was shared"},
			{"PII may have been compromised.", "been compromised"},
			{"Records were withheld from investigators.", "were withheld"},
			{"It was decided that the program would end.", "was decided"},
			{"Hundreds of workers were laid off.", "were laid off"},
			{"Additional safeguards have been put in place.", "been put"},
			{"Concerns were raised about the audit.", "were raised"},
			{"MISTAKES WERE MADE.", "WERE MADE"},
			{"Customer records were exposed.", "were exposed"},
		}
		for _, c := range cases {
			at := strings.Index(c[0], c[1])
			want := []string{fmt.Sprintf("%s@%d-%d", c[1], at, at+len(c[1]))}
			if got := agencySpans(c[0], pack); !reflect.DeepEqual(got, want) {
				t.Errorf("%q: agency marks %q, want %q", c[0], got, want)
			}
		}
	})

	t.Run("procedure, named agents, harm verbs and idioms stay unmarked", func(t *testing.T) {
		for _, text := range []string{
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
			"Safeguards were put in a box.",
			"Workers were exposed to asbestos.",
			"Mistakes were made\nby the board.",
			// RE2's (?i)\w would fold U+212A and U+017F into a participle; the
			// detector matches an ASCII-lowercased copy with no (?i), so neither
			// does, and a no-break space joins no words.
			"Mistakes were made.",
			"Civilians were Killed.",
			"Your data was ſhared.",
		} {
			if got := agencySpans(text, pack); len(got) != 0 {
				t.Errorf("%q: agency marks %q, want none", text, got)
			}
		}
	})

	t.Run("negated passives and 'affected' after an unheld noun stay unmarked", func(t *testing.T) {
		for _, text := range []string{
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
			"Twelve patients were affected.",
			"Roughly 2,000 flights were impacted after the storm.",
		} {
			if got := agencySpans(text, pack); len(got) != 0 {
				t.Errorf("%q: agency marks %q, want none", text, got)
			}
		}
		for _, c := range [][2]string{
			{"Approximately 4,000 accounts may have been affected.", "been affected"},
			{"Your personal information may have been impacted.", "been impacted"},
			{"No: mistakes were made.", "were made"},
			{"No a b c d e mistakes were made.", "were made"},
		} {
			at := strings.Index(c[0], c[1])
			want := []string{fmt.Sprintf("%s@%d-%d", c[1], at, at+len(c[1]))}
			if got := agencySpans(c[0], pack); !reflect.DeepEqual(got, want) {
				t.Errorf("%q: agency marks %q, want %q", c[0], got, want)
			}
		}
	})

	t.Run("the generated lexicon matches the spec", func(t *testing.T) {
		raw, err := os.ReadFile(filepath.Join(repoRoot(), "spec", "agency-lexicon.json"))
		if err != nil {
			t.Fatalf("read spec/agency-lexicon.json: %v", err)
		}
		var lex struct {
			Whitespace    string              `json:"whitespace"`
			HeadStops     string              `json:"headStops"`
			ClauseBreaks  string              `json:"clauseBreaks"`
			Negators      []string            `json:"negators"`
			NegatorWindow int                 `json:"negatorWindow"`
			Auxiliaries   []string            `json:"auxiliaries"`
			Heads         map[string][]string `json:"heads"`
			Classes       []struct {
				ID          string   `json:"id"`
				Head        *string  `json:"head"`
				Participles []string `json:"participles"`
			} `json:"classes"`
		}
		if err := json.Unmarshal(raw, &lex); err != nil {
			t.Fatalf("parse spec/agency-lexicon.json: %v", err)
		}
		if !reflect.DeepEqual(agencyAuxiliaries, lex.Auxiliaries) {
			t.Errorf("auxiliaries %q, spec %q", agencyAuxiliaries, lex.Auxiliaries)
		}
		if agencyWhitespace != lex.Whitespace || agencyHeadStops != lex.HeadStops || agencyClauseBreaks != lex.ClauseBreaks {
			t.Errorf("character sets %q %q %q, spec %q %q %q", agencyWhitespace, agencyHeadStops, agencyClauseBreaks,
				lex.Whitespace, lex.HeadStops, lex.ClauseBreaks)
		}
		if agencyNegatorWindow != lex.NegatorWindow || len(agencyNegators) != len(lex.Negators) {
			t.Errorf("negators %v (window %d), spec %q (window %d)", agencyNegators, agencyNegatorWindow, lex.Negators, lex.NegatorWindow)
		}
		for _, w := range lex.Negators {
			if !agencyNegators[w] {
				t.Errorf("negators lack %q", w)
			}
		}
		for name, words := range lex.Heads {
			if len(agencyHeads[name]) != len(words) {
				t.Errorf("head class %s: %d words, spec %d", name, len(agencyHeads[name]), len(words))
			}
			for _, w := range words {
				if !agencyHeads[name][w] {
					t.Errorf("head class %s lacks %q", name, w)
				}
			}
		}
		if len(agencyClasses) != len(lex.Classes) {
			t.Fatalf("%d classes, spec %d", len(agencyClasses), len(lex.Classes))
		}
		for i, c := range lex.Classes {
			head := ""
			if c.Head != nil {
				head = *c.Head
			}
			got := agencyClasses[i]
			if got.id != c.ID || got.head != head || !reflect.DeepEqual(got.participles, c.Participles) {
				t.Errorf("class %d: %+v, spec %s/%s/%q", i, got, c.ID, head, c.Participles)
			}
		}
	})
}

func TestEngineVersionNamesTheCoreRevision(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot(), "packages", "core", "package.json"))
	if err != nil {
		t.Fatalf("read packages/core/package.json: %v", err)
	}
	var core struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &core); err != nil {
		t.Fatalf("parse packages/core/package.json: %v", err)
	}
	if got := Analyze("", RulePack{ID: "empty", Version: "1", Locale: "en"}).Engine.Version; got != core.Version {
		t.Fatalf("engine.version %q, want the core revision %q it reproduces", got, core.Version)
	}
}

// schemaNode is the subset of JSON Schema that spec/output.schema.json actually
// uses: object required/properties/additionalProperties, array items, local
// $ref into $defs, and enums. Value constraints (minimum, pattern) are out of
// scope; the shape of the wire format is what a struct tag can silently break.
type schemaNode struct {
	Ref                  string                 `json:"$ref"`
	Type                 json.RawMessage        `json:"type"`
	Required             []string               `json:"required"`
	Properties           map[string]*schemaNode `json:"properties"`
	AdditionalProperties *bool                  `json:"additionalProperties"`
	Items                *schemaNode            `json:"items"`
	Enum                 []json.RawMessage      `json:"enum"`
	Defs                 map[string]*schemaNode `json:"$defs"`
}

// types normalises "type", which the schema writes as either a string or a
// list ("rewrite" is ["string","null"]).
func (n *schemaNode) types() []string {
	if len(n.Type) == 0 {
		return nil
	}
	var one string
	if err := json.Unmarshal(n.Type, &one); err == nil {
		return []string{one}
	}
	var many []string
	if err := json.Unmarshal(n.Type, &many); err != nil {
		return nil
	}
	return many
}

// kindOf names the JSON type of a value decoded into any. Every number arrives
// as float64, so a whole one reads as "integer" and satisfies "number" too.
func kindOf(v any) string {
	switch n := v.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case string:
		return "string"
	case float64:
		if n == math.Trunc(n) {
			return "integer"
		}
		return "number"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	}
	return "unknown"
}

func typeAllowed(allowed []string, kind string) bool {
	for _, a := range allowed {
		if a == kind || (a == "number" && (kind == "integer" || kind == "number")) {
			return true
		}
	}
	return false
}

// checkSchema walks a decoded result against the schema. It reports every
// divergence rather than stopping at the first, so one run names all the
// fields that drifted.
func checkSchema(t *testing.T, defs map[string]*schemaNode, node *schemaNode, v any, path string) {
	t.Helper()
	if node.Ref != "" {
		name := strings.TrimPrefix(node.Ref, "#/$defs/")
		target, ok := defs[name]
		if !ok {
			t.Fatalf("%s: unresolvable $ref %q", path, node.Ref)
		}
		node = target
	}
	if allowed := node.types(); len(allowed) > 0 && !typeAllowed(allowed, kindOf(v)) {
		t.Errorf("%s: serialised as %s, schema allows %v", path, kindOf(v), allowed)
		return
	}
	if len(node.Enum) > 0 {
		ok := false
		for _, raw := range node.Enum {
			var want any
			if err := json.Unmarshal(raw, &want); err == nil && reflect.DeepEqual(want, v) {
				ok = true
				break
			}
		}
		if !ok {
			t.Errorf("%s: value %v is outside the schema enum", path, v)
		}
	}
	switch val := v.(type) {
	case map[string]any:
		for _, req := range node.Required {
			if _, present := val[req]; !present {
				t.Errorf("%s: required field %q is absent from the JSON — a struct tag or an omitempty dropped it", path, req)
			}
		}
		for key, child := range val {
			sub, known := node.Properties[key]
			if !known {
				// additionalProperties:false means an untagged exported field
				// (Start, End) invalidates the whole document.
				if node.AdditionalProperties != nil && !*node.AdditionalProperties {
					t.Errorf("%s.%s: field is not in the schema", path, key)
				}
				continue
			}
			checkSchema(t, defs, sub, child, path+"."+key)
		}
	case []any:
		if node.Items == nil {
			return
		}
		for i, item := range val {
			checkSchema(t, defs, node.Items, item, fmt.Sprintf("%s[%d]", path, i))
		}
	}
}

// zeroValuedResult pins the fields that are legitimately zero: a mark starting
// at offset 0, no expected phrasings, zero confidence, zero tells. Analysis of
// real text need not produce all of those on any given rule pack, and they are
// exactly what an omitempty would delete.
func zeroValuedResult() Result {
	var m Mark
	m.RuleID = "agency-hiding.deleted-subject"
	m.Family = "agency-hiding"
	m.Actual = "mistakes were made"
	m.Position.Start = Point{Line: 1, Column: 1, Offset: 0}
	m.Position.End = Point{Line: 1, Column: 19, Offset: 18}
	m.Expected = []string{}
	m.Confidence = 0
	m.Level = "info"

	var r Result
	r.RhetorLint = specVersion
	r.Source.Locale = "en"
	r.Marks = []Mark{m}
	return r
}

// TestOutputMatchesSchema reads spec/output.schema.json at test time, so the
// contract cannot be renamed out from under the engine: the field names come
// from the spec, never from a list copied into this file.
func TestOutputMatchesSchema(t *testing.T) {
	schemaRaw, err := os.ReadFile(filepath.Join(repoRoot(), "spec", "output.schema.json"))
	if err != nil {
		t.Fatalf("read output.schema.json: %v", err)
	}
	var schema schemaNode
	if err := json.Unmarshal(schemaRaw, &schema); err != nil {
		t.Fatalf("parse output.schema.json: %v", err)
	}
	if len(schema.Required) == 0 || schema.Defs["mark"] == nil || schema.Defs["point"] == nil {
		t.Fatal("output.schema.json parsed to an empty contract; the validator below would pass on anything")
	}
	pack, err := LoadDefaultRules()
	if err != nil {
		t.Fatalf("load rules: %v", err)
	}

	cases := []struct {
		name   string
		result Result
	}{
		// Empty input is the guaranteed zero case: no marks, no tells, and
		// `marks` must still serialise as [] rather than null.
		{"empty input", Analyze("", pack)},
		{"marked passage", Analyze("We take your privacy extremely seriously, and mistakes were made.", pack)},
		{"multi-line passage", Analyze("Mistakes were made.\nEveryone knows the deadline is very soon.", pack)},
		{"zero-valued fields", zeroValuedResult()},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			raw, err := json.Marshal(c.result)
			if err != nil {
				t.Fatalf("marshal result: %v", err)
			}
			var doc any
			if err := json.Unmarshal(raw, &doc); err != nil {
				t.Fatalf("re-parse result: %v", err)
			}
			checkSchema(t, schema.Defs, &schema, doc, "result")
		})
	}
}

// TestXEngineDump is the Go side of scripts/xengine-diff.mjs, the three-engine
// differential. It is skipped unless the script sets both XENGINE_IN (a file
// of JSON strings, one input per line) and XENGINE_OUT (where it writes one
// JSON line per input: the marks as [ruleId, actual, start, end] and the
// strip). Offsets stay in Go's native unit, bytes; the script converts units.
func TestXEngineDump(t *testing.T) {
	inPath, outPath := os.Getenv("XENGINE_IN"), os.Getenv("XENGINE_OUT")
	if inPath == "" || outPath == "" {
		t.Skip("set XENGINE_IN and XENGINE_OUT to dump analyses (node scripts/xengine-diff.mjs does)")
	}
	pack, err := LoadDefaultRules()
	if err != nil {
		t.Fatalf("load rules: %v", err)
	}
	in, err := os.Open(inPath)
	if err != nil {
		t.Fatalf("open XENGINE_IN: %v", err)
	}
	defer in.Close()
	out, err := os.Create(outPath)
	if err != nil {
		t.Fatalf("create XENGINE_OUT: %v", err)
	}
	defer out.Close()

	dec := json.NewDecoder(in)
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)
	n := 0
	for dec.More() {
		var text string
		if err := dec.Decode(&text); err != nil {
			t.Fatalf("input %d: %v", n, err)
		}
		r := Analyze(text, pack)
		marks := make([][]any, 0, len(r.Marks))
		for _, m := range r.Marks {
			marks = append(marks, []any{m.RuleID, m.Actual, m.Position.Start.Offset, m.Position.End.Offset})
		}
		if err := enc.Encode(map[string]any{"marks": marks, "strip": r.Strip}); err != nil {
			t.Fatalf("write analysis %d: %v", n, err)
		}
		n++
	}
	if err := out.Close(); err != nil {
		t.Fatalf("close XENGINE_OUT: %v", err)
	}
	t.Logf("xengine: dumped %d analyses", n)
}
