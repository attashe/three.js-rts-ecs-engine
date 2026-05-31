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
import type { CharacterBeardKind } from '../character-appearance'
import { defaultNpcBeard, type NpcModelKind } from './npc-types'

export interface NpcModelOptions {
    beard?: CharacterBeardKind
}

export function createNpcModel(kind: NpcModelKind, opts: NpcModelOptions = {}): Group {
    const beard = opts.beard ?? defaultNpcBeard(kind)
    switch (kind) {
        case 'player':
            return createPlayerNpcModel(beard)
        case 'keeper':
            return createKeeperNpcModel(beard)
        case 'large-troll':
            return createLargeTrollModel(beard)
    }
}

function createPlayerNpcModel(beard: CharacterBeardKind): Group {
    const root = createMainCharacter({
        tunicColor: 0x2f5e8f,
        cloakColor: 0x7a2430,
        skinColor: 0xd8a06a,
        metalColor: 0xc8b56f,
        bootColor: 0x2b211d,
        beard,
    })
    root.name = 'NpcModel:player'
    return root
}

function createKeeperNpcModel(beard: CharacterBeardKind): Group {
    const root = createMainCharacter({
        tunicColor: 0x1f2c3f,
        cloakColor: 0x3f2818,
        skinColor: 0xc89461,
        metalColor: 0xffc462,
        bootColor: 0x17120d,
        beard,
        beardColor: 0xb6b09a,
    })
    root.name = 'NpcModel:keeper'

    // The staff + lantern are now configured as an NPC hand item.
    return root
}

function createLargeTrollModel(beard: CharacterBeardKind): Group {
    const root = new Group()
    root.name = 'NpcModel:large-troll'

    const figure = createMainCharacter({
        tunicColor: 0x394b4f,
        cloakColor: 0x4f2430,
        skinColor: 0x6f8d6b,
        metalColor: 0xd2b45f,
        bootColor: 0x251f19,
        beard,
        beardColor: 0x47553c,
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

    // The book + pages are now configured as an NPC hand item.
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
