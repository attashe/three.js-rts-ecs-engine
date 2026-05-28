// paid-portal-shrine.js - toll shrine that opens the demo travel gate.
//
// Interact with the Portal Shrine near the west gate. The shrine consumes
// one coin, opens the Teleport Garden portal for ten seconds, and enables a
// temporary magic Visual FX zone around the gate.

const SHRINE_ZONE = 'zone.demo.portal-shrine'
const PORTAL_ZONE = 'zone.demo.portal.teleport-garden'
const MAGIC_ZONE = 'fx.demo.portal.magic'
const STATE = 'demo.portalShrine.state'
const EXPIRES_AT = 'demo.portalShrine.expiresAt'
const COST = 1
const DURATION_SECONDS = 10

let activeToken = 0

on('level-start', () => {
    closePortal(false)
    log('A Portal Shrine waits beside the Teleport Garden gate.')
})

on('level.reset', () => closePortal(false))
on('player.died', () => closePortal(false))
on('input', { action: 'interact', targetId: SHRINE_ZONE }, () => activatePortal())

async function activatePortal() {
    const gold = player.inventory.gold
    if (gold < COST) {
        shrineSays('Not enough money. The shrine requires 1 coin.')
        log('Portal Shrine: activation failed, not enough gold.')
        return
    }

    player.setGold(gold - COST)
    activeToken += 1
    const token = activeToken
    const expiresAt = time.now + DURATION_SECONDS

    flags.set(STATE, 'active')
    flags.set(EXPIRES_AT, expiresAt)
    zone.setActive(PORTAL_ZONE, true)
    weather.setZoneEnabled(MAGIC_ZONE, true)
    audio.play('sfx.quest.chime')
    shrineSays(`Portal activated for ${DURATION_SECONDS} seconds.`)
    log(`Portal Shrine: paid ${COST} coin, gate open until ${expiresAt.toFixed(1)}s.`)

    await wait(DURATION_SECONDS)
    if (token !== activeToken) return
    closePortal(true)
}

function closePortal(announce) {
    activeToken += 1
    zone.setActive(PORTAL_ZONE, false)
    weather.setZoneEnabled(MAGIC_ZONE, false)
    flags.set(STATE, 'idle')
    flags.set(EXPIRES_AT, 0)
    if (announce) {
        shrineSays('Portal closed.')
        log('Portal Shrine: gate closed.')
    }
}

function shrineSays(message) {
    ui.say(SHRINE_ZONE, message, { seconds: 3.5 })
}
