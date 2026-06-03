import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { aabbFromFoot, voxelAABBOverlap, type AABB } from '../src/engine/voxel/voxel-collide'
import { BLOCK, DEFAULT_PALETTE, voxelLightSpec } from '../src/engine/voxel/palette'
import { MAIN_CHARACTER_COLLIDER_HALF_HEIGHT, MAIN_CHARACTER_COLLIDER_RADIUS } from '../src/game/assets/main-character'
import { generatePlatformerLevel } from '../src/game/level'
import {
    COMBAT_ARENA_LEVEL_ID,
    DEMO_FROM_ARENA_ARRIVAL_ID,
    DEMO_FROM_GARDEN_ARRIVAL_ID,
    DEMO_FROM_TOWN_ARRIVAL_ID,
    DEMO_LEVEL_ID,
    LARGE_TOWN_LEVEL_ID,
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
    assert.equal(meta.player.abilities.highJump, false)
    assert.equal(meta.player.inventory.items['heal-potion']?.quantity, 2)
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
    assert.equal(portal?.active, false, 'paid shrine script should open this gate temporarily')
    assert.equal(arrival?.kind, 'arrival')
})

test('demo large-town portal and return arrival sit on clear ground', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = generatePlatformerLevel(chunks)
    const portal = meta.zones.find((zone) => zone.portal?.targetLevelId === LARGE_TOWN_LEVEL_ID)
    const arrival = meta.zones.find((zone) => zone.id === DEMO_FROM_TOWN_ARRIVAL_ID)

    assert.equal(portal?.kind, 'portal')
    assert.equal(arrival?.kind, 'arrival')
    assert.deepEqual(portal?.min, { x: 20, y: 5, z: 21 })
    assert.deepEqual(portal?.max, { x: 22, y: 7, z: 23 })

    const portalMin = portal!.min
    const portalMax = portal!.max
    for (let x = portalMin.x; x < portalMax.x; x++) {
        for (let zz = portalMin.z; zz < portalMax.z; zz++) {
            assert.notEqual(chunks.getVoxel(x, 4, zz), BLOCK.air, `portal ${x},4,${zz} should have floor`)
            assert.equal(chunks.getVoxel(x, 5, zz), BLOCK.air, `portal ${x},5,${zz} should be clear`)
            assert.equal(chunks.getVoxel(x, 6, zz), BLOCK.air, `portal ${x},6,${zz} should be clear`)
        }
    }

    const arrivalX = Math.floor((arrival!.min.x + arrival!.max.x) * 0.5)
    const arrivalZ = Math.floor((arrival!.min.z + arrival!.max.z) * 0.5)
    assert.notEqual(chunks.getVoxel(arrivalX, 4, arrivalZ), BLOCK.air, 'return arrival should have floor')
    assert.equal(chunks.getVoxel(arrivalX, 5, arrivalZ), BLOCK.air, 'return arrival foot cell should be clear')
    assert.equal(chunks.getVoxel(arrivalX, 6, arrivalZ), BLOCK.air, 'return arrival body cell should be clear')
})

test('demo combat arena return arrival gives the player collider clear space', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = generatePlatformerLevel(chunks)
    const portal = meta.zones.find((zone) => zone.portal?.targetLevelId === COMBAT_ARENA_LEVEL_ID)
    const arrival = meta.zones.find((zone) => zone.id === DEMO_FROM_ARENA_ARRIVAL_ID)

    assert.equal(portal?.kind, 'portal')
    assert.equal(arrival?.kind, 'arrival')
    assert.deepEqual(arrival?.min, { x: 18.25, y: 5, z: 14.25 })
    assert.deepEqual(arrival?.max, { x: 19.75, y: 6.8, z: 15.75 })
    assert.equal(zonesOverlap(portal!, arrival!), false, 'return arrival must not overlap the outgoing arena portal')
    assertPlayerArrivalClear(chunks, arrival!, 'combat arena return arrival')
})

