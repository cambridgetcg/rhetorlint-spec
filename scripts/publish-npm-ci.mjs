#!/usr/bin/env node
// The non-interactive sibling of publish-npm-interactive.zsh.
//
// The interactive script keeps npm attached to a real terminal so it can run
// the WebAuthn security-key flow. That is the right shape for a human at a
// keyboard, and the wrong shape for a release: it means a finished, tested,
// pushed release waits on which device someone happens to be sitting at.
//
// This script publishes the same packages in the same order under the same
// skip-and-verify rules, authenticating via npm Trusted Publishing (OIDC)
// instead of a key. It holds no token and can capture no second factor.
//
// The publish order is load-bearing: core before rules-en, because rules-en
// declares a semver range on core and a fresh install should never resolve to
// a core that predates the pack it ships with.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PACKAGES = [
  { name: '@rhetorlint/core', dir: 'packages/core' },
  { name: '@rhetorlint/rules-en', dir: 'packages/rules-en' },
  { name: '@rhetorlint/cli', dir: 'packages/cli' },
]

const DRY_RUN = process.env.DRY_RUN === 'true'

function npm(args, { quiet = false } = {}) {
  return execFileSync('npm', args, {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
  })
}

// `npm view` normally proves registry visibility. A newly created package can
// briefly expose its version manifest and tarball before the full packument;
// `npm pack --dry-run` verifies the exact version is genuinely installable in
// that window. Same two-step the interactive script uses.
function isInstallable(name, version) {
  for (const args of [
    ['view', `${name}@${version}`, 'version'],
    ['pack', '--dry-run', '--json', `${name}@${version}`],
  ]) {
    try {
      npm(args, { quiet: true })
      return true
    } catch {
      /* fall through to the next probe */
    }
  }
  return false
}

function versionOf(dir) {
  return JSON.parse(readFileSync(new URL(`../${dir}/package.json`, import.meta.url), 'utf8')).version
}

let published = 0
let skipped = 0

for (const { name, dir } of PACKAGES) {
  const version = versionOf(dir)

  // Every package is offered every run; the registry decides what is new.
  // That is what makes a re-run after a partial failure safe, and it is why
  // an unchanged package (cli, most releases) needs no special-casing here.
  if (isInstallable(name, version)) {
    console.log(`✓ ${name}@${version} is already live; skipping`)
    skipped += 1
    continue
  }

  if (DRY_RUN) {
    console.log(`→ would publish ${name}@${version}`)
    published += 1
    continue
  }

  console.log(`\nPublishing ${name}@${version} via trusted publishing…`)
  npm(['publish', '--workspace', name, '--access', 'public', '--provenance'])

  let installable = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (isInstallable(name, version)) {
      installable = true
      break
    }
    await sleep(2000)
  }

  if (!installable) {
    console.error(`\n${name}@${version} was accepted but is not registry-installable after 60 seconds.`)
    console.error('Stopping here rather than publishing the next package against an unresolvable dependency.')
    process.exit(1)
  }

  console.log(`✓ ${name}@${version} is registry-installable`)
  published += 1
}

const verb = DRY_RUN ? 'would publish' : 'published'
console.log(`\n✓ done — ${verb} ${published}, skipped ${skipped} already live.`)
if (published === 0) {
  console.log('Nothing was new. The registry already matches this commit.')
}
