/**
 * Regenerate the reference expected outputs from the JavaScript engine.
 *
 * This proves that other engines reproduce the chosen reference behaviour. It
 * does not establish that a rule interpretation, rhetorical-effect hypothesis,
 * or factual claim is valid.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyze, SPEC_VERSION } from "../packages/core/index.mjs";

const casesUrl = new URL("../conformance/cases.json", import.meta.url);
const rulesUrl = new URL("../packages/rules-en/rules.json", import.meta.url);
const current = JSON.parse(readFileSync(casesUrl, "utf8"));
const rules = JSON.parse(readFileSync(rulesUrl, "utf8"));

function flatten(result) {
  return {
    density: result.density,
    strip: result.strip,
    marks: result.marks.map((mark) => ({
      ruleId: mark.ruleId,
      displayName: mark.displayName,
      family: mark.family,
      technique: mark.technique,
      classificationStatus: mark.classificationStatus,
      taxonomyMappingStatus: mark.taxonomyMappingStatus,
      actual: mark.actual,
      start: mark.position.start.offset,
      end: mark.position.end.offset,
      note: mark.note,
      confidence: mark.confidence,
      level: mark.level,
      expected: mark.expected
    }))
  };
}

const next = {
  spec: SPEC_VERSION,
  rules: `${rules.id}@${rules.version}`,
  note:
    "Reference expected outputs generated from the JavaScript engine. " +
    "Conformance proves reproduction of these values, not semantic validity or factual truth.",
  cases: current.cases.map(({ input }) => ({
    input,
    ...flatten(analyze(input, { rules }))
  }))
};

writeFileSync(casesUrl, JSON.stringify(next, null, 2) + "\n");
console.log(`updated ${next.cases.length} reference cases for ${next.rules}`);
