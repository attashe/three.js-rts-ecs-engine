# Script API reference

Authoritative sources:

- `src/engine/script/types.ts`
- `types/script-api.d.ts`
- `docs/script-engine.md`
- Existing examples in `examples/scripts/*.js`

## Core Globals

```js
on(event, filter?, handler, opts?)
once(event, filter?)
emit(event, data?)
wait(seconds)
log(message, kind?)
random(min, max)
```

## Frequently Used Namespaces

```js
flags.get(name)
flags.set(name, value)

player.position
player.alive
player.inventory.gold
player.inventory.arrows
player.teleport(x, y, z)
player.kill(reason)
player.setGold(amount)
player.setArrows(amount)

pickups.spawn(kind, pos, { id, amount, label })
pickups.despawn(id)
pickups.exists(id)

ui.say(targetId, message, { seconds })
ui.clear(targetId)
ui.dialogue({
  title,
  npc: { id, name, avatar, voice },
  player: { id: 'player', name: 'You', avatar: 'player', voice },
  speakers,
  lines: [{ speaker, text, voice, choices }]
})

npc.setWaypoints(id, points)
npc.goTo(id, point)
npc.stop(id)
npc.setPerceptionRadius(id, radius)
npc.setHostile(id, 'player', true)
npc.attack(id)
npc.die(id)
npc.exists(id)

trade.open({ title, npc, currency: 'gold', items })

zone.contains(id)
zone.setActive(id, enabled)
zone.isActive(id)

weather.applyPreset(id)
weather.setZoneEnabled(id, enabled)
dayCycle.setHour(hour)
dayCycle.setEnabled(enabled)
travel.to(levelId, { arrivalId })
```

## Built-In Events

| Event | Typical filter |
| ----- | -------------- |
| `level-start` | none |
| `level.reset` | none |
| `input` | `{ action: 'interact', targetId }` |
| `pickup-taken` | `{ kind }` or `{ pickupId }` |
| `zone-enter` / `zone-exit` | `{ zoneId }`, optionally `{ source: 'player' }` |
| `player.died` | none |
| `flag.changed` | `{ name }` |
| `timer` | `{ periodSeconds, oneshot }` |

Filters use strict equality. Typos fail silently.

## Dialogue Speech

Generated speech belongs only to modal `ui.dialogue` speakers or individual
lines:

```js
await ui.dialogue({
  npc: { id: NPC_ID, name: NPC_NAME, avatar: 'keeper', voice: NPC_VOICE },
  player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },
  lines: [{ speaker: NPC_ID, text: 'The gate remembers your name.' }],
})
```

`ui.say(...)` is deliberately silent and should stay reserved for quick floating
messages such as purchase feedback or "not enough money".

## NPC Combat Hooks

NPC combat is script-authored: set perception, route, and hostility. There is
no faction system. Hostile NPCs path toward targets, attack in range, and
respect the player's raised shield arc.

Use `npc.attack` for scripted animation beats and `npc.die` for forced death.
For autonomous guards, prefer:

```js
npc.setPerceptionRadius(NPC_ID, 7)
npc.setHostile(NPC_ID, 'player', true)
npc.setWaypoints(NPC_ID, [{ x: 6, y: 5, z: 4 }, { x: 12, y: 5, z: 4 }])
```

## Current Trade Limit

`trade.open` currently uses gold currency and supports `arrows` as the first
inventory-backed resource. Extend `TradeResource` and transaction handling
before authoring shops for other item types.
