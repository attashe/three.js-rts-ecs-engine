import {
    Group,
    Mesh,
    MeshStandardMaterial,
} from 'three'
import {
    sharedBoxGeometry,
    sharedConeGeometry,
    sharedCylinderGeometry,
    sharedMaterial,
    sharedSphereGeometry,
} from './shared-primitives'

export interface WorldPropPalette {
    wood?: number
    darkWood?: number
    cloth?: number
    metal?: number
    accent?: number
    stone?: number
}

const COLORS = {
    wood: 0x7a5130,
    darkWood: 0x4b3022,
    cloth: 0x9f5742,
    canvas: 0xc8b27a,
    metal: 0x777f86,
    brass: 0xc7963f,
    stone: 0x6f7479,
    coal: 0x1f2024,
    ember: 0xff6b2a,
    straw: 0xc4a24f,
    bookRed: 0x8c3434,
    bookBlue: 0x34598c,
}

export function createWoodenTable(options: WorldPropPalette = {}): Group {
    const root = namedRoot('WoodenTable')
    const wood = material(options.wood ?? COLORS.wood, 0.82)
    const dark = material(options.darkWood ?? COLORS.darkWood, 0.86)

    addBox(root, 'top', [0, 0.78, 0], [1.25, 0.12, 0.78], wood)
    addBox(root, 'left rail', [0, 0.66, -0.32], [1.12, 0.08, 0.08], dark)
    addBox(root, 'right rail', [0, 0.66, 0.32], [1.12, 0.08, 0.08], dark)
    for (const x of [-0.5, 0.5]) {
        for (const z of [-0.28, 0.28]) {
            addBox(root, 'leg', [x, 0.36, z], [0.12, 0.72, 0.12], dark)
        }
    }
    return finalize(root)
}

export function createWoodenChair(options: WorldPropPalette = {}): Group {
    const root = namedRoot('WoodenChair')
    const wood = material(options.wood ?? COLORS.wood, 0.82)
    const dark = material(options.darkWood ?? COLORS.darkWood, 0.86)

    addBox(root, 'seat', [0, 0.48, 0], [0.48, 0.1, 0.46], wood)
    addBox(root, 'back rest', [0, 0.88, 0.22], [0.5, 0.54, 0.08], wood)
    addBox(root, 'back top', [0, 1.17, 0.23], [0.56, 0.08, 0.1], dark)
    for (const x of [-0.18, 0.18]) {
        for (const z of [-0.16, 0.16]) {
            addBox(root, 'leg', [x, 0.24, z], [0.08, 0.48, 0.08], dark)
        }
    }
    return finalize(root)
}

export function createRoundStool(options: WorldPropPalette = {}): Group {
    const root = namedRoot('RoundStool')
    const wood = material(options.wood ?? COLORS.wood, 0.82)
    const dark = material(options.darkWood ?? COLORS.darkWood, 0.86)

    addCylinder(root, 'seat', [0, 0.48, 0], 0.28, 0.3, 0.1, wood)
    for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3
        addBox(root, 'leg', [Math.cos(a) * 0.16, 0.24, Math.sin(a) * 0.16], [0.07, 0.48, 0.07], dark, 0, -a, 0.12)
    }
    return finalize(root)
}

export function createStorageBarrel(options: WorldPropPalette = {}): Group {
    const root = namedRoot('StorageBarrel')
    const wood = material(options.wood ?? COLORS.wood, 0.86)
    const metal = material(options.metal ?? COLORS.metal, 0.45, 0.18)

    addCylinder(root, 'body', [0, 0.42, 0], 0.28, 0.31, 0.78, wood)
    addCylinder(root, 'top band', [0, 0.7, 0], 0.315, 0.315, 0.055, metal)
    addCylinder(root, 'middle band', [0, 0.42, 0], 0.33, 0.33, 0.045, metal)
    addCylinder(root, 'bottom band', [0, 0.14, 0], 0.315, 0.315, 0.055, metal)
    addCylinder(root, 'lid', [0, 0.83, 0], 0.27, 0.27, 0.06, wood)
    return finalize(root)
}

