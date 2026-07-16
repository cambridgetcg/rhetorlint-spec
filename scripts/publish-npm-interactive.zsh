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
  '@rhetorlint/core:packages/core'
  '@rhetorlint/rules-en:packages/rules-en'
  '@rhetorlint/cli:packages/cli'
)

package_is_installable() {
  local name=$1
  local version=$2

  # `npm view` normally proves registry visibility. A newly created package can
  # briefly expose its version manifest and tarball before the full packument;
  # `npm pack --dry-run` verifies the exact version is genuinely installable in
  # that window without writing a tarball.
  npm view "${name}@${version}" version >/dev/null 2>&1 ||
    npm pack --dry-run --json "${name}@${version}" >/dev/null 2>&1
}

for entry in "${packages[@]}"; do
  name=${entry%%:*}
  package_dir=${entry#*:}
  version=$(node -p "require('./${package_dir}/package.json').version")

  if package_is_installable "$name" "$version"; then
    print "✓ ${name}@${version} is already live; skipping"
    continue
  fi

  print
  print "Publishing ${name}@${version}. Complete npm's security-key/passkey prompt in the browser."
  # Keep npm attached to this real terminal so it can run the configured
  # WebAuthn security-key flow (Touch ID, Face ID, phone passkey, or hardware
  # key). The helper never captures or transports the second factor.
  npm publish --workspace "$name" --access public

  installable=false
  for attempt in {1..30}; do
    if package_is_installable "$name" "$version"; then
      installable=true
      break
    fi
    sleep 2
  done

  if [[ "$installable" != true ]]; then
    print -u2 "${name}@${version} was accepted but is not registry-installable after 60 seconds."
    print -u2 "Stop here and verify the registry before continuing."
    exit 1
  fi
  print "✓ ${name}@${version} is registry-installable"
done

print
print "✓ RhetorLint npm packages are live. Return to the deploying agent for clean-install verification and tagging."
