# Engine Feature Research

This document collects candidate mechanics and engine capabilities for the next
research/review stage. It is not a content promise. Its purpose is to identify
features that would make the voxel ARPG more expressive while keeping the engine
easy to extend, test, and later expose in the editor.

## Design Targets

The useful overlap between Magicka, Minecraft Dungeons, Tunic, Diablo, and
Titan Quest is not a single mechanic. It is a pattern:

- The player has a small set of readable actions with strong feedback.
- The world responds consistently to movement, damage, objects, traps, and
  factions.
- Items and abilities are data-driven, so new content does not require new
  one-off systems.
- Encounters are authored from reusable blocks: enemies, regions, triggers,
  hazards, loot, doors, and objectives.
- Exploration rewards observation and world knowledge, not only combat stats.

The engine should therefore prioritize reusable simulation contracts over
adding isolated demo features.

## Priority Summary

Recommended near-term order:

1. Action and ability contracts.
2. Damage, status, and faction-aware targeting.
3. Dynamic obstacle and local avoidance improvements.
4. Region and mechanism graph.
5. Inventory, equipment, and loot.
6. Encounter authoring data.
7. Editor command/data foundation.
8. Asset and presentation pipeline.

This order keeps the game playable while preventing future editor work from
being built on unstable data structures.

## Core Engine Capabilities To Add

### 1. Action Layer

Current state:
- Input systems directly drive player behavior.
- Several mechanics already exist: jump buffering, melee attack, bow shot, air
  push, interaction, mouse-facing, and camera rotation.
- AI and player logic do not yet share one action contract.

Add:
- `ActionDefinition`: id, display name, input binding, buffer window, cooldown,
  resource cost, tags, and allowed actor states.
- `ActionIntent`: actor id, action id, aim vector or target, input phase
  (`pressed`, `held`, `released`), timestamp, and source (`player`, `ai`,
  `scripted`).
- `ActionState`: current cooldown, charge state, queued intent, last execution
  time.
- Action execution phases: validate, reserve, windup, execute, recover, cancel.

Why it matters:
- Magicka-style casting, Diablo attacks, interaction prompts, and editor testing
  can all use the same action pipeline.
- It prevents new mechanics from becoming special cases in input systems.

Good first actions:
- `move`
- `jump`
- `interact`
- `melee_primary`
- `bow_shot`
- `air_push`
- `camera_rotate_left`
- `camera_rotate_right`

Tests:
- Buffered action executes when actor enters an allowed state.
- Cooldown prevents repeated execution.
- Hold/release action can charge and release once.
- Disabled action does not consume input unless configured to.

### 2. Ability And Effect System

Current state:
- Melee, arrows, air push, pickups, and impacts exist as separate systems.
- Factions exist, but effects are not yet unified.

Add:
- `AbilityDefinition`: action id, execution type, hit shape, projectile spec,
  effect list, presentation event ids.
- `EffectDefinition`: damage, heal, push, pull, stun, slow, burn, freeze, shock,
  poison, shield, spawn object, trigger mechanism.
- `DamagePacket`: source, target, amount, damage type, element tags, hit point,
  impulse, faction policy.
- `StatusEffect`: id, duration, stack policy, tick rate, stat modifiers,
  enter/tick/exit events.

Candidate elements:
- Physical
- Fire
- Cold
- Lightning
- Poison
- Arcane
- Force

Why it matters:
- Magicka-style element combinations become possible later without rewriting
  combat.
- Minecraft Dungeons-style readable abilities can be described as data.
- Diablo/Titan Quest-style item affixes can modify existing effect data.

Catchy mechanics enabled:
- Fire ignites wooden props or burning oil.
- Cold slows enemies and can make water/ice paths temporarily walkable.
- Lightning arcs between wet or metal-marked targets.
- Force pushes stones, projectiles, and light enemies.
- Poison creates area denial zones.
- Shields block projectiles but can be broken by force.

Tests:
- Faction filters prevent friendly fire when policy says so.
- Status stack policy works for refresh, stack, replace, and ignore modes.
- Damage resistance modifies the packet deterministically.
- Projectile and melee hit paths produce the same damage packet shape.

### 3. Actor Stats And State

Current state:
- Components exist for movement, collision, faction, and combat-adjacent logic.
- There is no complete actor model for health, resources, stats, or state.

Add:
- `Health`: current, max, invulnerability timer, death state.
- `Resource`: mana/stamina/energy, regeneration, spend rules.
- `ActorStats`: movement speed, attack speed, cast speed, armor, resistances,
  push resistance, jump strength.
