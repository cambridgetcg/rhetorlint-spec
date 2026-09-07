import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/publish-npm-ci.mjs', import.meta.url))
const NAMES = ['@rhetorlint/core', '@rhetorlint/rules-en', '@rhetorlint/cli']
const VERSIONS = Object.fromEntries(NAMES.map(name => {
  const dir = name.slice('@rhetorlint/'.length)
  const pkg = JSON.parse(readFileSync(new URL(`../packages/${dir}/package.json`, import.meta.url)))
  return [name, pkg.version]
}))

// Only this executable is on PATH. No scenario may fall through to real npm.
const FAKE_NPM = `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const root = process.env.FAKE_NPM_ROOT;
const mode = process.env.FAKE_NPM_MODE;
const fail = message => { console.error(message); process.exit(1); };
appendFileSync(join(root, 'calls.jsonl'), JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
let spec;
if (args[0] === 'view' && args.length === 3 && args[2] === 'version') spec = args[1];
else if (args[0] === 'pack' && args.length === 4 && args[1] === '--dry-run' && args[2] === '--json') spec = args[3];
else if (JSON.stringify(args) === JSON.stringify(['publish', '--access', 'public', '--provenance', '--loglevel', 'verbose'])) {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  if (mode === 'duplicate') fail('npm error EPUBLISHCONFLICT');
  if (mode === 'duplicate-text') fail('npm error E403 cannot publish over the previously published versions');
  if (mode === 'forbidden') fail('npm error E403 permission denied');
  if (mode === 'auth') fail('npm error ENEEDAUTH');
  writeFileSync(join(root, pkg.name.split('/')[1] + '.published'), pkg.version);
  console.log('published ' + pkg.name);
  process.exit(0);
} else fail('unexpected fake npm arguments');
if (!/^@rhetorlint\\/(core|rules-en|cli)@[^@]+$/.test(spec)) fail('unexpected fake package');
const name = spec.slice(0, spec.lastIndexOf('@')).split('/')[1];
const state = join(root, name + '.published');
if (mode === 'live' || (mode === 'pack-live' && args[0] === 'pack') || existsSync(state)) {
  console.log(spec.slice(spec.lastIndexOf('@') + 1));
  process.exit(0);
}
fail('npm error E404');
`

function run(t, { scope = 'core', absent = false, mode = 'publish', dryRun = 'false' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rhetorlint-publisher-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(root, 'npm'), FAKE_NPM, { mode: 0o755 })
  const env = { ...process.env, PATH: root, FAKE_NPM_ROOT: root, FAKE_NPM_MODE: mode, DRY_RUN: dryRun, PUBLISH_PACKAGES: scope }
  if (absent) delete env.PUBLISH_PACKAGES
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: root, env, encoding: 'utf8', timeout: 15_000 })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  const log = join(root, 'calls.jsonl')
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []
  return { ...result, calls }
}

function publishedNames(calls) {
  return calls.filter(({ args }) => args[0] === 'publish').map(({ cwd }) =>
    JSON.parse(readFileSync(join(cwd, 'package.json'))).name)
}

function probeSpecs(calls) {
  return calls.filter(({ args }) => args[0] !== 'publish').map(({ args }) => args[0] === 'view' ? args[1] : args[3])
}

for (const absent of [false, true]) {
  test(`publisher retains all-package order with ${absent ? 'absent' : 'explicit all'} selector`, t => {
    const result = run(t, { scope: 'all', absent })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(publishedNames(result.calls), NAMES)
    assert.deepEqual(probeSpecs(result.calls), NAMES.flatMap(name => Array(3).fill(`${name}@${VERSIONS[name]}`)))
    assert.match(result.stdout, /published 3, skipped 0/)
  })
}

test('core-only publication never probes or publishes other packages', t => {
  const result = run(t)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(publishedNames(result.calls), [NAMES[0]])
  assert.deepEqual(probeSpecs(result.calls), Array(3).fill(`${NAMES[0]}@${VERSIONS[NAMES[0]]}`))
  assert.match(result.stdout, /Publication scope: core \(@rhetorlint\/core\)/)
  assert.match(result.stdout, /registry-installable/)
})

test('core-only dry-run probes but never publishes', t => {
  const result = run(t, { dryRun: 'true' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(publishedNames(result.calls), [])
  assert.deepEqual(probeSpecs(result.calls), Array(2).fill(`${NAMES[0]}@${VERSIONS[NAMES[0]]}`))
  assert.match(result.stdout, /would publish 1, skipped 0/)
})

test('all-package dry-run retains order without publication', t => {
  const result = run(t, { scope: 'all', dryRun: 'true' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(publishedNames(result.calls), [])
  assert.deepEqual(probeSpecs(result.calls), NAMES.flatMap(name => Array(2).fill(`${name}@${VERSIONS[name]}`)))
})

for (const scope of ['', ' core', 'core ', 'CORE', 'rules-en', 'core,all', 'unknown']) {
  test(`publisher rejects ${JSON.stringify(scope)} before any npm call`, t => {
    const result = run(t, { scope })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /PUBLISH_PACKAGES must be exactly core or all/)
    assert.deepEqual(result.calls, [])
  })
}

for (const mode of ['live', 'pack-live']) {
  test(`core already-live check uses ${mode === 'live' ? 'view' : 'pack fallback'} without publication`, t => {
    const result = run(t, { mode })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(publishedNames(result.calls), [])
    assert.deepEqual(probeSpecs(result.calls), Array(mode === 'live' ? 1 : 2).fill(`${NAMES[0]}@${VERSIONS[NAMES[0]]}`))
    assert.match(result.stdout, /selected packages are already live/)
  })
}

for (const mode of ['duplicate', 'duplicate-text']) {
  test(`explicit ${mode} rejection is skipped without stranding later packages`, t => {
    const result = run(t, { scope: 'all', mode })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(publishedNames(result.calls), NAMES)
    assert.match(result.stdout, /published 0, skipped 3/)
  })
}

for (const mode of ['forbidden', 'auth']) {
  test(`${mode} failure stops publication before later packages`, t => {
    const result = run(t, { scope: 'all', mode })
    assert.equal(result.status, 1)
    assert.deepEqual(publishedNames(result.calls), [NAMES[0]])
    assert.deepEqual(probeSpecs(result.calls), Array(2).fill(`${NAMES[0]}@${VERSIONS[NAMES[0]]}`))
    assert.match(result.stderr, /nothing after this package went out/)
  })
}

test('workflow defaults manual runs to core and maps tags explicitly to all', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.match(workflow, /packages:\n\s+description:.*\n\s+type: choice\n\s+required: true\n\s+default: core\n\s+options:\n\s+- core\n\s+- all/)
  assert.ok(workflow.includes("PUBLISH_PACKAGES: ${{ github.event_name == 'push' && 'all' || inputs.packages }}"))
  assert.ok(workflow.includes('DRY_RUN: ${{ inputs.dry_run }}'))
  assert.ok(workflow.includes('run: node scripts/publish-npm-ci.mjs'))
  assert.ok(!/run:.*\$\{\{.*inputs\.packages/.test(workflow))
})
