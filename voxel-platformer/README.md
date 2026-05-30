# voxel-platformer

A minimal voxel platformer foundation: level rendering, character movement with
jumps, swept-AABB physics for the player and dynamic rigid bodies, and bow
shooting where arrows arc and stick into the surface they hit.

Distilled from the parent ARPG engine. Nothing ARPG-shaped is kept — no NPCs,
no AI, no factions, no inventory, no HUD, no combat damage. Just the parts a
platformer needs to bootstrap a level + player + a few interactive props.

## What's in

- **Engine core** — fixed-step scheduler, WebGPU renderer (three.js), input
  reader, action map, ECS world (bitecs), per-system metrics.
- **Voxel** — 32³ chunks, greedy mesher, swept-AABB collision, raycast,
  level serializer.
- **Player** — WASD/arrows + jump, jump buffering, coyote time, mouse aim,
  iso camera with Q/R rotation and wheel zoom.
- **Physics** — gravity, swept-AABB sweeps against voxels + an obstacle
  registry, restitution bounces, linear damping while grounded, sleep
  tracking for settled bodies, dynamic-collision separation between the
  player and other bodies, rigid-body pair separation when two dynamic
  bodies overlap.
- **Falling stones** — spawner system feeds a configurable number of stones
  from cliff points; each stone tumbles, settles, and joins the obstacle
  registry so subsequent sweeps treat it as solid.
- **Bow** — KeyF launches an arrow with a small upward arc; arrows are
  RigidBody-driven, sleep on contact, and become a static visual stuck in
  the surface they hit. Useful later for remote item activation.
- **High Jump** — KeyH, grounded-only, ~13 m/s upward kick. Reach a platform
  a regular jump can't clear.
- **Air Push** — KeyG, a chest-height cone in front of the player that
  shoves stones and other rigid bodies. Useful for puzzles (knock a stone
  into a pit, blow loot off a ledge).
- **Collectables** — proximity pickup. Coin piles (gold, +N to
  `world.inventory.gold`) seeded by the level meta; arrows that settle
  after being shot become collectable in place (+1 to
  `world.inventory.arrows`). Debug overlay shows the live counts.
- **Debug overlay** — wireframe AABB outlines around every body (including
  the player) + a metrics panel, on by default; backtick toggles. A
  second always-visible log panel (top-right) shows pickup notifications
  and spell-cast confirmations sourced from `world.log` (push messages
  with the `pushLog(world, message)` helper).

## Run

```bash
npm install
npm run dev
```

Game: `http://localhost:8001` (or `/index.html`).
Editor: `http://localhost:8001/editor.html` — voxel painting, brushes, pickup
placement, binary save/load. See `docs/editor.md` for the full roadmap.

## Test + typecheck + build

```bash
npm run levels:procedural
npm test
npm run typecheck
npm run build
```

`npm test` regenerates procedural demo `.vplevel` files before running the
Node tests. See `docs/procedural-levels.md` for the generator/export pipeline.

### Manual browser verification (not covered by `npm test`)

`npm test` runs `node:test` against a no-DOM build. Several systems can
only be validated end-to-end in a real browser. Before merging changes
that touch any of the following, do one playtest pass in the dev server
(`npm run dev`, then `/index.html` and `/editor.html`):

- **Rendering / visual feedback** — three.js mesh changes, materials,
  lighting, particle FX, prop and NPC models.
- **DOM-based UI** — the editor panels (Logic / NPCs / Weather / Sound
  / Level tabs), the dialogue modal (`src/game/dialogue-system.ts`),
  the in-game popup and log overlays, input lockout while a modal is
  open.
- **Piston / moving-platform feel** — collision separation, character
  carry behaviour, audio cues during travel.
- **Audio mix** — background music, spatial sound sources, fade-in /
  fade-out behaviour when entering sound zones.
- **Checkpoint persistence across reload** — script-set checkpoints
  (`player.setCheckpoint`) must survive a death-triggered
  `location.reload()` and respawn the player at the saved point.
  `npm test` covers the store + key derivation; only a real browser
  exercises the full reload boundary.
- **Script-driven FX zone toggles** — `weather.setZoneEnabled` /
  `setZonePreset` go through a controller that's unit-tested with a
  stub registry. The full visual+audio re-spawn cycle (particle
  death, paired-sound fade-out, fresh emitter from the swapped
  preset) only happens in a real WeatherSystem.

Pure-logic changes (script bindings, level metadata serialisation,
pickup lifecycle helpers) are covered by `npm test` and do not require
a browser pass on every commit.

### Archived Playwright visual harness

The attempted Playwright screenshot harness is archived, not active. Headless
Chromium exposed `navigator.gpu`, but `navigator.gpu.requestAdapter()` returned
`null` in the current environment, so screenshots could not be trusted as
WebGPU rendering evidence. The archived files live in
`archive/visual-test-harness/`; details and revival notes are in
`docs/archived-visual-testing.md`.

## Layout

```
src/
├── client.ts               # entry — spawns level + player, registers systems
├── engine/
│   ├── engine.ts           # owns world, scheduler, systems, render loop
│   ├── scheduler.ts        # fixed-step + render-step ticker
│   ├── signals.ts          # tiny event hub
│   ├── metrics.ts          # per-system timing + gauges
│   ├── ecs/                # bitecs world, components, systems
│   ├── input/              # raw input + ActionMap
│   ├── render/             # WebGPU renderer, iso camera, materials
│   └── voxel/              # chunks, greedy mesher, collision, raycast
└── game/
    ├── actions.ts          # the 9-action input map
    ├── level.ts            # a tiny demo scene
    ├── player.ts           # spawnPlayer
    ├── moving-objects.ts   # spawnArrowProjectile + spawnFallingStone
    └── assets/             # mesh builders for character, weapons, stones
tests/
```

## Controls

| Action | Binding |
|---|---|
| Move | WASD / arrow keys |
| Aim | Mouse pointer |
| Jump | Space (buffered, with coyote time) |
| High Jump | H (grounded only, 900 ms cooldown) |
| Air Push | G (1.5 s cooldown) |
| Bow shot | F |
| Rotate camera | Q / R |
| Zoom | Mouse wheel |
| Debug overlay | ` (backtick) |
