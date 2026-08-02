import type {
  RhetorLintEffectHypothesis,
  RhetorLintEngine,
  RhetorLintPosition,
  RhetorLintResult,
  RhetorLintRule,
  RhetorLintRulePack,
  RhetorLintTaxonomyMappingStatus,
  RhetorLintVerificationProbe
} from "@rhetorlint/core";

export const INQUIRY_SCHEMA: "rhetorlint.inquiry/0.1";

export interface RhetorLintInquiryBoundary {
  observation: "span-and-position-only";
  classification: "rule-pack-candidate-context-required";
  interpretation: "hypotheses-not-findings";
  effects: "recipient-specific-evidence-required";
  truth: "questions-not-verdicts";
}

export interface RhetorLintInquiryAssurance {
  metadataSource: "caller-supplied-rule-pack";
  boundary: "declared-not-semantically-verified";
  fingerprintUse: "change-detection-not-authentication";
  analysisPackBinding:
    | "id-version-and-matched-family-only"
    | "matched-family-only";
}

export interface RhetorLintInquirySourceAccess {
  source: "not-included";
  reference: "none" | "caller-supplied-unverified";
  markedPhrases: "omitted" | "disclosed";
}

export interface RhetorLintInquiryMarkRef {
  ruleId: string;
  displayName: string;
  family: string;
  classificationStatus: "rule-pack-candidate-context-required";
  taxonomyMappingStatus: RhetorLintTaxonomyMappingStatus;
  position: RhetorLintPosition;
}

export type RhetorLintNonEmptyArray<T> = [T, ...T[]];

export interface RhetorLintInquiryItemBase {
  markRef: RhetorLintInquiryMarkRef;
  effectHypotheses: RhetorLintNonEmptyArray<RhetorLintEffectHypothesis>;
  verificationProbes: RhetorLintNonEmptyArray<RhetorLintVerificationProbe>;
}

export interface RhetorLintRedactedInquiryItem extends RhetorLintInquiryItemBase {
  actual?: never;
}

export interface RhetorLintDisclosedInquiryItem extends RhetorLintInquiryItemBase {
  actual: string;
}

export interface RhetorLintInquiryBase {
  schema: typeof INQUIRY_SCHEMA;
  kind: "rhetorlint.inquiry";
  boundary: RhetorLintInquiryBoundary;
  assurance: RhetorLintInquiryAssurance;
  sourceAccess: RhetorLintInquirySourceAccess;
  rhetorlint: string;
  engine: RhetorLintEngine | null;
  rules: string;
  metadataFingerprint: `fnv1a64:${string}`;
  sourceRef?: string;
}

export interface RhetorLintRedactedInquiry extends RhetorLintInquiryBase {
  items: RhetorLintRedactedInquiryItem[];
}

export interface RhetorLintDisclosedInquiry extends RhetorLintInquiryBase {
  items: RhetorLintDisclosedInquiryItem[];
}

export interface RhetorLintInquiryOptions {
  rules: RhetorLintInquiryRulePack;
  sourceRef?: string;
  includeActual?: boolean;
}

export type RhetorLintInquiryRule = RhetorLintRule & {
  displayName: string;
  taxonomyMappingStatus: RhetorLintTaxonomyMappingStatus;
  effectHypotheses: RhetorLintNonEmptyArray<RhetorLintEffectHypothesis>;
  verificationProbes: RhetorLintNonEmptyArray<RhetorLintVerificationProbe>;
};

export interface RhetorLintInquiryRulePack extends Omit<RhetorLintRulePack, "rules"> {
  rules: RhetorLintInquiryRule[];
}

export function toInquiry(
  result: RhetorLintResult,
  options: RhetorLintInquiryOptions & { includeActual: true }
): RhetorLintDisclosedInquiry;
export function toInquiry(
  result: RhetorLintResult,
  options: RhetorLintInquiryOptions & { includeActual?: false | undefined }
): RhetorLintRedactedInquiry;
export function toInquiry(
  result: RhetorLintResult,
  options: RhetorLintInquiryOptions
): RhetorLintRedactedInquiry | RhetorLintDisclosedInquiry;
