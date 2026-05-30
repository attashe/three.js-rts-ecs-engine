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
    type Object3D,
} from 'three'
import { SLOT_TO_SOCKET, attachToSocket, detachFromSocket, type EquipSlot } from '../../engine/anim'
import type { GameWorld } from '../../engine/ecs/world'

export type EquipmentKind = 'hat' | 'sword' | 'shield'

export function createEquipment(kind: EquipmentKind): Group {
    switch (kind) {
        case 'hat': return buildHat()
        case 'sword': return buildSword()
        case 'shield': return buildShield()
    }
}

/**
 * Attach `item` to the entity's slot socket. Replaces whatever was in that slot.
 * Returns false if the entity has no controller or the rig lacks that socket.
 */
export function equipItem(world: GameWorld, eid: number, slot: EquipSlot, item: Object3D): boolean {
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
    if (!attachToSocket(controller.sockets, slot, item)) return false
    slots.set(socketName, item)
    return true
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
    // Grip at the socket origin; blade points along the hand's local -Y (down
    // the forearm), so it reads as held when the arm hangs.
    const grip = new Mesh(new CylinderGeometry(0.022, 0.022, 0.14, 6), mat(0x3a2616))
    const guard = new Mesh(new BoxGeometry(0.16, 0.03, 0.04), mat(0xb8902f, 0.4, 0.4))
    guard.position.y = -0.08
    const blade = new Mesh(new BoxGeometry(0.05, 0.6, 0.02), mat(0xc9d2dc, 0.3, 0.7))
    blade.position.y = -0.4
    for (const m of [grip, guard, blade]) { m.castShadow = true; g.add(m) }
    return g
}

function buildShield(): Group {
    const g = new Group()
    g.name = 'equip:shield'
    const face = new Mesh(new BoxGeometry(0.04, 0.4, 0.32), mat(0x5a3a22))
    const boss = new Mesh(new CylinderGeometry(0.06, 0.06, 0.05, 10), mat(0xb8902f, 0.4, 0.4))
    boss.rotation.z = Math.PI / 2
    boss.position.x = 0.03
    for (const m of [face, boss]) { m.castShadow = true; g.add(m) }
    return g
}
