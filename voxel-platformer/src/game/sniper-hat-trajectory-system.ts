import { hasComponent, query } from 'bitecs'
import {
    BufferGeometry,
    Color,
    DoubleSide,
    Group,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    RingGeometry,
    SphereGeometry,
    Vector3,
    type Scene,
} from 'three'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { voxelRaycast } from '../engine/voxel/voxel-raycast'
import { isCollidable } from '../engine/voxel/palette'
import { segmentAabbEntry } from '../engine/math/segment-aabb'
import {
    ClimbingLadder,
    Grounded,
    PlayerControlled,
    Position,
    Rotation,
    Stunned,
} from '../engine/ecs/components'
import { DEFAULT_PHYSICS_GRAVITY } from '../engine/ecs/systems/physics-system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { GameWorld } from '../engine/ecs/world'
import { effectivePlayerArrowLift, effectivePlayerArrowSpeed } from './equipment-effects'
import { SNIPER_HAT_ITEM_ID } from './equipment-items'

const ARROW_PREVIEW_STEP_SECONDS = 1 / 60
const ARROW_PREVIEW_MAX_SECONDS = 2.4
const ARROW_PREVIEW_MUZZLE_FORWARD = 0.55
const ARROW_PREVIEW_MUZZLE_Y = 1.05

export interface ArrowTrajectoryPrediction {
    points: Vector3[]
    hit: null | {
        kind: 'npc' | 'voxel'
        position: Vector3
    }
}

export function createSniperHatTrajectorySystem(scene: Scene, chunks: ChunkManager): System {
    let root: Group | null = null
    let line: Line<BufferGeometry, LineBasicMaterial> | null = null
    let hitMarker: Group | null = null
    let markerCoreMaterial: MeshBasicMaterial | null = null

    return {
        name: 'sniperHatTrajectory',
        order: RenderOrder.worldRender + 8,
        init() {
            root = new Group()
            root.name = 'SniperHatTrajectoryPreview'
            root.visible = false
            const lineGeometry = new BufferGeometry()
            const lineMaterial = new LineBasicMaterial({
                color: 0x80d8ff,
                transparent: true,
                opacity: 0.78,
                depthTest: false,
                depthWrite: false,
            })
            line = new Line(lineGeometry, lineMaterial)
            line.name = 'SniperHatTrajectoryLine'
            line.frustumCulled = false

            markerCoreMaterial = new MeshBasicMaterial({
                color: 0xffe083,
                transparent: true,
                opacity: 0.92,
                depthTest: false,
                depthWrite: false,
            })
            hitMarker = createHitMarker(markerCoreMaterial)
            root.add(line, hitMarker)
            scene.add(root)
        },
        update(world) {
            if (!root || !line || !hitMarker || !markerCoreMaterial) return
            const player = firstSniperPreviewPlayer(world)
            if (player === null) {
                root.visible = false
                return
            }
            const prediction = predictSniperArrowTrajectory(world, chunks, player)
            if (prediction.points.length < 2) {
                root.visible = false
                return
            }
            line.geometry.setFromPoints(prediction.points)
            hitMarker.visible = prediction.hit !== null
            if (prediction.hit) {
                hitMarker.position.copy(prediction.hit.position)
                markerCoreMaterial.color.copy(prediction.hit.kind === 'npc' ? NPC_HIT_COLOR : TERRAIN_HIT_COLOR)
            }
            root.visible = true
        },
        dispose() {
            if (root) scene.remove(root)
            line?.geometry.dispose()
            line?.material.dispose()
            hitMarker?.traverse((obj) => {
                if (obj instanceof Mesh) {
                    obj.geometry.dispose()
                    if (Array.isArray(obj.material)) {
                        for (const material of obj.material) material.dispose()
                    } else {
                        obj.material.dispose()
                    }
                }
            })
            root = null
            line = null
            hitMarker = null
            markerCoreMaterial = null
        },
    }
}

const NPC_HIT_COLOR = new Color(0xff7a4f)
const TERRAIN_HIT_COLOR = new Color(0xffe083)

