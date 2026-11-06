// The staged npm route: scripts/npm-release.mjs and the workflow that calls
// it. Git runs for real in throwaway repositories; npm, the registry and
// GitHub's OIDC service are fakes, so nothing here touches the network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as release from '../scripts/npm-release.mjs'

const REPO = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, REPO), 'utf8')
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Release Test',
  GIT_AUTHOR_EMAIL: 'release-test@example.invalid',
  GIT_COMMITTER_NAME: 'Release Test',
  GIT_COMMITTER_EMAIL: 'release-test@example.invalid',
}
// Token-shaped fakes, assembled at run time so no token-shaped text is
// committed: a JWT of three base64url parts, and npm's npm_ + 38 characters.
const base64url = text => Buffer.from(text).toString('base64url')
const ID_TOKEN = [base64url('{"alg":"RS256"}'), base64url('{"repository":"cambridgetcg"}'), base64url('signature-signature-signature')].join('.')
const NPM_TOKEN = ['npm', 'abcdefghijklmnopqrstuvwxyz0123456789AB'].join('_')
const STAGE_ID = 'A334E443-F464-45A5-9FAC-CFEDE11AE2B4'
const BYTES = new TextEncoder().encode('a packed tarball, as far as these tests need one\n')

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function scratch(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// A repository holding one package and, unless told otherwise, its
// annotated release tag on HEAD.
function makeRepo(t, { key = 'core', version = '0.1.3', tag = `${key}-v${version}`, annotated = true, manifest = {} } = {}) {
  const root = scratch(t, 'rhetorlint-release-repo-')
  const dir = join(root, 'packages', key)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name: `@rhetorlint/${key}`,
    version,
    publishConfig: { access: 'public' },
    repository: { type: 'git', url: release.REPOSITORY_URL, directory: `packages/${key}` },
    ...manifest,
  }, null, 2)}\n`)
  writeFileSync(join(dir, 'index.mjs'), 'export {}\n')
  git(root, 'init', '-q')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'release')
  if (tag) annotated ? git(root, 'tag', '-a', '-m', tag, tag) : git(root, 'tag', tag)
  return { root, commit: git(root, 'rev-parse', 'HEAD'), tag, key, version }
}

function actionsEnv(repo, extra = {}) {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: release.REPOSITORY,
    GITHUB_REF: `refs/tags/${repo.tag}`,
    GITHUB_SHA: repo.commit,
    ...extra,
  }
}

// npm answers --version, pack and stage publish; anything else fails.
function fakeNpm({ version = release.PINNED_NPM, bytes = BYTES, packOverrides = {}, stage } = {}) {
  return (args, options) => {
    if (args[0] === '--version') return { status: 0, stdout: `${version}\n`, stderr: '' }
    if (args[0] === 'pack') {
      assert.deepEqual(args.slice(0, 3), ['pack', '--ignore-scripts', '--json'])
      const dest = args[args.indexOf('--pack-destination') + 1]
      const manifest = JSON.parse(readFileSync(join(options.cwd, 'package.json'), 'utf8'))
      const filename = release.packedFilename(manifest.name, manifest.version)
      writeFileSync(join(dest, filename), bytes)
      const id = release.artifactIdentity(bytes, filename)
      return {
        status: 0,
        stdout: JSON.stringify([{ name: manifest.name, version: manifest.version, filename, shasum: id.sha1, integrity: id.integrity, files: [{ path: 'package.json' }], ...packOverrides }]),
        stderr: '',
      }
    }
    if (args[0] === 'stage' && stage) return stage(args, options)
    return { status: 1, stdout: '', stderr: `fake npm refuses ${args.join(' ')}` }
  }
}

// The registry: package documents by name (a function is read on each
// request) and tarballs by path. Every request is recorded.
function fakeRegistry(docs = {}, tarballs = {}) {
  const requests = []
  const fetch = async (url, init = {}) => {
    requests.push({ url, init })
    const parsed = new URL(url)
    assert.equal(parsed.origin, release.REGISTRY, `unexpected fetch ${url}`)
    if (Object.hasOwn(tarballs, parsed.pathname)) return new Response(tarballs[parsed.pathname])
    const doc = docs[decodeURIComponent(parsed.pathname.slice(1))]
    const value = typeof doc === 'function' ? doc() : doc
    return value ? new Response(JSON.stringify(value)) : new Response('{"error":"Not found"}', { status: 404 })
  }
  return { fetch, requests }
}

function makeCtx(repo, { env = {}, npm = fakeNpm(), fetch = fakeRegistry().fetch, nodeVersion = '24.11.1', clock = () => 0 } = {}) {
  const logs = []
  const calls = []
  return {
    root: repo.root,
    env,
    logs,
    calls,
    run(command, args, options = {}) {
      calls.push({ command, args, options })
      if (command === 'npm') return npm(args, options)
      const result = spawnSync(command, args, { cwd: options.cwd, env: GIT_ENV, encoding: 'utf8' })
      return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
    fetch,
    sleeps: 0,
    async sleep() { this.sleeps += 1 },
    clock,
    log: line => logs.push(String(line)),
    nodeVersion,
    now: () => new Date('2026-11-06T12:00:00.000Z'),
  }
}

// A repository, its tag, and a prepared receipt + tarball in RUNNER_TEMP.
function prepared(t, options = {}) {
  const repo = makeRepo(t, options)
  const out = join(scratch(t, 'rhetorlint-release-out-'), 'npm-release')
  const receipt = release.prepare(makeCtx(repo, { env: actionsEnv(repo) }), { package: repo.key, tag: repo.tag, output: out })
  return { repo, out, receipt, receiptPath: join(out, 'receipt.json') }
}

function packageDoc(receipt, { distTag = receipt.package.version, dist = { integrity: receipt.artifact.integrity, shasum: receipt.artifact.sha1 }, present = true } = {}) {
  const { name, version } = receipt.package
  const tarball = `${release.REGISTRY}/${name}/-/${name.split('/')[1]}-${version}.tgz`
  return {
    name,
    'dist-tags': { latest: distTag },
    versions: {
      '0.1.2': { dist: { integrity: 'sha512-old', shasum: 'old' } },
      ...(present ? { [version]: { name, version, dist: { ...dist, tarball } } } : {}),
    },
  }
}

const tarballPath = receipt => `/${receipt.package.name}/-/${receipt.package.name.split('/')[1]}-${receipt.package.version}.tgz`

// ---- inputs ------------------------------------------------------------

test('only the three packages and the two dist-tags are accepted', () => {
  for (const key of ['core', 'rules-en', 'cli']) assert.equal(release.packageSpec(key).name, `@rhetorlint/${key}`)
  for (const key of ['', 'all', 'CORE', ' core', '../core', 'toString']) assert.throws(() => release.packageSpec(key), /package must be one of/)
  release.validateNpmTag('0.1.3', 'latest')
  release.validateNpmTag('0.1.3', 'next')
  release.validateNpmTag('0.2.0-rc.1', 'next')
  assert.throws(() => release.validateNpmTag('0.1.3', 'beta'), /dist-tag must be one of/)
  assert.throws(() => release.validateNpmTag('0.2.0-rc.1', 'latest'), /prerelease .* next/)
})

test('an annotated tag <package>-v<version> on HEAD, dispatched on itself, passes', t => {
  const repo = makeRepo(t)
  const facts = release.checkInputs(makeCtx(repo, { env: actionsEnv(repo) }), { package: 'core', tag: 'core-v0.1.3', npmTag: 'latest' })
  assert.deepEqual(facts, { package: 'core', name: '@rhetorlint/core', version: '0.1.3', tag: 'core-v0.1.3', commit: repo.commit, npm_tag: 'latest' })
})

test('a lightweight, misnamed, missing or other package tag is refused', t => {
  const light = makeRepo(t, { annotated: false })
  assert.throws(() => release.checkInputs(makeCtx(light), { package: 'core', tag: 'core-v0.1.3' }), /must be an annotated tag/)
  const repo = makeRepo(t)
  const check = tag => () => release.checkInputs(makeCtx(repo), { package: 'core', tag })
  assert.throws(check('core-v0.1.2'), /releases only from tag core-v0\.1\.3/)
  assert.throws(check('v0.1.3-rules-0.2.0'), /releases only from tag core-v0\.1\.3/)
  assert.throws(check('rules-en-v0.1.3'), /releases only from tag core-v0\.1\.3/)
  const untagged = makeRepo(t, { tag: null })
  assert.throws(() => release.checkInputs(makeCtx(untagged), { package: 'core', tag: 'core-v0.1.3' }), /not in this checkout/)
})

test('the run must be on the tag ref and commit, with the pinned npm and Node 24', t => {
  const repo = makeRepo(t)
  const check = (env, extra = {}) => () => release.checkInputs(makeCtx(repo, { env: actionsEnv(repo, env), ...extra }), { package: 'core', tag: repo.tag })
  assert.throws(check({ GITHUB_REF: 'refs/heads/main' }), /dispatch this workflow on the tag itself/)
  assert.throws(check({ GITHUB_SHA: '0'.repeat(40) }), /is not core-v0\.1\.3's commit/)
  assert.throws(check({ GITHUB_EVENT_NAME: 'push' }), /runs only in a workflow_dispatch/)
  assert.throws(check({ GITHUB_REPOSITORY: 'someone/fork' }), /runs only in a workflow_dispatch/)
  assert.throws(check({}, { npm: fakeNpm({ version: '11.6.2' }) }), /requires npm 11\.17\.0, found 11\.6\.2/)
  assert.throws(check({}, { nodeVersion: '25.2.1' }), /requires Node 24/)
})

test('a dirty checkout, a HEAD past the tag, or a foreign repository URL is refused', t => {
  const dirty = makeRepo(t)
  writeFileSync(join(dirty.root, 'stray.txt'), 'x\n')
  assert.throws(() => release.checkInputs(makeCtx(dirty), { package: 'core', tag: dirty.tag }), /uncommitted or untracked/)
  const moved = makeRepo(t)
  writeFileSync(join(moved.root, 'later.txt'), 'x\n')
  git(moved.root, 'add', '-A')
  git(moved.root, 'commit', '-q', '-m', 'after the tag')
  assert.throws(() => release.checkInputs(makeCtx(moved), { package: 'core', tag: moved.tag }), /is not the commit/)
  const foreign = makeRepo(t, { manifest: { repository: { type: 'git', url: 'git+https://github.com/someone/fork.git', directory: 'packages/core' } } })
  assert.throws(() => release.checkInputs(makeCtx(foreign), { package: 'core', tag: foreign.tag }), /repository must be/)
})

// ---- prepare -------------------------------------------------------------

test('prepare packs without scripts and records the exact bytes', t => {
  const { repo, out, receipt } = prepared(t)
  const artifact = release.artifactIdentity(BYTES, 'rhetorlint-core-0.1.3.tgz')
  assert.deepEqual(receipt, {
    schema: release.SCHEMAS.receipt,
    package: { key: 'core', name: '@rhetorlint/core', version: '0.1.3' },
    tag: 'core-v0.1.3',
    commit: repo.commit,
    artifact,
  })
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8')), receipt)
  assert.deepEqual(release.readReceipt(join(out, 'receipt.json')), receipt)
  assert.equal(artifact.integrity.length, 'sha512-'.length + 88)
})

test('prepare refuses an output inside the checkout, a used output, or digests npm misreports', t => {
  const repo = makeRepo(t)
  const ctx = makeCtx(repo, { env: actionsEnv(repo) })
  assert.throws(() => release.prepare(ctx, { package: 'core', tag: repo.tag, output: join(repo.root, 'out') }), /outside the checkout/)
  const used = scratch(t, 'rhetorlint-release-used-')
  writeFileSync(join(used, 'old.tgz'), 'old')
  assert.throws(() => release.prepare(ctx, { package: 'core', tag: repo.tag, output: used }), /must be empty/)
  const lying = makeCtx(repo, { env: actionsEnv(repo), npm: fakeNpm({ packOverrides: { integrity: 'sha512-other' } }) })
  assert.throws(() => release.prepare(lying, { package: 'core', tag: repo.tag, output: join(scratch(t, 'rhetorlint-release-out-'), 'x') }), /digests that the tarball does not have/)
})

test('prepare refuses a pack that left files behind in the checkout', t => {
  const repo = makeRepo(t)
  const pack = fakeNpm()
  const messy = (args, options) => {
    if (args[0] === 'pack') writeFileSync(join(options.cwd, 'pack-leftover.txt'), 'x\n')
    return pack(args, options)
  }
  const ctx = makeCtx(repo, { env: actionsEnv(repo), npm: messy })
  assert.throws(() => release.prepare(ctx, { package: 'core', tag: repo.tag, output: join(scratch(t, 'rhetorlint-release-out-'), 'x') }), /uncommitted or untracked/)
})

test('a receipt with an extra key or a malformed digest is refused', t => {
  const { receipt } = prepared(t)
  const dir = scratch(t, 'rhetorlint-release-receipt-')
  const write = value => {
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify(value))
    return join(dir, 'receipt.json')
  }
  assert.throws(() => release.readReceipt(write({ ...receipt, result: 'published' })), /exactly/)
  assert.throws(() => release.readReceipt(write({ ...receipt, artifact: { ...receipt.artifact, sha256: 'abc' } })), /malformed/)
  assert.throws(() => release.readReceipt(write({ ...receipt, package: { ...receipt.package, name: '@other/core' } })), /allowlisted/)
})

// ---- plan ----------------------------------------------------------------

test('plan stages a version npm lacks and writes the step output', t => {
  const { repo, receipt, receiptPath } = prepared(t)
  const gh = scratch(t, 'rhetorlint-release-gh-')
  const { fetch, requests } = fakeRegistry({ '@rhetorlint/core': packageDoc(receipt, { present: false, distTag: '0.1.2' }) })
  const ctx = makeCtx(repo, { env: actionsEnv(repo, { GITHUB_OUTPUT: join(gh, 'output'), GITHUB_STEP_SUMMARY: join(gh, 'summary') }), fetch })
  return release.plan(ctx, { receipt: receiptPath, npmTag: 'latest' }).then(planned => {
    assert.equal(planned.planned_action, 'stage')
    assert.equal(planned.registry_dist_tag_now, '0.1.2')
    assert.equal(readFileSync(join(gh, 'output'), 'utf8'), 'action=stage\n')
    assert.match(readFileSync(join(gh, 'summary'), 'utf8'), /^## Planned action: `stage`\n/)
    assert.match(requests[0].url, /^https:\/\/registry\.npmjs\.org\/@rhetorlint%2Fcore\?rhetorlint_release_check=[0-9a-f-]{36}$/)
  })
})

test('plan verifies a version npm has with these bytes, and refuses other bytes', async t => {
  const { repo, receipt, receiptPath } = prepared(t)
  const same = makeCtx(repo, { env: actionsEnv(repo), fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt) }).fetch })
  assert.equal((await release.plan(same, { receipt: receiptPath, npmTag: 'latest' })).planned_action, 'verify-existing')
  const other = makeCtx(repo, { env: actionsEnv(repo), fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt, { dist: { integrity: 'sha512-x', shasum: 'y' } }) }).fetch })
  await assert.rejects(release.plan(other, { receipt: receiptPath, npmTag: 'latest' }), /bytes different .* bump it/)
  const missing = makeCtx(repo, { env: actionsEnv(repo), fetch: fakeRegistry({}).fetch })
  await assert.rejects(release.plan(missing, { receipt: receiptPath, npmTag: 'latest' }), /npm has no package/)
})

test('plan refuses a tarball that changed after its receipt, or a receipt from another commit', async t => {
  const { repo, out, receipt, receiptPath } = prepared(t)
  const fetch = fakeRegistry({ '@rhetorlint/core': packageDoc(receipt, { present: false }) }).fetch
  writeFileSync(receiptPath, JSON.stringify({ ...receipt, commit: 'f'.repeat(40) }))
  await assert.rejects(release.plan(makeCtx(repo, { env: actionsEnv(repo), fetch }), { receipt: receiptPath, npmTag: 'latest' }), /does not describe this checkout/)
  writeFileSync(receiptPath, JSON.stringify(receipt))
  writeFileSync(join(out, receipt.artifact.filename), 'swapped')
  await assert.rejects(release.plan(makeCtx(repo, { env: actionsEnv(repo), fetch }), { receipt: receiptPath, npmTag: 'latest' }), /changed after its receipt/)
})

test('a version npm has is the same artifact only if both its digests match', t => {
  const { receipt } = prepared(t)
  const served = dist => ({ status: 200, doc: packageDoc(receipt, { dist }) })
  const { integrity, sha1: shasum } = receipt.artifact
  assert.equal(release.decide(receipt, served({ integrity, shasum })), 'verify-existing')
  assert.throws(() => release.decide(receipt, served({ integrity, shasum: '0'.repeat(40) })), /bytes different/)
  assert.throws(() => release.decide(receipt, served({ integrity: `sha512-${'A'.repeat(86)}==`, shasum })), /bytes different/)
  assert.equal(release.decide(receipt, { status: 200, doc: packageDoc(receipt, { present: false }) }), 'stage')
  assert.throws(() => release.decide(receipt, { status: 403 }), /answered HTTP 403/)
})

test('latest never moves backwards: an older version than npm\'s latest goes to next', async t => {
  const { repo, receipt, receiptPath } = prepared(t)
  const ahead = makeCtx(repo, { env: actionsEnv(repo), fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt, { present: false, distTag: '0.1.4' }) }).fetch })
  await assert.rejects(release.plan(ahead, { receipt: receiptPath, npmTag: 'latest' }), /latest for @rhetorlint\/core is 0\.1\.4, newer than 0\.1\.3.*npm_tag next/)
  assert.equal((await release.plan(ahead, { receipt: receiptPath, npmTag: 'next' })).planned_action, 'stage')
  for (const latest of ['0.1.2', '0.0.9', '0.2.0-rc.1']) {
    const behind = makeCtx(repo, { env: actionsEnv(repo), fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt, { present: false, distTag: latest }) }).fetch })
    assert.equal((await release.plan(behind, { receipt: receiptPath, npmTag: 'latest' })).planned_action, 'stage', latest)
  }
  const { npm, seen } = stagingNpm(receipt)
  const staging = makeCtx(repo, { env: oidcEnv(repo), npm, fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt, { present: false, distTag: '0.1.10' }) }).fetch })
  await assert.rejects(release.stage(staging, { receipt: receiptPath, npmTag: 'latest' }), /would move latest backwards/)
  assert.equal(seen.args, undefined, 'npm never ran')
})

test('cli is staged only once npm can install its @rhetorlint dependencies', async t => {
  const { repo, receipt, receiptPath } = prepared(t, {
    key: 'cli',
    version: '0.2.0',
    manifest: { dependencies: { '@rhetorlint/core': '^0.1.4', '@rhetorlint/rules-en': '^0.2.0' } },
  })
  const cli = packageDoc(receipt, { present: false, distTag: '0.1.1' })
  const versions = list => ({ versions: Object.fromEntries(list.map(v => [v, {}])) })
  const early = makeCtx(repo, { env: actionsEnv(repo), fetch: fakeRegistry({ '@rhetorlint/cli': cli, '@rhetorlint/core': versions(['0.1.2', '0.1.3']), '@rhetorlint/rules-en': versions(['0.1.2']) }).fetch })
  await assert.rejects(release.plan(early, { receipt: receiptPath, npmTag: 'latest' }), /needs @rhetorlint\/core \^0\.1\.4.*release @rhetorlint\/core first \(order: core, rules-en, cli\)/)
  const ready = makeCtx(repo, { env: actionsEnv(repo), fetch: fakeRegistry({ '@rhetorlint/cli': cli, '@rhetorlint/core': versions(['0.1.4']), '@rhetorlint/rules-en': versions(['0.2.1']) }).fetch })
  assert.equal((await release.plan(ready, { receipt: receiptPath, npmTag: 'latest' })).planned_action, 'stage')
})

test('caret ranges read as npm reads them for stable versions', () => {
  const cases = [
    ['0.1.4', '^0.1.4', true], ['0.1.10', '^0.1.4', true], ['0.1.3', '^0.1.4', false], ['0.2.0', '^0.1.4', false],
    ['0.2.1', '^0.2.0', true], ['0.3.0', '^0.2.0', false], ['1.4.0', '^1.2.3', true], ['2.0.0', '^1.2.3', false],
    ['0.0.3', '^0.0.3', true], ['0.0.4', '^0.0.3', false], ['0.2.0-rc.1', '^0.2.0', false],
  ]
  for (const [version, range, expected] of cases) assert.equal(release.satisfiesCaret(version, range), expected, `${version} ${range}`)
  assert.throws(() => release.satisfiesCaret('0.1.4', '>=0.1.4'), /unsupported dependency range/)
})

// ---- check-trust ---------------------------------------------------------

// GitHub's ID-token service and npm's exchange. `redirects` maps a URL to
// the [status, location] it answers instead.
function oidcService({ idStatus = 200, idBody = { value: ID_TOKEN }, exchangeStatus = 200, exchangeBody = { token: NPM_TOKEN }, redirects = {} } = {}) {
  const requests = []
  const fetch = async (url, init = {}) => {
    requests.push({ url, init })
    if (Object.hasOwn(redirects, url)) return new Response(null, { status: redirects[url][0], headers: { location: redirects[url][1] } })
    if (url.startsWith('https://token.actions.example/')) return new Response(JSON.stringify(idBody), { status: idStatus })
    return new Response(JSON.stringify(exchangeBody), { status: exchangeStatus })
  }
  return { fetch, requests }
}

const oidcEnv = repo => actionsEnv(repo, {
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/idtoken?api-version=2.0',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-bearer',
})

test("check-trust makes npm's OIDC exchange, masks both tokens and prints neither", async t => {
  const repo = makeRepo(t)
  const { fetch, requests } = oidcService()
  const ctx = makeCtx(repo, { env: oidcEnv(repo), fetch })
  const answer = await release.checkTrust(ctx, { package: 'core' })
  assert.match(answer.trusted_publisher, /token was discarded unused/)
  const [issue, exchange] = requests
  assert.equal(new URL(issue.url).searchParams.get('audience'), 'npm:registry.npmjs.org')
  assert.equal(issue.init.headers.authorization, 'Bearer request-bearer')
  assert.equal(exchange.url, 'https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@rhetorlint%2fcore')
  assert.equal(exchange.init.method, 'POST')
  assert.deepEqual(exchange.init.headers, { accept: 'application/json', authorization: `Bearer ${ID_TOKEN}`, 'npm-auth-type': 'web', 'npm-command': 'stage' })
  assert.deepEqual(ctx.logs, [`::add-mask::${ID_TOKEN}`, `::add-mask::${NPM_TOKEN}`])
  assert.ok(!JSON.stringify(answer).includes(NPM_TOKEN))
})

test('check-trust names a missing trust config and never echoes the ID token', async t => {
  const repo = makeRepo(t)
  for (const status of [401, 403, 404]) {
    const ctx = makeCtx(repo, { env: oidcEnv(repo), fetch: oidcService({ exchangeStatus: status, exchangeBody: { message: `OIDC token exchange error - package not found ${ID_TOKEN}` } }).fetch })
    const refusal = await release.checkTrust(ctx, { package: 'rules-en' }).catch(error => error.message)
    assert.match(refusal, /no trusted publisher matches this workflow for @rhetorlint\/rules-en/)
    assert.match(refusal, /cambridgetcg\/rhetorlint-spec, workflow publish-npm\.yml and environment npm-release/)
    assert.match(refusal, /package not found \*\*\*/)
    assert.match(refusal, /Nothing was staged/)
    assert.ok(!refusal.includes(ID_TOKEN))
  }
  const busy = makeCtx(repo, { env: oidcEnv(repo), fetch: oidcService({ exchangeStatus: 503, exchangeBody: {} }).fetch })
  await assert.rejects(release.checkTrust(busy, { package: 'core' }), /unavailable \(HTTP 503\); dispatch again later/)
})

test('check-trust refuses a 200 without a token, a 400, and a failed or non-HTTPS ID-token request', async t => {
  const repo = makeRepo(t)
  const empty = makeCtx(repo, { env: oidcEnv(repo), fetch: oidcService({ exchangeBody: {} }).fetch })
  await assert.rejects(release.checkTrust(empty, { package: 'core' }), /answered HTTP 200 without a usable token/)
  const bad = makeCtx(repo, { env: oidcEnv(repo), fetch: oidcService({ exchangeStatus: 400, exchangeBody: { message: 'bad request' } }).fetch })
  await assert.rejects(release.checkTrust(bad, { package: 'core' }), /gave this workflow no token for @rhetorlint\/core \(HTTP 400: bad request\)/)
  // A failed status refuses even with a token-shaped body; a 200 needs a value.
  for (const [idStatus, idBody] of [[500, { value: ID_TOKEN }], [200, {}]]) {
    const refused = oidcService({ idStatus, idBody })
    await assert.rejects(release.checkTrust(makeCtx(repo, { env: oidcEnv(repo), fetch: refused.fetch }), { package: 'core' }), new RegExp(`GitHub issued no OIDC ID token for npm:registry\\.npmjs\\.org \\(HTTP ${idStatus}\\)`))
    assert.equal(refused.requests.length, 1, 'no exchange without an ID token')
  }
  const plain = oidcService()
  const env = { ...oidcEnv(repo), ACTIONS_ID_TOKEN_REQUEST_URL: 'http://token.actions.example/idtoken' }
  await assert.rejects(release.checkTrust(makeCtx(repo, { env, fetch: plain.fetch }), { package: 'core' }), /not HTTPS/)
  assert.equal(plain.requests.length, 0)
})

test('check-trust follows a redirect within one origin, as npm does, and refuses one to another', async t => {
  const repo = makeRepo(t)
  const exchange = 'https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@rhetorlint%2fcore'
  const moved = oidcService({ redirects: { [exchange]: [307, '/-/npm/v1/oidc/token/exchange/package/@rhetorlint%2fcore?moved=1'] } })
  await release.checkTrust(makeCtx(repo, { env: oidcEnv(repo), fetch: moved.fetch }), { package: 'core' })
  assert.deepEqual(moved.requests.slice(1).map(r => [r.url, r.init.method, r.init.headers.authorization]), [
    [exchange, 'POST', `Bearer ${ID_TOKEN}`],
    [`${exchange}?moved=1`, 'POST', `Bearer ${ID_TOKEN}`],
  ])
  const seeOther = oidcService({ redirects: { [exchange]: [303, `${exchange}?moved=1`] } })
  await release.checkTrust(makeCtx(repo, { env: oidcEnv(repo), fetch: seeOther.fetch }), { package: 'core' })
  assert.equal(seeOther.requests.at(-1).init.method, 'GET')
  const away = oidcService({ redirects: { [exchange]: [302, 'https://elsewhere.example/exchange'] } })
  await assert.rejects(release.checkTrust(makeCtx(repo, { env: oidcEnv(repo), fetch: away.fetch }), { package: 'core' }), /HTTP 302, a redirect check-trust does not follow/)
  assert.ok(away.requests.every(r => !r.url.startsWith('https://elsewhere.example/')), 'the ID token never leaves the origin')
})

test('check-trust refuses outside the workflow or without id-token: write', async t => {
  const repo = makeRepo(t)
  await assert.rejects(release.checkTrust(makeCtx(repo, { env: {} }), { package: 'core' }), /runs only in a workflow_dispatch/)
  await assert.rejects(release.checkTrust(makeCtx(repo, { env: actionsEnv(repo) }), { package: 'core' }), /id-token: write/)
})

// ---- stage ---------------------------------------------------------------

test('oidc log lines keep every level of oidc line and redact token shapes', () => {
  const lines = release.oidcLogLines([
    '0 verbose cli /usr/local/bin/node /usr/local/bin/npm',
    '14 silly oidc Skipped because incorrect permissions for id-token within GitHub workflow',
    `15 verbose oidc Failed token exchange request with body message: bad ${ID_TOKEN}`,
    `16 verbose oidc Successfully retrieved and set token ${NPM_TOKEN}`,
    '17 http fetch PUT 200 https://registry.npmjs.org/-/stage 120ms',
  ].join('\r\n'))
  assert.deepEqual(lines, [
    '14 silly oidc Skipped because incorrect permissions for id-token within GitHub workflow',
    '15 verbose oidc Failed token exchange request with body message: bad ***',
    '16 verbose oidc Successfully retrieved and set token ***',
  ])
})

function stagingNpm(receipt, { status = 0, stdout } = {}) {
  const seen = {}
  const stage = (args, options) => {
    seen.args = args
    seen.env = options.env
    const logsDir = args[args.indexOf('--logs-dir') + 1]
    writeFileSync(join(logsDir, '2026-11-06T12_00_00_000Z-debug-0.log'), [
      '1 verbose cli npm stage publish',
      `20 verbose oidc Successfully retrieved and set token ${NPM_TOKEN}`,
      `21 verbose oidc id token was ${ID_TOKEN}`,
    ].join('\n'))
    const record = { [receipt.package.name]: { id: `${receipt.package.name}@${receipt.package.version}`, name: receipt.package.name, version: receipt.package.version, shasum: receipt.artifact.sha1, integrity: receipt.artifact.integrity, stageId: STAGE_ID } }
    return { status, stdout: stdout ?? JSON.stringify(record, null, 2), stderr: '' }
  }
  return { npm: fakeNpm({ stage }), seen }
}

test('stage runs npm stage publish on the tarball with an empty token and keeps its oidc lines', async t => {
  const { repo, out, receipt, receiptPath } = prepared(t)
  const summaryFile = join(scratch(t, 'rhetorlint-release-gh-'), 'summary')
  const { npm, seen } = stagingNpm(receipt)
  const env = { ...oidcEnv(repo), NODE_AUTH_TOKEN: 'XXXXX-XXXXX-XXXXX-XXXXX', GITHUB_STEP_SUMMARY: summaryFile }
  const ctx = makeCtx(repo, { env, npm, fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt, { present: false }) }).fetch })
  const staged = await release.stage(ctx, { receipt: receiptPath, npmTag: 'latest' })

  const logsDir = seen.args[seen.args.indexOf('--logs-dir') + 1]
  assert.deepEqual(seen.args, release.stageArguments(join(out, receipt.artifact.filename), 'latest', logsDir))
  assert.deepEqual(seen.args.slice(0, 11), ['stage', 'publish', join(out, receipt.artifact.filename), '--access', 'public', '--tag', 'latest', '--provenance', '--ignore-scripts', '--json', '--logs-dir'])
  assert.ok(Object.hasOwn(seen.env, 'NODE_AUTH_TOKEN'))
  assert.equal(seen.env.NODE_AUTH_TOKEN, '')
  assert.equal(existsSync(logsDir), false, 'the debug log directory is removed')

  assert.equal(staged.stage_id, STAGE_ID.toLowerCase())
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'stage.json'), 'utf8')), staged)
  assert.deepEqual(staged.artifact, receipt.artifact)
  const printed = ctx.logs.join('\n')
  assert.match(printed, /npm's oidc log lines:\n20 verbose oidc Successfully retrieved and set token \*\*\*\n21 verbose oidc id token was \*\*\*/)
  assert.ok(!printed.includes(NPM_TOKEN) && !printed.includes(ID_TOKEN))
  const summary = readFileSync(summaryFile, 'utf8')
  assert.match(summary, /npx --yes npm@11\.17\.0 stage approve a334e443-f464-45a5-9fac-cfede11ae2b4/)
  assert.ok(summary.includes(receipt.artifact.sha256))
  assert.match(summary, /E409/)
})

test('a failed exchange surfaces as ENEEDAUTH with the oidc lines still printed', async t => {
  const { repo, receipt, receiptPath } = prepared(t)
  const { npm } = stagingNpm(receipt, { status: 1, stdout: JSON.stringify({ error: { code: 'ENEEDAUTH', summary: 'This command requires you to be logged in' } }) })
  const ctx = makeCtx(repo, { env: oidcEnv(repo), npm, fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt, { present: false }) }).fetch })
  await assert.rejects(release.stage(ctx, { receipt: receiptPath, npmTag: 'latest' }), /ENEEDAUTH.*stopped before signing provenance or staging/)
  assert.match(ctx.logs.join('\n'), /npm's oidc log lines:/)
})

test('stage refuses before npm runs when the version is already on npm, or staged bytes differ', async t => {
  const { repo, receipt, receiptPath } = prepared(t)
  const { npm, seen } = stagingNpm(receipt)
  const present = makeCtx(repo, { env: oidcEnv(repo), npm, fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt) }).fetch })
  await assert.rejects(release.stage(present, { receipt: receiptPath, npmTag: 'latest' }), /already has .* nothing to stage/)
  assert.equal(seen.args, undefined)
  const record = { '@rhetorlint/core': { name: '@rhetorlint/core', version: '0.1.3', shasum: 'other', integrity: receipt.artifact.integrity, stageId: STAGE_ID } }
  const wrong = makeCtx(repo, { env: oidcEnv(repo), npm: stagingNpm(receipt, { stdout: JSON.stringify(record) }).npm, fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt, { present: false }) }).fetch })
  await assert.rejects(release.stage(wrong, { receipt: receiptPath, npmTag: 'latest' }), /staged bytes different/)
})

test("npm's stage record must name the version, carry the receipt's digests and a stage id", t => {
  const { receipt } = prepared(t)
  const { name, version } = receipt.package
  const record = { name, version, shasum: receipt.artifact.sha1, integrity: receipt.artifact.integrity, stageId: STAGE_ID }
  const parse = changes => release.parseStageOutput(JSON.stringify({ [name]: { ...record, ...changes } }), receipt)
  assert.equal(parse({}), STAGE_ID.toLowerCase())
  assert.throws(() => parse({ version: '0.1.4' }), /different package or version/)
  assert.throws(() => parse({ name: '@rhetorlint/cli' }), /different package or version/)
  assert.throws(() => parse({ integrity: `sha512-${'A'.repeat(86)}==` }), /staged bytes different/)
  assert.throws(() => parse({ stageId: undefined }), /no valid stage id/)
  assert.throws(() => parse({ stageId: 'not-a-uuid' }), /no valid stage id/)
  assert.throws(() => release.parseStageOutput('{}', receipt), /printed no record/)
  assert.throws(() => release.parseStageOutput('npm warn something', receipt), /printed no record/)
})

// ---- verify-existing -----------------------------------------------------

test('verify-existing records already_published_exact once npm serves the same bytes under the tag', async t => {
  const { repo, out, receipt, receiptPath } = prepared(t)
  let reads = 0
  const doc = () => (reads += 1) < 3 ? packageDoc(receipt, { distTag: '0.1.2' }) : packageDoc(receipt)
  const ctx = makeCtx(repo, { env: actionsEnv(repo), fetch: fakeRegistry({ '@rhetorlint/core': doc }, { [tarballPath(receipt)]: BYTES }).fetch })
  const result = await release.verifyExisting(ctx, { receipt: receiptPath, npmTag: 'latest', attempts: 5 })
  assert.equal(result.status, 'already_published_exact')
  assert.equal(result.registry_tarball, `https://registry.npmjs.org${tarballPath(receipt)}`)
  assert.equal(ctx.sleeps, 2)
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'result.json'), 'utf8')), result)
})