- `ActorState`: idle, moving, jumping, attacking, casting, stunned, dead.
- State locks and interrupts so abilities can express what they cancel.

Why it matters:
- AI, player, UI, combat, and equipment need one source of truth.
- Without state contracts, future features will fight over velocity, animation,
  and ability timing.

Tests:
- Dead actors stop accepting normal actions.
- Stun interrupts interruptible actions but not uninterruptible ones.
- Stat modifiers apply and remove cleanly.

### 4. Dynamic Obstacles And Local Avoidance

Current state:
- NPCs can pathfind and jump uphill.
- NPCs can interlock or get stuck in blocked/repath loops.
- Player and moving objects can block paths.
- Pistons, doors, stones, and actors all affect navigation in different ways.

Add:
- `DynamicObstacle`: shape, radius/AABB, blocking layer, owner entity, priority.
- Local steering layer above path following: separation, goal seeking, obstacle
  side preference, stuck timer, and repath cooldown.
- Short-term reservations for narrow cells, doorways, and one-tile corridors.
- Path invalidation events when mechanisms, stones, or actors block a route.
- Actor priority rules: player can block NPCs; heavy enemies can push light
  actors; bosses can reserve larger areas.

Why it matters:
- Diablo-like packs require many actors to move around each other.
- Minecraft Dungeons-style corridors and traps need actors to behave believably.
- Editor-authored encounters will quickly expose navigation failures.

Catchy mechanics enabled:
- Enemies fan around the player instead of forming one stuck line.
- Shield enemies hold a doorway while ranged enemies shoot over or around them.
- A piston trap can split a pack and force dynamic repathing.
- Falling stones become temporary obstacles that AI routes around.

Tests:
- Two NPCs targeting opposite corridor ends do not permanently deadlock.
- Repath cooldown prevents infinite path spam.
- Moving doors invalidate paths when closed and restore passability when open.
- Reservation timeout frees cells if an actor dies or is pushed away.

### 5. Mechanism Graph

Current state:
- Doors and pistons exist, but they are still demo-specific.
- Moving blocks can push or ignore actors depending on behavior.

Add:
- `MechanismNode`: trigger, actuator, logic gate, timer, counter, relay.
- `MechanismSignal`: channel, source, value, timestamp.
- `Trigger` types: pressure plate, lever, proximity volume, hit sensor, item
  socket, enemy death, quest state, timer.
- `Actuator` types: door, piston, bridge, platform, trap, spawner, light, loot
  container, region toggler.
- Blocking policy: stop on actor, push actor, crush actor, ignore actor, reverse.
- Pathing policy: blocks navigation, high-cost navigation, ignored by navigation.

Why it matters:
- Tunic-style shortcuts and Minecraft Dungeons-style traps both need the same
  trigger/actuator layer.
- The editor can author mechanisms only if their data model is stable.

Catchy mechanics enabled:
- Pressure plate opens one door but arms another trap.
- A lever reverses piston timing.
- A locked gate opens when all enemies in a region die.
- A bridge extends over a gap, changing NPC pathfinding.
- A trap crushes loose stones into debris that blocks another path.

Tests:
- Trigger activation order is deterministic.
- Timed actuators complete even when the player leaves the area.
- Blocking policy produces expected actor movement or damage.
- Mechanism state serializes and restores correctly.

### 6. Region System

Current state:
- No-walk zones and demo-specific areas exist conceptually.
- The editor will eventually need authorable volumes.

Add:
- Region registry keyed by id.
- Region shapes: box, cylinder, polygon prism, voxel mask.
- Region traits: no-walk, hazard, safe zone, encounter, checkpoint, camera hint,
  objective, ambient audio, biome, spawn area.
- Query API: point in region, AABB overlap, enter/exit events, active region
  set per actor.

Why it matters:
- Regions become the glue between world design, AI, UI, quests, and editor
  validation.
- They make non-voxel gameplay areas explicit instead of hidden in code.

Catchy mechanics enabled:
- Entering a shrine region grants a temporary shield.
- A poison swamp damages actors and changes path cost.
- A camera hint region rotates or zooms the isometric camera.
- An encounter region seals doors until enemies are defeated.

Tests:
- Enter/exit fires exactly once when crossing a region boundary.
- Region priority resolves overlapping camera hints.
- Hazard ticks are stable across fixed timestep rates.

### 7. Items, Inventory, Equipment, And Loot

Current state:
- Pickups exist.
- Weapons are visual factories, not data-driven equipment.

