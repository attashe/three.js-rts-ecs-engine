import { addComponent, addComponents, hasComponent, removeComponent } from 'bitecs'
import { Group, Mesh, MeshStandardMaterial } from 'three'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { paletteEntry, voxelOpacity } from '../engine/voxel/palette'
import { BoxCollider, Position, Renderable, Rotation } from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import type { GameWorld, PistonMechanism, VoxelCoord } from '../engine/ecs/world'
import { sharedBoxGeometry, sharedMaterial } from './assets'
import { getPropModel } from './props/prop-models'
import type { EditorPropKind } from './props/prop-types'

export interface PistonMechanismConfig {
    /** Stable author id (`'piston.elevator'`, `'piston-3'`, ...). Optional —
     *  pistons without an id are simulated normally but cannot be addressed
     *  from the `pistons.*` script bindings. `enabled` is a runtime/session
     *  flag, not an authored field, so it has no entry here. */
    id?: string
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
    /** Optional prop model rendered instead of the default cube for physical pistons. */
    visualKind?: EditorPropKind
    /** Uniform scale for `visualKind`. Default 1. */
    visualScale?: number
    /** Local yaw offset for `visualKind`, in radians. */
    visualYaw?: number
    /** Local offset applied to `visualKind` from the moving block origin. */
    visualOffset?: VoxelCoord
    /** False keeps a physical piston hidden/non-colliding until scripts deploy it. */
    deployed?: boolean
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
        id: config.id,
        enabled: true,
        pendingFlip: false,
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
        visualKind: config.visualKind,
        visualScale: config.visualScale,
        visualYaw: config.visualYaw,
        visualOffset: config.visualOffset ? { ...config.visualOffset } : undefined,
        deployed: config.deployed !== false,
    }
    const initialCell = piston.occupied === 'from' ? piston.from : piston.to
    if (motion === 'physical') {
        // Physical pistons own their block as an entity. Clear the source
        // voxel so editor-authored terrain does not overlap the moving block.
        chunks.setVoxel(initialCell.x, initialCell.y, initialCell.z, 0)
        piston.eid = spawnPhysicalPistonBlock(world, chunks, piston, initialCell)
    } else {
        chunks.setVoxel(initialCell.x, initialCell.y, initialCell.z, piston.block)
    }
    world.pistons.push(piston)
    if (piston.id) world.pistonsById.set(piston.id, piston)
    return piston
}

function spawnPhysicalPistonBlock(
    world: GameWorld,
    chunks: ChunkManager,
    piston: PistonMechanism,
    cell: VoxelCoord,
): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation])
    Position.x[eid] = cell.x + 0.5
    Position.y[eid] = cell.y
    Position.z[eid] = cell.z + 0.5
    Rotation.y[eid] = piston.visualYaw ?? 0
    world.object3DByEid.set(eid, createPistonBlockVisual(chunks, piston))
    if (piston.deployed) {
        addComponent(world, eid, BoxCollider)
        BoxCollider.x[eid] = 0.5
        BoxCollider.y[eid] = 0.5
        BoxCollider.z[eid] = 0.5
        addComponent(world, eid, Renderable)
    }
    return eid
}

function createPistonBlockVisual(chunks: ChunkManager, piston: PistonMechanism): Group {
    const root = new Group()
    if (piston.visualKind) {
        root.name = `PhysicalPistonProp:${piston.visualKind}`
        const mesh = new Mesh(getPropModel(piston.visualKind).geometry, getSharedPhysicalPropMaterial())
        const offset = piston.visualOffset
        mesh.position.set(offset?.x ?? 0, offset?.y ?? 0, offset?.z ?? 0)
        mesh.scale.setScalar(Math.max(0.0001, piston.visualScale ?? 1))
        mesh.castShadow = true
        mesh.receiveShadow = true
        root.add(mesh)
        return root
    }
    root.name = 'PhysicalPistonBlock'
    const mesh = new Mesh(sharedBoxGeometry(1, 1, 1))
    mesh.position.y = 0.5
    applyPistonBlockMaterial(mesh, chunks, piston.block)
    root.add(mesh)
    return root
}

let sharedPhysicalPropMaterial: MeshStandardMaterial | null = null
function getSharedPhysicalPropMaterial(): MeshStandardMaterial {
    if (!sharedPhysicalPropMaterial) {
        sharedPhysicalPropMaterial = new MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.85,
            metalness: 0,
            flatShading: true,
        })
    }
    return sharedPhysicalPropMaterial
}

export function refreshPhysicalPistonVisuals(world: GameWorld, chunks: ChunkManager, block?: number): void {
    for (const piston of world.pistons) {
        if (piston.motion !== 'physical' || piston.eid < 0) continue
        if (piston.visualKind) continue
        if (block !== undefined && piston.block !== block) continue
        const obj = world.object3DByEid.get(piston.eid)
        if (!obj) continue
        obj.traverse((child) => {
            if (child instanceof Mesh) applyPistonBlockMaterial(child, chunks, piston.block)
        })
    }
}

export function setPhysicalPistonDeployed(
    world: GameWorld,
    piston: PistonMechanism,
    deployed: boolean,
): boolean {
    if (piston.motion !== 'physical' || piston.eid < 0) return false
    if (piston.moving === 1) return false
    piston.deployed = !!deployed
    if (piston.deployed) {
        if (!hasComponent(world, piston.eid, BoxCollider)) addComponent(world, piston.eid, BoxCollider)
        BoxCollider.x[piston.eid] = 0.5
        BoxCollider.y[piston.eid] = 0.5
        BoxCollider.z[piston.eid] = 0.5
        if (!hasComponent(world, piston.eid, Renderable)) addComponent(world, piston.eid, Renderable)
    } else {
        piston.pendingFlip = false
        world.obstacles.remove(piston.eid)
        if (hasComponent(world, piston.eid, Renderable)) removeComponent(world, piston.eid, Renderable)
        if (hasComponent(world, piston.eid, BoxCollider)) removeComponent(world, piston.eid, BoxCollider)
    }
    return true
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