test('verify-existing refuses other bytes at once and a dist-tag that never arrives', async t => {
  const { repo, receipt, receiptPath } = prepared(t)
  const swapped = makeCtx(repo, { env: actionsEnv(repo), fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt) }, { [tarballPath(receipt)]: 'other bytes' }).fetch })
  await assert.rejects(release.verifyExisting(swapped, { receipt: receiptPath, npmTag: 'latest', attempts: 5 }), /not byte-identical/)
  assert.equal(swapped.sleeps, 0)
  const lagging = makeCtx(repo, { env: actionsEnv(repo), fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt, { distTag: '0.1.2' }) }).fetch })
  await assert.rejects(release.verifyExisting(lagging, { receipt: receiptPath, npmTag: 'latest', attempts: 3 }), /after 3 reads over 0 s: dist-tag latest points to 0\.1\.2, not 0\.1\.3/)
  assert.equal(lagging.sleeps, 2)
})

test('verify-existing refuses a foreign tarball URL or a 403 at once, and stops at its deadline', async t => {
  const { repo, receipt, receiptPath } = prepared(t)
  const doc = packageDoc(receipt)
  doc.versions[receipt.package.version].dist.tarball = `https://registry.example${tarballPath(receipt)}`
  const foreign = makeCtx(repo, { env: actionsEnv(repo), fetch: fakeRegistry({ '@rhetorlint/core': doc }).fetch })
  await assert.rejects(release.verifyExisting(foreign, { receipt: receiptPath, npmTag: 'latest', attempts: 5 }), /unexpected tarball URL/)
  assert.equal(foreign.sleeps, 0)
  const forbidden = makeCtx(repo, { env: actionsEnv(repo), fetch: async () => new Response('{}', { status: 403 }) })
  await assert.rejects(release.verifyExisting(forbidden, { receipt: receiptPath, npmTag: 'latest', attempts: 5 }), /answered HTTP 403/)
  assert.equal(forbidden.sleeps, 0)
  // A clock that moves a minute per look: the ten-minute deadline stops the
  // reads at ten, long before the 90 attempts.
  let now = 0
  const slow = makeCtx(repo, { env: actionsEnv(repo), clock: () => (now += 60_000), fetch: fakeRegistry({ '@rhetorlint/core': packageDoc(receipt, { distTag: '0.1.2' }) }).fetch })
  await assert.rejects(release.verifyExisting(slow, { receipt: receiptPath, npmTag: 'latest' }), /after 10 reads over 660 s: dist-tag latest/)
  assert.equal(slow.sleeps, 9)
})

