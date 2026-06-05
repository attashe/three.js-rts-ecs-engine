import type { VoxelBuffer } from '../buffer'
import { STRUCTURE_MATERIALS as M } from '../materials'
import { BLOCK } from '../../engine/voxel/palette'
import type { StructurePrefab } from './prefab-types'

function posts(buf: VoxelBuffer, tag: string, halfX: number, halfZ: number, height: number): void {
    for (const x of [-halfX, halfX]) {
        for (const z of [-halfZ, halfZ]) buf.fillBox(x, 1, z, x, height, z, M.woodDark, `${tag}-post`)
    }
}

function stripedAwning(buf: VoxelBuffer, tag: string, halfX: number, z0: number, z1: number, y: number): void {
    for (let x = -halfX; x <= halfX; x++) {
        const block = Math.abs(x) % 2 === 0 ? M.banner : M.thatch
        buf.fillBox(x, y, z0, x, y, z1, block, `${tag}-striped-awning`)
    }
}

function counter(buf: VoxelBuffer, tag: string, x0: number, x1: number, z: number): void {
    buf.fillBox(x0, 1, z, x1, 1, z, M.woodDark, `${tag}-counter-base`)
    buf.fillBox(x0, 2, z, x1, 2, z, M.plank, `${tag}-counter-top`)
}

function lowDisplay(buf: VoxelBuffer, tag: string, x0: number, x1: number, z: number, block: number = M.plank): void {
    buf.fillBox(x0, 1, z, x1, 1, z, block, `${tag}-low-display`)
}

function buildProductMarket(buf: VoxelBuffer): void {
    buf.fillBox(-7, 0, -5, 7, 0, 5, M.path, 'dwarf-product-market-pad')
    posts(buf, 'dwarf-product-market', 6, 4, 4)
    stripedAwning(buf, 'dwarf-product-market', 6, -4, 5, 5)
    buf.fillBox(-6, 4, -4, 6, 4, -4, M.woodDark, 'dwarf-product-market-back-beam')
    buf.fillBox(-6, 4, 5, 6, 4, 5, M.woodDark, 'dwarf-product-market-front-beam')
    counter(buf, 'dwarf-product-market', -5, -2, 3)
    counter(buf, 'dwarf-product-market', -1, 2, 3)
    counter(buf, 'dwarf-product-market', 3, 5, 3)
    buf.fillBox(-6, 1, -4, 6, 2, -4, M.wood, 'dwarf-product-market-back-shelf')
    buf.fillBox(-7, 1, 0, -7, 2, 4, M.wood, 'dwarf-product-market-side-crates')
    buf.fillBox(7, 1, -1, 7, 2, 3, M.wood, 'dwarf-product-market-side-crates')
    buf.set(-1, 3, 5, M.banner, 'dwarf-product-market-sign')
    buf.set(0, 3, 5, M.banner, 'dwarf-product-market-sign')
}

function buildForgeShop(buf: VoxelBuffer): void {
    buf.fillBox(-7, 0, -6, 7, 0, 6, M.stone2, 'dwarf-forge-floor')
    buf.fillBox(-7, 1, -6, 7, 4, -6, M.wood, 'dwarf-forge-back-wall')
    buf.fillBox(-7, 1, -6, -7, 4, 4, M.wood, 'dwarf-forge-side-wall')
    buf.fillBox(7, 1, -6, 7, 4, 4, M.wood, 'dwarf-forge-side-wall')
    posts(buf, 'dwarf-forge', 7, 6, 5)
    for (let z = -7; z <= 6; z++) {
        const rise = Math.max(0, 3 - Math.abs(z + 1))
        buf.fillBox(-8, 5 + rise, z, 8, 5 + rise, z, M.roofDark, 'dwarf-forge-roof')
    }
    buf.fillBox(4, 1, -5, 7, 4, -2, BLOCK.brick, 'dwarf-forge-hearth')
    buf.fillBox(4, 2, -1, 7, 4, -1, BLOCK.brick, 'dwarf-forge-hearth-mouth')
    buf.fillBox(5, 2, -1, 6, 3, -1, BLOCK.fire, 'dwarf-forge-fire')
    buf.fillBox(6, 5, -4, 6, 10, -4, BLOCK.brick, 'dwarf-forge-chimney')
    buf.set(6, 11, -4, BLOCK.smoke, 'dwarf-forge-smoke')
    buf.fillBox(-3, 1, -1, -1, 1, 1, M.darkStone, 'dwarf-forge-anvil-base')
    buf.fillBox(-3, 2, -1, 0, 2, 1, M.metal, 'dwarf-forge-anvil')
    buf.fillBox(-6, 1, 5, -2, 2, 5, M.woodDark, 'dwarf-forge-front-counter')
    buf.fillBox(2, 1, 5, 6, 2, 5, M.woodDark, 'dwarf-forge-front-counter')
    buf.fillBox(-6, 1, -5, -4, 3, -5, M.metal, 'dwarf-forge-tool-rack')
    buf.set(-5, 4, -5, M.metal, 'dwarf-forge-tool-rack')
}