Add:
- `ItemBase`: id, name, category, tags, stack limit, icon, model id, base stats.
- `ItemInstance`: unique id, base id, quantity, affixes, durability/charges.
- `Inventory`: slots, stack rules, filters.
- `Equipment`: slots, currently equipped item ids, attachment targets.
- `LootTable`: weighted entries, level ranges, rarity, deterministic seed.
- `Affix`: stat modifiers, ability modifiers, status triggers.

Why it matters:
- Diablo/Titan Quest-style gear depends on item data driving stats and visuals.
- Minecraft Dungeons-style simplicity can still use the same data with fewer
  item dimensions.

Catchy mechanics enabled:
- Bow with fire affix ignites arrows.
- Sword with knockback affix pushes light enemies into traps.
- Boots change jump or movement behavior.
- Relic opens hidden doors or reveals region markers.
- Consumable potion applies a status effect through the same effect system.

Tests:
- Stack rules merge and split correctly.
- Equipment modifiers apply once and remove once.
- Loot table with a seed produces stable results.
- Invalid item instances fail validation.

### 8. Encounter And Spawn System

Current state:
- Demo spawns are hard-coded in bootstrap/level metadata.
- Factions exist but are not yet full encounter data.

Add:
- `EncounterDefinition`: region id, spawn groups, trigger policy, completion
  condition, reward table, reset policy.
- `SpawnGroup`: actor archetype, count, formation, delay, faction, role.
- Roles: blocker, melee, ranged, caster, summoner, elite, support, flee-only.
- Difficulty knobs: count scale, health scale, ability set, elite modifiers.

Why it matters:
- Diablo-style packs and Minecraft Dungeons rooms need repeatable authoring.
- The editor can place encounters without hard-coding NPCs in `client.ts`.

Catchy mechanics enabled:
- A room locks until two enemy waves are defeated.
- Elite enemy has a random modifier like fire trail or stone skin.
- Ambush spawns behind the player after opening a chest.
- Friendly NPCs fight hostile factions if relationship data says enemy.

Tests:
- Encounter starts once unless reset policy allows restart.
- Completion fires after all required actors die or leave.
- Spawned actors are cleaned from side tables on despawn.

### 9. Quest, Objective, And World State

Current state:
- There are interactions and props, but no world-state layer.

Add:
- `WorldFlag`: boolean, number, string, or enum state.
- `Objective`: id, title, state, tracked target, region, dependencies.
- `InteractionResult`: set flag, add item, start encounter, trigger mechanism,
  show dialogue, complete objective.
- Saveable world-state snapshot.

Why it matters:
- Tunic-style discovery and Diablo/Titan Quest quest breadcrumbs require small
  persistent state.
- Mechanisms, doors, NPCs, and UI need one shared way to read world progress.

Catchy mechanics enabled:
- Find a key to open a shortcut gate.
- Activate three shrines to lower a bridge.
- Rescue NPC changes faction relationship in a region.
- Hidden objective reveals only after reading a sign or finding a relic.

Tests:
- Objective dependencies unlock in correct order.
- World flags persist through save/load.
- Interaction cannot complete twice unless repeatable.

### 10. Save, Load, And Validation

Current state:
- Level serialization foundations exist.
- Runtime content is still partly hard-coded.

Add:
- Save data for chunks, palette, entities, regions, mechanisms, encounters,
  world flags, inventory, and player state.
- Validation passes: missing spawn, invalid palette index, unreachable region,
  broken mechanism references, invalid item ids, orphaned encounter spawns.
- Migration/version fields for level data.

Why it matters:
- Editor work depends on reliable round trips.
- Research features become maintainable only if data can be validated.

Tests:
- Save/load preserves level and gameplay state.
- Invalid references produce clear validation errors.
- Old version loads through migration or fails with a useful message.

### 11. UI View Models

Current state:
- Shared UI components exist.
- Game systems still mostly call notification callbacks directly.

Add:
- Small view-model stores for HUD: health, resources, action bar, interaction
  prompt, pickup feed, objective tracker, debug state.
- Item view models for inventory and comparison.
- Ability view models for cooldowns, key labels, charges, disabled reasons.
- Debug panels that can subscribe to engine metrics without touching ECS arrays
  directly from DOM code.

Why it matters:
- UI should not bind directly to raw SoA arrays.
- The UI demo page can test widgets with mock view models before gameplay is
  complete.

Catchy mechanics enabled:
- Ability bar shows cooldown sweep and buffer flash.
- Interaction prompt changes based on target and required item.
- Pickup feed groups gold/materials and highlights rare items.
- Debug overlay can toggle AI paths, regions, and mechanisms.

