# Slice 3 Step 7 — Pistons with script bindings: pre-implementation notes

Status: **investigation plan**. Captures the two risk areas that were
flagged at the end of Step 6's reflection so the Step 7 implementer
(future me, or anyone else) starts with the questions on the table
instead of finding them mid-edit.

Companion to `docs/script-engine-slice-3-plan.md` — the shape of the
four bindings (`pistons.setEnabled / flip / isEnabled / list`) is
specified there. This doc covers **how** to land them safely, given
two areas the original plan deferred.

---

## 1. Piston-system internals — what we need to confirm before editing

### 1.1 Files to read first (in this order)

1. **`src/engine/ecs/world.ts`** — search for `PistonMechanism`. This
   is the runtime struct the piston update loop iterates. Note every
   field; the four new fields (`id`, `enabled`, plus whatever's needed
   for flip-mid-move detection) have to live on this struct.
2. **`src/game/mechanisms.ts`** — `PistonMechanismConfig` and the
   `registerPistonMechanism()` factory. New optional `id?: string` flows
   from config → runtime here.
3. **`src/engine/ecs/systems/piston-system.ts`** (or wherever the
   piston update lives — confirm via `grep -rn "PistonMechanism" src`).
   This is where the disabled-skip and flip-now plumbing have to land.
4. **`src/engine/ecs/systems/dynamic-collision-system.ts`** (or
   equivalent) — check how pistons feed into the obstacle registry.
   Disabling a piston while the player stands on it must not strand
   the player on a "ghost" obstacle.
5. **`tests/piston*.test.ts`** (if any) — existing tests anchor the
   behaviours we're not allowed to regress.

### 1.2 Questions to answer (write the answers down before changing anything)

- **Motion state machine.** What states does a piston move through?
  Most likely `idle → preparing → moving → settled → idle`. Identify
  the field(s) that distinguish them. The plan calls out two motion
  flavours: `teleport` (instant) and `animated` (interpolated). The
  flip-mid-move rejection only applies to `animated`.
- **Where is the timer?** Pistons cycle on `delay` seconds. Is that
  tracked as `nextFlipAt: number` (sim-time absolute) or `elapsed:
  number` (relative)? `flip(id)` needs to short-circuit this to
  "fire on the next tick" — sketch the smallest mutation that does
  so without breaking the timer's normal pacing.
- **Is there an existing `isMoving` predicate?** If yes, use it for
  the flip rejection. If no, derive one from the motion state — but
  don't add a redundant flag.
- **Voxel writes during motion.** Pistons set/clear blocks via the
  chunk manager. Disabling a piston mid-motion must NOT leave the
  block half-set (a stuck `block` cell with no obstacle to match).
  Decide: does `setEnabled(false)` (a) freeze in place, (b) complete
  current motion then stop, or (c) snap back to start? The plan's
  test ("piston freezes; player's gravity resumes") suggests (a) —
  but the simplest *correct* answer might be (b) so the voxel state
  stays consistent.
- **Move-sound coordination.** `PistonMechanismConfig.moveSoundId` /
  `moveSoundVolume` are wired today. If a piston is disabled
  mid-travel under option (a), the move sound has to stop. Find
  where the sound handle lives and how to silence it.
- **Player carry behaviour.** When the player is on a moving piston
  block, the player's position is updated by the piston each tick.
  Disabling-mid-motion freezes the piston — the player should fall
  off naturally on the next physics tick. Verify the
  dynamic-collision path picks up `enabled: false` blocks as static
  (same as a placed voxel) rather than tracking the now-frozen
  piston's velocity.

### 1.3 Refactoring plan (informed by the answers above)

These are deliberately small edits — each one should land green:

1. **Schema additions** (no behaviour change):
   - `PistonMechanism`: `id?: string`, `enabled: boolean` (default
     `true`).
   - `PistonMechanismConfig`: `id?: string`. No `enabled` here —
     enabled is session state, not authored state.
   - `world.pistonsById: Map<string, PistonMechanism>`.
   - `registerPistonMechanism` writes into `pistons[]` always, and
     into `pistonsById` when `config.id` is present.
2. **`enabled` honoured by the update loop**:
   - Skip the per-piston update when `enabled === false`. Choose one
     of (a)/(b)/(c) above and document it inline.
   - If the chosen behaviour requires audio to silence, do it here.
3. **`flip` short-circuit**:
   - Add the minimal "fire on next tick" plumbing. If the piston is
     `animated` and currently `moving`, return false from the
     controller. Otherwise mutate the timer/state so the next update
     starts a new motion.
4. **`pistonsById` cleanup**:
   - If pistons can be despawned at runtime (do they?), the map
     needs to be cleaned. Verify by grepping for any "remove piston"
     path. Likely none — pistons live for the lifetime of the
     level — but check before assuming.

### 1.4 Edge cases — explicit answers, not "we'll figure it out"

| Case | Expected behaviour |
| ---- | ------------------ |
| `setEnabled(unknownId, ...)` | Controller returns `false`; no state change |
| `setEnabled(id, false)` on a `teleport` piston | Skip future flips; current cell stays where the last flip put it |
| `setEnabled(id, false)` on an `animated` piston mid-motion | Either freeze (option a) or complete (option b) — **decide before implementing** |
| `setEnabled(id, true)` on an already-enabled piston | Noop, return `true` |
| `flip(unknownId)` | Return `false` |
| `flip(id)` on an idle `animated` piston | Trigger a fresh motion on next tick, return `true` |
| `flip(id)` on a moving `animated` piston | Return `false`, no state change |
| `flip(id)` on a `teleport` piston | Trigger an instant flip on next tick, return `true` |
| `flip(id)` while `enabled === false` | Open question — return `false` (consistent "ignore disabled") feels right |
| `isEnabled(unknownId)` | Return `false` |
| `list()` enumerates **only** pistons with stable ids | Pistons without `id` are invisible to scripts |

---

## 2. Editor playtest path — what we need to verify before round-tripping `id`

### 2.1 Files to read first

1. **`src/editor/editor-state.ts`** — locate `EditorPiston` and the
   `toLevelMeta()` mapping.
2. **`src/game/level-from-meta.ts`** — the inverse mapping for
   playtest.
3. **`src/editor/save-load.ts`** — `loadLevelFromBuffer` (or
   equivalent). Verify how unknown fields on serialised pistons are
   tolerated (deserialiser likely accepts them as `unknown` and we
   pick what we need).
4. **`src/editor/playtest.ts`** — the sessionStorage round-trip
   used by the "Playtest" button. Pistons travel through this path
   when launched from the editor.
5. **`src/editor/ui/edit-tab.ts`** and any piston-tab UI — where the
   user would author a piston id.

### 2.2 Questions

- **Does `EditorPiston` carry an `id` today?** If the editor places
  pistons by clicking, a stable id is currently absent — they're
  identified by their `from` cell. We need a way to assign one
  (either UI input or auto-generated like `piston-1`, `piston-2`).
- **What does the level binary serialiser do with unknown fields?**
  `deserializeLevel<EditorLevelMeta>(buffer)` returns a typed shape
  but JSON deserialisation is forgiving — any new optional field is
  preserved on round-trip. Verify by reading the serializer.
- **Does the playtest buffer reliably carry every editor field, or
  only the ones in the type definition?** The TypeScript types
  declare what's there; the JSON.stringify call in the serialiser
  writes everything reachable. New optional fields should travel
  automatically as long as the editor populates them.
- **Are saved levels in the wild?** Probably no users yet, but if
  any saved level binary exists pre-Slice-3, it has no `id` field.
  Loading must work; pistons without ids just aren't
  script-targetable.

### 2.3 Round-trip plan