// ---- command line ----------------------------------------------------------

test('the command line takes only the options each step needs', async t => {
  const repo = makeRepo(t)
  const ctx = makeCtx(repo)
  await assert.rejects(release.main(['publish', '--package', 'core'], ctx), /usage: npm-release\.mjs/)
  await assert.rejects(release.main(['check-trust', '--package', 'core', '--tag', 'core-v0.1.3'], ctx), /check-trust does not take --tag/)
  await assert.rejects(release.main(['check-inputs', '--package', 'core'], ctx), /check-inputs needs --tag/)
  await assert.rejects(release.main(['check-inputs', '--package', 'core', '--tag', 'core-v0.1.3', '--secret', 'x'], ctx), /Unknown option '--secret'/)
  const facts = await release.main(['check-inputs', '--package', 'core', '--tag', 'core-v0.1.3'], ctx)
  assert.equal(facts.commit, repo.commit)
  assert.equal(JSON.parse(ctx.logs.at(-1)).tag, 'core-v0.1.3')
})

// ---- the workflow and the repository around it -----------------------------

const WORKFLOW = read('.github/workflows/publish-npm.yml')
const job = name => {
  const start = WORKFLOW.indexOf(`\n  ${name}:\n`)
  assert.ok(start > 0, `job ${name}`)
  const next = WORKFLOW.slice(start + 1).search(/\n {2}[a-z-]+:\n/)
  return next < 0 ? WORKFLOW.slice(start) : WORKFLOW.slice(start, start + 1 + next)
}

