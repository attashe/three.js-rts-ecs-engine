import {
    BufferGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Quaternion,
    Vector3,
} from 'three'
import {
    sharedBoxGeometry,
    sharedCapsuleGeometry,
    sharedConeGeometry,
    sharedCylinderGeometry,
    sharedMaterial,
    sharedSphereGeometry,
} from './shared-primitives'

function metal(): MeshStandardMaterial {
    return sharedMaterial(0xb9c4cf, 0.48, 0.45)
}

function darkMetal(): MeshStandardMaterial {
    return sharedMaterial(0x59636f, 0.55, 0.35)
}

function leather(): MeshStandardMaterial {
    return sharedMaterial(0x5a351e, 0.82)
}

function darkLeather(): MeshStandardMaterial {
    return sharedMaterial(0x2c1d16, 0.9)
}

function wood(): MeshStandardMaterial {
    return sharedMaterial(0x8a5a2b, 0.75)
}

function stringMaterial(): MeshStandardMaterial {
    return sharedMaterial(0xe7d9b1, 0.7)
}

function fletching(): MeshStandardMaterial {
    return sharedMaterial(0xc74235, 0.65)
}

export interface SwordOptions {
    bladeLength?: number
    bladeWidth?: number
    hiltLength?: number
}

export interface BowOptions {
    height?: number
    width?: number
}

export interface QuiverOptions {
    arrowCount?: number
}

export interface ShieldOptions {
    width?: number
    height?: number
    color?: number
    rimColor?: number
    bossColor?: number
}

export function createSword(options: SwordOptions = {}): Group {
    const bladeLength = options.bladeLength ?? 1.25
    const bladeWidth = options.bladeWidth ?? 0.16
    const hiltLength = options.hiltLength ?? 0.36
    const root = new Group()
    root.name = 'Sword'

    const grip = new Mesh(sharedCylinderGeometry(0.055, 0.06, hiltLength, 8), leather())
    grip.name = 'SwordGrip'
    grip.position.y = hiltLength * 0.5
    root.add(grip)

    const pommel = new Mesh(sharedBoxGeometry(0.18, 0.08, 0.16), darkMetal())
    pommel.name = 'SwordPommel'
    pommel.position.y = -0.035
    root.add(pommel)

    const guard = new Mesh(sharedBoxGeometry(0.52, 0.07, 0.1), darkMetal())
    guard.name = 'SwordGuard'
    guard.position.y = hiltLength + 0.02
    root.add(guard)

    const blade = new Mesh(sharedBoxGeometry(bladeWidth, bladeLength, 0.045), metal())
    blade.name = 'SwordBlade'
    blade.position.y = hiltLength + bladeLength * 0.5 + 0.06
    root.add(blade)

    const tip = new Mesh(sharedConeGeometry(bladeWidth * 0.72, bladeWidth * 1.35, 4), metal())
    tip.name = 'SwordTip'
    tip.rotation.y = Math.PI * 0.25
    tip.position.y = hiltLength + bladeLength + bladeWidth * 0.68 + 0.06
    root.add(tip)

    enableShadows(root)
    return root
}

export function createBow(options: BowOptions = {}): Group {
    const height = options.height ?? 1.45
    const width = options.width ?? 0.44
    const root = new Group()
    root.name = 'Bow'

    const half = height * 0.5
    const upperGrip = new Vector3(width * 0.18, 0.08, 0)
    const lowerGrip = new Vector3(width * 0.18, -0.08, 0)
    const upperMid = new Vector3(width, half * 0.45, 0)
    const lowerMid = new Vector3(width, -half * 0.45, 0)
    const upperTip = new Vector3(width * 0.42, half, 0)
    const lowerTip = new Vector3(width * 0.42, -half, 0)

    const bowWood = wood()
    root.add(createCylinderBetween(upperGrip, upperMid, 0.035, bowWood, 'BowUpperInner'))
    root.add(createCylinderBetween(upperMid, upperTip, 0.03, bowWood, 'BowUpperOuter'))
    root.add(createCylinderBetween(lowerGrip, lowerMid, 0.035, bowWood, 'BowLowerInner'))
    root.add(createCylinderBetween(lowerMid, lowerTip, 0.03, bowWood, 'BowLowerOuter'))

    const grip = new Mesh(sharedCapsuleGeometry(0.075, 0.18, 4, 8), darkLeather())
    grip.name = 'BowGrip'
    grip.rotation.z = Math.PI * 0.5
    root.add(grip)

    const string = stringMaterial()
    root.add(createCylinderBetween(upperTip, new Vector3(-width * 0.18, 0, 0), 0.008, string, 'BowStringUpper'))
    root.add(createCylinderBetween(lowerTip, new Vector3(-width * 0.18, 0, 0), 0.008, string, 'BowStringLower'))

    enableShadows(root)
    return root
}

export function createArrow(): Group {
    const root = new Group()
    root.name = 'Arrow'

    const shaft = new Mesh(sharedCylinderGeometry(0.014, 0.014, 0.82, 6), wood())
    shaft.name = 'ArrowShaft'
    shaft.rotation.z = Math.PI * 0.5
    root.add(shaft)

    const head = new Mesh(sharedConeGeometry(0.045, 0.12, 4), metal())
    head.name = 'ArrowHead'
    head.rotation.z = -Math.PI * 0.5
    head.rotation.y = Math.PI * 0.25
    head.position.x = 0.47
    root.add(head)

    const leftFeather = new Mesh(sharedBoxGeometry(0.12, 0.035, 0.012), fletching())
    leftFeather.name = 'ArrowFletchingLeft'
    leftFeather.position.set(-0.35, 0.035, 0)
    leftFeather.rotation.z = -0.35
    root.add(leftFeather)

    const rightFeather = leftFeather.clone()
    rightFeather.name = 'ArrowFletchingRight'
    rightFeather.position.y = -0.035
    rightFeather.rotation.z = 0.35
    root.add(rightFeather)

    enableShadows(root)
    return root
}

