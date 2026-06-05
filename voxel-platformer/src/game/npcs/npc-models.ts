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
        case 'rabbit':
            return createRabbitNpcModel()
        case 'spider':
            return createSpiderNpcModel()
        case 'archer':
            return createArcherNpcModel(beard)
        case 'shield-warrior':
            return createShieldWarriorNpcModel(beard)
        case 'shield-spearman':
            return createShieldSpearmanNpcModel(beard)
    }
}

/**
 * NPC models that DON'T use the shared humanoid rig + `partCharacterClips` +
 * `combatLocomotionGraph`. The render system builds these as plain Groups and
 * drives them with a bespoke animator (see `npc-critter-animator`) instead of
 * an `AnimationController`. Quadrupeds and other non-humanoids opt out here.
 */
const NPC_MODELS_WITHOUT_DEFAULT_RIG: ReadonlySet<NpcModelKind> = new Set<NpcModelKind>(['rabbit', 'spider'])

export function npcModelUsesDefaultRig(kind: NpcModelKind): boolean {
    return !NPC_MODELS_WITHOUT_DEFAULT_RIG.has(kind)
}

/**
 * A real quadruped rabbit — NOT on the humanoid rig. Everything that hops lives
 * under `RabbitBob`; the head, ears (`RabbitEarL/R`) and hind legs
 * (`RabbitHindL/R`) are named groups the critter animator swings for a hop +
 * idle twitch. Authored small (~0.4 units tall) so a `scale` of ~1.2 reads as
 * prey from iso distance.
 */
function createRabbitNpcModel(): Group {
    const root = new Group()
    root.name = 'NpcModel:rabbit'

    const fur = sharedMaterial(0xb7aa96, 0.88)
    const cream = sharedMaterial(0xe1d6c4, 0.8)
    const dark = sharedMaterial(0x241b18, 0.6)
    const pink = sharedMaterial(0xd28d8d, 0.7)

    const bob = new Group()
    bob.name = 'RabbitBob'
    root.add(bob)

    const body = shadowed(new Mesh(sharedSphereGeometry(0.15, 10, 8), fur))
    body.name = 'RabbitBody'
    body.position.set(0, 0.16, -0.02)
    body.scale.set(1, 0.92, 1.32) // long egg along forward (+Z)
    const belly = shadowed(new Mesh(sharedSphereGeometry(0.115, 10, 8), cream))
    belly.name = 'RabbitBelly'
    belly.position.set(0, 0.12, 0.05)
    belly.scale.set(0.86, 0.7, 1.05)
    bob.add(body, belly)

    const head = new Group()
    head.name = 'RabbitHead'
    head.position.set(0, 0.24, 0.18)
    const skull = shadowed(new Mesh(sharedSphereGeometry(0.105, 10, 8), fur))
    skull.name = 'RabbitSkull'
    const snout = shadowed(new Mesh(sharedSphereGeometry(0.06, 8, 6), cream))
    snout.name = 'RabbitSnout'
    snout.position.set(0, -0.02, 0.08)
    snout.scale.set(0.82, 0.7, 0.95)
    const nose = shadowed(new Mesh(sharedSphereGeometry(0.018, 6, 5), pink))
    nose.name = 'RabbitNose'
    nose.position.set(0, -0.01, 0.14)
    const eyeL = shadowed(new Mesh(sharedSphereGeometry(0.022, 6, 5), dark))
    eyeL.name = 'RabbitEyeL'
    eyeL.position.set(-0.06, 0.02, 0.07)
    const eyeR = shadowed(new Mesh(sharedSphereGeometry(0.022, 6, 5), dark))
    eyeR.name = 'RabbitEyeR'
    eyeR.position.set(0.06, 0.02, 0.07)
    head.add(skull, snout, nose, eyeL, eyeR, rabbitEar('RabbitEarL', -0.05), rabbitEar('RabbitEarR', 0.05))
    bob.add(head)

    const tail = shadowed(new Mesh(sharedSphereGeometry(0.058, 8, 6), cream))
    tail.name = 'RabbitTail'
    tail.position.set(0, 0.17, -0.21)
    bob.add(tail)

    const foreL = shadowed(new Mesh(sharedBoxGeometry(0.05, 0.1, 0.07), fur))
    foreL.name = 'RabbitForeL'
    foreL.position.set(-0.07, 0.05, 0.13)
    const foreR = shadowed(new Mesh(sharedBoxGeometry(0.05, 0.1, 0.07), fur))
    foreR.name = 'RabbitForeR'
    foreR.position.set(0.07, 0.05, 0.13)
    bob.add(foreL, foreR, rabbitHindLeg('RabbitHindL', -0.1), rabbitHindLeg('RabbitHindR', 0.1))

    return root
}

