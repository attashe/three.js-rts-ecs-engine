import { Group, type Scene } from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import { disposeObject3D } from '../../engine/render/dispose-object'
import type { RailCartFacing } from '../../engine/ecs/world'
import { createRailCartModel } from '../../game/rail/rail-cart-system'
import type { EditorState } from '../editor-state'

export function createRailCartRenderSystem(scene: Scene, editorState: EditorState): System {
    const root = new Group()
    root.name = 'EditorRailCarts'
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
        for (const cart of editorState.railCarts) {
            const model = createRailCartModel()
            model.name = `EditorRailCart:${cart.id}`
            model.position.set(cart.railCell.x + 0.5, cart.railCell.y + 0.06, cart.railCell.z + 0.5)
            model.rotation.y = yawForFacing(cart.front)
            if (cart.id === editorState.selectedRailCartId) model.scale.setScalar(1.08)
            root.add(model)
        }
    }
}

function clearRoot(root: Group): void {
    for (const child of [...root.children]) {
        root.remove(child)
        disposeObject3D(child)
    }
}

function yawForFacing(facing: RailCartFacing): number {
    switch (facing) {
        case 'north': return Math.PI
        case 'east': return Math.PI * 0.5
        case 'south': return 0
        case 'west': return -Math.PI * 0.5
    }
}

function buildFingerprint(state: EditorState): string {
    return [
        state.selectedRailCartId ?? '',
        state.railCarts.map((cart) => [
            cart.id,
            cart.railCell.x,
            cart.railCell.y,
            cart.railCell.z,
            cart.front,
            cart.speed,
            cart.interactionRadius,
            cart.enabled,
        ].join(':')).join('|'),
    ].join('||')
}