test('demo pistons carry stable ids for script targeting', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))
    const ids = meta.pistons.map((p) => p.id)
    assert.deepEqual(ids.sort(), ['piston.cliff-lift', 'piston.elevator', 'piston.trap'])
})

test('demo cliff has a vertical ladder with clear bottom and top dismounts', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    generatePlatformerLevel(chunks)

    for (let y = 5; y <= 8; y++) {
        assert.equal(chunks.getVoxel(20, y, 4), BLOCK.ladder, `ladder cell at 20,${y},4`)
    }
    assert.equal(chunks.getVoxel(20, 4, 4), BLOCK.plank, 'ladder bottom should stand on the lower plank')
    assert.equal(chunks.getVoxel(21, 8, 4), BLOCK.plank, 'ladder top should exit onto the upper plank')
    assertPlayerFootClear(chunks, { x: 20.5, y: 5, z: 4.5 }, 'ladder bottom')
    assertPlayerFootClear(chunks, { x: 21.5, y: 9, z: 4.5 }, 'ladder top')
})

function assertPlayerArrivalClear(chunks: ChunkManager, zone: NonNullable<ReturnType<typeof generatePlatformerLevel>['zones'][number]>, label: string): void {
    const pos = {
        x: (zone.min.x + zone.max.x) * 0.5,
        y: zone.min.y,
        z: (zone.min.z + zone.max.z) * 0.5,
    }
    const box: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    aabbFromFoot(pos, {
        x: MAIN_CHARACTER_COLLIDER_RADIUS,
        y: MAIN_CHARACTER_COLLIDER_HALF_HEIGHT,
        z: MAIN_CHARACTER_COLLIDER_RADIUS,
    }, box)

    assert.equal(voxelAABBOverlap(chunks, box), false, `${label} should fit the full player collider`)
}

function assertPlayerFootClear(chunks: ChunkManager, pos: { x: number; y: number; z: number }, label: string): void {
    const box: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    aabbFromFoot(pos, {
        x: MAIN_CHARACTER_COLLIDER_RADIUS,
        y: MAIN_CHARACTER_COLLIDER_HALF_HEIGHT,
        z: MAIN_CHARACTER_COLLIDER_RADIUS,
    }, box)

    assert.equal(voxelAABBOverlap(chunks, box), false, `${label} should fit the full player collider`)
}

function zonesOverlap(
    a: NonNullable<ReturnType<typeof generatePlatformerLevel>['zones'][number]>,
    b: NonNullable<ReturnType<typeof generatePlatformerLevel>['zones'][number]>,
): boolean {
    return a.min.x < b.max.x && a.max.x > b.min.x &&
        a.min.y < b.max.y && a.max.y > b.min.y &&
        a.min.z < b.max.z && a.max.z > b.min.z
}

test('demo level: id-bearing pistons round-trip through the editor -> buffer -> editor mapping', () => {
    // Procedural level -> editor meta -> binary buffer -> editor meta -> runtime meta.
    // The slice the dynamic location system exercises (and the playtest path
    // in the editor) must preserve piston ids end-to-end so scripts can
    // address them from any load path.
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))
    const ids = meta.pistons.map((p) => p.id).filter(Boolean)
    assert.ok(ids.length === 3, 'baseline: three id-bearing pistons in the demo')
})

test('demo level has a paid portal shrine and dormant magic gate FX', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))
    const shrine = meta.zones.find((zone) => zone.id === 'zone.demo.portal-shrine')
    const fx = meta.weatherZones.find((zone) => zone.id === 'fx.demo.portal.magic')

    assert.equal(shrine?.kind, 'interact')
    assert.equal(shrine?.interaction?.prompt, 'Pay 1 Coin')
    assert.ok(meta.props.some((prop) => prop.id === 'demo:portal-shrine' && prop.kind === 'portal-shrine'))
    assert.equal(fx?.presetId, 'magic')
    assert.equal(fx?.enabled, false)
})

