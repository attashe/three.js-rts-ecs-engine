# NPC And Enemy Behaviour State Machine - First Draft

This document drafts the first real behaviour model for NPCs and enemies. It
should sit above the existing locomotion systems:

- `MovementState` remains low-level movement feedback: idle, moving, airborne,
  blocked, repathing.
- The new behaviour state decides intent: patrol, investigate, chase, attack,
  flee, return home, talk, die.
- Physics still owns `Position`.
- Path following still owns waypoint movement.
- Actions and damage flow through the new core contracts added on
  `feature/core-improve`.

The goal is not to build complex AI immediately. The goal is to create a small,
testable state machine that can grow into Diablo/Titan Quest enemy packs,
Minecraft Dungeons readable enemy roles, and neutral/friendly NPC behaviour.

## Design Goals

- One behaviour contract for neutral NPCs, allies, and enemies.
- Data-driven states and transitions, not one-off systems per enemy.
- Clear separation between decision, movement, action, perception, and
  presentation.
- Deterministic enough for tests.
- Debuggable in the current overlay: state, target, path, alert level, and
  blocked reason.
- Editor-ready later: archetypes, patrol routes, encounter regions, leash
  volumes, and faction rules should be authorable.

## Required Concepts

### Actor Role

Role is a content-level hint for choosing behaviour parameters.

Candidate roles:
- `civilian`: talks, flees from enemies, does not fight.
- `merchant`: talks, stays near post, can flee or call guards.
- `guard`: patrols, investigates threats, attacks enemies, returns to post.
- `melee`: closes distance and attacks in short arcs.
- `ranged`: keeps distance and shoots.
- `caster`: keeps distance, casts slower telegraphed abilities.
- `blocker`: holds position or doorway, high push resistance.
- `skirmisher`: circles, darts in and out.
- `summoner`: avoids direct melee, spawns allies.
- `boss`: custom ability schedule, larger leash, special phases.

Do not encode these as separate systems. Encode them as behaviour profiles.

### Behaviour Profile

Profile data should define:

- `role`
- `faction`
- `home`: point or region id
- `leashRadius`
- `sightRadius`
- `hearingRadius`
- `fieldOfViewRadians`
- `patrolRouteId`
- `wanderRadius`
- `preferredRange`
- `attackRange`
- `retreatRange`
- `repathCooldown`
- `stuckTimeout`
- `targetPriority`
- `actions`: action ids usable by this actor

Example:

```ts
{
    id: 'hostile_melee_grunt',
    role: 'melee',
    faction: FactionId.Hostile,
    sightRadius: 8,
    hearingRadius: 5,
    leashRadius: 12,
    preferredRange: 1.15,
    attackRange: 1.35,
    actions: ['move', 'attack.primary'],
}
```

### Blackboard

Each actor needs small mutable state outside typed-array components:

```ts
interface ActorBlackboard {
    state: BehaviourStateId
    previousState: BehaviourStateId
    targetEid?: number
    targetLastSeenAt?: number
    targetLastSeenPosition?: { x: number; y: number; z: number }
    home: { x: number; y: number; z: number }
    patrolIndex: number
    stateTime: number
    nextThinkAt: number
    nextRepathAt: number
    blockedTime: number
    alert: number
}
```

This should probably live as `world.behaviourByEid: Map<number,
ActorBlackboard>`, matching existing side-table patterns for paths,
interactions, and mechanisms.

## State List

### `Dormant`

Actor exists but does not think.

Use for:
- Actors outside active encounter regions.
- Spawned enemies waiting for a trigger.
- Editor preview actors.

Transitions:
- `Dormant -> Idle` when region activates.
- `Dormant -> Dead` if killed before activation.

### `Idle`

Actor stands in place and scans.

Use for:
- Neutral NPCs waiting for interaction.
- Guards at posts.
- Enemies before aggro.

Actions:
- Face interest point occasionally.
- Run perception query on a low frequency.

Transitions:
- `Idle -> Talk` if player interacts and actor is friendly/neutral.
- `Idle -> Alert` if suspicious stimulus is detected.
- `Idle -> Chase` if enemy is seen clearly.
- `Idle -> Patrol` if profile has patrol route.
- `Idle -> Wander` if profile has wander radius.
- `Idle -> Flee` if actor is non-combatant and enemy is close.
- `Idle -> Dead` if health reaches zero.

### `Wander`

Actor picks random reachable points near home.

Use for:
- Current wandering NPC replacement.
- Ambient villagers, scouts, neutral animals later if desired.

Actions:
- Choose point within `wanderRadius`.
- Request path.
- Follow path through `MoveAlongPathSystem`.
- Pause briefly at destination.

