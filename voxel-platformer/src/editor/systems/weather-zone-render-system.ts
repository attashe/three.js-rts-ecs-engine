import {
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineSegments,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import { ZONE_PRESETS } from '../../engine/fx/presets/zone-presets'
import type { EditorState, EditorWeatherZone } from '../editor-state'

const SELECTED_COLOUR = 0xffd166
const DEFAULT_COLOUR = 0xffd6f0

/**
 * Editor-only wireframe overlay for placed weather/FX zones. Each
 * zone gets a coloured AABB whose tint matches the preset's primary
 * particle colour, so the user can tell a fire box from a rain box
 * at a glance without reading labels. Selected zones use the global
 * editor-selection yellow so the active zone stands out.
 *
 * Materials are allocated per fingerprint to avoid mutating shared
 * material colours; cached in a per-tint map so two fire zones share
 * one material.
 */
export function createWeatherZoneRenderSystem(scene: Scene, editorState: EditorState): System {
    const group = new Group()
    group.name = 'EditorWeatherZones'

    const materials = new Map<number, LineBasicMaterial>()
    const selectedMat = new LineBasicMaterial({
        color: SELECTED_COLOUR,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
    })

    function materialFor(hex: number): LineBasicMaterial {
        const existing = materials.get(hex)
        if (existing) return existing
        const mat = new LineBasicMaterial({
            color: hex,
            transparent: true,
            opacity: 0.65,
            depthTest: false,
            depthWrite: false,
        })
        materials.set(hex, mat)
        return mat
    }

    interface Entry { mesh: LineSegments<BufferGeometry, LineBasicMaterial>; fingerprint: string }
    const entries: Entry[] = []

    function fingerprint(zone: EditorWeatherZone): string {
        const sel = zone.id === editorState.selectedWeatherZoneId ? '1' : '0'
        return [
            zone.id, sel, zone.presetId,
            zone.position.x, zone.position.y, zone.position.z,
            zone.size.x, zone.size.y, zone.size.z,
            zone.addSound ? '1' : '0', zone.soundId ?? '', zone.soundVolume,
        ].join('|')
    }

    function build(zone: EditorWeatherZone): Entry {
        const selected = zone.id === editorState.selectedWeatherZoneId
        const geo = boxLineGeometry(zone)
        const tint = selected ? selectedMat : materialFor(colourForPreset(zone.presetId))
        const mesh = new LineSegments(geo, tint)
        mesh.renderOrder = 995
        mesh.frustumCulled = false
        return { mesh, fingerprint: fingerprint(zone) }
    }

    return {
        order: RenderOrder.debug + 6,
        init() { scene.add(group) },
        update() {
            const zones = editorState.weatherZones
            while (entries.length < zones.length) {
                const entry = build(zones[entries.length]!)
                group.add(entry.mesh)
                entries.push(entry)
            }
            while (entries.length > zones.length) {
                const entry = entries.pop()!
                group.remove(entry.mesh)
                entry.mesh.geometry.dispose()
            }
            for (let i = 0; i < zones.length; i++) {
                const zone = zones[i]!
                const fp = fingerprint(zone)
                const entry = entries[i]!
                if (entry.fingerprint === fp) continue
                group.remove(entry.mesh)
                entry.mesh.geometry.dispose()
                const replacement = build(zone)
                group.add(replacement.mesh)
                entries[i] = replacement
            }
        },
        dispose() {
            for (const entry of entries) {
                group.remove(entry.mesh)
                entry.mesh.geometry.dispose()
            }
            entries.length = 0
            scene.remove(group)
            for (const mat of materials.values()) mat.dispose()
            materials.clear()
            selectedMat.dispose()
        },
    }
}

function colourForPreset(presetId: string): number {
    const preset = ZONE_PRESETS[presetId]
    const hex = preset?.params.color
    if (!hex) return DEFAULT_COLOUR
    try { return new Color(hex).getHex() }
    catch { return DEFAULT_COLOUR }
}

function boxLineGeometry(zone: EditorWeatherZone): BufferGeometry {
    const { position: p, size: s } = zone
    const minX = p.x - s.x / 2, maxX = p.x + s.x / 2
    const minY = p.y - s.y / 2, maxY = p.y + s.y / 2
    const minZ = p.z - s.z / 2, maxZ = p.z + s.z / 2
    const lines: number[] = []
    const push = (a: [number, number, number], b: [number, number, number]) => {
        lines.push(...a, ...b)
    }
    const c = [
        [minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ],
        [minX, maxY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
    ] as [number, number, number][]
    push(c[0]!, c[1]!); push(c[1]!, c[2]!); push(c[2]!, c[3]!); push(c[3]!, c[0]!)
    push(c[4]!, c[5]!); push(c[5]!, c[6]!); push(c[6]!, c[7]!); push(c[7]!, c[4]!)
    push(c[0]!, c[4]!); push(c[1]!, c[5]!); push(c[2]!, c[6]!); push(c[3]!, c[7]!)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(lines, 3))
    return geo
}