function buildClothesStore(buf: VoxelBuffer): void {
    buf.fillBox(-7, 0, -5, 7, 0, 5, M.plank, 'dwarf-clothes-floor')
    buf.fillBox(-7, 1, -5, 7, 4, -5, M.plaster, 'dwarf-clothes-back-wall')
    buf.fillBox(-7, 1, -5, -7, 4, 3, M.plaster, 'dwarf-clothes-side-wall')
    buf.fillBox(7, 1, -5, 7, 4, 3, M.plaster, 'dwarf-clothes-side-wall')
    posts(buf, 'dwarf-clothes', 7, 5, 4)
    stripedAwning(buf, 'dwarf-clothes', 7, -5, 5, 5)
    buf.fillBox(-5, 1, -4, 5, 2, -4, M.wood, 'dwarf-clothes-back-shelf')
    counter(buf, 'dwarf-clothes', -5, 5, 3)
    buf.fillBox(-6, 1, -1, -5, 3, 1, M.banner, 'dwarf-clothes-cloth-rolls')
    buf.fillBox(5, 1, -1, 6, 3, 1, M.thatch, 'dwarf-clothes-cloth-rolls')
    buf.fillBox(-2, 3, 5, 2, 3, 5, M.banner, 'dwarf-clothes-sign')
}

function buildAlchemyStall(buf: VoxelBuffer): void {
    buf.fillBox(-6, 0, -5, 6, 0, 5, M.stone, 'dwarf-alchemy-pad')
    buf.fillBox(-6, 1, -5, 6, 4, -5, M.wood, 'dwarf-alchemy-back-wall')
    buf.fillBox(-6, 1, -5, -6, 4, 3, M.wood, 'dwarf-alchemy-side-wall')
    buf.fillBox(6, 1, -5, 6, 4, 3, M.wood, 'dwarf-alchemy-side-wall')
    posts(buf, 'dwarf-alchemy', 6, 5, 5)
    for (let z = -5; z <= 5; z++) {
        const rise = Math.max(0, 2 - Math.abs(z))
        buf.fillBox(-7, 5 + rise, z, 7, 5 + rise, z, M.roof, 'dwarf-alchemy-roof')
    }
    counter(buf, 'dwarf-alchemy', -5, 5, 3)
    buf.fillBox(-5, 1, -4, 5, 3, -4, M.woodDark, 'dwarf-alchemy-bottle-shelf')
    buf.fillBox(-4, 4, -4, -4, 4, -4, BLOCK.glass, 'dwarf-alchemy-bottle')
    buf.fillBox(-1, 4, -4, -1, 4, -4, BLOCK.glass, 'dwarf-alchemy-bottle')
    buf.fillBox(2, 4, -4, 2, 4, -4, BLOCK.glass, 'dwarf-alchemy-bottle')
    buf.set(0, 3, 5, M.leaf, 'dwarf-alchemy-herb-sign')
    buf.set(1, 3, 5, M.leaf, 'dwarf-alchemy-herb-sign')
}

