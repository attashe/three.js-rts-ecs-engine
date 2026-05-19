import {
    BoxGeometry,
    ConeGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import {
    MAIN_CHARACTER_COLLIDER_HALF_HEIGHT,
    MAIN_CHARACTER_COLLIDER_RADIUS,
} from '../../game/assets'
import type { EditorState } from '../editor-state'

const COLOUR = 0x57e1ff

/**
 * Renders a translucent "you spawn here" marker at `editorState.spawn`. The
 * marker is a player-sized rectangular column (matching the gameplay AABB)
 * plus a small upward cone on top so the user can spot it from any angle.
 *
 * Tracks spawn changes by-value each frame; cheap because it's a single
 * `Group.position.set` and the meshes are static.
 */
export function createSpawnMarkerSystem(scene: Scene, editorState: EditorState): System {
    const group = new Group()
    group.name = 'EditorSpawnMarker'

    const columnGeo = new BoxGeometry(
        MAIN_CHARACTER_COLLIDER_RADIUS * 2,
        MAIN_CHARACTER_COLLIDER_HALF_HEIGHT * 2,
        MAIN_CHARACTER_COLLIDER_RADIUS * 2,
    )
    const columnMat = new MeshBasicMaterial({
        color: COLOUR,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
    })
    const column = new Mesh(columnGeo, columnMat)
    // Box origin is centre — shift up so the bottom face sits at spawn.y.
    column.position.y = MAIN_CHARACTER_COLLIDER_HALF_HEIGHT
    column.renderOrder = 996
    group.add(column)

    const coneGeo = new ConeGeometry(0.22, 0.42, 12)
    const coneMat = new MeshBasicMaterial({
        color: COLOUR,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
    })
    const cone = new Mesh(coneGeo, coneMat)
    // Sit the cone just above the head of the column.
    cone.position.y = MAIN_CHARACTER_COLLIDER_HALF_HEIGHT * 2 + 0.32
    cone.renderOrder = 996
    group.add(cone)

    return {
        order: RenderOrder.debug + 3,
        init() {
            scene.add(group)
        },
        update() {
            group.position.set(editorState.spawn.x, editorState.spawn.y, editorState.spawn.z)
            // Slow rotation makes the marker easier to spot against busy
            // terrain without animating the geometry itself.
            cone.rotation.y += 0.04
        },
        dispose() {
            scene.remove(group)
            columnGeo.dispose()
            columnMat.dispose()
            coneGeo.dispose()
            coneMat.dispose()
        },
    }
}
