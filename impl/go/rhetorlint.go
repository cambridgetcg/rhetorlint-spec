// Command rhetorlint is a Go reference implementation of the RhetorLint spec.
//
// A third engine, in a third language, that reads the same rule pack
// (packages/rules-en/rules.json) and reproduces the same conformance corpus
// values as the JavaScript and Python engines over its current ASCII scope.
// Its only reason to exist is to prove the taxonomy is portable.
//
// Note on offsets: Go strings are byte sequences, so positions are byte
// offsets. For ASCII text these equal the JS (UTF-16) and Python (code-point)
// offsets; the conformance corpus is ASCII. See
// conformance/README.md for the astral-character caveat.
//
// Zero third-party dependencies (standard library only). It marks tells in
// the words; it does not read the person, detect lies, or judge factual truth.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const specVersion = "0.1"

// coreVersion labels the engine: the core revision whose behaviour it reproduces.
const coreVersion = "0.1.4"

// agencyClass is one participle class of spec/agency-lexicon.json: the
// participles, and the head class they need ("" for none).
type agencyClass struct {
	id, head    string
	participles []string
}

// BEGIN GENERATED AGENCY LEXICON
// spec/agency-lexicon.json version 2, written by scripts/gen-agency-lexicon.mjs.
// Edit the lexicon and rerun the generator; --check fails when this block drifts.
const (
	agencyWhitespace   = " \t\n\r\f"
	agencySpace        = "[ \\t\\n\\r\\f]+"
	agencyHeadStops    = ".;:!?\n"
	agencyClauseBreaks = ".;:!?"
)

var agencyAuxiliaries = []string{"been", "was", "were"}
var agencyAdverbs = []string{"already", "always", "often", "still"}

const agencyAdverbSuffix = "ly"

var agencySkip = map[string]bool{
	"all": true, "already": true, "also": true, "can": true, "could": true, "had": true, "has": true,
	"have": true, "may": true, "might": true, "must": true, "never": true, "not": true, "now": true,
	"shall": true, "should": true, "since": true, "then": true, "will": true, "would": true,
}

const agencySkipSuffix = "ly"
const agencySkipMax = 4
const agencyByWindow = 7

var agencyNegators = map[string]bool{
	"cannot": true, "neither": true, "never": true, "no": true, "none": true, "nor": true, "not": true,
	"nothing": true,
}

const agencyNegatorWindow = 5

var agencyHeads = map[string]map[string]bool{
	"challenge": map[string]bool{
		"allegations": true, "concerns": true, "questions": true,
	},
	"data": map[string]bool{
		"address": true, "addresses": true, "credentials": true, "data": true, "details": true,
		"information": true, "password": true, "passwords": true, "pii": true, "records": true,
	},
	"dummy": map[string]bool{
		"it": true,
	},
	"error": map[string]bool{
		"action": true, "actions": true, "allegations": true, "choices": true, "comments": true,
		"concerns": true, "cuts": true, "decision": true, "decisions": true, "error": true,
		"errors": true, "measures": true, "miscalculation": true, "miscalculations": true,
		"misjudgement": true, "misjudgements": true, "misjudgment": true, "misjudgments": true,
		"misstep": true, "missteps": true, "mistake": true, "mistakes": true, "omissions": true,
		"promises": true, "questions": true, "remarks": true, "safeguards": true, "statements": true,
		"steps": true, "things": true, "threats": true, "words": true,
	},
	"held": map[string]bool{
		"account": true, "accounts": true, "address": true, "addresses": true, "credentials": true,
		"data": true, "details": true, "information": true, "password": true, "passwords": true,
		"pii": true, "records": true,
	},
}

