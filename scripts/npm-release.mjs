#!/usr/bin/env node
// The staged npm release route for @rhetorlint/core, rules-en and cli: every
// decision .github/workflows/publish-npm.yml makes, one subcommand per step.
//
//   check-inputs     the dispatch names an allowlisted package, an annotated
//                    tag <package>-v<version> on the checked-out commit, and
//                    the version that package.json carries
//   prepare          npm pack --ignore-scripts, then a receipt of the bytes
//   plan             re-verify the bytes; ask the registry what is left to do
//   check-trust      make npm's OIDC exchange once, before staging anything
//   stage            npm stage publish: public only after a 2FA approval
//   verify-existing  the registry serves exactly the receipt's bytes
//
// prepare runs in a job with no credentials and no id-token; only stage
// receives an OIDC identity, and nothing it stages is public until a
// maintainer approves it on npm with 2FA. See NPM_DEPLOY.md.
//
// Adapted from cambridgetcg/agenttool-packages (Apache-2.0):
// bin/npm-release.ts and .github/workflows/publish-npm.yml. This keeps their
// shape (prepare without credentials, check-trust, stage, verify-existing)
// in a smaller, zero-dependency form for three packages.

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const REPOSITORY = 'cambridgetcg/rhetorlint-spec'
export const REPOSITORY_URL = `git+https://github.com/${REPOSITORY}.git`
// With REPOSITORY, the two claims an npm trust config for this route names.
export const WORKFLOW_FILE = 'publish-npm.yml'
export const ENVIRONMENT = 'npm-release'
export const PINNED_NPM = '11.17.0'
export const NODE_MAJOR = '24'
export const REGISTRY = 'https://registry.npmjs.org'
export const OIDC_AUDIENCE = 'npm:registry.npmjs.org'
export const PACKAGES = { core: '@rhetorlint/core', 'rules-en': '@rhetorlint/rules-en', cli: '@rhetorlint/cli' }
export const NPM_TAGS = ['latest', 'next']
export const SCHEMAS = { receipt: 'rhetorlint.npm-release/1', stage: 'rhetorlint.npm-stage/1', result: 'rhetorlint.npm-result/1' }

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const COMMIT = /^[0-9a-f]{40}$/
// npm's own stage-id check (lib/utils/validate-uuid.js in npm 11.17.0).
const STAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A value one ::add-mask:: line can hide as it is: printable ASCII, no space
// and no `%`, which the runner would decode first.
const BEARER = /^[\x21-\x24\x26-\x7e]+$/
// @npmcli/redact's JSON_WEB_TOKEN and NPM_SECRET patterns (npm 11.17.0). npm
// redacts only the second in its debug log, so a JWT reaches the log as it is.
const TOKEN_SHAPES = [
  /\b[A-Za-z0-9-_]{10,}(?!\.\d+\.)\.[A-Za-z0-9-_]{3,}\.[A-Za-z0-9-_]{20,}\b/gi,
  /\b(npms?_)[a-zA-Z0-9]{36,48}\b/gi,
]

function fail(message) {
  throw new Error(message)
}

