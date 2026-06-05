# Contracts And Gotchas

Use this before changing existing generated levels, portals, arrivals, or
levels with bundled scripts.

## Stable IDs Are Contracts

Treat these as save/travel/script contracts:

- Level IDs in `src/game/procedural-level-ids.ts`.
- Generated file names in `PROCEDURAL_LEVEL_DEFINITIONS`.
- Arrival zone IDs.
- Portal zone IDs.
- Script IDs and `sourcePath` values in `PROCEDURAL_LEVEL_SCRIPT_FILES`.
- Pickup IDs, NPC IDs, piston IDs, and zone IDs referenced from
  `examples/scripts/*.js`.

Changing one requires updating all dependent scripts, tests, and generated
`.vplevel` output in the same change.

## Portal Rules

Portal zones should be `kind: 'portal'`, usually with
`triggerSources: ['player']`, and a `portal` object:

```ts
{
    id: 'zone.teleport-garden.portal.demo',
    kind: 'portal',
    min: { x: 15, y: groundY + 1, z: 9 },
    max: { x: 17, y: groundY + 3, z: 11 },
    triggerSources: ['player'],
    portal: {
        targetLevelId: DEMO_LEVEL_ID,
        targetArrivalId: DEMO_FROM_GARDEN_ARRIVAL_ID,
    },
}
```

Arrival zones should be non-trigger `kind: 'arrival'` zones. Place them far
enough from outgoing portal volumes that the player does not immediately
teleport back after arriving.

## Scripted Level Rules

The demo scripts depend on hard-coded level details. Preserve these or
update the script in the same change:

- `zone.demo.*` IDs.
- `piston.elevator` and `piston.trap`.
- Keeper Arlen, sundial, shrine, and portal interaction zone IDs.
- The lantern coordinate `(9,5,9)`.
- Sun Shard, Hour Stone, shrine reward, and portal magic FX IDs.
- Pickup IDs used in `pickup-taken` filters.

Because event filters use strict equality, a typo in a zone or pickup ID
does not throw; the handler simply never fires. Add tests for any changed
contract.

## Generated Files

`public/levels/*.vplevel` are generated and tracked. Do not hand-edit them.
Run:

```bash
npm run levels:procedural
```

The exporter only writes when bytes change, so unchanged files should remain
clean.

## Performance

Procedural generators run at export/load time, not every frame. Runtime
performance is still affected by what they create:

- Avoid excessive active FX zones and lights in default demos.
- Prefer instanced props for repeated decoration.
- Keep portal/effect trigger volumes tight.
- Avoid spawning many physics objects at level start unless the level needs
  them immediately.

## Tests To Touch

- `tests/procedural-level-export.test.ts` for generated `.vplevel`, scripts,
  and travel metadata.
- `tests/travel-portal-meta.test.ts` for portal/arrival metadata round trips.
- `tests/level-builder.test.ts` for helper behavior.
- Script-specific tests when scripts depend on moved IDs or coordinates.