test('the old direct-publish route is gone; the staged one is dispatch-only', () => {
  assert.equal(existsSync(new URL('.github/workflows/release.yml', REPO)), false)
  assert.equal(existsSync(new URL('scripts/publish-npm-ci.mjs', REPO)), false)
  assert.ok(existsSync(new URL('scripts/publish-npm-interactive.zsh', REPO)), 'the 2FA hand fallback stays')
  assert.match(WORKFLOW, /\non:\n {2}workflow_dispatch:\n/)
  assert.doesNotMatch(WORKFLOW, /\n {2}(push|pull_request|pull_request_target|schedule|workflow_run|release):/)
  assert.match(WORKFLOW, /\npermissions: \{\}\n/)
  assert.doesNotMatch(WORKFLOW, /secrets\./)
  assert.doesNotMatch(WORKFLOW, /npm publish\b/)
  for (const other of ['ci.yml', 'pages.yml']) assert.doesNotMatch(read(`.github/workflows/${other}`), /npm (stage )?publish/)
})

test('the dispatch inputs are the package, the tag, the dist-tag and a default dry run', () => {
  assert.match(WORKFLOW, new RegExp(`package:\\n(?: {8}.*\\n)*? {8}options:\\n${Object.keys(release.PACKAGES).map(key => ` {10}- ${key}\\n`).join('')}`))
  assert.match(WORKFLOW, /\n {6}tag:\n(?: {8}.*\n)*? {8}type: string\n/)
  assert.match(WORKFLOW, new RegExp(`npm_tag:\\n(?: {8}.*\\n)*? {8}options:\\n${release.NPM_TAGS.map(tag => ` {10}- ${tag}\\n`).join('')}`))
  assert.match(WORKFLOW, /dry_run:\n(?: {8}.*\n)*? {8}default: true\n {8}type: boolean\n/)
  assert.match(WORKFLOW, /\$\{\{ inputs\.tag \}\}/)
})