// Everything that touches the world, so the tests can hand in fakes.
export function context(overrides = {}) {
  return {
    root: ROOT,
    env: process.env,
    run(command, args, options = {}) {
      const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
      if (result.error) fail(`${command} could not run: ${result.error.message}`)
      return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
    fetch: (url, init) => globalThis.fetch(url, init),
    sleep: ms => delay(ms),
    log: line => console.log(line),
    nodeVersion: process.versions.node,
    now: () => new Date(),
    ...overrides,
  }
}

export function packageSpec(key) {
  if (!Object.hasOwn(PACKAGES, key)) fail(`package must be one of ${Object.keys(PACKAGES).join(', ')}, not ${JSON.stringify(key)}`)
  return { key, name: PACKAGES[key], dir: `packages/${key}` }
}

export function expectedTag(key, version) {
  return `${key}-v${version}`
}

export function validateNpmTag(version, npmTag) {
  if (!NPM_TAGS.includes(npmTag)) fail(`npm dist-tag must be one of ${NPM_TAGS.join(', ')}, not ${JSON.stringify(npmTag)}`)
  if (version.includes('-') && npmTag !== 'next') fail(`prerelease ${version} must go to dist-tag next`)
}

export function packedFilename(name, version) {
  return `${name.slice(1).replace('/', '-')}-${version}.tgz`
}

export function artifactIdentity(bytes, filename) {
  const digest = (algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding)
  return {
    filename,
    size: bytes.byteLength,
    sha1: digest('sha1', 'hex'),
    sha256: digest('sha256', 'hex'),
    integrity: `sha512-${digest('sha512', 'base64')}`,
  }
}

function sameArtifact(a, b) {
  return ['filename', 'size', 'sha1', 'sha256', 'integrity'].every(key => a[key] === b[key])
}

function git(ctx, args) {
  const result = ctx.run('git', args, { cwd: ctx.root })
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${result.stderr.trim() || `exit ${result.status}`}`)
  return result.stdout.trim()
}

function ensureClean(ctx) {
  if (git(ctx, ['status', '--porcelain', '--untracked-files=all']) !== '') fail('the checkout has uncommitted or untracked files; release only from the clean tag')
}

function readManifest(ctx, spec) {
  const manifest = JSON.parse(readFileSync(join(ctx.root, spec.dir, 'package.json'), 'utf8'))
  if (manifest.name !== spec.name) fail(`${spec.dir}/package.json must be named ${spec.name}`)
  if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) fail(`${spec.name} has no valid semver version`)
  if (manifest.private === true) fail(`${spec.name} is private`)
  if (manifest.publishConfig?.access !== 'public') fail(`${spec.name} publishConfig.access must be public`)
  // npm checks provenance against this: the repository must be the one that built it.
  if (manifest.repository?.url !== REPOSITORY_URL || manifest.repository?.directory !== spec.dir) {
    fail(`${spec.name} repository must be ${REPOSITORY_URL} with directory ${spec.dir}`)
  }
  return manifest
}

function ensureWorkflow(ctx) {
  const { GITHUB_ACTIONS, GITHUB_EVENT_NAME, GITHUB_REPOSITORY } = ctx.env
  if (GITHUB_ACTIONS !== 'true' || GITHUB_EVENT_NAME !== 'workflow_dispatch' || GITHUB_REPOSITORY !== REPOSITORY) {
    fail(`this step runs only in a workflow_dispatch of ${WORKFLOW_FILE} on ${REPOSITORY}`)
  }
}

// Refuses, before anything is packed or staged, every input the release
// would refuse later. Outside Actions it still checks the tag against HEAD,
// so a maintainer can run it before pushing a tag.
export function checkInputs(ctx, { package: key, tag, npmTag }) {
  const spec = packageSpec(key)
  const { version } = readManifest(ctx, spec)
  if (npmTag !== undefined) validateNpmTag(version, npmTag)
  const expected = expectedTag(key, version)
  if (tag !== expected) fail(`${spec.name}@${version} releases only from tag ${expected}, not ${JSON.stringify(tag)}`)
  const kind = ctx.run('git', ['cat-file', '-t', `refs/tags/${tag}`], { cwd: ctx.root })
  if (kind.status !== 0) fail(`tag ${tag} is not in this checkout`)
  if (kind.stdout.trim() !== 'tag') fail(`${tag} must be an annotated tag (git tag -a), not a lightweight one`)
  const commit = git(ctx, ['rev-parse', `refs/tags/${tag}^{commit}`])
  const head = git(ctx, ['rev-parse', 'HEAD'])
  if (commit !== head) fail(`HEAD ${head} is not the commit ${commit} that ${tag} names`)
  ensureClean(ctx)
  if (ctx.env.GITHUB_ACTIONS === 'true') {
    ensureWorkflow(ctx)
    if (ctx.env.GITHUB_REF !== `refs/tags/${tag}`) {
      fail(`dispatch this workflow on the tag itself (Use workflow from: ${tag}); it ran on ${ctx.env.GITHUB_REF}`)
    }
    if (ctx.env.GITHUB_SHA !== commit) fail(`the run's commit ${ctx.env.GITHUB_SHA} is not ${tag}'s commit ${commit}`)
    const npm = ctx.run('npm', ['--version'], { cwd: ctx.root })
    if (npm.stdout.trim() !== PINNED_NPM) fail(`release requires npm ${PINNED_NPM}, found ${npm.stdout.trim() || 'none'}`)
    if (ctx.nodeVersion.split('.')[0] !== NODE_MAJOR) fail(`release requires Node ${NODE_MAJOR}, found ${ctx.nodeVersion}`)
  }
  return { package: key, name: spec.name, version, tag, commit, ...(npmTag === undefined ? {} : { npm_tag: npmTag }) }
}

export function prepare(ctx, { package: key, tag, output }) {
  const facts = checkInputs(ctx, { package: key, tag })
  const out = resolve(output)
  const inside = relative(ctx.root, out)
  if (inside === '' || (!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`))) {
    fail('the output directory must be outside the checkout')
  }
  mkdirSync(out, { recursive: true })
  if (readdirSync(out).length > 0) fail(`the output directory ${out} must be empty`)
  const spec = packageSpec(key)
  const packed = ctx.run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out], { cwd: join(ctx.root, spec.dir) })
  if (packed.status !== 0) fail(`npm pack exited ${packed.status}: ${packed.stderr.trim()}`)
  let report
  try {
    report = JSON.parse(packed.stdout)
  } catch {
    fail('npm pack --json printed no JSON')
  }
  const filename = packedFilename(spec.name, facts.version)
  const entry = Array.isArray(report) && report.length === 1 ? report[0] : fail('npm pack must report exactly one tarball')
  if (entry.name !== spec.name || entry.version !== facts.version || entry.filename !== filename) {
    fail(`npm pack produced ${entry.filename}, expected ${filename}`)
  }
  const artifact = artifactIdentity(readFileSync(join(out, filename)), filename)
  if (entry.shasum !== artifact.sha1 || entry.integrity !== artifact.integrity) fail('npm pack reported digests that the tarball does not have')
  ensureClean(ctx)
  const receipt = {
    schema: SCHEMAS.receipt,
    package: { key, name: spec.name, version: facts.version },
    tag,
    commit: facts.commit,
    artifact,
  }
  writeFileSync(join(out, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  ctx.log(`files in ${filename}: ${(entry.files ?? []).map(file => file.path).join(', ')}`)
  return receipt
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  if (Object.keys(value).sort().join() !== [...keys].sort().join()) fail(`${label} must have exactly ${keys.join(', ')}`)
}

export function readReceipt(path) {
  const receipt = JSON.parse(readFileSync(path, 'utf8'))
  exactKeys(receipt, ['schema', 'package', 'tag', 'commit', 'artifact'], 'receipt')
  if (receipt.schema !== SCHEMAS.receipt) fail(`receipt schema must be ${SCHEMAS.receipt}`)
  exactKeys(receipt.package, ['key', 'name', 'version'], 'receipt.package')
  const spec = packageSpec(receipt.package.key)
  if (receipt.package.name !== spec.name || !SEMVER.test(String(receipt.package.version))) fail('receipt package is not an allowlisted name and version')
  if (!COMMIT.test(String(receipt.commit))) fail('receipt commit is not a full SHA')
  const { artifact } = receipt
  exactKeys(artifact, ['filename', 'size', 'sha1', 'sha256', 'integrity'], 'receipt.artifact')
  if (artifact.filename !== packedFilename(spec.name, receipt.package.version) || !Number.isSafeInteger(artifact.size) ||
    !/^[0-9a-f]{40}$/.test(artifact.sha1) || !/^[0-9a-f]{64}$/.test(artifact.sha256) || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(artifact.integrity)) {
    fail('receipt artifact is malformed')
  }
  return receipt
}

// The receipt still describes this checkout, and the tarball beside it still
// has the bytes the receipt records.
export function verifyArtifact(ctx, receiptPath) {
  const receipt = readReceipt(receiptPath)
  const facts = checkInputs(ctx, { package: receipt.package.key, tag: receipt.tag })
  if (facts.version !== receipt.package.version || facts.commit !== receipt.commit) fail('the receipt does not describe this checkout')
  const artifactPath = join(dirname(resolve(receiptPath)), receipt.artifact.filename)
  if (!sameArtifact(artifactIdentity(readFileSync(artifactPath), receipt.artifact.filename), receipt.artifact)) {
    fail('the tarball changed after its receipt was written')
  }
  return { receipt, artifactPath }
}

// One fresh read of a package document. A unique query keeps a cached
// pre-release 404 from answering for the registry.
async function packument(ctx, name) {
  const url = `${REGISTRY}/${name.replace('/', '%2F')}?rhetorlint_release_check=${randomUUID()}`
  let response
  try {
    response = await ctx.fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  } catch (error) {
    return { status: 0, error: error.message }
  }
  if (response.status !== 200) {
    await response.body?.cancel()
    return { status: response.status }
  }
  try {
    return { status: 200, doc: JSON.parse(await response.text()) }
  } catch {
    fail(`npm registry returned malformed JSON for ${name}`)
  }
}

function answered(state) {
  return state.status ? `HTTP ${state.status}` : `nothing (${state.error})`
}

function retryable(status) {
  return status === 0 || status === 404 || status === 408 || status === 425 || status === 429 || status >= 500
}

// stage if npm lacks the version; verify-existing if npm has these exact
// bytes; otherwise refuse. All three packages already exist on npm, so a
// missing package is a wrong name or a registry fault, never a first release.
export function decide(receipt, state) {
  const { name, version } = receipt.package
  if (state.status === 404) fail(`npm has no package ${name}; this route stages new versions of existing packages only`)
  if (state.status !== 200) fail(`npm registry answered ${answered(state)} for ${name}; dispatch again later`)
  const dist = state.doc?.versions?.[version]?.dist
  if (!dist) return 'stage'
  if (dist.integrity !== receipt.artifact.integrity || dist.shasum !== receipt.artifact.sha1) {
    fail(`npm already has ${name}@${version} with bytes different from ${receipt.tag}'s artifact; a version cannot be replaced, so bump it`)
  }
  return 'verify-existing'
}

// ^x.y.z as npm reads it, for stable versions; anything else is refused.
export function satisfiesCaret(version, range) {
  const floor = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range)
  if (!floor) fail(`unsupported dependency range ${range}; use ^x.y.z`)
  const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!v) return false
  const [a, b, c] = floor.slice(1).map(Number)
  const [x, y, z] = v.slice(1).map(Number)
  const atLeast = x > a || (x === a && (y > b || (y === b && z >= c)))
  if (a > 0) return atLeast && x === a
  if (b > 0) return atLeast && x === 0 && y === b
  return x === 0 && y === 0 && z === c
}

