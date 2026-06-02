import type { StructurePrefab } from './prefab-types'
import { PORTAL_GATE } from './portal-gate'
import { CAMPFIRE } from './campfire'
import { WELL } from './well'
import { BANNER_ARCH } from './banner-arch'
import { TRAIN_STATION } from './train-station'
import { FORGE } from './forge'
import {
    DWARF_ALCHEMY_STALL,
    DWARF_CLOTHES_STORE,
    DWARF_FORGE_SHOP,
    DWARF_PRODUCT_MARKET,
    TROLL_ALCHEMY_STALL,
    TROLL_CLOTHES_STORE,
    TROLL_FORGE_SHOP,
    TROLL_PRODUCT_MARKET,
} from './dwarf-shops'

export type { StructurePrefab, StructurePrefabProp } from './prefab-types'

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
    TRAIN_STATION,
    FORGE,
    TROLL_PRODUCT_MARKET,
    TROLL_FORGE_SHOP,
    TROLL_CLOTHES_STORE,
    TROLL_ALCHEMY_STALL,
    DWARF_PRODUCT_MARKET,
    DWARF_FORGE_SHOP,
    DWARF_CLOTHES_STORE,
    DWARF_ALCHEMY_STALL,
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
