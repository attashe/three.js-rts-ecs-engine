/**
 * Voxel surface atlas dimensions + tile lookup.
 *
 * The atlas is a single 256×256 RGBA texture packed as an 8×8 grid of
 * 32×32 tiles. Each tile is mostly bright with subtle grayscale
 * variation — the chunk shader multiplies the sampled tile luminance
 * into the per-vertex colour so the block keeps its authored hue and
 * the texture only adds small surface detail.
 *
 * Tile 0 is `blank` (uniform 1.0). Palette entries with no
 * `textureKey` map to slot 0, so plain-color blocks render identically
 * to the pre-texture build — no special-case branch needed.
 *
 * Adding a new tile: append the name to `TILE_NAMES`, drop a paint
 * recipe into `atlas-builder.ts`, and bump the atlas hash test.
 */

/** Pixel side length of the atlas image. Must be `TILE_SIZE * TILES_PER_ROW`. */
export const ATLAS_SIZE = 256
/** Pixel side length of a single tile. Authoring is kept small on
 *  purpose — the iso camera shows blocks at ~32-pixel screen size, so
 *  bigger tiles would just be wasted resolution. */
export const TILE_SIZE = 32
/** Number of tiles along one row of the atlas. */
export const TILES_PER_ROW = ATLAS_SIZE / TILE_SIZE
/** Total slot count (free + reserved + occupied). */
export const TILE_SLOT_COUNT = TILES_PER_ROW * TILES_PER_ROW

/**
 * Ordered list of tile names. The index of each name in this array
 * is its atlas slot index. Slot 0 is reserved for `blank`.
 *
 * Add new tiles at the END to avoid renumbering existing ones — saved
 * levels reference palette entries by index and the runtime palette
 * looks the textureKey up here, so reordering would silently retexture
 * existing saves.
 */
export const TILE_NAMES = [
    'blank',
    'grass',
    'dirt',
    'stone',
    'brick',
    'wood',
    'sand',
    'leaf',
    'plank',
    'cloud',
    'roof',
    'thatch',
    'plaster',
    'glass',
    'metal',
    'chest',
    'chest_open',
    'spider_web',
    'shelf_goods',
    'tool_panel',
    'ore_shelf',
    'record_shelf',
    'ore_iron',
    'ore_copper',
    'ore_crystal',
] as const

export type TileName = (typeof TILE_NAMES)[number]

/** Reverse lookup. `TILE_INDEX.blank === 0`. */
export const TILE_INDEX: Record<TileName, number> = TILE_NAMES.reduce(
    (acc, name, idx) => {
        acc[name] = idx
        return acc
    },
    {} as Record<TileName, number>,
)

/** UV-space size of one tile (TILE_SIZE / ATLAS_SIZE). The chunk
 *  material uses this to convert a tile slot + per-voxel fractional UV
 *  into a final atlas coordinate. */
export const TILE_UV_SIZE = TILE_SIZE / ATLAS_SIZE