// A package staged before its @rhetorlint dependencies are installable
// cannot be installed once approved: release core, then rules-en, then cli.
async function dependenciesLive(ctx, spec) {
  const { dependencies = {} } = readManifest(ctx, spec)
  for (const [name, range] of Object.entries(dependencies)) {
    if (!name.startsWith('@rhetorlint/')) continue
    const state = await packument(ctx, name)
    if (state.status !== 200) fail(`npm registry answered ${answered(state)} for ${name}; dispatch again later`)
    if (!Object.keys(state.doc.versions ?? {}).some(version => satisfiesCaret(version, range))) {
      fail(`${spec.name} needs ${name} ${range}, which npm cannot install yet; release ${name} first (order: core, rules-en, cli)`)
    }
  }
}

export async function plan(ctx, { receipt: receiptPath, npmTag }) {
  const { receipt } = verifyArtifact(ctx, receiptPath)
  validateNpmTag(receipt.package.version, npmTag)
  const state = await packument(ctx, receipt.package.name)
  const action = decide(receipt, state)
  if (action === 'stage') await dependenciesLive(ctx, packageSpec(receipt.package.key))
  if (ctx.env.GITHUB_OUTPUT) appendFileSync(ctx.env.GITHUB_OUTPUT, `action=${action}\n`)
  const planned = {
    package: `${receipt.package.name}@${receipt.package.version}`,
    tag: receipt.tag,
    commit: receipt.commit,
    npm_tag: npmTag,
    registry_dist_tag_now: state.doc?.['dist-tags']?.[npmTag] ?? null,
    planned_action: action,
  }
  summary(ctx, `## Planned action: \`${action}\`\n\n\`\`\`json\n${JSON.stringify(planned, null, 2)}\n\`\`\`\n`)
  return planned
}

