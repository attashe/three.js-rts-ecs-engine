import {
    Group,
    Mesh,
    MeshStandardMaterial,
} from 'three'
import {
    sharedBoxGeometry,
    sharedCapsuleGeometry,
    sharedConeGeometry,
    sharedCylinderGeometry,
    sharedMaterial,
    sharedSphereGeometry,
} from './shared-primitives'
import type { CharacterBeardKind } from '../character-appearance'

export const MAIN_CHARACTER_COLLIDER_RADIUS = 0.35
export const MAIN_CHARACTER_COLLIDER_HEIGHT = 1.6
export const MAIN_CHARACTER_COLLIDER_HALF_HEIGHT = MAIN_CHARACTER_COLLIDER_HEIGHT / 2

/**
 * The animated part rig is a small two-level skeleton so a clip that rotates one
 * node carries everything attached to it (the flat sibling layout used before
 * made the torso lean detach from the head, and made a believable fall
 * impossible). Hierarchy, all named so clips/sockets resolve by name:
 *
 *   root ("MainCharacter")              ← carries world yaw / position
 *   └─ Figure                           ← whole body; the `die` clip topples this
 *      ├─ LegL / LegR  (hip pivots)     ← walk/run swing the legs about the hip
 *      ├─ TunicHem / Belt / Buckle      ← static lower body
 *      └─ Chest        (waist pivot)    ← lean/twist/attack rotate the upper body
 *         ├─ Body / Head / Hair / Nose / pauldrons / cloak
 *         ├─ UpperArmL / UpperArmR (shoulder pivots, + hand sockets)
 *         └─ socket_head / socket_back
 *
 * Joint pivots sit at the anatomical joint so a clip rotating the pivot swings
 * the limb about it. Each limb mesh keeps a local offset (rest world position
 * unchanged) plus its rest lean (about its own centre), so the rest pose is
 * pixel-identical to the pre-animation model.
 */
export const MAIN_CHARACTER_JOINTS = {
    /** Waist pivot height (the Chest node's world Y at rest). */
    chestY: 0.7,
    shoulderY: 1.12,
    armX: 0.34,
    armZ: 0.01,
    armLean: 0.18,
    /** Arm mesh centre relative to the shoulder pivot. */
    armMeshY: -0.22,
    /** Hand socket relative to the shoulder pivot. */
    handY: -0.44,
    hipY: 0.46,
    legX: 0.11,
    legZ: 0.02,
    bootY: 0.16,
} as const

export interface MainCharacterOptions {
    tunicColor?: number
    cloakColor?: number
    skinColor?: number
    metalColor?: number
    bootColor?: number
    beard?: CharacterBeardKind
    beardColor?: number
}

const BODY_HEIGHT = 0.74
const BODY_RADIUS = 0.25
const HEAD_RADIUS = 0.18

function material(color: number, roughness = 0.7, metalness = 0): MeshStandardMaterial {
    return sharedMaterial(color, roughness, metalness)
}

function setShadow(mesh: Mesh): Mesh {
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
}

