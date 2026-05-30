// Equipment models + socket attachment. Demonstrates the forward-looking slot
// system: weapons in both hands and a hat on the head (the most-read slot in an
// iso view). Items are small procedural meshes parented to the rig's socket
// bones, so they inherit the animation.

import {
    BoxGeometry,
    ConeGeometry,
    CylinderGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    SphereGeometry,
    type Object3D,
} from 'three'
import { SLOT_TO_SOCKET, attachToSocket, detachFromSocket, type EquipSlot } from '../../engine/anim'
import type { GameWorld } from '../../engine/ecs/world'
import { createBow } from '../assets'

export type EquipmentKind = 'hat' | 'sword' | 'shield' | 'bow' | 'staff' | 'book'

export function createEquipment(kind: EquipmentKind): Group {
    switch (kind) {
        case 'hat': return buildHat()
        case 'sword': return buildSword()
        case 'shield': return buildShield()
        case 'bow': return buildBow()
        case 'staff': return buildStaff()
        case 'book': return buildBook()
    }
}

/** Held orientation per equipment kind (Euler XYZ radians, in the rig's model
 *  frame). The socket attach cancels the hand bone's rest tilt, so these read
 *  consistently regardless of how a given rig orients its hand bones. */
const EQUIP_ORIENT: Partial<Record<EquipmentKind, readonly [number, number, number]>> = {
    // Blade up, tipped forward and canted outward so it clears the arm/shoulder
    // instead of spearing straight up through the pauldron.
    sword: [-0.45, 0, -0.4],
    // Broad face forward (+Z), turned slightly outward across the body.
    shield: [0, 0.3, 0],
    // Bow authored in its XY plane (height +Y, draws along +X). The socket
    // orient is fixed at the arm's REST pose, but the bow is only used while the
    // draw arm is raised ~90° forward — which would tip a rest-vertical bow flat.
    // Pre-rotate +π/2 about X so that, once the aiming arm rotates it back, the
    // bow stands vertical with the arrow firing forward (+Z).
    bow: [Math.PI / 2, -Math.PI / 2, 0],
    // Lantern-staff stands upright in the hand.
    staff: [0, 0, 0],
    // Book held tilted up, faces turned slightly inward to read.
    book: [-0.55, 0, 0],
}

/** Held orientation (Euler XYZ, model frame) for an equipment kind, or undefined
 *  for the identity default. Shared by the game loadout and the preview page so
 *  both orient items the same way. */
export function equipmentOrient(kind: EquipmentKind): readonly [number, number, number] | undefined {
    return EQUIP_ORIENT[kind]
}

/**
 * Attach `item` to the entity's slot socket. Replaces whatever was in that slot.
 * Returns false if the entity has no controller or the rig lacks that socket.
 * `orient` overrides the held orientation (Euler XYZ, model frame).
 */
export function equipItem(
    world: GameWorld,
    eid: number,
    slot: EquipSlot,
    item: Object3D,
    orient?: readonly [number, number, number],
): boolean {
    const controller = world.animControllerByEid.get(eid)
    if (!controller) return false
    let slots = world.equipmentByEid.get(eid)
    if (!slots) {
        slots = new Map<string, Object3D>()
        world.equipmentByEid.set(eid, slots)
    }
    const socketName = SLOT_TO_SOCKET[slot]
    const prev = slots.get(socketName)
    if (prev) detachFromSocket(prev)
    if (!attachToSocket(controller.sockets, slot, item, { root: controller.root, orient })) return false
    slots.set(socketName, item)
    return true
}

/** Build + attach a piece of equipment with its default held orientation. */
export function equip(world: GameWorld, eid: number, slot: EquipSlot, kind: EquipmentKind): boolean {
    return equipItem(world, eid, slot, createEquipment(kind), EQUIP_ORIENT[kind])
}

export function unequipSlot(world: GameWorld, eid: number, slot: EquipSlot): void {
    const slots = world.equipmentByEid.get(eid)
    if (!slots) return
    const socketName = SLOT_TO_SOCKET[slot]
    const item = slots.get(socketName)
    if (item) {
        detachFromSocket(item)
        slots.delete(socketName)
    }
}

function mat(color: number, roughness = 0.7, metalness = 0): MeshStandardMaterial {
    return new MeshStandardMaterial({ color, roughness, metalness })
}

function buildHat(): Group {
    const g = new Group()
    g.name = 'equip:hat'
    const brim = new Mesh(new CylinderGeometry(0.26, 0.26, 0.04, 12), mat(0x2a2436))
    brim.position.y = 0.02
    const crown = new Mesh(new ConeGeometry(0.18, 0.42, 12), mat(0x3b3350))
    crown.position.y = 0.24
    const band = new Mesh(new CylinderGeometry(0.185, 0.185, 0.06, 12), mat(0xb8902f, 0.5, 0.3))
    band.position.y = 0.07
    for (const m of [brim, crown, band]) { m.castShadow = true; g.add(m) }
    return g
}

