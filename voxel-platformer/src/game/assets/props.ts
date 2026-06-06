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
    sharedTorusGeometry,
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

export function createQuestShard(): Group {
    const root = new Group()
    root.name = 'QuestShard'

    const amber = material(0xffb84d, 0.42, 0.18)
    const hotCore = material(0xfff1a6, 0.32, 0.08)
    const brass = material(0x7a5427, 0.64, 0.12)

    const upper = new Mesh(sharedConeGeometry(0.12, 0.32, 6), amber)
    upper.name = 'ShardUpper'
    upper.position.y = 0.34
    root.add(upper)

    const lower = new Mesh(sharedConeGeometry(0.10, 0.24, 6), amber)
    lower.name = 'ShardLower'
    lower.position.y = 0.12
    lower.rotation.x = Math.PI
    root.add(lower)

    const core = new Mesh(sharedSphereGeometry(0.055, 8, 6), hotCore)
    core.name = 'ShardCore'
    core.position.y = 0.24
    root.add(core)

    const ring = new Mesh(sharedTorusGeometry(0.16, 0.012, 6, 16), brass)
    ring.name = 'ShardRing'
    ring.position.y = 0.08
    ring.rotation.x = Math.PI * 0.5
    root.add(ring)

    return shadows(root)
}

export function createHighJumpBootsProp(): Group {
    const root = new Group()
    root.name = 'HighJumpBootsProp'

    const leather = material(0x2c2531, 0.74)
    const sole = material(0x151720, 0.68)
    const brass = material(0xd2a64b, 0.34, 0.26)
    const glow = material(0x65d7ff, 0.4, 0.1)

    for (const [x, angle] of [[-0.12, -0.08], [0.12, 0.08]] as const) {
        const base = new Mesh(sharedBoxGeometry(0.18, 0.055, 0.32), sole)
        base.name = x < 0 ? 'HighJumpBootPropSoleL' : 'HighJumpBootPropSoleR'
        base.position.set(x, 0.04, 0.02)
        base.rotation.y = angle

        const upper = new Mesh(sharedBoxGeometry(0.15, 0.2, 0.2), leather)
        upper.name = x < 0 ? 'HighJumpBootPropUpperL' : 'HighJumpBootPropUpperR'
        upper.position.set(x, 0.16, -0.03)
        upper.rotation.y = angle

        const toe = new Mesh(sharedBoxGeometry(0.17, 0.085, 0.15), leather)
        toe.name = x < 0 ? 'HighJumpBootPropToeL' : 'HighJumpBootPropToeR'
        toe.position.set(x, 0.09, 0.13)
        toe.rotation.y = angle

        const spring = new Mesh(sharedCylinderGeometry(0.022, 0.022, 0.22, 8), brass)
        spring.name = x < 0 ? 'HighJumpBootPropSpringL' : 'HighJumpBootPropSpringR'
        spring.position.set(x, 0.12, -0.16)
        spring.rotation.x = Math.PI * 0.5

        const gem = new Mesh(sharedSphereGeometry(0.035, 8, 6), glow)
        gem.name = x < 0 ? 'HighJumpBootPropGlowL' : 'HighJumpBootPropGlowR'
        gem.position.set(x, 0.18, 0.12)

        root.add(base, upper, toe, spring, gem)
    }

    const ring = new Mesh(sharedTorusGeometry(0.24, 0.012, 6, 18), brass)
    ring.name = 'HighJumpBootsPropRing'
    ring.position.y = 0.04
    ring.rotation.x = Math.PI * 0.5
    root.add(ring)

    return shadows(root)
}

export function createDynamiteBundle(): Group {
    const root = new Group()
    root.name = 'DynamiteBundle'

    const red = material(0x9d2830, 0.72)
    const paper = material(0xd9c8a3, 0.66)
    const cord = material(0x1f1b17, 0.78)
    const spark = material(0xffd166, 0.4, 0.1)

    for (const [z, name] of [[-0.08, 'Back'], [0, 'Middle'], [0.08, 'Front']] as const) {
        const stick = new Mesh(sharedCylinderGeometry(0.045, 0.045, 0.36, 10), red)
        stick.name = `DynamiteStick${name}`
        stick.rotation.z = Math.PI * 0.5
        stick.position.set(0, 0.12, z)
        root.add(stick)
    }

    const bandL = new Mesh(sharedBoxGeometry(0.04, 0.12, 0.24), paper)
    bandL.name = 'DynamitePaperBandL'
    bandL.position.set(-0.09, 0.12, 0)
    const bandR = bandL.clone()
    bandR.name = 'DynamitePaperBandR'
    bandR.position.x = 0.09
    root.add(bandL, bandR)

    const fuse = new Mesh(sharedCylinderGeometry(0.01, 0.01, 0.26, 6), cord)
    fuse.name = 'DynamiteFuse'
    fuse.position.set(0.19, 0.18, 0)
    fuse.rotation.z = -0.72
    root.add(fuse)

    const ember = new Mesh(sharedSphereGeometry(0.028, 8, 6), spark)
    ember.name = 'DynamiteFuseSpark'
    ember.position.set(0.27, 0.26, 0)
    root.add(ember)

    return shadows(root)
}

