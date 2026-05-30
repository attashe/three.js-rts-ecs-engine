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
import {
    EQUIPMENT_KINDS,
    EQUIPMENT_LABELS,
    HAND_EQUIPMENT_KINDS,
    type EquipmentKind,
} from './equipment-types'

export {
    EQUIPMENT_KINDS,
    EQUIPMENT_LABELS,
    HAND_EQUIPMENT_KINDS,
    type EquipmentKind,
    type EquipmentHandLoadout,
    type HandEquipmentKind,
    type HandEquipmentSlot,
    type PlayerEquipmentSettings,
} from './equipment-types'

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

export interface EquipmentSocketFrame {
    orient?: readonly [number, number, number]
    offset?: readonly [number, number, number]
}

/** Held transform per equipment kind and hand. Items are authored with a logical
 *  grip near the origin; these frames give each hand a small art-directed grip
 *  offset so shields/books don't sit through the wrist and staff/sword handles
 *  are visibly held instead of floating at the socket point. */
const EQUIP_FRAMES: Partial<Record<EquipmentKind, Partial<Record<EquipSlot, EquipmentSocketFrame>>>> = {
    sword: {
        handR: { orient: [0.28, 0, -0.34], offset: [0.015, -0.035, 0.055] },
        handL: { orient: [0.28, 0, 0.34], offset: [-0.015, -0.035, 0.055] },
    },
    shield: {
        handR: { orient: [0, Math.PI / 2 - 0.28, 0], offset: [0.19, -0.12, 0.025] },
        handL: { orient: [0, -Math.PI / 2 + 0.28, 0], offset: [-0.19, -0.12, 0.025] },
    },
    bow: {
        // Bow authored in its XY plane (height +Y, draws along +X). The shot
        // clip raises the bow arm; this pre-rotation keeps the bow vertical once
        // the arm aims forward.
        handR: { orient: [Math.PI / 2, Math.PI / 2, 0], offset: [0.02, -0.04, 0.03] },
        handL: { orient: [Math.PI / 2, -Math.PI / 2, 0], offset: [-0.02, -0.04, 0.03] },
    },
    staff: {
        handR: { orient: [0.08, 0, -0.12], offset: [0.03, -0.2, 0.03] },
        handL: { orient: [0.08, 0, 0.12], offset: [-0.03, -0.2, 0.03] },
    },
    book: {
        handR: { orient: [-0.72, -0.22, 0.28], offset: [0.08, -0.08, 0.11] },
        handL: { orient: [-0.72, 0.22, -0.28], offset: [-0.08, -0.08, 0.11] },
    },
    hat: {
        head: { offset: [0, -0.03, 0] },
    },
}

/** Held orientation (Euler XYZ, model frame) for an equipment kind. Kept for
 *  older call sites; prefer `equipmentSocketFrame` so grip offsets travel with
 *  the item too. */
export function equipmentOrient(kind: EquipmentKind): readonly [number, number, number] | undefined {
    return equipmentSocketFrame(kind).orient
}

export function equipmentSocketFrame(kind: EquipmentKind, slot?: EquipSlot): EquipmentSocketFrame {
    const bySlot = EQUIP_FRAMES[kind]
    if (!bySlot) return {}
    if (slot && bySlot[slot]) return bySlot[slot]!
    return bySlot.handR ?? bySlot.handL ?? bySlot.head ?? bySlot.back ?? {}
}

/**
 * Attach `item` to the entity's slot socket. Replaces whatever was in that slot.
 * Returns false if the entity has no controller or the rig lacks that socket.
 * `frame` overrides the held orientation and grip offset.
 */
export function equipItem(
    world: GameWorld,
    eid: number,
    slot: EquipSlot,
    item: Object3D,
    frame?: EquipmentSocketFrame,
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
    slots.delete(socketName)
    if (!attachToSocket(controller.sockets, slot, item, {
        root: controller.root,
        orient: frame?.orient,
        offset: frame?.offset,
    })) return false
    slots.set(socketName, item)
    return true
}

/** Build + attach a piece of equipment with its default held orientation. */
export function equip(world: GameWorld, eid: number, slot: EquipSlot, kind: EquipmentKind): boolean {
    return equipItem(world, eid, slot, createEquipment(kind), equipmentSocketFrame(kind, slot))
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