export function createSupplyCrate(options: WorldPropPalette = {}): Group {
    const root = namedRoot('SupplyCrate')
    const wood = material(options.wood ?? COLORS.wood, 0.84)
    const dark = material(options.darkWood ?? COLORS.darkWood, 0.88)

    addBox(root, 'box', [0, 0.32, 0], [0.62, 0.62, 0.62], wood)
    addBox(root, 'front brace', [0, 0.32, -0.321], [0.72, 0.08, 0.04], dark, 0, 0, 0.72)
    addBox(root, 'front brace cross', [0, 0.32, -0.323], [0.72, 0.08, 0.04], dark, 0, 0, -0.72)
    addBox(root, 'top slat', [0, 0.66, 0], [0.72, 0.07, 0.68], dark)
    return finalize(root)
}

export function createBookshelf(options: WorldPropPalette = {}): Group {
    const root = namedRoot('Bookshelf')
    const wood = material(options.wood ?? COLORS.darkWood, 0.86)
    const red = material(options.accent ?? COLORS.bookRed, 0.78)
    const blue = material(COLORS.bookBlue, 0.78)
    const parchment = material(COLORS.canvas, 0.8)

    addBox(root, 'case', [0, 0.75, 0], [0.82, 1.42, 0.24], wood)
    for (const y of [0.38, 0.75, 1.12]) {
        addBox(root, 'shelf', [0, y, -0.13], [0.74, 0.05, 0.12], wood)
    }
    addBooks(root, -0.22, 0.52, red, blue, parchment)
    addBooks(root, 0.18, 0.88, blue, parchment, red)
    addBooks(root, -0.12, 1.25, parchment, red, blue)
    return finalize(root)
}

export function createBedroll(options: WorldPropPalette = {}): Group {
    const root = namedRoot('Bedroll')
    const cloth = material(options.cloth ?? COLORS.canvas, 0.9)
    const roll = material(options.accent ?? COLORS.cloth, 0.86)
    const leather = material(options.darkWood ?? COLORS.darkWood, 0.86)

    addBox(root, 'blanket', [0, 0.08, 0], [0.72, 0.12, 1.18], cloth)
    addCylinder(root, 'rolled end', [0, 0.16, -0.62], 0.18, 0.18, 0.74, roll, 0, 0, Math.PI * 0.5)
    addBox(root, 'strap left', [-0.22, 0.24, -0.62], [0.05, 0.08, 0.42], leather)
    addBox(root, 'strap right', [0.22, 0.24, -0.62], [0.05, 0.08, 0.42], leather)
    return finalize(root)
}

export function createCampfire(options: WorldPropPalette = {}): Group {
    const root = namedRoot('Campfire')
    const stone = material(options.stone ?? COLORS.stone, 0.92)
    const coal = material(COLORS.coal, 0.88)
    const wood = material(options.wood ?? COLORS.darkWood, 0.84)
    const ember = material(options.accent ?? COLORS.ember, 0.42, 0.04)

    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI * 2 / 8
        addSphere(root, 'ring stone', [Math.cos(a) * 0.36, 0.07, Math.sin(a) * 0.36], [0.09, 0.06, 0.08], stone)
    }
    addBox(root, 'log a', [0, 0.12, 0], [0.78, 0.09, 0.1], wood, 0.1, 0.55, 0)
    addBox(root, 'log b', [0, 0.14, 0], [0.78, 0.09, 0.1], wood, -0.1, -0.55, 0)
    addSphere(root, 'coal bed', [0, 0.11, 0], [0.24, 0.06, 0.24], coal)
    addCone(root, 'flame outer', [0, 0.34, 0], 0.19, 0.42, ember)
    addCone(root, 'flame inner', [0, 0.38, -0.02], 0.11, 0.32, material(0xffc24a, 0.38, 0.02))
    return finalize(root)
}