function buildCozyDwarfProductMarket(buf: VoxelBuffer): void {
    buf.fillBox(-4, 0, -3, 4, 0, 3, M.path, 'dwarf-product-market-pad')
    posts(buf, 'dwarf-product-market', 4, 3, 3)
    stripedAwning(buf, 'dwarf-product-market', 4, -3, 3, 4)
    buf.fillBox(-4, 3, -3, 4, 3, -3, M.woodDark, 'dwarf-product-market-back-beam')
    buf.fillBox(-4, 3, 3, 4, 3, 3, M.woodDark, 'dwarf-product-market-front-beam')
    lowDisplay(buf, 'dwarf-product-market-meat', -3, -2, 1, M.woodDark)
    lowDisplay(buf, 'dwarf-product-market-apples', -1, 1, 1, M.plank)
    lowDisplay(buf, 'dwarf-product-market-fish', 2, 3, 1, M.woodDark)
    buf.fillBox(-3, 1, -3, 3, 2, -3, M.wood, 'dwarf-product-market-back-shelf')
    buf.fillBox(-4, 1, 0, -4, 1, 2, M.wood, 'dwarf-product-market-side-crates')
    buf.fillBox(4, 1, -1, 4, 1, 1, M.wood, 'dwarf-product-market-side-crates')
    buf.set(0, 2, 3, M.banner, 'dwarf-product-market-sign')
}

function buildCozyDwarfForgeShop(buf: VoxelBuffer): void {
    buf.fillBox(-5, 0, -4, 5, 0, 4, M.stone2, 'dwarf-forge-floor')
    buf.fillBox(-5, 1, -4, 5, 3, -4, M.wood, 'dwarf-forge-back-wall')
    buf.fillBox(-5, 1, -4, -5, 3, 2, M.wood, 'dwarf-forge-side-wall')
    buf.fillBox(5, 1, -4, 5, 3, 2, M.wood, 'dwarf-forge-side-wall')
    posts(buf, 'dwarf-forge', 5, 4, 4)
    for (let z = -5; z <= 4; z++) {
        const rise = Math.max(0, 2 - Math.abs(z + 1))
        buf.fillBox(-6, 4 + rise, z, 6, 4 + rise, z, M.roofDark, 'dwarf-forge-roof')
    }
    buf.fillBox(2, 1, -3, 5, 3, -1, BLOCK.brick, 'dwarf-forge-hearth')
    buf.fillBox(3, 2, 0, 4, 3, 0, BLOCK.fire, 'dwarf-forge-fire')
    buf.fillBox(4, 4, -3, 4, 7, -3, BLOCK.brick, 'dwarf-forge-chimney')
    buf.set(4, 8, -3, BLOCK.smoke, 'dwarf-forge-smoke')
    buf.fillBox(-3, 1, -1, -2, 1, 1, M.darkStone, 'dwarf-forge-anvil-base')
    buf.fillBox(-3, 2, -1, -1, 2, 1, M.metal, 'dwarf-forge-anvil')
    lowDisplay(buf, 'dwarf-forge-front-counter', -4, 4, 3, M.woodDark)
    buf.fillBox(-4, 1, -3, -4, 3, -2, M.metal, 'dwarf-forge-tool-rack')
}

function buildCozyDwarfClothesStore(buf: VoxelBuffer): void {
    buf.fillBox(-5, 0, -3, 5, 0, 3, M.plank, 'dwarf-clothes-floor')
    buf.fillBox(-5, 1, -3, 5, 3, -3, M.plaster, 'dwarf-clothes-back-wall')
    buf.fillBox(-5, 1, -3, -5, 3, 2, M.plaster, 'dwarf-clothes-side-wall')
    buf.fillBox(5, 1, -3, 5, 3, 2, M.plaster, 'dwarf-clothes-side-wall')
    posts(buf, 'dwarf-clothes', 5, 3, 3)
    stripedAwning(buf, 'dwarf-clothes', 5, -3, 3, 4)
    buf.fillBox(-4, 1, -2, 4, 2, -2, M.wood, 'dwarf-clothes-back-shelf')
    lowDisplay(buf, 'dwarf-clothes-front-counter', -4, 4, 2)
    buf.fillBox(-4, 1, 0, -3, 2, 1, M.banner, 'dwarf-clothes-cloth-rolls')
    buf.fillBox(3, 1, 0, 4, 2, 1, M.thatch, 'dwarf-clothes-cloth-rolls')
    buf.set(0, 2, 3, M.banner, 'dwarf-clothes-sign')
}