// The workflow-command form of actions/core setSecret: the runner hides the
// value in the rest of the job's log.
function mask(ctx, secret) {
  if (ctx.env.GITHUB_ACTIONS === 'true') ctx.log(`::add-mask::${secret}`)
}

async function oidcRequest(ctx, url, init, label) {
  let response
  try {
    response = await ctx.fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
  } catch {
    fail(`${label} did not answer; dispatch again later. Nothing was staged.`)
  }
  let body
  try {
    body = JSON.parse(await response.text())
  } catch {
    body = undefined
  }
  return { status: response.status, ok: response.ok, body: body && typeof body === 'object' ? body : undefined }
}

// npm 11.17.0's OIDC exchange (lib/utils/oidc.js), made once before staging:
// a GitHub ID token for npm's audience, POSTed to the package's exchange URL,
// which returns an npm token only if one of the package's trust configs
// matches this run. npm itself logs a failed exchange at verbose level and
// carries on to ENEEDAUTH; this names the cause instead. Both tokens are
// masked as soon as they exist and never printed; the npm token is dropped
// unused and expires on its own.
export async function checkTrust(ctx, { package: key }) {
  ensureWorkflow(ctx)
  const spec = packageSpec(key)
  const { ACTIONS_ID_TOKEN_REQUEST_URL: requestUrl, ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken } = ctx.env
  if (!requestUrl || !requestToken) fail('check-trust needs the GitHub OIDC request environment (permissions: id-token: write)')
  const idUrl = new URL(requestUrl)
  if (idUrl.protocol !== 'https:') fail('refusing a GitHub OIDC request URL that is not HTTPS')
  idUrl.searchParams.append('audience', OIDC_AUDIENCE)
  const issued = await oidcRequest(ctx, idUrl.href, {
    headers: { accept: 'application/json', authorization: `Bearer ${requestToken}` },
  }, "GitHub's OIDC token service")
  const idToken = issued.body?.value
  if (!issued.ok || typeof idToken !== 'string' || !BEARER.test(idToken)) fail(`GitHub issued no OIDC ID token for ${OIDC_AUDIENCE} (HTTP ${issued.status})`)
  mask(ctx, idToken)
  const exchanged = await oidcRequest(ctx, `${REGISTRY}/-/npm/v1/oidc/token/exchange/package/${spec.name.replace('/', '%2f')}`, {
    method: 'POST',
    // npm's own npm-* headers on this request: its command and auth type.
    headers: { accept: 'application/json', authorization: `Bearer ${idToken}`, 'npm-auth-type': 'web', 'npm-command': 'stage' },
  }, "npm's OIDC token exchange")
  const token = exchanged.body?.token
  if (exchanged.ok && typeof token === 'string' && BEARER.test(token)) {
    mask(ctx, token)
    return { package: spec.name, trusted_publisher: "npm exchanged this workflow's OIDC identity for a token; the token was discarded unused" }
  }
  const message = exchanged.body?.message
  const said = typeof message === 'string' ? `: ${message.split(idToken).join('***').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').slice(0, 200)}` : ''
  if (exchanged.ok) fail(`npm's OIDC exchange answered HTTP ${exchanged.status} without a usable token for ${spec.name}. Nothing was staged.`)
  if (exchanged.status === 429 || exchanged.status >= 500) fail(`npm's OIDC exchange is unavailable (HTTP ${exchanged.status}${said}); dispatch again later. Nothing was staged.`)
  if ([401, 403, 404].includes(exchanged.status)) {
    fail(`no trusted publisher matches this workflow for ${spec.name} (npm's OIDC exchange answered HTTP ${exchanged.status}${said}). ` +
      `npm stages it only for a trust config naming ${REPOSITORY}, workflow ${WORKFLOW_FILE} and environment ${ENVIRONMENT}, with stage publishing allowed. ` +
      'Create one as NPM_DEPLOY.md describes and dispatch this tag again within 48 hours, before npm expires an unvalidated config. Nothing was staged.')
  }
  fail(`npm's OIDC exchange gave this workflow no token for ${spec.name} (HTTP ${exchanged.status}${said}). Nothing was staged.`)
}

