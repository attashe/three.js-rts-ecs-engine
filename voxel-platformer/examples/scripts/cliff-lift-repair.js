// cliff-lift-repair.js — repairable cabin lift for the demo east cliff.
//
// Flow:
//   1. A broken cabin prop sits at the cliff base.
//   2. The player finds repair materials.
//   3. Interacting with the lift consumes the materials, hides the wreck,
//      deploys the repaired cabin piston, and enables E to move it up/down.

const LIFT_FLAG = 'demo.cliffLift.repaired'
const LIFT_PISTON = 'piston.cliff-lift'
const BROKEN_PROP = 'demo:cliff-lift-broken'
const BOTTOM_ZONE = 'zone.demo.cliff-lift.bottom'
const TOP_ZONE = 'zone.demo.cliff-lift.top'
const MATERIAL_ID = 'lift-repair-materials'
const MATERIAL_PICKUP_ID = 'demo.cliff-lift.materials'
const MATERIAL_POS = { x: 6.5, y: 5, z: 15.5 }
const MATERIAL_ITEM = {
    id: MATERIAL_ID,
    name: 'Lift Repair Materials',
    description: 'Sturdy brackets, rope, and a replacement winch pin for the cliff lift.',
    category: 'quest',
    icon: 'tool',
}

on('level-start', () => {
    syncLiftState()
    if (!isRepaired() && !player.inventory.has(MATERIAL_ID) && !pickups.exists(MATERIAL_PICKUP_ID)) {
        pickups.spawn(MATERIAL_ID, MATERIAL_POS, {
            id: MATERIAL_PICKUP_ID,
            label: 'Lift Repair Materials',
            inventoryItem: MATERIAL_ITEM,
        })
    }
})

on('pickup-taken', { pickupId: MATERIAL_PICKUP_ID }, () => {
    ui.say(BOTTOM_ZONE, 'The cliff lift can be repaired now.', { seconds: 3 })
})

on('input', { action: 'interact', targetId: BOTTOM_ZONE }, () => handleLiftInteraction(BOTTOM_ZONE))
on('input', { action: 'interact', targetId: TOP_ZONE }, () => handleLiftInteraction(TOP_ZONE))

function handleLiftInteraction(targetId) {
    if (!isRepaired()) {
        if (!player.inventory.has(MATERIAL_ID)) {
            ui.say(targetId, 'Find repair materials first.', { seconds: 2.5 })
            return
        }
        if (!player.removeInventoryItem(MATERIAL_ID, 1)) return
        flags.set(LIFT_FLAG, true)
        syncLiftState()
        audio.play('sfx.quest.chime')
        ui.say(targetId, 'Lift repaired. Press E again to move it.', { seconds: 3 })
        return
    }

    if (pistons.flip(LIFT_PISTON)) {
        ui.say(targetId, 'Lift moving.', { seconds: 1.5 })
    } else {
        ui.say(targetId, 'Lift is still moving.', { seconds: 1.5 })
    }
}

function syncLiftState() {
    const repaired = isRepaired()
    props.setVisible(BROKEN_PROP, !repaired)
    pistons.setDeployed(LIFT_PISTON, repaired)
    pistons.setEnabled(LIFT_PISTON, repaired)
}

function isRepaired() {
    return flags.get(LIFT_FLAG) === true
}