// agencyClasses holds {class, head class or "" for none, participles}.
var agencyClasses = []agencyClass{
	{"fault", "", []string{
		"botched", "bungled", "doctored", "falsified", "ignored", "misappropriated", "miscalculated",
		"mischaracterised", "mischaracterized", "mishandled", "misinformed", "misinterpreted",
		"misjudged", "mislabeled", "mislabelled", "misled", "mismanaged", "misplaced", "misquoted",
		"misreported", "misrepresented", "misstated", "misused", "neglected", "overcharged", "overlooked",
		"tampered", "underpaid",
	}},
	{"breach", "", []string{
		"accessed", "breached", "compromised", "exfiltrated", "exposed", "hacked", "leaked", "stolen",
	}},
	{"affect", "held", []string{
		"affected", "impacted",
	}},
	{"conceal", "", []string{
		"axed", "censored", "concealed", "laid off", "let go", "scrapped", "shelved", "silenced",
		"withheld",
	}},
	{"light", "error", []string{
		"characterised", "characterized", "done", "given", "interpreted", "made", "perceived", "put",
		"said", "taken",
	}},
	{"raise", "challenge", []string{
		"raised",
	}},
	{"impersonal", "dummy", []string{
		"agreed", "decided", "determined",
	}},
	{"data", "data", []string{
		"disclosed", "shared", "sold",
	}},
}

var agencyRequires = map[string]string{"put": "in place"}
var agencyUnless = map[string]string{"exposed": "to"}

// END GENERATED AGENCY LEXICON

// The agentless-passive detector marks an ACCOUNTABLE passive whose doer the
// clause leaves unstated, exactly as packages/core/index.mjs does (its comment
// there is the full statement). A mark needs a past auxiliary (was, were,
// been), at most one adverb, a participle from a closed class, the head word
// its class names, its agencyRequires phrase and not its agencyUnless word,
// no "by" among the next agencyByWindow words of the clause, and no negator in
// the auxiliary chain, as the head word or among the agencyNegatorWindow words
// before the head.
//
// Matching runs on an ASCII-lowercased copy with no (?i), so RE2 cannot fold
// U+212A KELVIN SIGN or U+017F LONG S into a participle, with explicit
// agencyWhitespace ([ \t\n\r\f]) and RE2's ASCII \b. The guards walk bytes;
// every character they look for is ASCII, apart from the U+2019 of an n't
// contraction, which agencyContraction compares as its three bytes; so a
// multi-byte character reads as one non-word run, as it does in JavaScript and
// Python.

// agencyHeadOf maps each participle to the head class it needs ("" for none).
var agencyHeadOf = func() map[string]string {
	out := map[string]string{}
	for _, c := range agencyClasses {
		for _, p := range c.participles {
			out[p] = c.head
		}
	}
	return out
}()

var agencyCandidate = func() *regexp.Regexp {
	participles := make([]string, 0, len(agencyHeadOf))
	for p := range agencyHeadOf {
		participles = append(participles, p)
	}
	sort.Slice(participles, func(i, j int) bool {
		if len(participles[i]) != len(participles[j]) {
			return len(participles[i]) > len(participles[j])
		}
		return participles[i] < participles[j]
	})
	for i, p := range participles {
		participles[i] = strings.Join(strings.Split(p, " "), agencySpace)
	}
	return regexp.MustCompile(`\b(` + strings.Join(agencyAuxiliaries, "|") + `)` + agencySpace +
		`(?:(?:[a-z]+` + agencyAdverbSuffix + `|` + strings.Join(agencyAdverbs, "|") + `)` + agencySpace + `)?` +
		`(` + strings.Join(participles, "|") + `)\b`)
}()

var agencySpaceRun = regexp.MustCompile(agencySpace)

// isAgencyWordByte reports an ASCII letter, digit or underscore: what \b
// counts as a word character.
func isAgencyWordByte(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_'
}

// agencyHeadWord returns the nearest word before index, stepping back over at
// most agencySkipMax words of agencySkip or ending in -ly, never past
// . ; : ! ? or a line break; "" when there is none.
func agencyHeadWord(low string, index int) string {
	i := index
	for seen := 0; seen <= agencySkipMax; seen++ {
		for i > 0 && !isAgencyWordByte(low[i-1]) {
			if strings.IndexByte(agencyHeadStops, low[i-1]) >= 0 {
				return ""
			}
			i--
		}
		end := i
		for i > 0 && isAgencyWordByte(low[i-1]) {
			i--
		}
		if i == end {
			return ""
		}
		word := low[i:end]
		if !agencySkip[word] && !strings.HasSuffix(word, agencySkipSuffix) {
			return word
		}
	}
	return ""
}

// agencyContraction reports whether the word "t" at start ends an n't
// contraction: "n", then an apostrophe (U+0027 or U+2019).
func agencyContraction(low string, start int) bool {
	return strings.HasSuffix(low[:start], "n'") || strings.HasSuffix(low[:start], "n\u2019")
}

