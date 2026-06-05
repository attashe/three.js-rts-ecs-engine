# Character models

Drop conforming Blender-authored `.glb` character rigs here. Vite serves this
directory at `/models/`.

A model must follow the authoring contract in
[`docs/animation-blender-convention.md`](../../docs/animation-blender-convention.md)
(glTF 2.0 binary, +Y up, feet at origin, single `Armature` + skinned mesh,
`socket.*` bones, and clips named `idle/walk/run/jump/fall/land`). The runtime
validator rejects non-conforming files and falls back to the built-in code
reference rig.

To enable a model, register it in `src/game/anim/model-registry.ts`:

```ts
export const CHARACTER_MODEL_URLS = {
  'player.player': '/models/main-character.glb',
}
```