export function createSpellbookPickupProp(): Group {
    const root = new Group()
    root.name = 'SpellbookPickup'

    const spin = new Group()
    spin.name = 'SpellbookSpin'
    spin.position.y = 0.58
    root.add(spin)

    const coverMat = material(0x243a84, 0.54, 0.06)
    const pageMat = material(0xe7dcc0, 0.66)
    const spineMat = material(0x7a3aa2, 0.5, 0.08)
    const runeMat = material(0x6fc8ff, 0.35, 0.18)
    const brassMat = material(0xd4a64b, 0.42, 0.22)

    const cover = new Mesh(sharedBoxGeometry(0.48, 0.04, 0.34), coverMat)
    cover.name = 'SpellbookCover'
    cover.position.y = 0.01

    const leftPage = new Mesh(sharedBoxGeometry(0.2, 0.035, 0.29), pageMat)
    leftPage.name = 'SpellbookLeftPage'
    leftPage.position.set(-0.11, 0.05, 0)
    leftPage.rotation.z = 0.08

    const rightPage = new Mesh(sharedBoxGeometry(0.2, 0.035, 0.29), pageMat)
    rightPage.name = 'SpellbookRightPage'
    rightPage.position.set(0.11, 0.05, 0)
    rightPage.rotation.z = -0.08

    const spine = new Mesh(sharedBoxGeometry(0.045, 0.07, 0.36), spineMat)
    spine.name = 'SpellbookSpine'
    spine.position.y = 0.04

    const runeA = new Mesh(sharedBoxGeometry(0.12, 0.012, 0.026), runeMat)
    runeA.name = 'SpellbookRuneA'
    runeA.position.set(-0.12, 0.085, -0.07)
    const runeB = runeA.clone()
    runeB.name = 'SpellbookRuneB'
    runeB.position.set(0.12, 0.085, 0.07)

    const gem = new Mesh(sharedSphereGeometry(0.046, 8, 6), runeMat)
    gem.name = 'SpellbookGem'
    gem.position.y = 0.12

    const ring = new Mesh(sharedTorusGeometry(0.37, 0.012, 6, 28), brassMat)
    ring.name = 'SpellbookHalo'
    ring.rotation.x = Math.PI * 0.5
    ring.position.y = -0.12

    spin.add(cover, leftPage, rightPage, spine, runeA, runeB, gem, ring)
    return shadows(root)
}

export function createFoodPickupProp(kind: 'apple' | 'fish' | 'meat' | 'pie' = 'meat'): Group {
    const root = new Group()
    root.name = `FoodPickup:${kind}`

    if (kind === 'apple') {
        const apple = new Mesh(sharedSphereGeometry(0.13, 10, 8), material(0xb73436, 0.64))
        apple.name = 'FoodAppleBody'
        apple.scale.set(1, 0.9, 1)
        apple.position.y = 0.14
        const stem = new Mesh(sharedCylinderGeometry(0.015, 0.015, 0.08, 6), material(0x4c2e18, 0.78))
        stem.name = 'FoodAppleStem'
        stem.position.y = 0.26
        root.add(apple, stem)
        return shadows(root)
    }

    if (kind === 'fish') {
        const body = new Mesh(sharedSphereGeometry(0.14, 10, 8), material(0x4f8fa6, 0.62))
        body.name = 'FoodFishBody'
        body.scale.set(1.45, 0.62, 0.76)
        body.position.y = 0.12
        const tail = new Mesh(sharedConeGeometry(0.08, 0.12, 4), material(0x75b7c4, 0.66))
        tail.name = 'FoodFishTail'
        tail.position.set(-0.21, 0.12, 0)
        tail.rotation.z = Math.PI * 0.5
        root.add(body, tail)
        return shadows(root)
    }

    if (kind === 'pie') {
        const crust = new Mesh(sharedCylinderGeometry(0.17, 0.15, 0.08, 14), material(0xb4783a, 0.74))
        crust.name = 'FoodPieCrust'
        crust.position.y = 0.07
        const filling = new Mesh(sharedCylinderGeometry(0.13, 0.13, 0.025, 14), material(0x7d3a2a, 0.7))
        filling.name = 'FoodPieFilling'
        filling.position.y = 0.12
        root.add(crust, filling)
        return shadows(root)
    }

    const slab = new Mesh(sharedBoxGeometry(0.25, 0.09, 0.18), material(0x8a4336, 0.78))
    slab.name = 'FoodMeatSlab'
    slab.position.y = 0.09
    slab.rotation.y = 0.16
    const bone = new Mesh(sharedCylinderGeometry(0.022, 0.022, 0.26, 8), material(0xe4d4b8, 0.6))
    bone.name = 'FoodMeatBone'
    bone.position.y = 0.11
    bone.rotation.z = Math.PI * 0.5
    root.add(slab, bone)
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
