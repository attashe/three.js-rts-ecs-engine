# Procedural Tower

The `tower` structure (`src/procedural-structures/tower.ts`) generates a
masonry tower in four styles — `round`, `square`, `lighthouse`, `ruined` —
with a tapered shell, carved windows, a crenellated crown, a style-specific
roof, and a genuinely **climbable** interior.

## Climbable interior

The earlier interior placed a spiral but the player couldn't actually climb it:
storey decks capped the body-space above the treads and the climb stalled at the
first floor. The interior is now built to a single invariant that the engine's
movement can satisfy.

The player has a **free 1-voxel step-up** (physics sweeps horizontal before the
ground sweep — see `physics-system.ts`). So the spiral is laid out so that
between every consecutive pair of treads the **rise is exactly 1 and the run is
one cell horizontally** — the steepest pitch a 1-voxel step-up can clear.

Construction order (in `towerInterior`), which matters:

1. **Ground floor** — a stone slab across the interior at the base, so the
   player can walk from the entry to the foot of the stair.
2. **Storey decks** — one timber deck per `TOWER_FLOOR_INTERVAL` (6) levels,
   with a `woodDark` rim.
3. **Spiral stair** — treads on a fixed radius-3 ring just inside the wall
   (`TOWER_STAIR_RADIUS`), ~24 cells per revolution. Each tread is **2 cells
   wide** (the ring cell plus its inward neighbour) so there's always full
   footing, wrapping a central `darkStone` newel. Where the spiral meets a
   storey it widens into a landing; the top is a `tower-top-landing`.
4. **Stairwell carve** — *last*, so it wins every cell: delete the two cells
   directly above each ring tread. This clears the climber's body-space and, where
   the spiral runs under a deck, punches the stairwell opening through it.
   Because it only ever deletes cells *above* a tread (and consecutive treads
   are always offset), it can never erase a step.

Carving is restricted to the ring cells, not the inward treads: at the ring's
corners an inward neighbour lands on the *next* ring cell, so carving above it
would delete the following step (this was the subtle bug behind the original
unclimbable spiral).

## Lighthouse beacon

The `lighthouse` crown carries a **working light**: a glass gallery (with a metal
sill and top ring) around a short `glow` lamp column — the brightest emissive
point-light block in the palette (intensity 6, range 10) — crowned by a `fire`
flame. So the lantern actually casts light into the level, not just a glowing
texture. It's deliberately kept to three light-emitting voxels: the block-light
pool only lights the ~12 nearest sources (`block-light-system.ts`), so a denser
lamp would monopolise the pool and drown the tower's other lights up close. The
beacon survives `structuralOnly` stamping, so lighthouses placed in levels (e.g.
the Large Town) light up.

## Visual upgrade

The shell is shaded **per voxel** instead of in flat 6-row bands: a hash over
`(x, y, z)` sprinkles `stone2` and the occasional `darkStone` through a `stone`
field so the wall reads as fitted blocks, and the bottom two courses go
`darkStone` for a weathered plinth. The crenellated crown, corbel ring, and the
conic / pyramid / lighthouse roofs are unchanged.

## Tests

`tests/procedural-structures.test.ts` covers the geometry and, critically, a
**climbability proof**: a BFS models the player as feet-on-solid with two clear
body cells, walking the 4-neighbourhood with the 1-voxel step-up (and any drop),
and asserts the crown is reachable from the ground floor for round / square /
lighthouse towers. This is the regression guard against the old, unclimbable
spiral. (`ruined` towers intentionally collapse their top, so they're excluded.)
