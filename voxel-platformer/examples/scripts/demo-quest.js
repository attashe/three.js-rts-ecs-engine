// demo-quest.js — "Fragments for the Keeper"
//
// NPC-led demo quest for the procedural platformer level:
//
//   1. Talk to Keeper Arlen near the spawn plaza.
//   2. Collect three Sun Shards placed around the movement tutorial spaces.
//   3. Return to Arlen for a gold reward and completion fanfare.
//
// This intentionally uses only the public script API from
// docs/script-engine.md: zones, pickup ids, flags, audio, logs, and
// cross-script `emit`.

const STATE = 'demo.quest.keeper.state' // unknown | active | ready | done
const KEEPER_ZONE = 'zone.demo.keeper'
const ITEM_KIND = 'sun-shard'
const LANTERN_POS = { x: 9, y: 5, z: 9 }
const BLOCK_TORCH = 14
const BLOCK_UNLIT_LANTERN = 15

const SHARDS = [
    {
        id: 'demo.quest.shard.stairs',
        name: 'stair shard',
        pos: { x: 18, y: 8, z: 13 },
        hint: 'above the plank stairs',
    },
    {
        id: 'demo.quest.shard.wall',
        name: 'wall shard',
        pos: { x: 4, y: 5, z: 7 },
        hint: 'near the west wall',
    },
    {
        id: 'demo.quest.shard.island',
        name: 'island shard',
        pos: { x: 9, y: 8, z: 22 },
        hint: 'on the floating island',
    },
]

const REWARD = { x: 10.5, y: 5, z: 10.6 }

on('level-start', () => {
    const questState = state()
    if (questState === 'done') {
        lightLantern()
        log('Keeper Arlen waits by the lantern. The Sun Shards are already safe.')
        return
    }

    extinguishLantern()
    log('Keeper Arlen waits near the old lantern.')
    if (questState === 'active') {
        ensureShardsSpawned()
        log(`Quest: collect ${remainingShards().length} Sun Shard(s), then return to Arlen.`)
    } else if (questState === 'ready') {
        log('Quest: return to Keeper Arlen with the Sun Shards.')
    }
})

on('input', { action: 'interact', targetId: KEEPER_ZONE }, () => {
    const questState = state()
    if (questState === 'unknown') {
        flags.set(STATE, 'active')
        sayKeeper('The plaza lantern is dying. Find the three Sun Shards and bring their light back to me.')
        ensureShardsSpawned()
        audio.play('sfx.quest.chime')
        return
    }

    if (questState === 'active') {
        ensureShardsSpawned()
        const missing = remainingShards()
        sayKeeper(`${missing.length} shard(s) still wait: ${missing.map((s) => s.hint).join(', ')}.`)
        return
    }

    if (questState === 'ready') {
        completeQuest()
        return
    }

    sayKeeper('The lantern holds. Walk carefully, friend.')
})

on('pickup-taken', { kind: ITEM_KIND }, (event) => {
    if (state() !== 'active') return
    const shard = SHARDS.find((s) => s.id === event.pickupId)
    if (!shard) return

    const key = shardFlag(shard.id)
    if (flags.get(key) === true) return
    flags.set(key, true)

    const missing = remainingShards()
    audio.play('sfx.quest.chime')
    if (missing.length > 0) {
        log(`Sun Shard found: ${shard.name}. ${missing.length} remain.`)
    } else {
        flags.set(STATE, 'ready')
        log('The last Sun Shard warms your pack. Return to Keeper Arlen.')
    }
})

on('quest.demo.complete', () => {
    flags.set('demo.quest.completedAt', time.now)
    log('[quest] Fragments for the Keeper complete.')
})

on('player.died', () => {
    const questState = state()
    if (questState === 'active') {
        log(`(Hint: ${remainingShards().length} Sun Shard(s) remain.)`)
    } else if (questState === 'ready') {
        log('(Hint: return to Keeper Arlen.)')
    }
})

function completeQuest() {
    flags.set(STATE, 'done')
    lightLantern()
    sayKeeper('You brought the sun back in pieces. Take this for the road.')
    audio.play('sfx.quest.fanfare')
    pickups.spawn('coin', REWARD, {
        id: 'demo.quest.reward.gold',
        amount: 50,
        label: "Keeper Arlen's reward",
    })
    emit('quest.demo.complete')
}

function sayKeeper(message) {
    ui.say(KEEPER_ZONE, message, { seconds: 4.5 })
    log(`Keeper Arlen: '${message}'`)
}

function lightLantern() {
    chunks.setBlock(LANTERN_POS.x, LANTERN_POS.y, LANTERN_POS.z, BLOCK_TORCH)
}

function extinguishLantern() {
    chunks.setBlock(LANTERN_POS.x, LANTERN_POS.y, LANTERN_POS.z, BLOCK_UNLIT_LANTERN)
}

function ensureShardsSpawned() {
    for (const shard of SHARDS) {
        if (flags.get(shardFlag(shard.id)) === true) continue
        pickups.spawn(ITEM_KIND, shard.pos, {
            id: shard.id,
            label: 'Sun Shard',
        })
    }
}

function remainingShards() {
    return SHARDS.filter((shard) => flags.get(shardFlag(shard.id)) !== true)
}

function shardFlag(id) {
    return `${id}.collected`
}

function state() {
    return flags.get(STATE) ?? 'unknown'
}
