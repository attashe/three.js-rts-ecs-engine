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
    BOOT_EQUIPMENT_KINDS,
    EQUIPMENT_KINDS,
    EQUIPMENT_LABELS,
    HAMMER_EQUIPMENT_KINDS,
    HAND_EQUIPMENT_KINDS,
    HEAD_EQUIPMENT_KINDS,
    STAFF_EQUIPMENT_KINDS,
    type EquipmentKind,
} from './equipment-types'

export {
    BOOT_EQUIPMENT_KINDS,
    EQUIPMENT_KINDS,
    EQUIPMENT_LABELS,
    HAND_EQUIPMENT_KINDS,
    HEAD_EQUIPMENT_KINDS,
    HAMMER_EQUIPMENT_KINDS,
    STAFF_EQUIPMENT_KINDS,
    isHammerEquipmentKind,
    isStaffEquipmentKind,
    type EquipmentKind,
    type EquipmentHandLoadout,
    type BootEquipmentKind,
    type HammerEquipmentKind,
    type HeadEquipmentKind,
    type HandEquipmentKind,
    type HandEquipmentSlot,
    type PlayerEquipmentSettings,
    type StaffEquipmentKind,
} from './equipment-types'

export function createEquipment(kind: EquipmentKind): Group {
    switch (kind) {
        case 'hat': return buildTravelerHat()
        case 'hat-arcane': return buildArcaneHat()
        case 'hat-ranger': return buildRangerCap()
        case 'hat-guard': return buildGuardHelm()
        case 'hat-sun': return buildSunCrown()
        case 'sword': return buildSword()
        case 'shield': return buildShield()
        case 'bow': return buildBow()
        case 'arrow': return buildHeldArrow()
        case 'staff-lantern': return buildLanternStaff()
        case 'staff': return buildBattleStaff()
        case 'staff-crystal': return buildCrystalStaff()
        case 'battle-hammer': return buildBattleHammer()
        case 'book': return buildBook()
        case 'high-jump-boots': return buildHighJumpBoot()
        case 'high-speed-boots': return buildHighSpeedBoot()
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
        // Blade authored along +Y; rotate it toward +Z so the idle/thrust pose
        // points at the enemy rather than straight upward.
        handR: { orient: [Math.PI / 2 - 0.08, 0, -0.16], offset: [0.015, -0.045, 0.08] },
        handL: { orient: [Math.PI / 2 - 0.08, 0, 0.16], offset: [-0.015, -0.045, 0.08] },
    },
    shield: {
        handR: { orient: [0, Math.PI / 2 - 0.28, 0], offset: [0.13, -0.075, 0.015] },
        handL: { orient: [0, -Math.PI / 2 + 0.28, 0], offset: [-0.13, -0.075, 0.015] },
    },
    bow: {
        // Bow authored in its XY plane (height +Y, draws along +X). The shot
        // clip raises the bow arm; this pre-rotation keeps the bow vertical once
        // the arm aims forward.
        handR: { orient: [Math.PI / 2, Math.PI / 2, 0], offset: [0.02, -0.04, 0.03] },
        handL: { orient: [Math.PI / 2, -Math.PI / 2, 0], offset: [-0.02, -0.04, 0.03] },
    },
    arrow: {
        // Nocked against the bow. The shoot clip turns the torso/arm side-on;
        // this frame compensates so the arrow tip still points toward the
        // character's forward direction at full draw instead of back across
        // the body.
        handR: { orient: [-2.89, -0.69, 0.09], offset: [0, -0.02, 0.08] },
        handL: { orient: [-2.89, 0.69, -0.09], offset: [0, -0.02, 0.08] },
    },
    'staff-lantern': {
        // Old lantern-staff carry: mostly vertical, warm top visible above the
        // shoulder, with the grip grounded below the hand.
        handR: { orient: [0.12, 0, -0.08], offset: [0.045, -0.38, 0.06] },
        handL: { orient: [0.12, 0, 0.08], offset: [-0.045, -0.38, 0.06] },
    },
    staff: {
        // Battle-staff carry: the grip sits below the hand and the weighted
        // head leans forward, so the idle pose already reads as ready to bonk
        // instead of a vertical walking stick.
        handR: { orient: [0.42, 0, -0.12], offset: [0.045, -0.36, 0.075] },
        handL: { orient: [0.42, 0, 0.12], offset: [-0.045, -0.36, 0.075] },
    },
    'staff-crystal': {
        // Crystal staff keeps the same combat-readable forward lean, but sits a
        // little higher so the larger crystal cluster clears the ground.
        handR: { orient: [0.34, 0, -0.1], offset: [0.045, -0.33, 0.07] },
        handL: { orient: [0.34, 0, 0.1], offset: [-0.045, -0.33, 0.07] },
    },
    'battle-hammer': {
        // Hammer canonical +Y points toward the heavy head. Rotate that axis
        // mostly forward so idle carry reads as a horizontal war-hammer, not a
        // vertical staff.
        handR: { orient: [Math.PI / 2, 0, -0.1], offset: [0.07, -0.08, 0.16] },
        handL: { orient: [Math.PI / 2, 0, 0.1], offset: [-0.07, -0.08, 0.16] },
    },
    book: {
        handR: { orient: [-0.72, -0.22, 0.28], offset: [0.08, -0.08, 0.11] },
        handL: { orient: [-0.72, 0.22, -0.28], offset: [-0.08, -0.08, 0.11] },
    },
    hat: {
        head: { offset: [0, -0.03, 0] },
    },
    'hat-arcane': {
        head: { offset: [0, -0.03, 0] },
    },
    'hat-ranger': {
        head: { offset: [0, -0.04, 0.01] },
    },
    'hat-guard': {
        head: { offset: [0, -0.055, 0] },
    },
    'hat-sun': {
        head: { offset: [0, -0.045, 0] },
    },
    'high-jump-boots': {
        footR: { offset: [0, 0, 0] },
        footL: { offset: [0, 0, 0] },
    },
    'high-speed-boots': {
        footR: { offset: [0, 0, 0] },
        footL: { offset: [0, 0, 0] },
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
    return bySlot.handR ?? bySlot.handL ?? bySlot.head ?? bySlot.back ?? bySlot.footR ?? bySlot.footL ?? {}
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

function glowMat(color: number, intensity = 0.55): MeshStandardMaterial {
    return new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.42 })
}

