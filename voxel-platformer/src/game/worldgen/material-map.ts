import { BLOCK } from '../../engine/voxel/palette'
import type { EngineBlockKey, NormalizedMaterialAliasMap } from './spec-types'

export type MaterialResolution =
    | { ok: true; name: string; blockKey: EngineBlockKey; block: number; source: 'direct' | 'default-alias' | 'custom-alias' }
    | { ok: false; name: string; reason: 'unknown_material' | 'invalid_alias_target'; target?: string }

export const DEFAULT_MATERIAL_ALIASES: NormalizedMaterialAliasMap = {
    dark_stone: 'darkStone',
    limestone: 'stone2',
    dark_limestone: 'stone2',
    basalt: 'darkStone',
    rootbound_dirt: 'dirt',
    path: 'sand',
    road: 'sand',
    platform: 'stone',
    bridge: 'plank',
    crystal: 'glow',
    lantern: 'torch',
    bed: 'plank',
    furniture: 'plank',
    leaves: 'leaf',
    iron_ore: 'oreIron',
    copper_ore: 'oreCopper',
    crystal_ore: 'oreCrystal',
    glowing_ore: 'oreCrystal',
    chest_closed: 'chest',
    open_chest: 'openChest',
    spider_web: 'spiderWeb',
    web: 'spiderWeb',
    goods_shelf: 'goodsShelf',
    provision_shelf: 'goodsShelf',
    tool_panel: 'toolPanel',
    tool_rack_voxel: 'toolPanel',
    ore_shelf: 'oreShelf',
    record_shelf: 'recordShelf',
    ledger_shelf: 'recordShelf',
}

const BLOCK_KEY_BY_NORMALIZED_NAME = new Map<string, EngineBlockKey>(
    Object.keys(BLOCK).map((key) => [normalizeMaterialName(key), key as EngineBlockKey]),
)

export function resolveMaterial(
    name: string,
    aliases: Record<string, string> = {},
): MaterialResolution {
    const normalized = normalizeMaterialName(name)
    const customTarget = aliasValue(aliases, normalized)
    if (customTarget !== undefined) {
        if (!isEngineBlockKey(customTarget)) {
            return { ok: false, name, reason: 'invalid_alias_target', target: customTarget }
        }
        return { ok: true, name, blockKey: customTarget, block: BLOCK[customTarget], source: 'custom-alias' }
    }

    const direct = BLOCK_KEY_BY_NORMALIZED_NAME.get(normalized)
    if (direct) return { ok: true, name, blockKey: direct, block: BLOCK[direct], source: 'direct' }

    const defaultTarget = DEFAULT_MATERIAL_ALIASES[normalized]
    if (defaultTarget) {
        return { ok: true, name, blockKey: defaultTarget, block: BLOCK[defaultTarget], source: 'default-alias' }
    }

    return { ok: false, name, reason: 'unknown_material' }
}

export function isEngineBlockKey(value: string): value is EngineBlockKey {
    return Object.prototype.hasOwnProperty.call(BLOCK, value)
}

export function normalizeMaterialName(value: string): string {
    return value.trim().replace(/[-\s]+/g, '_').toLowerCase()
}

function aliasValue(aliases: Record<string, string>, normalizedName: string): string | undefined {
    if (Object.prototype.hasOwnProperty.call(aliases, normalizedName)) return aliases[normalizedName]
    for (const [key, value] of Object.entries(aliases)) {
        if (normalizeMaterialName(key) === normalizedName) return value
    }
    return undefined
}
