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
    /** Drop every live zone from the registry. Used at dispose. */
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
    const live = new Set<string>()

    for (const c of initialConfigs) {
        configs.set(c.id, { ...c, position: { ...c.position }, size: { ...c.size } })
        enabled.add(c.id)
    }

    function paramsFor(config: WeatherZoneRuntimeConfig): WeatherZoneParams {
        return applyZonePreset(config.presetId as keyof typeof ZONE_PRESETS, {
            id: config.id,
            name: config.label ?? config.presetId,
            position: { ...config.position },
            size: { ...config.size },
        })
    }

    return {
        setZoneEnabled(zoneId, on) {
            const config = configs.get(zoneId)
            if (!config) return false
            if (on) {
                enabled.add(zoneId)
                if (!live.has(zoneId)) {
                    registry.addZone(paramsFor(config))
                    live.add(zoneId)
                }
            } else {
                enabled.delete(zoneId)
                if (live.has(zoneId)) {
                    registry.removeZone(zoneId)
                    live.delete(zoneId)
                }
            }
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
            config.presetId = presetId
            if (live.has(zoneId)) {
                registry.removeZone(zoneId)
                live.delete(zoneId)
                registry.addZone(paramsFor(config))
                live.add(zoneId)
            }
            return true
        },
        spawnEnabled(hooks) {
            for (const id of enabled) {
                if (live.has(id)) continue
                const config = configs.get(id)
                if (!config) continue
                registry.addZone(paramsFor(config))
                live.add(id)
                hooks?.onSpawned?.(config)
            }
        },
        despawnAll(hooks) {
            // Visual first, audio second: removeZone tears down the
            // emitter, then onDespawned fades the paired sound. The
            // reverse order would let the sound bed outlive its visual
            // — perceptible as "rain audio kept playing after the
            // particles disappeared."
            for (const id of live) {
                const config = configs.get(id)
                registry.removeZone(id)
                if (config) hooks?.onDespawned?.(config)
            }
            live.clear()
        },
    }
}
