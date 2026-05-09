import {
    BoxGeometry,
    ConeGeometry,
    CylinderGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    SphereGeometry,
} from 'three'

export interface CreaturePalette {
    primary?: number
    secondary?: number
    skin?: number
    metal?: number
    accent?: number
}

const DEFAULTS = {
    guardBlue: 0x355d8a,
    guardSteel: 0x9aa4aa,
    banditRed: 0x7d3030,
    banditLeather: 0x5a3826,
    wolfFur: 0x5d6670,
    wolfMane: 0x343a40,
    muleCoat: 0x8b6a4c,
    mulePack: 0x6c4a2f,
    batWing: 0x2b2f3a,
    batBody: 0x4a4050,
    rabbitFur: 0xb7aa96,
    rabbitBelly: 0xe1d6c4,
    skin: 0xc88758,
    dark: 0x241b18,
    bone: 0xd8c8a0,
    amber: 0xd5a24a,
}

export function createTownGuardNpc(options: CreaturePalette = {}): Group {
    const root = namedRoot('TownGuardNpc')
    const cloth = material(options.primary ?? DEFAULTS.guardBlue, 0.68)
    const leather = material(options.secondary ?? DEFAULTS.dark, 0.78)
    const skin = material(options.skin ?? DEFAULTS.skin, 0.58)
    const metal = material(options.metal ?? DEFAULTS.guardSteel, 0.42, 0.22)
    const accent = material(options.accent ?? DEFAULTS.amber, 0.5, 0.08)

    addBox(root, 'left boot', [-0.16, 0.13, 0.03], [0.18, 0.26, 0.24], leather)
    addBox(root, 'right boot', [0.16, 0.13, 0.03], [0.18, 0.26, 0.24], leather)
    addBox(root, 'left leg', [-0.13, 0.45, 0], [0.15, 0.38, 0.18], cloth)
    addBox(root, 'right leg', [0.13, 0.45, 0], [0.15, 0.38, 0.18], cloth)
    addBox(root, 'cuirass', [0, 0.92, 0], [0.5, 0.72, 0.32], metal)
    addBox(root, 'tabard', [0, 0.88, -0.18], [0.34, 0.58, 0.035], cloth)
    addBox(root, 'belt', [0, 0.75, -0.01], [0.54, 0.08, 0.36], leather)
    addSphere(root, 'head', [0, 1.48, 0], [0.22, 0.24, 0.21], skin)
    addCylinder(root, 'helmet', [0, 1.66, 0], 0.24, 0.25, 0.18, metal)
    addCone(root, 'helmet crest', [0, 1.83, 0], 0.09, 0.16, accent)
    addBox(root, 'left arm', [-0.38, 0.95, 0], [0.13, 0.5, 0.15], metal, 0, 0, 0.14)
    addBox(root, 'right arm', [0.36, 0.93, 0], [0.13, 0.48, 0.15], metal, 0, 0, -0.1)
    addSphere(root, 'left hand', [-0.43, 0.65, 0], [0.07, 0.07, 0.07], skin)
    addSphere(root, 'right hand', [0.41, 0.64, 0], [0.07, 0.07, 0.07], skin)
    addBox(root, 'shield', [-0.54, 0.88, -0.12], [0.08, 0.48, 0.34], metal, 0.08, 0, 0.1)
    addCylinder(root, 'spear shaft', [0.56, 1.04, -0.08], 0.018, 0.018, 1.25, leather, 0, 0, -0.12)
    addCone(root, 'spear tip', [0.65, 1.68, -0.08], 0.06, 0.18, metal, 0, 0, -0.12)

    return finalize(root)
}

