// LIVE Docker test: exercises the exact provisioning recipe the crg-debug.js setup agent is
// instructed to perform in env=container — a fingerprint-labeled per-repo image, language deps
// in a persistent named volume, and a containerized baseline command against a bind-mounted
// source. Proves the mechanism end-to-end: image build, green baseline, fingerprint-reuse, and
// the host-edit→container-visible loop that lets later fix/gate steps re-run containerized
// commands without a rebuild. Skips (does not fail) when the Docker daemon is down.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dockerUp = () => { try { execSync('docker info', { stdio: 'ignore' }); return true } catch { return false } }
const sh = cmd => execSync(cmd, { encoding: 'utf8' })
const IMG = 'crg-env-crgfix-live'
const VOL = 'crg-deps-crgfix-live'
const MOUNT = repo => `-v ${repo}:/work -v ${VOL}:/work/.venv -w /work`

test('env=container recipe: build → green baseline → fingerprint reuse → host-edit loop', { skip: !dockerUp() ? 'Docker daemon down' : false, timeout: 300000 }, async () => {
  const repo = mkdtempSync(join(tmpdir(), 'crgfix-'))
  try {
    // --- a tiny but real installable Python repo (the "cloned candidate") ---
    writeFileSync(join(repo, 'pyproject.toml'),
      '[build-system]\nrequires = ["setuptools"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "crgfix"\nversion = "0.0.1"\n')
    mkdirSync(join(repo, 'crgfix'))
    writeFileSync(join(repo, 'crgfix', '__init__.py'), 'def hello():\n    return "crg-ok"\n')

    // --- (a) fingerprint the manifests, (b) build the image labelled with it ---
    const fp = createHash('sha1').update(readFileSync(join(repo, 'pyproject.toml'))).digest('hex')
    sh(`printf 'FROM python:3.12-slim\\n' | docker build -t ${IMG} --label crg.fp=${fp} -`)

    // --- (c) language deps into the persistent named volume (venv on the mount) ---
    sh(`docker run --rm ${MOUNT(repo)} ${IMG} sh -lc 'python -m venv /work/.venv && /work/.venv/bin/pip install -e . -q'`)

    // --- (baseline) containerized build/import must be GREEN (exit 0) ---
    const baseline = sh(`docker run --rm ${MOUNT(repo)} ${IMG} sh -lc '/work/.venv/bin/python -c "import crgfix; print(crgfix.hello())"'`).trim()
    assert.equal(baseline, 'crg-ok', 'baseline import must succeed inside the provisioned env')

    // --- fingerprint-reuse: the label round-trips, so a rerun would REUSE (never replicate) ---
    const label = sh(`docker image inspect ${IMG} --format '{{index .Config.Labels "crg.fp"}}'`).trim()
    assert.equal(label, fp, 'image carries the manifest fingerprint → reuse-as-is on unchanged deps')

    // --- host-edit → container-visible: edit source on the HOST, rerun the SAME command,
    //     no rebuild — proves fix agents edit on the host and the gate re-runs containerized ---
    writeFileSync(join(repo, 'crgfix', '__init__.py'), 'def hello():\n    return "crg-edited"\n')
    const afterEdit = sh(`docker run --rm ${MOUNT(repo)} ${IMG} sh -lc '/work/.venv/bin/python -c "import crgfix; print(crgfix.hello())"'`).trim()
    assert.equal(afterEdit, 'crg-edited', 'host edit must be visible in the container via the bind-mount, no rebuild')
  } finally {
    try { sh(`docker rmi -f ${IMG}`) } catch {}
    try { sh(`docker volume rm ${VOL}`) } catch {}
    rmSync(repo, { recursive: true, force: true })
  }
})