test('prepare holds no credential; only publish holds the id-token, in npm-release', () => {
  const prepare = job('prepare')
  const publish = job('publish')
  assert.match(prepare, /permissions:\n {6}contents: read\n {4}steps:/)
  assert.doesNotMatch(prepare, /id-token|environment:|NODE_AUTH_TOKEN|registry-url/)
  assert.match(prepare, /run: npm run "test:\$\{RELEASE_PACKAGE\}"/)
  assert.match(publish, /needs: prepare\n/)
  assert.match(publish, /if: github\.repository == 'cambridgetcg\/rhetorlint-spec' && !inputs\.dry_run\n/)
  assert.match(publish, new RegExp(`\\n {4}environment: ${release.ENVIRONMENT}\\n`))
  assert.match(publish, /permissions:\n {6}contents: read\n {6}id-token: write/)
  assert.match(publish, /NODE_AUTH_TOKEN: ""\n {8}run: node scripts\/npm-release\.mjs stage /)
  const trust = publish.indexOf('check-trust')
  assert.ok(trust > 0 && trust < publish.indexOf('npm-release.mjs stage '), 'check-trust runs before stage')
  assert.equal((publish.match(/if: steps\.plan\.outputs\.action == 'stage'/g) ?? []).length, 2)
  assert.match(publish, /if: steps\.plan\.outputs\.action == 'verify-existing'\n/)
})