// agencyNegated reports whether a negator stands in the auxiliary chain before
// index, is the head word, or is one of the agencyNegatorWindow words before
// the head. It walks the words agencyHeadWord walks, never past
// agencyHeadStops; when agencyHeadWord finds no head, only the chain is read.
func agencyNegated(low string, index int) bool {
	i := index
	left := -1 // words still to read before the head; -1 until the head is read
	for seen := 0; left != 0; seen++ {
		for i > 0 && !isAgencyWordByte(low[i-1]) {
			if strings.IndexByte(agencyHeadStops, low[i-1]) >= 0 {
				return false
			}
			i--
		}
		end := i
		for i > 0 && isAgencyWordByte(low[i-1]) {
			i--
		}
		if i == end {
			return false
		}
		word := low[i:end]
		if agencyNegators[word] || word == "t" && agencyContraction(low, i) {
			return true
		}
		if left > 0 {
			left--
		} else if !agencySkip[word] && !strings.HasSuffix(word, agencySkipSuffix) {
			left = agencyNegatorWindow
		} else if seen == agencySkipMax {
			return false
		}
	}
	return false
}

// agencyByFollows reports whether "by" is one of the next agencyByWindow
// words after index, before . ; : ! or ?. A line break does not end the window.
func agencyByFollows(low string, index int) bool {
	i := index
	for words := 0; words < agencyByWindow; words++ {
		for i < len(low) && !isAgencyWordByte(low[i]) {
			if strings.IndexByte(agencyClauseBreaks, low[i]) >= 0 {
				return false
			}
			i++
		}
		if i == len(low) {
			return false
		}
		start := i
		for i < len(low) && isAgencyWordByte(low[i]) {
			i++
		}
		if low[start:i] == "by" {
			return true
		}
	}
	return false
}

// agencyPhraseFollows reports whether the words of phrase follow index, each
// after [ \t\n\r\f]+ and each whole.
func agencyPhraseFollows(low string, index int, phrase string) bool {
	i := index
	for _, word := range strings.Split(phrase, " ") {
		gap := i
		for i < len(low) && strings.IndexByte(agencyWhitespace, low[i]) >= 0 {
			i++
		}
		if i == gap || !strings.HasPrefix(low[i:], word) {
			return false
		}
		i += len(word)
		if i < len(low) && isAgencyWordByte(low[i]) {
			return false
		}
	}
	return true
}

// agentlessPassives returns every accountable agentless passive in text,
// spanning auxiliary through participle.
func agentlessPassives(text string) []hit {
	low := asciiLower(text)
	var out []hit
	for _, m := range agencyCandidate.FindAllStringSubmatchIndex(low, -1) {
		start, end := m[0], m[1]
		participle := agencySpaceRun.ReplaceAllString(low[m[4]:m[5]], " ")
		if unless, ok := agencyUnless[participle]; ok && agencyPhraseFollows(low, end, unless) {
			continue
		}
		if requires, ok := agencyRequires[participle]; ok && !agencyPhraseFollows(low, end, requires) {
			continue
		}
		if agencyByFollows(low, end) {
			continue
		}
		if head := agencyHeadOf[participle]; head != "" && !agencyHeads[head][agencyHeadWord(low, start)] {
			continue
		}
		if agencyNegated(low, start) {
			continue
		}
		out = append(out, hit{start, end - start, text[start:end]})
	}
	return out
}

var removable = map[string]bool{"intensifier.loaded": true}

// negationScoped names the rules whose matches are read in their clause before
// they are marked: a negated absolute ("not guaranteed", "Not everyone") is a
// disclaimer, and a clause-initial "Never" before a lowercase verb ("Never
// share your password.") is advice, not a claim. Engine-side, like removable,
// so the pack stays readable by older engines; spec/taxonomy.yaml declares it
// as guard_examples.
var negationScoped = map[string]bool{"absolute.universal": true}

// negators negate an intensifier or an absolute after them ("not extremely
// high", "not always"). With any "n't" contraction, they are what negatedAt
// looks for.
var negators = map[string]bool{
	"not": true, "never": true, "no": true, "nor": true,
	"without": true, "hardly": true, "cannot": true,
}