Tests:
- View models update only when source state changes.
- UI widgets dispose subscriptions cleanly.

### 12. Editor Command Foundation

Current state:
- Editor shell exists, but editor tools are not implemented.

Add:
- `EditorCommand`: id, label, apply, undo, redo, affected bounds.
- Edit sessions for bulk voxel changes.
- Tool context: selected tool, brush, material, selection bounds, hovered voxel.
- Command history with grouping for drag operations.
- Preview layer for brush/selection/mechanism regions.

Why it matters:
- The editor should not mutate chunks directly per pointer move.
- Undo/redo and validation must exist before production tools.

Catchy mechanics enabled:
- Paint hazard/no-walk/encounter regions visually.
- Place a pressure plate and wire it to a piston in the editor.
- Stamp a trap room or enemy camp.
- Validate that a door has a trigger and that an objective is reachable.

Tests:
- Command apply/undo restores chunks and metadata.
- Drag painting groups into one undo step.
- Affected bounds correctly mark chunks dirty.

## Feature Candidates By Player Experience

### High-Value Small Features

- Interaction prompt above nearby objects.
- Health/resource HUD and action bar.
- Pickup feed with item rarity color.
- Enemy overhead health/nameplates.
- Simple destructible crates and pots.
- Checkpoints or respawn markers.
- Locked door and key item.
- Pressure plate opening a door.
- Hazard floor with damage over time.
- Region-based objective marker.

These are good because they exercise many contracts without requiring large
content production.

### Medium Features

- Elemental status effects: burn, chill, shock, poison.
- Elite enemy modifiers.
- Small inventory/equipment screen.
- Loot tables and random affixes.
- Encounter rooms with doors that lock/unlock.
- Local avoidance for enemy packs.
- Editor placement of spawn points, regions, and mechanisms.

These are valuable after the action/effect/region contracts exist.

### Large Features

- Full Magicka-like spell composition.
- Full Diablo-like itemization with many affixes.
- Multi-level world map or hub/portal system.
- Procedural dungeon generation.
- Complex quest chains.
- Authored glTF animation state machines.
- Workerized streaming world.

These should wait until smaller contracts are proven.

## Recommended Next Implementation Branches

### Branch 1: `feature/action-contracts`

Scope:
- Input action map.
- Action intent/state.
- Convert melee, bow, interact, air push, and jump to action definitions.
- Keep gameplay feel unchanged.

Acceptance:
- Existing controls still work.
- Action buffer and cooldown tests pass.
- UI command hints read labels from action definitions.

### Branch 2: `feature/damage-status`

Scope:
- Damage packets.
- Health and death state.
- Status effect lifetime.
- Faction-aware filtering.
- Convert melee and arrow hit to damage packets.

Acceptance:
- Melee and arrows use the same damage path.
- Friendly/neutral/enemy policy is test-covered.
- Status effects can be displayed by debug UI.

### Branch 3: `feature/navigation-avoidance`

Scope:
- Dynamic obstacle registry cleanup.
- Local avoidance/reservation for NPCs.
- Better blocked/repath backoff.
- Debug visual toggles.

Acceptance:
- Multiple NPCs do not permanently interlock near the player.
- Piston/door path invalidation does not create infinite repath loops.

### Branch 4: `feature/mechanism-regions`

Scope:
- Region registry.
- Trigger/actuator mechanism graph.
- Convert current doors and pistons to mechanism data.
- Add hazard and checkpoint test regions.

Acceptance:
- Trap corridor uses shared trigger/actuator data.
- Mechanism state can be serialized.

### Branch 5: `feature/items-equipment`

Scope:
- Item base and item instance data.
- Inventory and equipment slots.
- Pickup feed and basic inventory UI.
- Equip sword/bow through data.

Acceptance:
- Player can pick up, equip, compare, and use simple item data.

## Risks

- Too many features before contracts: avoid adding content that bypasses action,
  damage, region, item, or mechanism data.
- UI coupling to ECS arrays: use view models.
- AI movement churn: solve local avoidance before adding many enemy types.
- Editor too early: editor tools should wait for serialization, validation, and
  undoable commands.
- Over-abstracting mechanisms: keep the first mechanism graph small and driven
  by doors, pistons, pressure plates, and hazards.

## Research Exit Criteria

This research is complete when the next implementation branch has:

- One primary engine contract to add.
- A short list of mechanics it unlocks.
- Explicit tests.
- A demo scenario.
- A rollback path if the abstraction is too heavy.
