import {
    BufferGeometry,
    Group,
    LineBasicMaterial,
    LineLoop,
    Mesh,
    MeshBasicMaterial,
    SphereGeometry,
    Vector3,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { EditorSoundSource, EditorState } from '../editor-state'

const SOURCE_COLOUR = 0x66e6ff
const SELECTED_COLOUR = 0xffd166
const SEGMENTS = 96

/**
 * Editor-only overlay for placed sound sources. Each source gets a small
 * marker at its emitter position plus an XZ radius ring matching the
 * spatial max distance used in playtest.
 */
export function createSoundSourceRenderSystem(scene: Scene, editorState: EditorState): System {
    const group = new Group()
    group.name = 'EditorSoundSources'

    const sourceMaterial = new MeshBasicMaterial({
        color: SOURCE_COLOUR,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
    })
    const selectedMaterial = new MeshBasicMaterial({
        color: SELECTED_COLOUR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
    })
    const ringMaterial = new LineBasicMaterial({
        color: SOURCE_COLOUR,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
        depthWrite: false,
    })
    const selectedRingMaterial = new LineBasicMaterial({
        color: SELECTED_COLOUR,
        transparent: true,
        opacity: 0.55,
        depthTest: false,
        depthWrite: false,
    })

    interface Entry {
        root: Group
        marker: Mesh<SphereGeometry, MeshBasicMaterial>
        ring: LineLoop<BufferGeometry, LineBasicMaterial>
        fingerprint: string
    }
    const entries: Entry[] = []

    function build(source: EditorSoundSource): Entry {
        const selected = source.id === editorState.selectedSoundSourceId
        const root = new Group()
        root.name = `SoundSource:${source.id}`
        root.position.set(source.position.x, source.position.y, source.position.z)
        root.renderOrder = 996

        const marker = new Mesh(
            new SphereGeometry(selected ? 0.22 : 0.18, 16, 8),
            selected ? selectedMaterial : sourceMaterial,
        )
        marker.frustumCulled = false
        marker.renderOrder = 997
        root.add(marker)

        const ring = new LineLoop(
            radiusGeometry(source.radius),
            selected ? selectedRingMaterial : ringMaterial,
        )
        ring.frustumCulled = false
        ring.renderOrder = 996
        root.add(ring)

        return { root, marker, ring, fingerprint: fingerprint(source) }
    }

    function fingerprint(source: EditorSoundSource): string {
        const selected = source.id === editorState.selectedSoundSourceId ? '1' : '0'
        return [
            source.id,
            selected,
            source.soundId,
            source.position.x,
            source.position.y,
            source.position.z,
            source.radius,
            source.volume,
            source.loop ? 'l' : '-',
            source.autoplay ? 'a' : '-',
        ].join('|')
    }

    return {
        order: RenderOrder.debug + 4,
        init() {
            scene.add(group)
        },
        update() {
            const sources = editorState.soundSources
            while (entries.length < sources.length) {
                const entry = build(sources[entries.length]!)
                group.add(entry.root)
                entries.push(entry)
            }
            while (entries.length > sources.length) {
                const entry = entries.pop()!
                group.remove(entry.root)
                disposeEntry(entry)
            }
            for (let i = 0; i < sources.length; i++) {
                const source = sources[i]!
                const fp = fingerprint(source)
                const entry = entries[i]!
                if (entry.fingerprint === fp) continue
                group.remove(entry.root)
                disposeEntry(entry)
                const replacement = build(source)
                group.add(replacement.root)
                entries[i] = replacement
            }
        },
        dispose() {
            for (const entry of entries) {
                group.remove(entry.root)
                disposeEntry(entry)
            }
            entries.length = 0
            scene.remove(group)
            sourceMaterial.dispose()
            selectedMaterial.dispose()
            ringMaterial.dispose()
            selectedRingMaterial.dispose()
        },
    }
}

function radiusGeometry(radius: number): BufferGeometry {
    const safeRadius = Math.max(0.01, radius)
    const points: Vector3[] = []
    for (let i = 0; i < SEGMENTS; i++) {
        const t = (i / SEGMENTS) * Math.PI * 2
        points.push(new Vector3(Math.cos(t) * safeRadius, 0, Math.sin(t) * safeRadius))
    }
    return new BufferGeometry().setFromPoints(points)
}

function disposeEntry(entry: {
    marker: Mesh<SphereGeometry, MeshBasicMaterial>
    ring: LineLoop<BufferGeometry, LineBasicMaterial>
}): void {
    entry.marker.geometry.dispose()
    entry.ring.geometry.dispose()
}
