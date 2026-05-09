# Voxel RPG Engine

An isometric voxel ARPG prototype built on **three.js + WebGPU + bitecs**. The
project is being reworked from the original RTS demo into a single-player,
direct-control voxel RPG engine with a future level editor.

The current prototype has:
- WebGPU-only rendering with an isometric orthographic camera.
- Chunked voxel terrain, greedy meshing, raycast, collision, pathfinding, and
  level serialization foundations.
- ECS-driven player, NPCs, factions, pickups, combat hooks, projectiles,
  moving stones, pistons, doors, and debug overlays.
- A shared framework-free UI library used by the game HUD, editor shell, and UI
  catalog page.

Historical phase notes and completed work have moved to
[`CHANGELOG.md`](./CHANGELOG.md).

## Local Pages

Run the Vite dev server on the forwarded port:

```bash
npm run dev -- --host 0.0.0.0 --port 8000
```

Available pages:
- `/index.html` - game demo.
- `/editor.html` - editor shell.
- `/ui-demo.html` - shared UI catalog for HUD, editor, toasts, command hints,
  panels, buttons, log panel, and palette controls.

## Technical Decisions

| Area | Choice |
|---|---|
| Renderer | `WebGPURenderer` only, no WebGL fallback |
| ECS | `bitecs` SoA typed-array ECS |
| Voxel rendering | Chunked voxel volumes with greedy meshing |
| Gameplay style | Direct-control isometric ARPG first; click-to-move optional later |
| Editor | Separate Vite entry at `/editor.html` |
| UI | Framework-free DOM components in `src/client/ui/` |
| Build | Vite |
| Runtime scope | Single-player v1 |

## Project Structure

```text
.
├── index.html                  # game entry
├── editor.html                 # editor entry
├── ui-demo.html                # shared UI catalog entry
├── vite.config.ts              # Vite multi-entry build and dev server config
├── tests/                      # node test suite for engine subsystems
├── docs/
│   ├── roadmap-next.md          # earlier architecture roadmap notes
│   └── shaders/                 # TSL material notes and examples
└── src/
    ├── demo/
    │   └── ui-demo.ts           # UI catalog page
    ├── editor/
    │   └── editor.ts            # editor shell bootstrap
    └── client/
        ├── client.ts            # game bootstrap, level setup, system wiring
        ├── ui/                  # shared UI primitives and widgets
        ├── game/
        │   ├── assets/          # code-native placeholder visuals
        │   ├── level.ts         # procedural demo level
        │   ├── mechanisms.ts    # doors and pistons
        │   ├── moving-objects.ts
        │   ├── npc.ts
        │   ├── player.ts
        │   └── props.ts
        └── engine/
            ├── engine.ts        # world + renderer + scheduler + input
            ├── scheduler.ts     # fixed-step and render-step loop
            ├── input/           # keyboard, pointer, wheel, click queue
            ├── render/          # WebGPU renderer, camera, stats, materials
            ├── voxel/           # chunks, palette, meshing, collision, pathing
            └── ecs/
                ├── components.ts
                ├── world.ts
                ├── factions.ts
                ├── obstacle-registry.ts
                └── systems/     # gameplay, physics, render, debug systems
```

## Feature Exploration

The next stage should borrow genre lessons from **Magicka**, **Minecraft
Dungeons**, **Tunic**, **Diablo**, and **Titan Quest**, but translate them into
engine systems instead of one-off demo scripts.

### Combat And Abilities

Useful genre elements:
- Magicka-style ability composition: element tags, status reactions, friendly
  fire risk, charge/cast timing, and environmental interactions.
- Diablo/Titan Quest-style ability definitions: cooldowns, resource cost,
  hit shapes, damage packets, status effects, and animation/event timing.
- Minecraft Dungeons-style readable telegraphs: short windups, ground markers,
  projectile trails, and clear hit confirmation.

Engine implications:
- Add a data-driven `Action` / `Ability` layer above raw input.
- Represent attacks as declared hit volumes or projectiles, not custom logic per
  weapon.
- Add `DamagePacket`, `StatusEffect`, resistance, and elemental tags.
- Separate targeting, cast validation, execution, and presentation events.
- Keep abilities deterministic enough for tests and later save/replay support.

### Loot, Equipment, And Progression

Useful genre elements:
- Diablo/Titan Quest itemization: item base type, rarity, affixes, requirements,
  sockets or modifiers.