function addParts(g: Group, parts: readonly Mesh[]): Group {
    for (const m of parts) { m.castShadow = true; g.add(m) }
    return g
}

function buildTravelerHat(): Group {
    const g = new Group()
    g.name = 'equip:hat'
    const felt = mat(0x243d36, 0.82)
    const brim = new Mesh(new CylinderGeometry(0.31, 0.28, 0.035, 14), felt)
    brim.position.y = 0.02
    brim.scale.z = 0.84
    const crown = new Mesh(new CylinderGeometry(0.16, 0.22, 0.26, 10), felt)
    crown.position.y = 0.16
    crown.scale.z = 0.88
    const band = new Mesh(new CylinderGeometry(0.225, 0.225, 0.04, 12), mat(0xc28c38, 0.5, 0.2))
    band.position.y = 0.075
    band.scale.z = 0.86
    const feather = new Mesh(new ConeGeometry(0.035, 0.28, 6), mat(0xd7b35a, 0.62))
    feather.position.set(0.23, 0.18, 0.04)
    feather.rotation.set(0.18, 0.1, -0.82)
    const pin = new Mesh(new SphereGeometry(0.035, 8, 6), mat(0x7ac7a2, 0.46, 0.12))
    pin.position.set(0.17, 0.1, 0.13)
    return addParts(g, [brim, crown, band, feather, pin])
}

