import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager, worldToVoxel } from '../src/engine/voxel/chunk-manager'
import { CHUNK_DIM, chunkKey } from '../src/engine/voxel/chunk'
import { deserializeLevel, serializeLevel } from '../src/engine/voxel/level-serializer'
import { voxelAABBOverlap, sweepAxis } from '../src/engine/voxel/voxel-collide'
import { greedyMesh } from '../src/engine/voxel/greedy-mesher'
import { liquidTopSurfaceMesh } from '../src/engine/voxel/liquid-surface-mesher'
import { movementEnvironmentForAABB } from '../src/engine/voxel/movement-effects'
import { BLOCK, DEFAULT_PALETTE, clonePalette, isCollidable, isPathSurface, isRenderableVoxel, liquidBlockKind, voxelHeightForBlock, voxelLightSpec, voxelOpacity } from '../src/engine/voxel/palette'
import { voxelRaycast } from '../src/engine/voxel/voxel-raycast'
import { Vector3 } from 'three'

test('worldToVoxel floors positive and negative coordinates', () => {
    assert.deepEqual(worldToVoxel(1.9, 0, -0.1), { x: 1, y: 0, z: -1 })
    assert.deepEqual(worldToVoxel(-1.1, -2.9, 32), { x: -2, y: -3, z: 32 })
})

test('ChunkManager maps negative world coordinates to stable chunk/local storage', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    chunks.setVoxel(-1, 0, -33, BLOCK.stone)

    assert.equal(chunks.getVoxel(-1, 0, -33), BLOCK.stone)
    assert.equal(chunks.getChunk(-1, 0, -2)?.getLocal(CHUNK_DIM - 1, 0, CHUNK_DIM - 1), BLOCK.stone)
})

test('bulk edits summarize changed voxels and dirty chunk keys', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const emptyRevision = chunks.revision()
    chunks.getOrCreate(1, 0, 0)
    assert.ok(chunks.revision() > emptyRevision, 'creating a chunk bumps the global revision')
    chunks.drainDirty()
    const beforeEditRevision = chunks.revision()

    const result = chunks.applyBulk([
        { x: CHUNK_DIM - 1, y: 0, z: 0, value: BLOCK.stone },
        { x: CHUNK_DIM - 1, y: 0, z: 0, value: BLOCK.stone },
    ])

    assert.equal(result.changedVoxels, 1)
    assert.ok(chunks.revision() > beforeEditRevision, 'changed voxels bump the global revision once or more')
    const afterEditRevision = chunks.revision()
    chunks.setVoxel(CHUNK_DIM - 1, 0, 0, BLOCK.stone)
    assert.equal(chunks.revision(), afterEditRevision, 'no-op writes do not wake dependent render systems')
    const dirty = chunks.drainDirty().map((chunk) => chunkKey(chunk.cx, chunk.cy, chunk.cz)).sort()
    assert.deepEqual(dirty, ['0,0,0', '1,0,0'])
})

test('chunk contentHash tracks real voxel edits and ignores no-op writes', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const chunk = chunks.getOrCreate(0, 0, 0)

    assert.equal(chunk.contentHash, 0)
    chunks.setVoxel(0, 0, 0, BLOCK.stone)
    const stoneHash = chunk.contentHash
    assert.notEqual(stoneHash, 0)

    chunks.setVoxel(0, 0, 0, BLOCK.stone)
    assert.equal(chunk.contentHash, stoneHash, 'no-op writes should not change the digest')

    chunks.setVoxel(0, 0, 0, BLOCK.grass)
    const grassHash = chunk.contentHash
    assert.notEqual(grassHash, stoneHash)

    chunks.setVoxel(0, 0, 0, BLOCK.air)
    assert.equal(chunk.contentHash, 0, 'clearing the only solid voxel returns to the empty digest')
})

test('chunk contentHash is recomputed by replaceData and survives level round-trip', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.stone)
    chunks.setVoxel(2, 3, 4, BLOCK.grass)
    const original = chunks.getChunk(0, 0, 0)!
    const originalHash = original.contentHash

    const replacement = new Uint16Array(CHUNK_DIM * CHUNK_DIM * CHUNK_DIM)
    replacement[1] = BLOCK.wood
    replacement[CHUNK_DIM + 5] = BLOCK.leaf
    original.replaceData(replacement)
    const replacedHash = original.contentHash

    assert.notEqual(replacedHash, originalHash)
    assert.equal(original.nonAirCount, 2)

    const restored = deserializeLevel(serializeLevel(chunks, { name: 'hash test' }))
    const restoredChunk = restored.chunks.getChunk(0, 0, 0)!
    assert.equal(restoredChunk.contentHash, replacedHash)
    assert.equal(restoredChunk.nonAirCount, 2)
})

