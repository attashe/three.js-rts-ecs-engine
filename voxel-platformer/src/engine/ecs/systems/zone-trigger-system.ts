import { hasComponent, query } from 'bitecs'
import {
    BoxCollider,
    MovingObject,
    PlayerControlled,
    Position,
    RigidBody,
    Velocity,
} from '../components'
import { MovingObjectKind } from '../../../game/moving-objects'
import {
    pushLog,
    pushScriptTriggerEvent,
    pushZoneEvent,
    type GameWorld,
    type VoxelCoord,
} from '../world'
import {
    isTriggerZone,
    isZoneActive,
    zoneAcceptsTrigger,
    type Zone,
    type ZoneTriggerEvent,
    type ZoneTriggerSource,
} from '../zones'
import type { System } from './system'
import { FixedOrder } from './orders'

export interface ZoneTriggerSystemOptions {
    /** Called after the event has been appended to `world.zoneEvents`. */
    onTrigger?: (event: ZoneTriggerEvent, zone: Zone, world: GameWorld) => void
    /** Push a visible debug log entry when a zone activates. Default true. */
    log?: boolean
}

interface Point {
    x: number
    y: number
    z: number
}

/**
 * Activates trigger zones when an allowed source overlaps them.
 *
 * Player triggers are edge-triggered: one event on enter, then another only
 * after the player leaves and re-enters. Arrow triggers are one-shot per
 * arrow+zone pair and use a swept segment between ticks, so fast arrows can
 * still activate thin trigger volumes.
 */
export function createZoneTriggerSystem(opts?: ZoneTriggerSystemOptions): System
export function createZoneTriggerSystem(_legacyChunks: unknown, opts?: ZoneTriggerSystemOptions): System
export function createZoneTriggerSystem(
    optsOrLegacyChunks: ZoneTriggerSystemOptions | unknown = {},
    maybeOpts?: ZoneTriggerSystemOptions,
): System {
    const opts = maybeOpts ?? (isZoneTriggerOptions(optsOrLegacyChunks) ? optsOrLegacyChunks : {})
    const activePlayers = new Set<string>()
    // Side-table of the metadata an exit event needs (zoneId, source,
    // entityId, last-seen point). Populated on enter, drained on exit.
    // Keeps the exit path from re-querying entity / zone state after
    // the player has already left.
    const activePlayerMeta = new Map<string, ActiveTriggerMeta>()
    const firedArrows = new Set<string>()
    const prevArrowCenter = new Map<number, Point>()
    const log = opts.log ?? true

    return {
        fixed: true,
        order: FixedOrder.postPhysics - 20,
        update(world, dt) {
            // Inactive zones (toggled off by `zone.setActive`) skip
            // detection entirely. Players who were already inside an
            // about-to-deactivate zone naturally drop out of
            // `currentHits` next tick, which fires zone-exit through
            // the existing exit-on-miss path.
            const zones = [...world.zones.values()].filter((z) => isTriggerZone(z) && isZoneActive(z))
            if (zones.length === 0) {
                // Synthesise exits for anyone we were tracking so
                // scripts that subscribed to `zone-exit` see one event
                // when the level swaps out all its zones. Cheap insurance.
                for (const meta of activePlayerMeta.values()) emitExit(world, meta)
                activePlayers.clear()
                activePlayerMeta.clear()
                firedArrows.clear()
                prevArrowCenter.clear()
                return
            }

            updatePlayerTriggers(world, zones, activePlayers, activePlayerMeta, opts.onTrigger, log)
            updateArrowTriggers(world, zones, prevArrowCenter, firedArrows, opts.onTrigger, log, dt)
        },
    }
}

function isZoneTriggerOptions(value: unknown): value is ZoneTriggerSystemOptions {
    return typeof value === 'object' &&
        value !== null &&
        ('onTrigger' in value || 'log' in value)
}

interface ActiveTriggerMeta {
    zoneId: string
    source: ZoneTriggerSource
    eid: number
    point: VoxelCoord
}