// Rule mirrors one entry of rules.json. Fields not relevant to a rule's type
// are simply absent in the JSON and stay at their zero value.
type Rule struct {
	RuleID        string   `json:"ruleId"`
	Family        string   `json:"family"`
	Technique     string   `json:"technique"`
	Type          string   `json:"type"`
	Detector      string   `json:"detector"`
	Level         string   `json:"level"`
	Confidence    float64  `json:"confidence"`
	Note          string   `json:"note"`
	Terms         []string `json:"terms"`
	Pattern       string   `json:"pattern"`
	CaseSensitive bool     `json:"caseSensitive"`
	Expected      []string `json:"expected"`
}

type RulePack struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Locale  string `json:"locale"`
	Rules   []Rule `json:"rules"`
}

type Point struct {
	Line   int `json:"line"`
	Column int `json:"column"`
	Offset int `json:"offset"`
}

// Every field carries an explicit json tag: the wire names are the contract in
// spec/output.schema.json, which sets additionalProperties:false, so an exported
// Go name leaking through (Start, End) makes the whole document invalid. No
// omitempty anywhere either — a mark at offset 0 is a real mark, and a required
// field that vanishes when it is zero fails the schema.
type Mark struct {
	RuleID    string `json:"ruleId"`
	Family    string `json:"family"`
	Technique string `json:"technique"`
	Actual    string `json:"actual"`
	Position  struct {
		Start Point `json:"start"`
		End   Point `json:"end"`
	} `json:"position"`
	Note       string   `json:"note"`
	Expected   []string `json:"expected"`
	Confidence float64  `json:"confidence"`
	Level      string   `json:"level"`
}

type Result struct {
	RhetorLint string `json:"rhetorlint"`
	Source     struct {
		Chars  int    `json:"chars"`
		Words  int    `json:"words"`
		Locale string `json:"locale"`
	} `json:"source"`
	Density struct {
		Tells       int     `json:"tells"`
		Per100Words float64 `json:"per100Words"`
	} `json:"density"`
	Marks   []Mark  `json:"marks"`
	Strip   string  `json:"strip"`
	Rewrite *string `json:"rewrite"`
	Engine  struct {
		Name    string `json:"name"`
		Version string `json:"version"`
		Rules   string `json:"rules"`
	} `json:"engine"`
}

type hit struct {
	index, length int
	actual        string
}

type lexicalAlternative struct {
	escaped     string
	length      int
	escapedCode []uint16
}

func compareCodeUnits(left, right []uint16) int {
	limit := len(left)
	if len(right) < limit {
		limit = len(right)
	}
	for i := 0; i < limit; i++ {
		if left[i] < right[i] {
			return -1
		}
		if left[i] > right[i] {
			return 1
		}
	}
	if len(left) < len(right) {
		return -1
	}
	if len(left) > len(right) {
		return 1
	}
	return 0
}

func matchesFor(rule Rule, text string) []hit {
	var out []hit
	switch {
	case rule.Type == "lexical":
		// RE2 alternation is leftmost-first. Put longer overlapping terms first
		// without mutating the caller's authored rule-pack order. Escaped UTF-16
		// length and code-unit order mirror the JavaScript reference exactly.
		alternatives := make([]lexicalAlternative, len(rule.Terms))
		for i, term := range rule.Terms {
			escaped := regexp.QuoteMeta(term)
			escapedCode := utf16.Encode([]rune(escaped))
			alternatives[i] = lexicalAlternative{
				escaped:     escaped,
				length:      len(escapedCode),
				escapedCode: escapedCode,
			}
		}
		sort.Slice(alternatives, func(i, j int) bool {
			if alternatives[i].length != alternatives[j].length {
				return alternatives[i].length > alternatives[j].length
			}
			return compareCodeUnits(alternatives[i].escapedCode, alternatives[j].escapedCode) < 0
		})
		esc := make([]string, len(alternatives))
		for i, alternative := range alternatives {
			esc[i] = alternative.escaped
		}
		re := regexp.MustCompile(`(?i)\b(?:` + strings.Join(esc, "|") + `)\b`)
		for _, loc := range re.FindAllStringIndex(text, -1) {
			out = append(out, hit{loc[0], loc[1] - loc[0], text[loc[0]:loc[1]]})
		}
	case rule.Type == "pattern":
		// Case-insensitive unless the rule opts out (e.g. ALL-CAPS shouting).
		flags := `(?i)`
		if rule.CaseSensitive {
			flags = ``
		}
		re := regexp.MustCompile(flags + rule.Pattern)
		for _, loc := range re.FindAllStringIndex(text, -1) {
			if loc[1] == loc[0] {
				continue
			}
			out = append(out, hit{loc[0], loc[1] - loc[0], text[loc[0]:loc[1]]})
		}
	case rule.Type == "structural" && rule.Detector == "agentless-passive":
		out = append(out, agentlessPassives(text)...)
	}
	return out
}

