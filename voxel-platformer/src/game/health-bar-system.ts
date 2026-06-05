import {
    Group,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    type Camera,
    type Scene,
} from 'three'
import { hasComponent, query } from 'bitecs'
import { BoxCollider, Health, PlayerControlled, Position } from '../engine/ecs/components'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { GameWorld } from '../engine/ecs/world'
import { getDebugInfoEnabled, subscribeDebugInfo } from '../engine/render/render-settings'
import { NPC_DEFAULT_HP } from './npcs/npc-types'

const BAR_WIDTH = 0.95
const BAR_HEIGHT = 0.13
const BAR_GAP = 0.28
const PLAYER_BAR_ID = 'player'

interface BarTarget {
    id: string
    x: number
    y: number
    z: number
    /** 0..1 fill. */
    frac: number
}

interface Bar {
    group: Group
    fill: Mesh
    fillMaterial: MeshBasicMaterial
}

/**
 * Debug-only floating HP bars above the player and every live NPC. A small
 * billboarded background + fill quad pair per entity, rendered over the top of
 * geometry (depthTest off) so they read even through walls. Gated by the global
 * debug toggle, alongside the collider hit boxes (debug overlay for ECS
 * entities, npc-render for NPCs).
 */
export function createHealthBarSystem(scene: Scene, camera: () => Camera): System {
    const root = new Group()
    root.name = 'HealthBars'
    root.renderOrder = 10_001
    const geometry = new PlaneGeometry(1, 1)
    const bgMaterial = new MeshBasicMaterial({
        color: 0x10161a,
        transparent: true,
        opacity: 0.78,
        depthTest: false,
        depthWrite: false,
    })
    const bars = new Map<string, Bar>()
    const targets: BarTarget[] = []
    let enabled = getDebugInfoEnabled()
    let unsubscribe: (() => void) | null = null

    function buildBar(): Bar {
        const group = new Group()
        const bg = new Mesh(geometry, bgMaterial)
        bg.scale.set(BAR_WIDTH, BAR_HEIGHT, 1)
        bg.renderOrder = 10_001
        group.add(bg)
        const fillMaterial = new MeshBasicMaterial({
            color: 0x57d364,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
            depthWrite: false,
        })
        const fill = new Mesh(geometry, fillMaterial)
        fill.renderOrder = 10_002
        // Nudge the fill toward the camera-facing side so it never z-fights the bg.
        fill.position.z = 0.001
        group.add(fill)
        root.add(group)
        return { group, fill, fillMaterial }
    }

    function collectTargets(world: GameWorld): void {
        targets.length = 0
        const players = query(world, [PlayerControlled, Position, Health])
        for (let i = 0; i < players.length; i++) {
            const eid = players[i]!
            const max = Health.max[eid]!
            if (max <= 0) continue
            const height = hasComponent(world, eid, BoxCollider) ? BoxCollider.y[eid]! * 2 : 1.8
            targets.push({
                id: PLAYER_BAR_ID,
                x: Position.x[eid]!,
                y: Position.y[eid]! + height + BAR_GAP,
                z: Position.z[eid]!,
                frac: clamp01(Health.current[eid]! / max),
            })
        }
        for (const npc of world.npcRuntimeById.values()) {
            if (npc.dying) continue
            const max = npc.maxHp ?? NPC_DEFAULT_HP
            targets.push({
                id: npc.id,
                x: npc.position.x,
                y: npc.position.y + npc.colliderHeight + BAR_GAP,
                z: npc.position.z,
                frac: clamp01(npc.hp / max),
            })
        }
    }

    function syncBars(cam: Camera): void {
        const live = new Set<string>()
        for (const target of targets) {
            live.add(target.id)
            const bar = bars.get(target.id) ?? (() => {
                const made = buildBar()
                bars.set(target.id, made)
                return made
            })()
            bar.group.position.set(target.x, target.y, target.z)
            // Billboard: face the (fixed iso) camera.
            bar.group.quaternion.copy(cam.quaternion)
            bar.group.visible = true
            const frac = target.frac
            bar.fill.scale.set(Math.max(0.0001, BAR_WIDTH * frac), BAR_HEIGHT * 0.74, 1)
            // Grow from the left edge: shift left by half the missing width.
            bar.fill.position.x = -(BAR_WIDTH * (1 - frac)) / 2
            bar.fillMaterial.color.setHex(fillColor(frac))
        }
        for (const [id, bar] of bars) {
            if (live.has(id)) continue
            root.remove(bar.group)
            bar.fillMaterial.dispose()
            bars.delete(id)
        }
    }

    return {
        name: 'healthBars',
        order: RenderOrder.worldRender + 6,
        init(world) {
            scene.add(root)
            root.visible = enabled
            unsubscribe = subscribeDebugInfo((next) => {
                enabled = next
                root.visible = next
            })
            void world
        },
        update(world) {
            if (!enabled) return
            collectTargets(world as GameWorld)
            syncBars(camera())
        },
        dispose() {
            for (const [, bar] of bars) bar.fillMaterial.dispose()
            bars.clear()
            scene.remove(root)
            geometry.dispose()
            bgMaterial.dispose()
            unsubscribe?.()
            unsubscribe = null
        },
    }
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0
    return value < 0 ? 0 : value > 1 ? 1 : value
}

function fillColor(frac: number): number {
    if (frac > 0.5) return 0x57d364
    if (frac > 0.25) return 0xe7c14a
    return 0xe2614a
}
