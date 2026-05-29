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
ui.dialogue({ title, npc, player, speakers, lines })

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

## Current Trade Limit

`trade.open` currently uses gold currency and supports `arrows` as the first
inventory-backed resource. Extend `TradeResource` and transaction handling
before authoring shops for other item types.