// npm's `oidc` lines, at any level, from one debug log, with token-shaped
// text replaced by ***.
export function oidcLogLines(text) {
  return text.split(/\r?\n/)
    .filter(line => /^\d+ [a-z]+ oidc /.test(line))
    .map(line => TOKEN_SHAPES.reduce((redacted, pattern) => redacted.replace(pattern, '***'), line))
}

export function stageArguments(artifactPath, npmTag, logsDir) {
  // --logs-dir: npm writes its verbose oidc lines to its debug log only.
  return ['stage', 'publish', artifactPath, '--access', 'public', '--tag', npmTag, '--provenance', '--ignore-scripts', '--json', '--logs-dir', logsDir]
}

// npm's `stage publish --json` record, checked to hold the receipt's bytes.
export function parseStageOutput(stdout, receipt) {
  let record
  try {
    record = JSON.parse(stdout)?.[receipt.package.name]
  } catch {
    record = undefined
  }
  if (!record) fail('npm stage publish printed no record for the package; run `npm stage list` before any retry')
  if (record.name !== receipt.package.name || record.version !== receipt.package.version) fail('npm staged a different package or version')
  if (record.shasum !== receipt.artifact.sha1 || record.integrity !== receipt.artifact.integrity) fail('npm staged bytes different from the receipt')
  if (typeof record.stageId !== 'string' || !STAGE_ID.test(record.stageId)) fail('npm stage publish reported no valid stage id; run `npm stage list` before any retry')
  return record.stageId.toLowerCase()
}

