/**
 * toSarif(result) — convert a RhetorLint result into SARIF 2.1.0.
 *
 * Lets marks flow into editors, CI, and code-scanning with no bespoke glue.
 * Format caveat: SARIF has no native slot for the markers-per-100-words density
 * metric, so it rides in run.properties. RhetorLint-JSON stays canonical;
 * SARIF is a lossy-but-standard export ("SARIF-convertible", not "-native").
 */
export function toSarif(result) {
  const byRule = new Map();
  for (const m of result.marks) {
    if (!byRule.has(m.ruleId)) {
      byRule.set(m.ruleId, {
        id: m.ruleId,
        name: (m.displayName || m.ruleId).replace(/[^A-Za-z0-9_]+/g, "_"),
        shortDescription: { text: m.note || m.ruleId },
        properties: {
          family: m.family,
          displayName: m.displayName || null,
          technique: m.technique || null,
          classificationStatus: m.classificationStatus || "rule-pack-candidate-context-required",
          taxonomyMappingStatus: m.taxonomyMappingStatus || null
        }
      });
    }
  }

  const levelMap = { info: "note", note: "note", warning: "warning" };

  const results = result.marks.map((m) => ({
    ruleId: m.ruleId,
    level: levelMap[m.level] || "note",
    message: { text: (m.note ? m.note + " — " : "") + '"' + m.actual + '"' },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: "source", description: { text: "analyzed text" } },
        region: {
          startLine: m.position.start.line,
          startColumn: m.position.start.column,
          endLine: m.position.end.line,
          endColumn: m.position.end.column,
          charOffset: m.position.start.offset,
          charLength: m.position.end.offset - m.position.start.offset,
          snippet: { text: m.actual }
        }
      }
    }],
    properties: {
      family: m.family,
      displayName: m.displayName || null,
      technique: m.technique || null,
      classificationStatus: m.classificationStatus || "rule-pack-candidate-context-required",
      taxonomyMappingStatus: m.taxonomyMappingStatus || null,
      confidence: m.confidence
    }
  }));

  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: { driver: {
        name: (result.engine && result.engine.name) || "rhetorlint",
        version: (result.engine && result.engine.version) || "0.0.0",
        informationUri: "https://github.com/cambridgetcg/rhetorlint-spec",
        rules: [...byRule.values()]
      }},
      results,
      properties: {
        density: result.density,
        note: "RhetorLint marks visible language patterns; it does not establish intent, recipient effects, or factual truth. Candidate wording prompts are not emitted as auto-fixes."
      }
    }]
  };
}
