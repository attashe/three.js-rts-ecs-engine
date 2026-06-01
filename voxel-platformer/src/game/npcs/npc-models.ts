import {
    Group,
    Matrix4,
    Mesh,
    type MeshStandardMaterial,
    type Object3D,
} from 'three'
import {
    createMainCharacter,
    sharedBoxGeometry,
    sharedCylinderGeometry,
    sharedSphereGeometry,
    sharedMaterial,
} from '../assets'
import type { CharacterBeardKind, CharacterCloakKind } from '../character-appearance'
import { defaultNpcBeard, defaultNpcVariant, normalizeNpcVariant, type NpcModelKind, type NpcVariantKind } from './npc-types'

export interface NpcModelOptions {
    beard?: CharacterBeardKind
    variant?: NpcVariantKind
    cloak?: CharacterCloakKind
}

export function createNpcModel(kind: NpcModelKind, opts: NpcModelOptions = {}): Group {
    const variant = normalizeNpcVariant(kind, opts.variant ?? defaultNpcVariant(kind))
    const beard = opts.beard ?? defaultNpcBeard(kind, variant)
    switch (kind) {
        case 'player':
            return createPlayerNpcModel(beard, opts.cloak)
        case 'keeper':
            return createDwarfNpcModel(beard, opts.cloak)
        case 'keeper-arlen':
            return createKeeperArlenNpcModel(beard)
        case 'large-troll':
            return createLargeTrollModel(beard, variant)
    }
}

function createPlayerNpcModel(beard: CharacterBeardKind, cloak: CharacterCloakKind = 'default'): Group {
    const root = createMainCharacter({
        tunicColor: 0x2f5e8f,
        cloakColor: 0x7a2430,
        skinColor: 0xd8a06a,
        metalColor: 0xc8b56f,
        bootColor: 0x2b211d,
        beard,
        cloak,
    })
    root.name = 'NpcModel:player'
    return root
}

function createDwarfNpcModel(beard: CharacterBeardKind, cloak: CharacterCloakKind = 'default'): Group {
    const root = createMainCharacter({
        tunicColor: 0x1f2c3f,
        cloakColor: 0x3f2818,
        skinColor: 0xc89461,
        metalColor: 0xffc462,
        bootColor: 0x17120d,
        beard,
        beardColor: 0xb6b09a,
        cloak,
    })
    root.name = 'NpcModel:keeper'

    // The staff + lantern are now configured as an NPC hand item.
    return root
}

