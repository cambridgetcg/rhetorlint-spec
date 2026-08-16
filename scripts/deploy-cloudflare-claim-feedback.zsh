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

PROJECT_NAME="$project_name" EXPECTED_SUBDOMAIN="$project_name.pages.dev" node --input-type=module -e '
  import { execFileSync } from "node:child_process";

  const commandOptions = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  };
  const auth = JSON.parse(execFileSync("wrangler", ["auth", "token", "--json"], commandOptions));
  const identity = JSON.parse(execFileSync("wrangler", ["whoami", "--json"], commandOptions));
  if (!auth.token || identity.accounts?.length !== 1) {
    throw new Error("Cloudflare preflight requires one authenticated account");
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${identity.accounts[0].id}/pages/projects/${process.env.PROJECT_NAME}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  const body = await response.json();
  if (!response.ok || !body.success) {
    throw new Error(`named Cloudflare project is unavailable (${response.status})`);
  }
  const project = body.result;
  if (project.name !== process.env.PROJECT_NAME || project.subdomain !== process.env.EXPECTED_SUBDOMAIN) {
    throw new Error("Cloudflare project name or hostname differs from the reviewed release");
  }
  if (project.production_branch !== "main" || project.source != null) {
    throw new Error("Cloudflare project is not the reviewed main-branch Direct Upload project");
  }
  if (project.uses_functions === true) {
    throw new Error("Cloudflare project unexpectedly reports Pages Functions");
  }

  const analyticsPaths = [];
  function inspect(value, path = "project") {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (/^web_analytics_(?:tag|token)$/.test(key) && typeof child === "string" && child.length > 0) {
        analyticsPaths.push(childPath);
      } else {
        inspect(child, childPath);
      }
    }
  }
  inspect(project);
  if (analyticsPaths.length > 0) {
    throw new Error("Cloudflare Web Analytics must be disabled before deployment");
  }
' </dev/null

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
