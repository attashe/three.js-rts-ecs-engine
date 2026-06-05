import {
    BoxGeometry,
    ConeGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    RingGeometry,
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
 * Renders a "you spawn here" marker at `editorState.spawn`. Two visuals:
 *
 *  - **Tall column + cone** — for iso view. Player-sized translucent column
 *    plus a small upward cone so the marker reads from any angle.
 *  - **Flat ring** — for top-down view. The column would be clipped by the
 *    camera near plane (cut at `workingPlaneY + 1`), so we swap in a flat
 *    ring at `min(spawn.y + ε, workingPlaneY + 0.99)` — always under the
 *    cut, always visible, doesn't obscure the cells underneath.
 *
 * The ring snaps to the working plane when the user raises the plane
 * above spawn so the marker never disappears off-screen.
 */
export function createSpawnMarkerSystem(scene: Scene, editorState: EditorState): System {
    const group = new Group()
    group.name = 'EditorSpawnMarker'

    // Tall column + cone (iso view).
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
    cone.position.y = MAIN_CHARACTER_COLLIDER_HALF_HEIGHT * 2 + 0.32
    cone.renderOrder = 996
    group.add(cone)

    // Flat ring (top-down view). Placed in its own subgroup so we can
    // position it independently of the column/cone (which sit at spawn.y).
    const ringGroup = new Group()
    ringGroup.name = 'EditorSpawnMarkerRing'
    const ringGeo = new RingGeometry(
        MAIN_CHARACTER_COLLIDER_RADIUS,
        MAIN_CHARACTER_COLLIDER_RADIUS + 0.12,
        28,
    )
    // RingGeometry is built in XY — rotate to lie flat in XZ.
    ringGeo.rotateX(-Math.PI / 2)
    const ringMat = new MeshBasicMaterial({
        color: COLOUR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
    })
    const ring = new Mesh(ringGeo, ringMat)
    ring.renderOrder = 997
    ring.frustumCulled = false
    ringGroup.add(ring)
    group.add(ringGroup)

    return {
        order: RenderOrder.debug + 3,
        init() {
            scene.add(group)
        },
        update() {
            group.position.set(editorState.spawn.x, editorState.spawn.y, editorState.spawn.z)
            cone.rotation.y += 0.04

            const inTopDown = editorState.viewMode === 'top-down'
            column.visible = !inTopDown
            cone.visible = !inTopDown
            ringGroup.visible = inTopDown

            if (inTopDown) {
                // Place the ring just under the camera near plane so the
                // cut at `workingPlaneY + 1` doesn't clip it. If the user
                // raises the plane above spawn, the ring snaps up with
                // the plane so it stays on screen.
                const safeY = Math.min(editorState.spawn.y + 0.05, editorState.workingPlaneY + 0.99)
                // Position is on the GROUP, which is at spawn.y — the
                // ring lives in its own subgroup at a local offset.
                ringGroup.position.y = safeY - editorState.spawn.y
            }
        },
        dispose() {
            scene.remove(group)
            columnGeo.dispose()
            columnMat.dispose()
            coneGeo.dispose()
            coneMat.dispose()
            ringGeo.dispose()
            ringMat.dispose()
        },
    }
}