function rabbitEar(name: string, x: number): Group {
    const pivot = new Group()
    pivot.name = name
    pivot.position.set(x, 0.09, -0.01)
    const ear = shadowed(new Mesh(sharedCylinderGeometry(0.012, 0.04, 0.2, 6), sharedMaterial(0xb7aa96, 0.88)))
    ear.position.set(0, 0.1, 0)
    ear.rotation.x = -0.12
    pivot.add(ear)
    return pivot
}

function rabbitHindLeg(name: string, x: number): Group {
    const pivot = new Group()
    pivot.name = name
    pivot.position.set(x, 0.12, -0.05)
    const thigh = shadowed(new Mesh(sharedBoxGeometry(0.07, 0.1, 0.17), sharedMaterial(0xb7aa96, 0.88)))
    thigh.position.set(0, -0.04, -0.04)
    pivot.add(thigh)
    return pivot
}

/**
 * Low cave spider: broad abdomen, low body, and eight readable leg pivots.
 * Authored around a ~0.55u footprint so `scale: 1` is threatening without
 * becoming a collision wall in narrow mine tunnels.
 */
function createSpiderNpcModel(): Group {
    const root = new Group()
    root.name = 'NpcModel:spider'

    const shell = sharedMaterial(0x1b1820, 0.62, 0.18)
    const belly = sharedMaterial(0x2f2437, 0.56, 0.1)
    const eyeMat = sharedMaterial(0xce354f, 0.5, 0.2)
    const fangMat = sharedMaterial(0xd8d0b8, 0.64, 0.1)

    const bob = new Group()
    bob.name = 'SpiderBob'
    root.add(bob)

    const abdomen = shadowed(new Mesh(sharedSphereGeometry(0.17, 10, 8), shell))
    abdomen.name = 'SpiderAbdomen'
    abdomen.position.set(0, 0.18, -0.1)
    abdomen.scale.set(1.3, 0.7, 1.55)
    const thorax = shadowed(new Mesh(sharedSphereGeometry(0.14, 10, 8), belly))
    thorax.name = 'SpiderThorax'
    thorax.position.set(0, 0.17, 0.11)
    thorax.scale.set(1.18, 0.62, 1.0)
    const head = shadowed(new Mesh(sharedSphereGeometry(0.095, 8, 6), shell))
    head.name = 'SpiderHead'
    head.position.set(0, 0.17, 0.26)
    head.scale.set(1.05, 0.66, 0.82)
    bob.add(abdomen, thorax, head)

    for (const x of [-0.046, 0.046]) {
        const eye = shadowed(new Mesh(sharedSphereGeometry(0.018, 6, 5), eyeMat))
        eye.name = x < 0 ? 'SpiderEyeL' : 'SpiderEyeR'
        eye.position.set(x, 0.205, 0.315)
        bob.add(eye)
    }
    for (const x of [-0.032, 0.032]) {
        const fang = shadowed(new Mesh(sharedBoxGeometry(0.018, 0.055, 0.014), fangMat))
        fang.name = x < 0 ? 'SpiderFangL' : 'SpiderFangR'
        fang.position.set(x, 0.115, 0.325)
        fang.rotation.x = 0.18
        bob.add(fang)
    }

    const legZ = [0.18, 0.08, -0.04, -0.15]
    for (let i = 0; i < legZ.length; i += 1) {
        bob.add(spiderLeg(`SpiderLegL${i + 1}`, -1, legZ[i]!, i))
        bob.add(spiderLeg(`SpiderLegR${i + 1}`, 1, legZ[i]!, i))
    }

    return root
}

function spiderLeg(name: string, side: -1 | 1, z: number, index: number): Group {
    const pivot = new Group()
    pivot.name = name
    pivot.position.set(side * 0.09, 0.15, z)
    pivot.rotation.y = side * (0.7 + index * 0.13)
    const leg = shadowed(new Mesh(sharedBoxGeometry(0.23, 0.028, 0.035), sharedMaterial(0x151219, 0.64, 0.16)))
    leg.name = `${name}Segment`
    leg.position.set(side * 0.11, -0.02, 0)
    leg.rotation.z = side * -0.28
    pivot.add(leg)
    return pivot
}