function createKeeperArlenNpcModel(beard: CharacterBeardKind): Group {
    const root = new Group()
    root.name = 'NpcModel:keeper-arlen'

    const robe = sharedMaterial(0x111827, 0.8)
    const robeShade = sharedMaterial(0x0b1020, 0.86)
    const trim = sharedMaterial(0xb8822b, 0.56, 0.08)
    const skin = sharedMaterial(0xc58e62, 0.82)
    const beardMat = sharedMaterial(0xb8b19d, 0.86)
    const leather = sharedMaterial(0x17120d, 0.74)

    const figure = new Group()
    figure.name = 'Figure'
    root.add(figure)

    figure.add(
        keeperLegPivot('LegL', -0.09, leather),
        keeperLegPivot('LegR', 0.09, leather),
    )

    const longRobe = shadowed(new Mesh(sharedCylinderGeometry(0.27, 0.39, 1.02, 8), robe))
    longRobe.name = 'KeeperArlenLongRobe'
    longRobe.position.set(0, 0.57, 0)
    longRobe.scale.set(0.96, 1, 0.78)
    figure.add(longRobe)

    const robeHem = shadowed(new Mesh(sharedCylinderGeometry(0.38, 0.41, 0.075, 8), robeShade))
    robeHem.name = 'KeeperArlenRobeHem'
    robeHem.position.set(0, 0.095, 0)
    robeHem.scale.z = 0.82
    figure.add(robeHem)

    const frontPanel = shadowed(new Mesh(sharedBoxGeometry(0.18, 0.74, 0.045), sharedMaterial(0x1d2a3d, 0.76)))
    frontPanel.name = 'KeeperArlenFrontPanel'
    frontPanel.position.set(0, 0.57, 0.31)
    figure.add(frontPanel)

    const trimL = shadowed(new Mesh(sharedBoxGeometry(0.036, 0.78, 0.048), trim))
    trimL.name = 'KeeperArlenTrimL'
    trimL.position.set(-0.095, 0.57, 0.335)
    const trimR = shadowed(new Mesh(sharedBoxGeometry(0.036, 0.78, 0.048), trim))
    trimR.name = 'KeeperArlenTrimR'
    trimR.position.set(0.095, 0.57, 0.335)
    figure.add(trimL, trimR)

    const chest = new Group()
    chest.name = 'Chest'
    chest.position.y = 0.7
    figure.add(chest)
    const cy = (worldY: number): number => worldY - 0.7

    const shoulderWrap = shadowed(new Mesh(sharedCylinderGeometry(0.35, 0.28, 0.16, 8), sharedMaterial(0x3b2117, 0.78)))
    shoulderWrap.name = 'KeeperArlenShoulderWrap'
    shoulderWrap.position.set(0, cy(1.12), -0.02)
    shoulderWrap.scale.z = 0.68
    chest.add(shoulderWrap)

    const brooch = shadowed(new Mesh(sharedSphereGeometry(0.052, 8, 6), sharedMaterial(0xf0c35b, 0.34, 0.34)))
    brooch.name = 'KeeperArlenBrooch'
    brooch.position.set(0, cy(1.06), 0.31)
    brooch.scale.set(1, 0.7, 0.42)
    chest.add(brooch)

    chest.add(
        keeperArmPivot('UpperArmL', -1, robe, skin, trim),
        keeperArmPivot('UpperArmR', 1, robe, skin, trim),
    )

    const head = new Group()
    head.name = 'Head'
    head.position.set(0, cy(1.36), 0.04)
    chest.add(head)

    const hood = shadowed(new Mesh(
        sharedSphereGeometry(0.235, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.76),
        robe,
    ))
    hood.name = 'KeeperArlenHood'
    hood.position.set(0, 0.04, -0.005)
    hood.rotation.x = -0.16
    hood.scale.set(1.06, 1.04, 1.02)
    head.add(hood)

    const hoodBack = shadowed(new Mesh(sharedBoxGeometry(0.32, 0.3, 0.12), robeShade))
    hoodBack.name = 'KeeperArlenHoodBack'
    hoodBack.position.set(0, -0.09, -0.17)
    hoodBack.rotation.x = -0.12
    head.add(hoodBack)

    const brow = shadowed(new Mesh(sharedBoxGeometry(0.34, 0.055, 0.06), robeShade))
    brow.name = 'KeeperArlenHoodBrow'
    brow.position.set(0, 0.06, 0.18)
    head.add(brow)

    const face = shadowed(new Mesh(sharedBoxGeometry(0.18, 0.17, 0.055), skin))
    face.name = 'KeeperArlenFace'
    face.position.set(0, -0.02, 0.2)
    head.add(face)

    addKeeperArlenBeard(head, beard, beardMat)

    const lensMat = sharedMaterial(0x9fd7d3, 0.28, 0.04, 0.58)
    const leftLens = shadowed(new Mesh(sharedSphereGeometry(0.052, 10, 6), lensMat))
    leftLens.name = 'KeeperArlenLeftLens'
    leftLens.position.set(-0.073, 0.005, 0.23)
    leftLens.scale.set(1.24, 0.72, 0.18)
    const rightLens = shadowed(new Mesh(sharedSphereGeometry(0.052, 10, 6), lensMat))
    rightLens.name = 'KeeperArlenRightLens'
    rightLens.position.set(0.073, 0.005, 0.23)
    rightLens.scale.set(1.24, 0.72, 0.18)
    const bridge = shadowed(new Mesh(sharedBoxGeometry(0.058, 0.016, 0.024), trim))
    bridge.name = 'KeeperArlenGlassesBridge'
    bridge.position.set(0, 0.005, 0.25)
    head.add(leftLens, rightLens, bridge)

    head.add(keeperSocket('socket_head', 0, 0.23, 0.02))
    chest.add(keeperSocket('socket_back', 0, cy(1.08), -0.22))

    return root
}

