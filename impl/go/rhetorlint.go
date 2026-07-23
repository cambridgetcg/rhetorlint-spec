// Command rhetorlint is a Go reference implementation of the RhetorLint spec.
//
// A third engine, in a third language, that reads the same rule pack
// (packages/rules-en/rules.json) and reproduces the same conformance corpus
// as the JavaScript and Python engines — byte for byte on BMP/ASCII text.
// Its only reason to exist is to prove the taxonomy is portable.
//
// Note on offsets: Go strings are byte sequences, so positions are byte
// offsets. For ASCII/BMP text these equal the JS (UTF-16) and Python
// (code-point) offsets; the conformance corpus is ASCII. See
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
)

const specVersion = "0.1"

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

var removable = map[string]bool{"intensifier.loaded": true, "hedge.deniable": true}

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

type Mark struct {
	RuleID     string   `json:"ruleId"`
	Family     string   `json:"family"`
	Technique  string   `json:"technique"`
	Actual     string   `json:"actual"`
	Position   struct{ Start, End Point } `json:"position"`
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
	Marks  []Mark  `json:"marks"`
	Strip  string  `json:"strip"`
	Rewrite *string `json:"rewrite"`
	Engine struct {
		Name    string `json:"name"`
		Version string `json:"version"`
		Rules   string `json:"rules"`
	} `json:"engine"`
}

type hit struct {
	index, length int
	actual        string
}

var lexicalCache = map[string]*regexp.Regexp{}
var patternCache = map[string]*regexp.Regexp{}

func matchesFor(rule Rule, text string) []hit {
	var out []hit
	switch {
	case rule.Type == "lexical":
		re, ok := lexicalCache[rule.RuleID]
		if !ok {
			esc := make([]string, len(rule.Terms))
			for i, t := range rule.Terms {
				esc[i] = regexp.QuoteMeta(t)
			}
			re = regexp.MustCompile(`(?i)\b(?:` + strings.Join(esc, "|") + `)\b`)
			lexicalCache[rule.RuleID] = re
		}
		for _, loc := range re.FindAllStringIndex(text, -1) {
			out = append(out, hit{loc[0], loc[1] - loc[0], text[loc[0]:loc[1]]})
		}
	case rule.Type == "pattern":
		re, ok := patternCache[rule.RuleID]
		if !ok {
			// Case-insensitive unless the rule opts out (e.g. ALL-CAPS shouting).
			flags := `(?i)`
			if rule.CaseSensitive {
				flags = ``
			}
			re = regexp.MustCompile(flags + rule.Pattern)
			patternCache[rule.RuleID] = re
		}
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
		for _, h := range matchesFor(rule, text) {
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
				mk.Expected = rule.Expected
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
	r.Engine.Version = "0.1.1"
	r.Engine.Rules = pack.ID + "@" + pack.Version
	return r
}

var reWhitespaceRun = regexp.MustCompile(`\s{2,}`)
var reSpaceBeforePunct = regexp.MustCompile(`\s+([,.;:!?])`)
var reDoubleComma = regexp.MustCompile(`,\s*,`)
var reTrailingWS = regexp.MustCompile(`(?m)\s+$`)

// Strip returns the deterministic de-spun text: adverbial spin removed,
// agentless passives flagged [who?]. It subtracts spin; it never paraphrases.
func Strip(text string, marks []Mark) string {
	ordered := make([]Mark, len(marks))
	copy(ordered, marks)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].Position.Start.Offset > ordered[j].Position.Start.Offset
	})
	out := text
	for _, m := range ordered {
		s, e := m.Position.Start.Offset, m.Position.End.Offset
		if removable[m.RuleID] {
			out = out[:s] + out[e:]
		} else if m.RuleID == "agency-hiding.deleted-subject" {
			out = out[:s] + "[who?] " + out[s:]
		}
	}
	out = reWhitespaceRun.ReplaceAllString(out, " ")
	out = reSpaceBeforePunct.ReplaceAllString(out, "${1}")
	out = reDoubleComma.ReplaceAllString(out, ",")
	out = reTrailingWS.ReplaceAllString(out, "")
	return strings.TrimSpace(out)
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