test('demo level uses the rigged Keeper Arlen NPC model at the quest spot', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))
    const arlen = meta.npcs.find((npc) => npc.id === 'demo-keeper-arlen')

    assert.equal(arlen?.name, 'Keeper Arlen')
    assert.equal(arlen?.model, 'keeper-arlen')
    assert.equal(arlen?.interactionEnabled, false, 'quest interaction remains owned by zone.demo.keeper')
    assert.ok(!meta.props.some((prop) => prop.id === 'demo:npc:keeper'), 'old static Keeper prop should not render in the demo')
})

test('demo level includes a lava pond authored as lethal lava blocks', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    generatePlatformerLevel(chunks)

    assert.equal(chunks.getVoxel(16, 4, 4), BLOCK.lava, 'lava pond center should be lava at ground level')
    assert.equal(chunks.getVoxel(16, 5, 4), BLOCK.air, 'lava pond should expose the liquid surface')
    assert.equal(chunks.getVoxel(18, 4, 4), BLOCK.lava, 'lava pond should have visible width for surface rendering')
    assert.equal(chunks.getVoxel(16, 3, 4), BLOCK.stone, 'lava pond should have a stone bed')
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

test('teleport garden is authored as a small park destination', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = generateTeleportGardenLevel(chunks)

    assert.equal(meta.weatherZones.some((zone) => zone.id === 'fx.teleport-garden.pond-water'), false)
    assert.ok(meta.weatherZones.some((zone) => zone.id === 'fx.teleport-garden.falling-leaves' && zone.presetId === 'leaves'))
    assert.ok(meta.props.some((prop) => prop.id === 'teleport-garden:picnic-table' && prop.kind === 'table-2'))
    assert.ok(meta.props.some((prop) => prop.id === 'teleport-garden:sundial' && prop.kind === 'sundial'))
    assert.ok(meta.props.length >= 12)
    assert.equal(meta.coinPiles.length, 3)
    assert.equal(chunks.getVoxel(8, 4, 9), BLOCK.water, 'pond water should sit in the carved ground layer')
    assert.equal(chunks.getVoxel(8, 5, 9), BLOCK.air, 'pond should not float one layer above the terrain')
    assert.equal(chunks.getVoxel(10, 4, 10), BLOCK.water, 'pond center should stay open for liquid-surface previews')
    assert.equal(chunks.getVoxel(7, 4, 8), BLOCK.stairs, 'pond border should use stairs for walk-out access')
    assert.equal(chunks.getVoxel(13, 4, 8), BLOCK.stairs, 'pond border should use stairs for walk-out access')
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

test('demo includes a repairable cabin lift for the east cliff', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = generatePlatformerLevel(chunks)
    const lift = meta.pistons.find((piston) => piston.id === 'piston.cliff-lift')
    const bottom = meta.zones.find((zone) => zone.id === 'zone.demo.cliff-lift.bottom')
    const top = meta.zones.find((zone) => zone.id === 'zone.demo.cliff-lift.top')

    assert.equal(lift?.motion, 'physical')
    assert.equal(lift?.visualKind, 'lift-cabin-repaired')
    assert.equal(lift?.deployed, false)
    assert.deepEqual(lift?.from, { x: 21, y: 5, z: 5 })
    assert.deepEqual(lift?.to, { x: 21, y: 8, z: 5 })
    assert.equal(chunks.getVoxel(21, 5, 5), BLOCK.air, 'lift bottom endpoint must be clear')
    assert.equal(chunks.getVoxel(21, 8, 5), BLOCK.air, 'lift top endpoint must be clear')
    assert.equal(bottom?.kind, 'interact')
    assert.equal(top?.kind, 'interact')
    assert.ok(meta.props.some((prop) => prop.id === 'demo:cliff-lift-broken' && prop.kind === 'lift-cabin-broken'))
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
