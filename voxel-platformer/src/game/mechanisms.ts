import { addComponent, addComponents } from 'bitecs'
import { Group, Mesh } from 'three'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { paletteEntry, voxelOpacity } from '../engine/voxel/palette'
import { BoxCollider, Position, Renderable, Rotation } from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import type { GameWorld, PistonMechanism, VoxelCoord } from '../engine/ecs/world'
import { sharedBoxGeometry, sharedMaterial } from './assets'

export interface PistonMechanismConfig {
    from: VoxelCoord
    to: VoxelCoord
    /** Palette index of the moving block. */
    block: number
    /** Seconds spent waiting at each endpoint before moving/flipping.
     *  Use 0 for continuous back-and-forth motion. Default 2. */
    delay?: number
    /** Backward-compatible name for old saves/configs. Prefer `delay`. */
    interval?: number
    /** `teleport` rewrites voxel cells; `physical` moves a renderable
     *  collidable block entity between endpoints. Default `teleport`. */
    motion?: PistonMechanism['motion']
    /** Seconds spent travelling between endpoints for physical pistons. */
    travelTime?: number
    /** How to handle a character occupying the target cell. Default 'block'. */
    characterPolicy?: PistonMechanism['characterPolicy']
    /** Which cell holds the block at level load. Default `'from'`. */
    initial?: 'from' | 'to'
    /** Asset id played at the piston's position on each flip. */
    moveSoundId?: string
    /** 0..1 gain multiplier for the move sound. Default 1. */
    moveSoundVolume?: number
}

/**
 * Register a moving-platform piston AND seed its initial voxel into the
 * world. Pistons mutate `chunks` on flip but they don't auto-populate the
 * initial cell — without this seeding the player has nothing to stand on
 * (elevators) or sees the block "appear out of nowhere" on the first tick.
 *
 * Past the initial cell, `piston-system.ts` owns all voxel writes via
 * `chunks.applyBulk` so the renderer remeshes once per flip.
 */
export function registerPistonMechanism(
    world: GameWorld,
    chunks: ChunkManager,
    config: PistonMechanismConfig,
): PistonMechanism {
    const delay = config.delay ?? config.interval ?? 2
    const motion = config.motion ?? 'teleport'
    const travelTime = Math.max(0.05, config.travelTime ?? Math.min(delay * 0.6, delay))
    const piston: PistonMechanism = {
        from: { ...config.from },
        to: { ...config.to },
        block: config.block,
        motion,
        occupied: config.initial ?? 'from',
        delay,
        travelTime,
        // Absolute schedule — the piston-system tracks sim-time from 0
        // and only flips when sim-time >= nextFlipAt. Starting all pistons
        // at exactly `delay` means every piston registered before the
        // first system tick flips together on the same global grid line.
        nextFlipAt: delay,
        eid: -1,
        moving: 0,
        moveT: 0,
        moveFrom: config.initial ?? 'from',
        characterPolicy: config.characterPolicy ?? 'block',
        moveSoundId: config.moveSoundId || undefined,
        moveSoundVolume: config.moveSoundVolume,
    }
    const initialCell = piston.occupied === 'from' ? piston.from : piston.to
    if (motion === 'physical') {
        // Physical pistons own their block as an entity. Clear the source
        // voxel so editor-authored terrain does not overlap the moving block.
        chunks.setVoxel(initialCell.x, initialCell.y, initialCell.z, 0)
        piston.eid = spawnPhysicalPistonBlock(world, chunks, piston.block, initialCell)
    } else {
        chunks.setVoxel(initialCell.x, initialCell.y, initialCell.z, piston.block)
    }
    world.pistons.push(piston)
    return piston
}

function spawnPhysicalPistonBlock(
    world: GameWorld,
    chunks: ChunkManager,
    block: number,
    cell: VoxelCoord,
): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, BoxCollider])
    Position.x[eid] = cell.x + 0.5
    Position.y[eid] = cell.y
    Position.z[eid] = cell.z + 0.5
    BoxCollider.x[eid] = 0.5
    BoxCollider.y[eid] = 0.5
    BoxCollider.z[eid] = 0.5
    world.object3DByEid.set(eid, createPistonBlockVisual(chunks, block))
    addComponent(world, eid, Renderable)
    return eid
}

function createPistonBlockVisual(chunks: ChunkManager, block: number): Group {
    const root = new Group()
    root.name = 'PhysicalPistonBlock'
    const mesh = new Mesh(sharedBoxGeometry(1, 1, 1))
    mesh.position.y = 0.5
    applyPistonBlockMaterial(mesh, chunks, block)
    root.add(mesh)
    return root
}

export function refreshPhysicalPistonVisuals(world: GameWorld, chunks: ChunkManager, block?: number): void {
    for (const piston of world.pistons) {
        if (piston.motion !== 'physical' || piston.eid < 0) continue
        if (block !== undefined && piston.block !== block) continue
        const obj = world.object3DByEid.get(piston.eid)
        if (!obj) continue
        obj.traverse((child) => {
            if (child instanceof Mesh) applyPistonBlockMaterial(child, chunks, piston.block)
        })
    }
}

function applyPistonBlockMaterial(mesh: Mesh, chunks: ChunkManager, block: number): void {
    const entry = paletteEntry(chunks.palette, block)
    const [r, g, b] = entry.color
    const color = ((Math.round(r * 255) & 0xff) << 16) |
        ((Math.round(g * 255) & 0xff) << 8) |
        (Math.round(b * 255) & 0xff)
    const opacity = voxelOpacity(chunks.palette, block)
    // Pull the palette's opacity through to the mesh material so a cloud-
    // block piston looks like a cloud (semi-transparent), not a solid
    // pastel cube. `sharedMaterial` keys by opacity, so opaque pistons
    // still share their material with everything else of the same colour.
    mesh.material = sharedMaterial(color, 0.85, 0, opacity)
    mesh.name = `${entry.name}Block`
    // Shadow casting on a fully-transparent block looks wrong; skip it for
    // anything below ~0.7 alpha so cloud / water-block pistons don't paint
    // hard-edged shadow squares on the terrain.
    const castShadow = opacity >= 0.7
    mesh.castShadow = castShadow
    mesh.receiveShadow = castShadow
}
