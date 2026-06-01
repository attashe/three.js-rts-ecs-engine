import { hasComponent, query } from 'bitecs'
import { Vector3 } from 'three'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { voxelRaycast } from '../../voxel/voxel-raycast'
import { isCollidable } from '../../voxel/palette'
import {
    MovingObject,
    Position,
    Velocity,
} from '../components'
import { MovingObjectKind } from '../../../game/moving-objects'
import { embedArrow } from './moving-object-system'
import { despawnEntity } from '../entity'
import { damageNpc, type NpcRuntimeState } from '../../../game/npcs/npc-types'
import type { GameWorld } from '../world'
import type { System } from './system'
import { FixedOrder } from './orders'

/**
 * Per-step probe for arrows hitting something. Two targets:
 *
 *  - **Voxels.** Most of an arrow's deceleration happens via
 *    `physics-system.sweepAxis` (its BoxCollider gets blocked by a wall) — at
 *    which point `moving-object-system` flips it to a static embedded visual.
 *    This system runs the same segment-vs-voxel ray each tick and fires
 *    `onArrowLand` when the arrow lands against a wall (e.g. for SFX, or future
 *    remote-activation of chests/switches/levers).
 *  - **NPCs.** Arrows aren't in the NPC obstacle registry (NPCs are a runtime
 *    side-table, not ECS entities), so we sweep the arrow segment against each
 *    live NPC's AABB here. A hit applies arrow damage and freezes the arrow
 *    embedded in the body so it rides along (see `stuckArrows`).
 */
export interface ArrowHitOptions {
    /** Fires once when an arrow lands against a voxel cell. Receives the
     *  arrow eid and the voxel coord it terminated against. */
    onArrowLand?: (eid: number, voxel: { x: number; y: number; z: number }) => void
    /** Damage a single arrow deals to an NPC it strikes. Default 1. */
    npcDamage?: number
    /** Fires once when an arrow strikes an NPC (e.g. for an impact SFX). */
    onArrowHitNpc?: (eid: number, npc: NpcRuntimeState) => void
    /** Damage a magic bolt deals to an NPC it strikes. Default 1. */
    boltDamage?: number
    /** Fires when a magic bolt hits a wall or NPC (just before it despawns). */
    onBoltHit?: (eid: number) => void
}

export function createArrowHitSystem(
    chunks: ChunkManager,
    opts: ArrowHitOptions = {},
): System {
    const tmpOrigin = new Vector3()
    const tmpDir = new Vector3()
    const npcDamage = opts.npcDamage ?? 1
    const boltDamage = opts.boltDamage ?? 1
    /** Track arrows we've already announced as landed so the callback fires once. */
    const landed = new Set<number>()

    return {
        fixed: true,
        order: FixedOrder.movement + 50,
        update(world, dt) {
            const arrows = query(world, [MovingObject, Position, Velocity])
            if (arrows.length === 0) return
            const gw = world as GameWorld

            for (let i = 0; i < arrows.length; i++) {
                const arrow = arrows[i]!
                const kind = MovingObject.kind[arrow]
                if (kind !== MovingObjectKind.Arrow && kind !== MovingObjectKind.MagicBolt) continue
                if (landed.has(arrow)) continue
                const isBolt = kind === MovingObjectKind.MagicBolt

                const sx = Position.x[arrow]
                const sy = Position.y[arrow]
                const sz = Position.z[arrow]
                const vx = Velocity.x[arrow]
                const vy = Velocity.y[arrow]
                const vz = Velocity.z[arrow]
                const speedSq = vx * vx + vy * vy + vz * vz
                if (speedSq < 4) continue

                const speed = Math.sqrt(speedSq)
                const segLen = speed * dt
                if (segLen <= 0) continue
                const dirX = vx / speed
                const dirY = vy / speed
                const dirZ = vz / speed

                // NPCs first: an arrow should bury itself in a body rather than
                // pass through to the wall behind it. Sweep the tick's segment
                // against each live NPC's AABB and take the nearest entry.
                const npcHit = nearestNpcHit(gw, sx, sy, sz, dirX, dirY, dirZ, segLen)
                if (npcHit) {
                    landed.add(arrow)
                    if (isBolt) {
                        damageNpc(npcHit.npc, boltDamage)
                        opts.onBoltHit?.(arrow)
                        despawnEntity(gw, arrow)
                    } else {
                        stickArrowInNpc(gw, arrow, npcHit.npc, sx + dirX * npcHit.t, sy + dirY * npcHit.t, sz + dirZ * npcHit.t)
                        damageNpc(npcHit.npc, npcDamage)
                        opts.onArrowHitNpc?.(arrow, npcHit.npc)
                    }
                    continue
                }

                tmpOrigin.set(sx, sy, sz)
                tmpDir.set(dirX, dirY, dirZ)
                // Arrows pass through non-collidable cells (water, cloud)
                // even though those cells are otherwise raycast targets for
                // the editor cursor. Use the collidable predicate so the
                // arrow only stops on actual walls.
                const wallHit = voxelRaycast(chunks, tmpOrigin, tmpDir, segLen, isCollidable)
                if (wallHit !== null) {
                    landed.add(arrow)
                    if (isBolt) {
                        opts.onBoltHit?.(arrow)
                        despawnEntity(gw, arrow)
                    } else {
                        opts.onArrowLand?.(arrow, { x: wallHit.voxel.x, y: wallHit.voxel.y, z: wallHit.voxel.z })
                    }
                }
            }

            // Forget arrows that physics has already cleaned up so the set
            // doesn't grow unbounded.
            for (const eid of landed) {
                if (!hasComponent(world, eid, MovingObject)) landed.delete(eid)
            }
        },
    }
}

