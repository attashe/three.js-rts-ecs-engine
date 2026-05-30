import { addComponents, addComponent, hasComponent, query, removeComponent } from 'bitecs'
import {
    BoxGeometry,
    ConeGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    type Object3D,
} from 'three'
import type { ActionMap } from '../../engine/input/actions'
import { GameAction } from '../actions'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { isCollidable, isRailBlock } from '../../engine/voxel/palette'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import {
    BoxCollider,
    MovingObject,
    Position,
    RailCart,
    Renderable,
    RigidBody,
    RidingCart,
    Rotation,
    Velocity,
} from '../../engine/ecs/components'
import {
    pushLog,
    type GameWorld,
    type RailCartConfig,
    type RailCartFacing,
    type RailCartRuntime,
    type VoxelCoord,
} from '../../engine/ecs/world'
import { createEntity, despawnEntity } from '../../engine/ecs/entity'
import { aabbFromCenter, aabbFromFoot, voxelAABBOverlap, type AABB } from '../../engine/voxel/voxel-collide'
import { MovingObjectKind } from '../moving-objects'
import {
    chooseRailExit,
    maskHas,
    oppositeDirection,
    railConnectionMask,
    railNeighborCell,
    RailDirection,
    type RailDirection as RailDir,
} from './rail-network'

export interface RailCartSystemOptions {
    actions: ActionMap
}

const DEFAULT_CART_SPEED = 4
const DEFAULT_INTERACTION_RADIUS = 1.65
const CART_HALF = { x: 0.43, y: 0.28, z: 0.43 }
const PLAYER_SEAT_Y = 0.34
const VOXEL_EPS = 1e-6
const tmpAabb: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
const tmpCartAabb: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
const tmpEntityAabb: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
const tmpExclude = new Set<number>()

export function createRailCartSystem(
    chunks: ChunkManager,
    carts: readonly RailCartConfig[],
    opts: RailCartSystemOptions,
): System {
    return {
        name: 'railCarts',
        fixed: true,
        order: FixedOrder.input + 4,
        init(world) {
            for (const config of carts) registerRailCart(world, chunks, config)
        },
        update(world, dt) {
            for (const cart of world.railCarts) updateCart(world, chunks, opts.actions, cart, dt)
        },
        dispose() {
            // The active world is supplied to `dispose` only through closure-free
            // system APIs elsewhere, so cart cleanup happens in clearRuntimeWorld.
            // Runtime location swaps call `clearRuntimeWorld` immediately after
            // slot disposal; this system owns no DOM or scene resources itself.
        },
    }
}

export interface RailCartInteractionTarget {
    id: string
    prompt: string
    anchor: VoxelCoord
    distanceSq: number
    interact(world: GameWorld, player: { eid: number; x: number; y: number; z: number }): void
}

export function nearestRailCartInteractionTarget(
    world: GameWorld,
    player: { eid: number; x: number; y: number; z: number },
    chunks: ChunkManager,
): RailCartInteractionTarget | null {
    const mounted = world.ridingCartByPlayer.get(player.eid)
    if (mounted) {
        return {
            id: `rail-cart:${mounted.id}:leave`,
            prompt: 'Leave cart',
            anchor: cartAnchor(mounted),
            distanceSq: 0,
            interact: () => dismountRailCart(world, chunks, player.eid),
        }
    }

    let best: RailCartInteractionTarget | null = null
    for (const cart of world.railCarts) {
        if (!cart.enabled || cart.occupiedBy !== null) continue
        const anchor = cartAnchor(cart)
        const radius = cart.interactionRadius
        const dx = player.x - anchor.x
        const dy = player.y - anchor.y
        const dz = player.z - anchor.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > radius * radius) continue
        if (best && d2 >= best.distanceSq) continue
        best = {
            id: `rail-cart:${cart.id}:ride`,
            prompt: 'Ride cart',
            anchor,
            distanceSq: d2,
            interact: () => mountRailCart(world, player.eid, cart),
        }
    }
    return best
}