- Minecraft Dungeons simplicity: quick comparison, obvious upgrades, limited
  active equipment complexity.
- Tunic-style discoveries: keys, relics, notes, shortcuts, and world objects
  that explain themselves through placement.

Engine implications:
- Add inventory and equipment data separate from mesh attachments.
- Define item instances as data: id, base item, stack count, affixes, durability
  or charges if needed.
- Add equipment slots that drive actor stat modifiers and visual attachments.
- Keep loot tables deterministic and seedable for testable drops.
- Add pickup prompts and compare panels in UI only after item data is stable.

### AI, Factions, And Encounters

Useful genre elements:
- Diablo/Titan Quest enemy packs with roles: melee blocker, ranged harasser,
  caster, summoner, elite modifier.
- Minecraft Dungeons readable enemy behavior: short state cycles, obvious
  aggro, leash, and reset.
- Faction relationships already exist; they should drive perception and target
  choice rather than only debug labels.

Engine implications:
- Add perception queries: sight radius, hearing/noise events, aggro memory,
  leash radius, and target priority.
- Replace random wandering with behavior states: idle, patrol, investigate,
  chase, attack, flee, return.
- Improve local avoidance so NPCs do not interlock around the player or each
  other.
- Add encounter volumes and spawners that can be authored by the editor.
- Store faction relationship data in content, not hard-coded bootstrap logic.

### Voxel World Interactions

Useful genre elements:
- Minecraft Dungeons traps, gates, pressure plates, falling hazards, and
  readable environmental combat.
- Tunic shortcuts and spatial secrets: doors, hidden paths, elevation puzzles,
  locked gates, and return routes.
- Diablo/Titan Quest destructibles and containers that provide loot and combat
  texture.

Engine implications:
- Generalize doors, pistons, and moving blocks into a mechanism graph:
  triggers, actuators, timing, blocking policy, and signal channels.
- Add authorable trigger volumes and region tags: no-walk, hazard, safe zone,
  encounter, checkpoint, camera hint.
- Add destructible voxel/object props with health, loot drop, and debris
  presentation.
- Keep moving solid objects registered in collision, pathfinding, and AI
  avoidance as first-class obstacles.
- Add tests around moving-block collision so traps can push actors without
  tunneling or burying them.

### Exploration And World Readability

Useful genre elements:
- Tunic rewards observation: landmarks, obscured paths, reusable keys, signs,
  manual pages, and compact world language.
- Diablo/Titan Quest uses hubs, portals, checkpoints, and quest breadcrumbs.
- Minecraft Dungeons keeps goals readable with strong silhouettes and clear
  objective markers.

Engine implications:
- Add marker entities: sign, portal, checkpoint, objective, exit, hidden path.
- Add simple quest/objective state before complex branching quests.
- Add camera hint volumes for tight spaces and important reveals.
- Add minimap/overlay hooks later, but first expose level metadata and region
  data.
- Make editor validation catch missing spawn, unreachable objectives, and
  disconnected encounter regions.

### UI And Tooling

Useful genre elements:
- ARPG UI needs compact health/resources, ability bar, interaction prompt,
  pickup feed, inventory/equipment, item compare, map/objectives, and readable
  combat feedback.
- The editor needs command-oriented tools, undo/redo, property panels, palette
  controls, validation, and preview/debug layers.

Engine implications:
- Add input action mapping and command labels that the HUD can read.
- Keep UI widgets bound to view models rather than ECS arrays directly.
- Extend `/ui-demo.html` whenever adding a new reusable widget.
- Add editor tools only after level serialization, edit sessions, and undoable
  commands are stable.

## Future Plan

### Research Track - Current Branch

Goal: use this branch to review feature direction and identify architecture
changes before implementation branches.

Deliverables:
- Keep this README focused on structure and future plan.
- Keep completed phase detail in `CHANGELOG.md`.
- Review current engine seams: action/input, mechanisms, AI, collision,
  serialization, UI binding, and editor readiness.
- Produce implementation issues or branch plans from this review.

Exit criteria:
- The next implementation branch has a narrow scope and clear acceptance tests.

### Phase A - Action And Gameplay Contracts

Goal: introduce the contracts needed for ARPG mechanics without building the
full content set yet.

