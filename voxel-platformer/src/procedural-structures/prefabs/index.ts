import type { StructurePrefab } from './prefab-types'
import { PORTAL_GATE } from './portal-gate'
import { CAMPFIRE } from './campfire'
import { WELL } from './well'
import { BANNER_ARCH } from './banner-arch'

export type { StructurePrefab } from './prefab-types'

/**
 * Registry of hand-authored structures, keyed by stable id. Add a prefab
 * by authoring its module and appending it here — the editor dropdown and
 * the asset layer pick it up automatically.
 */
export const STRUCTURE_PREFABS: readonly StructurePrefab[] = [
    PORTAL_GATE,
    CAMPFIRE,
    WELL,
    BANNER_ARCH,
]

const BY_ID = new Map<string, StructurePrefab>(STRUCTURE_PREFABS.map((p) => [p.id, p]))

/** Default prefab id — the headline portal gate. */
export const DEFAULT_PREFAB_ID = PORTAL_GATE.id

/** Look up a prefab by id, or `undefined` if unknown. */
export function getPrefab(id: string): StructurePrefab | undefined {
    return BY_ID.get(id)
}

/** All prefab ids in registry order. */
export function prefabIds(): string[] {
    return STRUCTURE_PREFABS.map((p) => p.id)
}
