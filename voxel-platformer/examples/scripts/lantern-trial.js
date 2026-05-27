// lantern-trial.js — "The Lantern Trial"
//
// Side quest companion to demo-quest.js. Designed to exercise every
// Slice 1.6 binding in a single coherent gameplay loop:
//
//   - `dayCycle.setHour` / `setEnabled`: each hour stone the player
//     collects shifts the sky to a different time and pauses the cycle
//     so the change is visible.
//   - `weather.applyPreset` / `setRain`: paired atmospheric feedback
//     per stone (clear / cloudy / storm).
//   - `zone.setActive`: a hidden vault zone stays inactive until the
//     fourth stone is collected, then activates so the player can
//     walk in and trigger `zone-enter`.
//   - `flag.changed`: an end-of-file handler listens to its own state
//     flag and logs progress without polling — the same pattern any
//     second script in the level could use to react.
//
// Stages (state stored in `flags.get('trial.lantern.state')`):
//   unknown → 'active'  : player interacts with the Sundial
//   'active' → 'ready'  : player collects all four hour stones
//   'ready' → 'done'    : player enters the vault, claims reward
//
// Both this script and demo-quest.js can be loaded in the same level
// without conflict — they share the world's flags + zones but use
// distinct namespaces (`trial.*` vs `demo.*`).

const STATE = 'trial.lantern.state'
const SUNDIAL_ZONE = 'zone.demo.sundial'
const VAULT_ZONE = 'zone.demo.vault'

// Four hour stones placed at the plaza corners. Each pickup carries
// the time + weather mood the Sundial wants to "remember" at that
// hour. Stable ids make ensureStonesSpawned() idempotent across
// Apply / level-start.
const STONES = [
    { id: 'trial.stone.dawn',  name: 'Dawnstone',  pos: { x: 3,  y: 5, z: 3  }, hour: 6,  weather: 'clear'  },
    { id: 'trial.stone.noon',  name: 'Noonstone',  pos: { x: 21, y: 5, z: 3  }, hour: 12, weather: 'clear'  },
    { id: 'trial.stone.dusk',  name: 'Duskstone',  pos: { x: 21, y: 5, z: 21 }, hour: 18, weather: 'cloudy' },
    { id: 'trial.stone.night', name: 'Nightstone', pos: { x: 3,  y: 5, z: 21 }, hour: 0,  weather: 'storm'  },
]

const VAULT_REWARD = { x: 5, y: 5, z: 5 }

on('level-start', () => {
    const s = state()
    if (s === 'done') {
        log('The Lantern Trial is already complete.')
        zone.setActive(VAULT_ZONE, false)
        return
    }
    if (s === 'active') {
        ensureStonesSpawned()
        log(`Lantern Trial: ${remainingStones().length} hour stone(s) still hidden.`)
    } else if (s === 'ready') {
        log('Lantern Trial: the vault stands open. Step inside to claim your reward.')
    }
    // Vault stays inactive until the fourth stone fires the unlock.
    zone.setActive(VAULT_ZONE, s === 'ready')
})

// Talking to the Sundial. Different lines per quest state — the
// state machine is the dialogue tree.
on('input', { action: 'interact', targetId: SUNDIAL_ZONE }, () => {
    const s = state()
    if (s === 'unknown') {
        flags.set(STATE, 'active')
        ensureStonesSpawned()
        sundialSays('I have lost the four hours. Find the stones and bring them back to me.')
        audio.play('sfx.quest.chime')
        return
    }
    if (s === 'active') {
        const missing = remainingStones()
        sundialSays(`${missing.length} stone(s) still hidden: ${missing.map((m) => m.name).join(', ')}.`)
        return
    }
    if (s === 'ready') {
        sundialSays('The vault opened beneath the plaza. Walk in and take your due.')
        return
    }
    sundialSays('The hours stay true. Walk gently.')
})

// Each stone pickup shifts the sky to its hour and applies its weather
// preset. The day cycle is paused so the player can look at the
// change before walking on. The fourth pickup unlocks the vault.
on('pickup-taken', { kind: 'hour-stone' }, (event) => {
    if (state() !== 'active') return
    const stone = STONES.find((s) => s.id === event.pickupId)
    if (!stone) return

    const key = stoneFlag(stone.id)
    if (flags.get(key) === true) return
    flags.set(key, true)

    // Visible feedback: time + weather shift. The cycle pause lets
    // the player examine the new sky for a beat — without it the
    // sun would creep on while they look around. completeQuest()
    // restores the cycle at the end.
    dayCycle.setHour(stone.hour)
    dayCycle.setEnabled(false)
    weather.applyPreset(stone.weather)
    audio.play('sfx.quest.chime')
    log(`${stone.name} kindled. The sky turns to ${describeHour(stone.hour)}.`)

    if (remainingStones().length === 0) {
        flags.set(STATE, 'ready')
        // Final dramatic sky. The 'storm' preset already darkens the
        // sky; the explicit `setRain(true)` makes the rain visible
        // independent of preset variants.
        dayCycle.setHour(0)
        dayCycle.setEnabled(false)
        weather.applyPreset('storm')
        weather.setRain(true)
        weather.setLightning(true)
        sundialSays('The vault opens.', 5)
        log('Beneath the plaza, stone parts. A vault stands open.')
        zone.setActive(VAULT_ZONE, true)
    }
})

// Entering the vault is the turn-in. Reward + cleanup + atmosphere
// reset so the level returns to a livable state after the trial.
on('zone-enter', { zoneId: VAULT_ZONE }, () => {
    if (state() !== 'ready') return
    flags.set(STATE, 'done')
    pickups.spawn('coin', VAULT_REWARD, {
        id: 'trial.reward.gold',
        amount: 35,
        label: "Sundial's gift",
    })
    audio.play('sfx.quest.fanfare')
    log('The trial is done. Light returns.')

    // Reset the world. Morning + clear sky + resumed cycle so the
    // demo level doesn't stay frozen in storm-time after the quest.
    dayCycle.setHour(7.5)
    dayCycle.setEnabled(true)
    weather.setRain(false)
    weather.setLightning(false)
    weather.applyPreset('clear')
    zone.setActive(VAULT_ZONE, false)

    emit('quest.lantern.complete')
})

// flag.changed listener. A second script (or this same script, here)
// can react to state transitions without polling — the runtime emits
// `flag.changed` once per `flags.set` whose value actually changes.
on('flag.changed', { name: STATE }, (e) => {
    log(`[trial] state → ${e.value}`)
})

// ── helpers ──────────────────────────────────────────────────────────

function sundialSays(message, seconds = 4.0) {
    ui.say(SUNDIAL_ZONE, message, { seconds })
    log(`Sundial: ${message}`)
}

function ensureStonesSpawned() {
    for (const stone of STONES) {
        if (flags.get(stoneFlag(stone.id)) === true) continue
        // Stable id makes this idempotent — Apply re-running the
        // script body won't double-spawn.
        pickups.spawn('hour-stone', stone.pos, { id: stone.id, label: stone.name })
    }
}

function remainingStones() {
    return STONES.filter((s) => flags.get(stoneFlag(s.id)) !== true)
}

function stoneFlag(id) {
    return `${id}.collected`
}

function state() {
    return flags.get(STATE) ?? 'unknown'
}

function describeHour(h) {
    if (h < 4 || h >= 22) return 'midnight'
    if (h < 9)  return 'dawn'
    if (h < 14) return 'noon'
    if (h < 19) return 'dusk'
    return 'night'
}