export function createMainCharacter(opts: MainCharacterOptions = {}): Group {
    const root = new Group()
    root.name = 'MainCharacter'

    const skin = material(opts.skinColor ?? 0xd8a06a, 0.82)
    const tunic = material(opts.tunicColor ?? 0x2f5e8f, 0.68)
    const cloak = material(opts.cloakColor ?? 0x7a2430, 0.78)
    const leather = material(opts.bootColor ?? 0x2b211d, 0.74)
    const metal = material(opts.metalColor ?? 0xc8b56f, 0.36, 0.25)
    const dark = material(0x151820, 0.72)
    const beard = material(opts.beardColor ?? 0x2c241f, 0.86)

    const J = MAIN_CHARACTER_JOINTS

    // Whole-body wrapper. Identity transform, so rest world transforms are
    // unchanged; the `die` clip rotates this about its base (the feet) to fall.
    const figure = new Group()
    figure.name = 'Figure'
    root.add(figure)

    // Legs hang from hip pivots on the figure (they don't follow the torso lean).
    figure.add(
        legPivot('LegL', -J.legX, leather),
        legPivot('LegR', J.legX, leather),
    )

    const hem = setShadow(new Mesh(sharedCylinderGeometry(0.3, 0.34, 0.18, 8), tunic))
    hem.name = 'TunicHem'
    hem.position.y = 0.44
    figure.add(hem)

    const belt = setShadow(new Mesh(sharedBoxGeometry(0.58, 0.08, 0.46), leather))
    belt.name = 'Belt'
    belt.position.y = 0.7
    figure.add(belt)

    const buckle = setShadow(new Mesh(sharedBoxGeometry(0.12, 0.09, 0.05), metal))
    buckle.name = 'Buckle'
    buckle.position.set(0, 0.7, 0.25)
    figure.add(buckle)

    // Upper body. Pivots at the waist so lean/twist/attack bend the whole torso
    // (head + arms + cloak ride along). Children authored in Chest-local space
    // (world Y minus chestY).
    const chest = new Group()
    chest.name = 'Chest'
    chest.position.y = J.chestY
    figure.add(chest)
    const cy = (worldY: number): number => worldY - J.chestY

    const body = setShadow(new Mesh(sharedCapsuleGeometry(BODY_RADIUS, BODY_HEIGHT, 5, 10), tunic))
    body.name = 'Body'
    body.position.y = cy(0.86)
    body.scale.set(0.95, 1, 0.78)
    chest.add(body)

    const head = setShadow(new Mesh(sharedSphereGeometry(HEAD_RADIUS, 16, 10), skin))
    head.name = 'Head'
    head.position.y = cy(1.38)
    head.scale.set(0.9, 1.04, 0.9)
    chest.add(head)

    const hair = setShadow(new Mesh(sharedSphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), dark))
    hair.name = 'Hair'
    hair.position.set(0, cy(1.45), -0.02)
    hair.rotation.x = -0.18
    chest.add(hair)

    // Arms hang from shoulder pivots on the chest. Mesh keeps its outward lean.
    chest.add(
        armPivot('UpperArmL', -J.armX, J.armLean, skin),
        armPivot('UpperArmR', J.armX, -J.armLean, skin),
    )

    const leftPauldron = setShadow(new Mesh(sharedSphereGeometry(0.08, 10, 8), metal))
    const rightPauldron = setShadow(new Mesh(sharedSphereGeometry(0.08, 10, 8), metal))
    leftPauldron.name = 'LeftShoulderAccent'
    rightPauldron.name = 'RightShoulderAccent'
    leftPauldron.position.set(-0.28, cy(1.15), 0.01)
    rightPauldron.position.set(0.28, cy(1.15), 0.01)
    leftPauldron.scale.set(1.45, 0.58, 1)
    rightPauldron.scale.set(1.45, 0.58, 1)
    chest.add(leftPauldron, rightPauldron)

    const mantle = setShadow(new Mesh(sharedCylinderGeometry(0.34, 0.3, 0.14, 8), cloak))
    mantle.name = 'CloakMantle'
    mantle.position.set(0, cy(1.12), -0.05)
    mantle.scale.z = 0.64
    chest.add(mantle)

    const cape = new Group()
    cape.name = 'Cloak'
    cape.position.set(0, 0, 0)
    chest.add(cape)

    const capeBack = setShadow(new Mesh(sharedBoxGeometry(0.42, 0.62, 0.055), cloak))
    capeBack.name = 'CloakBackPanel'
    capeBack.position.set(0, cy(0.86), -0.27)
    capeBack.rotation.x = -0.08

    const capeLower = setShadow(new Mesh(sharedBoxGeometry(0.54, 0.46, 0.06), cloak))
    capeLower.name = 'CloakLowerPanel'
    capeLower.position.set(0, cy(0.54), -0.3)
    capeLower.rotation.x = -0.1

    const capeFoldL = setShadow(new Mesh(sharedBoxGeometry(0.08, 0.64, 0.052), cloak))
    capeFoldL.name = 'CloakFoldL'
    capeFoldL.position.set(-0.24, cy(0.56), -0.29)
    capeFoldL.rotation.set(-0.08, -0.04, -0.12)

    const capeFoldR = setShadow(new Mesh(sharedBoxGeometry(0.08, 0.64, 0.052), cloak))
    capeFoldR.name = 'CloakFoldR'
    capeFoldR.position.set(0.24, cy(0.56), -0.29)
    capeFoldR.rotation.set(-0.08, 0.04, 0.12)

    cape.add(capeBack, capeLower, capeFoldL, capeFoldR)

    const nose = setShadow(new Mesh(sharedConeGeometry(0.035, 0.08, 8), skin))
    nose.name = 'Nose'
    nose.position.set(0, cy(1.38), 0.18)
    nose.rotation.x = Math.PI * 0.5
    chest.add(nose)

    addBeard(chest, cy, opts.beard ?? 'none', beard)

    // Equipment sockets (empty, identity-oriented). Hand sockets are added inside
    // the arm pivots; head/back ride the chest so they follow the torso.
    chest.add(socket('socket_head', 0, cy(1.56), 0.02))
    chest.add(socket('socket_back', 0, cy(1.1), -0.18))

    return root
}

