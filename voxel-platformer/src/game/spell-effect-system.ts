import {
    AdditiveBlending,
    Mesh,
    MeshBasicMaterial,
    RingGeometry,
    type Scene,
} from 'three'
import type { System } from '../engine/ecs/systems/system'
import { FixedOrder, RenderOrder } from '../engine/ecs/systems/orders'
import type { GameWorld, SpellWaveEffect } from '../engine/ecs/world'
import { damageNpc } from './npcs/npc-types'

/**
 * Advances every active spell shockwave by `dt`: grows the wavefront and lands a
 * single hit on each NPC as the front sweeps past it, then retires the wave once
 * it has fully expanded and faded. Pure + deterministic so it can run in the
 * fixed step and be unit-tested directly.
 */
export function advanceSpellWaves(world: GameWorld, dt: number): void {
    const effects = world.spellEffects
    for (let i = effects.length - 1; i >= 0; i--) {
        const fx = effects[i]!
        fx.age += dt
        fx.radius = Math.min(fx.maxRadius, fx.radius + fx.speed * dt)
        const r2 = fx.radius * fx.radius
        for (const npc of world.npcRuntimeById.values()) {
            if (npc.dying) continue
            if (fx.hit.includes(npc.id)) continue
            const dx = npc.position.x - fx.x
            const dz = npc.position.z - fx.z
            if (dx * dx + dz * dz > r2) continue
            if (Math.abs(npc.position.y - fx.y) > fx.vertical) continue
            fx.hit.push(npc.id)
            damageNpc(npc, fx.damage)
        }
        if (fx.age >= fx.ttl) effects.splice(i, 1)
    }
}

/** Fixed-step driver for {@link advanceSpellWaves}. */
export function createSpellEffectSystem(): System {
    return {
        name: 'spellEffects',
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world, dt) {
            advanceSpellWaves(world as GameWorld, dt)
        },
    }
}

/**
 * Draws each active spell wave as a flat, expanding ring on the ground so the
 * frost burst is legible — you can see the front roll outward and pass over the
 * enemies it hits. Pools ring meshes; opacity fades over the wave's lifetime.
 */
export function createSpellEffectRenderSystem(scene: Scene): System {
    const geometry = new RingGeometry(0.82, 1, 40)
    const meshes: Mesh[] = []

    function meshAt(index: number): Mesh {
        let mesh = meshes[index]
        if (!mesh) {
            const material = new MeshBasicMaterial({
                color: 0x9fe0ff,
                transparent: true,
                opacity: 0.6,
                depthWrite: false,
                blending: AdditiveBlending,
            })
            mesh = new Mesh(geometry, material)
            mesh.rotation.x = -Math.PI / 2 // lay the ring flat on the ground
            mesh.renderOrder = 9_000
            mesh.visible = false
            scene.add(mesh)
            meshes[index] = mesh
        }
        return mesh
    }

    return {
        name: 'spellEffectsRender',
        order: RenderOrder.worldRender + 7,
        update(world) {
            const effects = (world as GameWorld).spellEffects
            for (let i = 0; i < effects.length; i++) {
                const fx = effects[i]!
                const mesh = meshAt(i)
                mesh.visible = true
                mesh.position.set(fx.x, fx.y + 0.08, fx.z)
                const radius = Math.max(0.001, fx.radius)
                mesh.scale.set(radius, radius, radius)
                const fade = 1 - fx.age / fx.ttl
                ;(mesh.material as MeshBasicMaterial).opacity = 0.6 * Math.max(0, fade)
            }
            for (let i = effects.length; i < meshes.length; i++) meshes[i]!.visible = false
        },
        dispose() {
            for (const mesh of meshes) {
                scene.remove(mesh)
                ;(mesh.material as MeshBasicMaterial).dispose()
            }
            meshes.length = 0
            geometry.dispose()
        },
    }
}