function emitExit(world: GameWorld, meta: ActiveTriggerMeta): void {
    pushScriptTriggerEvent(world, {
        kind: 'zone-exit',
        zoneId: meta.zoneId,
        source: meta.source,
        point: { ...meta.point },
        entityId: meta.eid,
    })
}

function updatePlayerTriggers(
    world: GameWorld,
    zones: Zone[],
    activePlayers: Set<string>,
    activePlayerMeta: Map<string, ActiveTriggerMeta>,
    onTrigger: ZoneTriggerSystemOptions['onTrigger'],
    log: boolean,
): void {
    const players = query(world, [PlayerControlled, Position, BoxCollider])
    const currentHits = new Set<string>()

    for (let i = 0; i < players.length; i++) {
        const eid = players[i]!
        for (let z = 0; z < zones.length; z++) {
            const zone = zones[z]!
            if (!zoneAcceptsTrigger(zone, 'player')) continue
            const key = triggerKey(zone.id, 'player', eid)
            if (!entityOverlapsZone(world, eid, zone)) continue
            currentHits.add(key)
            if (activePlayers.has(key)) continue
            activePlayers.add(key)
            const point = entityCenter(world, eid)
            activePlayerMeta.set(key, { zoneId: zone.id, source: 'player', eid, point: { ...point } })
            emitZoneTrigger(world, zone, 'player', eid, point, onTrigger, log)
            // Mirror the trigger emission into the script-engine queue
            // so `on('zone-enter', ...)` handlers see it the next tick.
            pushScriptTriggerEvent(world, {
                kind: 'zone-enter',
                zoneId: zone.id,
                source: 'player',
                point: { ...point },
                entityId: eid,
            })
        }
    }

    for (const key of activePlayers) {
        if (currentHits.has(key)) continue
        const meta = activePlayerMeta.get(key)
        if (meta) {
            emitExit(world, meta)
            activePlayerMeta.delete(key)
        }
        activePlayers.delete(key)
    }
}

function updateArrowTriggers(
    world: GameWorld,
    zones: Zone[],
    prevArrowCenter: Map<number, Point>,
    firedArrows: Set<string>,
    onTrigger: ZoneTriggerSystemOptions['onTrigger'],
    log: boolean,
    dt: number,
): void {
    const arrows = query(world, [MovingObject, Position, BoxCollider, Velocity])
    const liveArrows = new Set<number>()

    for (let i = 0; i < arrows.length; i++) {
        const eid = arrows[i]!
        if (MovingObject.kind[eid] !== MovingObjectKind.Arrow) continue
        liveArrows.add(eid)

        const curr = entityCenter(world, eid)
        const prev = prevArrowCenter.get(eid) ?? {
            x: curr.x - Velocity.x[eid] * dt,
            y: curr.y - Velocity.y[eid] * dt,
            z: curr.z - Velocity.z[eid] * dt,
        }

        for (let z = 0; z < zones.length; z++) {
            const zone = zones[z]!
            if (!zoneAcceptsTrigger(zone, 'arrow')) continue
            const key = triggerKey(zone.id, 'arrow', eid)
            if (firedArrows.has(key)) continue
            if (!arrowIntersectsZone(world, eid, prev, curr, zone)) continue
            firedArrows.add(key)
            emitZoneTrigger(world, zone, 'arrow', eid, curr, onTrigger, log)
            // Arrows pass through — emit only enter, never exit, so
            // scripts can react to "an arrow hit this zone" without
            // racing against an exit fired the same frame.
            pushScriptTriggerEvent(world, {
                kind: 'zone-enter',
                zoneId: zone.id,
                source: 'arrow',
                point: { ...curr },
                entityId: eid,
            })
        }

        prevArrowCenter.set(eid, curr)
    }

    for (const eid of prevArrowCenter.keys()) {
        if (liveArrows.has(eid)) continue
        prevArrowCenter.delete(eid)
        for (const key of firedArrows) {
            if (key.endsWith(`:${eid}`)) firedArrows.delete(key)
        }
    }
}