1. Add `id?: string` to `EditorPiston` in `editor-state.ts`.
2. Mirror it through `toLevelMeta` (one-to-one mapping — just add
   the field to the spread/projection).
3. Mirror it through `levelMetaFromEditor` so the playtest
   `LevelMeta` carries it into `PistonMechanismConfig`.
4. **Decide on the editor UX for assigning ids.** Two options:
   - **Auto-generate** on placement (`piston-1`, `piston-2`, …).
     Pros: every piston is script-targetable by default. Cons: the
     ids are non-mnemonic; authors targeting `piston-3` from a
     script have to look it up.
   - **Optional manual field** in the piston-tab UI. Pros: authors
     pick meaningful names (`piston.elevator`). Cons: a piston with
     no id is invisible to scripts, which is the default for now.
   - **Recommended:** auto-generate, and add an optional rename
     field on the piston-tab later. That mirrors how NPCs were
     handled (`npc-1`, `npc-2`, with the NPC tab letting the author
     edit the id).
5. **Test:** round-trip a piston with `id: 'piston.test'` through
   `toLevelMeta` → `serializeLevel` → `deserializeLevel` →
   `loadLevelFromBuffer`. Assert the id survives. Mirror the
   existing `prop-save-load.test.ts` style.

### 2.4 Backward compatibility

- Saved levels without `id` on their pistons: must load cleanly.
  `id?: string` makes the field optional at the type level; at
  runtime an undefined `id` just means the piston isn't added to
  `pistonsById`.
- The demo level (`generatePlatformerLevel`) currently has two
  pistons with no ids. Step 7 will assign `piston.elevator` and
  `piston.trap` to them. Existing playtests that don't depend on
  pistons stay unchanged.
- `EditorLevelMeta.pistons` in the binary format gains an optional
  field. New format files don't open in old code — but old format
  files open cleanly in new code, which is the direction that
  matters.

---

## 3. Validation gate

Step 7 is done when:

- [ ] Every question in §1.2 and §2.2 has a written answer (either
  in this doc, in inline comments, or in commit messages).
- [ ] `npm test` + `npm run typecheck` green.
- [ ] **Browser pass** of the demo level (per the README's manual
  verification list):
   - Demo elevator + trap pistons still cycle as before.
   - A throwaway script calling `pistons.setEnabled('piston.elevator',
     false)` freezes the elevator and lets the player fall through
     normal gravity.
   - The same script's `pistons.flip('piston.trap')` while the trap
     is idle triggers a new motion.
   - Calling `flip` mid-motion returns `false` (verify via the Logic
     tab's log surface or `console`).
- [ ] A round-trip test for `id`-bearing pistons through editor save/load.
- [ ] No regression in any existing piston test.

---

## 4. Risk register

| Risk | Likelihood | Mitigation |
| ---- | ---------- | ---------- |
| Piston motion is tangled with collision in a way that doesn't expose `isMoving` cleanly | Medium | Read piston-system.ts before sketching the flip plumbing; if needed, lift `isMoving` to an explicit field |
| Disabling mid-motion strands the block in an inconsistent voxel state | Medium | Pick option (b) "complete current motion then stop" as the safer default; test with `setEnabled(false)` during travel |
| Player carry behaviour fights with the new `enabled` flag | Low | Dynamic-collision treats blocks the same way regardless of which mechanism placed them; just need the piston to stop writing voxels |
| Adding `id` to `EditorPiston` breaks the binary serialiser | Very low | JSON-based serialiser is forgiving; add a save-load test as belt-and-suspenders |
| Auto-generated ids collide on copy/paste in the editor | Low | Use a `nextPistonId` counter or hash the `from` cell; verify uniqueness in `registerPistonMechanism` |

---

## 5. After Step 7

Closeout notes go back into `script-engine-slice-3-plan.md` §5
(currently empty by design). This doc stays here as a historical
artefact of the investigation pass.
