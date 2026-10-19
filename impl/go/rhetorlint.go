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

// Includes plain -en adjectives/numerals ("open", "seven") the \w+en pattern
// would otherwise swallow, and "often" so bare "is often" never reads passive.
var notPassive = map[string]bool{
	"tired": true, "glad": true, "aware": true, "worried": true, "excited": true,
	"interested": true, "scared": true, "bored": true, "pleased": true, "married": true,
	"gifted": true, "talented": true, "detailed": true, "limited": true, "dedicated": true,
	"committed": true, "supposed": true, "used": true, "based": true,
	"open": true, "even": true, "sudden": true, "seven": true, "ten": true,
	"eleven": true, "golden": true, "wooden": true, "often": true,
}

const irregularPP = `made|taken|done|given|seen|known|held|shown|drawn|chosen|written|broken|spoken|` +
	`built|sent|kept|left|lost|found|told|brought|dealt|put|set|paid|felt|met|led|read|` +
	`hit|cut|hurt|shut|split|spread|cast|cost|let`

// RE2 has no lookahead, so the "not followed by 'by <agent>'" rule is applied
// in code after this matches the be-verb + participle. The by-phrase may sit
// past a particle or adverb ("carried out collectively by the network").
var agentlessPassive = regexp.MustCompile(
	`(?i)\b(is|are|was|were|been|being|be)\s+(?:(?:\w+ly|often|never|always|still|already)\s+)?(\w+(?:ed|en)|` + irregularPP + `)\b`)
var byFollows = regexp.MustCompile(`(?i)^\s+(?:(?:\w+ly|out|up|off|down|in|on|away|forward|together|aside|back)\s+)*by\b`)

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
		for _, m := range agentlessPassive.FindAllStringSubmatchIndex(text, -1) {
			full := text[m[0]:m[1]]
			participle := strings.ToLower(text[m[4]:m[5]])
			if notPassive[participle] {
				continue
			}
			if byFollows.MatchString(text[m[1]:]) { // "... by <agent>" names who acted
				continue
			}
			out = append(out, hit{m[0], m[1] - m[0], full})
		}
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