function npmFailure(result) {
  let code
  try {
    code = JSON.parse(result.stdout)?.error?.code
  } catch {
    code = undefined
  }
  if (code === 'ENEEDAUTH') {
    return `npm stage publish exited ${result.status} (ENEEDAUTH): npm's OIDC exchange gave it no token (its oidc lines are above), so it stopped before signing provenance or staging`
  }
  return `npm stage publish exited ${result.status}${typeof code === 'string' ? ` (${code})` : ''}; npm's output is above. Run \`npm stage list\` before any retry`
}

function summary(ctx, markdown) {
  if (ctx.env.GITHUB_STEP_SUMMARY) appendFileSync(ctx.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
}

export function approvalSteps(staged) {
  const npm = `npx --yes npm@${PINNED_NPM}`
  const id = staged.stage_id
  return [
    `## Staged ${staged.package.name}@${staged.package.version}: not public until approved`,
    '',
    'On the device that holds the npm login (each approval asks for 2FA):',
    '',
    '```bash',
    `${npm} stage view ${id}`,
    `${npm} stage download ${id}   # prints the .tgz it wrote`,
    `shasum -a 256 <that .tgz>   # expect ${staged.artifact.sha256}`,
    `${npm} stage approve ${id}   # or: ${npm} stage reject ${id}`,
    '```',
    '',
    'For a few minutes after staging, approve can answer E409 ("automated review hasn\'t finished"). Wait and run it again.',
    `Then dispatch ${WORKFLOW_FILE} on \`${staged.tag}\` again with the same inputs and dry_run off. It finds the version and checks the registry serves these bytes.`,
  ].join('\n')
}

export async function stage(ctx, { receipt: receiptPath, npmTag }) {
  ensureWorkflow(ctx)
  const { receipt, artifactPath } = verifyArtifact(ctx, receiptPath)
  validateNpmTag(receipt.package.version, npmTag)
  if (decide(receipt, await packument(ctx, receipt.package.name)) !== 'stage') {
    fail(`npm already has ${receipt.package.name}@${receipt.package.version}; nothing to stage. Dispatch again to verify it`)
  }
  if (!ctx.env.ACTIONS_ID_TOKEN_REQUEST_URL || !ctx.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) fail('staging needs the GitHub OIDC request environment (permissions: id-token: write)')
  const logsDir = mkdtempSync(join(tmpdir(), 'rhetorlint-npm-logs-'))
  let result
  let lines
  try {
    // Empty, not deleted: setup-node's .npmrc reads _authToken=${NODE_AUTH_TOKEN},
    // and npm keeps an unset variable as that literal text, which it would
    // send as a token. An empty token is no credential, so a failed OIDC
    // exchange ends in ENEEDAUTH before npm signs provenance.
    result = ctx.run('npm', stageArguments(artifactPath, npmTag, logsDir), {
      cwd: ctx.root,
      env: { ...ctx.env, NODE_AUTH_TOKEN: '' },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    lines = readdirSync(logsDir).filter(name => /-debug-\d+\.log$/.test(name)).sort()
      .flatMap(name => oidcLogLines(readFileSync(join(logsDir, name), 'utf8')))
  } finally {
    rmSync(logsDir, { recursive: true, force: true })
  }
  ctx.log(lines.length ? ["npm's oidc log lines:", ...lines].join('\n') : "npm's debug log has no oidc lines")
  ctx.log(result.stdout.trim())
  if (result.status !== 0) fail(npmFailure(result))
  const staged = {
    schema: SCHEMAS.stage,
    package: receipt.package,
    tag: receipt.tag,
    commit: receipt.commit,
    npm_tag: npmTag,
    artifact: receipt.artifact,
    stage_id: parseStageOutput(result.stdout, receipt),
    staged_at: ctx.now().toISOString(),
  }
  writeFileSync(join(dirname(resolve(receiptPath)), 'stage.json'), `${JSON.stringify(staged, null, 2)}\n`)
  summary(ctx, approvalSteps(staged))
  return staged
}

async function download(ctx, tarball) {
  const url = new URL(tarball)
  if (url.origin !== REGISTRY || url.username || url.password) fail(`npm returned an unexpected tarball URL: ${tarball}`)
  let response
  try {
    response = await ctx.fetch(url.href, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
  } catch (error) {
    return { status: 0, error: error.message }
  }
  if (!response.ok) {
    await response.body?.cancel()
    return { status: response.status }
  }
  return { status: 200, bytes: new Uint8Array(await response.arrayBuffer()) }
}

// After approval: npm must list the receipt's digests for the version, point
// the requested dist-tag at it, and serve a tarball with the same bytes. The
// registry's CDN can lag an approval by minutes, so the read is retried for
// a bounded time; different bytes are refused at once.
export async function verifyExisting(ctx, { receipt: receiptPath, npmTag, attempts = 90, delayMs = 5000 }) {
  const { receipt } = verifyArtifact(ctx, receiptPath)
  const { name, version } = receipt.package
  validateNpmTag(version, npmTag)
  let last = 'nothing observed'
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const state = await packument(ctx, name)
    if (state.status !== 200 && !retryable(state.status)) decide(receipt, state)
    if (state.status !== 200) {
      last = `npm registry answered ${answered(state)}`
    } else if (decide(receipt, state) === 'stage') {
      last = `${name}@${version} is not on npm yet (approved?)`
    } else if (state.doc['dist-tags']?.[npmTag] !== version) {
      last = `dist-tag ${npmTag} points to ${state.doc['dist-tags']?.[npmTag] ?? 'nothing'}, not ${version}`
    } else {
      const tarball = state.doc.versions[version].dist.tarball
      const got = await download(ctx, tarball)
      if (got.bytes) {
        if (!sameArtifact(artifactIdentity(got.bytes, receipt.artifact.filename), receipt.artifact)) {
          fail(`the tarball npm serves for ${name}@${version} is not byte-identical to ${receipt.tag}'s artifact`)
        }
        const result = {
          schema: SCHEMAS.result,
          status: 'already_published_exact',
          package: receipt.package,
          tag: receipt.tag,
          commit: receipt.commit,
          npm_tag: npmTag,
          registry_tarball: tarball,
          artifact: receipt.artifact,
          observed_at: ctx.now().toISOString(),
        }
        writeFileSync(join(dirname(resolve(receiptPath)), 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
        summary(ctx, `## ${name}@${version} on npm: already_published_exact\n\nnpm serves the bytes ${receipt.tag} packs (sha256 \`${receipt.artifact.sha256}\`), and dist-tag \`${npmTag}\` points to ${version}.`)
        return result
      }
      if (!retryable(got.status)) fail(`npm's tarball for ${name}@${version} answered HTTP ${got.status}`)
      last = `tarball download answered ${answered(got)}`
    }
    if (attempt < attempts) await ctx.sleep(delayMs)
  }
  fail(`${name}@${version} could not be verified after ${attempts} reads: ${last}`)
}

const COMMANDS = {
  'check-inputs': { required: ['package', 'tag'], optional: ['npm-tag'], run: (ctx, o) => checkInputs(ctx, { package: o.package, tag: o.tag, npmTag: o['npm-tag'] }) },
  prepare: { required: ['package', 'tag', 'output'], run: (ctx, o) => prepare(ctx, o) },
  plan: { required: ['receipt', 'npm-tag'], run: (ctx, o) => plan(ctx, { receipt: o.receipt, npmTag: o['npm-tag'] }) },
  'check-trust': { required: ['package'], run: (ctx, o) => checkTrust(ctx, o) },
  stage: { required: ['receipt', 'npm-tag'], run: (ctx, o) => stage(ctx, { receipt: o.receipt, npmTag: o['npm-tag'] }) },
  'verify-existing': { required: ['receipt', 'npm-tag'], run: (ctx, o) => verifyExisting(ctx, { receipt: o.receipt, npmTag: o['npm-tag'] }) },
}

export async function main(argv, ctx = context()) {
  const usage = `usage: npm-release.mjs <${Object.keys(COMMANDS).join('|')}> [--option value ...]`
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: Object.fromEntries(['package', 'tag', 'npm-tag', 'output', 'receipt'].map(name => [name, { type: 'string' }])),
  })
  const command = COMMANDS[positionals[0]]
  if (positionals.length !== 1 || !command) fail(usage)
  const allowed = [...command.required, ...(command.optional ?? [])]
  for (const name of Object.keys(values)) if (!allowed.includes(name)) fail(`${positionals[0]} does not take --${name}`)
  for (const name of command.required) if (!values[name]) fail(`${positionals[0]} needs --${name}`)
  const result = await command.run(ctx, values)
  ctx.log(JSON.stringify(result, null, 2))
  return result
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`npm-release: ${error.message}`)
    process.exitCode = 1
  })
}
