import type { VoxelBuffer } from '../buffer'
import { STRUCTURE_MATERIALS as M } from '../materials'
import { BLOCK } from '../../engine/voxel/palette'
import type { StructurePrefab } from './prefab-types'

function build(buf: VoxelBuffer): void {
    buf.fillBox(-10, 0, -8, 10, 0, 8, M.dirt, 'forge-yard')
    buf.fillBox(-7, 0, -5, 7, 0, 5, M.stone2, 'forge-floor')
    buf.hollowBox(-7, 1, -5, 7, 5, 5, 1, M.wood, 'forge-wall')
    buf.fillBox(-7, 1, -5, -7, 5, 5, M.woodDark, 'forge-corner-post')
    buf.fillBox(7, 1, -5, 7, 5, 5, M.woodDark, 'forge-corner-post')
    for (let x = -2; x <= 2; x++) for (let y = 1; y <= 4; y++) buf.del(x, y, -5)
    buf.fillBox(-3, 1, -5, -3, 5, -5, M.woodDark, 'forge-door-frame')
    buf.fillBox(3, 1, -5, 3, 5, -5, M.woodDark, 'forge-door-frame')
    buf.fillBox(-3, 5, -5, 3, 5, -5, M.woodDark, 'forge-door-frame')

    for (let z = -7; z <= 7; z++) {
        const rise = Math.max(0, 4 - Math.abs(z))
        buf.fillBox(-8, 6 + rise, z, 8, 6 + rise, z, M.roofDark, 'forge-roof')
    }
    buf.fillBox(5, 1, 1, 7, 4, 4, BLOCK.brick, 'forge-hearth')
    buf.fillBox(5, 2, 0, 7, 4, 0, BLOCK.brick, 'forge-hearth-mouth')
    buf.fillBox(6, 2, 0, 6, 3, 0, BLOCK.fire, 'forge-fire')
    buf.fillBox(6, 5, 2, 6, 10, 2, BLOCK.brick, 'forge-chimney')
    buf.set(6, 11, 2, BLOCK.smoke, 'forge-smoke')
    buf.set(6, 12, 2, BLOCK.smoke, 'forge-smoke')

    buf.fillBox(-2, 1, 0, 0, 1, 2, M.darkStone, 'forge-anvil-base')
    buf.fillBox(-2, 2, 0, 1, 2, 2, M.metal, 'forge-anvil')
    buf.set(2, 1, 2, M.metal, 'forge-tool-rack')
    buf.fillBox(2, 2, 2, 2, 4, 2, M.metal, 'forge-tool-rack')
    buf.set(3, 3, 2, M.metal, 'forge-hammer')
    buf.set(2, 3, 3, M.metal, 'forge-tongs')

    buf.fillBox(-9, 1, 6, -5, 1, 7, M.woodDark, 'forge-log-stack')
    buf.fillBox(-8, 2, 6, -6, 2, 7, M.wood, 'forge-log-stack')
    for (let x = -10; x <= 10; x++) {
        buf.set(x, 1, -8, BLOCK.fence, 'forge-yard-fence')
        buf.set(x, 1, 8, BLOCK.fence, 'forge-yard-fence')
    }
    for (let z = -7; z <= 7; z++) {
        buf.set(-10, 1, z, BLOCK.fence, 'forge-yard-fence')
        buf.set(10, 1, z, BLOCK.fence, 'forge-yard-fence')
    }
}

export const FORGE: StructurePrefab = {
    id: 'forge',
    label: 'Forge',
    description: 'Blacksmith forge with chimney, hearth, anvil, fenced yard, work table, and workshop props.',
    build,
    props: [
        { id: 'work-table', kind: 'table-2', x: -4, y: 1, z: 2, yaw: Math.PI / 2, scale: 0.95 },
        { id: 'stool', kind: 'chair-2', x: -5, y: 1, z: 0, yaw: Math.PI / 2, scale: 0.85 },
        { id: 'ledger', kind: 'book-2', x: -4, y: 2, z: 2, yaw: 0.25, scale: 0.75 },
        { id: 'coal-bush', kind: 'bush-3', x: 8, y: 1, z: -6, yaw: 0.4, scale: 0.9 },
        { id: 'flower-yard', kind: 'flower', x: -8, y: 1, z: -6, yaw: -0.2, scale: 0.9 },
    ],
}