test('ChunkManager prunes empty chunks after large delete passes', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const startRevision = chunks.revision()
    chunks.setVoxel(0, 0, 0, BLOCK.stone)
    chunks.getOrCreate(1, 0, 0)
    assert.equal(chunks.chunkCount(), 2)

    chunks.setVoxel(0, 0, 0, BLOCK.air)
    const removed = chunks.pruneEmptyChunks()

    assert.equal(removed, 2)
    assert.equal(chunks.chunkCount(), 0)
    assert.ok(chunks.revision() > startRevision)
    assert.equal(chunks.drainDirty().length, 0)
})

test('ChunkManager owns a mutable palette copy and can replace it', () => {
    const initial = clonePalette(DEFAULT_PALETTE)
    initial.entries[BLOCK.grass]!.name = 'editor grass'
    const chunks = new ChunkManager(initial)
    initial.entries[BLOCK.grass]!.name = 'mutated outside'

    assert.equal(chunks.palette.entries[BLOCK.grass]?.name, 'editor grass')

    chunks.setVoxel(0, 0, 0, BLOCK.grass)
    chunks.drainDirty()
    const replacement = clonePalette(DEFAULT_PALETTE)
    replacement.entries[BLOCK.grass]!.color = [1, 0, 0]
    chunks.replacePalette(replacement)
    replacement.entries[BLOCK.grass]!.color = [0, 0, 0]

    assert.deepEqual(chunks.palette.entries[BLOCK.grass]?.color, [1, 0, 0])
    assert.equal(chunks.drainDirty().length, 1, 'replacing the palette remeshes existing chunks')
})

test('voxelAABBOverlap treats max boundary as exclusive', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(1, 0, 0, BLOCK.stone)

    assert.equal(voxelAABBOverlap(chunks, {
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: 1,
        maxY: 1,
        maxZ: 1,
    }), false)

    assert.equal(voxelAABBOverlap(chunks, {
        minX: 0.99,
        minY: 0,
        minZ: 0,
        maxX: 1.2,
        maxY: 1,
        maxZ: 1,
    }), true)
})

test('stairs use a half-height collision and render shape', () => {
    assert.equal(voxelHeightForBlock(DEFAULT_PALETTE, BLOCK.stairs), 0.5)
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 1, 0, BLOCK.stairs)

    assert.equal(voxelAABBOverlap(chunks, {
        minX: 0.1,
        minY: 1.49,
        minZ: 0.1,
        maxX: 0.9,
        maxY: 1.9,
        maxZ: 0.9,
    }), true)
    assert.equal(voxelAABBOverlap(chunks, {
        minX: 0.1,
        minY: 1.5,
        minZ: 0.1,
        maxX: 0.9,
        maxY: 1.9,
        maxZ: 0.9,
    }), false)

    const mesh = greedyMesh((x, y, z) => (
        x === 0 && y === 0 && z === 0 ? BLOCK.stairs : BLOCK.air
    ), 1, DEFAULT_PALETTE)
    const ys = [...mesh.positions].filter((_, i) => i % 3 === 1)
    assert.equal(Math.max(...ys), 0.5)
    assert.equal(Math.min(...ys), 0)
})

test('water, lava, and cloud are non-physical visible blocks', () => {
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.water), false)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.lava), false)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.cloud), false)
    assert.ok(voxelOpacity(DEFAULT_PALETTE, BLOCK.water) < 1)
    assert.ok(voxelOpacity(DEFAULT_PALETTE, BLOCK.lava) < 1)
    assert.ok(voxelOpacity(DEFAULT_PALETTE, BLOCK.cloud) < 1)
    assert.equal(liquidBlockKind(DEFAULT_PALETTE, BLOCK.water), 'water')
    assert.equal(liquidBlockKind(DEFAULT_PALETTE, BLOCK.lava), 'lava')

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.water)
    chunks.setVoxel(1, 0, 0, BLOCK.lava)
    chunks.setVoxel(2, 0, 0, BLOCK.cloud)

    assert.equal(voxelAABBOverlap(chunks, {
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: 3,
        maxY: 1,
        maxZ: 1,
    }), false, 'non-physical blocks do not collide')
})

