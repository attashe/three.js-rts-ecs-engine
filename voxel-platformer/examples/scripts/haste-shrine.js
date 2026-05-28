// haste-shrine.js - standalone demo of script-driven player settings.
//
// Interact with the Shrine of Haste near the spawn plaza to boost
// movement speed for ten seconds. Re-interacting while the effect is
// active refreshes the timer without stacking speed.

const SHRINE_ZONE = 'zone.demo.haste-shrine'
const DURATION_SECONDS = 10
const SPEED_MULTIPLIER = 1.65
const MIN_SPEED_BONUS = 2.25

let activeToken = 0
let baseMoveSpeed = null

on('level-start', () => {
    log('A Shrine of Haste hums near the plaza.')
})

on('level.reset', () => restoreHaste(false))
on('player.died', () => restoreHaste(false))
on('input', { action: 'interact', targetId: SHRINE_ZONE }, () => activateHaste())

async function activateHaste() {
    const currentSpeed = safeSpeed(player.settings.moveSpeed)
    if (baseMoveSpeed === null) baseMoveSpeed = currentSpeed

    const boostedSpeed = Math.max(baseMoveSpeed * SPEED_MULTIPLIER, baseMoveSpeed + MIN_SPEED_BONUS)
    activeToken += 1
    const token = activeToken

    player.setSettings({ moveSpeed: boostedSpeed })
    audio.play('sfx.quest.chime')
    shrineSays(`Haste awakened: movement speed increased for ${DURATION_SECONDS} seconds.`)
    log(`Shrine of Haste: speed ${baseMoveSpeed.toFixed(1)} -> ${boostedSpeed.toFixed(1)}.`)

    await wait(DURATION_SECONDS)
    if (token !== activeToken) return

    restoreHaste(true)
}

function shrineSays(message) {
    ui.say(SHRINE_ZONE, message, { seconds: 3.5 })
}

function safeSpeed(value) {
    return Number.isFinite(value) && value > 0 ? value : 5
}

function restoreHaste(announce) {
    if (baseMoveSpeed === null) return
    activeToken += 1
    const restoredSpeed = baseMoveSpeed
    player.setSettings({ moveSpeed: restoredSpeed })
    baseMoveSpeed = null
    if (announce) {
        shrineSays('Haste fades.')
        log(`Shrine of Haste: speed restored to ${restoredSpeed.toFixed(1)}.`)
    }
}
