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
import type { ChunkManager } from '../../voxel/chunk-manager'
import { pushLog, pushZoneEvent, type GameWorld, type VoxelCoord } from '../world'
import {
    isTriggerZone,
    zoneAcceptsTrigger,
    type Zone,
    type ZoneScriptAction,
    type ZoneScriptBlockSpace,
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
export function createZoneTriggerSystem(chunks: ChunkManager, opts: ZoneTriggerSystemOptions = {}): System {
    const activePlayers = new Set<string>()
    const firedArrows = new Set<string>()
    const prevArrowCenter = new Map<number, Point>()
    const log = opts.log ?? true

    return {
        fixed: true,
        order: FixedOrder.postPhysics - 20,
        update(world, dt) {
            const zones = [...world.zones.values()].filter(isTriggerZone)
            if (zones.length === 0) {
                activePlayers.clear()
                firedArrows.clear()
                prevArrowCenter.clear()
                return
            }

            updatePlayerTriggers(world, chunks, zones, activePlayers, opts.onTrigger, log)
            updateArrowTriggers(world, chunks, zones, prevArrowCenter, firedArrows, opts.onTrigger, log, dt)
        },
    }
}

function updatePlayerTriggers(
    world: GameWorld,
    chunks: ChunkManager,
    zones: Zone[],
    activePlayers: Set<string>,
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
            emitZoneTrigger(world, chunks, zone, 'player', eid, entityCenter(world, eid), onTrigger, log)
        }
    }

    for (const key of activePlayers) {
        if (!currentHits.has(key)) activePlayers.delete(key)
    }
}

function updateArrowTriggers(
    world: GameWorld,
    chunks: ChunkManager,
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
            emitZoneTrigger(world, chunks, zone, 'arrow', eid, curr, onTrigger, log)
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
    chunks: ChunkManager,
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
    executeZoneScript(world, chunks, zone)
    onTrigger?.(event, zone, world)
}

function executeZoneScript(world: GameWorld, chunks: ChunkManager, zone: Zone): void {
    const actions = zone.script?.actions
    if (!actions || actions.length === 0) return
    for (let i = 0; i < actions.length; i++) {
        executeZoneScriptAction(world, chunks, zone, actions[i]!)
    }
}

function executeZoneScriptAction(
    world: GameWorld,
    chunks: ChunkManager,
    zone: Zone,
    action: ZoneScriptAction,
): void {
    if (action.type === 'message') {
        const message = action.message.trim()
        if (message) pushLog(world, message)
        return
    }
    if (action.type === 'kill-player') {
        const message = action.message?.trim()
        if (message) pushLog(world, message)
        world.deathSignal ??= 'killed-by-zone-script'
        return
    }
    if (action.type === 'set-block') {
        const p = resolveScriptCoord(zone, action.position, action.relativeTo)
        chunks.setVoxel(p.x, p.y, p.z, safeBlock(action.block))
        return
    }
    if (action.type === 'fill-blocks') {
        const min = resolveScriptCoord(zone, action.min, action.relativeTo)
        const max = resolveScriptCoord(zone, action.max, action.relativeTo)
        const block = safeBlock(action.block)
        for (let z = Math.min(min.z, max.z); z < Math.max(min.z, max.z); z++) {
            for (let y = Math.min(min.y, max.y); y < Math.max(min.y, max.y); y++) {
                for (let x = Math.min(min.x, max.x); x < Math.max(min.x, max.x); x++) {
                    chunks.setVoxel(x, y, z, block)
                }
            }
        }
    }
}

function resolveScriptCoord(
    zone: Zone,
    coord: VoxelCoord,
    relativeTo: ZoneScriptBlockSpace | undefined,
): VoxelCoord {
    const base = relativeTo === 'zone-min'
        ? zone.min
        : relativeTo === 'zone-max'
            ? zone.max
            : { x: 0, y: 0, z: 0 }
    return {
        x: Math.floor(base.x + coord.x),
        y: Math.floor(base.y + coord.y),
        z: Math.floor(base.z + coord.z),
    }
}

function safeBlock(block: number): number {
    return Math.max(0, Math.min(65535, Math.floor(block)))
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
