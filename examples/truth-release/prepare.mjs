#!/usr/bin/env node

/**
 * Truth Release 0.1 — one sourced claim into local review, social drafts,
 * a noindex canonical-page preview, and a correction-aware public record.
 *
 * This is an example integration, not part of the RhetorLint specification.
 * It performs no network request and has no dispatch capability.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

import { analyze } from "../../packages/core/index.mjs";
import { toSignal } from "../../packages/core/signals.mjs";

const RULES = JSON.parse(
  readFileSync(new URL("../../packages/rules-en/rules.json", import.meta.url), "utf8"),
);

export const INPUT_SCHEMA = "truth-release.input/0.1";
export const BUNDLE_SCHEMA = "truth-release.bundle/0.1";
export const PUBLIC_SCHEMA = "truth-release.public/0.1";

export const BOUNDS = Object.freeze({
  max_input_bytes: 16 * 1024,
  max_sources: 8,
  max_media: 8,
  max_channel_drafts: 8,
  max_parts_per_draft: 8,
  max_attempts_per_action: 1,
  max_external_effects: 0,
});

const RHETORLINT_SOURCE = Object.freeze({
  repository: "https://github.com/cambridgetcg/rhetorlint-spec",
  source_commit: "5b93fa7f088b2e38e174717c29e6cf5a6daa4a13",
  relationship: "local wording review; not a truth, intent, consent, or authority verdict",
});

const XENIA_RIGHTS = Object.freeze({
  profile: "xenia.rights/0.1",
  release: "npm-xenia-v0.1.0-beta.6",
  source_commit: "14c9ffaa5e8d1c8d7a3f82ed2ceb1c8e83aadcd2",
  source:
    "https://github.com/cambridgetcg/xenia/blob/npm-xenia-v0.1.0-beta.6/RIGHTS.md",
  relationship:
    "design reference only; this bundle does not declare XENIA adoption or conformance",
});

const CHANNELS = Object.freeze({
  bluesky: {
    format: "short post or short thread",
    soft_target: 280,
    guidance_observed_at: "2026-08-03",
    guidance_review_after: "2026-11-03",
    discovery:
      "People choose Following, Discover, and independently built custom feeds; no single ranking formula governs all feeds.",
    checks: [
      "Keep the exact claim visible across the parts.",
      "Use a domain handle or other visible identity proof when available.",
      "Fetch the current service and account limits before any future dispatch.",
    ],
    official_information: [
      "https://bsky.social/about/blog/7-27-2023-custom-feeds",
      "https://docs.bsky.app/docs/advanced-guides/posts",
      "https://docs.bsky.app/docs/advanced-guides/rate-limits",
    ],
  },
  mastodon: {
    format: "short post",
    soft_target: 460,
    guidance_observed_at: "2026-08-03",
    guidance_review_after: "2026-11-03",
    discovery:
      "Discovery follows the chosen server, follows, hashtags, boosts, and federated reach rather than one global engagement maximiser.",
    checks: [
      "Ask the selected instance for its current character and media limits.",
      "Use a content warning only when it helps the reader choose, never as curiosity bait.",
      "Keep edits and the instance's public edit history in the later receipt.",
    ],
    official_information: [
      "https://docs.joinmastodon.org/methods/timelines/",
      "https://docs.joinmastodon.org/methods/statuses/",
      "https://docs.joinmastodon.org/api/rate-limits/",
    ],
  },
  linkedin: {
    format: "professional context post",
    soft_target: null,
    guidance_observed_at: "2026-08-03",
    guidance_review_after: "2026-11-03",
    discovery:
      "Professional relevance, enough context beyond the immediate network, trusted identity, and constructive discussion matter.",
    checks: [
      "Name the professional context and why this evidence matters to that audience.",
      "Do not manufacture a question merely to collect replies.",
      "Fetch current app and member permissions before any future dispatch.",
    ],
    official_information: [
      "https://www.linkedin.com/pulse/how-does-linkedin-feed-work-tim-jurka-oxraf",
      "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-03",
      "https://www.linkedin.com/legal/professional-community-policies",
    ],
  },
  youtube: {
    format: "title and description outline",
    soft_target: null,
    guidance_observed_at: "2026-08-03",
    guidance_review_after: "2026-11-03",
    discovery:
      "Appeal, sustained viewing, satisfaction, relevance, and source quality vary by recommendation and search surface.",
    checks: [
      "The title must make the same promise the content fulfils.",
      "Add a transcript, sources, and the native correction card after timestamps exist.",
      "Disclose realistic synthetic media when applicable.",
    ],
    official_information: [
      "https://support.google.com/youtube/answer/16533387?hl=en",
      "https://support.google.com/youtube/answer/16559650?hl=en",
      "https://support.google.com/youtube/answer/57404?hl=en",
      "https://developers.google.com/youtube/v3/determine_quota_cost",
    ],
  },
  instagram: {
    format: "first frame and caption",
    soft_target: null,
    guidance_observed_at: "2026-08-03",
    guidance_review_after: "2026-11-03",
    discovery:
      "Feed, Stories, Explore, Reels, and Search make different predictions; there is no stable universal weight table.",
    checks: [
      "Make the first frame an honest summary, not an unresolved curiosity gap.",
      "Include useful alt text and visible source context.",
      "Publishing APIs require an eligible professional account and current permissions.",
    ],
    official_information: [
      "https://about.instagram.com/blog/announcements/instagram-ranking-explained",
      "https://developers.facebook.com/docs/instagram-platform/content-publishing/",
      "https://www.facebook.com/help/instagram/653964212890722",
    ],
  },
  tiktok: {
    format: "opening line, spoken outline, and caption",
    soft_target: null,
    guidance_observed_at: "2026-08-03",
    guidance_review_after: "2026-11-03",
    discovery:
      "Viewing behaviour, interactions, content information, and search relevance matter; full watches and skips are strong but not universal signals.",
    checks: [
      "Resolve the opening promise in the same piece.",
      "Show sources on screen or in the linked canonical record.",
      "A future Direct Post integration must show a preview and obtain knowing approval.",
    ],
    official_information: [
      "https://support.tiktok.com/en/using-tiktok/exploring-videos/how-tiktok-recommends-content",
      "https://developers.tiktok.com/doc/content-sharing-guidelines",
      "https://developers.tiktok.com/doc/content-posting-api-reference-direct-post",
    ],
  },
  x: {
    format: "short post or short thread",
    soft_target: 260,
    guidance_observed_at: "2026-08-03",
    guidance_review_after: "2026-11-03",
    discovery:
      "Interests, follows, interactions, viewing, and network context contribute without one permanently dominant signal.",
    checks: [
      "Keep this channel optional; do not make the release depend on it.",
      "Never duplicate across account pools, hijack trends, or automate likes and follows.",
      "Fetch current account capabilities and limits before any future dispatch.",
    ],
    official_information: [
      "https://help.x.com/en/using-x/x-timeline",
      "https://docs.x.com/x-api/posts/create-post",
      "https://help.x.com/en/rules-and-policies/x-automation?lang=browser",
    ],
  },
});

const ROOT_KEYS = new Set([
  "schema",
  "id",
  "title",
  "claim",
  "scope",
  "summary",
  "why_now",
  "audience",
  "canonical_url",
  "machine_url",
  "correction_url",
  "intended_publication_date",
  "evidence_updated_at",
  "review_after",
  "author",
  "sources",
  "uncertainties",
  "contrary_evidence",
  "call_to_action",
  "commercial_interest",
  "rights",
  "media",
  "channel_selection",
]);

const AUTHOR_KEYS = new Set(["name", "kind", "url"]);
const SOURCE_KEYS = new Set([
  "id",
  "title",
  "url",
  "kind",
  "observed_at",
  "locator",
  "supports",
  "content_sha256",
]);
const RIGHTS_KEYS = new Set([
  "license_label",
  "license_url",
  "creator",
  "rights_holder",
  "permitted_reuse",
]);
const MEDIA_KEYS = new Set([
  "url",
  "creator",
  "rights_basis",
  "alt",
  "synthetic",
  "synthetic_disclosure",
]);

const FIELD_LIMITS = Object.freeze({
  id: 96,
  title: 160,
  claim: 1_200,
  scope: 600,
  summary: 2_000,
  why_now: 800,
  audience: 500,
  call_to_action: 500,
  commercial_interest: 500,
});

function sha256(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function pushIssue(issues, path, message) {
  issues.push({ path, message });
}

function checkClosed(value, allowed, path, issues) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) pushIssue(issues, `${path}.${key}`, "property is not permitted");
  }
}

function checkText(value, path, issues, { max = 2_000, nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string") {
    pushIssue(issues, path, nullable ? "must be a string or null" : "must be a string");
    return;
  }
  if (!value.trim()) pushIssue(issues, path, "must not be empty");
  if (value !== value.trim()) pushIssue(issues, path, "must not have leading or trailing space");
  if (Buffer.byteLength(value, "utf8") > max) {
    pushIssue(issues, path, `must be at most ${max} UTF-8 bytes`);
  }
}

function hasPublicHostShape(url) {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(hostname) !== 0 || !hostname.includes(".")) return false;
  return !new Set(["localhost", "local", "internal", "test", "invalid", "example"])
    .has(hostname.split(".").at(-1));
}

function checkUrl(
  value,
  path,
  issues,
  { nullable = false, publicHostShaped = false } = {},
) {
  if (nullable && value === null) return null;
  checkText(value, path, issues, { max: 2_048, nullable });
  if (typeof value !== "string") return null;
  if (!value.startsWith("https://")) {
    pushIssue(issues, path, "must begin with lowercase https://");
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") pushIssue(issues, path, "must use public HTTPS");
    if (parsed.username || parsed.password) pushIssue(issues, path, "must not contain credentials");
    if (publicHostShaped && !hasPublicHostShape(parsed)) {
      pushIssue(
        issues,
        path,
        "must use a public-host-shaped DNS name, not an IP, local, reserved, or single-label host",
      );
    }
    return parsed;
  } catch {
    pushIssue(issues, path, "must be an absolute URL");
    return null;
  }
}

function checkDate(value, path, issues, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  checkText(value, path, issues, { max: 32, nullable });
  if (typeof value !== "string") return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.valueOf())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    pushIssue(issues, path, "must be a real calendar date in YYYY-MM-DD form");
    return null;
  }
  return Date.parse(`${value}T00:00:00Z`);
}

function checkStringArray(value, path, issues, { maxItems = 8, maxBytes = 1_000 } = {}) {
  if (!Array.isArray(value)) {
    pushIssue(issues, path, "must be an array");
    return;
  }
  if (value.length > maxItems) pushIssue(issues, path, `must contain at most ${maxItems} items`);
  value.forEach((item, index) => checkText(item, `${path}[${index}]`, issues, { max: maxBytes }));
}

export class TruthReleaseInputError extends TypeError {
  constructor(issues) {
    super(`truth release input is invalid: ${issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
    this.name = "TruthReleaseInputError";
    this.issues = issues;
  }
}

export function validateReleaseInput(value) {
  const issues = [];
  let encoded = "";
  try {
    encoded = JSON.stringify(value);
  } catch {
    pushIssue(issues, "$", "must be finite JSON data");
    return issues;
  }
  if (encoded === undefined) {
    pushIssue(issues, "$", "must be a JSON object");
    return issues;
  }
  if (Buffer.byteLength(encoded, "utf8") > BOUNDS.max_input_bytes) {
    pushIssue(issues, "$", `must be at most ${BOUNDS.max_input_bytes} UTF-8 bytes`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    pushIssue(issues, "$", "must be an object");
    return issues;
  }

  checkClosed(value, ROOT_KEYS, "$", issues);
  for (const key of ROOT_KEYS) {
    if (!Object.hasOwn(value, key)) pushIssue(issues, "$", `required property '${key}' is missing`);
  }

  if (value.schema !== INPUT_SCHEMA) pushIssue(issues, "$.schema", `must equal ${INPUT_SCHEMA}`);
  for (const [field, max] of Object.entries(FIELD_LIMITS)) {
    checkText(value[field], `$.${field}`, issues, { max, nullable: field === "why_now" });
  }
  if (typeof value.id === "string" && !/^[a-z0-9][a-z0-9._-]*$/.test(value.id)) {
    pushIssue(issues, "$.id", "must use lowercase letters, digits, dots, underscores, or hyphens");
  }

  const canonical = checkUrl(value.canonical_url, "$.canonical_url", issues, {
    publicHostShaped: true,
  });
  const machine = checkUrl(value.machine_url, "$.machine_url", issues, {
    nullable: true,
    publicHostShaped: true,
  });
  checkUrl(value.correction_url, "$.correction_url", issues);
  if (canonical && machine && canonical.origin !== machine.origin) {
    pushIssue(issues, "$.machine_url", "must be same-origin with canonical_url");
  }
  if (canonical && (canonical.search || canonical.hash)) {
    pushIssue(issues, "$.canonical_url", "must not contain query parameters or a fragment");
  }
  if (machine && (machine.search || machine.hash)) {
    pushIssue(issues, "$.machine_url", "must not contain query parameters or a fragment");
  }

  const intendedPublication = checkDate(
    value.intended_publication_date,
    "$.intended_publication_date",
    issues,
    { nullable: true },
  );
  const evidenceUpdated = checkDate(value.evidence_updated_at, "$.evidence_updated_at", issues);
  const reviewAfter = checkDate(value.review_after, "$.review_after", issues);
  if (
    intendedPublication !== null
    && evidenceUpdated !== null
    && intendedPublication < evidenceUpdated
  ) {
    pushIssue(
      issues,
      "$.intended_publication_date",
      "must not precede evidence_updated_at",
    );
  }
  if (evidenceUpdated !== null && reviewAfter !== null && reviewAfter <= evidenceUpdated) {
    pushIssue(issues, "$.review_after", "must be later than evidence_updated_at");
  }

  checkText(value.call_to_action, "$.call_to_action", issues, {
    max: FIELD_LIMITS.call_to_action,
  });
  checkText(value.commercial_interest, "$.commercial_interest", issues, {
    max: FIELD_LIMITS.commercial_interest,
  });
  checkStringArray(value.uncertainties, "$.uncertainties", issues, { maxItems: 8 });
  checkStringArray(value.contrary_evidence, "$.contrary_evidence", issues, { maxItems: 8 });

  if (!value.author || typeof value.author !== "object" || Array.isArray(value.author)) {
    pushIssue(issues, "$.author", "must be an object");
  } else {
    checkClosed(value.author, AUTHOR_KEYS, "$.author", issues);
    checkText(value.author.name, "$.author.name", issues, { max: 200 });
    if (!new Set(["Person", "Organization"]).has(value.author.kind)) {
      pushIssue(issues, "$.author.kind", "must be Person or Organization");
    }
    checkUrl(value.author.url, "$.author.url", issues, { nullable: true });
  }

  if (!Array.isArray(value.sources)) {
    pushIssue(issues, "$.sources", "must be an array");
  } else {
    if (value.sources.length === 0) pushIssue(issues, "$.sources", "must name at least one source");
    if (value.sources.length > BOUNDS.max_sources) {
      pushIssue(issues, "$.sources", `must name at most ${BOUNDS.max_sources} sources`);
    }
    const sourceIds = new Set();
    value.sources.forEach((source, index) => {
      const path = `$.sources[${index}]`;
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        pushIssue(issues, path, "must be an object");
        return;
      }
      checkClosed(source, SOURCE_KEYS, path, issues);
      checkText(source.id, `${path}.id`, issues, { max: 96 });
      checkText(source.title, `${path}.title`, issues, { max: 300 });
      checkUrl(source.url, `${path}.url`, issues);
      checkDate(source.observed_at, `${path}.observed_at`, issues);
      checkText(source.locator, `${path}.locator`, issues, { max: 500 });
      checkText(source.supports, `${path}.supports`, issues, { max: 1_000 });
      checkText(source.content_sha256, `${path}.content_sha256`, issues, {
        max: 71,
        nullable: true,
      });
      if (
        typeof source.content_sha256 === "string"
        && !/^sha256:[a-f0-9]{64}$/.test(source.content_sha256)
      ) {
        pushIssue(issues, `${path}.content_sha256`, "must be sha256:<64 lowercase hex digits>");
      }
      if (!new Set(["primary", "secondary", "official-data", "testimony"]).has(source.kind)) {
        pushIssue(issues, `${path}.kind`, "must be primary, secondary, official-data, or testimony");
      }
      if (typeof source.id === "string") {
        if (sourceIds.has(source.id)) pushIssue(issues, `${path}.id`, "must be unique");
        sourceIds.add(source.id);
      }
    });
  }

  if (!value.rights || typeof value.rights !== "object" || Array.isArray(value.rights)) {
    pushIssue(issues, "$.rights", "must be an object");
  } else {
    checkClosed(value.rights, RIGHTS_KEYS, "$.rights", issues);
    checkText(value.rights.license_label, "$.rights.license_label", issues, { max: 200 });
    checkUrl(value.rights.license_url, "$.rights.license_url", issues);
    checkText(value.rights.creator, "$.rights.creator", issues, { max: 200 });
    checkText(value.rights.rights_holder, "$.rights.rights_holder", issues, { max: 200 });
    checkText(value.rights.permitted_reuse, "$.rights.permitted_reuse", issues, { max: 1_000 });
  }

  if (!Array.isArray(value.media)) {
    pushIssue(issues, "$.media", "must be an array");
  } else {
    if (value.media.length > BOUNDS.max_media) {
      pushIssue(issues, "$.media", `must contain at most ${BOUNDS.max_media} items`);
    }
    value.media.forEach((media, index) => {
      const path = `$.media[${index}]`;
      if (!media || typeof media !== "object" || Array.isArray(media)) {
        pushIssue(issues, path, "must be an object");
        return;
      }
      checkClosed(media, MEDIA_KEYS, path, issues);
      const mediaUrl = checkUrl(media.url, `${path}.url`, issues, { publicHostShaped: true });
      if (mediaUrl && canonical && mediaUrl.origin !== canonical.origin) {
        pushIssue(
          issues,
          `${path}.url`,
          "must be same-origin with canonical_url so the page creates no third-party media request",
        );
      }
      if (mediaUrl && (mediaUrl.search || mediaUrl.hash)) {
        pushIssue(
          issues,
          `${path}.url`,
          "must not contain query parameters or a fragment",
        );
      }
      checkText(media.creator, `${path}.creator`, issues, { max: 200 });
      checkText(media.rights_basis, `${path}.rights_basis`, issues, { max: 500 });
      checkText(media.alt, `${path}.alt`, issues, { max: 1_000 });
      if (typeof media.synthetic !== "boolean") {
        pushIssue(issues, `${path}.synthetic`, "must be a boolean");
      }
      checkText(media.synthetic_disclosure, `${path}.synthetic_disclosure`, issues, {
        max: 500,
        nullable: true,
      });
    });
  }

  if (!Array.isArray(value.channel_selection)) {
    pushIssue(issues, "$.channel_selection", "must be an array");
  } else {
    if (value.channel_selection.length === 0) {
      pushIssue(issues, "$.channel_selection", "must contain at least one channel");
    }
    if (value.channel_selection.length > BOUNDS.max_channel_drafts) {
      pushIssue(
        issues,
        "$.channel_selection",
        `must contain at most ${BOUNDS.max_channel_drafts} channels`,
      );
    }
    const seen = new Set();
    value.channel_selection.forEach((channel, index) => {
      if (!Object.hasOwn(CHANNELS, channel)) {
        pushIssue(issues, `$.channel_selection[${index}]`, "is not a supported channel");
      }
      if (seen.has(channel)) {
        pushIssue(issues, `$.channel_selection[${index}]`, "must be unique");
      }
      seen.add(channel);
    });
  }

  return issues;
}

function truncate(text, maxCodePoints) {
  const points = Array.from(text);
  if (points.length <= maxCodePoints) return text;
  return `${points.slice(0, Math.max(1, maxCodePoints - 1)).join("").trimEnd()}…`;
}

function splitDraft(text, softTarget) {
  if (!softTarget) {
    return {
      parts: [text],
      status: "single-draft",
      reason: "No local soft target is asserted for this format.",
    };
  }
  if (Array.from(text).length <= softTarget) {
    return {
      parts: [text],
      status: "within-soft-target",
      reason: `The draft is within the local ${softTarget}-character drafting target.`,
    };
  }
  const words = text.split(/\s+/u);
  const parts = [];
  let current = "";
  for (const word of words) {
    if (Array.from(word).length > softTarget) {
      return {
        parts: [],
        status: "human-layout-required",
        reason: `One unbroken token exceeds the local ${softTarget}-character drafting target.`,
      };
    }
    const candidate = current ? `${current} ${word}` : word;
    if (Array.from(candidate).length <= softTarget) {
      current = candidate;
      continue;
    }
    if (current) parts.push(current);
    if (parts.length >= BOUNDS.max_parts_per_draft) {
      return {
        parts: [],
        status: "human-layout-required",
        reason: `The draft needs more than ${BOUNDS.max_parts_per_draft} parts at the local target.`,
      };
    }
    current = word;
  }
  if (current) parts.push(current);
  if (parts.length > BOUNDS.max_parts_per_draft) {
    return {
      parts: [],
      status: "human-layout-required",
      reason: `The draft needs more than ${BOUNDS.max_parts_per_draft} parts at the local target.`,
    };
  }
  return {
    parts,
    status: "within-soft-target",
    reason: `${parts.length} bounded draft parts fit the local ${softTarget}-character target.`,
  };
}

function sourceLines(input) {
  return input.sources.map(
    (source) =>
      `- ${source.title} — ${source.url}\n  Locator: ${source.locator}\n  Supports: ${source.supports}`,
  );
}

function limitLines(input) {
  const lines = input.uncertainties.map((item) => `- ${item}`);
  if (lines.length === 0) lines.push("- No specific uncertainty was declared; review this omission.");
  return lines;
}

function commonDraftBody(input) {
  const why = input.why_now ? `\n\nWhy now\n${input.why_now}` : "";
  const contrary = input.contrary_evidence.length
    ? `\n\nContrary evidence or live dispute\n${input.contrary_evidence.map((item) => `- ${item}`).join("\n")}`
    : "";
  return [
    input.title,
    input.claim,
    `Scope\n${input.scope}`,
    `Why it matters\n${input.summary}${why}`,
    `Evidence\n${sourceLines(input).join("\n")}`,
    `What remains uncertain\n${limitLines(input).join("\n")}${contrary}`,
    input.call_to_action,
    `Sources, context, and corrections\n${input.canonical_url}`,
  ].join("\n\n");
}

function shortDraftBody(input) {
  return `${input.title}\n\n${input.claim}\n\nSources, limits, and corrections: ${input.canonical_url}`;
}

function makeDraft(channel, input) {
  const profile = CHANNELS[channel];
  const longBody = commonDraftBody(input);
  const shortBody = shortDraftBody(input);
  const body = new Set(["bluesky", "mastodon", "x"]).has(channel) ? shortBody : longBody;
  const firstMedia = input.media[0] ?? null;
  const layout = splitDraft(body, profile.soft_target);
  const opening =
    channel === "tiktok"
      ? `Here is the claim, the evidence behind it, and what remains uncertain: ${input.title}`
      : input.title;
  const draft = {
    channel,
    format: profile.format,
    opening,
    body,
    parts: layout.parts,
    layout: {
      status: layout.status,
      soft_target: profile.soft_target,
      max_parts: BOUNDS.max_parts_per_draft,
      reason: layout.reason,
    },
    alt_text: firstMedia?.alt ?? null,
    media: copy(input.media),
    commercial_interest: input.commercial_interest,
    intended_audience: input.audience,
    canonical_claim: input.claim,
    claim_digest: sha256(input.claim),
    discovery_note: profile.discovery,
    adaptation_notes: [
      "The canonical_claim field is exact and must remain unchanged.",
      "The part layout is a draft target, not a claim about a current platform limit.",
      "No hashtags, engagement bait, posting time, or frequency were invented.",
    ],
    checks_before_dispatch: profile.checks,
    official_information: profile.official_information,
    guidance_observed_at: profile.guidance_observed_at,
    guidance_review_after: profile.guidance_review_after,
    dispatch: {
      authorized: false,
      adapter_present: false,
      external_effects: 0,
      exact_human_approval_required: true,
      future_external_effect_bound:
        layout.status === "human-layout-required" ? null : layout.parts.length,
    },
  };
  return {
    ...draft,
    draft_digest: sha256(stableJson(draftDigestRecord(draft))),
    digest_scope:
      "canonical JSON of channel, format, opening, body, parts, layout, alt_text, media, commercial_interest, intended_audience, and canonical_claim",
  };
}

function draftDigestRecord(draft) {
  return {
    channel: draft.channel,
    format: draft.format,
    opening: draft.opening,
    body: draft.body,
    parts: draft.parts,
    layout: draft.layout,
    alt_text: draft.alt_text,
    media: draft.media,
    commercial_interest: draft.commercial_interest,
    intended_audience: draft.intended_audience,
    canonical_claim: draft.canonical_claim,
  };
}

function fieldAnalyses(input) {
  const fields = [
    ["title", input.title],
    ["claim", input.claim],
    ["scope", input.scope],
    ["summary", input.summary],
    ["why_now", input.why_now],
    ["audience", input.audience],
    ["call_to_action", input.call_to_action],
    ["commercial_interest", input.commercial_interest],
    ["rights.permitted_reuse", input.rights.permitted_reuse],
    ...input.sources.flatMap((source, index) => [
      [`sources[${index}].title`, source.title],
      [`sources[${index}].locator`, source.locator],
      [`sources[${index}].supports`, source.supports],
    ]),
    ...input.uncertainties.map((text, index) => [`uncertainties[${index}]`, text]),
    ...input.contrary_evidence.map((text, index) => [`contrary_evidence[${index}]`, text]),
    ...input.media.flatMap((media, index) => [
      [`media[${index}].alt`, media.alt],
      [`media[${index}].synthetic_disclosure`, media.synthetic_disclosure],
    ]),
  ];
  return fields
    .filter(([, text]) => typeof text === "string" && text.length > 0)
    .map(([field, text]) => ({ field, text, result: analyze(text, { rules: RULES }) }));
}

function makeReview(input, now) {
  const analyses = fieldAnalyses(input);
  const combined = analyses.map(({ field, text }) => `${field}: ${text}`).join("\n");
  const aggregate = analyze(combined, { rules: RULES });
  const localMarks = analyses.flatMap(({ field, result }) =>
    result.marks.map((mark) => ({
      field,
      rule_id: mark.ruleId,
      family: mark.family,
      actual: mark.actual,
      note: mark.note ?? null,
      level: mark.level,
      position: copy(mark.position),
    })),
  );

  const issues = [];
  if (!input.sources.some((source) => source.kind === "primary" || source.kind === "official-data")) {
    issues.push({
      code: "no-primary-source",
      level: "review",
      field: "sources",
      message: "No primary or official-data source is named; say why or add one.",
    });
  }
  if (input.uncertainties.length === 0) {
    issues.push({
      code: "uncertainty-not-declared",
      level: "review",
      field: "uncertainties",
      message: "An empty uncertainty list is visible, but a human must confirm that the omission is honest.",
    });
  }
  const today = Date.parse(`${now.slice(0, 10)}T00:00:00Z`);
  if (Date.parse(`${input.evidence_updated_at}T00:00:00Z`) > today) {
    issues.push({
      code: "evidence-date-in-future",
      level: "revise",
      field: "evidence_updated_at",
      message: "evidence_updated_at is later than this preparation turn.",
    });
  }
  input.sources.forEach((source, index) => {
    if (Date.parse(`${source.observed_at}T00:00:00Z`) > today) {
      issues.push({
        code: "source-observation-in-future",
        level: "revise",
        field: `sources[${index}].observed_at`,
        message: "A source observation date cannot be later than this preparation turn.",
      });
    }
    if (source.content_sha256 === null) {
      issues.push({
        code: "source-bytes-not-pinned",
        level: "review",
        field: `sources[${index}].content_sha256`,
        message:
          "The source record has a URL, locator, and observation date but no supplied content digest.",
      });
    }
  });
  if (Date.parse(`${input.review_after}T00:00:00Z`) <= today) {
    issues.push({
      code: "review-date-due",
      level: "revise",
      field: "review_after",
      message: "The evidence review date is due or past.",
    });
  }
  input.channel_selection.forEach((channel) => {
    const profile = CHANNELS[channel];
    if (Date.parse(`${profile.guidance_review_after}T00:00:00Z`) <= today) {
      issues.push({
        code: "platform-guidance-review-due",
        level: "revise",
        field: `channel_selection.${channel}`,
        message:
          `${channel} guidance was observed ${profile.guidance_observed_at} and was due for review ` +
          `${profile.guidance_review_after}; re-open the official links before relying on it.`,
      });
    }
  });
  input.media.forEach((media, index) => {
    if (media.synthetic && !media.synthetic_disclosure) {
      issues.push({
        code: "synthetic-media-disclosure-missing",
        level: "revise",
        field: `media[${index}].synthetic_disclosure`,
        message: "Synthetic media needs a plain disclosure before any draft is approved.",
      });
    }
  });

  const attentionRules = new Set([
    "absolute.universal",
    "lure.free-offer",
    "urgency.appeal-to-time",
    "shouting.caps",
    "puffery.peacock",
  ]);
  for (const mark of localMarks) {
    if (attentionRules.has(mark.rule_id)) {
      issues.push({
        code: "attention-language-needs-context",
        level: "review",
        field: mark.field,
        message: `${mark.rule_id} marked ${JSON.stringify(mark.actual)}. Confirm the wording is supported and not pressure or puffery.`,
      });
    }
  }

  const titleClaimMarks = localMarks.filter(
    (mark) => new Set(["title", "claim"]).has(mark.field) && attentionRules.has(mark.rule_id),
  );
  const attention = [
    {
      principle: "One clear subject for one named audience",
      status: "declared",
      evidence: `Supplied audience declaration: ${input.audience}`,
    },
    {
      principle: "The opening promise needs evidence review and wording context",
      status: titleClaimMarks.length ? "human-review-required" : "wording-unmarked",
      evidence: titleClaimMarks.length
        ? `${titleClaimMarks.length} visible wording mark(s) need context.`
        : "No selected attention rule marked the title or claim; support was not checked.",
    },
    {
      principle: "A human opens the sources and checks support and limits",
      status: "human-review-required",
      evidence:
        `${input.sources.length} source declaration(s) and ${input.uncertainties.length} uncertainty ` +
        "item(s) were supplied; no source was fetched or verified.",
    },
    {
      principle: "Attention has a correction and exit path",
      status: "declared",
      evidence: `Supplied correction door: ${input.correction_url}; this workflow adds no follow-up.`,
    },
    {
      principle: "Channel-aware briefs keep one canonical record",
      status: "prepared-not-dispatched",
      evidence:
        `${input.channel_selection.length} bounded draft brief(s) point to ${input.canonical_url}; ` +
        "no platform rendering or dispatch was checked.",
    },
  ];

  return {
    visibility: "local-review-only",
    source_contents_fetched: false,
    factual_truth_checked: false,
    rhetorlint: {
      source: RHETORLINT_SOURCE,
      signal: toSignal(aggregate),
      local_marks: localMarks,
      boundary:
        "Marks are prompts to read visible wording. Density and marks are not a truth score or publication verdict.",
    },
    issues,
    attention,
    human_approval: {
      required: true,
      completed: false,
      dispatch_authorized: false,
      must_bind: [
        "exact draft bytes",
        "one account and channel",
        "audience and visibility",
        "media and alt text",
        "commercial and synthetic-media disclosures",
      ],
    },
  };
}

function makeSeo(input) {
  const description = truncate(`${input.claim} ${input.summary}`, 158);
  const firstMedia = input.media[0] ?? null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${input.canonical_url}#article`,
    headline: input.title,
    description,
    mainEntityOfPage: { "@type": "WebPage", "@id": input.canonical_url },
    creativeWorkStatus: "Draft — not published",
    author: {
      "@type": input.author.kind,
      name: input.author.name,
      ...(input.author.url ? { url: input.author.url } : {}),
    },
    citation: input.sources.map((source) => source.url),
    license: input.rights.license_url,
    ...(firstMedia ? { image: input.media.map((media) => media.url) } : {}),
  };
  return {
    title: input.title,
    description,
    description_note: "Concise preview copy, not a ranking formula or guaranteed snippet.",
    publication_state: "prepared-preview",
    canonical_url: input.canonical_url,
    machine_url: input.machine_url,
    robots: "noindex, nofollow",
    open_graph: {
      type: "article",
      title: input.title,
      description,
      url: input.canonical_url,
      image: firstMedia?.url ?? null,
      image_alt: firstMedia?.alt ?? null,
    },
    twitter_card: {
      card: firstMedia ? "summary_large_image" : "summary",
      title: input.title,
      description,
      image: firstMedia?.url ?? null,
      image_alt: firstMedia?.alt ?? null,
    },
    json_ld: jsonLd,
    visible_page_requirements: [
      "Keep title, claim, scope, dates, sources, uncertainty, rights, commercial interest, and correction door visible.",
      "Keep the canonical page useful even if no search engine or social crawler visits it.",
      "After an exact publication receipt, add a truthful datePublished, switch indexing on, and add this one canonical URL to the site's sitemap and internal navigation.",
      "Do not generate thin duplicate landing pages for channel variants.",
      "Use ClaimReview only after a genuine fact-checking process meets that structured-data contract.",
    ],
  };
}

function makeRights(input) {
  return {
    xenia: XENIA_RIGHTS,
    adoption: "not-declared-by-this-bundle",
    audience: input.audience,
    attribution: {
      author: copy(input.author),
      creator: input.rights.creator,
      rights_holder: input.rights.rights_holder,
    },
    reuse: copy(input.rights),
    media: copy(input.media),
    data_and_pressure: {
      preparation_location: "local",
      audience_profiles_created: false,
      tracking_parameters_created: false,
      third_party_media_requests_created: false,
      account_credentials_read: false,
      manufactured_urgency_added: false,
      silence_or_ignore_is_complete: true,
      automated_follow_up: false,
    },
    choices: [
      { id: "read", effect: "Open the canonical evidence page.", binding: false },
      { id: "ignore", effect: "No effect and no follow-up.", binding: false },
      { id: "reply-or-correct", effect: `Use ${input.correction_url}.`, binding: false },
      {
        id: "reuse",
        effect:
          `The supplier declares ${input.rights.license_label} reuse terms; verify the ` +
          "rights holder and terms before relying on them.",
        binding: false,
      },
    ],
  };
}

function makePublicRights(rights) {
  return {
    license_label: rights.reuse.license_label,
    license_url: rights.reuse.license_url,
    creator: rights.reuse.creator,
    rights_holder: rights.reuse.rights_holder,
    permitted_reuse: rights.reuse.permitted_reuse,
    xenia_design_reference: copy(rights.xenia),
    xenia_adoption: rights.adoption,
    choices: copy(rights.choices),
    data_and_pressure: copy(rights.data_and_pressure),
  };
}

function makeCorrection(input) {
  return {
    url: input.correction_url,
    policy:
      "Preserve the original record, append dated corrections, and carry material corrections with every later use.",
    history: [],
    fan_out_state: "not-started",
    published_urls: [],
    later_use_must_check_current_correction: true,
  };
}

const NOT_ESTABLISHED = Object.freeze([
  "factual truth",
  "speaker intent or deception",
  "identity, representative authority, or consent",
  "XENIA adoption or conformance",
  "search indexing, ranking, recommendation, reach, or effectiveness",
  "publication, correction fan-out, or any external effect",
]);

function makeWorkflow() {
  return [
    {
      state: "prepared",
      owner: "local preparer",
      required_evidence: "source record, local wording review, drafts, SEO companion",
      external_effects: 0,
    },
    {
      state: "reviewed",
      owner: "human reviewer",
      required_evidence: "sources opened, limits read, claims and disclosures checked",
      external_effects: 0,
    },
    {
      state: "approved",
      owner: "authorized account holder",
      required_evidence: "approval bound to exact bytes, account, audience, and visibility",
      external_effects: 0,
    },
    {
      state: "published",
      owner: "future platform adapter or account holder",
      required_evidence:
        "bounded action plan plus a URL, ID, timestamp, and exact digest receipt for every approved part",
      external_effects: null,
    },
    {
      state: "observed",
      owner: "bounded observer",
      required_evidence: "fixed window, aggregate consequence, no audience dossier",
      external_effects: 0,
    },
    {
      state: "corrected-or-closed",
      owner: "record owner",
      required_evidence: "correction fan-out receipt or explicit close",
      external_effects: 0,
    },
  ];
}

export function prepareTruthRelease(input, options = {}) {
  const issues = validateReleaseInput(input);
  if (issues.length) throw new TruthReleaseInputError(issues);

  const preparedAt = options.now ?? new Date().toISOString();
  const preparedDate = new Date(preparedAt);
  const normalizedPreparedAt = preparedAt.replace(/Z$/, (ending) =>
    preparedAt.includes(".") ? ending : `.000${ending}`);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(preparedAt)
    || Number.isNaN(preparedDate.valueOf())
    || preparedDate.toISOString() !== normalizedPreparedAt
  ) {
    throw new TypeError("options.now must be a real uppercase-UTC ISO timestamp");
  }

  const claimDigest = sha256(input.claim);
  const review = makeReview(input, preparedAt);
  const drafts = input.channel_selection.map((channel) => makeDraft(channel, input));
  drafts.forEach((draft) => {
    if (draft.layout.status === "human-layout-required") {
      review.issues.push({
        code: "channel-layout-needs-human",
        level: "revise",
        field: `drafts.${draft.channel}.layout`,
        message: `${draft.channel}: ${draft.layout.reason}`,
      });
    }
  });
  const seo = makeSeo(input);
  const rights = makeRights(input);
  const correction = makeCorrection(input);
  const sourceRecordDigest = sha256(stableJson(input));

  const publicResource = {
    schema_version: PUBLIC_SCHEMA,
    publication_state: "prepared-not-published",
    id: input.id,
    canonical_url: input.canonical_url,
    machine_url: input.machine_url,
    title: input.title,
    claim: {
      id: input.id,
      text: input.claim,
      utf8_sha256: claimDigest,
      scope: input.scope,
      audience: input.audience,
    },
    summary: input.summary,
    why_now: input.why_now,
    call_to_action: input.call_to_action,
    dates: {
      prepared_at: preparedAt,
      intended_publication_date: input.intended_publication_date,
      evidence_updated_at: input.evidence_updated_at,
      review_after: input.review_after,
      publication_receipt: null,
    },
    author: copy(input.author),
    evidence: {
      sources: copy(input.sources),
      uncertainties: copy(input.uncertainties),
      contrary_evidence: copy(input.contrary_evidence),
      source_contents_fetched_by_preparer: false,
    },
    commercial_interest: input.commercial_interest,
    rights: makePublicRights(rights),
    media: copy(input.media),
    correction: {
      url: input.correction_url,
      policy: correction.policy,
      history: [],
    },
    rhetorlint_signal: copy(review.rhetorlint.signal),
    not_established: [...NOT_ESTABLISHED],
  };

  return {
    schema: BUNDLE_SCHEMA,
    status: "prepared",
    prepared_at: preparedAt,
    bounds: copy(BOUNDS),
    source_record_digest: sourceRecordDigest,
    claim: {
      id: input.id,
      text: input.claim,
      utf8_sha256: claimDigest,
      scope: input.scope,
      audience: input.audience,
    },
    evidence: {
      supplied_sources: copy(input.sources),
      primary_or_official_count: input.sources.filter(
        (source) => source.kind === "primary" || source.kind === "official-data",
      ).length,
      source_contents_fetched: false,
      uncertainties: copy(input.uncertainties),
      contrary_evidence: copy(input.contrary_evidence),
    },
    review,
    drafts,
    seo,
    rights,
    correction,
    workflow: makeWorkflow(),
    public_resource: publicResource,
    not_established: [...NOT_ESTABLISHED],
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJsonForHtml(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function requireHttpsForRender(value, field, { publicHostShaped = false } = {}) {
  if (typeof value !== "string" || !value.startsWith("https://")) {
    throw new TypeError(`${field} must be a lowercase public HTTPS URL`);
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new TypeError(`${field} must be a credential-free public HTTPS URL`);
  }
  if (publicHostShaped && !hasPublicHostShape(parsed)) {
    throw new TypeError(`${field} must use a public-host-shaped DNS name`);
  }
  return parsed;
}

function assertSameJson(actual, expected, field) {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new TypeError(`${field} must match its canonical prepared projection`);
  }
}

function assertPublicRenderBoundary(bundle) {
  if (!bundle || bundle.schema !== BUNDLE_SCHEMA || bundle.status !== "prepared") {
    throw new TypeError("renderPublicPage needs one prepared truth-release bundle");
  }
  const record = bundle.public_resource;
  if (!record || record.publication_state !== "prepared-not-published") {
    throw new TypeError("the public resource must remain prepared-not-published");
  }
  if (record.dates?.publication_receipt !== null || bundle.seo?.robots !== "noindex, nofollow") {
    throw new TypeError("a prepared page must have no publication receipt and must remain noindex");
  }
  const canonical = requireHttpsForRender(
    record.canonical_url,
    "public_resource.canonical_url",
    { publicHostShaped: true },
  );
  if (canonical.search || canonical.hash) {
    throw new TypeError("public_resource.canonical_url must have no query or fragment");
  }
  assertSameJson(record.claim, bundle.claim, "public_resource.claim");
  if (bundle.claim.utf8_sha256 !== sha256(bundle.claim.text)) {
    throw new TypeError("claim.utf8_sha256 must bind the exact claim text");
  }
  if (record.dates.prepared_at !== bundle.prepared_at) {
    throw new TypeError("public_resource.dates.prepared_at must match bundle.prepared_at");
  }
  assertSameJson(
    record.evidence.sources,
    bundle.evidence.supplied_sources,
    "public_resource.evidence.sources",
  );
  assertSameJson(
    record.evidence.uncertainties,
    bundle.evidence.uncertainties,
    "public_resource.evidence.uncertainties",
  );
  assertSameJson(
    record.evidence.contrary_evidence,
    bundle.evidence.contrary_evidence,
    "public_resource.evidence.contrary_evidence",
  );
  assertSameJson(record.author, bundle.rights.attribution.author, "public_resource.author");
  assertSameJson(record.media, bundle.rights.media, "public_resource.media");
  assertSameJson(record.rights, makePublicRights(bundle.rights), "public_resource.rights");
  const publicSignalKeys = new Set([
    "schema",
    "kind",
    "boundary",
    "rhetorlint",
    "engine",
    "source",
    "density",
    "summary",
  ]);
  if (
    !record.rhetorlint_signal
    || Object.keys(record.rhetorlint_signal).some((key) => !publicSignalKeys.has(key))
  ) {
    throw new TypeError("the public RhetorLint signal must remain aggregate and phrase-redacted");
  }
  assertSameJson(
    record.rhetorlint_signal,
    bundle.review.rhetorlint.signal,
    "public_resource.rhetorlint_signal",
  );
  assertSameJson(record.not_established, bundle.not_established, "public_resource.not_established");
  assertSameJson(
    record.correction,
    {
      url: bundle.correction.url,
      policy: bundle.correction.policy,
      history: bundle.correction.history,
    },
    "public_resource.correction",
  );
  for (const [index, draft] of bundle.drafts.entries()) {
    if (
      draft.canonical_claim !== bundle.claim.text
      || draft.claim_digest !== bundle.claim.utf8_sha256
    ) {
      throw new TypeError(`drafts[${index}] must preserve the exact canonical claim`);
    }
    assertSameJson(draft.media, record.media, `drafts[${index}].media`);
    if (
      draft.commercial_interest !== record.commercial_interest
      || draft.intended_audience !== bundle.claim.audience
    ) {
      throw new TypeError(`drafts[${index}] must bind commercial interest and intended audience`);
    }
    if (draft.draft_digest !== sha256(stableJson(draftDigestRecord(draft)))) {
      throw new TypeError(`drafts[${index}].draft_digest must bind the documented draft content`);
    }
  }
  const reconstructedInput = {
    schema: INPUT_SCHEMA,
    id: record.id,
    title: record.title,
    claim: record.claim.text,
    scope: record.claim.scope,
    summary: record.summary,
    why_now: record.why_now,
    audience: record.claim.audience,
    canonical_url: record.canonical_url,
    machine_url: record.machine_url,
    correction_url: record.correction.url,
    intended_publication_date: record.dates.intended_publication_date,
    evidence_updated_at: record.dates.evidence_updated_at,
    review_after: record.dates.review_after,
    author: record.author,
    sources: record.evidence.sources,
    uncertainties: record.evidence.uncertainties,
    contrary_evidence: record.evidence.contrary_evidence,
    call_to_action: record.call_to_action,
    commercial_interest: record.commercial_interest,
    rights: bundle.rights.reuse,
    media: record.media,
    channel_selection: bundle.drafts.map((draft) => draft.channel),
  };
  if (bundle.source_record_digest !== sha256(stableJson(reconstructedInput))) {
    throw new TypeError("source_record_digest must bind the reconstructed canonical input record");
  }
  const expectedSeo = makeSeo({
    title: record.title,
    claim: record.claim.text,
    summary: record.summary,
    canonical_url: record.canonical_url,
    machine_url: record.machine_url,
    author: record.author,
    sources: record.evidence.sources,
    rights: record.rights,
    media: record.media,
  });
  assertSameJson(bundle.seo, expectedSeo, "seo");
  if (bundle.seo.canonical_url !== record.canonical_url) {
    throw new TypeError("SEO and public canonical URLs must match exactly");
  }
  for (const [field, value] of [
    ["public_resource.machine_url", record.machine_url],
    ["public_resource.correction.url", record.correction?.url],
    ["public_resource.author.url", record.author?.url],
    ["public_resource.rights.license_url", record.rights?.license_url],
    ["public_resource.rights.xenia_design_reference.source", record.rights?.xenia_design_reference?.source],
  ]) {
    if (value !== null) {
      const parsed = requireHttpsForRender(value, field, {
        publicHostShaped: field === "public_resource.machine_url",
      });
      if (field === "public_resource.machine_url" && parsed.origin !== canonical.origin) {
        throw new TypeError("public_resource.machine_url must be same-origin with the canonical URL");
      }
      if (field === "public_resource.machine_url" && (parsed.search || parsed.hash)) {
        throw new TypeError("public_resource.machine_url must have no query or fragment");
      }
    }
  }
  record.evidence.sources.forEach((source, index) => {
    requireHttpsForRender(source.url, `public_resource.evidence.sources[${index}].url`);
  });
  record.media.forEach((media, index) => {
    const parsed = requireHttpsForRender(
      media.url,
      `public_resource.media[${index}].url`,
      { publicHostShaped: true },
    );
    if (parsed.origin !== canonical.origin || parsed.search || parsed.hash) {
      throw new TypeError(
        `public_resource.media[${index}].url must be same-origin and have no query or fragment`,
      );
    }
  });
  for (const [field, value] of [
    ["seo.open_graph.image", bundle.seo.open_graph?.image],
    ["seo.twitter_card.image", bundle.seo.twitter_card?.image],
  ]) {
    if (value !== null) {
      const parsed = requireHttpsForRender(value, field, { publicHostShaped: true });
      if (parsed.origin !== canonical.origin || parsed.search || parsed.hash) {
        throw new TypeError(`${field} must be same-origin and have no query or fragment`);
      }
    }
  }
}

export function renderPublicPage(bundle) {
  assertPublicRenderBoundary(bundle);
  const record = bundle.public_resource;
  const seo = bundle.seo;
  const sourceItems = record.evidence.sources
    .map(
      (source) =>
        `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a>` +
        `<span>${escapeHtml(source.kind)} · observed ${escapeHtml(source.observed_at)}</span>` +
        `<p><strong>Locator:</strong> ${escapeHtml(source.locator)}</p>` +
        `<p>${escapeHtml(source.supports)}</p></li>`,
    )
    .join("\n");
  const uncertaintyItems = (
    record.evidence.uncertainties.length
      ? record.evidence.uncertainties
      : ["No specific uncertainty was declared; this omission remains open for review."]
  )
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("\n");
  const contrary = record.evidence.contrary_evidence.length
    ? `<h3>Contrary evidence or live dispute</h3><ul>${record.evidence.contrary_evidence
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("\n")}</ul>`
    : "";
  const media = record.media
    .map(
      (item) =>
        `<figure><img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt)}">` +
        `<figcaption>${escapeHtml(item.creator)} · ${escapeHtml(item.rights_basis)}` +
        `${item.synthetic ? ` · ${escapeHtml(item.synthetic_disclosure ?? "synthetic media")}` : ""}</figcaption></figure>`,
    )
    .join("\n");
  const authorUrl = record.author.url
    ? `<a href="${escapeHtml(record.author.url)}">${escapeHtml(record.author.name)}</a>`
    : escapeHtml(record.author.name);
  const choiceItems = record.rights.choices
    .map((choice) => `<li><strong>${escapeHtml(choice.id)}:</strong> ${escapeHtml(choice.effect)}</li>`)
    .join("\n");
  const ogImage = seo.open_graph.image
    ? `<meta property="og:image" content="${escapeHtml(seo.open_graph.image)}">\n` +
      `<meta property="og:image:alt" content="${escapeHtml(seo.open_graph.image_alt)}">\n` +
      `<meta name="twitter:image" content="${escapeHtml(seo.twitter_card.image)}">\n` +
      `<meta name="twitter:image:alt" content="${escapeHtml(seo.twitter_card.image_alt)}">`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(seo.title)}</title>
<meta name="description" content="${escapeHtml(seo.description)}">
<meta name="robots" content="${escapeHtml(seo.robots)}">
<link rel="canonical" href="${escapeHtml(seo.canonical_url)}">
<link rel="alternate" type="application/json" href="${escapeHtml(record.machine_url ?? "./release.json")}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(seo.open_graph.title)}">
<meta property="og:description" content="${escapeHtml(seo.open_graph.description)}">
<meta property="og:url" content="${escapeHtml(seo.open_graph.url)}">
<meta name="twitter:card" content="${escapeHtml(seo.twitter_card.card)}">
<meta name="twitter:title" content="${escapeHtml(seo.twitter_card.title)}">
<meta name="twitter:description" content="${escapeHtml(seo.twitter_card.description)}">
${ogImage}
<script type="application/ld+json">${safeJsonForHtml(seo.json_ld)}</script>
<style>
:root{color-scheme:light dark;--paper:#f5f0e4;--card:#fffaf0;--ink:#282119;--soft:#655a4e;--line:#d8cdb8;--accent:#a8442f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.6 system-ui,-apple-system,sans-serif}main{max-width:820px;margin:auto;padding:clamp(24px,6vw,72px) 20px 90px}article{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:clamp(22px,5vw,56px);box-shadow:0 24px 70px #39281416}h1{font:600 clamp(34px,7vw,64px)/1.04 Iowan Old Style,Georgia,serif;letter-spacing:-.02em;margin:.2em 0}.claim{font:500 clamp(22px,3.5vw,31px)/1.35 Iowan Old Style,Georgia,serif;border-left:5px solid var(--accent);padding-left:20px}.eyebrow,.meta{color:var(--soft);font-size:.82rem;letter-spacing:.08em;text-transform:uppercase}.scope,.notice{background:#a8442f10;border:1px solid #a8442f40;border-radius:12px;padding:14px 16px}h2{margin-top:2.2em}h3{margin-top:1.6em}a{color:var(--accent);text-underline-offset:3px}li{margin:.8em 0}li span{display:block;color:var(--soft);font-size:.82rem}li p{margin:.2em 0}figure{margin:2em 0}img{max-width:100%;height:auto;border-radius:12px}figcaption{color:var(--soft);font-size:.82rem}.hash{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;color:var(--soft)}footer{border-top:1px solid var(--line);margin-top:3em;padding-top:1.5em;color:var(--soft)}@media(prefers-color-scheme:dark){:root{--paper:#17140f;--card:#211d16;--ink:#eee6d7;--soft:#b8ad98;--line:#40382b;--accent:#e08a6f}}
</style>
</head>
<body><main><article>
<p class="eyebrow">Prepared evidence preview · evidence updated ${escapeHtml(record.dates.evidence_updated_at)}</p>
<h1>${escapeHtml(record.title)}</h1>
<p class="claim">${escapeHtml(record.claim.text)}</p>
<p class="scope"><strong>Scope.</strong> ${escapeHtml(record.claim.scope)}</p>
<p>${escapeHtml(record.summary)}</p>
${record.why_now ? `<h2>Why now</h2><p>${escapeHtml(record.why_now)}</p>` : ""}
${media}
<h2>Evidence</h2><ul>${sourceItems}</ul>
<h2>What remains uncertain</h2><ul>${uncertaintyItems}</ul>${contrary}
<h2>Correction and reply</h2>
<p>This record preserves its original claim and appends material corrections. <a href="${escapeHtml(record.correction.url)}">Reply, dispute, or submit a correction</a>.</p>
<p><strong>Next door.</strong> ${escapeHtml(record.call_to_action)}</p>
<h2>Your choices</h2>
<ul>${choiceItems}</ul>
<p>Ignoring this prepared release has no effect and creates no follow-up. The <a href="${escapeHtml(record.rights.xenia_design_reference.source)}">XENIA rights baseline</a> is a design reference; this record does not declare XENIA adoption or conformance.</p>
<h2>Authorship, interest, and reuse</h2>
<p>Author: ${authorUrl}. Commercial interest: ${escapeHtml(record.commercial_interest)}.</p>
<p>${escapeHtml(record.rights.permitted_reuse)} <a href="${escapeHtml(record.rights.license_url)}">${escapeHtml(record.rights.license_label)}</a>.</p>
<div class="notice"><strong>Boundary.</strong> RhetorLint reviewed visible wording locally. It did not verify factual truth, infer intent, establish authority or consent, or predict reach.</div>
<p class="hash">Exact claim digest: ${escapeHtml(record.claim.utf8_sha256)}</p>
<footer>
<p>Not published. Intended date: ${escapeHtml(record.dates.intended_publication_date ?? "not set")} · evidence updated ${escapeHtml(record.dates.evidence_updated_at)} · review again after ${escapeHtml(record.dates.review_after)}</p>
<p><a href="${escapeHtml(record.machine_url ?? "./release.json")}">Machine-readable release</a> · <a href="${escapeHtml(record.canonical_url)}">Canonical URL</a></p>
</footer>
</article></main></body></html>`;
}

function fencedMarkdown(text) {
  const literal = String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const longest = Math.max(0, ...[...literal.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${literal}\n${fence}`;
}

function escapeMarkdownInline(text) {
  return String(text)
    .replaceAll("\\", "\\\\")
    .replace(/([`*_[\]{}()#+\-.!<>|])/g, "\\$1")
    .replace(/[\r\n]+/g, " ");
}

export function renderReviewMarkdown(bundle) {
  const issueLines = bundle.review.issues.length
    ? bundle.review.issues.map(
        (issue) =>
          `- **${issue.level} · ${issue.code}:** ${escapeMarkdownInline(issue.message)} ` +
          `(\`${escapeMarkdownInline(issue.field)}\`)`,
      )
    : ["- No structural review issue was produced. This is not a truth or publication pass."];
  const draftSections = bundle.drafts.map(
    (draft) => `## ${draft.channel}\n\n${fencedMarkdown(draft.body)}\n\n` +
      `Intended audience: ${escapeMarkdownInline(draft.intended_audience)}  \n` +
      `Commercial interest: ${escapeMarkdownInline(draft.commercial_interest)}  \n` +
      `Media records bound into this digest: ${draft.media.length}\n\n` +
      `${fencedMarkdown(JSON.stringify(draft.media, null, 2))}\n\n` +
      `Draft content digest: \`${draft.draft_digest}\`\n\n` +
      `Dispatch authorized: **no**. Current limits and permissions must be fetched at dispatch time.`,
  );
  return `# Truth Release review — ${bundle.claim.id}

Status: **prepared, not approved, not published**

Claim digest: \`${bundle.claim.utf8_sha256}\`

Source-record digest: \`${bundle.source_record_digest}\`

## Exact claim

${fencedMarkdown(bundle.claim.text)}

## Review prompts

${issueLines.join("\n")}

RhetorLint marked ${bundle.review.rhetorlint.local_marks.length} visible phrase(s) locally. A mark is a reading prompt, not a lie, intent, or truth verdict. The public release contains only the redacted aggregate signal.

## Approval boundary

One authorized account holder must open the sources and approve the exact draft bytes, one account, audience, visibility, media, alt text, and disclosures. This tool has no dispatch adapter and produced zero external effects.

${draftSections.join("\n\n")}

## SEO companion

- Canonical URL: ${escapeMarkdownInline(bundle.seo.canonical_url)}
- Title: ${escapeMarkdownInline(bundle.seo.title)}
- Description: ${escapeMarkdownInline(bundle.seo.description)}
- Prepared state: \`noindex, nofollow\`, no \`datePublished\`, no publication receipt.
- Structured data preview: ordinary draft \`Article\`; never \`ClaimReview\` by default.
- A later exact publication receipt must make the date and indexing state true.
- Keep the visible source, evidence date, limits, rights, and correction door on the page.

## Correction turn

After any later publication, record each platform URL and exact digest. If the canonical record changes materially, append the correction there, carry it to every still-live platform version once, record the result or failure, and stop.
`;
}

export function writePreparedBundle(bundle, outDirectory) {
  const target = resolve(outDirectory);
  if (existsSync(target)) throw new Error(`output path already exists: ${target}`);
  const parent = dirname(target);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory()) {
    throw new Error(`output parent is not a directory: ${parent}`);
  }
  const temporary = mkdtempSync(join(parent, `.${basename(target)}.tmp-`));
  try {
    writeFileSync(join(temporary, "release.json"), `${JSON.stringify(bundle.public_resource, null, 2)}\n`, {
      mode: 0o600,
    });
    writeFileSync(join(temporary, "review.json"), `${JSON.stringify(bundle, null, 2)}\n`, {
      mode: 0o600,
    });
    writeFileSync(join(temporary, "page.html"), renderPublicPage(bundle), { mode: 0o600 });
    writeFileSync(join(temporary, "REVIEW.md"), renderReviewMarkdown(bundle), { mode: 0o600 });
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return target;
}

function usage() {
  return `Truth Release 0.1 — prepare one claim; send nothing.

Usage:
  node prepare.mjs INPUT.json
  node prepare.mjs INPUT.json --out NEW_DIRECTORY

Without --out, the complete local review bundle is written to stdout.
With --out, the new owner-only directory receives release.json, review.json,
page.html, and REVIEW.md. Existing output is never overwritten.`;
}

export function runCli(argv = process.argv.slice(2)) {
  if (argv.length === 1 && new Set(["--help", "-h"]).has(argv[0])) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const stdoutForm = argv.length === 1 && !argv[0].startsWith("-");
  const directoryForm =
    argv.length === 3
    && !argv[0].startsWith("-")
    && argv[1] === "--out"
    && !argv[2].startsWith("-");
  if (!stdoutForm && !directoryForm) {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }
  const inputPath = resolve(argv[0]);
  try {
    const stat = lstatSync(inputPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("input must be one regular, non-symlink file");
    }
    if (stat.size > BOUNDS.max_input_bytes) {
      throw new Error(`input exceeds ${BOUNDS.max_input_bytes} bytes`);
    }
    const bytes = readFileSync(inputPath);
    if (bytes.length > BOUNDS.max_input_bytes) {
      throw new Error(`input exceeds ${BOUNDS.max_input_bytes} bytes`);
    }
    const input = JSON.parse(bytes.toString("utf8"));
    const bundle = prepareTruthRelease(input);
    if (stdoutForm) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      const target = writePreparedBundle(bundle, argv[2]);
      process.stdout.write(
        `${JSON.stringify({ status: "prepared", output: target, external_effects: 0 })}\n`,
      );
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli();