function buildCozyDwarfAlchemyStall(buf: VoxelBuffer): void {
    buf.fillBox(-4, 0, -3, 4, 0, 3, M.stone, 'dwarf-alchemy-pad')
    buf.fillBox(-4, 1, -3, 4, 3, -3, M.wood, 'dwarf-alchemy-back-wall')
    buf.fillBox(-4, 1, -3, -4, 3, 2, M.wood, 'dwarf-alchemy-side-wall')
    buf.fillBox(4, 1, -3, 4, 3, 2, M.wood, 'dwarf-alchemy-side-wall')
    posts(buf, 'dwarf-alchemy', 4, 3, 4)
    for (let z = -4; z <= 3; z++) {
        const rise = Math.max(0, 1 - Math.abs(z))
        buf.fillBox(-5, 4 + rise, z, 5, 4 + rise, z, M.roof, 'dwarf-alchemy-roof')
    }
    lowDisplay(buf, 'dwarf-alchemy-front-counter', -3, 3, 2, M.woodDark)
    buf.fillBox(-3, 1, -2, 3, 2, -2, M.woodDark, 'dwarf-alchemy-bottle-shelf')
    buf.fillBox(-2, 3, -2, -2, 3, -2, BLOCK.glass, 'dwarf-alchemy-bottle')
    buf.fillBox(0, 3, -2, 0, 3, -2, BLOCK.glass, 'dwarf-alchemy-bottle')
    buf.fillBox(2, 3, -2, 2, 3, -2, BLOCK.glass, 'dwarf-alchemy-bottle')
    buf.set(0, 2, 3, M.leaf, 'dwarf-alchemy-herb-sign')
}

export const TROLL_PRODUCT_MARKET: StructurePrefab = {
    id: 'troll-product-market',
    label: 'Troll-Sized Product Market',
    description: 'Large open food market scaled for trolls, with broad counters and oversized awning.',
    build: buildProductMarket,
    props: [
        { id: 'meat-display', kind: 'market-meat', x: -3.5, y: 3.05, z: 3.15, yaw: 0, scale: 1 },
        { id: 'apple-basket', kind: 'market-apples', x: 0.5, y: 3.05, z: 3.15, yaw: 0.15, scale: 1 },
        { id: 'fish-tray', kind: 'market-fish', x: 4, y: 3.05, z: 3.15, yaw: -0.08, scale: 1 },
        { id: 'vendor-stool', kind: 'chair-2', x: 0, y: 1, z: -1.8, yaw: Math.PI, scale: 0.85 },
    ],
}

export const TROLL_FORGE_SHOP: StructurePrefab = {
    id: 'troll-forge-shop',
    label: 'Troll-Sized Forge Shop',
    description: 'Broad forge shop with tall hearth, anvil, weapon displays, and a high roof.',
    build: buildForgeShop,
    props: [
        { id: 'spear-rack', kind: 'spear-rack', x: -5.4, y: 1, z: -3.4, yaw: Math.PI / 2, scale: 1 },
        { id: 'arrow-barrel', kind: 'arrow-barrel', x: 3.7, y: 1, z: 4.1, yaw: -0.1, scale: 1 },
        { id: 'helmet-stand', kind: 'helmet-stand', x: -4.3, y: 3.05, z: 5.1, yaw: 0.2, scale: 1 },
        { id: 'smith-table', kind: 'table-2', x: 1.7, y: 1, z: 1.2, yaw: 0.25, scale: 0.95 },
    ],
}

export const TROLL_CLOTHES_STORE: StructurePrefab = {
    id: 'troll-clothes-store',
    label: 'Troll-Sized Clothes Store',
    description: 'Large tailor stall with wide shelves, cloth rolls, and oversized display space.',
    build: buildClothesStore,
    props: [
        { id: 'hat-display', kind: 'hat-display', x: -2.8, y: 3.05, z: 3.15, yaw: 0, scale: 1 },
        { id: 'boot-rack', kind: 'boot-rack', x: 2.6, y: 3.05, z: 3.15, yaw: 0, scale: 1 },
        { id: 'tailor-table', kind: 'table-2', x: 0, y: 1, z: 1.0, yaw: Math.PI / 2, scale: 0.92 },
        { id: 'ledger', kind: 'book-2', x: 0.2, y: 2, z: 1.0, yaw: -0.2, scale: 0.7 },
    ],
}

