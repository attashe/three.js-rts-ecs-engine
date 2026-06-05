# Model Authoring Guide

This guide describes how to create quality, readable, and performant 3D models
for the voxel-platformer engine. It applies to procedural Three.js models for
props, weapons, hand equipment, hats, NPCs, and player-compatible characters.

## Goals

- Read clearly from the isometric camera at gameplay zoom.
- Use a strong silhouette before adding small details.
- Keep geometry cheap enough for repeated props and equipped items.
- Use stable part names so tests, sockets, and debug tooling can inspect models.
- Author around the engine scale: the ordinary player is roughly one meter per
  voxel, while troll-scale structures and characters are intentionally larger.

## Scale And Frame

- Use world units consistently. A human-sized character at `scale: 1` should
  fit the existing player and dwarf rigs.
- Author held items with the grip near the local origin.
- For weapons and staffs, point the active end along local `+Y` unless a local
  convention already exists for that item family.
- For shields, author the visible face normal toward local `+Z`.
- For bows, keep height on `+Y`; the socket frame handles hand orientation.
- Keep character feet at or near local `y = 0`, so placement, collider height,
  and shadows stay predictable.

## Geometry Budget

Use simple primitives first: `BoxGeometry`, `CylinderGeometry`, `ConeGeometry`,
and low-segment `SphereGeometry`. Prefer a few well-placed shapes over dense
ornament.

Suggested budgets:

- Small equipment: 3-12 meshes, cylinders at 6-10 segments.
- Hand weapons: 4-14 meshes, one named grip and one named active end.
- Small props: 3-20 meshes. Repeated props should be instanced by the renderer
  when placed many times.
- Important NPCs: enough parts for silhouette and identity, but avoid hidden
  internal meshes and overlapping duplicates.
- Decorative crowds or scatter props: minimal meshes and no dynamic lights.

Avoid high-resolution spheres, high-segment cylinders, transparent nested
surfaces, and many tiny meshes that do not change the silhouette from game
camera distance.

## Materials

- Reuse material helpers and shared materials where the local system provides
  them.
- Use rough, mostly non-metal materials for readable voxel-fantasy surfaces.
- Use emissive materials sparingly. Emissive geometry is cheaper than real
  lights and should usually be the first choice for magical details.
- Avoid layered transparent surfaces inside each other. They can flicker,
  sort incorrectly, and cost extra fill rate.
- If a model needs light, budget it explicitly. Many individual point lights on
  props or equipment will hurt performance quickly.

## Silhouette And Readability

- Make the object recognizable in one second from the default camera.
- Use asymmetry, color blocks, and large shapes to distinguish variants.
- Put important details on the top/front side visible from isometric view.
- Do not rely on tiny color-only details for gameplay identity.
- For variants, change shape as well as color. A new staff, hat, or prop should
  have a different outline, not only a different tint.

## Sockets And Equipment

- Add every selectable item to the central equipment kind list and label map.
- Add a socket frame for every hand/head slot the item supports.
- Keep socket frames small and art-directed; do not bake awkward hand offsets
  into the mesh if the item can be shared across characters.
- Test both hands when an item can be held left or right.
- If an item family shares gameplay behavior, add a type guard or grouped list
  such as `STAFF_EQUIPMENT_KINDS`; do not scatter exact string comparisons.
- Name key meshes, for example `StaffGrip`, `StaffHeavyHead`, or
  `CrystalStaffCrystal`, so tests can verify the intended model is built.

## Characters And NPCs

- Start with role, scale, collider, and interaction needs before modeling.
- Keep colliders simple. Visual overhangs can exist, but gameplay collision
  should remain predictable.
- Rig-compatible characters should preserve expected body-part names and socket
  positions.
- Important NPCs should have a recognizable silhouette, model id, display name,
  voice preset, and optional equipment.
- Collidable NPCs must work with player movement, arrows, stones, and debug
  collider rendering.

## Props

- Static props should be cheap and batchable.
- Repeated prop families should use variation through scale, yaw, and a few
  model variants rather than unique heavy geometry for every placement.
- Scatter-friendly props should not contain real-time lights or expensive
  transparency.
- Keep origin and base placement consistent, usually centered on the footprint
  with the bottom at `y = 0`.

## Validation Checklist

Before finishing a new model:

- It has stable ids and labels in the editor selector.
- It uses the correct local frame and socket frames.
- Key pieces are named for tests and debugging.
- It casts shadows only where useful.
- It has no hidden duplicate geometry or overlapping transparent shells.
- It reads clearly from the default isometric camera.
- It does not add unnecessary lights.
- Focused tests cover registration, normalization, save/load if relevant, and
  socket attachment for equipment.

## Testing

Run the smallest useful tests first, then typecheck:

```bash
npm run typecheck
npx tsc -p tsconfig.test.json
node --test .tmp/test-build/tests/player-settings-runtime.test.js
node --test .tmp/test-build/tests/npc-system.test.js
```

Run `npm test` before committing changes that touch shared equipment,
character, NPC, save/load, or editor selection paths.
