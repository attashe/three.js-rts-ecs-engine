// troll-aggro.js - an NPC that swings at the player when they come close.
//
// Paste into an NPC's script (the editor NPC tab) so NPC_ID / NPC_ZONE are
// injected. The NPC's interaction zone doubles as its aggro range: while the
// player stands inside it, the NPC plays its attack swing on a throttle. Drop
// the player's HP to nothing in range and they restart; this is the mirror of
// the player's own melee (walk up to the troll and press V to fell it).

const SWING_PERIOD_SECONDS = 1.1

on('level-start', () => {
    log(`${NPC_NAME} eyes the path warily.`)
})

// `timer` fires on a fixed cadence; `zone.contains(NPC_ZONE, 'player')` is true
// only while the player is inside this NPC's interaction radius. `player.alive`
// guards against swinging at a dead/respawning player (whose position is NaN).
on('timer', { periodSeconds: SWING_PERIOD_SECONDS }, () => {
    if (!npc.exists(NPC_ID)) return
    if (!player.alive) return
    if (!zone.contains(NPC_ZONE, 'player')) return
    npc.attack(NPC_ID)
    ui.say(NPC_ID, '*roars*', { seconds: 0.8 })
})
