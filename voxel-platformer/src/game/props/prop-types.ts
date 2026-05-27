/**
 * Shared types for the prop system (decorative misc objects placed on
 * the level — flowers, bushes, tables, chairs, books, mushrooms).
 *
 * The data is intentionally minimal: position, yaw, scale. No per-prop
 * tint, no per-prop materials. Visual variation comes from the kind
 * itself (different merged geometry per kind). One InstancedMesh per
 * kind keeps the draw call count fixed at `kind-count` regardless of
 * how many instances the level author drops.
 *
 * The id is a stable string the editor uses for selection / removal;
 * generated at placement time, persisted through save/load.
 */

export const PROP_KINDS = [
    'flower',
    'flower-2',
    'flower-3',
    'bush',
    'bush-2',
    'bush-3',
    'mushroom',
    'mushroom-2',
    'mushroom-3',
    'table',
    'table-2',
    'chair',
    'chair-2',
    'book',
    'book-2',
    'npc-keeper',
] as const

export type EditorPropKind = (typeof PROP_KINDS)[number]

export interface EditorProp {
    /** Stable id (e.g. `prop:flower:xxxx`) — survives save/load. */
    id: string
    /** Geometry/visual archetype — must be one of `PROP_KINDS`. */
    kind: EditorPropKind
    /** World-space placement. Y is the prop's base — the model's local
     *  origin sits on the floor / supporting surface. */
    position: { x: number; y: number; z: number }
    /** Yaw rotation around Y in radians, 0 = facing +X. */
    yaw: number
    /** Uniform scale. 1 is the authored size. */
    scale: number
    /** Whether this instance was snapped to a voxel grid at placement.
     *  Persisted so the editor UI can re-show the same authoring
     *  choice when the prop is re-selected; the runtime ignores it. */
    gridAligned: boolean
}

/** Pretty label used by the editor's kind picker. Adding a new kind:
 *  extend `PROP_KINDS`, add a label here, add a geometry recipe in
 *  `prop-models.ts`. */
export const PROP_LABELS: Record<EditorPropKind, string> = {
    flower: 'Flower 1',
    'flower-2': 'Flower 2',
    'flower-3': 'Flower 3',
    bush: 'Bush 1',
    'bush-2': 'Bush 2',
    'bush-3': 'Bush 3',
    mushroom: 'Mushroom 1',
    'mushroom-2': 'Mushroom 2',
    'mushroom-3': 'Mushroom 3',
    table: 'Table 1',
    'table-2': 'Table 2',
    chair: 'Chair 1',
    'chair-2': 'Chair 2',
    book: 'Book 1',
    'book-2': 'Book 2',
    'npc-keeper': 'Keeper NPC',
}
