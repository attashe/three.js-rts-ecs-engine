import {
    ArrowHelper,
    Group,
    LineBasicMaterial,
    MeshBasicMaterial,
    Vector3,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { EditorState, EditorPiston } from '../editor-state'

const ARROW_COLOUR = 0xffd166

/**
 * Editor-only overlay that draws a yellow `ArrowHelper` from every piston's
 * `from` cell to its `to` cell so the user can see *which way* a placed
 * piston moves. Updates by-value each frame (`editorState.pistons.length`
 * changes whenever the user places or removes a piston).
 *
 * The arrows live in their own group, never affect gameplay, and are pruned
 * on `dispose`.
 */
export function createPistonMarkerSystem(scene: Scene, editorState: EditorState): System {
    const group = new Group()
    group.name = 'EditorPistonMarkers'
    const arrows: ArrowHelper[] = []

    return {
        order: RenderOrder.debug + 3,
        init() {
            scene.add(group)
        },
        update() {
            syncArrowCount(group, arrows, editorState.pistons.length)
            for (let i = 0; i < editorState.pistons.length; i++) {
                placeArrow(arrows[i]!, editorState.pistons[i]!)
            }
        },
        dispose() {
            scene.remove(group)
            for (const arrow of arrows) disposeArrow(arrow)
            arrows.length = 0
        },
    }
}

function syncArrowCount(group: Group, arrows: ArrowHelper[], required: number): void {
    while (arrows.length < required) {
        const arrow = new ArrowHelper(
            new Vector3(0, 1, 0),
            new Vector3(0, 0, 0),
            1,
            ARROW_COLOUR,
            0.35,
            0.22,
        )
        const lineMat = arrow.line.material as LineBasicMaterial
        lineMat.transparent = true
        lineMat.opacity = 0.95
        const coneMat = arrow.cone.material as MeshBasicMaterial
        coneMat.transparent = true
        coneMat.opacity = 0.95
        // Render on top of voxels so the arrow is visible even when it
        // travels through solid blocks during placement.
        arrow.line.renderOrder = 995
        arrow.cone.renderOrder = 995
        group.add(arrow)
        arrows.push(arrow)
    }
    while (arrows.length > required) {
        const arrow = arrows.pop()!
        group.remove(arrow)
        disposeArrow(arrow)
    }
}

const ORIGIN_TMP = new Vector3()
const DELTA_TMP = new Vector3()

function placeArrow(arrow: ArrowHelper, piston: EditorPiston): void {
    ORIGIN_TMP.set(piston.from.x + 0.5, piston.from.y + 0.5, piston.from.z + 0.5)
    DELTA_TMP.set(
        piston.to.x - piston.from.x,
        piston.to.y - piston.from.y,
        piston.to.z - piston.from.z,
    )
    const length = DELTA_TMP.length()
    if (length < 1e-4) {
        arrow.visible = false
        return
    }
    arrow.visible = true
    arrow.position.copy(ORIGIN_TMP)
    DELTA_TMP.normalize()
    arrow.setDirection(DELTA_TMP)
    arrow.setLength(length, Math.min(0.45, length * 0.4), 0.22)
}

function disposeArrow(arrow: ArrowHelper): void {
    arrow.line.geometry.dispose()
    ;(arrow.line.material as LineBasicMaterial).dispose()
    arrow.cone.geometry.dispose()
    ;(arrow.cone.material as MeshBasicMaterial).dispose()
}