interface NpcSegmentHit {
    npc: NpcRuntimeState
    /** Distance along the segment to the entry point. */
    t: number
}

/** Nearest NPC whose AABB the arrow's tick-segment enters. */
function nearestNpcHit(
    gw: GameWorld,
    sx: number, sy: number, sz: number,
    dx: number, dy: number, dz: number,
    segLen: number,
): NpcSegmentHit | null {
    let best: NpcSegmentHit | null = null
    for (const npc of gw.npcRuntimeById.values()) {
        if (npc.dying) continue
        const r = npc.colliderRadius
        const t = segmentAabbEntry(
            sx, sy, sz, dx, dy, dz, segLen,
            npc.position.x - r, npc.position.y, npc.position.z - r,
            npc.position.x + r, npc.position.y + npc.colliderHeight, npc.position.z + r,
        )
        if (t !== null && (best === null || t < best.t)) best = { npc, t }
    }
    return best
}

/**
 * Slab test: distance along a unit-direction segment of length `segLen` at
 * which it first enters the AABB, or null if it misses within the segment.
 * Returns 0 when the origin already sits inside the box.
 */
function segmentAabbEntry(
    sx: number, sy: number, sz: number,
    dx: number, dy: number, dz: number,
    segLen: number,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
): number | null {
    let tMin = 0
    let tMax = segLen
    const eps = 1e-9
    // X
    if (Math.abs(dx) < eps) {
        if (sx < minX || sx > maxX) return null
    } else {
        let t1 = (minX - sx) / dx
        let t2 = (maxX - sx) / dx
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
        tMin = Math.max(tMin, t1)
        tMax = Math.min(tMax, t2)
        if (tMin > tMax) return null
    }
    // Y
    if (Math.abs(dy) < eps) {
        if (sy < minY || sy > maxY) return null
    } else {
        let t1 = (minY - sy) / dy
        let t2 = (maxY - sy) / dy
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
        tMin = Math.max(tMin, t1)
        tMax = Math.min(tMax, t2)
        if (tMin > tMax) return null
    }
    // Z
    if (Math.abs(dz) < eps) {
        if (sz < minZ || sz > maxZ) return null
    } else {
        let t1 = (minZ - sz) / dz
        let t2 = (maxZ - sz) / dz
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
        tMin = Math.max(tMin, t1)
        tMax = Math.min(tMax, t2)
        if (tMin > tMax) return null
    }
    return tMin
}

/** Freeze the arrow as a static visual and record its offset from the NPC so
 *  the stuck-arrow system can keep it riding the body. */
function stickArrowInNpc(
    gw: GameWorld,
    arrow: number,
    npc: NpcRuntimeState,
    hitX: number, hitY: number, hitZ: number,
): void {
    // Pin the arrow at the entry point before freezing so it doesn't keep its
    // pre-impact lead.
    Position.x[arrow] = hitX
    Position.y[arrow] = hitY
    Position.z[arrow] = hitZ
    embedArrow(gw, arrow)
    const list = npc.stuckArrows ?? (npc.stuckArrows = [])
    list.push({
        eid: arrow,
        ox: hitX - npc.position.x,
        oy: hitY - npc.position.y,
        oz: hitZ - npc.position.z,
    })
}