Transitions:
- `Wander -> Idle` after destination pause.
- `Wander -> Alert` if suspicious stimulus is heard.
- `Wander -> Chase` if enemy is seen.
- `Wander -> Flee` if non-combatant sees enemy.
- `Wander -> Reposition` if blocked by crowd but still has target intent.
- `Wander -> Dead` on death.

### `Patrol`

Actor follows authored route points.

Use for:
- Guards.
- Enemy patrols.
- Tutorial or test corridors.

Actions:
- Follow route point by point.
- Optional wait times and facing directions at nodes.

Transitions:
- `Patrol -> Alert` on suspicious stimulus.
- `Patrol -> Chase` on confirmed enemy sight.
- `Patrol -> ReturnHome` if displaced too far.
- `Patrol -> Dead` on death.

### `Alert`

Actor knows something may be wrong but does not have a confirmed target.

Use for:
- Heard projectile impact.
- Saw target briefly.
- Found damaged ally.
- Mechanism/trap noise.

Actions:
- Face stimulus.
- Move to `targetLastSeenPosition`.
- Increase scan frequency.
- Optionally call nearby friends.

Transitions:
- `Alert -> Chase` if enemy becomes visible.
- `Alert -> Investigate` if last-seen point is reachable.
- `Alert -> Idle` if alert timer expires.
- `Alert -> Flee` if actor is non-combatant and threat is likely.
- `Alert -> Dead` on death.

### `Investigate`

Actor walks to a last-known location and searches.

Use for:
- Player breaks line of sight.
- Noise or trap event.
- Projectile impact nearby.

Actions:
- Path to last-known position.
- Search around it for a short duration.

Transitions:
- `Investigate -> Chase` if target reacquired.
- `Investigate -> Alert` if new suspicious stimulus happens.
- `Investigate -> ReturnHome` when search expires.
- `Investigate -> Reposition` if blocked.
- `Investigate -> Dead` on death.

### `Chase`

Actor has a target and tries to enter useful range.

Use for:
- Melee enemies closing distance.
- Guards pursuing hostile faction members.
- Ranged/caster actors moving to preferred range.

Actions:
- Track target if visible.
- Repath to target when target moves significantly or path expires.
- Apply local avoidance and dynamic obstacle rules.
- If actor is ranged/caster, do not always close to melee range; use
  preferred range band.

Transitions:
- `Chase -> Attack` if target is in range and line/action conditions pass.
- `Chase -> Reposition` if too close, too far for role, or blocked by allies.
- `Chase -> Search` if target lost but last-known position exists.
- `Chase -> ReturnHome` if outside leash.
- `Chase -> Flee` if low health and profile permits.
- `Chase -> Dead` on death.

### `Reposition`

Actor has a target but needs a better local spot.

Use for:
- Enemy is blocked by another actor.
- Ranged actor is too close.
- Caster wants line of sight.
- Melee actor wants a free attack slot around the player.

Actions:
- Select a nearby tactical point.
- Reserve or prefer a side around target.
- Path/steer to that point.

Transitions:
- `Reposition -> Attack` if action conditions pass.
- `Reposition -> Chase` if target moves away.
- `Reposition -> Search` if target lost.
- `Reposition -> ReturnHome` if outside leash.
- `Reposition -> Dead` on death.

This is the main state to prevent enemy packs from standing in one line.

### `Attack`

Actor starts an action through the shared action/ability contract.

Use for:
- Melee swings.
- Bow shots.
- Casts.
- Pushes.
- Special enemy abilities.

Actions:
- Face target.
- Validate action.
- Emit action intent.
- Enter windup/recovery timing through action/ability state.

Transitions:
- `Attack -> Recover` after action execution.
- `Attack -> Chase` if target leaves range before uninterruptible point.
- `Attack -> Reposition` if target is blocked by ally or line of sight fails.
- `Attack -> Stunned` if interrupted.
- `Attack -> Dead` on death.

### `Recover`

Actor has just attacked and cannot immediately attack again.

Use for:
- Clear combat rhythm.
- Readable enemies.
- Cooldown and animation windows.

Actions:
- Keep facing target.
- Slow or stop movement depending on action.
- Wait for cooldown/recovery.

Transitions:
- `Recover -> Attack` if target still valid and action ready.
- `Recover -> Chase` if target moved out of range.
- `Recover -> Reposition` if role wants spacing.
- `Recover -> Flee` if low health.
- `Recover -> Dead` on death.

### `Flee`

Actor tries to move away from threat.

Use for:
- Civilian/merchant NPCs.
- Low-health enemies.
- Enemies afraid of a specific status/effect.

Actions:
- Pick point away from target and toward safe region/home.
- Avoid hazards if possible.
- Call for help if profile allows.

