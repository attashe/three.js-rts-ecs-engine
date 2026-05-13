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
- **Debug overlay** — backtick toggles a render-side overlay showing the
  player AABB and scene counts. Tweak as you go.

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
| Bow shot | F |
| Rotate camera | Q / R |
| Zoom | Mouse wheel |
| Debug overlay | ` (backtick) |