function emitZoneTrigger(
    world: GameWorld,
    zone: Zone,
    source: ZoneTriggerSource,
    eid: number,
    point: VoxelCoord,
    onTrigger: ZoneTriggerSystemOptions['onTrigger'],
    log: boolean,
): void {
    const event: ZoneTriggerEvent = {
        zoneId: zone.id,
        zoneKind: zone.kind,
        source,
        eid,
        point: { ...point },
    }
    pushZoneEvent(world, event)
    if (log) pushLog(world, `Zone "${zone.label ?? zone.id}" triggered by ${source}.`)
    onTrigger?.(event, zone, world)
}

function entityOverlapsZone(world: GameWorld, eid: number, zone: Zone): boolean {
    const aabb = entityAABB(world, eid)
    return aabb.min.x < zone.max.x && aabb.max.x > zone.min.x &&
        aabb.min.y < zone.max.y && aabb.max.y > zone.min.y &&
        aabb.min.z < zone.max.z && aabb.max.z > zone.min.z
}

function arrowIntersectsZone(world: GameWorld, eid: number, prev: Point, curr: Point, zone: Zone): boolean {
    if (entityOverlapsZone(world, eid, zone)) return true
    const expand = {
        x: BoxCollider.x[eid],
        y: BoxCollider.y[eid],
        z: BoxCollider.z[eid],
    }
    return segmentIntersectsExpandedZone(prev, curr, zone, expand)
}

function entityCenter(world: GameWorld, eid: number): VoxelCoord {
    const centerAnchored = hasComponent(world, eid, RigidBody) && RigidBody.centerAnchored[eid] === 1
    return {
        x: Position.x[eid],
        y: centerAnchored ? Position.y[eid] : Position.y[eid] + BoxCollider.y[eid],
        z: Position.z[eid],
    }
}

function entityAABB(world: GameWorld, eid: number): { min: Point; max: Point } {
    const hx = BoxCollider.x[eid]
    const hy = BoxCollider.y[eid]
    const hz = BoxCollider.z[eid]
    const centerAnchored = hasComponent(world, eid, RigidBody) && RigidBody.centerAnchored[eid] === 1
    const minY = centerAnchored ? Position.y[eid] - hy : Position.y[eid]
    const maxY = centerAnchored ? Position.y[eid] + hy : Position.y[eid] + hy * 2
    return {
        min: { x: Position.x[eid] - hx, y: minY, z: Position.z[eid] - hz },
        max: { x: Position.x[eid] + hx, y: maxY, z: Position.z[eid] + hz },
    }
}

function segmentIntersectsExpandedZone(start: Point, end: Point, zone: Zone, expand: Point): boolean {
    let tMin = 0
    let tMax = 1
    const sx = start.x
    const sy = start.y
    const sz = start.z
    const dx = end.x - start.x
    const dy = end.y - start.y
    const dz = end.z - start.z

    const x = clipSegmentAxis(sx, dx, zone.min.x - expand.x, zone.max.x + expand.x, tMin, tMax)
    if (!x) return false
    tMin = x.tMin; tMax = x.tMax
    const y = clipSegmentAxis(sy, dy, zone.min.y - expand.y, zone.max.y + expand.y, tMin, tMax)
    if (!y) return false
    tMin = y.tMin; tMax = y.tMax
    const z = clipSegmentAxis(sz, dz, zone.min.z - expand.z, zone.max.z + expand.z, tMin, tMax)
    if (!z) return false
    return true
}

function clipSegmentAxis(
    origin: number,
    delta: number,
    min: number,
    max: number,
    tMin: number,
    tMax: number,
): { tMin: number; tMax: number } | null {
    if (Math.abs(delta) < 0.000001) {
        return origin >= min && origin <= max ? { tMin, tMax } : null
    }
    const inv = 1 / delta
    let t1 = (min - origin) * inv
    let t2 = (max - origin) * inv
    if (t1 > t2) {
        const tmp = t1
        t1 = t2
        t2 = tmp
    }
    const nextMin = Math.max(tMin, t1)
    const nextMax = Math.min(tMax, t2)
    if (nextMin > nextMax) return null
    return { tMin: nextMin, tMax: nextMax }
}

function triggerKey(zoneId: string, source: ZoneTriggerSource, eid: number): string {
    return `${source}:${zoneId}:${eid}`
}