test('every action is pinned by commit, and the runtime matches what the script requires', () => {
  const uses = [...WORKFLOW.matchAll(/uses: (\S+)/g)].map(match => match[1])
  assert.ok(uses.length >= 6)
  for (const use of uses) assert.match(use, /^actions\/[a-z-]+@[0-9a-f]{40}$/, use)
  assert.equal((WORKFLOW.match(new RegExp(`npm install --global --ignore-scripts npm@${release.PINNED_NPM.replace(/\./g, '\\.')}\\n`, 'g')) ?? []).length, 2)
  assert.equal((WORKFLOW.match(new RegExp(`node-version: ${release.NODE_MAJOR}\\n`, 'g')) ?? []).length, 2)
  assert.ok(release.WORKFLOW_FILE === 'publish-npm.yml' && existsSync(new URL(`.github/workflows/${release.WORKFLOW_FILE}`, REPO)))
  const commands = [...WORKFLOW.matchAll(/node scripts\/npm-release\.mjs ([a-z-]+)/g)].map(match => match[1])
  assert.deepEqual([...new Set(commands)].sort(), ['check-inputs', 'check-trust', 'plan', 'prepare', 'stage', 'verify-existing'])
})

// prepare runs test:<package>, so each list is a rule rather than a choice:
// every suite of the full run whose source names that package's files.
test("each package's release tests are every suite of npm test that names its files", () => {
  const { scripts } = JSON.parse(read('package.json'))
  const suites = scripts.test.replace(/^node --test /, '').split(' ').filter(file => file !== 'test/npm-release.test.mjs')
  for (const key of Object.keys(release.PACKAGES)) {
    const listed = (scripts[`test:${key}`] ?? '').replace(/^node --test /, '').split(' ').filter(Boolean)
    const naming = suites.filter(file => read(file).includes(`packages/${key}/`))
    assert.ok(listed.length > 0, `test:${key}`)
    assert.deepEqual([...listed].sort(), [...naming].sort(), `test:${key} must be exactly the suites that name packages/${key}/`)
  }
  assert.ok(scripts.test.split(' ').includes('test/npm-release.test.mjs'))
  assert.ok(!scripts.test.includes('publish-npm-ci'))
  const unlisted = readdirSync(new URL('test/', REPO)).filter(name => name.endsWith('.test.mjs') && !scripts.test.includes(`test/${name}`))
  assert.deepEqual(unlisted, ['claim-feedback-browser-real.test.mjs'], 'only the real-Chrome suite stays out of npm test')
})