function buildArcaneHat(): Group {
    const g = new Group()
    g.name = 'equip:hat-arcane'
    const cloth = mat(0x253a7a, 0.78)
    const brim = new Mesh(new CylinderGeometry(0.29, 0.25, 0.035, 14), mat(0x18234f, 0.82))
    brim.position.y = 0.015
    brim.scale.z = 0.86
    const cone = new Mesh(new ConeGeometry(0.19, 0.66, 12), cloth)
    cone.position.y = 0.36
    cone.rotation.z = -0.12
    cone.scale.z = 0.9
    const band = new Mesh(new CylinderGeometry(0.21, 0.215, 0.045, 12), mat(0x5f3fa1, 0.55, 0.05))
    band.position.y = 0.075
    band.scale.z = 0.86
    const starH = new Mesh(new BoxGeometry(0.13, 0.025, 0.018), glowMat(0xffd76b, 0.75))
    const starV = new Mesh(new BoxGeometry(0.025, 0.13, 0.018), glowMat(0xffd76b, 0.75))
    starH.position.set(0.02, 0.34, 0.175)
    starV.position.copy(starH.position)
    const moon = new Mesh(new SphereGeometry(0.035, 8, 6), glowMat(0xbad7ff, 0.5))
    moon.position.set(-0.08, 0.2, 0.18)
    return addParts(g, [brim, cone, band, starH, starV, moon])
}

function buildRangerCap(): Group {
    const g = new Group()
    g.name = 'equip:hat-ranger'
    const crownMat = mat(0x315a2f, 0.84)
    const crown = new Mesh(new SphereGeometry(0.23, 12, 8), crownMat)
    crown.position.y = 0.12
    crown.scale.set(1.05, 0.48, 0.9)
    const brim = new Mesh(new CylinderGeometry(0.27, 0.25, 0.035, 12), mat(0x203d24, 0.82))
    brim.position.y = 0.035
    brim.scale.set(1.1, 1, 0.82)
    const visor = new Mesh(new BoxGeometry(0.23, 0.035, 0.16), mat(0x264826, 0.8))
    visor.position.set(0, 0.04, 0.2)
    visor.rotation.x = -0.08
    const feather = new Mesh(new BoxGeometry(0.045, 0.3, 0.018), mat(0x9fd179, 0.62))
    feather.position.set(-0.22, 0.18, 0.05)
    feather.rotation.set(0.12, -0.18, 0.72)
    const vein = new Mesh(new BoxGeometry(0.018, 0.29, 0.02), mat(0xf2e6a0, 0.55))
    vein.position.copy(feather.position)
    vein.rotation.copy(feather.rotation)
    return addParts(g, [crown, brim, visor, feather, vein])
}

function buildGuardHelm(): Group {
    const g = new Group()
    g.name = 'equip:hat-guard'
    const steel = mat(0x9aa7ad, 0.36, 0.55)
    const dome = new Mesh(new SphereGeometry(0.235, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), steel)
    dome.position.y = 0.09
    dome.scale.z = 0.9
    const rim = new Mesh(new CylinderGeometry(0.25, 0.25, 0.045, 14), mat(0x56656e, 0.42, 0.45))
    rim.position.y = 0.035
    rim.scale.z = 0.88
    const crest = new Mesh(new BoxGeometry(0.065, 0.24, 0.34), mat(0xb6342d, 0.7))
    crest.position.y = 0.25
    crest.rotation.x = -0.08
    const nose = new Mesh(new BoxGeometry(0.04, 0.22, 0.04), mat(0x6f7f87, 0.36, 0.5))
    nose.position.set(0, 0.02, 0.22)
    const hornL = new Mesh(new ConeGeometry(0.045, 0.18, 8), mat(0xe5d6a8, 0.58))
    hornL.position.set(-0.25, 0.16, 0)
    hornL.rotation.z = Math.PI / 2
    const hornR = new Mesh(new ConeGeometry(0.045, 0.18, 8), mat(0xe5d6a8, 0.58))
    hornR.position.set(0.25, 0.16, 0)
    hornR.rotation.z = -Math.PI / 2
    return addParts(g, [dome, rim, crest, nose, hornL, hornR])
}