func pointAt(text string, offset int) Point {
	line, last := 1, -1
	for i := 0; i < offset; i++ {
		if text[i] == '\n' {
			line++
			last = i
		}
	}
	return Point{Line: line, Column: offset - last, Offset: offset}
}

func countWords(text string) int { return len(strings.Fields(text)) }

// jsRound matches JavaScript Math.round: round half toward +infinity.
func jsRound(x float64) float64 { return math.Floor(x + 0.5) }

// Analyze marks the rhetorical tells in text using the given rule pack.
func Analyze(text string, pack RulePack) Result {
	var marks []Mark
	for _, rule := range pack.Rules {
		scoped := negationScoped[rule.RuleID]
		for _, h := range matchesFor(rule, text) {
			if scoped && negationScopedAt(text, h.index, h.index+h.length) {
				continue
			}
			var mk Mark
			mk.RuleID = rule.RuleID
			mk.Family = rule.Family
			mk.Technique = rule.Technique
			mk.Actual = h.actual
			mk.Position.Start = pointAt(text, h.index)
			mk.Position.End = pointAt(text, h.index+h.length)
			mk.Note = rule.Note
			if rule.Expected == nil {
				mk.Expected = []string{}
			} else {
				mk.Expected = append([]string{}, rule.Expected...)
			}
			mk.Confidence = rule.Confidence
			if rule.Level == "" {
				mk.Level = "info"
			} else {
				mk.Level = rule.Level
			}
			marks = append(marks, mk)
		}
	}

	sort.SliceStable(marks, func(i, j int) bool {
		if marks[i].Position.Start.Offset != marks[j].Position.Start.Offset {
			return marks[i].Position.Start.Offset < marks[j].Position.Start.Offset
		}
		return marks[i].Position.End.Offset < marks[j].Position.End.Offset
	})
	seen := map[string]bool{}
	deduped := make([]Mark, 0, len(marks))
	for _, m := range marks {
		key := fmt.Sprintf("%s:%d:%d", m.RuleID, m.Position.Start.Offset, m.Position.End.Offset)
		if seen[key] {
			continue
		}
		seen[key] = true
		deduped = append(deduped, m)
	}

	words := countWords(text)
	per100 := 0.0
	if words > 0 {
		per100 = jsRound(float64(len(deduped))/float64(words)*1000) / 10
	}

	var r Result
	r.RhetorLint = specVersion
	r.Source.Chars = len(text)
	r.Source.Words = words
	locale := pack.Locale
	if locale == "" {
		locale = "en"
	}
	r.Source.Locale = locale
	r.Density.Tells = len(deduped)
	r.Density.Per100Words = per100
	r.Marks = deduped
	r.Strip = Strip(text, deduped)
	r.Rewrite = nil
	r.Engine.Name = "rhetorlint (go)"
	r.Engine.Version = coreVersion
	r.Engine.Rules = pack.ID + "@" + pack.Version
	return r
}

// isGuardWordRune reports an ASCII letter or digit, or an apostrophe (U+0027
// or U+2019). Every other character separates words.
func isGuardWordRune(r rune) bool {
	return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' ||
		r == '\'' || r == '\u2019'
}

func isNegator(word string) bool {
	// ASCII-only lowercasing, so no engine folds a non-ASCII letter into a negator.
	lower := []byte(word)
	for i, c := range lower {
		if c >= 'A' && c <= 'Z' {
			lower[i] = c + ('a' - 'A')
		}
	}
	w := strings.Trim(string(lower), "'\u2019")
	return negators[w] || strings.HasSuffix(w, "n't") || strings.HasSuffix(w, "n\u2019t")
}

// clauseBreaks end a clause, for the negator window and the imperative "Never".
const clauseBreaks = ".;:!?"

