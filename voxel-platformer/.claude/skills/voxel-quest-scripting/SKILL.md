---
name: voxel-quest-scripting
description: >-
  Design, write, edit, or review event-driven quests and gameplay scripts for
  voxel-platformer levels, including NPC dialogue trees, collect-and-return
  quests, shrine interactions, shops/trade menus, scripted portals, pickup
  spawning/despawning, flags, weather/day-cycle changes, zone triggers, and
  tests for examples/scripts/*.js or scripts embedded in editor NPC/Logic
  tabs. Use for requests such as "write a quest", "script this NPC",
  "add dialogue choices", "make an item collection quest", "open a shop",
  "activate a portal", or "use the script engine".
---

# Voxel quest scripting

Write quests as small state machines over the script API. The canonical shape
is: stable ids, `flags` for state, event handlers for triggers, idempotent
spawn helpers, and dialogue that exposes the next player action clearly.

## Workflow

1. Draft the quest contract: NPC/object, player goal, state machine, required
   pickups/zones, rewards, failure/restart behavior, and visible world changes.
2. Namescape every id (`quest.area.name.*`) before coding. Use one `STATE`
   flag and per-item flags for collection progress.
3. Register handlers at top level: `level-start`, `input`, `pickup-taken`,
   `zone-enter`, `player.died`, or custom events. Put world bootstrap in
   `on('level-start', ...)`, not in bare top-level statements.
4. Keep handlers idempotent. Stable pickup ids and guard flags must prevent
   duplicated pickups, rewards, weather effects, or portal toggles after Apply.
5. Use `ui.dialogue` for branching conversations and `ui.say` for short
   world-anchored feedback. Use `trade.open` for shops instead of manually
   subtracting gold.
6. Add or update tests with stub facades when the quest ships as an example or
   generated-level script.

## Script Style

- Prefer explicit state names: `unknown -> active -> ready -> done`.
- Keep dialogue helper functions near the bottom, after event handlers.
- Log meaningful progress for tests and debug overlay.
- Use `await wait(seconds)` for pacing; do not use `Date.now`,
  `setTimeout`, or `Math.random`.
- Use `Promise.race` with `once('player.died')` or `once('level.reset')` for
  long cinematic sequences that must be interruptible.
- Keep API extensions separate from quest logic. If a missing binding is
  needed, extend the script API first and test it in `script-bindings`.

## References

- Read `references/quest-patterns.md` before authoring or reviewing a quest.
- Read `references/script-api.md` when using less common bindings such as
  travel, weather zones, day cycle, stones, or trade.

## Validation

For script-only edits:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .tmp/test-build/tests/script-demo-quest.test.js
```

For API or binding changes, also run `tests/script-bindings.test.js` and
`npm run typecheck`. For generated procedural levels, run
`npm run levels:procedural` and the export tests.
