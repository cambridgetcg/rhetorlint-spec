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
// The publish order is load-bearing at the tail, not the head. rules-en's only
// link to core is an OPTIONAL peerDependency (>=0.1.2), which npm neither
// installs nor resolves — it documents the engine floor the caseSensitive rules
// need and constrains nothing about order, so core and rules-en could go either
// way round. It is @rhetorlint/cli that carries real carets on both; publishing
// it first leaves an `npm i @rhetorlint/cli` that cannot resolve. cli goes last.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const PACKAGES = [
  { name: '@rhetorlint/core', dir: 'packages/core' },
  { name: '@rhetorlint/rules-en', dir: 'packages/rules-en' },
  { name: '@rhetorlint/cli', dir: 'packages/cli' },
]

const DRY_RUN = process.env.DRY_RUN === 'true'

// Probes only. Their output is noise on the way to a boolean, and a probe that
// fails is the expected answer rather than an event, so nothing is inherited.
function npm(args) {
  return execFileSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
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
      npm(args)
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

// npm answers a re-publish of a live version with a 403 whose body names the
// cause. The bare code is not enough to act on: npm returns E403 for "not
// authorised" too, and treating that as benign would let an auth failure pass
// for a release. Only the sentence, or the older explicit code, is specific.
const ALREADY_LIVE = /EPUBLISHCONFLICT|cannot publish over the previously published versions/i

// --loglevel verbose is load-bearing, not decoration: npm's OIDC token
// exchange fails SILENTLY at default loglevel (npm/cli#9088) and falls through
// to a generic ENEEDAUTH that names no cause. The `npm verbose oidc` lines are
// the only place the registry's actual rejection — a publisher-config
// mismatch, a missing per-package publisher entry, an environment claim on one
// side only — becomes visible.
// Publishing from inside the package directory matches the shape the
// interactive script verifies; `--workspace` from the root would also exchange
// correctly (npm ≥ 11.5.1 runs oidc() per workspace manifest).
// Output is captured rather than inherited so the rejection can be read back;
// it is re-emitted either way, so those verbose lines stay in the log.
// maxBuffer is raised well past what verbose produces: an ENOBUFS kill would
// look exactly like a failed publish for one that had already succeeded.
function publish({ name, version, dir }) {
  try {
    process.stdout.write(
      execFileSync('npm', ['publish', '--access', 'public', '--provenance', '--loglevel', 'verbose'], {
        encoding: 'utf8',
        cwd: fileURLToPath(new URL(`../${dir}`, import.meta.url)),
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      }),
    )
    return 'published'
  } catch (err) {
    // A failure before npm ever ran (no binary, no permission) carries no
    // captured output; err.message is then the only thing that names it.
    const log = `${err.stdout ?? ''}${err.stderr ?? ''}`
    process.stderr.write(log || `${err.message}\n`)
    if (ALREADY_LIVE.test(log)) return 'already-live'
    console.error(`\n${name}@${version} was rejected. The registry's reason is above; nothing after this package went out.`)
    process.exit(1)
  }
}

let published = 0
let skipped = 0
let propagating = 0

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
  if (publish({ name, version, dir }) === 'already-live') {
    // The skip check above reads the same cache that can lag a publish, so it
    // can miss a version that is genuinely there; the registry then refuses the
    // duplicate. That refusal is the skip check's answer arriving late, not a
    // failure. Aborting on it would strand every package after this one.
    console.log(`✓ ${name}@${version} was already live; the registry refused the duplicate`)
    skipped += 1
    continue
  }

  let installable = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (isInstallable(name, version)) {
      installable = true
      break
    }
    await sleep(2000)
  }

  if (installable) {
    console.log(`✓ ${name}@${version} is registry-installable`)
  } else {
    // The publish was accepted. What has not caught up is the CDN's packument
    // cache — measured at roughly a minute on 2026-07-24, which is why the
    // budget is two. Exiting here would report a release that went out as a
    // failed one and leave the remaining packages unpublished. Nothing later
    // in this run installs what was just published, so the wait buys nothing.
    propagating += 1
    console.warn(`⚠ ${name}@${version} published, but a fresh install still cannot see it after 120 seconds.`)
    console.warn('  Registry propagation, not a failed publish. Continuing.')
  }

  published += 1
}

const verb = DRY_RUN ? 'would publish' : 'published'
console.log(`\n✓ done — ${verb} ${published}, skipped ${skipped} already live.`)
if (published === 0) {
  console.log('Nothing was new. The registry already matches this commit.')
}
if (propagating > 0) {
  console.log(`${propagating} not yet visible to a fresh install. Re-run to confirm; anything live by then is skipped.`)
}
