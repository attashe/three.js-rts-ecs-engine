import { ZONE_PRESETS, applyZonePreset } from '../engine/fx/presets/zone-presets'
import type { WeatherZoneParams } from '../engine/fx/core/types'
import type { WeatherZoneRuntimeConfig } from './weather-config'

/** Narrowest interface the controller needs from the underlying
 *  `WeatherSystem` — just enough to add/remove zones. Lets the
 *  controller be unit-tested against a stub without instantiating
 *  three.js or the full FX engine. */
export interface FxZoneRegistry {
    addZone(params: WeatherZoneParams): unknown
    removeZone(id: string): void
    /** Optional fast path: keep a zone allocated and toggle simulation,
     *  rendering, and light contribution without disposing its meshes. */
    setZoneActive?(id: string, active: boolean): boolean
}

/** Per-zone lifecycle hooks the system layer pairs with audio. */
export interface ZoneLifecycleHooks {
    onSpawned?(config: WeatherZoneRuntimeConfig): void
    onDespawned?(config: WeatherZoneRuntimeConfig): void
}

export interface VisualFxZoneController {
    /** Toggle a level-authored zone. Returns true on a successful state
     *  change (or noop-success when the zone is already in that state),
     *  false when the zoneId isn't known to the controller. */
    setZoneEnabled(zoneId: string, enabled: boolean): boolean
    isZoneEnabled(zoneId: string): boolean
    /** Re-spawn an authored zone with a different preset overlay. Returns
     *  false if the zoneId or presetId is unknown. */
    setZonePreset(zoneId: string, presetId: string): boolean
    /** Add every currently-enabled zone to the registry that isn't
     *  already live. Used by the system factory after the audio gate
     *  resolves. */
    spawnEnabled(hooks?: ZoneLifecycleHooks): void
    /** Drop every allocated zone from the registry. Used at dispose. */
    despawnAll(hooks?: ZoneLifecycleHooks): void
}

export function createVisualFxZoneController(
    registry: FxZoneRegistry,
    initialConfigs: readonly WeatherZoneRuntimeConfig[],
): VisualFxZoneController {
    // Deep-copy author configs so script-driven preset swaps don't
    // mutate the level metadata.
    const configs = new Map<string, WeatherZoneRuntimeConfig>()
    const enabled = new Set<string>()
    const spawned = new Set<string>()
    const live = new Set<string>()
    let lifecycleHooks: ZoneLifecycleHooks | undefined

    for (const c of initialConfigs) {
        configs.set(c.id, { ...c, position: { ...c.position }, size: { ...c.size } })
        if (c.enabled !== false) enabled.add(c.id)
    }

    function paramsFor(config: WeatherZoneRuntimeConfig): WeatherZoneParams {
        return applyZonePreset(config.presetId as keyof typeof ZONE_PRESETS, {
            id: config.id,
            name: config.label ?? config.presetId,
            position: { ...config.position },
            size: { ...config.size },
        })
    }

    function ensureSpawned(config: WeatherZoneRuntimeConfig, active: boolean): boolean {
        if (!active && !registry.setZoneActive) return false
        if (!spawned.has(config.id)) {
            registry.addZone(paramsFor(config))
            spawned.add(config.id)
        }
        registry.setZoneActive?.(config.id, active)
        return true
    }

    function activate(config: WeatherZoneRuntimeConfig): void {
        enabled.add(config.id)
        if (live.has(config.id)) return
        ensureSpawned(config, true)
        live.add(config.id)
        lifecycleHooks?.onSpawned?.(config)
    }

    function deactivate(config: WeatherZoneRuntimeConfig): void {
        enabled.delete(config.id)
        if (!spawned.has(config.id)) return
        if (!live.delete(config.id)) return
        lifecycleHooks?.onDespawned?.(config)
        if (registry.setZoneActive) {
            registry.setZoneActive(config.id, false)
        } else {
            registry.removeZone(config.id)
            spawned.delete(config.id)
        }
    }

    return {
        setZoneEnabled(zoneId, on) {
            const config = configs.get(zoneId)
            if (!config) return false
            if (on) activate(config)
            else deactivate(config)
            return true
        },
        isZoneEnabled(zoneId) {
            // Reflects "currently in the FX registry" so the boolean matches
            // what `fx.getZone(id)` would observe — the contract the Slice 3
            // plan calls out. Pre-spawnEnabled this returns false even for
            // configured-and-enabled zones, which is the right answer for
            // scripts running before init().
            return live.has(zoneId)
        },
        setZonePreset(zoneId, presetId) {
            const config = configs.get(zoneId)
            if (!config) return false
            if (!(presetId in ZONE_PRESETS)) return false
            const wasSpawned = spawned.has(zoneId)
            const wasLive = live.has(zoneId)
            if (wasSpawned) {
                if (wasLive) lifecycleHooks?.onDespawned?.(config)
                registry.removeZone(zoneId)
                spawned.delete(zoneId)
                live.delete(zoneId)
            }
            config.presetId = presetId
            if (wasSpawned) {
                ensureSpawned(config, wasLive)
            }
            if (wasLive) {
                live.add(zoneId)
                lifecycleHooks?.onSpawned?.(config)
            }
            return true
        },
        spawnEnabled(hooks) {
            lifecycleHooks = hooks ?? lifecycleHooks
            for (const config of configs.values()) {
                const shouldBeLive = enabled.has(config.id)
                if (!shouldBeLive) {
                    ensureSpawned(config, false)
                    continue
                }
                if (live.has(config.id)) continue
                ensureSpawned(config, true)
                live.add(config.id)
                lifecycleHooks?.onSpawned?.(config)
            }
        },
        despawnAll(hooks) {
            const activeHooks = hooks ?? lifecycleHooks
            // Visual first, audio second: removeZone tears down the
            // emitter, then onDespawned fades the paired sound. The
            // reverse order would let the sound bed outlive its visual
            // — perceptible as "rain audio kept playing after the
            // particles disappeared."
            for (const id of spawned) {
                const config = configs.get(id)
                registry.removeZone(id)
                if (config && live.has(id)) activeHooks?.onDespawned?.(config)
            }
            spawned.clear()
            live.clear()
        },
    }
}
