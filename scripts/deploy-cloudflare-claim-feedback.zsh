#!/bin/zsh

emulate -L zsh
set -euo pipefail

script_dir=${0:A:h}
repo_dir=${script_dir:h}
project_name=rhetorlint-claim-feedback
mode=${1:-}

case "$mode" in
  active)
    release_path=doors/cloudflare-claim-feedback
    ;;
  resting)
    release_path=doors/cloudflare-resting-baseline
    ;;
  *)
    print -u2 "usage: scripts/deploy-cloudflare-claim-feedback.zsh active|resting"
    exit 2
    ;;
esac

cd "$repo_dir"

dirty=$(git status --porcelain=v1 --untracked-files=all)
if [[ -n "$dirty" ]]; then
  print -u2 "Refusing Cloudflare deployment: the worktree is not clean."
  exit 1
fi

commit=$(git rev-parse --verify 'HEAD^{commit}')
expected="$mode:$commit"
if [[ ${RHETORLINT_CLOUDFLARE_DEPLOY:-} != "$expected" ]]; then
  print -u2 "Refusing Cloudflare deployment: set RHETORLINT_CLOUDFLARE_DEPLOY=$expected for this exact turn."
  exit 1
fi

GIT_TERMINAL_PROMPT=0 git fetch --quiet origin main </dev/null
origin_main=$(git rev-parse --verify 'refs/remotes/origin/main^{commit}')
if [[ "$commit" != "$origin_main" ]]; then
  print -u2 "Refusing Cloudflare deployment: HEAD is not the fetched origin/main commit."
  exit 1
fi

npm run check:cloudflare

if [[ -n $(git status --porcelain=v1 --untracked-files=all) ]]; then
  print -u2 "Refusing Cloudflare deployment: the worktree changed during preflight."
  exit 1
fi

deploy_cwd=$(mktemp -d /tmp/rhetorlint-cloudflare-deploy.XXXXXX)
case "$deploy_cwd" in
  /tmp/rhetorlint-cloudflare-deploy.*|/private/tmp/rhetorlint-cloudflare-deploy.*) ;;
  *)
    print -u2 "Refusing unsafe temporary deployment directory: $deploy_cwd"
    exit 1
    ;;
esac

cleanup() {
  command rm -rf -- "$deploy_cwd"
}
trap cleanup EXIT INT TERM HUP

cd "$deploy_cwd"
if [[ -n $(ls -A) ]]; then
  print -u2 "Refusing non-empty temporary deployment directory."
  exit 1
fi

project_json=$(WRANGLER_SEND_METRICS=false CI=1 wrangler pages project list --json </dev/null)
if ! print -r -- "$project_json" | PROJECT_NAME="$project_name" node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const projects = JSON.parse(readFileSync(0, "utf8"));
  const project = projects.find((item) => item.name === process.env.PROJECT_NAME);
  if (!project) {
    process.stderr.write("Refusing Cloudflare deployment: create and review the named project separately first.\n");
    process.exit(1);
  }
  const branch = project.production_branch ?? project.productionBranch;
  if (branch !== "main") {
    process.stderr.write("Refusing Cloudflare deployment: project production branch is not main.\n");
    process.exit(1);
  }
'; then
  exit 1
fi

git -C "$repo_dir" archive --format=tar "$commit" -- "$release_path" | tar -xf - -C "$deploy_cwd"
snapshot_dir="$deploy_cwd/$release_path"
if [[ ! -d "$snapshot_dir" || -L "$snapshot_dir" ]]; then
  print -u2 "Refusing Cloudflare deployment: exact committed release snapshot is missing."
  exit 1
fi

GIT_TERMINAL_PROMPT=0 git -C "$repo_dir" fetch --quiet origin main </dev/null
latest_origin_main=$(git -C "$repo_dir" rev-parse --verify 'refs/remotes/origin/main^{commit}')
if [[ "$commit" != "$latest_origin_main" ]]; then
  print -u2 "Refusing Cloudflare deployment: origin/main changed during preflight."
  exit 1
fi

WRANGLER_SEND_METRICS=false CI=1 wrangler pages deploy "$snapshot_dir" \
  --project-name "$project_name" \
  --branch main \
  --commit-hash "$commit" \
  --commit-dirty=false </dev/null
