#!/bin/zsh

set -euo pipefail

repo_root=${0:A:h:h}
cd "$repo_root"

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  print -u2 "Refusing to publish from a dirty worktree."
  exit 1
fi

upstream=$(git rev-parse --verify '@{upstream}' 2>/dev/null || true)
if [[ -z "$upstream" || "$(git rev-parse HEAD)" != "$upstream" ]]; then
  print -u2 "Refusing to publish: HEAD must exactly match its pushed upstream."
  exit 1
fi

if ! npm whoami >/dev/null 2>&1; then
  print -u2 "npm authentication is unavailable."
  exit 1
fi

npm test

packages=(
  '@captioneer/core:packages/core'
  '@captioneer/rules-en:packages/rules-en'
  '@captioneer/cli:packages/cli'
)

for entry in "${packages[@]}"; do
  name=${entry%%:*}
  package_dir=${entry#*:}
  version=$(node -p "require('./${package_dir}/package.json').version")

  if npm view "${name}@${version}" version >/dev/null 2>&1; then
    print "✓ ${name}@${version} is already live; skipping"
    continue
  fi

  print
  print "Publishing ${name}@${version}. Complete npm's security-key/passkey prompt in the browser."
  # Keep npm attached to this real terminal so it can run the configured
  # WebAuthn security-key flow (Touch ID, Face ID, phone passkey, or hardware
  # key). The helper never captures or transports the second factor.
  npm publish --workspace "$name" --access public

  visible=false
  for attempt in {1..30}; do
    if npm view "${name}@${version}" version >/dev/null 2>&1; then
      visible=true
      break
    fi
    sleep 2
  done

  if [[ "$visible" != true ]]; then
    print -u2 "${name}@${version} was accepted but is not registry-visible after 60 seconds."
    print -u2 "Stop here and verify the registry before continuing."
    exit 1
  fi
  print "✓ ${name}@${version} is registry-visible"
done

print
print "✓ Captioneer npm packages are live. Return to the deploying agent for clean-install verification and tagging."
