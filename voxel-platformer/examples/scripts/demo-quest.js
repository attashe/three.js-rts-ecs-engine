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
const KEEPER_SPEAKER = { id: 'keeper', name: 'Keeper Arlen', avatar: 'keeper', side: 'left', voice: { preset: 'dwarf', seed: 'keeper-arlen', volume: 0.55 } }
const PLAYER_SPEAKER = { id: 'player', name: 'You', avatar: 'player', side: 'right', voice: { preset: 'player', seed: 'player' } }
const KEEPER_SHOP = {
    id: 'demo.keeper.supplies',
    title: "Keeper Arlen's Supplies",
    npc: KEEPER_SPEAKER,
    currency: 'gold',
    items: [
        {
            id: 'arrows.bundle',
            name: 'Arrow bundle',
            description: 'Five straight arrows for careful shots.',
            resource: 'arrows',
            unitSize: 5,
            buyPrice: 3,
            sellPrice: 1,
            stock: 20,
        },
        {
            id: 'heal-potion',
            name: 'Healing Potion',
            description: 'A sealed red draught for dangerous climbs.',
            resource: 'heal-potion',
            unitSize: 1,
            buyPrice: 5,
            sellPrice: 2,
            stock: 8,
        },
    ],
}

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

on('input', { action: 'interact', targetId: KEEPER_ZONE }, () => handleKeeperInteraction())

async function handleKeeperInteraction() {
    const questState = state()
    if (questState === 'unknown') {
        const intro = await keeperDialogue([
            { speaker: 'keeper', text: 'The plaza lantern is dying. Its last light broke into three Sun Shards.' },
            {
                speaker: 'keeper',
                text: 'Find them and bring their light back to me.',
                choices: [
                    { id: 'accept', text: 'I will find the shards.' },
                    { id: 'ask', text: 'What are Sun Shards?' },
                    { id: 'trade', text: 'Show me your supplies.' },
                    { id: 'bye', text: 'Goodbye.' },
                ],
            },
        ])
        if (intro.choiceId === 'bye') return
        if (intro.choiceId === 'trade') {
            await openKeeperTrade()
            return
        }
        if (intro.choiceId === 'ask') {
            const followup = await keeperDialogue([
                { speaker: 'keeper', text: 'Small pieces of a kinder sun. They hide where the plaza taught its first lessons.' },
                {
                    speaker: 'keeper',
                    text: 'Stairs, walls, and high places remember them best.',
                    choices: [
                        { id: 'accept', text: 'Then I will find them.' },
                        { id: 'trade', text: 'Show me your supplies first.' },
                        { id: 'bye', text: 'Goodbye.' },
                    ],
                },
            ])
            if (followup.choiceId === 'bye') return
            if (followup.choiceId === 'trade') {
                await openKeeperTrade()
                return
            }
        }
        flags.set(STATE, 'active')
        ensureShardsSpawned()
        audio.play('sfx.quest.chime')
        return
    }

    if (questState === 'active') {
        ensureShardsSpawned()
        const missing = remainingShards()
        const result = await keeperDialogue([{
            speaker: 'keeper',
            text: `${missing.length} shard(s) still wait: ${missing.map((s) => s.hint).join(', ')}.`,
            choices: [
                { id: 'trade', text: 'Show me your supplies.' },
                { id: 'bye', text: 'Goodbye.' },
            ],
        }])
        if (result.choiceId === 'trade') await openKeeperTrade()
        return
    }

    if (questState === 'ready') {
        const turnIn = await keeperDialogue([{
            speaker: 'keeper',
            text: 'The shards are singing in your pack. Will you return them to the lantern?',
            choices: [
                { id: 'give', text: 'Here are the Sun Shards.' },
                { id: 'trade', text: 'Show me your supplies.' },
                { id: 'bye', text: 'Goodbye.' },
            ],
        }])
        if (turnIn.choiceId === 'give') await completeQuest()
        else if (turnIn.choiceId === 'trade') await openKeeperTrade()
        return
    }

    const done = await keeperDialogue([{
        speaker: 'keeper',
        text: 'The lantern holds. Walk carefully, friend.',
        choices: [
            { id: 'trade', text: 'Show me your supplies.' },
            { id: 'bye', text: 'Goodbye.' },
        ],
    }])
    if (done.choiceId === 'trade') await openKeeperTrade()
}

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

async function completeQuest() {
    flags.set(STATE, 'done')
    lightLantern()
    await keeperDialogue([
        { speaker: 'keeper', text: 'You brought the sun back in pieces.' },
        {
            speaker: 'keeper',
            text: 'Take this for the road.',
            choices: [{ id: 'thanks', text: 'Thank you, Keeper.' }],
        },
    ])
    audio.play('sfx.quest.fanfare')
    pickups.spawn('coin', REWARD, {
        id: 'demo.quest.reward.gold',
        amount: 50,
        label: "Keeper Arlen's reward",
    })
    // Visible world-state feedback: shift the sky to evening and pause
    // the day cycle so the dusk holds. Demonstrates the dayCycle.*
    // bindings without taking over the demo level's lighting.
    dayCycle.setHour(19.0)
    dayCycle.setEnabled(false)
    emit('quest.demo.complete')
}

async function keeperDialogue(lines) {
    for (const line of lines) {
        if ((line.speaker ?? 'keeper') === 'player') continue
        log(`Keeper Arlen: '${line.text}'`)
    }
    return ui.dialogue({
        title: 'Keeper Arlen',
        npc: KEEPER_SPEAKER,
        player: PLAYER_SPEAKER,
        lines,
    })
}

async function openKeeperTrade() {
    const result = await trade.open(KEEPER_SHOP)
    if (result.status === 'bought') {
        const arrows = result.gained.arrows ?? 0
        const potions = result.gained['heal-potion'] ?? 0
        ui.say(KEEPER_ZONE, arrows > 0
            ? `Wrapped ${arrows} arrow(s). Spend them with care.`
            : `Packed ${potions} healing potion(s). Keep them close.`,
        { seconds: 3 })
    } else if (result.status === 'sold') {
        const arrows = result.removed.arrows ?? 0
        const potions = result.removed['heal-potion'] ?? 0
        ui.say(KEEPER_ZONE, arrows > 0
            ? `I can use those ${arrows} arrow(s). Take ${result.gained.gold} gold.`
            : `I can restock those ${potions} potion(s). Take ${result.gained.gold} gold.`,
        { seconds: 3 })
    } else if (result.status === 'unavailable') {
        ui.say(KEEPER_ZONE, result.reason ?? 'The supplies are not ready.', { seconds: 3 })
    }
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
