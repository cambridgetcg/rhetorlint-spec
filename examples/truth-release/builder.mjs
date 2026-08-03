#!/usr/bin/env node

/**
 * Truth Release builder door — start, check, prepare, and preview locally.
 *
 * This file is both the one newcomer CLI and the example-local import surface.
 * It performs no network request and has no publication capability.
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  ADAPTER_PREVIEW_REQUEST_SCHEMA,
  ADAPTER_PREVIEW_SCHEMA,
  ARTIFACT_BOUNDS,
  BOUNDS,
  BUNDLE_SCHEMA,
  INPUT_SCHEMA,
  PUBLIC_SCHEMA,
  TruthReleaseInputError,
  createAdapterPreview,
  prepareTruthRelease,
  readReleaseInputFile,
  renderPublicPage,
  renderReviewMarkdown,
  validateReleaseInput,
  verifyAdapterPreview,
  writePreparedBundle,
} from "./prepare.mjs";

export {
  ARTIFACT_BOUNDS,
  BOUNDS,
  createAdapterPreview,
  prepareTruthRelease,
  validateReleaseInput,
  verifyAdapterPreview,
};

export const SCHEMAS = Object.freeze({
  input: INPUT_SCHEMA,
  bundle: BUNDLE_SCHEMA,
  public: PUBLIC_SCHEMA,
  adapter_preview_request: ADAPTER_PREVIEW_REQUEST_SCHEMA,
  adapter_preview: ADAPTER_PREVIEW_SCHEMA,
});

const CHECK_SCHEMA = "truth-release.check/0.1";
const BUILDER_BOUNDS = Object.freeze({
  max_prepared_file_bytes: 512 * 1024,
});

const STARTER_INPUT = new URL("./fixtures/one-claim.json", import.meta.url);
const STARTER_GUIDE = new URL("./START-HERE.md", import.meta.url);
const PREPARED_FILES = Object.freeze([
  "release.json",
  "review.json",
  "page.html",
  "REVIEW.md",
]);

function privateDirectory(targetDirectory, files) {
  const target = resolve(targetDirectory);
  if (existsSync(target)) throw new Error(`output already exists: ${target}`);
  const parent = dirname(target);
  if (!existsSync(parent)) throw new Error(`output parent does not exist: ${parent}`);
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error(`output parent must be one real directory: ${parent}`);
  }
  const temporary = mkdtempSync(join(parent, `.${basename(target)}.tmp-`));
  chmodSync(temporary, 0o700);
  try {
    for (const [name, bytes] of files) {
      writeFileSync(join(temporary, name), bytes, { mode: 0o600 });
    }
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return target;
}

function startTruthRelease(targetDirectory) {
  return privateDirectory(targetDirectory, [
    ["claim.json", readFileSync(STARTER_INPUT)],
    ["START-HERE.md", readFileSync(STARTER_GUIDE)],
  ]);
}

function readPreparedBundleDirectory(preparedDirectory) {
  const target = resolve(preparedDirectory);
  const targetStat = lstatSync(target);
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error("prepared input must be one real, non-symlink directory");
  }
  const bytesByName = new Map();
  for (const name of PREPARED_FILES) {
    const file = join(target, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`prepared directory needs one regular, non-symlink ${name}`);
    }
    if (stat.size > BUILDER_BOUNDS.max_prepared_file_bytes) {
      throw new Error(`${name} exceeds ${BUILDER_BOUNDS.max_prepared_file_bytes} bytes`);
    }
    bytesByName.set(name, readFileSync(file));
  }
  const bytes = bytesByName.get("review.json");
  if (bytes.length > BUILDER_BOUNDS.max_prepared_file_bytes) {
    throw new Error(`review.json exceeds ${BUILDER_BOUNDS.max_prepared_file_bytes} bytes`);
  }
  const bundle = JSON.parse(bytes.toString("utf8"));
  const release = JSON.parse(bytesByName.get("release.json").toString("utf8"));
  if (!isDeepStrictEqual(release, bundle.public_resource)) {
    throw new Error("release.json does not match review.json public_resource");
  }
  const expectedPage = renderPublicPage(bundle);
  if (bytesByName.get("page.html").toString("utf8") !== expectedPage) {
    throw new Error("page.html does not match the verified prepared bundle");
  }
  const expectedReview = renderReviewMarkdown(bundle);
  if (bytesByName.get("REVIEW.md").toString("utf8") !== expectedReview) {
    throw new Error("REVIEW.md does not match the verified prepared bundle");
  }
  return {
    directory: target,
    bundle,
  };
}

function checkReport(input, now) {
  const structuralIssues = validateReleaseInput(input);
  if (structuralIssues.length) {
    return {
      exitCode: 2,
      report: {
        schema: CHECK_SCHEMA,
        status: "invalid",
        structural_issues: structuralIssues,
        review_prompts: 0,
        revise_prompts: 0,
        factual_truth_checked: false,
        checked_at: now,
        persistent_files_created: 0,
        directory_created: false,
        network_effects: 0,
        dispatch_effects: 0,
      },
    };
  }
  const bundle = prepareTruthRelease(input, { now });
  const revise = bundle.review.issues.filter((issue) => issue.level === "revise");
  const review = bundle.review.issues.filter((issue) => issue.level === "review");
  return {
    exitCode: revise.length ? 1 : 0,
    report: {
      schema: CHECK_SCHEMA,
      status: revise.length ? "needs-revision" : "valid-for-preparation",
      claim_id: bundle.claim.id,
      sources: bundle.evidence.supplied_sources.length,
      channels: bundle.drafts.map((draft) => draft.channel),
      review_prompts: review.length,
      revise_prompts: revise.length,
      issues: bundle.review.issues,
      factual_truth_checked: false,
      checked_at: now,
      persistent_files_created: 0,
      directory_created: false,
      network_effects: 0,
      dispatch_effects: 0,
    },
  };
}

function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  return `Truth Release builder 0.1 — one local path; send nothing.

Usage:
  node builder.mjs start NEW_DIRECTORY
  node builder.mjs check INPUT.json
  node builder.mjs prepare INPUT.json --out NEW_DIRECTORY
  node builder.mjs preview PREPARED_DIRECTORY --channel CHANNEL

Channels: bluesky, mastodon, linkedin, youtube, instagram, tiktok, x

Exit codes: 0 completed; 1 valid input needs revision; 2 invalid input,
arguments, or filesystem state. Start and prepare refuse overwrite. Check and
preview write only to stdout. No command fetches, posts, schedules, tracks,
retries, opens a browser, starts a server, or reads a credential.`;
}

function shortError(error, subject = null) {
  if (error && typeof error === "object" && error.code === "ENOENT") {
    return subject ? `${subject} was not found` : "a required path was not found";
  }
  if (error instanceof SyntaxError) {
    const detail = error.message.replace(/[\r\n]+/g, " ").slice(0, 240);
    return `${subject ?? "input"} is not valid JSON: ${detail}`;
  }
  if (error instanceof TruthReleaseInputError) {
    return `input has ${error.issues.length} structural error(s)`;
  }
  return error instanceof Error ? error.message : String(error);
}

function ordinaryPath(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("-");
}

function runBuilderCli(argv = process.argv.slice(2)) {
  if (argv.length === 1 && new Set(["--help", "-h"]).has(argv[0])) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const startForm = argv.length === 2 && argv[0] === "start" && ordinaryPath(argv[1]);
  const checkForm = argv.length === 2 && argv[0] === "check" && ordinaryPath(argv[1]);
  const prepareForm =
    argv.length === 4
    && argv[0] === "prepare"
    && ordinaryPath(argv[1])
    && argv[2] === "--out"
    && ordinaryPath(argv[3]);
  const previewForm =
    argv.length === 4
    && argv[0] === "preview"
    && ordinaryPath(argv[1])
    && argv[2] === "--channel"
    && ordinaryPath(argv[3]);

  if (!startForm && !checkForm && !prepareForm && !previewForm) {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }

  const observedAt = new Date().toISOString();
  let persistentFilesCreated = 0;
  let directoryCreated = false;
  try {
    if (startForm) {
      const target = startTruthRelease(argv[1]);
      persistentFilesCreated = 2;
      directoryCreated = true;
      writeJson(process.stdout, {
        status: "started",
        directory: target,
        files: [join(target, "claim.json"), join(target, "START-HERE.md")],
        next: { command: "check", input: join(target, "claim.json") },
        persistent_files_created: persistentFilesCreated,
        directory_created: directoryCreated,
        network_effects: 0,
        dispatch_effects: 0,
      });
      return 0;
    }

    if (checkForm) {
      const result = checkReport(readReleaseInputFile(argv[1]), observedAt);
      writeJson(result.exitCode === 2 ? process.stderr : process.stdout, result.report);
      return result.exitCode;
    }

    if (prepareForm) {
      const bundle = prepareTruthRelease(readReleaseInputFile(argv[1]), {
        now: observedAt,
      });
      const target = writePreparedBundle(bundle, argv[3]);
      persistentFilesCreated = PREPARED_FILES.length;
      directoryCreated = true;
      writeJson(process.stdout, {
        status: "prepared-not-approved-not-published",
        directory: target,
        files: Object.fromEntries(PREPARED_FILES.map((name) => [name, join(target, name)])),
        review_prompts: bundle.review.issues.filter((issue) => issue.level === "review").length,
        revise_prompts: bundle.review.issues.filter((issue) => issue.level === "revise").length,
        next: {
          command: "preview",
          prepared_directory: target,
          channel: bundle.drafts[0].channel,
        },
        persistent_files_created: persistentFilesCreated,
        directory_created: directoryCreated,
        network_effects: 0,
        dispatch_effects: 0,
      });
      return 0;
    }

    const prepared = readPreparedBundleDirectory(argv[1]);
    const draft = prepared.bundle.drafts?.find((item) => item.channel === argv[3]);
    if (!draft) throw new Error(`prepared bundle has no ${argv[3]} draft`);
    writeJson(process.stdout, createAdapterPreview(prepared.bundle, {
      schema: ADAPTER_PREVIEW_REQUEST_SCHEMA,
      channel: argv[3],
      expected_source_record_digest: prepared.bundle.source_record_digest,
      expected_draft_digest: draft.draft_digest,
    }));
    return 0;
  } catch (error) {
    const subject = checkForm || prepareForm
      ? resolve(argv[1])
      : previewForm
        ? resolve(argv[1])
        : null;
    writeJson(process.stderr, {
      status: "error",
      message: shortError(error, subject),
      observed_at: observedAt,
      persistent_files_created: persistentFilesCreated,
      directory_created: directoryCreated,
      network_effects: 0,
      dispatch_effects: 0,
    });
    return 2;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runBuilderCli();
