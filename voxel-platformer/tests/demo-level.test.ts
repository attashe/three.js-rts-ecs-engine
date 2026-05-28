import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE, voxelLightSpec } from '../src/engine/voxel/palette'
import { generatePlatformerLevel } from '../src/game/level'
import {
    DEMO_FROM_GARDEN_ARRIVAL_ID,
    DEMO_LEVEL_ID,
    TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
    TELEPORT_GARDEN_LEVEL_ID,
    generateTeleportGardenLevel,
} from '../src/game/procedural-levels'

test('demo level starts with an animated outdoor day cycle', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))

    assert.equal(meta.ambientWeather?.presetId, 'clear')
    assert.equal(meta.ambientWeather?.state.mode, 'outdoor')
    assert.equal(meta.ambientWeather?.state.cycleEnabled, true)
    assert.equal(meta.ambientWeather?.state.timeOfDay, 8)
    assert.equal(meta.ambientWeather?.state.fogDensityMul, 0.45)
    assert.equal(meta.ambientWeather?.state.rainOn, false)
    assert.equal(meta.ambientWeather?.state.lightningOn, false)
})

test('generatePlatformerLevel exposes a stable level name for the script engine', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))
    assert.equal(meta.name, DEMO_LEVEL_ID)
    assert.equal(meta.size, 24)
})

test('demo level has a portal and safe return arrival for travel tests', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))
    const portal = meta.zones.find((zone) => zone.id === 'zone.demo.portal.teleport-garden')
    const arrival = meta.zones.find((zone) => zone.id === DEMO_FROM_GARDEN_ARRIVAL_ID)

    assert.equal(portal?.kind, 'portal')
    assert.deepEqual(portal?.portal, {
        targetLevelId: TELEPORT_GARDEN_LEVEL_ID,
        targetArrivalId: TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
    })
    assert.equal(portal?.triggerSources?.includes('player'), true)
    assert.equal(arrival?.kind, 'arrival')
})

test('teleport garden returns to the demo arrival instead of the default spawn', () => {
    const meta = generateTeleportGardenLevel(new ChunkManager(DEFAULT_PALETTE))
    const arrival = meta.zones.find((zone) => zone.id === TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID)
    const portal = meta.zones.find((zone) => zone.id === 'zone.teleport-garden.portal.demo')

    assert.equal(meta.name, 'Teleport Garden')
    assert.equal(meta.size, 20)
    assert.equal(arrival?.kind, 'arrival')
    assert.deepEqual(portal?.portal, {
        targetLevelId: DEMO_LEVEL_ID,
        targetArrivalId: DEMO_FROM_GARDEN_ARRIVAL_ID,
    })
    assert.equal(portal?.triggerSources?.includes('player'), true)
})

test('procedural travel markers do not create per-voxel point lights', () => {
    const demoChunks = new ChunkManager(DEFAULT_PALETTE)
    generatePlatformerLevel(demoChunks)
    assert.equal(countBlockLightVoxels(demoChunks), 0)

    const gardenChunks = new ChunkManager(DEFAULT_PALETTE)
    generateTeleportGardenLevel(gardenChunks)
    assert.equal(countBlockLightVoxels(gardenChunks), 0)
})

test('demo sundial interaction prompt names the object and action clearly', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))
    const sundial = meta.zones.find((zone) => zone.id === 'zone.demo.sundial')

    assert.equal(sundial?.label, 'Floating Sundial')
    assert.equal(sundial?.interaction?.prompt, 'Read Sundial')
    assert.ok(meta.props.some((prop) => prop.id === 'demo:sundial' && prop.kind === 'sundial'))
})

test('demo haste shrine is an interactable prop near the spawn plaza', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))
    const shrine = meta.zones.find((zone) => zone.id === 'zone.demo.haste-shrine')

    assert.equal(shrine?.label, 'Shrine of Haste')
    assert.equal(shrine?.kind, 'interact')
    assert.equal(shrine?.interaction?.prompt, 'Invoke Haste')
    assert.ok(meta.props.some((prop) => prop.id === 'demo:haste-shrine' && prop.kind === 'haste-shrine'))
})

function countBlockLightVoxels(chunks: ChunkManager): number {
    let count = 0
    for (const chunk of chunks.allChunks()) {
        chunk.forEachSolid((_x, _y, _z, value) => {
            if (voxelLightSpec(chunks.palette, value)) count++
        })
    }
    return count
}
