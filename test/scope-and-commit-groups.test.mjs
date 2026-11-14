// Protects two promises. A scope made of paths is a file set the script keeps the run to,
// not prose an agent may widen. And a wave commits each fixer's fixes on their own, so a
// reviewer can drop one without picking apart the rest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { scopePaths, inScope, keepToScope, commitGroups }`)()
const ROOT = '/repo'

test('a scope of paths is a file set; a scope in words is not', () => {
  assert.deepEqual(H.scopePaths('src/click/core.py ./src/click/types.py src/click/core.py'), ['src/click/core.py', 'src/click/types.py'])
  assert.deepEqual(H.scopePaths('src/click/'), ['src/click'], 'a directory')
  assert.deepEqual(H.scopePaths('setup.py'), ['setup.py'], 'a file with no directory still has an extension')
  for (const words of ['auth flow', 'the progress bar', 'src/click/core.py and its callers', '', null]) {
    assert.equal(H.scopePaths(words), null, JSON.stringify(words))
  }
})

test('a file is in scope if it is a scoped file or sits under a scoped directory', () => {
  const paths = ['src/click/core.py', 'src/click/shell']
  assert.equal(H.inScope('src/click/core.py', paths, ROOT), true)
  assert.equal(H.inScope('/repo/src/click/core.py', paths, ROOT), true, 'an absolute path under the root')
  assert.equal(H.inScope('src/click/core.py:1120', paths, ROOT), true, 'a finding\'s line is not part of its path')
  assert.equal(H.inScope('src/click/shell/zsh.py', paths, ROOT), true)
  assert.equal(H.inScope('src/click/shell_completion.py', paths, ROOT), false, 'a prefix is not a directory')
  assert.equal(H.inScope('src/click/core.pyc', paths, ROOT), false)
  assert.equal(H.inScope('examples/repo.py', paths, ROOT), false)
})

test('the map is kept to the scope: targets outside go, a scoped file it left out comes in', () => {
  const targets = [
    { file: 'src/click/core.py', concern: 'backend-logic', functions: ['Option.prompt'] },
    { file: '/repo/src/click/termui.py', concern: 'frontend' },
    { file: 'examples/repo.py', concern: 'backend-logic' },
  ]
  const kept = H.keepToScope(targets, ['src/click/core.py', 'src/click/utils.py', 'src/click/shell'], ROOT)
  assert.deepEqual(kept.targets, [targets[0], { file: 'src/click/utils.py', concern: 'backend-logic', functions: [] }])
  assert.equal(kept.dropped, 2)
  assert.deepEqual(kept.added, ['src/click/utils.py'], 'a scoped directory adds nothing: the script cannot list it')
})

test('a wave commits each fixer on its own, and fixers that share a file share a commit', () => {
  const b = (bugId, file) => ({ bugId, file })
  const files = { b1: ['src/a.py', 'tests/test_a.py'], b2: ['src/a.py', 'tests/test_a.py'], b3: ['src/b.py', 'tests/test_b.py'], b4: ['src/c.py', 'tests/test_shared.py'], b5: ['src/d.py', 'tests/test_shared.py'] }
  const filesOf = bugs => [...new Set(bugs.flatMap(x => files[x.bugId]))]
  const groups = [['src/a.py', [b('b1'), b('b2')]], ['src/b.py', [b('b3')]], ['src/c.py', [b('b4')]], ['src/d.py', [b('b5')]]]
  const closed = ['b1', 'b2', 'b3', 'b4', 'b5'].map(id => ({ bugId: id, wave: 1 }))
  assert.deepEqual(H.commitGroups(groups, closed, filesOf).map(set => set.map(x => x.bugId)), [['b1', 'b2'], ['b3'], ['b4', 'b5']])

  const some = closed.filter(c => c.bugId !== 'b2' && c.bugId !== 'b3')
  assert.deepEqual(H.commitGroups(groups, some, filesOf).map(set => set.map(x => x.bugId)), [['b1'], ['b4', 'b5']], 'only closed bugs, and a fixer with none makes no commit')
  assert.equal(H.commitGroups(groups, some, filesOf)[0][0], some[0], 'the rows are the closed rows themselves')

  // A third fixer that touches the files of two separate commits joins them into one.
  files.b6 = ['tests/test_a.py', 'tests/test_b.py']
  const bridged = [...groups.slice(0, 2), ['src/e.py', [b('b6')]]]
  const all = ['b1', 'b2', 'b3', 'b6'].map(id => ({ bugId: id }))
  assert.deepEqual(H.commitGroups(bridged, all, filesOf).map(set => set.map(x => x.bugId).sort()), [['b1', 'b2', 'b3', 'b6']])
})
