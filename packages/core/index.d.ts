export type RhetorLintLevel = "info" | "note" | "warning";

export interface RhetorLintPoint {
  line?: number;
  column?: number;
  offset: number;
}

export interface RhetorLintPosition {
  start: RhetorLintPoint;
  end: RhetorLintPoint;
}

export interface RhetorLintMark {
  ruleId: string;
  family: string;
  technique?: string;
  actual: string;
  position: RhetorLintPosition;
  note?: string;
  expected: string[];
  confidence?: number;
  level: RhetorLintLevel;
}

export interface RhetorLintSource {
  chars: number;
  words: number;
  locale: string;
}

export interface RhetorLintDensity {
  tells: number;
  per100Words: number;
}

export interface RhetorLintEngine {
  name?: string;
  version?: string;
  rules?: string;
}

export interface RhetorLintResult {
  rhetorlint: string;
  source: RhetorLintSource;
  density: RhetorLintDensity;
  marks: RhetorLintMark[];
  strip: string;
  rewrite: string | null;
  engine?: RhetorLintEngine;
}

export interface RhetorLintRuleBase {
  ruleId: string;
  family: string;
  technique?: string;
  note?: string;
  expected?: string[];
  confidence?: number;
  level?: RhetorLintLevel;
}

export interface RhetorLintLexicalRule extends RhetorLintRuleBase {
  type: "lexical";
  terms: string[];
}

export interface RhetorLintPatternRule extends RhetorLintRuleBase {
  type: "pattern";
  pattern: string;
  /** Patterns match case-insensitively unless this is true (e.g. ALL-CAPS shouting). */
  caseSensitive?: boolean;
}

export interface RhetorLintAgentlessPassiveRule extends RhetorLintRuleBase {
  type: "structural";
  detector: "agentless-passive";
}

export type RhetorLintRule =
  | RhetorLintLexicalRule
  | RhetorLintPatternRule
  | RhetorLintAgentlessPassiveRule;

export interface RhetorLintRulePack {
  id: string;
  version: string;
  locale?: string;
  rules: RhetorLintRule[];
}

export interface AnalyzeOptions {
  rules: RhetorLintRulePack;
  locale?: string;
  rewrite?: (text: string, marks: RhetorLintMark[]) => string;
}

export const SPEC_VERSION: "0.1";
export function analyze(text: string, options: AnalyzeOptions): RhetorLintResult;
export function strip(text: string, marks: readonly RhetorLintMark[]): string;
