---
name: voxel-npc-animator
description: >-
  Create, edit, or review procedural character animations for the
  voxel-platformer engine, including player and NPC locomotion, melee attacks,
  shield poses, weapon anticipation/impact/recovery, held item sockets, and
  animation timing tests. Use when working with src/game/anim/*,
  src/game/assets/main-character.ts, humanoid clip timings, combat readability,
  spear/sword/hammer/staff attack poses, NPC shield-up behavior, or requests
  such as "make the attack animation clearer", "move the hand farther back",
  "edit the NPC animation", "add a new combat animation", or "align the weapon
  with the hand".
---

# Voxel NPC animator

Author character animation as readable gameplay: anticipation first, precise
impact pose second, recovery last. Keep animation edits local to the procedural
part-rig and socket systems unless the request is also changing combat rules.

## Workflow

1. Identify the actor, weapon, and gameplay moment: idle, movement, startup,
   active hit, block, recoil, stun, or recovery.
2. Inspect the current rig and clip code before editing:
   `src/game/assets/main-character.ts`, `src/game/anim/part-clips.ts`,
   `src/game/anim/clip-timings.ts`, `src/game/anim/character-profiles.ts`,
   `src/game/anim/graph-defaults.ts`, `src/game/anim/equipment.ts`, and
   `src/game/npcs/npc-critter-animator.ts` for non-humanoid NPC motion.
3. Preserve combat timings unless the user explicitly asks to tune mechanics.
   Damage windows should remain aligned with `HUMANOID_ANIM_TIMINGS` and the
   melee attack definition that owns the hit moment.
4. Make weapon attacks readable with three poses: visible pull-back or wind-up,
   fast active extension at the damage moment, then a compact return.
5. For held items, prefer socket-frame adjustments in `equipment.ts` when the
   grip is wrong. Change the model only when the mesh itself is authored around
   the wrong origin or axis.
6. Add or adjust focused tests for any clip, socket, or timing contract that can
   regress invisibly.

## Animation Rules

- The player/NPC humanoid rig is part-based. Use named body parts and sockets
  instead of adding hidden visual-only transforms.
- Keep pose changes exaggerated enough to read from the normal camera distance,
  especially for narrow weapons like spears.
- Do not move the active hit later or earlier through animation alone. If the
  gameplay impact timing must change, update the combat definition and tests in
  the same change.
- Keep shield-up poses distinct from attack poses. Spear-and-shield enemies
  should visually expose their side/back weakness and drop the shield during the
  attack clip.
- Avoid frame-by-frame micro poses. A few meaningful keys are easier to test,
  cheaper to run, and more robust.

## References

- Read `docs/model-authoring-guide.md` before changing equipment sockets,
  wearable placement, or model frames.
- Read `docs/animation-blender-convention.md` before touching imported rig
  contracts, socket names, clip names, or model registry behavior.
- Read `docs/animation-system-review.md` before refactoring shared animation
  architecture rather than editing a specific clip.

## Test Strategy

- Use numeric pose tests when a visual relationship matters: hand travel,
  weapon axis, socket offset, impact reach, or shield facing.
- For equipment orientation, compute the held axis through the equipment frame
  and animated socket quaternion rather than relying on a screenshot.
- Focused checks usually live in `tests/anim-part-rig.test.ts`,
  `tests/anim-graph-defaults.test.ts`, or
  `tests/player-settings-runtime.test.ts`.

## Validation

Run focused validation from the repo root:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .tmp/test-build/tests/anim-part-rig.test.js
node --test .tmp/test-build/tests/anim-graph-defaults.test.js
node --test .tmp/test-build/tests/player-settings-runtime.test.js
```

Run `npm test` when animation changes touch shared combat clips, equipment
runtime, or NPC behavior.