export function registerRailCart(world: GameWorld, chunks: ChunkManager, config: RailCartConfig): RailCartRuntime | null {
    if (!isRailCell(chunks, config.railCell)) {
        pushLog(world, `Rail cart "${config.id}" skipped: no rail at ${formatCell(config.railCell)}.`)
        return null
    }
    const id = uniqueCartId(world, config.id)
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, BoxCollider, RailCart])
    BoxCollider.x[eid] = CART_HALF.x
    BoxCollider.y[eid] = CART_HALF.y
    BoxCollider.z[eid] = CART_HALF.z
    world.object3DByEid.set(eid, createRailCartModel())
    addComponent(world, eid, Renderable)

    const cart: RailCartRuntime = {
        id,
        eid,
        railCell: { ...config.railCell },
        front: normalizeFacing(config.front),
        speed: safePositive(config.speed, DEFAULT_CART_SPEED),
        interactionRadius: safePositive(config.interactionRadius, DEFAULT_INTERACTION_RADIUS),
        enabled: config.enabled !== false,
        occupiedBy: null,
        segment: null,
    }
    world.railCarts.push(cart)
    world.railCartsById.set(cart.id, cart)
    syncCartTransform(cart)
    updateCartObstacle(world, cart)
    return cart
}

export function despawnRailCarts(world: GameWorld): void {
    for (const cart of [...world.railCarts]) {
        if (cart.occupiedBy !== null) {
            world.ridingCartByPlayer.delete(cart.occupiedBy)
            if (hasComponent(world, cart.occupiedBy, RidingCart)) removeComponent(world, cart.occupiedBy, RidingCart)
        }
        world.obstacles.remove(cart.eid)
        despawnEntity(world, cart.eid)
    }
    world.railCarts.length = 0
    world.railCartsById.clear()
    world.ridingCartByPlayer.clear()
}

function updateCart(world: GameWorld, chunks: ChunkManager, actions: ActionMap, cart: RailCartRuntime, dt: number): void {
    if (!cart.enabled) {
        syncRider(world, cart)
        updateCartObstacle(world, cart)
        return
    }
    if (!isRailCell(chunks, cart.railCell)) {
        cart.segment = null
        syncCartTransform(cart)
        syncRider(world, cart)
        updateCartObstacle(world, cart)
        return
    }

    const inputSign = cart.occupiedBy !== null ? cartInput(actions) : 0
    if (!cart.segment && inputSign !== 0) {
        startSegment(chunks, cart, inputSign)
    }
    if (cart.segment && inputSign !== 0) {
        stepSegment(world, chunks, cart, inputSign, dt)
    }

    syncCartTransform(cart)
    syncRider(world, cart)
    updateCartObstacle(world, cart)
}

function startSegment(chunks: ChunkManager, cart: RailCartRuntime, inputSign: 1 | -1): boolean {
    const desired = inputSign > 0
        ? facingToDirection(cart.front)
        : oppositeDirection(facingToDirection(cart.front))
    const next = departDirection(chunks, cart.railCell, desired)
    if (next === null) return false
    const target = railNeighborCell(chunks, cart.railCell, next)?.cell
    if (!target) return false
    cart.segment = {
        from: { ...cart.railCell },
        to: { ...target },
        travelDir: directionToFacing(next),
        inputSign,
        t: 0,
    }
    return true
}

function stepSegment(world: GameWorld, chunks: ChunkManager, cart: RailCartRuntime, inputSign: 1 | -1, dt: number): void {
    const segment = cart.segment
    if (!segment) return
    const step = Math.max(0, cart.speed) * dt
    const nextT = segment.t + (inputSign === segment.inputSign ? step : -step)
    const blockedT = Math.max(0, Math.min(1, nextT))
    if (blockedT !== segment.t && cartBlockedBetween(world, chunks, cart, segment, segment.t, blockedT)) return
    segment.t = nextT
    if (segment.t <= 0) {
        cart.railCell = { ...segment.from }
        cart.segment = null
        return
    }
    if (segment.t < 1) return

    cart.railCell = { ...segment.to }
    const arrivedTravelDir = facingToDirection(segment.travelDir)
    const nextDir = chooseNextDirection(chunks, cart.railCell, arrivedTravelDir)
    if (segment.inputSign > 0) {
        cart.front = nextDir === null ? segment.travelDir : directionToFacing(nextDir)
    } else {
        cart.front = nextDir === null ? oppositeFacing(segment.travelDir) : directionToFacing(oppositeDirection(nextDir))
    }
    cart.segment = null

    if (nextDir !== null && inputSign === segment.inputSign) {
        const to = railNeighborCell(chunks, cart.railCell, nextDir)?.cell
        if (!to) return
        cart.segment = {
            from: { ...cart.railCell },
            to: { ...to },
            travelDir: directionToFacing(nextDir),
            inputSign: segment.inputSign,
            t: 0,
        }
    }
}

