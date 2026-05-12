# AI Architecture Plan

Branch: `ai-refine`

The AI system is moving from "profile + hardcoded state handlers" toward a
layered, data-authored model inspired by games with daily routines, patrols,
guard reactions, and encounter waves.

## Goals

- New NPC/enemy types should be built mostly from data: profile, faction,
  schedule, zones, route points, and actions.
- Combat, perception, social reactions, and schedules must remain separate
  layers so one layer can interrupt another without rewriting the actor.
- Movement continues to use the existing path and physics systems. The AI layer
  should request goals, not move entities directly.
- Debug information stays visible. Optimization work must make AI data cheaper
  and clearer, not hide paths, labels, boxes, or metrics.

## Layer Model

1. Profile
   - Defines role, combat ranges, attack kind, flee behavior, social response,
     leash, sight radius, and default movement tuning.
   - Current implementation: `BehaviourProfile`.

2. Perception
   - Finds visible enemies and writes target memory to the blackboard.
   - Current implementation: spatially indexed perception pass.
   - Future: line of sight, hearing, suspicion, crime/witness stimuli.

3. Schedule
   - Defines baseline intent when the actor is not in combat or fleeing.
   - New implementation: named `AiSchedule` steps assigned per actor.
   - Supported first-pass steps:
     - `idle`: stand and wait.
     - `travelZone`: path toward a sampled point inside a zone.
     - `wanderZone`: move into a zone, then wander inside it.
     - `patrolRoute`: follow authored waypoints.
     - `assaultZone`: move toward a broad target zone, useful for bandit waves
       entering from a map edge toward a village.

4. Zones
   - Named world areas used by schedules and encounter logic.
   - New implementation: `AiZone`, with circular or rectangular XZ footprints.
   - Examples: `home`, `workshop`, `village-square`, `hunting-field`,
     `bandit-spawn-edge`, `village`.

5. State Machine
   - Resolves high-priority transitions: death, flee, attack, chase, reposition,
     return, schedule movement.
   - New state added: `Patrol`.
   - Combat still interrupts schedules; when the actor returns to a baseline
     state, the schedule can resume control.

6. Actions
   - Existing melee/bow handlers are still inside `BehaviourSystem`.
   - Future: move action execution into data-driven action definitions:
     melee swing, bow shot, shield raise, cast spell, call guard, open door.

## Current Implementation

- Added `src/client/engine/ecs/ai.ts`.
- Added `GameWorld.aiZones`, `GameWorld.aiSchedules`, and
  `GameWorld.aiScheduleByEid`.
- Added helpers:
  - `defineAiZone`
  - `defineAiSchedule`
  - `assignAiSchedule`
  - `tickAiSchedule`
  - `sampleZonePoint`
  - `isPointInZone`
- `BehaviourSystem` now applies schedules only from baseline states:
  `Idle`, `Wander`, `TravelToActivity`, and `Patrol`.
- Combat, fleeing, recovery, death, and return-home states are not overwritten
  by schedules.
- Debug metrics now include `ai.actors` and `ai.scheduled`.
- Demo startup now defines shared village/work/hunting zones and assigns
  schedules:
  - villagers: individual home/work zones with per-villager day loops.
  - guards: authored patrol route.
  - hunters: travel to and wander the hunting field.
  - default village bandits/archers: assault the village zone.
- The village demo map has been reworked for AI readability:
  - village houses are roofless so actor labels, paths, and combat remain
    visible from the camera.
  - village houses do not register door mechanisms, avoiding blocked entrances
    during path and schedule testing.
  - the west-side attackers are expanded into a visible wave that uses the
    assault-zone schedule.
- Debug overlay now renders named AI zones as amber outlines with labels when
  the existing debug layer is enabled. Demo-authored zones use rectangular
  footprints so home/work/field/assault areas are easier to inspect against
  voxel roads and buildings without removing actor boxes, labels, or path lines.

## Example Authoring Shapes

Villager with daily route:

```ts
defineAiSchedule(world, {
    id: 'villager_farmer_day',
    steps: [
        { id: 'morning-home', kind: 'idle', duration: 4 },
        { id: 'to-field', kind: 'travelZone', zoneId: 'farm-field' },
        { id: 'work-field', kind: 'wanderZone', zoneId: 'farm-field', duration: 20 },
        { id: 'return-home', kind: 'travelZone', zoneId: 'farmer-home' },
    ],
})
```

Guard patrol:

```ts
defineAiSchedule(world, {
    id: 'village_gate_guard',
    steps: [{
        id: 'gate-route',
        kind: 'patrolRoute',
        points: [
            { x: 20.5, y: 5, z: 32.5 },
            { x: 31.5, y: 5, z: 22.5 },
            { x: 42.5, y: 5, z: 32.5 },
        ],
    }],
})
```

Bandit wave:

```ts
defineAiSchedule(world, {
    id: 'bandit_wave_to_village',
    loop: false,
    steps: [
        { id: 'enter-map', kind: 'assaultZone', zoneId: 'village' },
        { id: 'raid', kind: 'wanderZone', zoneId: 'village' },
    ],
})
```

## Next Phases

Phase A: Wire Demo Content
- Done: startup-level zones/schedules are defined and assigned to villagers,
  guards, hunters, and default village attackers.
- Done: village level contains per-villager home/work schedule metadata and an
  attacker wave.
- Next: move these definitions from startup helper code into explicit level
  metadata so the future editor can author them directly.
- Next: replace direct hunter `activity` setup with per-actor home/field zones.

Phase B: Improve Schedule Semantics
- Add schedule conditions: time-of-day, target killed, alarm active, zone reached.
- Add finite and looping route options.
- Add wait/facing data per patrol point.
- Add zone occupancy and preferred slots so workers do not stack in one point.

Phase C: Perception And Stimuli
- Add explicit stimuli: noise, attack witnessed, corpse found, projectile impact.
- Let guards investigate last-known stimulus before chasing.
- Make villagers call nearby guards instead of only fleeing.

Phase D: Encounter Director
- Spawn or activate wave groups from zone edges.
- Let a group share a destination zone and faction-level objective.
- Add group cohesion and role spacing for fighters/bowmen.

Phase E: Action Data
- Move melee, bow, shield, spell, call-for-help, and interact actions into
  authorable action definitions.
- Behaviour profiles should list allowed actions; states choose actions based
  on target/range/cooldown.