/** A glowing arcane projectile fired from the staff (magician loadout). Emissive
 *  so it reads as light even in shadow; small trailing wisps give it heading. */
export function createMagicBolt(): Group {
    const root = new Group()
    root.name = 'MagicBolt'

    const coreMat = new MeshStandardMaterial({
        color: 0xcfe9ff,
        emissive: 0x4aa8ff,
        emissiveIntensity: 2.4,
        roughness: 0.3,
        metalness: 0,
    })
    const core = new Mesh(sharedSphereGeometry(0.13, 12, 12), coreMat)
    core.name = 'MagicBoltCore'
    root.add(core)

    const haloMat = new MeshStandardMaterial({
        color: 0x9fd0ff,
        emissive: 0x2f7fe0,
        emissiveIntensity: 1.4,
        roughness: 0.6,
        metalness: 0,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
    })
    const halo = new Mesh(sharedSphereGeometry(0.2, 10, 10), haloMat)
    halo.name = 'MagicBoltHalo'
    root.add(halo)

    return root
}

export function createQuiver(options: QuiverOptions = {}): Group {
    const arrowCount = options.arrowCount ?? 5
    const root = new Group()
    root.name = 'Quiver'

    const body = new Mesh(sharedCylinderGeometry(0.18, 0.14, 0.72, 10, 1, true), leather())
    body.name = 'QuiverBody'
    body.rotation.x = -0.22
    root.add(body)

    const bottom = new Mesh(sharedCylinderGeometry(0.14, 0.14, 0.035, 10), darkLeather())
    bottom.name = 'QuiverBottom'
    bottom.position.y = -0.36
    bottom.rotation.x = body.rotation.x
    root.add(bottom)

    const strap = new Mesh(sharedBoxGeometry(0.055, 0.86, 0.045), darkLeather())
    strap.name = 'QuiverStrap'
    strap.position.set(-0.16, 0.02, 0.12)
    strap.rotation.z = -0.28
    root.add(strap)

    for (let i = 0; i < arrowCount; i++) {
        const angle = (i / Math.max(1, arrowCount)) * Math.PI * 2
        const radius = 0.075
        const arrow = createArrow()
        arrow.name = `QuiverArrow${i + 1}`
        arrow.scale.setScalar(0.58)
        arrow.position.set(Math.cos(angle) * radius, 0.4 + (i % 2) * 0.045, Math.sin(angle) * radius)
        arrow.rotation.z = Math.PI * 0.5
        arrow.rotation.y = -0.18 + i * 0.04
        root.add(arrow)
    }

    enableShadows(root)
    return root
}

export function createShield(options: ShieldOptions = {}): Group {
    const width = options.width ?? 0.46
    const height = options.height ?? 0.72
    const face = sharedMaterial(options.color ?? 0x2f5e8f, 0.62, 0.08)
    const rim = sharedMaterial(options.rimColor ?? 0xb9c4cf, 0.42, 0.45)
    const bossMat = sharedMaterial(options.bossColor ?? 0xd6c277, 0.38, 0.35)

    const root = new Group()
    root.name = 'Shield'

    const body = new Mesh(sharedBoxGeometry(width, height, 0.055), face)
    body.name = 'ShieldFace'
    root.add(body)

    const top = new Mesh(sharedBoxGeometry(width + 0.08, 0.055, 0.075), rim)
    top.name = 'ShieldTopRim'
    top.position.y = height * 0.5
    root.add(top)

    const bottom = top.clone()
    bottom.name = 'ShieldBottomRim'
    bottom.position.y = -height * 0.5
    root.add(bottom)

    const left = new Mesh(sharedBoxGeometry(0.055, height + 0.08, 0.075), rim)
    left.name = 'ShieldLeftRim'
    left.position.x = -width * 0.5
    root.add(left)

    const right = left.clone()
    right.name = 'ShieldRightRim'
    right.position.x = width * 0.5
    root.add(right)

    const boss = new Mesh(sharedCylinderGeometry(0.12, 0.14, 0.055, 16), bossMat)
    boss.name = 'ShieldBoss'
    boss.rotation.x = Math.PI * 0.5
    boss.position.z = 0.052
    root.add(boss)

    const strap = new Mesh(sharedBoxGeometry(0.28, 0.055, 0.035), darkLeather())
    strap.name = 'ShieldGrip'
    strap.position.z = -0.055
    root.add(strap)

    enableShadows(root)
    return root
}

function createCylinderBetween(
    start: Vector3,
    end: Vector3,
    radius: number,
    material: MeshStandardMaterial,
    name: string,
): Mesh<BufferGeometry, MeshStandardMaterial> {
    const direction = new Vector3().subVectors(end, start)
    const length = direction.length()
    const mesh = new Mesh(sharedCylinderGeometry(radius, radius, length, 8), material)
    mesh.name = name
    mesh.position.copy(start).add(end).multiplyScalar(0.5)
    mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()))
    return mesh
}

function enableShadows(root: Object3D): void {
    root.traverse((child) => {
        if (child instanceof Mesh) {
            child.castShadow = true
            child.receiveShadow = true
        }
    })
}
