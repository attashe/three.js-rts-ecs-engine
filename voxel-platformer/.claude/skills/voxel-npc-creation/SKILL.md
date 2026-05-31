---
name: voxel-npc-creation
description: >-
  Create, edit, or review NPCs for the voxel-platformer engine, including
  NPC naming, character description, visual design, Three.js voxel-style 3D
  models, collision/interaction settings, dialogue snippets, generated
  dialogue voices, simple combat/patrol behavior, and NPC placement in demo or
  procedural levels. Use when working with src/game/npcs/*, LevelMeta.npcs,
  editor NPC tab scripts, NPC dialogue, character voice, avatars, or requests
  such as "add an NPC", "improve this character", "make a model for a
  merchant/troll/keeper", "write NPC dialogue", "make an NPC hostile", or
  "place an NPC in a level".
---

# Voxel NPC creation

Build NPCs as a complete game object: purpose, name, readable silhouette,
interaction zone, optional collision, and scriptable dialogue. Prefer a small
but distinctive character over ornamental geometry.

## Workflow

1. Define the NPC's job in the level: guide, merchant, quest giver, blocker,
   ambient character, or lore object.
2. Choose an existing model first (`keeper`, `player`, `large-troll`). Add a
   new model only when silhouette/scale/materials need to differ materially.
3. Write a short identity block before coding: display name, one-line
   description, generated voice preset/seed, gameplay role, interaction
   prompt, model scale, collision requirement, and combat stance if any.
4. Implement the NPC model/config using the existing `src/game/npcs/*`
   patterns. Keep geometry cheap, named, shadow-capable, and voxel-readable
   from isometric distance.
5. Add dialogue through the NPC script surface. Use silent `ui.say` for
   one-line feedback and voiced `ui.dialogue` for choices or multi-line
   conversations.
6. Place the NPC in `LevelMeta.npcs` or the editor metadata and add tests for
   model registration, script wrapping, runtime zones/collision, and generated
   levels when applicable.

## Design Rules

- Use stable ids in lowercase kebab/colon style, e.g.
  `large-town:bridge-merchant`.
- Make names fit the role and place. Avoid placeholder names like "Bob" or
  generic labels unless the user explicitly wants them.
- Fit the model to current scale conventions: `scale: 1` for human-sized,
  about `1.8-2.1` for large characters, with matching collider height/radius.
- Let collidable NPCs block players, arrows, and stones; keep collision off
  for decorative or crowd NPCs unless gameplay requires it.
- Keep dialogue state in script `flags`, not in model/config fields.
- Give important NPCs a stable `voice` (`preset`, `seed`, optional `volume`).
  Modal dialogue inherits this voice through `NPC_VOICE`; floating messages do
  not speak.
- For guard/enemy NPCs, use `equipment`, `collisionEnabled`, and script calls
  like `npc.setHostile`, `npc.setPerceptionRadius`, and `npc.setWaypoints`.
  Current combat is simple: grounded player melee alternates thrust/wide swing;
  hostile NPCs path into range and their hits are blocked by the player's
  raised frontal shield.
- Do not add pathfinding, schedules, or patrol behavior unless requested;
  current NPCs are static until scripts assign waypoints or hostility.

## References

- Read `references/npc-implementation.md` before changing NPC code or level
  metadata.
- Read `references/character-writing.md` when the task is mostly naming,
  description, voice, or dialogue quality.

## Validation

Run focused tests first:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .tmp/test-build/tests/npc-system.test.js
```

Run `npm run typecheck` after model or runtime changes. Run the relevant
procedural/export tests when placing NPCs in generated levels.
