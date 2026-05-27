import type { GameWorld, VoxelCoord } from './world'

export type ZoneTriggerSource = 'player' | 'arrow'
export type ZoneScriptBlockSpace = 'world' | 'zone-min' | 'zone-max'

export type ZoneScriptAction =
    | { readonly type: 'message'; readonly message: string }
    | { readonly type: 'kill-player'; readonly message?: string }
    | {
        readonly type: 'set-block'
        /** Target cell. Interpreted as world coords unless `relativeTo` is set. */
        readonly position: VoxelCoord
        /** Palette index to write. Use 0 to erase. */
        readonly block: number
        readonly relativeTo?: ZoneScriptBlockSpace
    }
    | {
        readonly type: 'fill-blocks'
        /** Inclusive min corner. Interpreted as world coords unless `relativeTo` is set. */
        readonly min: VoxelCoord
        /** Exclusive max corner. Interpreted as world coords unless `relativeTo` is set. */
        readonly max: VoxelCoord
        /** Palette index to write. Use 0 to erase. */
        readonly block: number
        readonly relativeTo?: ZoneScriptBlockSpace
    }

export interface ZoneScript {
    readonly actions: readonly ZoneScriptAction[]
}

/** Axis-aligned 3D region anchored in world cell space. Ported from the
 *  parent codebase's `AiZone` and trimmed to the bits the platformer cares
 *  about today — a named AABB you can sample / test points against. AI
 *  schedules, patrol routes, etc. can layer on top later. */
export interface Zone {
    /** Stable identifier — used as a Map key on the world. */
    readonly id: string
    /** Free-form category tag. Suggested values: `'generic'`, `'trigger'`,
     *  `'killzone'`, `'spawn'`. Gameplay systems decide what to do with
     *  each kind; the editor just stores the string. */
    readonly kind: string
    /** Optional human-readable label shown in editor UI / debug overlay. */
    readonly label?: string
    /** AABB min corner (world cell coords, inclusive). */
    readonly min: VoxelCoord
    /** AABB max corner (world cell coords, exclusive on max boundary for
     *  point-in-zone tests — see `isPointInZone`). */
    readonly max: VoxelCoord
    /** Which collision sources may activate this zone. Missing means
     *  player-only for `kind: "trigger"` zones, matching the usual trigger
     *  volume default. */
    readonly triggerSources?: readonly ZoneTriggerSource[]
    /** Optional data-driven actions executed when the trigger activates. */
    readonly script?: ZoneScript
    /** Optional interaction affordance. Zones with `kind: "interact"` are
     *  sampled by the gameplay interaction system instead of firing
     *  automatic enter/exit trigger events. */
    readonly interaction?: {
        /** Screen prompt text shown next to the interaction key. */
        readonly prompt?: string
        /** World-space anchor for prompt/dialogue projection. Defaults to
         *  the top-center of the zone. */
        readonly anchor?: VoxelCoord
        /** Max distance from the anchor/zone center for interaction. */
        readonly radius?: number
    }
    /** When `false`, the zone is treated as if not registered:
     *  zone-trigger-system + interaction-system skip it, so no
     *  zone-enter / zone-exit events fire and no interaction prompt
     *  appears. Missing or `true` ⇒ active. Toggle from a script via
     *  `zone.setActive(zoneId, on)`; under the hood that clones the
     *  zone with the new flag and re-registers it so the readonly
     *  identity is preserved. */
    readonly active?: boolean
}

export interface ZoneTriggerEvent {
    readonly zoneId: string
    readonly zoneKind: string
    readonly source: ZoneTriggerSource
    readonly eid: number
    readonly point: VoxelCoord
}

/** Register or replace a zone on the world by id. */
export function defineZone(world: GameWorld, zone: Zone): void {
    world.zones.set(zone.id, zone)
}

/** True if the zone is currently active (default when `active` is
 *  missing). The negation is used by zone-trigger / interaction systems
 *  to skip processing without losing the registration. */
export function isZoneActive(zone: Zone): boolean {
    return zone.active !== false
}

/** Toggle a zone's `active` flag. Returns true on a successful change,
 *  false if the zone wasn't registered. No-op when the flag already
 *  matches `active`. Clones the existing zone with the new flag so the
 *  readonly identity holds — iterators that captured the previous Zone
 *  reference may see stale data for the rest of the current tick, but
 *  every system in the project reads via the Map each tick, so this is
 *  safe in practice. */
export function setZoneActive(world: GameWorld, id: string, active: boolean): boolean {
    const existing = world.zones.get(id)
    if (!existing) return false
    if (isZoneActive(existing) === active) return true
    defineZone(world, { ...existing, active })
    return true
}

/** Remove a zone from the world. */
export function removeZone(world: GameWorld, id: string): void {
    world.zones.delete(id)
}

/** True if `point` lies inside the zone's AABB. Inclusive on min, exclusive
 *  on max so adjacent zones tile without double-counting boundary points. */
export function isPointInZone(zone: Zone, point: { x: number; y: number; z: number }): boolean {
    return point.x >= zone.min.x && point.x < zone.max.x &&
        point.y >= zone.min.y && point.y < zone.max.y &&
        point.z >= zone.min.z && point.z < zone.max.z
}

/** Find the first zone whose AABB contains `point`. Iterates `world.zones`
 *  in insertion order — call sites that care about determinism should
 *  enforce a stable ordering via id. */
export function findZoneAtPoint(
    world: GameWorld,
    point: { x: number; y: number; z: number },
): Zone | null {
    for (const zone of world.zones.values()) {
        if (isPointInZone(zone, point)) return zone
    }
    return null
}

export function isTriggerZone(zone: Zone): boolean {
    return zone.kind === 'trigger' || (zone.triggerSources?.length ?? 0) > 0
}

export function zoneAcceptsTrigger(zone: Zone, source: ZoneTriggerSource): boolean {
    if (!isTriggerZone(zone)) return false
    const sources = zone.triggerSources
    if (!sources || sources.length === 0) return source === 'player'
    return sources.includes(source)
}

/** Deterministically sample a point uniformly inside the zone's AABB. The
 *  `seed` is hashed twice to spread x/z without spatial correlation; Y is
 *  the zone's min Y so callers always get a foot-anchored position by
 *  default. Mirrors the parent codebase's `sampleZonePoint` so future AI
 *  porting works with the same numerics. */
export function sampleZonePoint(zone: Zone, seed: number): VoxelCoord {
    const u = hash01(seed, 17)
    const v = hash01(seed, 29)
    return {
        x: zone.min.x + (zone.max.x - zone.min.x) * u,
        y: zone.min.y,
        z: zone.min.z + (zone.max.z - zone.min.z) * v,
    }
}

function hash01(seed: number, salt: number): number {
    let n = Math.imul(seed ^ salt, 0x45d9f3b)
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b)
    n ^= n >>> 16
    return (n >>> 0) / 0xffffffff
}