export function createBanditEnemy(options: CreaturePalette = {}): Group {
    const root = namedRoot('BanditEnemy')
    const cloth = material(options.primary ?? DEFAULTS.banditRed, 0.78)
    const leather = material(options.secondary ?? DEFAULTS.banditLeather, 0.84)
    const skin = material(options.skin ?? DEFAULTS.skin, 0.6)
    const metal = material(options.metal ?? 0x7a7f84, 0.48, 0.16)
    const accent = material(options.accent ?? 0x1b1514, 0.85)

    addBox(root, 'left boot', [-0.16, 0.12, 0.02], [0.19, 0.24, 0.25], leather)
    addBox(root, 'right boot', [0.16, 0.12, 0.02], [0.19, 0.24, 0.25], leather)
    addBox(root, 'left leg', [-0.14, 0.43, 0], [0.14, 0.36, 0.18], leather)
    addBox(root, 'right leg', [0.14, 0.43, 0], [0.14, 0.36, 0.18], leather)
    addBox(root, 'jacket', [0, 0.88, 0], [0.48, 0.68, 0.32], cloth)
    addBox(root, 'shoulder pad left', [-0.32, 1.13, 0], [0.18, 0.12, 0.24], leather, 0, 0, 0.25)
    addBox(root, 'shoulder pad right', [0.32, 1.13, 0], [0.18, 0.12, 0.24], leather, 0, 0, -0.25)
    addBox(root, 'belt', [0, 0.72, -0.01], [0.56, 0.09, 0.36], leather)
    addSphere(root, 'head', [0, 1.43, 0], [0.22, 0.24, 0.21], skin)
    addBox(root, 'mask', [0, 1.43, -0.205], [0.28, 0.11, 0.035], accent)
    addBox(root, 'hood', [0, 1.57, 0.02], [0.38, 0.18, 0.28], cloth)
    addBox(root, 'left arm', [-0.36, 0.9, 0], [0.13, 0.5, 0.16], cloth, 0, 0, 0.2)
    addBox(root, 'right arm', [0.38, 0.9, -0.02], [0.13, 0.5, 0.16], cloth, 0, 0, -0.32)
    addSphere(root, 'left hand', [-0.42, 0.62, 0], [0.07, 0.07, 0.07], skin)
    addSphere(root, 'right hand', [0.49, 0.62, -0.04], [0.07, 0.07, 0.07], skin)
    addBox(root, 'cleaver handle', [0.58, 0.8, -0.08], [0.05, 0.34, 0.05], leather, 0, 0, -0.42)
    addBox(root, 'cleaver head', [0.69, 0.98, -0.08], [0.18, 0.2, 0.045], metal, 0, 0, -0.42)
    addBox(root, 'back satchel', [0, 0.92, 0.22], [0.38, 0.42, 0.14], leather)

    return finalize(root)
}

export function createForestWolf(options: CreaturePalette = {}): Group {
    const root = namedRoot('ForestWolf')
    const fur = material(options.primary ?? DEFAULTS.wolfFur, 0.86)
    const mane = material(options.secondary ?? DEFAULTS.wolfMane, 0.9)
    const dark = material(options.accent ?? DEFAULTS.dark, 0.82)
    const bone = material(options.skin ?? DEFAULTS.bone, 0.66)

    addBox(root, 'body', [0, 0.52, 0], [0.46, 0.38, 0.9], fur)
    addBox(root, 'chest mane', [0, 0.6, -0.38], [0.5, 0.44, 0.16], mane)
    addSphere(root, 'head', [0, 0.78, -0.56], [0.24, 0.2, 0.28], fur)
    addBox(root, 'muzzle', [0, 0.73, -0.82], [0.2, 0.12, 0.2], bone)
    addBox(root, 'nose', [0, 0.75, -0.94], [0.08, 0.05, 0.04], dark)
    addCone(root, 'left ear', [-0.14, 0.98, -0.54], 0.09, 0.18, mane, 0.2, 0.08, 0.1)
    addCone(root, 'right ear', [0.14, 0.98, -0.54], 0.09, 0.18, mane, 0.2, -0.08, -0.1)
    addBox(root, 'tail', [0, 0.66, 0.58], [0.14, 0.14, 0.5], mane, 0.4, 0, 0)
    addLegs(root, fur, dark, 0.32, 0.26, 0.35, 0.8)

    return finalize(root)
}