export const TROLL_ALCHEMY_STALL: StructurePrefab = {
    id: 'troll-alchemy-stall',
    label: 'Troll-Sized Alchemy Stall',
    description: 'Large alchemy stall with high roof, broad counter, cauldron, and potion shelves.',
    build: buildAlchemyStall,
    props: [
        { id: 'potion-shelf', kind: 'potion-shelf', x: 0, y: 1, z: -2.8, yaw: 0, scale: 1 },
        { id: 'cauldron', kind: 'alchemy-cauldron', x: -3.3, y: 1, z: 0.2, yaw: 0, scale: 1 },
        { id: 'herbs', kind: 'mushroom-3', x: 3.2, y: 1, z: 0.8, yaw: 0.4, scale: 0.9 },
        { id: 'ledger', kind: 'book', x: 2.3, y: 3.05, z: 3.15, yaw: 0.16, scale: 0.75 },
    ],
}

export const DWARF_PRODUCT_MARKET: StructurePrefab = {
    id: 'dwarf-product-market',
    label: 'Cozy Dwarf Product Market',
    description: 'Small food stall with low counters, snug awning, meat, apples, and fish displays for dwarf merchants.',
    build: buildCozyDwarfProductMarket,
    props: [
        { id: 'meat-display', kind: 'market-meat', x: -2.5, y: 2.05, z: 1.15, yaw: 0, scale: 0.72 },
        { id: 'apple-basket', kind: 'market-apples', x: 0, y: 2.05, z: 1.15, yaw: 0.15, scale: 0.72 },
        { id: 'fish-tray', kind: 'market-fish', x: 2.5, y: 2.05, z: 1.15, yaw: -0.08, scale: 0.72 },
        { id: 'vendor-stool', kind: 'chair-2', x: 0, y: 1, z: -1.2, yaw: Math.PI, scale: 0.65 },
    ],
}

export const DWARF_FORGE_SHOP: StructurePrefab = {
    id: 'dwarf-forge-shop',
    label: 'Cozy Dwarf Forge Shop',
    description: 'Small blacksmith shop with a close hearth, low anvil, spear rack, arrow barrel, and helmet display.',
    build: buildCozyDwarfForgeShop,
    props: [
        { id: 'spear-rack', kind: 'spear-rack', x: -2.6, y: 1, z: -1.35, yaw: Math.PI / 2, scale: 0.78 },
        { id: 'arrow-barrel', kind: 'arrow-barrel', x: 2.8, y: 1, z: 2.15, yaw: -0.1, scale: 0.75 },
        { id: 'helmet-stand', kind: 'helmet-stand', x: -3.2, y: 2.05, z: 3.15, yaw: 0.2, scale: 0.76 },
        { id: 'smith-table', kind: 'table-2', x: 0.9, y: 1, z: 0.7, yaw: 0.25, scale: 0.68 },
    ],
}

export const DWARF_CLOTHES_STORE: StructurePrefab = {
    id: 'dwarf-clothes-store',
    label: 'Cozy Dwarf Clothes Store',
    description: 'Small tailor stall with low hat shelves, boot rack, cloth rolls, and a snug counter.',
    build: buildCozyDwarfClothesStore,
    props: [
        { id: 'hat-display', kind: 'hat-display', x: -2.2, y: 2.05, z: 2.15, yaw: 0, scale: 0.72 },
        { id: 'boot-rack', kind: 'boot-rack', x: 2.1, y: 2.05, z: 2.15, yaw: 0, scale: 0.72 },
        { id: 'tailor-table', kind: 'table-2', x: 0, y: 1, z: 0.7, yaw: Math.PI / 2, scale: 0.66 },
        { id: 'ledger', kind: 'book-2', x: 0.15, y: 2, z: 0.7, yaw: -0.2, scale: 0.55 },
    ],
}

export const DWARF_ALCHEMY_STALL: StructurePrefab = {
    id: 'dwarf-alchemy-stall',
    label: 'Cozy Dwarf Alchemy Stall',
    description: 'Small alchemy stall with reachable potion shelves, herb sign, cauldron, and low counter.',
    build: buildCozyDwarfAlchemyStall,
    props: [
        { id: 'potion-shelf', kind: 'potion-shelf', x: 0, y: 1, z: -0.7, yaw: 0, scale: 0.74 },
        { id: 'cauldron', kind: 'alchemy-cauldron', x: -2.4, y: 1, z: 0.1, yaw: 0, scale: 0.72 },
        { id: 'herbs', kind: 'mushroom-3', x: 2.4, y: 1, z: 0.6, yaw: 0.4, scale: 0.72 },
        { id: 'ledger', kind: 'book', x: 1.7, y: 2.05, z: 2.15, yaw: 0.16, scale: 0.55 },
    ],
}
