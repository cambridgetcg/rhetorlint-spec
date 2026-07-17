import type {
  RhetorLintDensity,
  RhetorLintEngine,
  RhetorLintMark,
  RhetorLintResult,
  RhetorLintSource
} from "@rhetorlint/core";

export const SIGNAL_SCHEMA: "rhetorlint.signal/0.1";

export interface RhetorLintSignalCount {
  id: string;
  count: number;
}

export interface RhetorLintSignalBoundary {
  observes: "visible-language-patterns";
  doesNot: [
    "infer-speaker-intent",
    "detect-deception",
    "determine-factual-truth"
  ];
  note: string;
}

export interface RhetorLintSignalBase {
  schema: typeof SIGNAL_SCHEMA;
  kind: "rhetorlint.analysis";
  boundary: RhetorLintSignalBoundary;
  rhetorlint: string;
  engine: RhetorLintEngine | null;
  source: RhetorLintSource;
  density: RhetorLintDensity;
  summary: {
    families: RhetorLintSignalCount[];
    rules: RhetorLintSignalCount[];
  };
}

export interface RhetorLintRedactedSignal extends RhetorLintSignalBase {
  marks?: never;
}

export interface RhetorLintSignalWithMarks extends RhetorLintSignalBase {
  marks: RhetorLintMark[];
}

export type RhetorLintSignal = RhetorLintRedactedSignal | RhetorLintSignalWithMarks;

export interface RhetorLintSignalOptions {
  includeMarks?: boolean;
}

export function toSignal(
  result: RhetorLintResult,
  options: { includeMarks: true }
): RhetorLintSignalWithMarks;
export function toSignal(
  result: RhetorLintResult,
  options?: { includeMarks?: false | undefined }
): RhetorLintRedactedSignal;
export function toSignal(
  result: RhetorLintResult,
  options?: RhetorLintSignalOptions
): RhetorLintSignal;