export function createLanternPost(options: WorldPropPalette = {}): Group {
    const root = namedRoot('LanternPost')
    const wood = material(options.wood ?? COLORS.darkWood, 0.86)
    const metal = material(options.metal ?? COLORS.metal, 0.42, 0.18)
    const light = material(options.accent ?? 0xffd46a, 0.28, 0.02)

    addCylinder(root, 'post', [0, 0.75, 0], 0.06, 0.075, 1.5, wood)
    addBox(root, 'arm', [0.22, 1.42, 0], [0.48, 0.07, 0.07], wood)
    addCylinder(root, 'hook', [0.46, 1.3, 0], 0.035, 0.035, 0.18, metal)
    addCylinder(root, 'lantern frame', [0.46, 1.12, 0], 0.14, 0.14, 0.26, metal)
    addSphere(root, 'lantern glow', [0.46, 1.12, 0], [0.1, 0.13, 0.1], light)
    addBox(root, 'base peg', [0, 0.05, 0], [0.22, 0.1, 0.22], wood)
    return finalize(root)
}

export function createMarketStall(options: WorldPropPalette = {}): Group {
    const root = namedRoot('MarketStall')
    const wood = material(options.wood ?? COLORS.wood, 0.82)
    const dark = material(options.darkWood ?? COLORS.darkWood, 0.86)
    const cloth = material(options.cloth ?? COLORS.cloth, 0.8)
    const canvas = material(options.accent ?? COLORS.canvas, 0.82)

    addBox(root, 'counter', [0, 0.58, 0], [1.35, 0.12, 0.56], wood)
    for (const x of [-0.56, 0.56]) {
        for (const z of [-0.22, 0.22]) {
            addBox(root, 'post', [x, 0.76, z], [0.08, 1.52, 0.08], dark)
        }
    }
    addBox(root, 'awning center', [0, 1.48, 0], [1.5, 0.08, 0.72], cloth, 0.08, 0, 0)
    addBox(root, 'awning stripe left', [-0.38, 1.535, 0], [0.18, 0.04, 0.74], canvas, 0.08, 0, 0)
    addBox(root, 'awning stripe right', [0.38, 1.535, 0], [0.18, 0.04, 0.74], canvas, 0.08, 0, 0)
    addBox(root, 'small crate', [-0.38, 0.78, -0.08], [0.28, 0.24, 0.24], dark)
    addCylinder(root, 'basket', [0.36, 0.78, 0.08], 0.18, 0.15, 0.2, canvas)
    return finalize(root)
}

function addBooks(
    parent: Group,
    startX: number,
    y: number,
    a: MeshStandardMaterial,
    b: MeshStandardMaterial,
    c: MeshStandardMaterial,
): void {
    const mats = [a, b, c, a, c]
    for (let i = 0; i < mats.length; i++) {
        addBox(parent, 'book', [startX + i * 0.08, y, -0.26], [0.055, 0.24 - (i % 2) * 0.04, 0.08], mats[i]!)
    }
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

function material(color: number, roughness = 0.7, metalness = 0): MeshStandardMaterial {
    return sharedMaterial(color, roughness, metalness)
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
    const mesh = new Mesh(sharedBoxGeometry(scale[0], scale[1], scale[2]), meshMaterial)
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
    const mesh = new Mesh(sharedSphereGeometry(1, 12, 8), meshMaterial)
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
    const mesh = new Mesh(sharedCylinderGeometry(radiusTop, radiusBottom, height, 16), meshMaterial)
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
): Mesh {
    const mesh = new Mesh(sharedConeGeometry(radius, height, 10), meshMaterial)
    mesh.name = name
    mesh.position.set(position[0], position[1], position[2])
    parent.add(mesh)
    return mesh
}