export function createPackMule(options: CreaturePalette = {}): Group {
    const root = namedRoot('PackMule')
    const coat = material(options.primary ?? DEFAULTS.muleCoat, 0.84)
    const pack = material(options.secondary ?? DEFAULTS.mulePack, 0.82)
    const dark = material(options.accent ?? DEFAULTS.dark, 0.78)
    const rope = material(options.metal ?? DEFAULTS.bone, 0.7)

    addBox(root, 'body', [0, 0.68, 0.05], [0.54, 0.46, 1.05], coat)
    addBox(root, 'left pack', [-0.38, 0.78, 0.08], [0.2, 0.42, 0.48], pack)
    addBox(root, 'right pack', [0.38, 0.78, 0.08], [0.2, 0.42, 0.48], pack)
    addBox(root, 'saddle rope', [0, 0.96, 0.06], [0.62, 0.06, 0.6], rope)
    addBox(root, 'neck', [0, 0.91, -0.42], [0.24, 0.36, 0.28], coat, -0.35, 0, 0)
    addSphere(root, 'head', [0, 1.05, -0.72], [0.2, 0.19, 0.28], coat)
    addBox(root, 'muzzle', [0, 0.99, -0.96], [0.18, 0.12, 0.2], rope)
    addCone(root, 'left ear', [-0.12, 1.26, -0.68], 0.07, 0.2, coat, 0.2, 0, 0.1)
    addCone(root, 'right ear', [0.12, 1.26, -0.68], 0.07, 0.2, coat, 0.2, 0, -0.1)
    addBox(root, 'tail', [0, 0.72, 0.7], [0.1, 0.12, 0.36], dark, 0.35, 0, 0)
    addLegs(root, coat, dark, 0.22, 0.22, 0.42, 0.94)

    return finalize(root)
}

export function createCaveBat(options: CreaturePalette = {}): Group {
    const root = namedRoot('CaveBat')
    const body = material(options.primary ?? DEFAULTS.batBody, 0.82)
    const wing = material(options.secondary ?? DEFAULTS.batWing, 0.88)
    const accent = material(options.accent ?? 0xa45a58, 0.7)
    const claw = material(options.metal ?? DEFAULTS.bone, 0.62)

    addSphere(root, 'body', [0, 0.72, 0], [0.2, 0.24, 0.18], body)
    addSphere(root, 'head', [0, 0.96, -0.16], [0.17, 0.16, 0.15], body)
    addCone(root, 'left ear', [-0.09, 1.13, -0.16], 0.06, 0.16, body, 0.15, 0, 0.1)
    addCone(root, 'right ear', [0.09, 1.13, -0.16], 0.06, 0.16, body, 0.15, 0, -0.1)
    addSphere(root, 'left eye', [-0.06, 0.98, -0.29], [0.025, 0.025, 0.02], accent)
    addSphere(root, 'right eye', [0.06, 0.98, -0.29], [0.025, 0.025, 0.02], accent)
    addBox(root, 'left wing inner', [-0.32, 0.78, 0], [0.42, 0.035, 0.28], wing, 0, 0.2, 0.28)
    addBox(root, 'left wing outer', [-0.68, 0.72, 0.04], [0.46, 0.03, 0.24], wing, 0, 0.1, -0.12)
    addBox(root, 'right wing inner', [0.32, 0.78, 0], [0.42, 0.035, 0.28], wing, 0, -0.2, -0.28)
    addBox(root, 'right wing outer', [0.68, 0.72, 0.04], [0.46, 0.03, 0.24], wing, 0, -0.1, 0.12)
    addCone(root, 'left claw', [-0.1, 0.45, -0.04], 0.025, 0.12, claw, Math.PI, 0, 0)
    addCone(root, 'right claw', [0.1, 0.45, -0.04], 0.025, 0.12, claw, Math.PI, 0, 0)

    return finalize(root)
}

