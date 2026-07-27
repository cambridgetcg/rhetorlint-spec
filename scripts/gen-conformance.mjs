// Generate conformance-case JSON for given inputs from the JS reference
// engine, in the corpus's flat-mark shape. The output is a PROPOSAL: every
// generated case must be hand-read before it is committed as ground truth.
import { readFileSync } from "node:fs";
import { analyze } from "../packages/core/index.mjs";

const rules = JSON.parse(readFileSync(new URL("../packages/rules-en/rules.json", import.meta.url)));
const inputs = process.argv.slice(2);
const cases = inputs.map((input) => {
  const r = analyze(input, { rules });
  return {
    input,
    density: r.density,
    strip: r.strip,
    marks: r.marks.map((m) => ({
      ruleId: m.ruleId, family: m.family, technique: m.technique, actual: m.actual,
      start: m.position.start.offset, end: m.position.end.offset,
      note: m.note, confidence: m.confidence, level: m.level, expected: m.expected,
    })),
  };
});
process.stdout.write(JSON.stringify(cases, null, 1) + "\n");
