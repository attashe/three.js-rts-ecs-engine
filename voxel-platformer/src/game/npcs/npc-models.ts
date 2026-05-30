import {
    Group,
    Matrix4,
    Mesh,
    type Object3D,
} from 'three'
import {
    createMainCharacter,
    sharedBoxGeometry,
    sharedSphereGeometry,
    sharedMaterial,
} from '../assets'
import type { EquipSlot } from '../../engine/anim'
import type { EquipmentKind } from '../anim/equipment'
import type { NpcModelKind } from './npc-types'

export function createNpcModel(kind: NpcModelKind): Group {
    switch (kind) {
        case 'player':
            return createPlayerNpcModel()
        case 'keeper':
            return createKeeperNpcModel()
        case 'large-troll':
            return createLargeTrollModel()
    }
}

/**
 * What each hand (and the head/back) holds for a given NPC. Items are real
 * equipment attached to the rig's sockets by the npc-render system, so they
 * animate with the limb and can be assigned to either hand independently.
 */
export type NpcLoadout = Partial<Record<EquipSlot, EquipmentKind>>

export function npcLoadout(kind: NpcModelKind): NpcLoadout {
    switch (kind) {
        case 'keeper':
            return { handR: 'staff' }
        case 'large-troll':
            return { handL: 'book' }
        default:
            return {}
    }
}

function createPlayerNpcModel(): Group {
    const root = createMainCharacter({
        tunicColor: 0x2f5e8f,
        cloakColor: 0x7a2430,
        skinColor: 0xd8a06a,
        metalColor: 0xc8b56f,
        bootColor: 0x2b211d,
    })
    root.name = 'NpcModel:player'
    return root
}

function createKeeperNpcModel(): Group {
    const root = createMainCharacter({
        tunicColor: 0x1f2c3f,
        cloakColor: 0x3f2818,
        skinColor: 0xc89461,
        metalColor: 0xffc462,
        bootColor: 0x17120d,
    })
    root.name = 'NpcModel:keeper'

    // The staff + lantern are now the keeper's `staff` hand item (see npcLoadout).
    // The beard is intrinsic: parent it to the torso so it rides the body's
    // lean / death topple instead of hanging in mid-air.
    const beard = shadowed(new Mesh(
        sharedBoxGeometry(0.08, 0.22, 0.18),
        sharedMaterial(0xb6b09a, 0.9),
    ))
    beard.name = 'KeeperBeard'
    beard.position.set(0, 1.23, 0.19)
    root.add(beard)
    reparentInModel(root, 'Chest', beard)

    return root
}

function createLargeTrollModel(): Group {
    const root = new Group()
    root.name = 'NpcModel:large-troll'

    const figure = createMainCharacter({
        tunicColor: 0x394b4f,
        cloakColor: 0x4f2430,
        skinColor: 0x6f8d6b,
        metalColor: 0xd2b45f,
        bootColor: 0x251f19,
    })
    figure.name = 'LargeTrollFigure'
    figure.scale.setScalar(1.85)
    root.add(figure)

    const robe = shadowed(new Mesh(
        sharedBoxGeometry(0.92, 0.1, 0.64),
        sharedMaterial(0x24343c, 0.82),
    ))
    robe.name = 'LargeTrollRobeHem'
    robe.position.set(0, 0.52, 0.02)
    root.add(robe)

    const sash = shadowed(new Mesh(
        sharedBoxGeometry(1.02, 0.1, 0.08),
        sharedMaterial(0xb98f45, 0.48, 0.16),
    ))
    sash.name = 'LargeTrollSash'
    sash.position.set(0, 1.34, 0.47)
    root.add(sash)

    const brow = shadowed(new Mesh(
        sharedBoxGeometry(0.56, 0.08, 0.12),
        sharedMaterial(0x42573e, 0.78),
    ))
    brow.name = 'LargeTrollHeavyBrow'
    brow.position.set(0, 2.67, 0.31)
    root.add(brow)

    const leftLens = shadowed(new Mesh(
        sharedSphereGeometry(0.09, 10, 6),
        sharedMaterial(0x9fd7d3, 0.32, 0.08, 0.54),
    ))
    leftLens.name = 'LargeTrollLeftLens'
    leftLens.position.set(-0.18, 2.57, 0.35)
    leftLens.scale.set(1.1, 0.72, 0.2)
    root.add(leftLens)

    const rightLens = shadowed(new Mesh(
        sharedSphereGeometry(0.09, 10, 6),
        sharedMaterial(0x9fd7d3, 0.32, 0.08, 0.54),
    ))
    rightLens.name = 'LargeTrollRightLens'
    rightLens.position.set(0.18, 2.57, 0.35)
    rightLens.scale.set(1.1, 0.72, 0.2)
    root.add(rightLens)

    const bridge = shadowed(new Mesh(
        sharedBoxGeometry(0.14, 0.025, 0.035),
        sharedMaterial(0xd2b45f, 0.42, 0.24),
    ))
    bridge.name = 'LargeTrollGlassesBridge'
    bridge.position.set(0, 2.57, 0.38)
    root.add(bridge)

    // The book + pages are now the troll's `book` hand item (see npcLoadout).
    // Glasses, brow and sash are intrinsic: parent them into the (scaled) torso /
    // head so they track the body — `reparentInModel` divides out the 1.85×
    // figure scale so they keep their authored size and place. The robe hem rides
    // the whole figure (tips on death, doesn't lean with the chest).
    reparentInModel(root, 'Chest', brow)
    reparentInModel(root, 'Chest', leftLens)
    reparentInModel(root, 'Chest', rightLens)
    reparentInModel(root, 'Chest', bridge)
    reparentInModel(root, 'Chest', sash)
    reparentInModel(root, 'Figure', robe)

    return root
}

const _reparentMatrix = new Matrix4()

/**
 * Move `child` (a descendant of `root`) under the named node while preserving its
 * current world transform within the model. The model is at the origin during
 * construction, so `matrixWorld` is the model-space transform; expressing the
 * child relative to `node` keeps its rest pose pixel-identical while making it
 * ride that node's animation. Handles scaled parents (the troll's 1.85× figure)
 * automatically, so accessories keep their authored size.
 */
function reparentInModel(root: Object3D, nodeName: string, child: Object3D): void {
    const node = root.getObjectByName(nodeName)
    if (!node) return
    root.updateMatrixWorld(true)
    _reparentMatrix.copy(node.matrixWorld).invert().multiply(child.matrixWorld)
    child.removeFromParent()
    _reparentMatrix.decompose(child.position, child.quaternion, child.scale)
    node.add(child)
}

function shadowed(mesh: Mesh): Mesh {
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
}
