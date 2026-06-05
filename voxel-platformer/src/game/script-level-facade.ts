import type { LevelMetaFacade } from '../engine/script/types'

/** The slice of a level that the script engine surfaces via the
 *  `level.*` bindings. Defined structurally (not via `Pick<LevelMeta, ...>`)
 *  so the file has zero transitive imports — keeps the build graph tight
 *  for tests that only need to verify the facade contract. */
export interface LevelInfo {
    name: string
    size: number
    spawn: { x: number; y: number; z: number }
}

/** Build the production `LevelMetaFacade` from a level snapshot. The facade
 *  reads through to the underlying `LevelInfo` on every call, but returns a
 *  fresh `spawn` object so scripts can't mutate level state by writing to
 *  the value they received. */
export function buildLevelFacade(info: LevelInfo): LevelMetaFacade {
    return {
        getSpawn() { return { x: info.spawn.x, y: info.spawn.y, z: info.spawn.z } },
        getSize() { return info.size },
        getName() { return info.name },
    }
}
