import { CHUNK_DIM } from './chunk'
import { ChunkManager } from './chunk-manager'
import type { Palette } from './palette'

const MAGIC = 0x56525047 // "VRPG"
const VERSION = 1
const CHUNK_VOLUME = CHUNK_DIM * CHUNK_DIM * CHUNK_DIM

export interface SerializedLevel<TMeta = unknown> {
    chunks: ChunkManager
    metadata: TMeta
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function serializeLevel<TMeta>(chunks: ChunkManager, metadata: TMeta): ArrayBuffer {
    const paletteBytes = textEncoder.encode(JSON.stringify(chunks.palette))
    const metadataBytes = textEncoder.encode(JSON.stringify(metadata ?? null))
    const chunkList = [...chunks.allChunks()]

    let byteLength = 4 + 2 + 4 + 4 + 4 + paletteBytes.byteLength + metadataBytes.byteLength
    for (const chunk of chunkList) {
        byteLength += 4 + 4 + 4 + 4 + chunk.data.byteLength
    }

    const buffer = new ArrayBuffer(byteLength)
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)
    let offset = 0

    view.setUint32(offset, MAGIC, true); offset += 4
    view.setUint16(offset, VERSION, true); offset += 2
    view.setUint32(offset, paletteBytes.byteLength, true); offset += 4
    view.setUint32(offset, metadataBytes.byteLength, true); offset += 4
    view.setUint32(offset, chunkList.length, true); offset += 4

    bytes.set(paletteBytes, offset); offset += paletteBytes.byteLength
    bytes.set(metadataBytes, offset); offset += metadataBytes.byteLength

    for (const chunk of chunkList) {
        view.setInt32(offset, chunk.cx, true); offset += 4
        view.setInt32(offset, chunk.cy, true); offset += 4
        view.setInt32(offset, chunk.cz, true); offset += 4
        view.setUint32(offset, chunk.data.length, true); offset += 4
        bytes.set(new Uint8Array(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength), offset)
        offset += chunk.data.byteLength
    }

    return buffer
}

export function deserializeLevel<TMeta = unknown>(buffer: ArrayBuffer): SerializedLevel<TMeta> {
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)
    let offset = 0

    const magic = view.getUint32(offset, true); offset += 4
    if (magic !== MAGIC) throw new Error('deserializeLevel: invalid level magic')

    const version = view.getUint16(offset, true); offset += 2
    if (version !== VERSION) throw new Error(`deserializeLevel: unsupported version ${version}`)

    const paletteLength = view.getUint32(offset, true); offset += 4
    const metadataLength = view.getUint32(offset, true); offset += 4
    const chunkCount = view.getUint32(offset, true); offset += 4

    const palette = JSON.parse(textDecoder.decode(bytes.subarray(offset, offset + paletteLength))) as Palette
    offset += paletteLength
    const metadata = JSON.parse(textDecoder.decode(bytes.subarray(offset, offset + metadataLength))) as TMeta
    offset += metadataLength

    const chunks = new ChunkManager(palette)
    chunks.withBulkEdit(() => {
        for (let i = 0; i < chunkCount; i++) {
            const cx = view.getInt32(offset, true); offset += 4
            const cy = view.getInt32(offset, true); offset += 4
            const cz = view.getInt32(offset, true); offset += 4
            const voxelCount = view.getUint32(offset, true); offset += 4
            if (voxelCount !== CHUNK_VOLUME) {
                throw new Error(`deserializeLevel: invalid chunk voxel count ${voxelCount}`)
            }
            const data = new Uint16Array(voxelCount)
            for (let voxel = 0; voxel < voxelCount; voxel++) {
                data[voxel] = view.getUint16(offset + voxel * Uint16Array.BYTES_PER_ELEMENT, true)
            }
            chunks.getOrCreate(cx, cy, cz).replaceData(data)
            offset += voxelCount * Uint16Array.BYTES_PER_ELEMENT
        }
    })

    return { chunks, metadata }
}
