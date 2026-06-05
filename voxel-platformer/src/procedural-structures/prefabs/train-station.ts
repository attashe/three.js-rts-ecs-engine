import type { VoxelBuffer } from '../buffer'
import { STRUCTURE_MATERIALS as M } from '../materials'
import { BLOCK } from '../../engine/voxel/palette'
import type { StructurePrefab } from './prefab-types'

function build(buf: VoxelBuffer): void {
    buf.fillBox(-17, 0, -4, 17, 0, 5, M.plank, 'station-platform')
    buf.fillBox(-18, 0, -5, 18, 0, -5, M.stone2, 'station-platform-edge')
    buf.fillBox(-18, 0, 6, 18, 0, 6, M.stone2, 'station-platform-edge')
    buf.fillBox(-17, 1, 0, 17, 1, 0, BLOCK.rail, 'station-track')

    buf.fillBox(-13, 0, -10, -1, 0, -5, M.stone2, 'station-house-foundation')
    buf.hollowBox(-12, 1, -9, -2, 5, -5, 1, M.plank, 'station-house-wall')
    buf.fillBox(-12, 1, -9, -12, 5, -5, M.woodDark, 'station-house-post')
    buf.fillBox(-2, 1, -9, -2, 5, -5, M.woodDark, 'station-house-post')
    for (let x = -7; x <= -5; x++) for (let y = 1; y <= 3; y++) buf.del(x, y, -5)
    buf.fillBox(-8, 1, -5, -8, 4, -5, M.woodDark, 'station-door-frame')
    buf.fillBox(-4, 1, -5, -4, 4, -5, M.woodDark, 'station-door-frame')
    buf.fillBox(-8, 4, -5, -4, 4, -5, M.woodDark, 'station-door-frame')
    buf.fillBox(-11, 3, -5, -10, 4, -5, M.glass, 'station-window')
    buf.fillBox(-4, 3, -9, -3, 4, -9, M.glass, 'station-window')
    for (let z = -11; z <= -3; z++) {
        const rise = Math.max(0, 4 - Math.abs(z + 7))
        buf.fillBox(-13, 6 + rise, z, -1, 6 + rise, z, M.roof, 'station-house-roof')
    }
    buf.fillBox(-9, 5, -4, -5, 5, -4, M.banner, 'station-sign')

    for (const x of [-15, -9, -3, 3, 9, 15]) {
        buf.fillBox(x, 1, 3, x, 5, 3, M.woodDark, 'station-canopy-post')
    }
    buf.fillBox(-16, 6, 2, 16, 6, 5, M.roofDark, 'station-canopy-roof')
    buf.fillBox(-16, 5, 2, 16, 5, 2, M.woodDark, 'station-canopy-beam')
    buf.fillBox(-16, 5, 5, 16, 5, 5, M.woodDark, 'station-canopy-beam')

    for (let x = -17; x <= 17; x++) {
        buf.set(x, 1, 6, BLOCK.fence, 'station-fence')
    }
    buf.set(-18, 1, 4, BLOCK.fence, 'station-fence')
    buf.set(-18, 1, 5, BLOCK.fence, 'station-fence')
    buf.set(18, 1, 4, BLOCK.fence, 'station-fence')
    buf.set(18, 1, 5, BLOCK.fence, 'station-fence')

    buf.fillBox(8, 1, -4, 14, 1, -2, M.wood, 'station-cargo-pallet')
    buf.fillBox(9, 2, -4, 10, 3, -3, M.plank, 'station-crate')
    buf.fillBox(12, 2, -3, 13, 2, -3, M.plank, 'station-crate')
}

export const TRAIN_STATION: StructurePrefab = {
    id: 'train-station',
    label: 'Train Station',
    description: 'Rail stop with a platform, ticket house, canopy, fence line, benches, cargo, and station props.',
    build,
    props: [
        { id: 'bench-west', kind: 'chair', x: -13, y: 1, z: 3, yaw: Math.PI / 2, scale: 1.15 },
        { id: 'bench-east', kind: 'chair-2', x: 5, y: 1, z: 3, yaw: Math.PI / 2, scale: 1.15 },
        { id: 'ticket-table', kind: 'table', x: -7, y: 1, z: -7, yaw: 0, scale: 0.95 },
        { id: 'ticket-chair', kind: 'chair', x: -9, y: 1, z: -7, yaw: Math.PI, scale: 0.9 },
        { id: 'timetable', kind: 'book', x: -6, y: 2, z: -7, yaw: -0.35, scale: 0.75 },
        { id: 'flower-left', kind: 'flower-2', x: -15, y: 1, z: -5, yaw: 0.2, scale: 1 },
        { id: 'flower-right', kind: 'flower-3', x: 15, y: 1, z: -5, yaw: -0.4, scale: 1 },
        { id: 'bush-corner', kind: 'bush', x: -14, y: 1, z: -10, yaw: 0.6, scale: 1.05 },
    ],
}