// negatedAt reports whether a negator is one of the two words before offset,
// with no . ; : ! or ? between them. It walks back over characters and words,
// never a count of bytes, so the JS, Python and Go engines decide alike.
//
// With commaEndsScope (the absolute.universal guard; Strip leaves it off), a
// comma also ends the negator's reach once a word stands between them: the
// "No" of "No risk, guaranteed." negates "risk", not "guaranteed". A negator
// followed directly by a comma reaches past the aside, so "not, however,
// guaranteed" and "No, never" stay negated.
func negatedAt(text string, offset int, commaEndsScope bool) bool {
	i := offset
	commaBefore := false // a comma between the term and the word being read
	for words := 0; words < 2; words++ {
		comma := false
		for i > 0 {
			r, size := utf8.DecodeLastRuneInString(text[:i])
			if isGuardWordRune(r) {
				break
			}
			if strings.ContainsRune(clauseBreaks, r) {
				return false
			}
			if r == ',' {
				comma = true
			}
			i -= size
		}
		if i == 0 {
			return false
		}
		end := i
		for i > 0 {
			r, size := utf8.DecodeLastRuneInString(text[:i])
			if !isGuardWordRune(r) {
				break
			}
			i -= size
		}
		if isNegator(text[i:end]) {
			return !commaEndsScope || !commaBefore || comma
		}
		commaBefore = commaBefore || comma
	}
	return false
}

// neverNonVerbs cannot be the verb of an imperative "Never <verb>": after a
// clause-initial "never" they make a fragment ("Never an issue.") or an
// inversion ("Never has a product been this good."), both claims.
var neverNonVerbs = map[string]bool{
	"a": true, "an": true, "the": true, "any": true, "before": true, "so": true,
	"such": true, "in": true, "at": true, "on": true, "has": true, "have": true,
	"had": true, "is": true, "are": true, "was": true, "were": true, "will": true,
	"would": true, "could": true, "should": true, "can": true, "did": true,
	"does": true, "been": true, "being": true,
}

// neverPassThrough adverbs may stand between "Never" and its verb: the word
// after them decides. "Never ever share it." is advice; "Never again will
// prices be this low." is an inversion; "Never again." is a fragment.
var neverPassThrough = map[string]bool{"again": true, "ever": true, "once": true}

// asciiLower lowercases ASCII letters only, so no engine folds a non-ASCII
// letter into a word it looks for.
func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + ('a' - 'A')
		}
	}
	return string(b)
}

// imperativeNeverAt reports whether text[start:end] is "never", in any letter
// case, opening its clause (only non-word characters between it and the start
// of the text or one of . ; : ! ?) and followed by a verb: spaces or tabs, then
// a word that starts with an ASCII lowercase letter and is not one of
// neverNonVerbs. neverPassThrough words are stepped over the same way first.
// Like negatedAt it walks characters, never a count of bytes.
func imperativeNeverAt(text string, start, end int) bool {
	if asciiLower(text[start:end]) != "never" {
		return false
	}
	i := start
	for i > 0 {
		r, size := utf8.DecodeLastRuneInString(text[:i])
		if isGuardWordRune(r) {
			return false
		}
		if strings.ContainsRune(clauseBreaks, r) {
			break
		}
		i -= size
	}
	j := end
	for {
		gap := j
		for j < len(text) && (text[j] == ' ' || text[j] == '\t') {
			j++
		}
		if j == gap || j == len(text) || text[j] < 'a' || text[j] > 'z' {
			return false
		}
		word := j
		for j < len(text) {
			r, size := utf8.DecodeRuneInString(text[j:])
			if !isGuardWordRune(r) {
				break
			}
			j += size
		}
		w := asciiLower(text[word:j])
		if !neverPassThrough[w] {
			return !neverNonVerbs[w]
		}
	}
}

// negationScopedAt reports whether a negationScoped match is negated or an
// imperative "Never".
func negationScopedAt(text string, start, end int) bool {
	return negatedAt(text, start, true) || imperativeNeverAt(text, start, end)
}

// quotedAt reports whether offset sits inside a quotation on its own line: an
// odd number of straight double quotes before it, or an unclosed U+201C.
func quotedAt(text string, offset int) bool {
	line := text[strings.LastIndexByte(text[:offset], '\n')+1 : offset]
	return strings.Count(line, `"`)%2 == 1 ||
		strings.LastIndex(line, "\u201c") > strings.LastIndex(line, "\u201d")
}