test('the runbook creates stage-only trust configs that name this workflow and environment', () => {
  const runbook = read('NPM_DEPLOY.md')
  const trusts = runbook.split('\n').filter(line => /npm@\S+ trust github /.test(line))
  assert.ok(trusts.length > 0)
  for (const line of trusts) {
    assert.ok(line.includes(`npm@${release.PINNED_NPM} trust github`), line)
    assert.ok(line.includes(`--repo ${release.REPOSITORY} --file ${release.WORKFLOW_FILE} --env ${release.ENVIRONMENT} --allow-stage-publish`), line)
    assert.doesNotMatch(line, /--allow-publish\b/)
  }
  assert.doesNotMatch(runbook, /workflow run release\.yml|PUBLISH_PACKAGES/)
})

// npm's trust config cannot name a ref, and the ref checks above live in files
// a branch can rewrite, so the environment's tag policy is what ties npm's
// trust to release tags. The runbook sets it up before any trust config.
test("the runbook binds npm-release to the release tags before any trust config", () => {
  const runbook = read('NPM_DEPLOY.md')
  const staged = runbook.slice(runbook.indexOf('\n## The staged route\n'))
  const policy = staged.indexOf('/environments/npm-release/deployment-branch-policies')
  const trust = staged.search(/npm@\S+ trust github /)
  assert.ok(policy > 0 && trust > policy, 'the tag policy comes before the first trust config')
  assert.match(staged, /"deployment_branch_policy":\{"protected_branches":false,"custom_branch_policies":true\}/)
  for (const key of Object.keys(release.PACKAGES)) assert.ok(staged.includes(`-f name='${key}-v*' -f type=tag`), key)
  assert.match(job('publish'), /deployment policy/)
})