function keeperLegPivot(name: 'LegL' | 'LegR', x: number, mat: MeshStandardMaterial): Group {
    const pivot = new Group()
    pivot.name = name
    pivot.position.set(x, 0.46, 0.02)
    const foot = shadowed(new Mesh(sharedBoxGeometry(0.12, 0.055, 0.16), mat))
    foot.name = name === 'LegL' ? 'KeeperArlenFootL' : 'KeeperArlenFootR'
    foot.position.set(0, -0.43, 0.08)
    pivot.add(foot)
    return pivot
}

function keeperArmPivot(
    name: 'UpperArmL' | 'UpperArmR',
    side: -1 | 1,
    robe: MeshStandardMaterial,
    skin: MeshStandardMaterial,
    trim: MeshStandardMaterial,
): Group {
    const pivot = new Group()
    pivot.name = name
    pivot.position.set(side * 0.28, 1.1 - 0.7, 0.08)

    const suffix = side < 0 ? 'L' : 'R'
    const sleeve = shadowed(new Mesh(sharedCylinderGeometry(0.058, 0.072, 0.32, 6), robe))
    sleeve.name = `KeeperArlenSleeve${suffix}`
    sleeve.position.set(side * 0.015, -0.14, 0.025)
    sleeve.rotation.set(0.08, 0, side * -0.16)

    const cuff = shadowed(new Mesh(sharedBoxGeometry(0.12, 0.05, 0.11), trim))
    cuff.name = `KeeperArlenCuff${suffix}`
    cuff.position.set(side * 0.04, -0.27, 0.065)
    cuff.rotation.z = side * -0.08

    const hand = shadowed(new Mesh(sharedBoxGeometry(0.072, 0.065, 0.072), skin))
    hand.name = `KeeperArlenHand${suffix}`
    hand.position.set(side * 0.045, -0.32, 0.09)

    pivot.add(sleeve, cuff, hand, keeperSocket(side < 0 ? 'socket_hand_L' : 'socket_hand_R', side * 0.045, -0.34, 0.095))
    return pivot
}

function addKeeperArlenBeard(head: Group, kind: CharacterBeardKind, mat: MeshStandardMaterial): void {
    if (kind === 'none') return

    const moustacheL = shadowed(new Mesh(sharedBoxGeometry(0.08, 0.03, 0.028), mat))
    moustacheL.name = 'CharacterMoustacheL'
    moustacheL.position.set(-0.045, -0.07, 0.235)
    moustacheL.rotation.z = -0.08

    const moustacheR = shadowed(new Mesh(sharedBoxGeometry(0.08, 0.03, 0.028), mat))
    moustacheR.name = 'CharacterMoustacheR'
    moustacheR.position.set(0.045, -0.07, 0.235)
    moustacheR.rotation.z = 0.08

    head.add(moustacheL, moustacheR)

    if (kind === 'short') {
        const chin = shadowed(new Mesh(sharedBoxGeometry(0.16, 0.09, 0.052), mat))
        chin.name = 'CharacterBeardShort'
        chin.position.set(0, -0.14, 0.225)
        head.add(chin)
        return
    }

    if (kind === 'full') {
        const chin = shadowed(new Mesh(sharedBoxGeometry(0.18, 0.18, 0.06), mat))
        chin.name = 'CharacterBeardFull'
        chin.position.set(0, -0.17, 0.22)
        const left = shadowed(new Mesh(sharedBoxGeometry(0.055, 0.13, 0.045), mat))
        left.name = 'CharacterBeardSideL'
        left.position.set(-0.105, -0.13, 0.205)
        const right = shadowed(new Mesh(sharedBoxGeometry(0.055, 0.13, 0.045), mat))
        right.name = 'CharacterBeardSideR'
        right.position.set(0.105, -0.13, 0.205)
        head.add(chin, left, right)
        return
    }

    const point = shadowed(new Mesh(sharedBoxGeometry(0.13, 0.22, 0.055), mat))
    point.name = 'CharacterBeardPointed'
    point.position.set(0, -0.19, 0.215)
    point.rotation.z = Math.PI * 0.25
    head.add(point)
}

function keeperSocket(name: string, x: number, y: number, z: number): Group {
    const socket = new Group()
    socket.name = name
    socket.position.set(x, y, z)
    return socket
}

