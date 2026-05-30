# Blender → Engine Character Convention

This is the **strict** authoring contract for animated character models. It is
not a general importer — a model only loads if it follows these rules. The
runtime validator (`src/engine/anim/runtime/blender-validator.ts`) rejects
non-conforming files with specific errors and falls back to the built-in code
reference rig, so the game never breaks on a bad export.

The code **reference rig** (`src/engine/anim/runtime/reference-rig.ts`) is the
canonical implementation of this contract — when in doubt, match what it does. A
conforming `.glb` is a drop-in replacement for it.

A worked **Blender example** lives in `tools/build-reference-character.py`. It
runs `bpy` as a plain Python module (`python tools/build-reference-character.py`,
no `blender` binary) and emits `public/models/reference-character.glb` — a
conforming rig you can study, copy, or load directly. That file is registered for
`player.player` in `src/game/anim/model-registry.ts`, so the game already runs on
an imported Blender model.

## File & format

- **Format:** glTF 2.0 **binary** (`.glb`), one file per character.
- **Location:** `public/models/`. Vite serves it at `/models/<name>.glb`.
- **Register it:** add `'<characterId>': '/models/<name>.glb'` to
  `CHARACTER_MODEL_URLS` in `src/game/anim/model-registry.ts`. It loads at
  startup. Player ids are `player.player` and `player.keeper`.

## Transform & units

- **Unit scale:** 1 Blender unit = 1 world meter = 1 voxel. Apply scale before
  export (Object → Apply → All Transforms).
- **Up axis:** export **+Y up** (glTF default; in Blender's exporter keep
  "+Y Up" checked).
- **Forward:** the model must face **+Z** in its rest pose. The engine yaws the
  character with `Rotation.y = atan2(dx, dz)`, where `y = 0` faces +Z.
- **Origin at the feet:** the armature/mesh origin sits on the ground plane, so
  the model's bounding box `min.y ≈ 0`. The entity `Position` is foot-space.
- **Height:** roughly **1.6 units** tall (matches the player collider). The
  validator warns outside ~0.5–4.

## Rig

- A **single armature**, named exactly `Armature`.
- A **single skinned mesh** bound to it. (Multiple materials are fine; multiple
  separate skinned meshes are discouraged — merge them.)
- Standard humanoid bones. The reference rig uses `hips, spine, head,
  upperArm.R/.L, thigh.R/.L`; match the spirit, not the exact names — only the
  **socket** and **clip** names below are load-bearing.

## Sockets (equipment attachment)

Add **empty leaf bones** to the armature, named **exactly** as below, parented to
the joint the gear should follow. Equipment is parented to these at runtime so it
inherits the animation. All sockets are **optional** — a missing one just
disables that slot.

| Slot     | Socket bone name  | Parent bone   | Purpose                    |
|----------|-------------------|---------------|----------------------------|
| `head`   | `socket_head`     | head          | hats / helmets (key in iso)|
| `handR`  | `socket_hand_R`   | right forearm | main-hand weapon           |
| `handL`  | `socket_hand_L`   | left forearm  | off-hand weapon / shield   |
| `back`   | `socket_back`     | spine/chest   | bow, quiver, cloak pin     |

**Use underscores, not dots**, in socket names. three's glTF loader strips
reserved characters (`.`, `:`, `/`, `[]`) from node names while binding
animations, so a bone named `socket.hand.R` would arrive as `sockethandR` and the
engine wouldn't find it. Underscores survive unchanged. (Deform bones may keep
Blender's `.R`/`.L` — they're driven by the auto-sanitised animation tracks, not
looked up by name.)

A socket's local axes are the attachment frame: place the bone where the grip /
hat brim should sit, oriented so a +Y-up item reads correctly. To add new slots,
extend `SOCKET_ID` / `EQUIP_SLOT` in `src/engine/anim/core/convention.ts`.

## Animations (clips)

- One **Action per state**. In the glTF exporter, enable "Export Animations" and
  push each Action to an NLA strip (or use the "Group by NLA" workflow) so every
  Action becomes a named clip.
- **Clip/action names must equal the state ids**, which are also the required set
  below. The state machine looks clips up by these exact names.

Required clips (all must be present):

| Clip   | When it plays                          | Loop   |
|--------|----------------------------------------|--------|
| `idle` | grounded, ~stationary                  | loop   |
| `walk` | grounded, moving (≲ run speed)         | loop   |
| `run`  | grounded, fast                         | loop   |
| `jump` | airborne, rising                       | clamp  |
| `fall` | airborne, descending                   | loop   |
| `land` | moment of touchdown                    | once   |

Extra clips are allowed (the validator only warns). The default
state graph + thresholds live in `src/game/anim/graph-defaults.ts`; a custom
graph can reference any clip names your model provides.

## Previewing

A standalone **Animation** page (`animation.html`, `npm run dev` → `/animation.html`)
loads any rig and lets you drive its state machine live (speed / vy / grounded
sliders), scrub individual clips, and try equipment on the sockets — handy for
checking a freshly exported `.glb` without launching the game. (It's a separate
page on purpose; the editor is already dense.)

Two runtime behaviours worth knowing when authoring locomotion clips:
- **Speed-synced playback** — clips flagged `syncToSpeed` (walk, run) are
  time-scaled by the character's actual speed (`syncRefSpeed` is the speed at
  which they play at 1×), so author them at a natural cadence and the engine
  matches the feet to the ground.
- **Face-travel** — the visual model turns to face its movement direction while
  moving (the entity's look/aim direction is separate), so author locomotion as
  straight-ahead motion; strafing/backpedalling is handled by the turn, not by
  separate directional clips.

## Validation summary

Hard **errors** (asset rejected): no skinned mesh; no bones; a missing required
clip. **Warnings** (asset still loads): armature not named `Armature`; missing
optional sockets; origin not at the feet; off-scale height. Warnings print to the
console at load.
