import type { RhetorLintDensity, RhetorLintResult } from "@rhetorlint/core";

export interface SarifRegion {
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  charOffset: number;
  charLength: number;
  snippet: { text: string };
}

export interface SarifResult {
  ruleId: string;
  level: "note" | "warning";
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string; description: { text: string } };
      region: SarifRegion;
    };
  }>;
  properties: {
    family: string;
    displayName: string | null;
    technique: string | null;
    classificationStatus: "rule-pack-candidate-context-required";
    taxonomyMappingStatus:
      | "aligned-candidate"
      | "approximate-candidate"
      | "rhetorlint-extension"
      | null;
    confidence?: number;
  };
}

export interface RhetorLintSarifLog {
  version: "2.1.0";
  $schema: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: Array<{
          id: string;
          name: string;
          shortDescription: { text: string };
          properties: {
            family: string;
            displayName: string | null;
            technique: string | null;
            classificationStatus: "rule-pack-candidate-context-required";
            taxonomyMappingStatus:
              | "aligned-candidate"
              | "approximate-candidate"
              | "rhetorlint-extension"
              | null;
          };
        }>;
      };
    };
    results: SarifResult[];
    properties: { density: RhetorLintDensity; note: string };
  }>;
}

export function toSarif(result: RhetorLintResult): RhetorLintSarifLog;
