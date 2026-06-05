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

test('eagle shrine is registered as a readable final-location prop', () => {
    assert.ok(PROP_KINDS.includes('eagle-shrine'))
    assert.equal(PROP_LABELS['eagle-shrine'], 'Shrine of the Eagle God')

    const shrine = getPropModel('eagle-shrine').geometry
    shrine.computeBoundingBox()
    assert.ok(shrine.boundingBox)
    assert.ok(shrine.boundingBox!.min.y >= -0.001, 'eagle shrine sits on its placement base')
    assert.ok(shrine.boundingBox!.max.y > 1.25, 'eagle shrine should stand tall enough to anchor the summit')
    assert.ok(shrine.boundingBox!.max.x - shrine.boundingBox!.min.x > 1.25, 'wing span should read from the isometric camera')
    assert.ok(shrine.getAttribute('position')!.count < 1024, 'eagle shrine should stay cheap as a decorative prop')
})

test('shop display props are registered as compact decorative assets', () => {
    const shopKinds = [
        'market-meat',
        'market-apples',
        'market-fish',
        'spear-rack',
        'arrow-barrel',
        'helmet-stand',
        'hat-display',
        'boot-rack',
        'potion-shelf',
        'alchemy-cauldron',
    ] as const
    for (const kind of shopKinds) {
        assert.ok(PROP_KINDS.includes(kind))
        assert.ok(PROP_LABELS[kind].length > 0)
        const geometry = getPropModel(kind).geometry
        geometry.computeBoundingBox()
        assert.ok(geometry.boundingBox)
        assert.ok(geometry.boundingBox!.min.y >= -0.001, `${kind} should sit on its placement base`)
        assert.ok(geometry.boundingBox!.max.y > 0.1, `${kind} should have a visible silhouette`)
    }
})

test('forest lift quest props are registered as compact readable assets', () => {
    const kinds = [
        'broken-wagon',
        'fallen-driver',
        'repair-materials-crate',
        'lift-control-lever',
        'road-sign',
    ] as const
    for (const kind of kinds) {
        assert.ok(PROP_KINDS.includes(kind))
        assert.ok(PROP_LABELS[kind].length > 0)
        const geometry = getPropModel(kind).geometry
        geometry.computeBoundingBox()
        assert.ok(geometry.boundingBox)
        assert.ok(geometry.boundingBox!.min.y >= -0.001, `${kind} should sit on its placement base`)
        assert.ok(geometry.boundingBox!.max.y > 0.12, `${kind} should have a visible silhouette`)
    }

    const wagon = getPropModel('broken-wagon').geometry.boundingBox!
    assert.ok(wagon.max.x - wagon.min.x > 1.2, 'broken wagon should read wider than a small crate')
    const driver = getPropModel('fallen-driver').geometry.boundingBox!
    assert.ok(driver.max.z - driver.min.z > 0.7, 'fallen driver should read as a prone body')
    const lever = getPropModel('lift-control-lever').geometry.boundingBox!
    assert.ok(lever.max.y > 0.75, 'lift control lever should be tall enough to read as an interaction marker')
    assert.ok(lever.max.x - lever.min.x < 0.7, 'lift control lever should stay compact beside a lift platform')
    const sign = getPropModel('road-sign').geometry.boundingBox!
    assert.ok(sign.max.y > 1.2, 'road sign should stand above short ground props')
    assert.ok(sign.max.x - sign.min.x > 1.1, 'road sign should have a readable plank silhouette')
})

test('mine props are registered as compact readable assets', () => {
    const kinds = [
        'ore-pile',
        'ore-crate',
        'mine-tool-rack',
        'broken-rail-cart',
        'support-debris',
        'notice-board',
        'vent-fan',
        'abandoned-lamp-cluster',
    ] as const
    for (const kind of kinds) {
        assert.ok(PROP_KINDS.includes(kind))
        assert.ok(PROP_LABELS[kind].length > 0)
        const geometry = getPropModel(kind).geometry
        geometry.computeBoundingBox()
        assert.ok(geometry.boundingBox)
        assert.ok(geometry.boundingBox!.min.y >= -0.001, `${kind} should sit on its placement base`)
        assert.ok(geometry.boundingBox!.max.y > 0.10, `${kind} should have a visible silhouette`)
    }

    const cart = getPropModel('broken-rail-cart').geometry.boundingBox!
    assert.ok(cart.max.x - cart.min.x > 0.9, 'broken rail cart should read wider than a small crate')
    const rack = getPropModel('mine-tool-rack').geometry.boundingBox!
    assert.ok(rack.max.y > 0.75, 'mine tool rack should stand tall enough for wall dressing')
    const fan = getPropModel('vent-fan').geometry.boundingBox!
    assert.ok(fan.max.x - fan.min.x > 0.6, 'vent fan should have a readable circular frame')
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
