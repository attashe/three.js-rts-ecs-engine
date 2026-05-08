import {
    BoxGeometry,
    ConeGeometry,
    CylinderGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    SphereGeometry,
} from 'three'

export interface SampleNpcOptions {
    tunicColor?: number
    apronColor?: number
    skinColor?: number
    hatColor?: number
    packColor?: number
}

const COLORS = {
    tunic: 0x4f7f5f,
    apron: 0xd8b15f,
    skin: 0xc88758,
    hat: 0x8a5634,
    pack: 0x7b5137,
    boots: 0x3b2b24,
    belt: 0x2a1b16,
    trim: 0xf0d38a,
}

/**
 * Builds a simple villager/merchant NPC as a foot-origin object.
 *
 * The returned Group's origin is at the ground contact point between the feet,
 * so gameplay code can place it directly at a standing world position.
 */
export function createSampleNpc(options: SampleNpcOptions = {}): Group {
    const root = new Group()
    root.name = 'SampleNpc'

    const tunic = material(options.tunicColor ?? COLORS.tunic, 0.72)
    const apron = material(options.apronColor ?? COLORS.apron, 0.68)
    const skin = material(options.skinColor ?? COLORS.skin, 0.58)
    const hat = material(options.hatColor ?? COLORS.hat, 0.74)
    const pack = material(options.packColor ?? COLORS.pack, 0.76)
    const boots = material(COLORS.boots, 0.72)
    const belt = material(COLORS.belt, 0.68)
    const trim = material(COLORS.trim, 0.62, 0.05)

    addBox(root, 'left boot', [-0.16, 0.13, 0.02], [0.18, 0.26, 0.24], boots)
    addBox(root, 'right boot', [0.16, 0.13, 0.02], [0.18, 0.26, 0.24], boots)

    addBox(root, 'left leg', [-0.14, 0.42, 0], [0.15, 0.34, 0.18], tunic)
    addBox(root, 'right leg', [0.14, 0.42, 0], [0.15, 0.34, 0.18], tunic)

    addBox(root, 'body', [0, 0.88, 0], [0.5, 0.72, 0.32], tunic)
    addBox(root, 'front apron', [0, 0.86, -0.171], [0.36, 0.58, 0.025], apron)
    addBox(root, 'belt', [0, 0.76, -0.005], [0.55, 0.08, 0.36], belt)
    addBox(root, 'neck', [0, 1.26, 0], [0.16, 0.1, 0.14], skin)

    addSphere(root, 'head', [0, 1.47, 0], [0.23, 0.25, 0.22], skin)
    addBox(root, 'nose', [0, 1.46, -0.22], [0.07, 0.06, 0.08], skin)
    addBox(root, 'beard', [0, 1.34, -0.205], [0.24, 0.14, 0.035], trim)

    addCylinder(root, 'hat brim', [0, 1.68, 0], 0.3, 0.3, 0.08, hat)
    addCone(root, 'hat crown', [0, 1.82, 0], 0.22, 0.28, hat)

    addBox(root, 'left arm', [-0.36, 0.93, -0.02], [0.14, 0.5, 0.16], tunic, 0, 0, 0.18)
    addBox(root, 'right arm', [0.36, 0.93, -0.02], [0.14, 0.5, 0.16], tunic, 0, 0, -0.18)
    addSphere(root, 'left hand', [-0.41, 0.65, -0.02], [0.08, 0.08, 0.08], skin)
    addSphere(root, 'right hand', [0.41, 0.65, -0.02], [0.08, 0.08, 0.08], skin)

    addBox(root, 'back pack', [0, 0.94, 0.23], [0.42, 0.52, 0.16], pack)
    addBox(root, 'pack flap', [0, 1.13, 0.125], [0.32, 0.1, 0.04], trim)

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
): Mesh {
    const mesh = new Mesh(new CylinderGeometry(radiusTop, radiusBottom, height, 20), meshMaterial)
    mesh.name = name
    mesh.position.set(position[0], position[1], position[2])
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
    const mesh = new Mesh(new ConeGeometry(radius, height, 20), meshMaterial)
    mesh.name = name
    mesh.position.set(position[0], position[1], position[2])
    parent.add(mesh)
    return mesh
}
