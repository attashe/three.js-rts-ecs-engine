import {
    BoxGeometry,
    ConeGeometry,
    CylinderGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    SphereGeometry,
    TorusGeometry,
} from 'three'

function material(color: number, roughness = 0.7, metalness = 0): MeshStandardMaterial {
    return new MeshStandardMaterial({ color, roughness, metalness })
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

export function createCoinPile(): Group {
    const root = new Group()
    root.name = 'CoinPile'
    const gold = material(0xffc94a, 0.38, 0.45)
    for (let i = 0; i < 7; i++) {
        const coin = new Mesh(new CylinderGeometry(0.1, 0.1, 0.025, 14), gold)
        coin.name = `Coin${i + 1}`
        coin.rotation.x = Math.PI * 0.5
        coin.position.set((i % 3 - 1) * 0.09, 0.025 + Math.floor(i / 3) * 0.025, (i % 2 - 0.5) * 0.09)
        root.add(coin)
    }
    return shadows(root)
}

export function createHealthPotion(): Group {
    const root = new Group()
    root.name = 'HealthPotion'
    const glass = material(0x89d7ff, 0.18, 0.05)
    const liquid = material(0xc7384a, 0.42)
    const cork = material(0x7a5130, 0.85)

    const bottle = new Mesh(new SphereGeometry(0.16, 14, 10), glass)
    bottle.name = 'Bottle'
    bottle.scale.set(0.8, 1, 0.8)
    bottle.position.y = 0.18
    root.add(bottle)

    const fill = new Mesh(new SphereGeometry(0.13, 12, 8), liquid)
    fill.name = 'Liquid'
    fill.scale.set(0.78, 0.55, 0.78)
    fill.position.y = 0.13
    root.add(fill)

    const neck = new Mesh(new CylinderGeometry(0.055, 0.065, 0.16, 10), glass)
    neck.name = 'Neck'
    neck.position.y = 0.36
    root.add(neck)

    const stopper = new Mesh(new CylinderGeometry(0.06, 0.055, 0.08, 10), cork)
    stopper.name = 'Stopper'
    stopper.position.y = 0.48
    root.add(stopper)

    return shadows(root)
}

export function createTrainingDummy(): Group {
    const root = new Group()
    root.name = 'TrainingDummy'
    const wood = material(0x7b4b2a, 0.82)
    const cloth = material(0x9c3d32, 0.76)
    const straw = material(0xc7a24a, 0.85)

    const post = new Mesh(new CylinderGeometry(0.07, 0.08, 1.25, 10), wood)
    post.name = 'Post'
    post.position.y = 0.62
    root.add(post)

    const torso = new Mesh(new BoxGeometry(0.42, 0.5, 0.24), cloth)
    torso.name = 'TorsoPad'
    torso.position.y = 0.92
    root.add(torso)

    const head = new Mesh(new SphereGeometry(0.18, 12, 8), straw)
    head.name = 'StrawHead'
    head.position.y = 1.32
    root.add(head)

    const arm = new Mesh(new CylinderGeometry(0.045, 0.045, 0.82, 8), wood)
    arm.name = 'CrossArm'
    arm.position.y = 1.02
    arm.rotation.z = Math.PI * 0.5
    root.add(arm)

    const base = new Mesh(new TorusGeometry(0.18, 0.035, 8, 20), wood)
    base.name = 'BaseRing'
    base.position.y = 0.06
    base.rotation.x = Math.PI * 0.5
    root.add(base)

    const cap = new Mesh(new ConeGeometry(0.16, 0.18, 8), straw)
    cap.name = 'HeadWrap'
    cap.position.y = 1.5
    root.add(cap)

    return shadows(root)
}

export function createStone(): Group {
    const root = new Group()
    root.name = 'LooseStone'
    const rock = material(0x6f7479, 0.92)
    const core = new Mesh(new SphereGeometry(0.28, 10, 8), rock)
    core.name = 'StoneCore'
    core.scale.set(1.08, 0.82, 0.94)
    core.position.y = 0.26
    root.add(core)

    const chip = new Mesh(new ConeGeometry(0.11, 0.16, 5), material(0x5a6065, 0.95))
    chip.name = 'StoneChip'
    chip.position.set(0.12, 0.37, -0.08)
    chip.rotation.set(0.4, 0.25, -0.35)
    root.add(chip)

    return shadows(root)
}