test('legacy palettes migrate liquid markers without losing existing special blocks', () => {
    const legacyPalette = clonePalette(DEFAULT_PALETTE)
    delete legacyPalette.entries[BLOCK.water]!.liquid
    legacyPalette.entries.length = BLOCK.lava

    const chunks = new ChunkManager(legacyPalette)

    assert.equal(chunks.palette.entries[BLOCK.torch]?.renderAs, 'torch')
    assert.equal(chunks.palette.entries[BLOCK.unlitLantern]?.renderAs, 'torch-off')
    assert.equal(chunks.palette.entries[BLOCK.water]?.liquid, 'water')
    assert.equal(chunks.palette.entries[BLOCK.lava]?.liquid, 'lava')
})

test('default palette covers block constants and appends mine ore and dungeon blocks safely', () => {
    const blockIndices = Object.values(BLOCK)
    for (const index of blockIndices) {
        assert.ok(DEFAULT_PALETTE.entries[index], `DEFAULT_PALETTE missing BLOCK index ${index}`)
    }
    assert.equal(new Set(DEFAULT_PALETTE.entries.map((entry) => entry.name)).size, DEFAULT_PALETTE.entries.length)
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.oreIron]?.name, 'iron ore')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.oreCopper]?.name, 'copper ore')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.oreCrystal]?.name, 'crystal ore')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.chest]?.name, 'chest')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.openChest]?.name, 'open chest')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.spiderWeb]?.name, 'spider web')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.goodsShelf]?.name, 'goods shelf')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.toolPanel]?.name, 'tool panel')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.oreShelf]?.name, 'ore shelf')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.recordShelf]?.name, 'record shelf')
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.oreIron), true)
    assert.equal(isPathSurface(DEFAULT_PALETTE, BLOCK.oreCopper), true)
    assert.ok(voxelLightSpec(DEFAULT_PALETTE, BLOCK.oreCrystal), 'crystal ore should provide a subtle cave readability light')
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.chest), true)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.openChest), true)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.goodsShelf), true)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.toolPanel), true)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.oreShelf), true)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.recordShelf), true)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.spiderWeb), false)
    assert.equal(isPathSurface(DEFAULT_PALETTE, BLOCK.spiderWeb), false)
    assert.equal(isRenderableVoxel(DEFAULT_PALETTE, BLOCK.spiderWeb), true)
    assert.ok(voxelOpacity(DEFAULT_PALETTE, BLOCK.spiderWeb) > 0 && voxelOpacity(DEFAULT_PALETTE, BLOCK.spiderWeb) < 1)

    const oldPalette = clonePalette(DEFAULT_PALETTE)
    oldPalette.entries.length = BLOCK.oreIron
    const migrated = new ChunkManager(oldPalette)
    assert.equal(migrated.palette.entries[BLOCK.oreIron]?.name, 'iron ore')
    assert.equal(migrated.palette.entries[BLOCK.oreCopper]?.name, 'copper ore')
    assert.equal(migrated.palette.entries[BLOCK.oreCrystal]?.name, 'crystal ore')
    assert.equal(migrated.palette.entries[BLOCK.chest]?.name, 'chest')
    assert.equal(migrated.palette.entries[BLOCK.openChest]?.name, 'open chest')
    assert.equal(migrated.palette.entries[BLOCK.spiderWeb]?.name, 'spider web')
    assert.equal(migrated.palette.entries[BLOCK.goodsShelf]?.name, 'goods shelf')
    assert.equal(migrated.palette.entries[BLOCK.toolPanel]?.name, 'tool panel')
    assert.equal(migrated.palette.entries[BLOCK.oreShelf]?.name, 'ore shelf')
    assert.equal(migrated.palette.entries[BLOCK.recordShelf]?.name, 'record shelf')

    const customTail = clonePalette(DEFAULT_PALETTE)
    customTail.entries.length = BLOCK.oreIron
    customTail.entries.push({ name: 'custom ore slot', color: [0.2, 0.1, 0.3], solid: true })
    const custom = new ChunkManager(customTail)
    assert.equal(custom.palette.entries[BLOCK.oreIron]?.name, 'custom ore slot')
    assert.ok(custom.palette.entries.findIndex((entry) => entry.name === 'iron ore') > BLOCK.oreIron)
    assert.ok(custom.palette.entries.findIndex((entry) => entry.name === 'record shelf') > BLOCK.oreIron)
})