function departDirection(chunks: ChunkManager, cell: VoxelCoord, desired: RailDir): RailDir | null {
    const mask = railConnectionMask(chunks, cell.x, cell.y, cell.z)
    if (maskHas(mask, desired)) return desired
    return chooseRailExit(mask, desired)
}

function chooseNextDirection(chunks: ChunkManager, cell: VoxelCoord, travelDir: RailDir): RailDir | null {
    const mask = railConnectionMask(chunks, cell.x, cell.y, cell.z)
    return chooseRailExit(mask, travelDir)
}

function cartInput(actions: ActionMap): 0 | 1 | -1 {
    const forward = actions.isHeld(GameAction.MoveForward)
    const backward = actions.isHeld(GameAction.MoveBackward)
    if (forward === backward) return 0
    return forward ? 1 : -1
}

function mountRailCart(world: GameWorld, player: number, cart: RailCartRuntime): void {
    if (world.ridingCartByPlayer.has(player)) return
    cart.occupiedBy = player
    world.ridingCartByPlayer.set(player, cart)
    addComponent(world, player, RidingCart)
    if (hasComponent(world, player, Velocity)) {
        Velocity.x[player] = 0
        Velocity.y[player] = 0
        Velocity.z[player] = 0
    }
    updateCartObstacle(world, cart)
    syncRider(world, cart)
}

function dismountRailCart(world: GameWorld, chunks: ChunkManager, player: number): void {
    const cart = world.ridingCartByPlayer.get(player)
    if (!cart) return
    const safe = findDismountPosition(world, chunks, cart, player)
    if (!safe) {
        pushLog(world, 'No room to leave the cart.')
        return
    }
    cart.occupiedBy = null
    world.ridingCartByPlayer.delete(player)
    if (hasComponent(world, player, RidingCart)) removeComponent(world, player, RidingCart)
    Position.x[player] = safe.x
    Position.y[player] = safe.y
    Position.z[player] = safe.z
    if (hasComponent(world, player, Velocity)) {
        Velocity.x[player] = 0
        Velocity.y[player] = 0
        Velocity.z[player] = 0
    }
    updateCartObstacle(world, cart)
}

function syncCartTransform(cart: RailCartRuntime): void {
    const pos = cartPosition(cart)
    Position.x[cart.eid] = pos.x
    Position.y[cart.eid] = pos.y
    Position.z[cart.eid] = pos.z
    Rotation.y[cart.eid] = railCartYawForFacing(cart.front)
}

function syncRider(world: GameWorld, cart: RailCartRuntime): void {
    const player = cart.occupiedBy
    if (player === null) return
    if (!world.ridingCartByPlayer.has(player)) return
    const pos = cartPosition(cart)
    Position.x[player] = pos.x
    Position.y[player] = pos.y + PLAYER_SEAT_Y
    Position.z[player] = pos.z
    if (hasComponent(world, player, Velocity)) {
        Velocity.x[player] = 0
        Velocity.y[player] = 0
        Velocity.z[player] = 0
    }
}

function cartPosition(cart: RailCartRuntime): { x: number; y: number; z: number } {
    if (cart.segment) {
        return cartSegmentPosition(cart.segment, cart.segment.t)
    }
    return {
        x: cart.railCell.x + 0.5,
        y: cart.railCell.y + 0.06,
        z: cart.railCell.z + 0.5,
    }
}

function cartSegmentPosition(segment: NonNullable<RailCartRuntime['segment']>, tValue: number): { x: number; y: number; z: number } {
    const t = Math.max(0, Math.min(1, tValue))
    const fromY = segment.from.y + 0.06
    const toY = segment.to.y + 0.06
    return {
        x: segment.from.x + 0.5 + (segment.to.x - segment.from.x) * t,
        y: railSegmentHeight(fromY, toY, t),
        z: segment.from.z + 0.5 + (segment.to.z - segment.from.z) * t,
    }
}

function railSegmentHeight(fromY: number, toY: number, t: number): number {
    if (toY > fromY) {
        return t < 0.5 ? fromY + (toY - fromY) * t * 2 : toY
    }
    if (toY < fromY) {
        return t < 0.5 ? fromY : fromY + (toY - fromY) * (t - 0.5) * 2
    }
    return fromY
}

function cartBlockedAt(
    world: GameWorld,
    chunks: ChunkManager,
    cart: RailCartRuntime,
    segment: NonNullable<RailCartRuntime['segment']>,
    tValue: number,
): boolean {
    const pos = cartSegmentPosition(segment, tValue)
    aabbFromFoot(pos, CART_HALF, tmpCartAabb)
    if (cartVoxelAABBOverlap(chunks, tmpCartAabb, segment)) return true

    tmpExclude.clear()
    tmpExclude.add(cart.eid)
    if (cart.occupiedBy !== null) tmpExclude.add(cart.occupiedBy)
    if (world.obstacles.intersectsExcept(tmpCartAabb, tmpExclude)) return true
    return overlapsActiveStone(world, tmpCartAabb, tmpExclude)
}

