import test from 'node:test'
import assert from 'node:assert/strict'
import {
    LIFT_CABIN_REPAIRED_INTERIOR_CLEARANCE,
    disposePropModels,
    getPropModel,
} from '../src/game/props/prop-models'
import { PROP_KINDS, PROP_LABELS } from '../src/game/props/prop-types'
import { MAIN_CHARACTER_COLLIDER_HEIGHT } from '../src/game/assets/main-character'

test('every PROP_KIND yields a valid merged geometry with vertex colours', () => {
    for (const kind of PROP_KINDS) {
        const { geometry } = getPropModel(kind)
        const pos = geometry.getAttribute('position')
        const col = geometry.getAttribute('color')
        assert.ok(pos, `${kind} must have a position attribute`)
        assert.ok(col, `${kind} must have a colour attribute (vertex-coloured)`)
        assert.equal(col!.count, pos!.count,
            `${kind} colour attribute must have one entry per vertex (${col!.count} vs ${pos!.count})`)
        assert.ok(pos!.count > 0, `${kind} must have at least one vertex`)
        // Keep poly counts honest — props are decorative, not hero meshes.
        assert.ok(pos!.count < 1024, `${kind} vertex count ${pos!.count} is suspiciously high for a decorative prop`)
    }
})

test('getPropModel caches the merged geometry per kind', () => {
    const a = getPropModel('flower').geometry
    const b = getPropModel('flower').geometry
    assert.strictEqual(a, b, 'second lookup must return the cached instance')
})

test('prop registry exposes numbered decorative variants', () => {
    assert.ok(PROP_KINDS.includes('bush-2'), 'Bush 2 must be available in the prop picker')
    assert.ok(PROP_KINDS.includes('bush-3'), 'Bush 3 must be available in the prop picker')
    assert.ok(PROP_KINDS.includes('mushroom-2'), 'Mushroom 2 must be available in the prop picker')
    assert.equal(PROP_LABELS.bush, 'Bush 1')
    assert.equal(PROP_LABELS['mushroom-3'], 'Mushroom 3')
})

test('mushroom variants sit on their base and keep a readable cap silhouette', () => {
    for (const kind of ['mushroom', 'mushroom-2', 'mushroom-3'] as const) {
        const { geometry } = getPropModel(kind)
        geometry.computeBoundingBox()
        const box = geometry.boundingBox
        assert.ok(box, `${kind} must have a bounding box`)
        assert.ok(box!.min.y >= -0.001, `${kind} should not sink below its placement base`)
        assert.ok(box!.max.y > 0.18, `${kind} should be tall enough to read as a mushroom`)
        assert.ok((box!.max.x - box!.min.x) > 0.15, `${kind} should have a visible cap width`)
    }
})

test('lift cabin variants are registered, distinct, and sized for a player lift', () => {
    assert.ok(PROP_KINDS.includes('lift-cabin-broken'))
    assert.ok(PROP_KINDS.includes('lift-cabin-repaired'))
    assert.equal(PROP_LABELS['lift-cabin-broken'], 'Broken Lift Cabin')
    assert.equal(PROP_LABELS['lift-cabin-repaired'], 'Repaired Lift Cabin')

    const broken = getPropModel('lift-cabin-broken').geometry
    const repaired = getPropModel('lift-cabin-repaired').geometry
    broken.computeBoundingBox()
    repaired.computeBoundingBox()
    assert.ok(broken.boundingBox)
    assert.ok(repaired.boundingBox)
    assert.ok(broken.boundingBox!.min.y >= -0.001, 'broken cabin sits on its placement base')
    assert.ok(repaired.boundingBox!.min.y >= -0.001, 'repaired cabin sits on its placement base')
    assert.ok(repaired.boundingBox!.max.y > broken.boundingBox!.max.y, 'repaired cabin has upright posts/roof')
    assert.ok((repaired.boundingBox!.max.x - repaired.boundingBox!.min.x) >= 1.1, 'repaired cabin spans a lift platform')
    assert.ok(
        LIFT_CABIN_REPAIRED_INTERIOR_CLEARANCE >= MAIN_CHARACTER_COLLIDER_HEIGHT + 0.1,
        'repaired cabin roof clearance should fit the player with a little headroom',
    )
    assert.notEqual(
        broken.getAttribute('position')!.count,
        repaired.getAttribute('position')!.count,
        'broken and repaired variants should not collapse to the same mesh',
    )
})

test('disposePropModels clears the cache so the next lookup rebuilds', () => {
    const before = getPropModel('bush').geometry
    disposePropModels()
    const after = getPropModel('bush').geometry
    assert.notStrictEqual(after, before, 'cache should rebuild after dispose')
})

test('vertex colours are in linear-space [0, 1] range (no accidental 0..255)', () => {
    // Quick sanity: if a recipe accidentally writes a byte (0..255) where
    // it should write a normalized float, the colour attribute would
    // have values far above 1.
    for (const kind of PROP_KINDS) {
        const { geometry } = getPropModel(kind)
        const col = geometry.getAttribute('color')!
        const arr = col.array as ArrayLike<number>
        for (let i = 0; i < arr.length; i++) {
            const v = arr[i]!
            assert.ok(v >= 0 && v <= 1.01, `${kind} colour channel ${i} = ${v} out of [0, 1] range`)
        }
    }
})