function buildSword(): Group {
    const g = new Group()
    g.name = 'equip:sword'
    // Authored in the model's canonical frame (+Y up): grip at the origin,
    // blade pointing up. The socket attach cancels the hand bone's rest tilt, so
    // it reads as held upright regardless of the rig.
    const grip = new Mesh(new CylinderGeometry(0.022, 0.022, 0.14, 6), mat(0x3a2616))
    grip.position.y = 0.07
    const guard = new Mesh(new BoxGeometry(0.16, 0.03, 0.04), mat(0xb8902f, 0.4, 0.4))
    guard.position.y = 0.15
    const blade = new Mesh(new BoxGeometry(0.05, 0.6, 0.02), mat(0xc9d2dc, 0.3, 0.7))
    blade.position.y = 0.46
    for (const m of [grip, guard, blade]) { m.castShadow = true; g.add(m) }
    return g
}

function buildShield(): Group {
    const g = new Group()
    g.name = 'equip:shield'
    // Canonical frame: face normal points forward (+Z), height +Y, width +X.
    // Sized to read as a proper kite/heater shield from the iso camera.
    const face = new Mesh(new BoxGeometry(0.46, 0.6, 0.05), mat(0x5a3a22))
    const rim = new Mesh(new BoxGeometry(0.5, 0.14, 0.06), mat(0x442c1a))
    rim.position.y = 0.22
    const boss = new Mesh(new CylinderGeometry(0.085, 0.085, 0.06, 12), mat(0xb8902f, 0.4, 0.4))
    boss.rotation.x = Math.PI / 2
    boss.position.z = 0.05
    for (const m of [face, rim, boss]) { m.castShadow = true; g.add(m) }
    return g
}

function buildBow(): Group {
    // The shared bow asset, scaled to a hand-held size.
    const g = createBow({ height: 1.2, width: 0.34 })
    g.name = 'equip:bow'
    return g
}

function buildStaff(): Group {
    const g = new Group()
    g.name = 'equip:staff'
    // Canonical frame: grip at the origin, pole up the +Y axis, lantern crown on
    // top — the Keeper's old fixed staff, now a hand item.
    const wood = mat(0x4a2c12, 0.86)
    const pole = new Mesh(new CylinderGeometry(0.02, 0.026, 1.0, 7), wood)
    pole.position.y = 0.28
    const dark = mat(0x17120d, 0.72, 0.1)
    const glow = new Mesh(new SphereGeometry(0.08, 8, 6), mat(0xffb54d, 0.42, 0.08))
    glow.position.y = 0.82
    const capTop = new Mesh(new BoxGeometry(0.16, 0.02, 0.16), dark)
    capTop.position.y = 0.92
    const capBottom = new Mesh(new BoxGeometry(0.16, 0.02, 0.16), dark)
    capBottom.position.y = 0.72
    const finial = new Mesh(new SphereGeometry(0.045, 7, 5), mat(0xffc462, 0.38, 0.18))
    finial.position.y = 0.99
    finial.scale.set(1, 0.78, 1)
    const parts: Mesh[] = [pole, glow, capTop, capBottom, finial]
    for (const [bx, bz] of [[0.06, 0.06], [0.06, -0.06], [-0.06, 0.06], [-0.06, -0.06]] as const) {
        const bar = new Mesh(new BoxGeometry(0.016, 0.18, 0.016), dark)
        bar.position.set(bx, 0.82, bz)
        parts.push(bar)
    }
    for (const m of parts) { m.castShadow = true; g.add(m) }
    return g
}

function buildBook(): Group {
    const g = new Group()
    g.name = 'equip:book'
    // Canonical frame: grip at the origin (lower spine), covers in the XY plane
    // facing +Z. The Troll's old fixed tome, now a hand item.
    const cover = mat(0x6c2f34, 0.68)
    const back = new Mesh(new BoxGeometry(0.3, 0.4, 0.03), cover)
    back.position.set(0, 0.2, 0)
    const pages = new Mesh(new BoxGeometry(0.26, 0.36, 0.05), mat(0xe6dcc3, 0.72))
    pages.position.set(0, 0.2, 0.03)
    const front = new Mesh(new BoxGeometry(0.3, 0.4, 0.03), cover)
    front.position.set(0, 0.2, 0.06)
    for (const m of [back, pages, front]) { m.castShadow = true; g.add(m) }
    return g
}