// Strip removes loaded intensifiers and flags agentless passives [who?].
// It preserves modality and attribution and never paraphrases. An intensifier
// under a negator, or inside a quotation, stays: deleting it would strengthen
// the claim or edit someone's words.
func Strip(text string, marks []Mark) string {
	hasEdit := false
	for _, mark := range marks {
		if removable[mark.RuleID] || mark.RuleID == "agency-hiding.deleted-subject" {
			hasEdit = true
			break
		}
	}
	if !hasEdit {
		return text
	}

	ordered := make([]Mark, len(marks))
	copy(ordered, marks)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].Position.Start.Offset > ordered[j].Position.Start.Offset
	})
	out := text
	for _, m := range ordered {
		s, e := m.Position.Start.Offset, m.Position.End.Offset
		if removable[m.RuleID] {
			// Judged on the source text: edits so far all lie at or after s.
			if negatedAt(text, s, false) || quotedAt(text, s) {
				continue
			}
			out = joinRemovalSeam(out[:s], out[e:])
		} else if m.RuleID == "agency-hiding.deleted-subject" {
			out = out[:s] + "[who?] " + out[s:]
		}
	}
	return out
}

// joinRemovalSeam tidies only horizontal whitespace and duplicate commas that
// directly touch one removed span. Unrelated formatting and line breaks remain
// byte-identical to the source.
func joinRemovalSeam(left, right string) string {
	leftWhitespaceStart := len(left)
	for leftWhitespaceStart > 0 {
		char := left[leftWhitespaceStart-1]
		if char != ' ' && char != '\t' {
			break
		}
		leftWhitespaceStart--
	}
	rightWhitespaceEnd := 0
	for rightWhitespaceEnd < len(right) {
		char := right[rightWhitespaceEnd]
		if char != ' ' && char != '\t' {
			break
		}
		rightWhitespaceEnd++
	}

	leftCore, leftWhitespace := left[:leftWhitespaceStart], left[leftWhitespaceStart:]
	rightWhitespace, rightCore := right[:rightWhitespaceEnd], right[rightWhitespaceEnd:]

	if leftWhitespace != "" && rightWhitespace != "" {
		switch {
		case leftCore == "" && rightCore == "":
			return ""
		case leftCore == "" || strings.HasSuffix(leftCore, "\r") || strings.HasSuffix(leftCore, "\n"):
			leftCore += leftWhitespace
		case rightCore == "" || strings.HasPrefix(rightCore, "\r") || strings.HasPrefix(rightCore, "\n"):
			// Drop horizontal whitespace at an end or line-break seam.
		default:
			leftCore += " "
		}
	} else if leftWhitespace != "" {
		if rightCore != "" && !strings.ContainsRune(",.;:!?\r\n", rune(rightCore[0])) {
			leftCore += leftWhitespace
		}
	} else if rightWhitespace != "" {
		if leftCore != "" && !strings.HasSuffix(leftCore, "\r") && !strings.HasSuffix(leftCore, "\n") {
			rightCore = rightWhitespace + rightCore
		}
	}

	if strings.HasSuffix(leftCore, ",") && strings.HasPrefix(rightCore, ",") {
		rightCore = rightCore[1:]
	}
	return leftCore + rightCore
}

// LoadDefaultRules reads the canonical @rhetorlint/rules-en pack from the repo,
// resolved relative to this source file.
func LoadDefaultRules() (RulePack, error) {
	_, self, _, _ := runtime.Caller(0)
	path := filepath.Join(filepath.Dir(self), "..", "..", "packages", "rules-en", "rules.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return RulePack{}, err
	}
	var pack RulePack
	return pack, json.Unmarshal(data, &pack)
}

func main() {
	raw, _ := io.ReadAll(os.Stdin)
	if strings.TrimSpace(string(raw)) == "" {
		fmt.Fprintln(os.Stderr, "no input. Pipe text on stdin.")
		os.Exit(2)
	}
	pack, err := LoadDefaultRules()
	if err != nil {
		fmt.Fprintln(os.Stderr, "could not load rules:", err)
		os.Exit(2)
	}
	out, _ := json.MarshalIndent(Analyze(string(raw), pack), "", "  ")
	fmt.Println(string(out))
}
