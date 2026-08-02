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
	"testing"
)

// flatMark is the comparable projection stored in conformance/cases.json.
type flatMark struct {
	RuleID                string   `json:"ruleId"`
	DisplayName           string   `json:"displayName"`
	Family                string   `json:"family"`
	Technique             string   `json:"technique"`
	ClassificationStatus  string   `json:"classificationStatus"`
	TaxonomyMappingStatus string   `json:"taxonomyMappingStatus"`
	Actual                string   `json:"actual"`
	Start                 int      `json:"start"`
	End                   int      `json:"end"`
	Note                  string   `json:"note"`
	Confidence            float64  `json:"confidence"`
	Level                 string   `json:"level"`
	Expected              []string `json:"expected"`
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
			RuleID: m.RuleID, DisplayName: m.DisplayName, Family: m.Family,
			Technique: m.Technique, ClassificationStatus: m.ClassificationStatus,
			TaxonomyMappingStatus: m.TaxonomyMappingStatus, Actual: m.Actual,
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
				g.Actual != w.Actual || g.DisplayName != w.DisplayName ||
				g.Family != w.Family || g.Technique != w.Technique ||
				g.ClassificationStatus != w.ClassificationStatus ||
				g.TaxonomyMappingStatus != w.TaxonomyMappingStatus ||
				g.Note != w.Note || g.Level != w.Level || math.Abs(g.Confidence-w.Confidence) > 1e-9 {
				t.Errorf("case %d mark %d:\n got  %+v\n want %+v", i, j, g, w)
			}
		}
	}
	t.Logf("go conformance: %d/%d cases checked against the reference outputs", len(corpus.Cases), len(corpus.Cases))
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
	m.DisplayName = "passive with omitted semantic agent"
	m.Family = "agency-hiding"
	m.ClassificationStatus = "rule-pack-candidate-context-required"
	m.TaxonomyMappingStatus = "rhetorlint-extension"
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