function buildSunCrown(): Group {
    const g = new Group()
    g.name = 'equip:hat-sun'
    const gold = mat(0xd9a62a, 0.38, 0.38)
    const band = new Mesh(new CylinderGeometry(0.22, 0.23, 0.12, 12), gold)
    band.position.y = 0.07
    band.scale.z = 0.82
    const rim = new Mesh(new CylinderGeometry(0.245, 0.245, 0.025, 12), mat(0xffd166, 0.34, 0.45))
    rim.position.y = 0.14
    rim.scale.z = 0.82
    const gem = new Mesh(new SphereGeometry(0.045, 8, 6), glowMat(0xff553f, 0.55))
    gem.position.set(0, 0.1, 0.2)
    const parts: Mesh[] = [band, rim, gem]
    for (const [x, z, h] of [[0, 0.18, 0.22], [-0.13, 0.13, 0.18], [0.13, 0.13, 0.18], [-0.19, 0.02, 0.15], [0.19, 0.02, 0.15]] as const) {
        const ray = new Mesh(new ConeGeometry(0.035, h, 6), gold)
        ray.position.set(x, 0.18 + h * 0.32, z)
        parts.push(ray)
    }
    return addParts(g, parts)
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

function buildHeldArrow(): Group {
    const g = new Group()
    g.name = 'equip:arrow'
    // Canonical frame: arrow shaft along +Y, grip near origin, point toward +Y.
    const shaft = new Mesh(new CylinderGeometry(0.009, 0.009, 0.72, 6), mat(0x6b3f20, 0.82))
    shaft.position.y = 0.28
    const tip = new Mesh(new ConeGeometry(0.028, 0.1, 8), mat(0xc8d1dc, 0.32, 0.65))
    tip.position.y = 0.69
    const fletchMat = mat(0xd7e4f0, 0.7)
    const left = new Mesh(new BoxGeometry(0.09, 0.045, 0.012), fletchMat)
    left.position.set(-0.035, -0.035, 0)
    left.rotation.z = -0.35
    const right = new Mesh(new BoxGeometry(0.09, 0.045, 0.012), fletchMat)
    right.position.set(0.035, -0.035, 0)
    right.rotation.z = 0.35
    for (const m of [shaft, tip, left, right]) { m.castShadow = true; g.add(m) }
    return g
}

function buildLanternStaff(): Group {
    const g = new Group()
    g.name = 'equip:staff-lantern'
    // Preserved Keeper staff: a warm lantern cage on a walking pole. The
    // lantern crown remains on +Y so it still works with staff attack clips.
    const wood = mat(0x4a2c12, 0.86)
    const pole = new Mesh(new CylinderGeometry(0.02, 0.028, 1.28, 7), wood)
    pole.name = 'LanternStaffPole'
    pole.position.y = 0.39
    const dark = mat(0x17120d, 0.72, 0.1)
    const glow = new Mesh(new SphereGeometry(0.08, 8, 6), glowMat(0xffb54d, 0.55))
    glow.name = 'LanternStaffGlow'
    glow.position.y = 1.08
    const capTop = new Mesh(new BoxGeometry(0.16, 0.02, 0.16), dark)
    capTop.name = 'LanternStaffCapTop'
    capTop.position.y = 1.18
    const capBottom = new Mesh(new BoxGeometry(0.16, 0.02, 0.16), dark)
    capBottom.name = 'LanternStaffCapBottom'
    capBottom.position.y = 0.98
    const finial = new Mesh(new SphereGeometry(0.045, 7, 5), mat(0xffc462, 0.38, 0.18))
    finial.name = 'LanternStaffFinial'
    finial.position.y = 1.27
    finial.scale.set(1, 0.78, 1)
    const parts: Mesh[] = [pole, glow, capTop, capBottom, finial]
    for (const [bx, bz] of [[0.06, 0.06], [0.06, -0.06], [-0.06, 0.06], [-0.06, -0.06]] as const) {
        const bar = new Mesh(new BoxGeometry(0.016, 0.18, 0.016), dark)
        bar.name = 'LanternStaffCageBar'
        bar.position.set(bx, 1.08, bz)
        parts.push(bar)
    }
    return addParts(g, parts)
}

function buildBattleStaff(): Group {
    const g = new Group()
    g.name = 'equip:staff'
    // Canonical frame: grip at the origin, pole up the +Y axis, striking head on
    // +Y. Socket frames/attack clips treat +Y as the business end.
    const wood = mat(0x4a2c12, 0.86)
    const pole = new Mesh(new CylinderGeometry(0.022, 0.03, 1.34, 7), wood)
    pole.name = 'StaffPole'
    pole.position.y = 0.4
    const leather = mat(0x25170e, 0.8)
    const grip = new Mesh(new CylinderGeometry(0.035, 0.032, 0.22, 7), leather)
    grip.name = 'StaffGrip'
    grip.position.y = 0.02
    const iron = mat(0x3f4851, 0.38, 0.46)
    const collarLow = new Mesh(new CylinderGeometry(0.06, 0.055, 0.06, 8), iron)
    collarLow.name = 'StaffHeadLowerCollar'
    collarLow.position.y = 1.0
    const head = new Mesh(new SphereGeometry(0.13, 10, 8), mat(0x56616d, 0.34, 0.42))
    head.name = 'StaffHeavyHead'
    head.position.y = 1.12
    head.scale.set(0.9, 1.1, 0.9)
    const spike = new Mesh(new ConeGeometry(0.07, 0.24, 8), mat(0xc7d5dc, 0.28, 0.62))
    spike.name = 'StaffSpike'
    spike.position.y = 1.31
    const gem = new Mesh(new SphereGeometry(0.045, 8, 6), glowMat(0x72d7ff, 0.45))
    gem.name = 'StaffImpactGem'
    gem.position.set(0, 1.13, 0.115)
    const parts: Mesh[] = [pole, grip, collarLow, head, spike, gem]
    for (const [name, x, z, ry] of [
        ['StaffSideSpikeR', 0.13, 0, -Math.PI / 2],
        ['StaffSideSpikeL', -0.13, 0, Math.PI / 2],
        ['StaffFrontSpike', 0, 0.13, Math.PI],
    ] as const) {
        const side = new Mesh(new ConeGeometry(0.035, 0.15, 7), mat(0xaebdc5, 0.34, 0.58))
        side.name = name
        side.position.set(x, 1.12, z)
        side.rotation.z = x === 0 ? 0 : ry
        side.rotation.x = x === 0 ? Math.PI / 2 : 0
        parts.push(side)
    }
    for (const m of parts) { m.castShadow = true; g.add(m) }
    return g
}

function buildCrystalStaff(): Group {
    const g = new Group()
    g.name = 'equip:staff-crystal'
    // Channeling staff: lighter shaft with a bright crystal cluster on +Y. The
    // top is still the striking/casting end for shared staff animations.
    const ivory = mat(0xd7cfb8, 0.66)
    const pole = new Mesh(new CylinderGeometry(0.018, 0.026, 1.25, 7), ivory)
    pole.name = 'CrystalStaffPole'
    pole.position.y = 0.38
    const grip = new Mesh(new CylinderGeometry(0.034, 0.03, 0.24, 7), mat(0x25444c, 0.72))
    grip.name = 'CrystalStaffGrip'
    grip.position.y = 0.02
    const gold = mat(0xd0a23d, 0.36, 0.32)
    const ringLow = new Mesh(new CylinderGeometry(0.055, 0.052, 0.05, 8), gold)
    ringLow.name = 'CrystalStaffLowerRing'
    ringLow.position.y = 0.94
    const ringHigh = new Mesh(new CylinderGeometry(0.075, 0.07, 0.045, 8), gold)
    ringHigh.name = 'CrystalStaffUpperRing'
    ringHigh.position.y = 1.11
    const lowerCrystal = new Mesh(new ConeGeometry(0.075, 0.16, 4), glowMat(0x6af2ff, 0.72))
    lowerCrystal.name = 'CrystalStaffCrystalLower'
    lowerCrystal.position.y = 1.04
    lowerCrystal.rotation.y = Math.PI / 4
    lowerCrystal.rotation.z = Math.PI
    const crystal = new Mesh(new ConeGeometry(0.085, 0.24, 4), glowMat(0x74c8ff, 0.85))
    crystal.name = 'CrystalStaffCrystal'
    crystal.position.y = 1.22
    crystal.rotation.y = Math.PI / 4
    const sideOrbL = new Mesh(new SphereGeometry(0.038, 7, 5), glowMat(0xc797ff, 0.55))
    sideOrbL.name = 'CrystalStaffSideOrbL'
    sideOrbL.position.set(-0.095, 1.1, 0)
    const sideOrbR = new Mesh(new SphereGeometry(0.038, 7, 5), glowMat(0xc797ff, 0.55))
    sideOrbR.name = 'CrystalStaffSideOrbR'
    sideOrbR.position.set(0.095, 1.1, 0)
    const braceL = new Mesh(new BoxGeometry(0.028, 0.16, 0.028), gold)
    braceL.name = 'CrystalStaffBraceL'
    braceL.position.set(-0.075, 1.03, 0)
    braceL.rotation.z = -0.48
    const braceR = new Mesh(new BoxGeometry(0.028, 0.16, 0.028), gold)
    braceR.name = 'CrystalStaffBraceR'
    braceR.position.set(0.075, 1.03, 0)
    braceR.rotation.z = 0.48
    return addParts(g, [pole, grip, ringLow, ringHigh, lowerCrystal, crystal, sideOrbL, sideOrbR, braceL, braceR])
}

function buildBattleHammer(): Group {
    const g = new Group()
    g.name = 'equip:battle-hammer'
    // Troll-scaled heavy hammer. Canonical frame matches staff weapons:
    // grip near the origin, haft along +Y, striking head on +Y.
    const haft = new Mesh(new CylinderGeometry(0.035, 0.045, 1.34, 7), mat(0x4a2c12, 0.86))
    haft.name = 'BattleHammerHaft'
    haft.position.y = 0.42
    const grip = new Mesh(new CylinderGeometry(0.052, 0.048, 0.28, 8), mat(0x21160f, 0.78))
    grip.name = 'BattleHammerGrip'
    grip.position.y = 0.03
    const collar = new Mesh(new CylinderGeometry(0.1, 0.09, 0.08, 8), mat(0x59636c, 0.36, 0.45))
    collar.name = 'BattleHammerCollar'
    collar.position.y = 1.04
    const headMat = mat(0x6f7880, 0.32, 0.55)
    const head = new Mesh(new BoxGeometry(0.58, 0.22, 0.28), headMat)
    head.name = 'BattleHammerHead'
    head.position.y = 1.18
    const leftCap = new Mesh(new BoxGeometry(0.08, 0.26, 0.32), mat(0x4f5962, 0.34, 0.56))
    leftCap.name = 'BattleHammerCapL'
    leftCap.position.set(-0.33, 1.18, 0)
    const rightCap = new Mesh(new BoxGeometry(0.08, 0.26, 0.32), mat(0x4f5962, 0.34, 0.56))
    rightCap.name = 'BattleHammerCapR'
    rightCap.position.set(0.33, 1.18, 0)
    const spike = new Mesh(new ConeGeometry(0.08, 0.28, 8), mat(0xc0ccd4, 0.28, 0.66))
    spike.name = 'BattleHammerTopSpike'
    spike.position.y = 1.43
    const faceA = new Mesh(new BoxGeometry(0.22, 0.16, 0.04), mat(0x9ea9b0, 0.32, 0.5))
    faceA.name = 'BattleHammerFaceFront'
    faceA.position.set(0, 1.18, 0.18)
    const faceB = new Mesh(new BoxGeometry(0.22, 0.16, 0.04), mat(0x9ea9b0, 0.32, 0.5))
    faceB.name = 'BattleHammerFaceBack'
    faceB.position.set(0, 1.18, -0.18)
    return addParts(g, [haft, grip, collar, head, leftCap, rightCap, spike, faceA, faceB])
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

function buildHighJumpBoot(): Group {
    const g = new Group()
    g.name = 'equip:high-jump-boots'
    const leather = mat(0x2c2531, 0.74)
    const soleMat = mat(0x151720, 0.68)
    const brass = mat(0xd2a64b, 0.34, 0.26)
    const glow = glowMat(0x65d7ff, 0.62)

    const sole = new Mesh(new BoxGeometry(0.22, 0.055, 0.34), soleMat)
    sole.name = 'HighJumpBootSole'
    sole.position.set(0, -0.16, 0.02)

    const upper = new Mesh(new BoxGeometry(0.18, 0.24, 0.22), leather)
    upper.name = 'HighJumpBootUpper'
    upper.position.set(0, -0.02, -0.025)

    const toe = new Mesh(new BoxGeometry(0.21, 0.095, 0.18), leather)
    toe.name = 'HighJumpBootToe'
    toe.position.set(0, -0.085, 0.13)

    const cuff = new Mesh(new CylinderGeometry(0.115, 0.105, 0.045, 10), brass)
    cuff.name = 'HighJumpBootCuff'
    cuff.position.set(0, 0.12, -0.025)
    cuff.scale.z = 0.72

    const spring = new Mesh(new CylinderGeometry(0.026, 0.026, 0.24, 8), brass)
    spring.name = 'HighJumpBootSpring'
    spring.position.set(0, -0.05, -0.16)
    spring.rotation.x = Math.PI * 0.5

    const crystal = new Mesh(new SphereGeometry(0.035, 8, 6), glow)
    crystal.name = 'HighJumpBootGlow'
    crystal.position.set(0, 0.015, 0.12)

    return addParts(g, [sole, upper, toe, cuff, spring, crystal])
}

function buildHighSpeedBoot(): Group {
    const g = new Group()
    g.name = 'equip:high-speed-boots'
    const leather = mat(0x22272b, 0.72)
    const soleMat = mat(0x12161a, 0.66)
    const silver = mat(0xaec0c8, 0.34, 0.34)
    const glow = glowMat(0x8cff7a, 0.58)

    const sole = new Mesh(new BoxGeometry(0.23, 0.052, 0.36), soleMat)
    sole.name = 'HighSpeedBootSole'
    sole.position.set(0, -0.16, 0.025)

    const upper = new Mesh(new BoxGeometry(0.18, 0.22, 0.21), leather)
    upper.name = 'HighSpeedBootUpper'
    upper.position.set(0, -0.025, -0.03)

    const toe = new Mesh(new BoxGeometry(0.22, 0.085, 0.19), leather)
    toe.name = 'HighSpeedBootToe'
    toe.position.set(0, -0.09, 0.14)

    const ankleBand = new Mesh(new CylinderGeometry(0.116, 0.106, 0.042, 10), silver)
    ankleBand.name = 'HighSpeedBootAnkleBand'
    ankleBand.position.set(0, 0.105, -0.025)
    ankleBand.scale.z = 0.7

    const finL = new Mesh(new BoxGeometry(0.035, 0.13, 0.17), silver)
    finL.name = 'HighSpeedBootWingL'
    finL.position.set(-0.115, -0.015, 0.02)
    finL.rotation.z = -0.38

    const finR = new Mesh(new BoxGeometry(0.035, 0.13, 0.17), silver)
    finR.name = 'HighSpeedBootWingR'
    finR.position.set(0.115, -0.015, 0.02)
    finR.rotation.z = 0.38

    const stripe = new Mesh(new BoxGeometry(0.19, 0.022, 0.035), glow)
    stripe.name = 'HighSpeedBootGlow'
    stripe.position.set(0, 0.02, 0.125)

    return addParts(g, [sole, upper, toe, ankleBand, finL, finR, stripe])
}