/**
 * A lean ranger humanoid. The bow + nocked arrow are NPC hand equipment
 * (`handL: 'bow'`), so the model itself is just the ranger silhouette; the
 * shared `shoot` clip animates the draw.
 */
function createArcherNpcModel(beard: CharacterBeardKind): Group {
    const root = createMainCharacter({
        tunicColor: 0x2f4a25,
        cloakColor: 0x3b2a18,
        skinColor: 0xd8a06a,
        metalColor: 0x8b7355,
        bootColor: 0x1a1410,
        beard,
        beardColor: 0x4a3a28,
        cloak: 'default',
    })
    root.name = 'NpcModel:archer'

    // Back quiver — a leather tube with arrow fletchings, riding the chest.
    const quiver = shadowed(new Mesh(sharedCylinderGeometry(0.06, 0.07, 0.34, 8), sharedMaterial(0x4a3524, 0.82)))
    quiver.name = 'ArcherQuiver'
    quiver.position.set(-0.16, 1.18, -0.18)
    quiver.rotation.set(0.2, 0, 0.42)
    const fletch = shadowed(new Mesh(sharedBoxGeometry(0.05, 0.12, 0.05), sharedMaterial(0xcdd2d6, 0.7)))
    fletch.name = 'ArcherQuiverFletch'
    fletch.position.set(-0.22, 1.34, -0.18)
    fletch.rotation.z = 0.42
    root.add(quiver, fletch)
    for (const part of [quiver, fletch]) reparentInModel(root, 'Chest', part)

    return root
}

/**
 * An armoured frontline humanoid. Sword + shield are NPC hand equipment
 * (`handR: 'sword', handL: 'shield'`); the steel cuirass + plumed helm here
 * give it the tank silhouette. Uses the shared melee `attack` clip.
 */
function createShieldWarriorNpcModel(beard: CharacterBeardKind): Group {
    const root = createMainCharacter({
        tunicColor: 0x355d8a,
        cloakColor: 0x2b2f36,
        skinColor: 0xc88758,
        metalColor: 0x9aa4aa,
        bootColor: 0x1a1410,
        beard,
        beardColor: 0x4a3a30,
        cloak: 'none',
    })
    root.name = 'NpcModel:shield-warrior'

    const steel = sharedMaterial(0x9aa4aa, 0.42, 0.22)
    const accent = sharedMaterial(0xd5a24a, 0.5, 0.1)

    const cuirass = shadowed(new Mesh(sharedBoxGeometry(0.4, 0.42, 0.26), steel))
    cuirass.name = 'ShieldWarriorCuirass'
    cuirass.position.set(0, 1.12, 0.02)
    const helm = shadowed(new Mesh(sharedCylinderGeometry(0.2, 0.18, 0.16, 10), steel))
    helm.name = 'ShieldWarriorHelm'
    helm.position.set(0, 1.62, 0)
    const crest = shadowed(new Mesh(sharedBoxGeometry(0.05, 0.14, 0.22), accent))
    crest.name = 'ShieldWarriorCrest'
    crest.position.set(0, 1.74, 0)
    root.add(cuirass, helm, crest)
    for (const part of [cuirass, helm, crest]) reparentInModel(root, 'Chest', part)

    return root
}

/**
 * Defensive spear guard. Spear + shield are hand equipment
 * (`handR: 'spear', handL: 'shield'`); the model adds a compact mail coat and
 * visor so it reads as a cautious blocker distinct from the sword warrior.
 */
