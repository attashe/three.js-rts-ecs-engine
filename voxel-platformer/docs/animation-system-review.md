# Animation System Review

This document records the critical animation review and the follow-up plan for
making character animation less fragile as the game gains more NPCs, equipment,
combat actions, and imported models.

## Current State

- `AnimationController` owns a Three.js `AnimationMixer` per animated entity and
  maps pure state-machine layers onto `AnimationAction` weights.
- The pure graph/state-machine layer is testable without Three.js.
- Player animation runs through the ECS `animation-system`; NPCs use the same
  `AnimationController` but are driven from `npc-render-system`.
- Part-based player/NPC rigs and optional glTF rigs both expose the same
  `ClipSet` contract: root object, clips, and socket map.
- Player and NPC hand equipment now share item creation and per-item socket
  frames, but their lifecycle code is still split.

## Bugs Fixed In This Pass

- Animation actions are reset and unpaused when entering a state, after
  `playStateImmediate()`, and when returning from scrub/preview mode.
- Non-speed-synced clips explicitly restore their authored `speed`, so a reused
  action cannot keep stale timing.
- Combat graph states now start only from grounded living locomotion states.
  Attack/shoot no longer interrupt jump, fall, die, or dead.
- Player attack/shoot systems now require `Grounded` before consuming input.
- Combat visuals face the entity aim/look direction while attacking or shooting,
  instead of continuing to face strafe/travel direction.
- Runtime graph construction validates that every graph state has a matching
  clip. Missing clips now fail with a clear error instead of silently producing a
  frozen/empty layer.
- Registered player/NPC glTF overrides must provide the combat clip set:
  `idle`, `walk`, `run`, `jump`, `fall`, `land`, `attack`, `attackWide`,
  `shoot`, `die`, `dead`.

## Remaining Architecture Risks

- Gameplay timing is not animation-timed yet. Melee damage and arrow spawning
  still happen when input is consumed, while the visible hit/release happens
  later in the clip.
- The state machine consumes triggers but does not support queued same-state
  retriggering. Repeated attack/shoot input while already in that state will not
  restart the clip cleanly.
- NPC animation uses the same controller but not the same ECS lifecycle as the
  player, which makes debugging, metrics, and future shared behavior harder.
- Equipment socket frames are still hand-authored per item/slot. They are
  centralized, but visual regressions are easy when adding a new character model
  or item.
- Procedural and imported clip tracks bind by node name. Duplicate target node
  names can bind tracks incorrectly.
- Travel-facing and aim-facing are currently a simple whole-body switch. Long
  term, upper-body aim/combat should layer over lower-body locomotion.

## Proposed Improvements

1. Add animation notifies.
   - Extend clip definitions with named events such as `melee-hit`,
     `arrow-release`, `footstep`, `land`, and `death-settled`.
   - Let `AnimationController.update()` emit events when clip time crosses those
     notify timestamps.
   - Move melee damage and arrow spawning to notify handlers so gameplay matches
     the visible animation.

2. Add trigger queue and retrigger support.
   - Queue trigger params until they can be accepted by a valid transition.
   - Support explicit same-state retrigger rules for one-shot states such as
     attack and shoot.
   - Keep death as a high-priority latched state that clears pending combat.

3. Unify player/NPC animation lifecycle.
   - Keep NPC-specific data in NPC runtime, but attach animated NPC entities to
     the same ECS animation path where practical.
   - Reuse one loadout application helper for player and NPC hands/head/back.
   - Mirror animation metrics for both player and NPC controllers.

4. Add authoring validation and preview coverage.
   - Detect duplicate target node names in part rigs and imported glTF scenes.
   - Validate graph states, clip tracks, and sockets together for each character
     profile.
   - Add an animation preview matrix that shows every supported item in each
     socket for every player/NPC model.

5. Introduce layered aim/combat.
   - Keep lower body facing travel direction for locomotion.
   - Layer chest/arms toward aim direction for attack, shoot, cast, and interact
     poses.
   - Preserve whole-body fallback for simple rigs that do not expose upper-body
     controls.

## Acceptance Criteria For Future Work

- A bow shot spawns the arrow at the visual release frame.
- A melee hit applies damage at the visible strike frame.
- Repeated attack/shoot input reliably restarts or queues the next one-shot.
- Adding a new character model fails fast if required clips, sockets, or track
  targets are missing.
- Player and NPC equipment attachment behavior is implemented through one shared
  helper and tested against at least the player, keeper, and troll models.