Transitions:
- `Flee -> Idle` if safe and not in encounter.
- `Flee -> ReturnHome` if threat gone.
- `Flee -> Chase` if cornered and combatant.
- `Flee -> Dead` on death.

### `ReturnHome`

Actor disengages and returns to home/leash area.

Use for:
- Prevent infinite chase across the map.
- Reset enemy packs.
- Return guards to post.

Actions:
- Clear target unless still inside leash.
- Path to home or patrol route.
- Regenerate or reset only if design wants that.

Transitions:
- `ReturnHome -> Idle` when home reached.
- `ReturnHome -> Patrol` if profile has patrol route.
- `ReturnHome -> Chase` if attacked inside leash.
- `ReturnHome -> Dead` on death.

### `Talk`

Neutral/friendly NPC is engaged in interaction.

Use for:
- Merchants.
- Quest NPCs.
- One-line demo conversations.

Actions:
- Face player.
- Stop wander/pathing.
- Emit interaction UI/view-model state.

Transitions:
- `Talk -> Idle` when interaction ends.
- `Talk -> Flee` if threat appears.
- `Talk -> Dead` on death.

### `Stunned`

Actor cannot act for a timed duration.

Use for:
- Future status effect contract.
- Knockback or heavy hit.
- Trap effects.

Actions:
- Stop or damp movement.
- Ignore normal actions.
- Still allow physics.

Transitions:
- `Stunned -> Chase` if target still valid and hostile.
- `Stunned -> Flee` if profile says flee after stun.
- `Stunned -> ReturnHome` if target lost.
- `Stunned -> Dead` on death.

### `Dead`

Actor is no longer active AI.

Actions:
- Clear path, target, interaction if needed.
- Remove `Attackable`.
- Emit loot/encounter death event.
- Presentation handles death mesh/animation.

Transitions:
- None for now.

## Transition Priority

Each think tick should evaluate transitions in priority order. This avoids
ambiguous behavior.

Suggested priority:

1. Death: health <= 0.
2. Hard crowd control: stunned, frozen, rooted.
3. Leash violation.
4. Immediate threat: attackable target in range.
5. Target visible but not in range.
6. Target lost but last-known position exists.
7. Strong suspicious stimulus.
8. Non-combatant flee.
9. Home/patrol/wander defaults.

Do not let low-priority behavior override high-priority survival/combat rules.

## Perception Model

Perception should be a separate system that writes target/stimulus facts to the
blackboard. Behaviour should consume facts; it should not scan every possible
target inside every state.

Inputs:
- Faction relationship matrix.
- Position, BoxCollider, Health.
- Sight radius.
- Field-of-view.
- Optional line-of-sight raycast.
- Noise/stimulus events.
- Damage events later.

Outputs:
- `targetEid`
- `targetLastSeenPosition`
- `targetLastSeenAt`
- `alert`
- recent stimulus list

First version can be simple:
- Query actors with `Faction`, `Position`, `Health`.
- Ignore dead actors.
- If `areEnemies(selfFaction, otherFaction)` and within sight radius, choose
  nearest visible target.
- Store target and last-seen position.

Later:
- Add line of sight against voxels and doors.
- Add hearing/noise.
- Add ally call-for-help.
- Add stealth or concealment tags.

## Movement And Pathing Contract

Behaviour does not set `Position` directly.

Allowed outputs:
- Set/replace `world.pathByEid`.
- Add/remove `MoveAlongPath`.
- Set desired target position in blackboard.
- Emit action intents.
- Adjust `WanderTimer` or equivalent scheduling.

Movement rules:
- `MoveAlongPathSystem` writes velocity.
- `actor-avoidance.ts` handles local steering.
- `physics-system` resolves voxel/dynamic collision.
- `dynamic-collision-system` separates overlapping actors.
- Behaviour reacts to `MovementState.Blocked` and path timers.

Blocked handling:
- Short block: stay in same state, let local avoidance solve it.
- Medium block: go to `Reposition`.
- Long block: repath or return home.
- Repeated long block: choose a different target/slot or give up.

## Attack Slot Concept

For enemy packs, chasing directly to the target center causes interlocking.
Introduce soft attack slots around the target.

Slot data:

```ts
interface AttackSlot {
    targetEid: number
    angle: number
    radius: number
    claimedBy?: number
    expiresAt: number
}
```

First implementation can avoid a full registry:
- Melee actors choose an offset around target based on eid hash.
- Ranged actors choose points near preferred range.
- Reposition if the desired slot is occupied by another actor.

Later:
- Add actual short-lived reservations.
- Debug draw slots.
- Let blockers prefer front slots and skirmishers prefer side/back slots.

## Data Model Draft

Potential components:

```ts
export const Behaviour = {
    profileId: new Uint16Array(MAX_ENTITIES),
    state: new Uint8Array(MAX_ENTITIES),
    previousState: new Uint8Array(MAX_ENTITIES),
    target: new Uint32Array(MAX_ENTITIES),
    stateTime: new Float32Array(MAX_ENTITIES),
    nextThinkAt: new Float32Array(MAX_ENTITIES),
    nextRepathAt: new Float32Array(MAX_ENTITIES),
}
```

Potential side table:

```ts
world.behaviourByEid: Map<number, ActorBlackboard>
```

Recommendation:
- Use typed arrays for hot numeric state.
- Use side table for optional vectors, last-known positions, patrol route ids,
  and debug strings.

Do not put profile objects inside ECS components.

## Systems Draft

### `perception-system`

Order: `FixedOrder.ai - 20`

Responsibilities:
- Update target memory.
- Update alert values.
- Write last-known positions.
- Do not move actors.
- Do not execute attacks.

### `behaviour-system`

Order: `FixedOrder.ai`

Responsibilities:
- Evaluate transition priority.
- Enter/exit states.
- Set path goals.
- Emit action intents or call action APIs.
- Update debug state.

### `behaviour-path-system` or existing path writes

Can remain inside `behaviour-system` at first.

Responsibilities:
- Convert desired destination into `findPath`.
- Set `world.pathByEid`.
- Apply repath cooldowns.

### Existing systems kept

- `MoveAlongPathSystem`
- `createPhysicsSystem`
- `createDynamicCollisionSystem`
- `createMeleeCombatSystem`, later generalized into ability execution
- `createProjectileLaunchSystem`, later generalized into ability execution

## Minimal First Implementation

Do not start with every state. Start with a useful subset:

1. `Idle`
2. `Wander`
3. `Chase`
4. `Attack`
5. `Reposition`
6. `ReturnHome`
7. `Dead`

This replaces the current pure wander behavior and creates the first enemy loop.

First enemy archetype:
- `hostile_melee_grunt`
- Sees player within 7-8 units.
- Chases until 1.35 units.
- Attacks with existing `attack.primary`-style melee action.
- Repositions if blocked for more than 0.5 seconds.
- Returns home if beyond 12 units.

First neutral archetype:
- `wandering_neutral_scout`
- Wanders as now.
- Talks if interacted with.
- Flees from hostile faction within 5 units.

## Debug Overlay Needs

Show per actor:
- Behaviour state.
- Movement state.
- Target eid/faction.
- Alert value.
- Path length.
- Blocked time.
- Repath cooldown.

Toggle layers:
- Perception radius.
- Leash radius.
- Attack range.
- Preferred range.
- Current target line.
- Attack/reposition slot.

The existing debug labels should switch from only `Faction + MovementState` to
`Faction + BehaviourState + MovementState`.

## Tests To Add

Pure transition tests:
- Idle hostile with visible enemy enters Chase.
- Chase actor in range enters Attack.
- Chase actor beyond leash enters ReturnHome.
- Lost target enters Investigate/Search or ReturnHome depending profile.
- Dead actor always enters Dead regardless of previous state.

Path/blocked tests:
- Blocked chase enters Reposition after timeout.
- Reposition chooses a point not occupied by another actor.
- ReturnHome clears target after reaching home.

Faction tests:
- Neutral does not chase player.
- Hostile chases player.
- Neutral flees hostile if non-combatant profile says so.

Action tests:
- Attack state emits action only when cooldown ready.
- Attack state does not emit action if target is outside range.

## Implementation Risks

- Overloading `MovementState`: keep behaviour separate.
- Letting AI teleport: behavior must write path/action intent, not position.
- Overbuilding perception: first pass can use radius-only sight; line of sight
  can come after state transitions are proven.
- Repath spam: every path request needs cooldown and reason.
- Attack interlocking: use Reposition and soft attack slots early.
- State explosion: roles should tune common states, not define new bespoke
  states for every enemy.

## First Branch Proposal

Branch name:

```text
feature/npc-behaviour-state-machine
```

Deliverables:
- `BehaviourStateId` enum and names.
- Behaviour profile definitions for neutral wanderer and hostile melee grunt.
- Blackboard side table.
- Perception helper for nearest visible enemy by faction.
- Behaviour system with minimal state subset.
- Convert current wandering NPCs to use behaviour profiles.
- Add one hostile melee enemy in demo.
- Debug label includes behaviour state.
- Tests for transition helpers.

Exit criteria:
- Neutral wanderers still wander and can be interacted with.
- Hostile enemy sees/chases/attacks/returns home.
- NPCs do not immediately fall back into the old infinite blocked/repath loop.
- Tests and build pass.

