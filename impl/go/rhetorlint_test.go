package main

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"runtime"
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
				g.Note != w.Note || g.Level != w.Level || math.Abs(g.Confidence-w.Confidence) > 1e-9 {
				t.Errorf("case %d mark %d:\n got  %+v\n want %+v", i, j, g, w)
			}
		}
	}
	t.Logf("go conformance: %d/%d cases checked against the ground truth", len(corpus.Cases), len(corpus.Cases))
}
