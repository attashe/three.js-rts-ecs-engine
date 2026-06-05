import {
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineSegments,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { EditorSoundZone, EditorState } from '../editor-state'

const ZONE_COLOUR = 0x4af6c8
const SELECTED_COLOUR = 0xffd166

/**
 * Editor-only wireframe overlay for sound zones — same visual idiom
 * as the trigger-zone renderer but in a distinct cyan-green so the
 * two zone kinds don't visually collide.
 *
 * Per-zone refresh fingerprint: rebuild only when the AABB or
 * selection actually changes.
 */
export function createSoundZoneRenderSystem(scene: Scene, editorState: EditorState): System {
    const group = new Group()
    group.name = 'EditorSoundZones'

    const baseMat = new LineBasicMaterial({
        color: ZONE_COLOUR,
        transparent: true,
        opacity: 0.65,
        depthTest: false,
        depthWrite: false,
    })
    const selectedMat = new LineBasicMaterial({
        color: SELECTED_COLOUR,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
    })

    interface Entry { mesh: LineSegments<BufferGeometry, LineBasicMaterial>; fingerprint: string }
    const entries: Entry[] = []

    function fingerprint(zone: EditorSoundZone): string {
        const sel = zone.id === editorState.selectedSoundZoneId ? '1' : '0'
        return [
            zone.id, sel, zone.soundId,
            zone.min.x, zone.min.y, zone.min.z,
            zone.max.x, zone.max.y, zone.max.z,
            zone.volume, zone.fadeTime,
        ].join('|')
    }

    function build(zone: EditorSoundZone): Entry {
        const selected = zone.id === editorState.selectedSoundZoneId
        const geo = boxLineGeometry(zone)
        const mesh = new LineSegments(geo, selected ? selectedMat : baseMat)
        mesh.renderOrder = 995
        mesh.frustumCulled = false
        return { mesh, fingerprint: fingerprint(zone) }
    }

    return {
        order: RenderOrder.debug + 5,
        init() { scene.add(group) },
        update() {
            const zones = editorState.soundZones
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
            baseMat.dispose()
            selectedMat.dispose()
        },
    }
}

function boxLineGeometry(zone: EditorSoundZone): BufferGeometry {
    const { min, max } = zone
    // 12 edges of the AABB, each two endpoints, three floats per point.
    const lines: number[] = []
    const push = (a: [number, number, number], b: [number, number, number]) => {
        lines.push(...a, ...b)
    }
    const c = [
        [min.x, min.y, min.z], [max.x, min.y, min.z], [max.x, min.y, max.z], [min.x, min.y, max.z],
        [min.x, max.y, min.z], [max.x, max.y, min.z], [max.x, max.y, max.z], [min.x, max.y, max.z],
    ] as [number, number, number][]
    push(c[0]!, c[1]!); push(c[1]!, c[2]!); push(c[2]!, c[3]!); push(c[3]!, c[0]!)
    push(c[4]!, c[5]!); push(c[5]!, c[6]!); push(c[6]!, c[7]!); push(c[7]!, c[4]!)
    push(c[0]!, c[4]!); push(c[1]!, c[5]!); push(c[2]!, c[6]!); push(c[3]!, c[7]!)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(lines, 3))
    return geo
}
