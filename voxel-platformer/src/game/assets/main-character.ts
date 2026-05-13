import {
    CapsuleGeometry,
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

export const MAIN_CHARACTER_COLLIDER_RADIUS = 0.35
export const MAIN_CHARACTER_COLLIDER_HEIGHT = 1.6
export const MAIN_CHARACTER_COLLIDER_HALF_HEIGHT = MAIN_CHARACTER_COLLIDER_HEIGHT / 2

export interface MainCharacterOptions {
    tunicColor?: number
    cloakColor?: number
    skinColor?: number
    metalColor?: number
    bootColor?: number
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

function addPair(root: Group, left: Mesh, right: Mesh): void {
    root.add(left, right)
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

    const bootsY = 0.16
    addPair(
        root,
        setShadow(new Mesh(sharedBoxGeometry(0.17, 0.32, 0.22), leather)),
        setShadow(new Mesh(sharedBoxGeometry(0.17, 0.32, 0.22), leather)),
    )
    root.children[0].position.set(-0.11, bootsY, 0.02)
    root.children[1].position.set(0.11, bootsY, 0.02)

    const hem = setShadow(new Mesh(sharedCylinderGeometry(0.3, 0.34, 0.18, 8), tunic))
    hem.name = 'TunicHem'
    hem.position.y = 0.44
    root.add(hem)

    const body = setShadow(new Mesh(sharedCapsuleGeometry(BODY_RADIUS, BODY_HEIGHT, 5, 10), tunic))
    body.name = 'Body'
    body.position.y = 0.86
    body.scale.set(0.95, 1, 0.78)
    root.add(body)

    const belt = setShadow(new Mesh(sharedBoxGeometry(0.58, 0.08, 0.46), leather))
    belt.name = 'Belt'
    belt.position.y = 0.7
    root.add(belt)

    const buckle = setShadow(new Mesh(sharedBoxGeometry(0.12, 0.09, 0.05), metal))
    buckle.name = 'Buckle'
    buckle.position.set(0, 0.7, 0.25)
    root.add(buckle)

    const head = setShadow(new Mesh(sharedSphereGeometry(HEAD_RADIUS, 16, 10), skin))
    head.name = 'Head'
    head.position.y = 1.38
    head.scale.set(0.9, 1.04, 0.9)
    root.add(head)

    const hair = setShadow(new Mesh(sharedSphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), dark))
    hair.name = 'Hair'
    hair.position.set(0, 1.45, -0.02)
    hair.rotation.x = -0.18
    root.add(hair)

    addPair(
        root,
        setShadow(new Mesh(sharedCapsuleGeometry(0.055, 0.44, 4, 8), skin)),
        setShadow(new Mesh(sharedCapsuleGeometry(0.055, 0.44, 4, 8), skin)),
    )
    const leftArm = root.children[root.children.length - 2]
    const rightArm = root.children[root.children.length - 1]
    leftArm.name = 'LeftArm'
    rightArm.name = 'RightArm'
    leftArm.position.set(-0.34, 0.9, 0.01)
    rightArm.position.set(0.34, 0.9, 0.01)
    leftArm.rotation.z = 0.18
    rightArm.rotation.z = -0.18

    addPair(
        root,
        setShadow(new Mesh(sharedSphereGeometry(0.08, 10, 8), metal)),
        setShadow(new Mesh(sharedSphereGeometry(0.08, 10, 8), metal)),
    )
    const leftPauldron = root.children[root.children.length - 2]
    const rightPauldron = root.children[root.children.length - 1]
    leftPauldron.name = 'LeftShoulderAccent'
    rightPauldron.name = 'RightShoulderAccent'
    leftPauldron.position.set(-0.28, 1.15, 0.01)
    rightPauldron.position.set(0.28, 1.15, 0.01)
    leftPauldron.scale.set(1.45, 0.58, 1)
    rightPauldron.scale.set(1.45, 0.58, 1)

    const mantle = setShadow(new Mesh(sharedCylinderGeometry(0.34, 0.3, 0.14, 8), cloak))
    mantle.name = 'CloakMantle'
    mantle.position.set(0, 1.12, -0.05)
    mantle.scale.z = 0.64
    root.add(mantle)

    const cape = setShadow(new Mesh(sharedConeGeometry(0.36, 0.92, 4), cloak))
    cape.name = 'Cloak'
    cape.position.set(0, 0.68, -0.2)
    cape.rotation.y = Math.PI * 0.25
    cape.scale.set(0.95, 1, 0.42)
    root.add(cape)

    const nose = setShadow(new Mesh(sharedConeGeometry(0.035, 0.08, 8), skin))
    nose.name = 'Nose'
    nose.position.set(0, 1.38, 0.18)
    nose.rotation.x = Math.PI * 0.5
    root.add(nose)

    return root
}
