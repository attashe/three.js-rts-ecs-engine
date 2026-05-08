// Runnable shader examples. Wire any of these into a Mesh in client.ts; see
// /docs/shaders/README.md for the recipe and /docs/shaders/examples.md for the
// per-material walkthrough.

export { createVoxelVertexColor } from './voxel-vertex-color'
export type { VoxelVertexColorOpts } from './voxel-vertex-color'

export { createPulsingEmissive } from './pulsing-emissive'
export type { PulsingEmissiveOpts } from './pulsing-emissive'

export { createFresnelRim } from './fresnel-rim'
export type { FresnelRimOpts } from './fresnel-rim'

export { createDissolve } from './dissolve'
export type { DissolveOpts, DissolveMaterial } from './dissolve'

export { createWindFoliage } from './wind-foliage'
export type { WindFoliageOpts } from './wind-foliage'
