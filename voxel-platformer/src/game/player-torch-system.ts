import { Mesh, MeshBasicMaterial, PointLight, type Object3D } from 'three'
import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import {
    PLAYER_TORCH_FLAME,
    PLAYER_TORCH_LIGHT,
    type PlayerTorchLightUserData,
} from './assets'

interface TorchRuntime {
    light: PointLight
    flame: TorchFlameRuntime[]
    data: PlayerTorchLightUserData
}

interface TorchFlameRuntime {
    mesh: Mesh
    baseScale: { x: number; y: number; z: number }
}

export function createPlayerTorchSystem(): System {
    const torches: TorchRuntime[] = []
    let elapsed = 0
    let rescanTimer = 0

    return {
        name: 'playerTorch',
        order: RenderOrder.renderSync + 5,
        init(world) {
            collectTorches(world.object3DByEid.values(), torches)
        },
        update(world, dt) {
            elapsed += dt
            rescanTimer -= dt
            if (rescanTimer <= 0) {
                rescanTimer = 1
                collectTorches(world.object3DByEid.values(), torches)
            }

            for (let i = torches.length - 1; i >= 0; i--) {
                const torch = torches[i]!
                if (!torch.light.parent) {
                    torches.splice(i, 1)
                    continue
                }

                const pulse = flicker(elapsed, torch.data.phase)
                torch.light.intensity = torch.data.baseIntensity * (0.88 + pulse * 0.38)
                torch.light.distance = torch.data.baseDistance * (0.96 + pulse * 0.12)
                torch.light.color.setHSL(0.078 + pulse * 0.014, 1, 0.6 + pulse * 0.12)

                const flameY = 0.92 + pulse * 0.24
                const flameXZ = 0.93 + (1 - pulse) * 0.1
                for (const flame of torch.flame) {
                    flame.mesh.scale.set(
                        flame.baseScale.x * flameXZ,
                        flame.baseScale.y * flameY,
                        flame.baseScale.z * flameXZ,
                    )
                    if (flame.mesh.material instanceof MeshBasicMaterial) {
                        flame.mesh.material.opacity = 0.76 + pulse * 0.2
                    }
                }
            }
        },
    }
}

function collectTorches(objects: Iterable<Object3D>, out: TorchRuntime[]): void {
    const known = new Set(out.map((entry) => entry.light))
    for (const root of objects) {
        const flames: TorchFlameRuntime[] = []
        const lights: TorchRuntime[] = []
        root.traverse((obj) => {
            if (obj instanceof Mesh && obj.userData[PLAYER_TORCH_FLAME]) {
                flames.push({
                    mesh: obj,
                    baseScale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
                })
                return
            }
            if (!(obj instanceof PointLight)) return
            const data = obj.userData[PLAYER_TORCH_LIGHT] as PlayerTorchLightUserData | undefined
            if (!data || known.has(obj)) return
            lights.push({ light: obj, flame: flames, data })
            known.add(obj)
        })
        out.push(...lights)
    }
}

function flicker(elapsed: number, phase: number): number {
    const a = Math.sin(elapsed * 12.7 + phase) * 0.5 + 0.5
    const b = Math.sin(elapsed * 23.1 + phase * 1.7) * 0.5 + 0.5
    const c = Math.sin(elapsed * 7.3 + phase * 0.4) * 0.5 + 0.5
    return Math.max(0, Math.min(1, a * 0.5 + b * 0.32 + c * 0.18))
}