function createShieldSpearmanNpcModel(beard: CharacterBeardKind): Group {
    const root = createMainCharacter({
        tunicColor: 0x496747,
        cloakColor: 0x273528,
        skinColor: 0xc88758,
        metalColor: 0x9aa4aa,
        bootColor: 0x1b1710,
        beard,
        beardColor: 0x564333,
        cloak: 'none',
    })
    root.name = 'NpcModel:shield-spearman'

    const mail = sharedMaterial(0x6f7d80, 0.46, 0.18)
    const dark = sharedMaterial(0x273037, 0.54, 0.16)
    const accent = sharedMaterial(0x9fc5a0, 0.62, 0.04)

    const brigandine = shadowed(new Mesh(sharedBoxGeometry(0.36, 0.46, 0.24), mail))
    brigandine.name = 'ShieldSpearmanBrigandine'
    brigandine.position.set(0, 1.1, 0.02)
    const skirt = shadowed(new Mesh(sharedCylinderGeometry(0.24, 0.3, 0.18, 8), dark))
    skirt.name = 'ShieldSpearmanMailSkirt'
    skirt.position.set(0, 0.82, 0)
    skirt.scale.z = 0.78
    const helm = shadowed(new Mesh(sharedCylinderGeometry(0.19, 0.17, 0.15, 10), mail))
    helm.name = 'ShieldSpearmanHelm'
    helm.position.set(0, 1.62, 0)
    const visor = shadowed(new Mesh(sharedBoxGeometry(0.26, 0.045, 0.055), dark))
    visor.name = 'ShieldSpearmanVisor'
    visor.position.set(0, 1.59, 0.18)
    const plume = shadowed(new Mesh(sharedBoxGeometry(0.045, 0.18, 0.1), accent))
    plume.name = 'ShieldSpearmanPlume'
    plume.position.set(0, 1.76, -0.015)
    root.add(brigandine, skirt, helm, visor, plume)
    for (const part of [brigandine, helm, visor, plume]) reparentInModel(root, 'Chest', part)
    reparentInModel(root, 'Figure', skirt)

    return root
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
    const colors = largeTrollColors(trollVariant)
    root.name = 'NpcModel:large-troll'

    const figure = createMainCharacter({
        tunicColor: colors.tunic,
        cloakColor: colors.cloak,
        skinColor: 0x6f8d6b,
        metalColor: colors.metal,
        bootColor: 0x251f19,
        beard,
        beardColor: colors.beard,
        cloak: colors.cloakKind,
    })
    figure.name = 'LargeTrollFigure'
    figure.scale.setScalar(trollVariant === 'child' ? 1.28 : 1.85)
    root.add(figure)

    switch (trollVariant) {
        case 'guardian':
            addGuardianTrollDetails(root)
            break
        case 'king':
            addKingTrollDetails(root)
            break
        case 'princess':
            addPrincessTrollDetails(root)
            break
        case 'trader':
            addTraderTrollDetails(root)
            break
        case 'child':
            addChildTrollDetails(root)
            break
        case 'wise':
        case 'default':
            addWiseTrollDetails(root)
            break
    }

    return root
}

interface LargeTrollColors {
    tunic: number
    cloak: number
    metal: number
    beard: number
    cloakKind: CharacterCloakKind
}

