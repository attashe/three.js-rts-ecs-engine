import {
    BoxGeometry,
    EdgesGeometry,
    Group,
    LineBasicMaterial,
    LineSegments,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { EditorState, EditorZone } from '../editor-state'

const GENERIC_COLOUR = 0xff66cc
const TRIGGER_COLOUR = 0x00e0ff

/**
 * Render-side editor overlay that draws a wireframe box for every
 * `editorState.zones[]` entry — magenta for generic zones, bright cyan
 * for trigger zones (kind === 'trigger' or any explicit triggerSources)
 * so the user can tell at a glance which boxes will emit activation
 * events on overlap. One `LineSegments` per zone keeps the geometry
 * independent — zones can be added/removed at any time and the scene
 * mirrors the array order without an expensive merged-mesh rebuild.
 *
 * Re-syncs each frame against `editorState.zones.length` + a per-zone
 * fingerprint, so resize/relabel/kind-change via the UI also picks up live.
 */
export function createZoneRenderSystem(scene: Scene, editorState: EditorState): System {
    const group = new Group()
    group.name = 'EditorZones'

    const genericMaterial = new LineBasicMaterial({
        color: GENERIC_COLOUR,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
    })
    const triggerMaterial = new LineBasicMaterial({
        color: TRIGGER_COLOUR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
    })

    interface Entry {
        line: LineSegments
        fingerprint: string
    }
    const entries: Entry[] = []

    function isTriggerZone(zone: EditorZone): boolean {
        return zone.kind === 'trigger' || (zone.triggerSources?.length ?? 0) > 0
    }

    function buildLine(zone: EditorZone): LineSegments {
        const w = Math.max(0.001, zone.max.x - zone.min.x)
        const h = Math.max(0.001, zone.max.y - zone.min.y)
        const d = Math.max(0.001, zone.max.z - zone.min.z)
        const box = new BoxGeometry(w, h, d)
        const edges = new EdgesGeometry(box)
        box.dispose()
        const material = isTriggerZone(zone) ? triggerMaterial : genericMaterial
        const line = new LineSegments(edges, material)
        line.frustumCulled = false
        line.renderOrder = 998
        // Box origin is at the centre; shift so the geometry sits on
        // [min, max] in world space.
        line.position.set(
            (zone.min.x + zone.max.x) * 0.5,
            (zone.min.y + zone.max.y) * 0.5,
            (zone.min.z + zone.max.z) * 0.5,
        )
        return line
    }

    /** Geometry+colour fingerprint. Includes the trigger-ness bit so that
     *  flipping kind from generic to trigger (or adding triggerSources)
     *  rebuilds the box with the right material. */
    function fingerprint(zone: EditorZone): string {
        const trigger = isTriggerZone(zone) ? '1' : '0'
        return `${zone.id}|${trigger}|${zone.min.x},${zone.min.y},${zone.min.z}|${zone.max.x},${zone.max.y},${zone.max.z}`
    }

    return {
        order: RenderOrder.debug + 3,
        init() {
            scene.add(group)
        },
        update() {
            const zones = editorState.zones
            // Grow entries to match zone count.
            while (entries.length < zones.length) {
                const zone = zones[entries.length]!
                const line = buildLine(zone)
                group.add(line)
                entries.push({ line, fingerprint: fingerprint(zone) })
            }
            // Shrink — dispose extras.
            while (entries.length > zones.length) {
                const e = entries.pop()!
                group.remove(e.line)
                e.line.geometry.dispose()
            }
            // Refresh existing entries when the zone's geometry or
            // trigger-ness changed.
            for (let i = 0; i < zones.length; i++) {
                const zone = zones[i]!
                const entry = entries[i]!
                const fp = fingerprint(zone)
                if (entry.fingerprint === fp) continue
                group.remove(entry.line)
                entry.line.geometry.dispose()
                const replacement = buildLine(zone)
                group.add(replacement)
                entries[i] = { line: replacement, fingerprint: fp }
            }
        },
        dispose() {
            for (const e of entries) {
                group.remove(e.line)
                e.line.geometry.dispose()
            }
            entries.length = 0
            scene.remove(group)
            genericMaterial.dispose()
            triggerMaterial.dispose()
        },
    }
}