function addBeard(
    chest: Group,
    cy: (worldY: number) => number,
    kind: CharacterBeardKind,
    mat: MeshStandardMaterial,
): void {
    if (kind === 'none') return

    const moustacheL = setShadow(new Mesh(sharedBoxGeometry(0.08, 0.035, 0.035), mat))
    moustacheL.name = 'CharacterMoustacheL'
    moustacheL.position.set(-0.045, cy(1.32), 0.183)
    moustacheL.rotation.z = -0.08

    const moustacheR = setShadow(new Mesh(sharedBoxGeometry(0.08, 0.035, 0.035), mat))
    moustacheR.name = 'CharacterMoustacheR'
    moustacheR.position.set(0.045, cy(1.32), 0.183)
    moustacheR.rotation.z = 0.08

    chest.add(moustacheL, moustacheR)

    if (kind === 'short') {
        const chin = setShadow(new Mesh(sharedBoxGeometry(0.16, 0.105, 0.065), mat))
        chin.name = 'CharacterBeardShort'
        chin.position.set(0, cy(1.255), 0.17)
        chest.add(chin)
        return
    }

    if (kind === 'full') {
        const chin = setShadow(new Mesh(sharedBoxGeometry(0.18, 0.17, 0.07), mat))
        chin.name = 'CharacterBeardFull'
        chin.position.set(0, cy(1.23), 0.168)
        const left = setShadow(new Mesh(sharedBoxGeometry(0.055, 0.13, 0.05), mat))
        left.name = 'CharacterBeardSideL'
        left.position.set(-0.105, cy(1.27), 0.145)
        const right = setShadow(new Mesh(sharedBoxGeometry(0.055, 0.13, 0.05), mat))
        right.name = 'CharacterBeardSideR'
        right.position.set(0.105, cy(1.27), 0.145)
        chest.add(chin, left, right)
        return
    }

    const point = setShadow(new Mesh(sharedConeGeometry(0.105, 0.23, 4), mat))
    point.name = 'CharacterBeardPointed'
    point.position.set(0, cy(1.235), 0.17)
    point.rotation.z = Math.PI
    point.rotation.y = Math.PI * 0.25
    point.scale.z = 0.72
    chest.add(point)
}

function socket(name: string, x: number, y: number, z: number): Group {
    const g = new Group()
    g.name = name
    g.position.set(x, y, z)
    return g
}

function armPivot(name: string, x: number, lean: number, mat: MeshStandardMaterial): Group {
    const J = MAIN_CHARACTER_JOINTS
    const pivot = new Group()
    pivot.name = name
    // Shoulder pivot, expressed in the chest's local frame.
    pivot.position.set(x, J.shoulderY - J.chestY, J.armZ)
    const arm = setShadow(new Mesh(sharedCapsuleGeometry(0.055, 0.44, 4, 8), mat))
    arm.position.set(0, J.armMeshY, 0)
    arm.rotation.z = lean
    pivot.add(arm)
    pivot.add(socket(x < 0 ? 'socket_hand_L' : 'socket_hand_R', 0, J.handY, 0))
    return pivot
}

function legPivot(name: string, x: number, mat: MeshStandardMaterial): Group {
    const J = MAIN_CHARACTER_JOINTS
    const pivot = new Group()
    pivot.name = name
    pivot.position.set(x, J.hipY, J.legZ)
    const boot = setShadow(new Mesh(sharedBoxGeometry(0.17, 0.32, 0.22), mat))
    boot.position.set(0, J.bootY - J.hipY, 0)
    pivot.add(boot)
    return pivot
}