function largeTrollColors(variant: NpcVariantKind): LargeTrollColors {
    switch (variant) {
        case 'guardian':
            return { tunic: 0x262e32, cloak: 0x4f2430, metal: 0x9ea9b0, beard: 0x8f9696, cloakKind: 'none' }
        case 'king':
            return { tunic: 0x42203d, cloak: 0x6f1f38, metal: 0xf0c967, beard: 0x68523a, cloakKind: 'default' }
        case 'princess':
            return { tunic: 0x674875, cloak: 0x294566, metal: 0xf1d98b, beard: 0x47553c, cloakKind: 'default' }
        case 'trader':
            return { tunic: 0x4f432f, cloak: 0x2f3e33, metal: 0xc8913c, beard: 0x5d4a35, cloakKind: 'none' }
        case 'child':
            return { tunic: 0x4d7a67, cloak: 0x4f2430, metal: 0xd2b45f, beard: 0x47553c, cloakKind: 'none' }
        case 'wise':
        case 'default':
            return { tunic: 0x394b4f, cloak: 0x4f2430, metal: 0xd2b45f, beard: 0x47553c, cloakKind: 'default' }
    }
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

function addKingTrollDetails(root: Group): void {
    const gold = sharedMaterial(0xf0c967, 0.34, 0.42)
    const royal = sharedMaterial(0x6f1f38, 0.7, 0.04)
    const velvet = sharedMaterial(0x27152d, 0.82)
    const gem = sharedMaterial(0x5ec2ff, 0.3, 0.18, 0.45)

    const crown = shadowed(new Mesh(sharedCylinderGeometry(0.35, 0.32, 0.13, 10), gold))
    crown.name = 'LargeTrollKingCrown'
    crown.position.set(0, 2.86, 0.02)
    crown.scale.z = 0.82

    const crownFront = shadowed(new Mesh(sharedBoxGeometry(0.17, 0.2, 0.045), gold))
    crownFront.name = 'LargeTrollKingCrownFront'
    crownFront.position.set(0, 2.98, 0.28)
    const crownL = shadowed(new Mesh(sharedBoxGeometry(0.12, 0.17, 0.04), gold))
    crownL.name = 'LargeTrollKingCrownL'
    crownL.position.set(-0.19, 2.95, 0.18)
    crownL.rotation.z = -0.18
    const crownR = shadowed(new Mesh(sharedBoxGeometry(0.12, 0.17, 0.04), gold))
    crownR.name = 'LargeTrollKingCrownR'
    crownR.position.set(0.19, 2.95, 0.18)
    crownR.rotation.z = 0.18

    const jewel = shadowed(new Mesh(sharedSphereGeometry(0.055, 8, 6), gem))
    jewel.name = 'LargeTrollKingCrownJewel'
    jewel.position.set(0, 2.92, 0.34)
    jewel.scale.set(1, 0.78, 0.42)

    const mantle = shadowed(new Mesh(sharedCylinderGeometry(0.62, 0.48, 0.22, 8), royal))
    mantle.name = 'LargeTrollKingMantle'
    mantle.position.set(0, 1.72, 0.02)
    mantle.scale.z = 0.78

    const frontPanel = shadowed(new Mesh(sharedBoxGeometry(0.28, 0.78, 0.08), velvet))
    frontPanel.name = 'LargeTrollKingFrontPanel'
    frontPanel.position.set(0, 1.24, 0.5)

    const medallion = shadowed(new Mesh(sharedSphereGeometry(0.09, 10, 6), gold))
    medallion.name = 'LargeTrollKingMedallion'
    medallion.position.set(0, 1.53, 0.56)
    medallion.scale.set(1, 0.82, 0.35)

    for (const part of [crown, crownFront, crownL, crownR, jewel, mantle, frontPanel, medallion]) {
        root.add(part)
        reparentInModel(root, 'Chest', part)
    }
}

function addPrincessTrollDetails(root: Group): void {
    const silver = sharedMaterial(0xe6d7a2, 0.32, 0.36)
    const dress = sharedMaterial(0x7a4b83, 0.76)
    const sashMat = sharedMaterial(0xd6a7cb, 0.62, 0.04)
    const gem = sharedMaterial(0xff9fd1, 0.28, 0.12, 0.5)

    const tiaraBand = shadowed(new Mesh(sharedBoxGeometry(0.46, 0.06, 0.06), silver))
    tiaraBand.name = 'LargeTrollPrincessTiaraBand'
    tiaraBand.position.set(0, 2.82, 0.28)
    tiaraBand.rotation.x = -0.08

    const tiaraPeak = shadowed(new Mesh(sharedBoxGeometry(0.1, 0.22, 0.045), silver))
    tiaraPeak.name = 'LargeTrollPrincessTiaraPeak'
    tiaraPeak.position.set(0, 2.93, 0.29)
    const tiaraGem = shadowed(new Mesh(sharedSphereGeometry(0.048, 8, 6), gem))
    tiaraGem.name = 'LargeTrollPrincessTiaraGem'
    tiaraGem.position.set(0, 2.88, 0.34)
    tiaraGem.scale.set(1, 0.76, 0.38)

    const skirt = shadowed(new Mesh(sharedCylinderGeometry(0.66, 0.42, 0.28, 8), dress))
    skirt.name = 'LargeTrollPrincessSkirtHem'
    skirt.position.set(0, 0.55, 0.02)
    skirt.scale.z = 0.78

    const sash = shadowed(new Mesh(sharedBoxGeometry(0.74, 0.09, 0.08), sashMat))
    sash.name = 'LargeTrollPrincessSash'
    sash.position.set(0, 1.24, 0.5)
    sash.rotation.z = -0.26

    const necklace = shadowed(new Mesh(sharedBoxGeometry(0.34, 0.045, 0.055), silver))
    necklace.name = 'LargeTrollPrincessNecklace'
    necklace.position.set(0, 1.58, 0.48)
    const pendant = shadowed(new Mesh(sharedSphereGeometry(0.052, 8, 6), gem))
    pendant.name = 'LargeTrollPrincessPendant'
    pendant.position.set(0, 1.51, 0.53)
    pendant.scale.set(1, 0.8, 0.35)

    for (const part of [tiaraBand, tiaraPeak, tiaraGem, skirt, sash, necklace, pendant]) {
        root.add(part)
        reparentInModel(root, part.name.includes('Tiara') ? 'Chest' : part.name.includes('Skirt') ? 'Figure' : 'Chest', part)
    }
}

function addTraderTrollDetails(root: Group): void {
    const leather = sharedMaterial(0x3b2415, 0.78)
    const cloth = sharedMaterial(0x8a6a3b, 0.72)
    const brass = sharedMaterial(0xc8913c, 0.44, 0.2)
    const canvas = sharedMaterial(0x6c5940, 0.84)

    const apron = shadowed(new Mesh(sharedBoxGeometry(0.52, 0.78, 0.08), cloth))
    apron.name = 'LargeTrollTraderApron'
    apron.position.set(0, 1.12, 0.5)

    const strapL = shadowed(new Mesh(sharedBoxGeometry(0.07, 0.82, 0.07), leather))
    strapL.name = 'LargeTrollTraderStrapL'
    strapL.position.set(-0.19, 1.37, 0.52)
    strapL.rotation.z = 0.18
    const strapR = shadowed(new Mesh(sharedBoxGeometry(0.07, 0.82, 0.07), leather))
    strapR.name = 'LargeTrollTraderStrapR'
    strapR.position.set(0.19, 1.37, 0.52)
    strapR.rotation.z = -0.18

    const pack = shadowed(new Mesh(sharedBoxGeometry(0.56, 0.62, 0.24), canvas))
    pack.name = 'LargeTrollTraderPack'
    pack.position.set(0, 1.38, -0.5)
    const bedroll = shadowed(new Mesh(sharedCylinderGeometry(0.16, 0.16, 0.55, 8), sharedMaterial(0x394b4f, 0.8)))
    bedroll.name = 'LargeTrollTraderBedroll'
    bedroll.position.set(0, 1.76, -0.58)
    bedroll.rotation.z = Math.PI * 0.5

    const belt = shadowed(new Mesh(sharedBoxGeometry(0.78, 0.1, 0.09), leather))
    belt.name = 'LargeTrollTraderBelt'
    belt.position.set(0, 0.88, 0.49)
    const buckle = shadowed(new Mesh(sharedBoxGeometry(0.15, 0.12, 0.05), brass))
    buckle.name = 'LargeTrollTraderBuckle'
    buckle.position.set(0, 0.88, 0.56)
    const pouch = shadowed(new Mesh(sharedBoxGeometry(0.18, 0.22, 0.12), leather))
    pouch.name = 'LargeTrollTraderCoinPouch'
    pouch.position.set(0.34, 0.78, 0.52)

    for (const part of [apron, strapL, strapR, pack, bedroll, belt, buckle, pouch]) {
        root.add(part)
        reparentInModel(root, 'Chest', part)
    }
}

function addChildTrollDetails(root: Group): void {
    const capMat = sharedMaterial(0x284a67, 0.78)
    const scarfMat = sharedMaterial(0xd48a36, 0.64)
    const patchMat = sharedMaterial(0xf0c967, 0.52, 0.08)
    const satchelMat = sharedMaterial(0x4a2d18, 0.78)

    const cap = shadowed(new Mesh(sharedCylinderGeometry(0.24, 0.22, 0.08, 10), capMat))
    cap.name = 'LargeTrollChildCap'
    cap.position.set(0, 1.94, 0.02)
    cap.scale.z = 0.82
    const brim = shadowed(new Mesh(sharedBoxGeometry(0.26, 0.045, 0.12), capMat))
    brim.name = 'LargeTrollChildCapBrim'
    brim.position.set(0, 1.9, 0.2)
    brim.rotation.x = -0.08

    const scarf = shadowed(new Mesh(sharedBoxGeometry(0.34, 0.08, 0.08), scarfMat))
    scarf.name = 'LargeTrollChildScarf'
    scarf.position.set(0, 1.12, 0.34)
    const scarfTail = shadowed(new Mesh(sharedBoxGeometry(0.09, 0.28, 0.06), scarfMat))
    scarfTail.name = 'LargeTrollChildScarfTail'
    scarfTail.position.set(0.16, 0.98, 0.35)
    scarfTail.rotation.z = -0.18

    const patch = shadowed(new Mesh(sharedBoxGeometry(0.18, 0.16, 0.05), patchMat))
    patch.name = 'LargeTrollChildTunicPatch'
    patch.position.set(-0.12, 0.9, 0.35)

    const satchel = shadowed(new Mesh(sharedBoxGeometry(0.22, 0.2, 0.12), satchelMat))
    satchel.name = 'LargeTrollChildSatchel'
    satchel.position.set(-0.34, 0.78, 0.12)

    for (const part of [cap, brim, scarf, scarfTail, patch, satchel]) {
        root.add(part)
        reparentInModel(root, 'Chest', part)
    }
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
