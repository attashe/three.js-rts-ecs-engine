import { Vector3, type Camera, type PointLight } from 'three'

/**
 * Caps how many FX lights are active at once. The system passes every
 * registered light through `pick`; lights beyond the budget have their
 * intensity multiplied by 0 (so they keep their colour/distance and
 * snap back when chosen) — they're never removed from the scene, so
 * Three's renderer light-count stays stable across frames.
 *
 * Picks by squared camera distance: closest `maxLights` lights are
 * kept lit. Set `maxLights = Infinity` to disable budgeting.
 */
export class LightBudget {
    private readonly tmp = new Vector3()

    constructor(public maxLights: number = 6) {}

    apply(lights: Iterable<PointLight>, camera: Camera, falloff = 1): void {
        const arr: { light: PointLight; d2: number; baseIntensity: number }[] = []
        for (const light of lights) {
            light.getWorldPosition(this.tmp)
            const dx = this.tmp.x - camera.position.x
            const dy = this.tmp.y - camera.position.y
            const dz = this.tmp.z - camera.position.z
            const d2 = dx * dx + dy * dy + dz * dz
            // We assume the user stored the "wanted" intensity on
            // `userData.wanted` before calling apply. The system does
            // this every frame after the emitter modulates the light.
            const wanted = (light.userData as Record<string, unknown>).wanted as number | undefined
            arr.push({ light, d2, baseIntensity: wanted ?? light.intensity })
        }
        arr.sort((a, b) => a.d2 - b.d2)
        const cap = Math.max(0, Math.floor(this.maxLights))
        for (let i = 0; i < arr.length; i++) {
            const entry = arr[i]!
            // Outside budget → fade by squared falloff so the change
            // is gradual; inside budget → restore to wanted.
            if (i < cap) {
                entry.light.intensity = entry.baseIntensity
            } else {
                const ratio = (i - cap + 1) * falloff
                entry.light.intensity = entry.baseIntensity * Math.max(0, 1 - ratio)
            }
        }
    }
}
