import test from 'node:test'
import assert from 'node:assert/strict'
import {
    checkpointStorageKey,
    createMemoryCheckpointStore,
    createWebStorageCheckpointStore,
    resolveSpawn,
} from '../src/game/checkpoint-store'

function fakeStorage() {
    const map = new Map<string, string>()
    return {
        getItem(k: string) { return map.get(k) ?? null },
        setItem(k: string, v: string) { map.set(k, v) },
        removeItem(k: string) { map.delete(k) },
        // For inspection in tests.
        _raw: map,
    }
}

test('memory checkpoint store round-trips a coord by value (no reference leak)', () => {
    const store = createMemoryCheckpointStore()
    const source = { x: 4, y: 5, z: 6 }
    store.set(source)
    source.x = 999
    assert.deepEqual(store.get(), { x: 4, y: 5, z: 6 }, 'set must snapshot, not capture the reference')

    const fetched = store.get()!
    fetched.y = -1
    assert.equal(store.get()!.y, 5, 'get must return a fresh copy so the next read is untouched')
})

test('memory checkpoint store.clear erases the saved checkpoint', () => {
    const store = createMemoryCheckpointStore()
    store.set({ x: 1, y: 2, z: 3 })
    store.clear()
    assert.equal(store.get(), null)
})

test('memory checkpoint store rejects non-finite coordinates', () => {
    const store = createMemoryCheckpointStore()
    store.set({ x: 1, y: 2, z: 3 })
    store.set({ x: NaN, y: 0, z: 0 })
    store.set({ x: 0, y: Infinity, z: 0 })
    assert.deepEqual(store.get(), { x: 1, y: 2, z: 3 }, 'invalid writes must not overwrite a previously valid checkpoint')
})

test('web-storage checkpoint store survives a virtual reload via the same key', () => {
    const storage = fakeStorage()
    const a = createWebStorageCheckpointStore(storage, 'vp:checkpoint:demo')
    a.set({ x: 4, y: 5, z: 6 })
    // Simulate a page reload: drop the old store, build a fresh one against
    // the same underlying storage.
    const b = createWebStorageCheckpointStore(storage, 'vp:checkpoint:demo')
    assert.deepEqual(b.get(), { x: 4, y: 5, z: 6 })
})

test('web-storage checkpoint store rejects malformed JSON without throwing', () => {
    const storage = fakeStorage()
    storage.setItem('vp:checkpoint:demo', '{not json')
    const store = createWebStorageCheckpointStore(storage, 'vp:checkpoint:demo')
    assert.equal(store.get(), null)
})

test('web-storage checkpoint store rejects valid JSON with non-finite coords', () => {
    const storage = fakeStorage()
    storage.setItem('vp:checkpoint:demo', JSON.stringify({ x: 1, y: 'oops', z: 3 }))
    const store = createWebStorageCheckpointStore(storage, 'vp:checkpoint:demo')
    assert.equal(store.get(), null)
})

test('web-storage checkpoint store swallows a throwing setItem so the script API stays alive', () => {
    const storage = {
        getItem(_k: string) { return JSON.stringify({ x: 1, y: 2, z: 3 }) },
        setItem(_k: string, _v: string) { throw new Error('quota') },
        removeItem(_k: string) {},
    }
    const store = createWebStorageCheckpointStore(storage, 'vp:checkpoint:demo')
    assert.doesNotThrow(() => store.set({ x: 99, y: 99, z: 99 }))
    assert.deepEqual(store.get(), { x: 1, y: 2, z: 3 }, 'underlying storage state is preserved when set throws')
})

test('checkpointStorageKey sanitises whitespace, control chars, and empty names', () => {
    assert.equal(checkpointStorageKey('demo'), 'vp:checkpoint:demo')
    assert.equal(checkpointStorageKey('My Level'), 'vp:checkpoint:My-Level')
    assert.equal(checkpointStorageKey('  spaced  '), 'vp:checkpoint:spaced')
    assert.equal(checkpointStorageKey('with\nnewline'), 'vp:checkpoint:withnewline')
    assert.equal(checkpointStorageKey(''), 'vp:checkpoint:untitled')
    assert.equal(checkpointStorageKey('   '), 'vp:checkpoint:untitled')
})

test('resolveSpawn returns the stored checkpoint when present, falls back otherwise', () => {
    const empty = createMemoryCheckpointStore()
    assert.deepEqual(resolveSpawn({ x: 0, y: 1, z: 2 }, empty), { x: 0, y: 1, z: 2 })

    const populated = createMemoryCheckpointStore()
    populated.set({ x: 9, y: 8, z: 7 })
    assert.deepEqual(resolveSpawn({ x: 0, y: 1, z: 2 }, populated), { x: 9, y: 8, z: 7 })
})

test('end-to-end: a script saves a checkpoint via storage; a virtual reload restores it as the spawn', () => {
    // This mirrors the production flow: `script.setCheckpoint(pos)` writes
    // through the store; on reload, client.ts reads the store and uses it
    // as the effective spawn. The script-bindings test covers the write
    // half; this test covers the read half AND chains them so a future
    // refactor that breaks either side fails here.
    const storage = fakeStorage()
    const meta = { spawn: { x: 12, y: 5, z: 12 } }

    // ── First session: script writes a checkpoint. ────────────────────
    const firstStore = createWebStorageCheckpointStore(storage, checkpointStorageKey('demo'))
    firstStore.set({ x: 3, y: 8, z: 14 })
    assert.deepEqual(resolveSpawn(meta.spawn, firstStore), { x: 3, y: 8, z: 14 })

    // ── Simulate a death-triggered reload: discard the store handle,
    // create a fresh one over the same storage (as client.ts would do
    // on the next page load).
    const secondStore = createWebStorageCheckpointStore(storage, checkpointStorageKey('demo'))
    assert.deepEqual(resolveSpawn(meta.spawn, secondStore), { x: 3, y: 8, z: 14 },
        'after reload, the player respawns at the saved checkpoint, not meta.spawn')

    // ── A clear from the second session must wipe the persisted value
    // so subsequent reloads fall back to meta.spawn.
    secondStore.clear()
    const thirdStore = createWebStorageCheckpointStore(storage, checkpointStorageKey('demo'))
    assert.deepEqual(resolveSpawn(meta.spawn, thirdStore), meta.spawn,
        'after clearCheckpoint, the next reload falls back to the authored spawn')
})

test('checkpoints from different levels do not leak across each other', () => {
    const storage = fakeStorage()
    const demoStore = createWebStorageCheckpointStore(storage, checkpointStorageKey('demo'))
    const otherStore = createWebStorageCheckpointStore(storage, checkpointStorageKey('other'))
    demoStore.set({ x: 1, y: 1, z: 1 })
    assert.equal(otherStore.get(), null, 'a checkpoint for "demo" must not appear for "other"')
})
