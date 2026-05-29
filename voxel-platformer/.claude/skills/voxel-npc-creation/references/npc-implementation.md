# NPC implementation reference

## File Map

| File | Purpose |
| ---- | ------- |
| `src/game/npcs/npc-types.ts` | `NpcConfig`, model ids/labels, interaction zone, collision AABB, script wrapping |
| `src/game/npcs/npc-models.ts` | Three.js model builders for static NPCs |
| `src/game/npcs/npc-runtime.ts` | Registers interaction zones, collision obstacles, and NPC scripts at runtime |
| `src/game/npcs/npc-render-system.ts` | Renders and updates NPC instances from level metadata |
| `src/editor/ui/npc-tab.ts` | Editor NPC list, model selector, settings, script templates, parse check |
| `src/game/level.ts` / `src/game/procedural-levels.ts` | Procedural/demo NPC placement |
| `tests/npc-system.test.ts` | Model registration, runtime interaction/collision, script wrapping |

## Adding A Model Kind

1. Add the id to `NPC_MODEL_KINDS`.
2. Add a human label to `NPC_MODEL_LABELS`.
3. Add a `case` in `createNpcModel`.
4. Implement a local `createXModel()` with shared geometry/material helpers.
5. Add/update tests that enumerate all model kinds.

Use lowercase hyphen ids (`large-troll`, `market-keeper`). Keep model builders
pure: create a `Group`, name the root `NpcModel:<kind>`, add named child meshes,
return the group.

## Model Guidelines

- Reuse `createMainCharacter` when making humanoids.
- Use `sharedBoxGeometry`, `sharedCylinderGeometry`, `sharedSphereGeometry`,
  and `sharedMaterial` from `src/game/assets`.
- Mark meshes with `castShadow` and `receiveShadow`; existing models use a
  small `shadowed(mesh)` helper.
- Prefer strong silhouette: staff, book, hat, robe hem, glasses, shoulder
  width, height, posture.
- Avoid expensive transparent stacks, many lights, animated particle systems,
  or one-off geometries unless the user specifically asks.
- Keep parts named (`KeeperStaff`, `LargeTrollBook`) so debugging scene output
  is readable.

## Config And Placement

`NpcConfig` fields that usually matter:

```ts
{
  id,
  name,
  model,
  position: { x, y, z },
  yaw,
  scale,
  collisionEnabled,
  colliderRadius,
  colliderHeight,
  interactionEnabled,
  interactionRadius,
  interactionPrompt,
  scriptEnabled,
  scriptSource,
}
```

Interaction zones are generated as `npc.<id>.interact`. NPC scripts are wrapped
with:

```js
const NPC_ID = "..."
const NPC_NAME = "..."
const NPC_INTERACTION = "npc.<id>.interact"
const NPC_ZONE = NPC_INTERACTION
```

Write NPC scripts using those constants; do not hard-code the generated
interaction id inside the script body.

## Collision Defaults

Use collision when the NPC is a real physical presence or quest blocker. Scale
collider height/radius with visual scale:

- Human: radius `0.3-0.45`, height `1.5-1.8`.
- Large troll: radius `0.7-0.95`, height `2.8-3.3`.

Collidable NPCs also affect arrows and stones through the obstacle registry.
