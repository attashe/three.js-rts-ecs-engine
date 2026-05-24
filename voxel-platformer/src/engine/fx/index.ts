/**
 * Public surface of the FX package. The single import point for game
 * code:
 *
 * ```ts
 * import { WeatherSystem, applyZonePreset, WEATHER_PRESETS } from './engine/fx'
 *
 * const fx = new WeatherSystem(scene)
 * fx.setAmbient(WEATHER_PRESETS.storm.apply)
 * fx.addZone(applyZonePreset('fire', { position: { x: 0, y: 0, z: 0 } }))
 *
 * // ...inside the game loop:
 * fx.update(dt, camera)
 * ```
 *
 * The package owns its own scene attachments — sky dome, ambient
 * lights, fog. Don't add your own sky/fog after constructing
 * `WeatherSystem` unless you want to override these.
 */

export { WeatherSystem } from './core/weather-system'
export type { WeatherSystemOptions } from './core/weather-system'
export { WeatherZone } from './core/weather-zone'
export { AmbientWeather } from './core/ambient-weather'
export type {
    AmbientWeatherPreset,
    AmbientWeatherState,
    EffectType,
    EmitterStrategy,
    ExtraLayer,
    ParticlePool,
    Vec3Lite,
    WeatherZoneParams,
    WeatherZoneRuntime,
    ZonePreset,
} from './core/types'
export { ZONE_PRESETS, applyZonePreset } from './presets/zone-presets'
export { WEATHER_PRESETS } from './presets/weather-presets'
export { registerEmitter, getEmitter, availableEmitterTypes } from './emitters/registry'
export { TextureRegistry } from './textures/texture-registry'
export { MaterialRegistry } from './materials/material-registry'
export { LightBudget } from './lights/light-budget'

// Re-export sim utilities so users who want to write custom emitters
// can compose them with the same primitives the built-ins use.
export {
    clamp,
    curlNoise3,
    damping,
    hexToInt,
    lerp,
    makeRng,
    rand,
    randSign,
    smoothstep,
    wrap,
    TAU,
} from './core/sim-utils'

// Particle-pool / extra-layer ops. Custom emitters can use these to
// avoid re-implementing the integration + recycling boilerplate.
export {
    ageLayer,
    diskInZone,
    integrate,
    integrateLayer,
    lifeT,
    lifeTClamped,
    recycleOldestSlot,
    wrapHorizontal,
} from './core/particle-ops'

// Emitter authoring helpers (allocation, layer step + write).
export { billboardYaw, buildExtraLayer, buildPrimaryBillboard, pointAtTop, pointInZone } from './emitters/emitter-base'
export { hideInactiveTail, stepRespawningLayer, writeBillboardLayer } from './emitters/layer-ops'
export type { StepRespawningLayerOpts, WriteBillboardLayerOpts } from './emitters/layer-ops'

// Allocation-free material tinting.
export { tintMaterial } from './materials/material-tint'
