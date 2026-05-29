# Quest patterns

## Minimal State Machine

Use one state flag and explicit states:

```js
const STATE = 'quest.grove.state'

function state() {
  return flags.get(STATE) ?? 'unknown'
}
```

Common progression:

```text
unknown -> active -> ready -> done
```

Use additional per-item flags for collectibles:

```js
function itemFlag(id) {
  return `${id}.collected`
}
```

## Interaction Quest Shape

```js
on('input', { action: 'interact', targetId: NPC_INTERACTION }, () => handleNpc())

async function handleNpc() {
  const s = state()
  if (s === 'unknown') {
    const result = await npcDialogue([{ text: 'Will you help?', choices: [
      { id: 'accept', text: 'I will help.' },
      { id: 'later', text: 'Not now.' },
    ] }])
    if (result.choiceId !== 'accept') return
    flags.set(STATE, 'active')
    ensureItemsSpawned()
    audio.play('sfx.quest.chime')
    return
  }
}
```

## Collectibles

- Define all collectible ids in one array.
- Spawn with stable ids inside `ensureItemsSpawned`.
- On `pickup-taken`, verify quest state, item kind, exact pickup id, and
  already-collected flag.
- When no collectibles remain, set state to `ready` and tell the player where
  to return.

```js
on('pickup-taken', { kind: ITEM_KIND }, (event) => {
  if (state() !== 'active') return
  const item = ITEMS.find((i) => i.id === event.pickupId)
  if (!item) return
  if (flags.get(itemFlag(item.id)) === true) return
  flags.set(itemFlag(item.id), true)
  if (remainingItems().length === 0) flags.set(STATE, 'ready')
})
```

## Rewards

Prefer one visible reward plus one state/log/audio signal:

```js
flags.set(STATE, 'done')
pickups.spawn('coin', rewardPos, { id: 'quest.reward.gold', amount: 25, label: 'Reward' })
audio.play('sfx.quest.fanfare')
emit('quest.grove.complete')
```

## Shops

Use `trade.open` for merchant interactions:

```js
const result = await trade.open({
  title: `${NPC_NAME}'s Supplies`,
  npc: { id: NPC_ID, name: NPC_NAME, avatar: 'keeper' },
  items: [{
    id: 'arrows.bundle',
    name: 'Arrow bundle',
    resource: 'arrows',
    unitSize: 5,
    buyPrice: 3,
    sellPrice: 1,
    stock: 20,
  }],
})
if (result.status === 'bought') ui.say(NPC_INTERACTION, 'Good hunting.', { seconds: 3 })
```

## World Feedback

Good quests visibly alter the world:

- `chunks.setBlock` / `fillBlocks` for gates, lanterns, bridges, hidden rooms.
- `weather.applyPreset`, `weather.setRain`, `weather.setLightning` for mood.
- `dayCycle.setHour`, `setEnabled` for scripted time beats.
- `zone.setActive` for delayed vaults, portals, traps, or magic fields.
- `travel.to` / `travel.reload` for location transitions.

Keep cleanup explicit when a quest ends; do not leave storm/rain/disabled zones
behind unless that is the intended final state.
