import {
    BufferGeometry,
    Group,
    Line,
    LineBasicMaterial,
    Material,
    Mesh,
    MeshBasicMaterial,
    SphereGeometry,
    Vector3,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import { disposeObject3D } from '../../engine/render/dispose-object'
import { createStone } from '../../game/assets'
import { DEFAULT_STONE_RADIUS, stoneOptionsForConfig, stoneRadiusForConfig } from '../../game/moving-objects'
import type { EditorState } from '../editor-state'

export function createStoneRenderSystem(scene: Scene, editorState: EditorState): System {
    const root = new Group()
    root.name = 'EditorStones'
    let fingerprint = ''

    return {
        order: RenderOrder.worldRender + 4,
        init() {
            scene.add(root)
        },
        update() {
            const next = buildFingerprint(editorState)
            if (next === fingerprint) return
            fingerprint = next
            rebuild()
        },
        dispose() {
            clearRoot(root)
            scene.remove(root)
        },
    }

    function rebuild(): void {
        clearRoot(root)
        for (const stone of editorState.stones) {
            const opts = stoneOptionsForConfig(stone)
            const radius = stoneRadiusForConfig(stone)
            const mesh = createStone({
                scale: radius / DEFAULT_STONE_RADIUS,
                color: opts.color,
                chipColor: opts.chipColor,
            })
            mesh.name = `EditorStone:${stone.id ?? ''}`
            mesh.position.set(stone.position.x, stone.position.y + radius, stone.position.z)
            if (stone.id === editorState.selectedStoneId) mesh.scale.multiplyScalar(1.08)
            root.add(mesh)
        }
        for (const spawner of editorState.stoneSpawners) {
            root.add(createSpawnerMarker(spawner, spawner.id === editorState.selectedStoneSpawnerId))
        }
    }
}

function createSpawnerMarker(
    spawner: { id?: string; position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number }; enabled?: boolean },
    selected: boolean,
): Group {
    const group = new Group()
    group.name = `EditorStoneSpawner:${spawner.id ?? ''}`
    group.position.set(spawner.position.x, spawner.position.y + 0.18, spawner.position.z)

    const color = selected ? 0xffd166 : spawner.enabled === false ? 0x8a8f96 : 0xff9f43
    const core = new Mesh(
        new SphereGeometry(selected ? 0.24 : 0.19, 14, 8),
        new MeshBasicMaterial({ color, transparent: true, opacity: spawner.enabled === false ? 0.45 : 0.78, depthWrite: false }),
    )
    core.renderOrder = 996
    group.add(core)

    const velocity = new Vector3(spawner.velocity.x, spawner.velocity.y, spawner.velocity.z)
    const len = velocity.length()
    if (len > 0.001) {
        const dir = velocity.multiplyScalar(1 / len)
        const end = dir.multiplyScalar(Math.min(1.2, Math.max(0.35, len * 0.18)))
        const geo = new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), end])
        const line = new Line(geo, new LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }))
        line.renderOrder = 997
        group.add(line)
    }

    return group
}

function clearRoot(root: Group): void {
    for (const child of [...root.children]) {
        root.remove(child)
        child.traverse((obj) => {
            if (obj instanceof Line) {
                obj.geometry.dispose()
                disposeMaterial(obj.material)
            }
        })
        disposeObject3D(child)
    }
}

function disposeMaterial(material: Material | Material[]): void {
    if (Array.isArray(material)) {
        for (const item of material) item.dispose()
    } else {
        material.dispose()
    }
}

function buildFingerprint(state: EditorState): string {
    return [
        state.selectedStoneId ?? '',
        state.selectedStoneSpawnerId ?? '',
        state.stones.map((stone) => [
            stone.id,
            stone.position.x,
            stone.position.y,
            stone.position.z,
            stone.tier,
            stone.size,
            stone.options?.color,
            stone.options?.chipColor,
        ].join(':')).join('|'),
        state.stoneSpawners.map((spawner) => [
            spawner.id,
            spawner.enabled,
            spawner.position.x,
            spawner.position.y,
            spawner.position.z,
            spawner.velocity.x,
            spawner.velocity.y,
            spawner.velocity.z,
            spawner.tier,
            spawner.size,
        ].join(':')).join('|'),
    ].join('||')
}
