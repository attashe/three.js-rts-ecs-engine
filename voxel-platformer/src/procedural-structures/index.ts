// Public surface of the procedural-structures package. Editor systems,
// level scripts, and the standalone demo should import from here.

export * from './generator'
export * from './asset'
export { STRUCTURE_PREFABS, DEFAULT_PREFAB_ID, getPrefab, prefabIds } from './prefabs'
export type { StructurePrefab } from './prefabs'
