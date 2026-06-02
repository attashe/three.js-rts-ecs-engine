import { hasComponent, query } from 'bitecs'
import { Vector3 } from 'three'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { voxelRaycast } from '../../voxel/voxel-raycast'
import { isCollidable } from '../../voxel/palette'
import {
    BoxCollider,
    MovingObject,
    PlayerControlled,
    Position,
    Rotation,
    Shield,
    Velocity,
} from '../components'
import { MovingObjectKind } from '../../../game/moving-objects'
import { embedArrow } from './moving-object-system'
import { despawnEntity } from '../entity'
import { applyDamage, HALF_HEART } from '../combat'
import { damageNpc, type NpcRuntimeState } from '../../../game/npcs/npc-types'
import type { GameWorld } from '../world'
import type { System } from './system'
import { FixedOrder } from './orders'

/** Damage a single enemy arrow deals to the player on a clean (unblocked) hit. */
const ARROW_PLAYER_DAMAGE = HALF_HEART

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
    /** Fires once when an enemy arrow lands a clean (unblocked) hit on the
     *  player, at the impact point — e.g. for an impact SFX. */
    onArrowHitPlayer?: (eid: number, position: { x: number; y: number; z: number }) => void
    /** Fires once when a raised shield deflects an arrow, at the impact point —
     *  the player's shield stopping an enemy arrow, or a guarding NPC's shield
     *  stopping a player arrow. E.g. for a block clang. */
    onArrowBlocked?: (eid: number, position: { x: number; y: number; z: number }) => void
    /** Damage a magic bolt deals to an NPC it strikes. Default 1. */
    boltDamage?: number
    /** Fires when a magic bolt hits a wall or NPC (just before it despawns),
     *  with the bolt eid and the world-space impact point. */
    onBoltHit?: (eid: number, position: { x: number; y: number; z: number }) => void
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

                // Enemy-fired arrows target the player only (no friendly fire on
                // other NPCs); the player's raised frontal shield can block them.
                if (!isBolt && MovingObject.hostile[arrow] === 1) {
                    const playerHit = nearestPlayerHit(gw, sx, sy, sz, dirX, dirY, dirZ, segLen)
                    if (playerHit) {
                        landed.add(arrow)
                        const hitY = sy + dirY * playerHit.t
                        const hitPos = { x: sx + dirX * playerHit.t, y: hitY, z: sz + dirZ * playerHit.t }
                        if (arrowBlockedByShield(gw, playerHit.eid, dirX, dirZ, hitY)) {
                            opts.onArrowBlocked?.(arrow, hitPos)
                        } else {
                            applyDamage(gw, playerHit.eid, ARROW_PLAYER_DAMAGE)
                            opts.onArrowHitPlayer?.(arrow, hitPos)
                        }
                        despawnEntity(gw, arrow)
                        continue
                    }
                } else {
                    // Player arrows / bolts bury themselves in the first NPC body
                    // rather than passing through to the wall behind it.
                    const npcHit = nearestNpcHit(gw, sx, sy, sz, dirX, dirY, dirZ, segLen)
                    if (npcHit) {
                        landed.add(arrow)
                        const hx = sx + dirX * npcHit.t
                        const hy = sy + dirY * npcHit.t
                        const hz = sz + dirZ * npcHit.t
                        // A shield-bearing NPC advancing with its guard up turns
                        // away arrows in its front arc, just as it parries melee
                        // (and as the player's shield stops enemy arrows). Magic
                        // bolts punch through.
                        if (!isBolt && npcShieldDeflectsArrow(npcHit.npc, dirX, dirZ, hy)) {
                            opts.onArrowBlocked?.(arrow, { x: hx, y: hy, z: hz })
                            despawnEntity(gw, arrow)
                            continue
                        }
                        if (isBolt) {
                            damageNpc(npcHit.npc, boltDamage, { byPlayer: true })
                            opts.onBoltHit?.(arrow, { x: hx, y: hy, z: hz })
                            despawnEntity(gw, arrow)
                        } else {
                            stickArrowInNpc(gw, arrow, npcHit.npc, hx, hy, hz)
                            damageNpc(npcHit.npc, npcDamage, { byPlayer: true })
                            opts.onArrowHitNpc?.(arrow, npcHit.npc)
                        }
                        continue
                    }
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
                        opts.onBoltHit?.(arrow, { x: sx, y: sy, z: sz })
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

interface PlayerSegmentHit {
    eid: number
    t: number
}

/** Nearest player whose (foot-anchored) AABB the arrow's tick-segment enters. */
function nearestPlayerHit(
    gw: GameWorld,
    sx: number, sy: number, sz: number,
    dx: number, dy: number, dz: number,
    segLen: number,
): PlayerSegmentHit | null {
    let best: PlayerSegmentHit | null = null
    for (const eid of query(gw, [PlayerControlled, Position, BoxCollider])) {
        const hx = BoxCollider.x[eid]!
        const hy = BoxCollider.y[eid]!
        const hz = BoxCollider.z[eid]!
        const t = segmentAabbEntry(
            sx, sy, sz, dx, dy, dz, segLen,
            Position.x[eid]! - hx, Position.y[eid]!, Position.z[eid]! - hz,
            Position.x[eid]! + hx, Position.y[eid]! + hy * 2, Position.z[eid]! + hz,
        )
        if (t !== null && (best === null || t < best.t)) best = { eid, t }
    }
    return best
}

/** Whether the player's raised shield deflects an arrow coming in along
 *  `(dirX, dirZ)` at world height `hitY` — mirrors the melee shield check:
 *  the source must sit inside the front block arc and the configured Y band. */
function arrowBlockedByShield(gw: GameWorld, playerEid: number, dirX: number, dirZ: number, hitY: number): boolean {
    if (!hasComponent(gw, playerEid, Shield) || Shield.raised[playerEid] !== 1) return false
    // The arrow approaches *from* -dir; that's the direction the shield must face.
    const len = Math.hypot(dirX, dirZ)
    if (len < 1e-4) return false
    const sourceX = -dirX / len
    const sourceZ = -dirZ / len
    const blockYaw = Rotation.y[playerEid]! + Shield.blockYawOffset[playerEid]!
    const fx = Math.sin(blockYaw)
    const fz = Math.cos(blockYaw)
    if (fx * sourceX + fz * sourceZ < Shield.blockArcCos[playerEid]!) return false
    const localY = hitY - Position.y[playerEid]!
    return localY >= Shield.minY[playerEid]! && localY <= Shield.maxY[playerEid]!
}

/** Whether a guarding NPC's raised shield turns away an arrow coming in along
 *  `(dirX, dirZ)` at world height `hitY` — the NPC mirror of
 *  `arrowBlockedByShield`, reusing the same front-arc + Y-band check as the
 *  melee guard (`npcShieldGuardBlockResult`). */
function npcShieldDeflectsArrow(npc: NpcRuntimeState, dirX: number, dirZ: number, hitY: number): boolean {
    const guard = npc.shieldGuard
    if (!guard?.raised) return false
    const len = Math.hypot(dirX, dirZ)
    if (len < 1e-4) return false
    // The arrow approaches *from* -dir; that's the direction the shield must face.
    const sourceX = -dirX / len
    const sourceZ = -dirZ / len
    const fx = Math.sin(npc.yaw)
    const fz = Math.cos(npc.yaw)
    if (fx * sourceX + fz * sourceZ < guard.arcCos) return false
    const localY = hitY - npc.position.y
    return localY >= guard.minY && localY <= guard.maxY
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
