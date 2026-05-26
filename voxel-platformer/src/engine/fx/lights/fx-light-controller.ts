import { Color } from 'three'
import type { WeatherZoneRuntime } from '../core/types'

/**
 * Per-effect light modulation. The zone owns a PointLight whose colour
 * and intensity are set from the params; this module reshapes the
 * intensity over time so fire flickers, explosions flash, lava glows
 * with a slow rhythm, etc.
 *
 * The controller writes the modulated value to
 * `light.userData.wanted` so the LightBudget can clamp it for off-
 * screen lights without losing the per-effect rhythm.
 */
export function modulateZoneLight(runtime: WeatherZoneRuntime, elapsed: number): void {
    if (!runtime.params.lightEnabled) {
        runtime.light.intensity = 0
        return
    }
    const base = runtime.params.lightIntensity
    let mod = 1
    // Darkness zones publish their `lightIntensity` as a positive
    // magnitude (friendlier for the editor's number input) and rely
    // on the controller to flip it for the renderer. Doing the
    // negation here — not in the preset — keeps the saved level
    // format readable: every zone's lightIntensity is a magnitude.
    let signedBase = base
    if (runtime.params.type === 'darkness') signedBase = -Math.abs(base)
    const t = elapsed
    const phase = runtime.seed * 6.283
    switch (runtime.params.type) {
        case 'fire':
            mod = Math.max(0.45, 1 + Math.sin(t * 9.5) * 0.18 + Math.sin(t * 23.0) * 0.09 + Math.max(0, Math.sin(t * 37.0)) * 0.10)
            break
        case 'fireTornado':
            mod = Math.max(0.62, 1.18 + Math.sin(t * 7.8) * 0.28 + Math.sin(t * 17.0 + phase) * 0.16 + Math.max(0, Math.sin(t * 31.0)) * 0.22)
            break
        case 'explosion': {
            const burstAt = (runtime as { _explosionBurstAt?: number })._explosionBurstAt ?? 0
            const age = Math.max(0, elapsed - burstAt)
            const flash = Math.exp(-age * 3.4) * 6.0
            const afterglow = Math.exp(-age * 0.85) * 0.85
            mod = flash + afterglow
            break
        }
        case 'embers':
            mod = 0.95 + Math.sin(t * 7) * 0.16
            break
        case 'magic':
            mod = 0.85 + Math.sin(t * 2.6) * 0.22
            break
        case 'firefly':
            mod = 0.35 + Math.max(0, Math.sin(t * 1.2)) * 0.55
            break
        case 'lightning':
            mod = 0.28
            break
        case 'lava':
            mod = 0.85 + Math.max(0, Math.sin(t * 3.4 + phase)) * 0.55 + Math.max(0, Math.sin(t * 8.2 + phase * 0.6)) * 0.14
            break
        case 'water':
            mod = 0.55 + Math.sin(t * 1.9 + phase) * 0.08
            break
        case 'darkness':
            // Gentle breathing — keeps the dark pool from looking
            // static. Stays close to 1 so the magnitude the level
            // author dialled in still reads as the dominant value.
            mod = 0.92 + Math.sin(t * 0.85 + phase) * 0.08
            break
    }
    const wanted = signedBase * mod
    runtime.light.intensity = wanted
    ;(runtime.light.userData as Record<string, unknown>).wanted = wanted
    runtime.light.color.set(new Color(runtime.params.lightColor))
}

/**
 * Optional one-shot flash on top of the base modulation. Used by
 * lightning strikes and explosion triggers. The caller passes the
 * remaining flash energy; the controller decays it next frame.
 */
export function applyLightFlash(runtime: WeatherZoneRuntime, flash: number): void {
    runtime.light.intensity += flash
    ;(runtime.light.userData as Record<string, unknown>).wanted = runtime.light.intensity
}