function createHitMarker(coreMaterial: MeshBasicMaterial): Group {
    const group = new Group()
    group.name = 'SniperHatHitMarker'
    const core = new Mesh(new SphereGeometry(0.08, 10, 8), coreMaterial)
    core.name = 'SniperHatHitCore'
    const ringMat = new MeshBasicMaterial({
        color: 0xffe083,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
    })
    const ring = new Mesh(new RingGeometry(0.18, 0.21, 24), ringMat)
    ring.name = 'SniperHatHitRing'
    ring.rotation.x = -Math.PI / 2
    group.add(core, ring)
    return group
}

function firstSniperPreviewPlayer(world: GameWorld): number | null {
    const players = query(world, [PlayerControlled, Position, Rotation])
    if (players.length === 0) return null
    const player = players[0]!
    if (!sniperTrajectoryPreviewEnabled(world, player)) return null
    return player
}

export function sniperTrajectoryPreviewEnabled(world: GameWorld, player: number): boolean {
    return world.playerSettings.equipment.head === SNIPER_HAT_ITEM_ID &&
        world.weaponStance === 'ranged' &&
        world.playerSettings.abilities.bow &&
        world.inventory.arrows > 0 &&
        hasComponent(world, player, Grounded) &&
        !hasComponent(world, player, Stunned) &&
        !hasComponent(world, player, ClimbingLadder)
}

export function predictSniperArrowTrajectory(
    world: GameWorld,
    chunks: ChunkManager,
    player: number,
): ArrowTrajectoryPrediction {
    const yaw = Rotation.y[player]!
    const forwardX = Math.sin(yaw)
    const forwardZ = Math.cos(yaw)
    const current = new Vector3(
        Position.x[player]! + forwardX * ARROW_PREVIEW_MUZZLE_FORWARD,
        Position.y[player]! + ARROW_PREVIEW_MUZZLE_Y,
        Position.z[player]! + forwardZ * ARROW_PREVIEW_MUZZLE_FORWARD,
    )
    const velocity = new Vector3(
        forwardX * effectivePlayerArrowSpeed(world.playerSettings),
        effectivePlayerArrowLift(world.playerSettings),
        forwardZ * effectivePlayerArrowSpeed(world.playerSettings),
    )
    const points = [current.clone()]
    const steps = Math.ceil(ARROW_PREVIEW_MAX_SECONDS / ARROW_PREVIEW_STEP_SECONDS)
    for (let i = 0; i < steps; i++) {
        const prev = current.clone()
        velocity.y -= DEFAULT_PHYSICS_GRAVITY * ARROW_PREVIEW_STEP_SECONDS
        current.addScaledVector(velocity, ARROW_PREVIEW_STEP_SECONDS)
        const hit = firstTrajectoryHit(world, chunks, prev, current)
        if (hit) {
            points.push(hit.position.clone())
            return { points, hit }
        }
        points.push(current.clone())
    }
    return { points, hit: null }
}

function firstTrajectoryHit(
    world: GameWorld,
    chunks: ChunkManager,
    start: Vector3,
    end: Vector3,
): ArrowTrajectoryPrediction['hit'] {
    const segment = end.clone().sub(start)
    const segLen = segment.length()
    if (segLen <= 1e-6) return null
    const dir = segment.multiplyScalar(1 / segLen)
    const npcHit = nearestPreviewNpcHit(world, start, dir, segLen)
    const wallHit = voxelRaycast(chunks, start, dir, segLen, isCollidable)
    const wallT = wallHit?.t ?? Infinity
    const npcT = npcHit?.t ?? Infinity
    if (npcT === Infinity && wallT === Infinity) return null
    if (npcT <= wallT) {
        return {
            kind: 'npc',
            position: start.clone().addScaledVector(dir, npcT),
        }
    }
    return {
        kind: 'voxel',
        position: start.clone().addScaledVector(dir, wallT),
    }
}

function nearestPreviewNpcHit(
    world: GameWorld,
    start: Vector3,
    dir: Vector3,
    segLen: number,
): { t: number } | null {
    let best: { t: number } | null = null
    for (const npc of world.npcRuntimeById.values()) {
        if (npc.dying) continue
        const r = npc.colliderRadius
        const t = segmentAabbEntry(
            start.x, start.y, start.z,
            dir.x, dir.y, dir.z,
            segLen,
            npc.position.x - r, npc.position.y, npc.position.z - r,
            npc.position.x + r, npc.position.y + npc.colliderHeight, npc.position.z + r,
        )
        if (t !== null && (best === null || t < best.t)) best = { t }
    }
    return best
}