function cartBlockedBetween(
    world: GameWorld,
    chunks: ChunkManager,
    cart: RailCartRuntime,
    segment: NonNullable<RailCartRuntime['segment']>,
    fromT: number,
    toT: number,
): boolean {
    const delta = toT - fromT
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.125))
    for (let i = 1; i <= steps; i++) {
        if (cartBlockedAt(world, chunks, cart, segment, fromT + (delta * i) / steps)) return true
    }
    return false
}

function cartVoxelAABBOverlap(
    chunks: ChunkManager,
    aabb: AABB,
    segment: NonNullable<RailCartRuntime['segment']>,
): boolean {
    const x0 = Math.floor(aabb.minX)
    const y0 = Math.floor(aabb.minY)
    const z0 = Math.floor(aabb.minZ)
    const x1 = Math.floor(aabb.maxX - VOXEL_EPS)
    const y1 = Math.floor(aabb.maxY - VOXEL_EPS)
    const z1 = Math.floor(aabb.maxZ - VOXEL_EPS)

    for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) {
                // Sloped rail travel uses a box collider, so ignore only the
                // terrain blocks directly supporting the rail endpoints.
                if (isRailSupportVoxel(segment, x, y, z)) continue
                if (isCollidable(chunks.palette, chunks.getVoxel(x, y, z))) return true
            }
        }
    }
    return false
}

function isRailSupportVoxel(segment: NonNullable<RailCartRuntime['segment']>, x: number, y: number, z: number): boolean {
    return isSupportUnderRailCell(segment.from, x, y, z) || isSupportUnderRailCell(segment.to, x, y, z)
}

function isSupportUnderRailCell(cell: VoxelCoord, x: number, y: number, z: number): boolean {
    return x === cell.x && y === cell.y - 1 && z === cell.z
}

function overlapsActiveStone(world: GameWorld, cartBox: AABB, exclude: ReadonlySet<number>): boolean {
    const colliders = query(world, [Position, BoxCollider, MovingObject])
    for (let i = 0; i < colliders.length; i++) {
        const eid = colliders[i]!
        if (exclude.has(eid)) continue
        if (MovingObject.kind[eid] !== MovingObjectKind.Stone) continue
        const half = { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] }
        const pos = { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] }
        const other = hasComponent(world, eid, RigidBody) && RigidBody.centerAnchored[eid] === 1
            ? aabbFromCenter(pos, half, tmpEntityAabb)
            : aabbFromFoot(pos, half, tmpEntityAabb)
        if (aabbOverlap(cartBox, other)) return true
    }
    return false
}

function aabbOverlap(a: AABB, b: AABB): boolean {
    return a.maxX > b.minX && a.minX < b.maxX &&
        a.maxY > b.minY && a.minY < b.maxY &&
        a.maxZ > b.minZ && a.minZ < b.maxZ
}

function updateCartObstacle(world: GameWorld, cart: RailCartRuntime): void {
    if (cart.occupiedBy !== null || !cart.enabled) {
        world.obstacles.remove(cart.eid)
        return
    }
    aabbFromFoot(cartPosition(cart), CART_HALF, tmpAabb)
    world.obstacles.add(cart.eid, tmpAabb)
}

function findDismountPosition(
    world: GameWorld,
    chunks: ChunkManager,
    cart: RailCartRuntime,
    player: number,
): { x: number; y: number; z: number } | null {
    const pos = cartPosition(cart)
    const front = facingToDirection(cart.front)
    const candidates = [
        rightOf(front),
        oppositeDirection(rightOf(front)),
        oppositeDirection(front),
        front,
    ]
    const half = {
        x: BoxCollider.x[player] || 0.34,
        y: BoxCollider.y[player] || 0.9,
        z: BoxCollider.z[player] || 0.34,
    }
    for (const dir of candidates) {
        const offset = directionOffsetVector(dir)
        const candidate = {
            x: pos.x + offset.x,
            y: pos.y,
            z: pos.z + offset.z,
        }
        aabbFromFoot(candidate, half, tmpAabb)
        if (voxelAABBOverlap(chunks, tmpAabb)) continue
        if (world.obstacles.intersects(tmpAabb, player)) continue
        return candidate
    }
    return null
}

