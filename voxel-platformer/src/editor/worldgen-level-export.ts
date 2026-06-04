import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { serializeLevel } from '../engine/voxel/level-serializer'
import type { LevelMeta } from '../game/level'
import {
    compileWorldSpec,
    type WorldgenCompileOptions,
    type WorldgenReport,
} from '../game/worldgen'
import type { EditorLevelMeta } from './editor-state'
import { editorMetaFromRuntimeLevel } from './procedural-level-export'

export interface WorldgenEditorLevel {
    readonly chunks: ChunkManager
    readonly runtimeMeta: LevelMeta
    readonly editorMeta: EditorLevelMeta
    readonly report: WorldgenReport
    readonly buffer: ArrayBuffer | null
}

export function compileWorldSpecToEditorLevel(
    spec: unknown,
    opts: WorldgenCompileOptions = {},
): WorldgenEditorLevel {
    const result = compileWorldSpec(spec, opts)
    const editorMeta = editorMetaFromRuntimeLevel(result.meta)
    const buffer = result.report.status === 'failed'
        ? null
        : serializeLevel(result.chunks, editorMeta)
    return {
        chunks: result.chunks,
        runtimeMeta: result.meta,
        editorMeta,
        report: result.report,
        buffer,
    }
}
