---
name: voxel-procedural-3d-artist
description: >-
  Create, edit, or review procedural Three.js voxel-style assets for the
  voxel-platformer engine, including props, weapons, wearable equipment,
  character models, NPC variants, market/shop structures, and generated model
  tests. Use when working with src/game/props/*, src/game/assets/*,
  src/game/anim/equipment*, src/game/npcs/npc-models.ts,
  src/procedural-structures/*, procedural shop assets, weapon models, hats,
  boots, helmets, troll/dwarf character variants, or requests such as "create a
  prop", "make a weapon model", "add a character model", "improve the shop
  structure", or "build a procedural asset".
---

# Voxel procedural 3D artist

Build assets as cheap, legible, code-native Three.js models that fit the
voxel-platformer scale. Prefer strong silhouette and useful named parts over
ornamental mesh count.

## Workflow

1. Classify the asset: handheld equipment, wearable, prop, NPC/character model,
   or fixed structure.
2. Start from the nearest existing implementation before adding a new pattern:
   `src/game/props/prop-models.ts`, `src/game/anim/equipment.ts`,
   `src/game/assets/main-character.ts`, `src/game/npcs/npc-models.ts`, or
   `src/procedural-structures/`.
3. Define the gameplay constraints first: collision footprint, pickup/shop
   identity, socket slot, interaction prompt, scale, and whether the asset must
   animate.
4. Author with shared geometry/material helpers and named `Object3D` parts.
   Keep the asset readable from the normal gameplay camera.
5. Register new asset ids in the matching type unions, labels, builders, shop
   item data, level metadata, and tests. Do not leave a visual-only asset
   unreachable from gameplay when the user requested a usable item.
6. Validate with focused tests, then export generated levels when a procedural
   level or prefab changed.

## References

- Read `docs/model-authoring-guide.md` before creating a new model family,
  socketed item, wearable, or important NPC variant.
- Read `.claude/skills/voxel-npc-creation/references/npc-implementation.md`
  before changing NPC registration, level metadata, collision, dialogue, or
  combat placement around a new character model.
- Read `docs/procedural-levels.md` when a structure asset also changes a
  generated location or `.vplevel` export.

## Modeling Rules

- Use code-native geometry; do not introduce external image/model assets unless
  the user specifically asks for them.
- Keep handheld equipment authored around its grip frame. Use the existing
  equipment frame conventions before changing sockets or animation clips.
- Use a small material palette with clear contrast. Reuse existing shared
  materials where possible so similar assets look intentional.
- Avoid unnecessary real-time lights, transparent nested surfaces, and hidden
  duplicate geometry; these cost performance without improving readability.
- For props and shops, expose the important goods from the player's view.
  Avoid blocking key visual details behind unnecessary structural blocks.
- For NPC and character variants, make scale, headgear, carried item, and color
  do the work before adding many tiny meshes.
- Name important meshes or groups so tests and animation code can find them
  without brittle child indexes.

## Common File Map

| Area | Files |
| ---- | ----- |
| Props | `src/game/props/prop-types.ts`, `src/game/props/prop-models.ts`, `src/game/assets/props.ts` |
| Equipment | `src/game/anim/equipment-types.ts`, `src/game/anim/equipment.ts`, `src/game/equipment-items.ts` |
| Characters | `src/game/assets/main-character.ts`, `src/game/npcs/npc-models.ts`, `src/game/npcs/npc-types.ts` |
| Structures | `src/procedural-structures/*`, `src/procedural-structures/prefabs/*`, `src/game/procedural-levels.ts`, `public/levels/*.vplevel` |
| Shops/items | `src/game/shop-items.ts`, scripted shop data, generated level metadata |

## Test Strategy

- Add model-construction tests for every new prop, NPC model kind, equipment
  model, or generated structure id.
- Test named parts, approximate scale, socket orientation, item registration,
  and generated level placement when those contracts matter.
- If a new model is used by animation, add a pose or equipment-frame test rather
  than relying only on construction success.

## Validation

Run focused validation from the repo root:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .tmp/test-build/tests/prop-models.test.js
node --test .tmp/test-build/tests/npc-system.test.js
node --test .tmp/test-build/tests/player-settings-runtime.test.js
node --test .tmp/test-build/tests/procedural-structure-asset.test.js
node --test .tmp/test-build/tests/procedural-structures.test.js
```

Run `npm run levels:procedural` when generated levels or structure exports
changed, and `npm test` before finishing shared asset registration changes.