export function createRabbit(options: CreaturePalette = {}): Group {
    const root = namedRoot('Rabbit')
    const fur = material(options.primary ?? DEFAULTS.rabbitFur, 0.86)
    const belly = material(options.secondary ?? DEFAULTS.rabbitBelly, 0.78)
    const dark = material(options.accent ?? DEFAULTS.dark, 0.72)

    addSphere(root, 'body', [0, 0.27, 0.02], [0.22, 0.18, 0.32], fur)
    addSphere(root, 'chest', [0, 0.3, -0.16], [0.16, 0.15, 0.16], belly)
    addSphere(root, 'head', [0, 0.48, -0.26], [0.16, 0.15, 0.16], fur)
    addCone(root, 'left ear', [-0.07, 0.72, -0.24], 0.045, 0.28, fur, -0.18, 0, 0.08)
    addCone(root, 'right ear', [0.07, 0.72, -0.24], 0.045, 0.28, fur, -0.18, 0, -0.08)
    addSphere(root, 'tail', [0, 0.32, 0.34], [0.08, 0.08, 0.08], belly)
    addSphere(root, 'left eye', [-0.055, 0.51, -0.39], [0.022, 0.022, 0.018], dark)
    addSphere(root, 'right eye', [0.055, 0.51, -0.39], [0.022, 0.022, 0.018], dark)
    addBox(root, 'left forepaw', [-0.09, 0.09, -0.2], [0.07, 0.08, 0.14], fur)
    addBox(root, 'right forepaw', [0.09, 0.09, -0.2], [0.07, 0.08, 0.14], fur)
    addBox(root, 'left hindpaw', [-0.13, 0.08, 0.18], [0.1, 0.08, 0.2], fur)
    addBox(root, 'right hindpaw', [0.13, 0.08, 0.18], [0.1, 0.08, 0.2], fur)

    return finalize(root)
}

function namedRoot(name: string): Group {
    const root = new Group()
    root.name = name
    return root
}

function finalize(root: Group): Group {
    root.traverse((object) => {
        if (object instanceof Mesh) {
            object.castShadow = true
            object.receiveShadow = true
        }
    })
    return root
}

function material(color: number, roughness: number, metalness = 0.02): MeshStandardMaterial {
    return new MeshStandardMaterial({ color, roughness, metalness })
}

function addLegs(
    parent: Group,
    legMaterial: MeshStandardMaterial,
    hoofMaterial: MeshStandardMaterial,
    halfX: number,
    halfZ: number,
    legHeight: number,
    bodyLength: number,
): void {
    for (const x of [-halfX, halfX]) {
        for (const z of [-bodyLength * 0.34, bodyLength * 0.34]) {
            addBox(parent, 'leg', [x, legHeight * 0.5, z], [0.11, legHeight, 0.12], legMaterial)
            addBox(parent, 'paw', [x, 0.06, z - 0.02], [0.14, 0.08, 0.16], hoofMaterial)
        }
    }
}

function addBox(
    parent: Group,
    name: string,
    position: [number, number, number],
    scale: [number, number, number],
    meshMaterial: MeshStandardMaterial,
    rotationX = 0,
    rotationY = 0,
    rotationZ = 0,
): Mesh {
    const mesh = new Mesh(new BoxGeometry(scale[0], scale[1], scale[2]), meshMaterial)
    mesh.name = name
    mesh.position.set(position[0], position[1], position[2])
    mesh.rotation.set(rotationX, rotationY, rotationZ)
    parent.add(mesh)
    return mesh
}

function addSphere(
    parent: Group,
    name: string,
    position: [number, number, number],
    scale: [number, number, number],
    meshMaterial: MeshStandardMaterial,
): Mesh {
    const mesh = new Mesh(new SphereGeometry(1, 16, 10), meshMaterial)
    mesh.name = name
    mesh.position.set(position[0], position[1], position[2])
    mesh.scale.set(scale[0], scale[1], scale[2])
    parent.add(mesh)
    return mesh
}

function addCylinder(
    parent: Group,
    name: string,
    position: [number, number, number],
    radiusTop: number,
    radiusBottom: number,
    height: number,
    meshMaterial: MeshStandardMaterial,
    rotationX = 0,
    rotationY = 0,
    rotationZ = 0,
): Mesh {
    const mesh = new Mesh(new CylinderGeometry(radiusTop, radiusBottom, height, 20), meshMaterial)
    mesh.name = name
    mesh.position.set(position[0], position[1], position[2])
    mesh.rotation.set(rotationX, rotationY, rotationZ)
    parent.add(mesh)
    return mesh
}

function addCone(
    parent: Group,
    name: string,
    position: [number, number, number],
    radius: number,
    height: number,
    meshMaterial: MeshStandardMaterial,
    rotationX = 0,
    rotationY = 0,
    rotationZ = 0,
): Mesh {
    const mesh = new Mesh(new ConeGeometry(radius, height, 20), meshMaterial)
    mesh.name = name
    mesh.position.set(position[0], position[1], position[2])
    mesh.rotation.set(rotationX, rotationY, rotationZ)
    parent.add(mesh)
    return mesh
}