test('no-walk block is an invisible collidable border outside debug rendering', () => {
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.noWalk), true)
    assert.equal(isRenderableVoxel(DEFAULT_PALETTE, BLOCK.noWalk), false)
    assert.equal(voxelOpacity(DEFAULT_PALETTE, BLOCK.noWalk), 0)

    const normalMesh = greedyMesh((x, y, z) => (
        x === 0 && y === 0 && z === 0 ? BLOCK.noWalk : BLOCK.air
    ), 1, DEFAULT_PALETTE)
    assert.equal(normalMesh.vertexCount, 0, 'normal render should hide invisible borders')

    const debugMesh = greedyMesh((x, y, z) => (
        x === 0 && y === 0 && z === 0 ? BLOCK.noWalk : BLOCK.air
    ), 1, DEFAULT_PALETTE, { debugVisibleBlocks: true })
    assert.ok(debugMesh.vertexCount > 0, 'debug render should reveal invisible borders')
    assert.ok(debugMesh.colors.some((_, i) => i % 4 === 3 && debugMesh.colors[i]! > 0 && debugMesh.colors[i]! < 1))
})

test('ambient occlusion darkens occluded face corners and never brightens', () => {
    // A 3×3 stone floor with one block raised on the centre — the raised
    // block occludes a corner of each adjacent floor tile's top face.
    const solid = new Set<string>()
    for (let xx = 0; xx < 3; xx++) for (let zz = 0; zz < 3; zz++) solid.add(`${xx},0,${zz}`)
    solid.add('1,1,1')
    const sample = (x: number, y: number, z: number): number => (solid.has(`${x},${y},${z}`) ? BLOCK.stone : BLOCK.air)

    const flat = greedyMesh(sample, 4, DEFAULT_PALETTE)
    const ao = greedyMesh(sample, 4, DEFAULT_PALETTE, { ambientOcclusion: true })

    // Without AO every stone face shares the one authored albedo on R.
    const flatReds = new Set<string>()
    for (let k = 0; k < flat.vertexCount; k++) flatReds.add(flat.colors[k * 4]!.toFixed(4))
    assert.equal(flatReds.size, 1, 'without AO all stone faces share one colour')
    const base = flat.colors[0]!

    let minR = Infinity
    let maxR = -Infinity
    for (let k = 0; k < ao.vertexCount; k++) {
        const r = ao.colors[k * 4]!
        minR = Math.min(minR, r)
        maxR = Math.max(maxR, r)
    }
    assert.ok(minR < base - 1e-6, 'AO darkens some occluded corners')
    assert.ok(maxR <= base + 1e-6, 'AO never brightens above the base albedo')
    assert.ok(ao.vertexCount >= flat.vertexCount, 'AO splits merged quads at AO discontinuities')

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.noWalk)
    assert.equal(voxelAABBOverlap(chunks, {
        minX: 0.1,
        minY: 0,
        minZ: 0.1,
        maxX: 0.9,
        maxY: 0.9,
        maxZ: 0.9,
    }), true)
})

test('legacy no-walk ward palettes migrate to invisible border semantics', () => {
    const legacyPalette = clonePalette(DEFAULT_PALETTE)
    legacyPalette.entries[BLOCK.noWalk] = {
        name: 'no-walk ward',
        color: [0.58, 0.18, 0.70],
        solid: true,
        pathSurface: false,
    }

    const chunks = new ChunkManager(legacyPalette)
    const entry = chunks.palette.entries[BLOCK.noWalk]!

    assert.equal(entry.name, 'invisible border')
    assert.equal(entry.opacity, 0)
    assert.equal(entry.debugVisible, true)
    assert.equal(isCollidable(chunks.palette, BLOCK.noWalk), true)
    assert.equal(isRenderableVoxel(chunks.palette, BLOCK.noWalk), false)
})