function cartAnchor(cart: RailCartRuntime): VoxelCoord {
    const pos = cartPosition(cart)
    return { x: pos.x, y: pos.y + 0.55, z: pos.z }
}

function isRailCell(chunks: ChunkManager, cell: VoxelCoord): boolean {
    return isRailBlock(chunks.palette, chunks.getVoxel(cell.x, cell.y, cell.z))
}

function uniqueCartId(world: GameWorld, wanted: string): string {
    const root = wanted.trim() || 'rail-cart'
    if (!world.railCartsById.has(root)) return root
    for (let i = 2; i < 1000; i++) {
        const candidate = `${root}-${i}`
        if (!world.railCartsById.has(candidate)) return candidate
    }
    return `${root}-${Date.now()}`
}

function normalizeFacing(value: string | undefined): RailCartFacing {
    return value === 'north' || value === 'east' || value === 'south' || value === 'west'
        ? value
        : 'east'
}

function safePositive(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback
}

function facingToDirection(facing: RailCartFacing): RailDir {
    switch (facing) {
        case 'north': return RailDirection.North
        case 'east': return RailDirection.East
        case 'south': return RailDirection.South
        case 'west': return RailDirection.West
    }
}

function directionToFacing(dir: RailDir): RailCartFacing {
    switch (dir) {
        case RailDirection.North: return 'north'
        case RailDirection.East: return 'east'
        case RailDirection.South: return 'south'
        case RailDirection.West: return 'west'
    }
}

function oppositeFacing(facing: RailCartFacing): RailCartFacing {
    return directionToFacing(oppositeDirection(facingToDirection(facing)))
}

function rightOf(dir: RailDir): RailDir {
    return ((dir + 1) & 3) as RailDir
}

function directionOffsetVector(dir: RailDir): { x: number; z: number } {
    switch (dir) {
        case RailDirection.North: return { x: 0, z: -1 }
        case RailDirection.East: return { x: 1, z: 0 }
        case RailDirection.South: return { x: 0, z: 1 }
        case RailDirection.West: return { x: -1, z: 0 }
    }
}

export function railCartYawForFacing(facing: RailCartFacing): number {
    const dir = directionOffsetVector(facingToDirection(facing))
    return Math.atan2(-dir.z, dir.x)
}

export function createRailCartModel(): Object3D {
    const root = new Group()
    root.name = 'RailCart'

    const bodyMat = new MeshStandardMaterial({ color: 0x59616a, roughness: 0.72, metalness: 0.25, flatShading: true })
    const rimMat = new MeshStandardMaterial({ color: 0x30353a, roughness: 0.78, metalness: 0.35, flatShading: true })
    const wheelMat = new MeshStandardMaterial({ color: 0x1d2023, roughness: 0.82, metalness: 0.15, flatShading: true })
    const pointerMat = new MeshStandardMaterial({ color: 0xffc247, roughness: 0.48, metalness: 0.05, flatShading: true })

    const tub = new Mesh(new BoxGeometry(0.78, 0.34, 0.68), bodyMat)
    tub.position.y = 0.28
    tub.castShadow = true
    tub.receiveShadow = true
    root.add(tub)

    const rim = new Mesh(new BoxGeometry(0.88, 0.08, 0.78), rimMat)
    rim.position.y = 0.49
    rim.castShadow = true
    rim.receiveShadow = true
    root.add(rim)

    const nose = new Mesh(new BoxGeometry(0.18, 0.12, 0.16), rimMat)
    nose.position.set(0.43, 0.54, 0)
    nose.castShadow = true
    nose.receiveShadow = true
    root.add(nose)

    const pointer = new Mesh(new ConeGeometry(0.075, 0.24, 4), pointerMat)
    pointer.name = 'CartDirectionPointer'
    pointer.position.set(0.56, 0.58, 0)
    pointer.rotation.z = -Math.PI * 0.5
    pointer.castShadow = true
    pointer.receiveShadow = true
    root.add(pointer)

    for (const x of [-0.32, 0.32]) {
        for (const z of [-0.28, 0.28]) {
            const wheel = new Mesh(new BoxGeometry(0.16, 0.16, 0.08), wheelMat)
            wheel.position.set(x, 0.12, z)
            wheel.castShadow = true
            wheel.receiveShadow = true
            root.add(wheel)
        }
    }

    return root
}

function formatCell(cell: VoxelCoord): string {
    return `${cell.x},${cell.y},${cell.z}`
}
