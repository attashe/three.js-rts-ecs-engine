import {
    Group,
    Mesh,
    MeshStandardMaterial,
} from 'three'
import {
    sharedConeGeometry,
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