test('liquid top surface mesh follows exposed water and lava top faces', () => {
    const cells = new Map<string, number>()
    const sample = (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`) ?? BLOCK.air

    cells.set('0,0,0', BLOCK.water)
    cells.set('1,0,0', BLOCK.water)
    const water = liquidTopSurfaceMesh(sample, 3, DEFAULT_PALETTE, 'water', { subdivisionsPerCell: 1, surfaceOffset: 0 })
    assert.equal(water.vertexCount, 6, 'two adjacent cells merge into one 2x1 surface grid')
    assert.equal(water.triangleCount, 4)
    assert.deepEqual([...new Set([...water.positions].filter((_, i) => i % 3 === 1))], [1])

    const coarse = liquidTopSurfaceMesh(sample, 3, DEFAULT_PALETTE, 'water', { subdivisionsPerCell: 0, surfaceOffset: 0.045 })
    assert.equal(coarse.vertexCount, 4, 'zero subdivisions emits one quad per merged rectangle')
    assert.equal(coarse.triangleCount, 2)
    assert.ok(Math.abs(coarse.positions[1]! - 1.045) < 1e-5)

    const baseMeshWithoutTop = greedyMesh(sample, 3, DEFAULT_PALETTE, { skipLiquidTopFaces: true })
    assert.equal(baseMeshWithoutTop.triangleCount, 10, 'chunk mesh skips the liquid top face when a surface mesh owns it')
    assert.equal(hasUpwardFace(baseMeshWithoutTop.normals), false)

    cells.set('0,1,0', BLOCK.stone)
    cells.set('1,1,0', BLOCK.stone)
    const hidden = liquidTopSurfaceMesh(sample, 3, DEFAULT_PALETTE, 'water', { subdivisionsPerCell: 1, surfaceOffset: 0 })
    assert.equal(hidden.vertexCount, 0, 'solid blocks immediately above hide the liquid surface')

    cells.clear()
    cells.set('0,0,0', BLOCK.water)
    cells.set('0,1,0', BLOCK.lava)
    const hiddenByLiquid = liquidTopSurfaceMesh(sample, 3, DEFAULT_PALETTE, 'water', { subdivisionsPerCell: 1, surfaceOffset: 0 })
    assert.equal(hiddenByLiquid.vertexCount, 0, 'liquid blocks immediately above hide internal liquid surfaces')

    cells.clear()
    cells.set('0,0,0', BLOCK.lava)
    const lava = liquidTopSurfaceMesh(sample, 3, DEFAULT_PALETTE, 'lava', { subdivisionsPerCell: 1, surfaceOffset: 0 })
    assert.ok(lava.vertexCount > 0)
    const noWater = liquidTopSurfaceMesh(sample, 3, DEFAULT_PALETTE, 'water', { subdivisionsPerCell: 1, surfaceOffset: 0 })
    assert.equal(noWater.vertexCount, 0)
})

function hasUpwardFace(normals: Float32Array): boolean {
    for (let i = 0; i < normals.length; i += 3) {
        if (normals[i] === 0 && normals[i + 1] === 1 && normals[i + 2] === 0) return true
    }
    return false
}

test('movementEnvironmentForAABB applies water movement and lava contact hazards', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.water)
    chunks.setVoxel(2, 0, 0, BLOCK.cloud)
    chunks.setVoxel(4, 0, 0, BLOCK.lava)

    const water = movementEnvironmentForAABB(chunks, {
        minX: 0.1,
        minY: 0,
        minZ: 0.1,
        maxX: 0.9,
        maxY: 1,
        maxZ: 0.9,
    })
    assert.equal(water.jumpDisabled, true)
    assert.ok(water.speedMultiplier < 1, `expected water to slow movement, got ${water.speedMultiplier}`)
    assert.equal(water.contactHazard, null)

    const cloud = movementEnvironmentForAABB(chunks, {
        minX: 2.1,
        minY: 0,
        minZ: 0.1,
        maxX: 2.9,
        maxY: 1,
        maxZ: 0.9,
    })
    assert.deepEqual(cloud, { speedMultiplier: 1, jumpDisabled: false, contactHazard: null })

    chunks.setVoxel(3, 0, 0, BLOCK.spiderWeb)
    const web = movementEnvironmentForAABB(chunks, {
        minX: 3.1,
        minY: 0,
        minZ: 0.1,
        maxX: 3.9,
        maxY: 1,
        maxZ: 0.9,
    })
    assert.equal(web.speedMultiplier, 0.18)
    assert.equal(web.jumpDisabled, false)
    assert.equal(web.contactHazard, null)

    const lava = movementEnvironmentForAABB(chunks, {
        minX: 4.1,
        minY: 0,
        minZ: 0.1,
        maxX: 4.9,
        maxY: 1,
        maxZ: 0.9,
    })
    assert.equal(lava.contactHazard, 'lava')
})

test('voxelRaycast: arrows (collidable predicate) pass through water and hit stone behind', () => {
    // Regression: water has `raycastTarget: true` so the editor cursor can
    // target water cells, but arrows must pass through. The arrow-hit-system
    // calls voxelRaycast with the `isCollidable` predicate to get that
    // behaviour — verify it skips water and lands on the next collidable
    // cell along the ray.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(2, 0, 0, BLOCK.water)
    chunks.setVoxel(5, 0, 0, BLOCK.stone)

    const origin = new Vector3(0.5, 0.5, 0.5)
    const dir = new Vector3(1, 0, 0)

    // Default predicate hits the water (so the editor cursor can target it).
    const editorHit = voxelRaycast(chunks, origin, dir, 10)
    assert.equal(editorHit?.voxel.x, 2, 'editor cursor targets water')

    // isCollidable predicate skips water, hits the stone behind.
    const arrowHit = voxelRaycast(chunks, origin, dir, 10, isCollidable)
    assert.equal(arrowHit?.voxel.x, 5, 'arrow passes through water and lands on stone')
})

test('greedyMesh emits alpha for transparent non-occluding voxels', () => {
    const mesh = greedyMesh((x, y, z) => (
        x === 0 && y === 0 && z === 0 ? BLOCK.water : BLOCK.air
    ), 1, DEFAULT_PALETTE)

    assert.ok(mesh.vertexCount > 0, 'water should render despite being non-occluding')
    assert.equal(mesh.colors.length, mesh.vertexCount * 4, 'mesh colors include alpha')
    assert.ok(mesh.colors.some((_, i) => i % 4 === 3 && mesh.colors[i]! < 1), 'at least one vertex is translucent')
})

test('sweepAxis clamps movement before a blocking voxel', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(1, 0, 0, BLOCK.stone)
    const pos = { x: 0, y: 0, z: 0.5 }
    const half = { x: 0.25, y: 0.5, z: 0.25 }

    const sweep = sweepAxis(chunks, pos, half, 'x', 2)

    assert.equal(sweep.blocked, true)
    assert.ok(pos.x < 0.751)
    assert.ok(pos.x > 0.74)
})

test('level serialization round-trips palette, metadata, and chunks', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const customBlock = chunks.palette.entries.length
    chunks.palette.entries.push({
        name: 'violet glass',
        color: [0.55, 0.25, 0.95],
        solid: false,
        collidable: false,
        occludesFaces: false,
        raycastTarget: true,
        opacity: 0.35,
    })
    chunks.setVoxel(2, 3, 4, BLOCK.grass)
    chunks.setVoxel(-1, 0, 0, BLOCK.brick)
    chunks.setVoxel(6, 7, 8, customBlock)

    const metadata = { spawn: { x: 2.5, y: 4, z: 4.5 }, name: 'test-level' }
    const buffer = serializeLevel(chunks, metadata)
    const loaded = deserializeLevel<typeof metadata>(buffer)

    assert.deepEqual(loaded.metadata, metadata)
    assert.equal(loaded.chunks.palette.entries[BLOCK.brick]?.name, 'brick')
    assert.equal(loaded.chunks.palette.entries[customBlock]?.name, 'violet glass')
    assert.deepEqual(loaded.chunks.palette.entries[customBlock]?.color, [0.55, 0.25, 0.95])
    assert.equal(loaded.chunks.getVoxel(2, 3, 4), BLOCK.grass)
    assert.equal(loaded.chunks.getVoxel(-1, 0, 0), BLOCK.brick)
    assert.equal(loaded.chunks.getVoxel(6, 7, 8), customBlock)
    assert.equal(loaded.chunks.chunkCount(), chunks.chunkCount())
})