function createLargeTrollModel(beard: CharacterBeardKind, variant: NpcVariantKind): Group {
    const root = new Group()
    const trollVariant = normalizeNpcVariant('large-troll', variant)
    root.name = 'NpcModel:large-troll'

    const figure = createMainCharacter({
        tunicColor: trollVariant === 'guardian' ? 0x262e32 : 0x394b4f,
        cloakColor: 0x4f2430,
        skinColor: 0x6f8d6b,
        metalColor: trollVariant === 'guardian' ? 0x9ea9b0 : 0xd2b45f,
        bootColor: 0x251f19,
        beard,
        beardColor: trollVariant === 'guardian' ? 0x8f9696 : 0x47553c,
        cloak: trollVariant === 'guardian' ? 'none' : 'default',
    })
    figure.name = 'LargeTrollFigure'
    figure.scale.setScalar(1.85)
    root.add(figure)

    if (trollVariant === 'guardian') addGuardianTrollDetails(root)
    else addWiseTrollDetails(root)

    return root
}

function addWiseTrollDetails(root: Group): void {
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
}

function addGuardianTrollDetails(root: Group): void {
    const armor = sharedMaterial(0x6f7880, 0.38, 0.48)
    const darkIron = sharedMaterial(0x333a42, 0.42, 0.52)
    const brass = sharedMaterial(0xc79a3c, 0.42, 0.28)
    const leather = sharedMaterial(0x2b1d12, 0.78)

    const breast = shadowed(new Mesh(sharedBoxGeometry(0.74, 0.52, 0.12), armor))
    breast.name = 'LargeTrollGuardianBreastplate'
    breast.position.set(0, 1.45, 0.5)
    breast.rotation.x = -0.04

    const belly = shadowed(new Mesh(sharedBoxGeometry(0.68, 0.26, 0.1), darkIron))
    belly.name = 'LargeTrollGuardianBellyPlate'
    belly.position.set(0, 1.1, 0.48)

    const belt = shadowed(new Mesh(sharedBoxGeometry(0.9, 0.12, 0.12), leather))
    belt.name = 'LargeTrollGuardianBelt'
    belt.position.set(0, 0.9, 0.46)

    const buckle = shadowed(new Mesh(sharedBoxGeometry(0.18, 0.14, 0.05), brass))
    buckle.name = 'LargeTrollGuardianBuckle'
    buckle.position.set(0, 0.9, 0.54)

    const shoulderL = shadowed(new Mesh(sharedSphereGeometry(0.18, 10, 7), darkIron))
    shoulderL.name = 'LargeTrollGuardianShoulderL'
    shoulderL.position.set(-0.58, 1.75, 0.12)
    shoulderL.scale.set(1.45, 0.55, 0.9)
    const shoulderR = shadowed(new Mesh(sharedSphereGeometry(0.18, 10, 7), darkIron))
    shoulderR.name = 'LargeTrollGuardianShoulderR'
    shoulderR.position.set(0.58, 1.75, 0.12)
    shoulderR.scale.set(1.45, 0.55, 0.9)

    const brow = shadowed(new Mesh(sharedBoxGeometry(0.6, 0.1, 0.13), sharedMaterial(0x42573e, 0.78)))
    brow.name = 'LargeTrollGuardianHeavyBrow'
    brow.position.set(0, 2.67, 0.31)

    const helm = shadowed(new Mesh(sharedCylinderGeometry(0.34, 0.31, 0.18, 10), darkIron))
    helm.name = 'LargeTrollGuardianHelm'
    helm.position.set(0, 2.82, 0)
    helm.scale.z = 0.82

    const crest = shadowed(new Mesh(sharedBoxGeometry(0.09, 0.36, 0.4), sharedMaterial(0x9f2f2f, 0.72)))
    crest.name = 'LargeTrollGuardianCrest'
    crest.position.set(0, 2.98, 0.02)
    crest.rotation.x = -0.12

    for (const part of [breast, belly, belt, buckle, shoulderL, shoulderR, brow, helm, crest]) {
        root.add(part)
        reparentInModel(root, part.name.includes('Shoulder') ? (part.name.endsWith('L') ? 'UpperArmL' : 'UpperArmR') : 'Chest', part)
    }
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
