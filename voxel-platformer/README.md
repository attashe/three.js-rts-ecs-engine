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

Then open `http://localhost:8001`.

## Test + typecheck + build

```bash
npm test
npm run typecheck
npm run build
```

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
