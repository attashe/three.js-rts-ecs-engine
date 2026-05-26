import {
    AdditiveBlending,
    Color,
    Group,
    Mesh,
    MeshBasicMaterial,
    PointLight,
} from 'three'
import {
    sharedCylinderGeometry,
    sharedMaterial,
    sharedSphereGeometry,
} from './shared-primitives'

export const PLAYER_TORCH_LIGHT = 'playerTorchLight'
export const PLAYER_TORCH_FLAME = 'playerTorchFlame'

export interface PlayerTorchLightUserData {
    baseIntensity: number
    baseDistance: number
    phase: number
}

export function createPlayerTorch(): Group {
    const root = new Group()
    root.name = 'PlayerTorch'

    const handle = new Mesh(sharedCylinderGeometry(0.025, 0.034, 0.58, 10), sharedMaterial(0x4a2715, 0.86))
    handle.name = 'TorchHandle'
    handle.position.y = 0.22
    handle.castShadow = true
    handle.receiveShadow = true
    root.add(handle)

    const head = new Mesh(sharedCylinderGeometry(0.07, 0.06, 0.13, 12), sharedMaterial(0x1c1510, 0.78))
    head.name = 'TorchHead'
    head.position.y = 0.54
    head.castShadow = true
    head.receiveShadow = true
    root.add(head)

    const outerFlameMaterial = glowingFlameMaterial(0xff7a24, 0.9)
    const flame = new Mesh(sharedSphereGeometry(0.1, 18, 12), outerFlameMaterial)
    flame.name = 'TorchFlame'
    flame.position.y = 0.74
    flame.scale.set(0.74, 1.75, 0.74)
    flame.userData[PLAYER_TORCH_FLAME] = true
    root.add(flame)

    const innerFlameMaterial = glowingFlameMaterial(0xffe083, 0.92)
    const core = new Mesh(sharedSphereGeometry(0.065, 16, 10), innerFlameMaterial)
    core.name = 'TorchFlameCore'
    core.position.y = 0.7
    core.scale.set(0.72, 1.28, 0.72)
    core.userData[PLAYER_TORCH_FLAME] = true
    root.add(core)

    const flickerPhase = Math.random() * Math.PI * 2

    const light = new PointLight(new Color(0xffb05f), 7.6, 14, 1.25)
    light.name = 'PlayerTorchLight'
    light.position.set(0, 0.71, 0.04)
    // The torch fill is intentionally unshadowed. A point light sits
    // inside the player's chest, so omnidirectional shadow casting
    // projected the player body (cape/arms) and any nearby block —
    // including ones above the head — as hard wedges across the lit
    // pool. The fill is small (14u) and only ever near the player,
    // so dropping shadows reads as "magic torchlight" rather than a
    // missing feature.
    light.castShadow = false
    light.userData[PLAYER_TORCH_LIGHT] = {
        baseIntensity: light.intensity,
        baseDistance: light.distance,
        phase: flickerPhase,
    } satisfies PlayerTorchLightUserData
    root.add(light)

    return root
}

function glowingFlameMaterial(color: number, opacity: number): MeshBasicMaterial {
    const material = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
    })
    material.blending = AdditiveBlending
    material.toneMapped = false
    return material
}
