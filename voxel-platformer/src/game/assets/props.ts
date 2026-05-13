import {
    Group,
    Mesh,
    MeshStandardMaterial,
} from 'three'
import {
    sharedConeGeometry,
    sharedCylinderGeometry,
    sharedMaterial,
    sharedSphereGeometry,
} from './shared-primitives'

function material(color: number, roughness = 0.7, metalness = 0): MeshStandardMaterial {
    return sharedMaterial(color, roughness, metalness)
}

function shadows(root: Group): Group {
    root.traverse((obj) => {
        if (obj instanceof Mesh) {
            obj.castShadow = true
            obj.receiveShadow = true
        }
    })
    return root
}

export interface StoneVisualOptions {
    /** Uniform scale on the whole Group; 1 = default 0.28-radius sphere. */
    scale?: number
    /** Sphere-core colour. */
    color?: number
    /** Surface-chip colour. */
    chipColor?: number
}

export function createCoinPile(): Group {
    const root = new Group()
    root.name = 'CoinPile'
    const gold = material(0xffc94a, 0.38, 0.45)
    // Small mound of 9 thick gold pieces stacked in four layers with slight
    // tilts. CylinderGeometry's default axis is +Y, so unrotated coins lie
    // flat (which is the orientation we want from the iso camera). The pile
    // reads ~0.2 m tall — the smallest readable feature size at this zoom.
    const layout: Array<[number, number, number, number, number]> = [
        // x, z, layer, tiltX, tiltZ
        [-0.10, -0.06, 0,  0.00,  0.00],
        [ 0.09, -0.05, 0,  0.05, -0.04],
        [ 0.00,  0.10, 0, -0.04,  0.06],
        [-0.06,  0.05, 1,  0.04,  0.02],
        [ 0.07,  0.06, 1, -0.05, -0.03],
        [-0.03, -0.07, 1,  0.02,  0.05],
        [ 0.03,  0.02, 2, -0.04,  0.00],
        [-0.05, -0.02, 2,  0.00, -0.02],
        [ 0.00,  0.00, 3,  0.00,  0.00],
    ]
    for (let i = 0; i < layout.length; i++) {
        const [x, z, layer, tiltX, tiltZ] = layout[i]!
        const coin = new Mesh(sharedCylinderGeometry(0.14, 0.14, 0.05, 16), gold)
        coin.name = `Coin${i + 1}`
        coin.position.set(x, 0.03 + layer * 0.045, z)
        coin.rotation.x = tiltX
        coin.rotation.z = tiltZ
        root.add(coin)
    }
    return shadows(root)
}

export function createStone(opts: StoneVisualOptions = {}): Group {
    // Group origin sits at the sphere's centre so rotation tumbles the visual
    // in place. Spawners that want "stone resting on ground" should set
    // Position.y to (groundY + radius). Settled stones use a centre-anchored
    // AABB that matches this convention.
    const scale = opts.scale ?? 1
    const color = opts.color ?? 0x6f7479
    const chipColor = opts.chipColor ?? 0x5a6065

    const root = new Group()
    root.name = 'LooseStone'
    const rock = material(color, 0.92)
    const core = new Mesh(sharedSphereGeometry(0.28, 10, 8), rock)
    core.name = 'StoneCore'
    core.scale.set(1.08, 0.82, 0.94)
    core.position.y = 0
    root.add(core)

    const chip = new Mesh(sharedConeGeometry(0.11, 0.16, 5), material(chipColor, 0.95))
    chip.name = 'StoneChip'
    chip.position.set(0.12, 0.11, -0.08)
    chip.rotation.set(0.4, 0.25, -0.35)
    root.add(chip)

    if (scale !== 1) root.scale.setScalar(scale)
    return shadows(root)
}