Deliverables:
- Input action map with buffering, hold/release state, and display labels.
- `ActionIntent` or equivalent bridge from input/AI to gameplay systems.
- Ability definitions for melee, bow shot, interaction, air push, and jump.
- Damage/status primitives with faction-aware target filtering.
- Small tests for action buffering, cooldowns, target filtering, and status
  lifetime.

Exit criteria:
- Player and NPC behavior can invoke actions through the same contract.
- Existing demo controls still feel unchanged.

### Phase B - Navigation, Avoidance, And AI Roles

Goal: make NPC movement and enemy behavior reliable before adding more content.

Deliverables:
- Dynamic obstacle integration for player, NPCs, stones, pistons, and doors.
- Local avoidance or reservation logic to prevent interlocking.
- Behavior states for idle, patrol, chase, attack, blocked, and return.
- Encounter/faction targeting using the relationship matrix.
- Debug overlay toggles for paths, avoidance radii, state, and target.

Exit criteria:
- Multiple NPCs can navigate through moving-door/piston test areas without
  permanent blocked/repath loops.

### Phase C - Mechanism And Region System

Goal: turn doors, pistons, traps, no-walk zones, and future editor-authored
areas into one coherent world-interaction layer.

Deliverables:
- Region registry for hazards, no-walk areas, encounter zones, camera hints,
  checkpoints, and objectives.
- Mechanism graph with triggers, actuators, timers, blocking policy, and signal
  channels.
- Moving-solid collision rules for crushing, pushing, blocking, and path
  invalidation.
- Demo playground for traps, shortcuts, locked doors, and environmental hazards.

Exit criteria:
- A trap corridor can affect player, NPCs, projectiles, and pathfinding through
  shared mechanism/obstacle contracts.

### Phase D - Loot, Inventory, And Equipment

Goal: add a small but extensible item loop.

Deliverables:
- Item base definitions and item instances.
- Pickup, inventory, stack, equipment slot, and stat modifier data.
- Basic loot tables and deterministic drops.
- UI widgets for pickup feed, equipment slots, inventory grid, and item compare.
- Visual attachment updates driven by equipped items.

Exit criteria:
- Player can pick up, equip, compare, and use at least one weapon and one
  consumable through data-driven item definitions.

### Phase E - Editor Data Foundation

Goal: start editor work only on stable data and command APIs.

Deliverables:
- Level save/load round trip for chunks, palette, entities, mechanisms, regions,
  and metadata.
- Bulk voxel edit sessions with undoable commands.
- Editor viewport with scoped input and renderer reuse.
- Paint, erase, pick, fill, selection, spawn placement, and validation tools.
- Game launch against an edited level.

Exit criteria:
- A playable test level can be authored without modifying source code.

### Phase F - Asset And Presentation Pipeline

Goal: replace code-native placeholder visuals without changing gameplay logic.

Deliverables:
- glTF asset registry with code-native fallback visuals.
- Actor sockets for main hand, off hand, back, overhead, and ground markers.
- Animation hooks for idle, walk, attack, hit, cast, pickup, and death.
- Material/presentation events for status effects and interactable highlights.

Exit criteria:
- Hero or NPC visuals can be swapped to authored assets without changing
  physics, action, AI, or item systems.

### Phase G - Scale And Performance

Goal: optimize measured bottlenecks after content scale increases.

Deliverables:
- Counters for frame time, fixed-step cost, path queries, remesh time, draw
  calls, entity count, and UI update cost.
- Worker meshing only when authored levels produce measurable spikes.
- Height/path caches when NPC navigation becomes active at scale.
- Chunk streaming only after levels exceed bounded demo size.

Exit criteria:
- Performance work is tied to metrics, not assumptions.

## Local Development

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 8000
npm run typecheck
npm test
npm run build
```

## Shader Docs

TSL primer and material examples live under [`docs/shaders/`](./docs/shaders/):

- [`docs/shaders/tsl-cheatsheet.md`](./docs/shaders/tsl-cheatsheet.md)
- [`docs/shaders/examples.md`](./docs/shaders/examples.md)
- `src/client/engine/render/materials/`

## License

ISC. See [`LICENSE`](./LICENSE).

## Acknowledgements

Reworked from [`three.js-rts-ecs-engine`](https://github.com/andvolodko/three.js-rts-ecs-engine)
by andvolodko, which was itself based on Sean Bradley's Three.js TypeScript
boilerplate (`socketio` branch).
