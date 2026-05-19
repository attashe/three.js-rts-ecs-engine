import type { EditorLevelMeta } from '../editor/editor-state'
import type { LevelMeta, CoinPileSpawn } from './level'
import type { PistonMechanismConfig } from './mechanisms'

/**
 * Translate an editor-authored level (`EditorLevelMeta` + already-deserialized
 * chunks) into the runtime `LevelMeta` the game's `client.ts` expects. Only
 * the editor-authored bits map across — there are no editor controls for
 * stone spawners yet, so that array comes back empty. Levels played via the
 * editor's "Playtest" button therefore have no falling-stone hazards, which
 * is the right default while the editor doesn't expose spawner placement.
 */
export function levelMetaFromEditor(meta: EditorLevelMeta, fallbackSize: number = 32): LevelMeta {
    const coinPiles: CoinPileSpawn[] = meta.pickups.map((p) => ({
        position: { x: p.position.x, y: p.position.y, z: p.position.z },
        amount: p.amount,
    }))

    const pistons: PistonMechanismConfig[] = meta.pistons.map((p) => ({
        from: { x: p.from.x, y: p.from.y, z: p.from.z },
        to: { x: p.to.x, y: p.to.y, z: p.to.z },
        block: p.block,
        delay: p.delay ?? p.interval ?? 2,
        characterPolicy: p.characterPolicy,
        motion: p.motion ?? 'teleport',
        travelTime: p.travelTime ?? 1,
    }))

    return {
        spawn: { x: meta.spawn.x, y: meta.spawn.y, z: meta.spawn.z },
        stoneSpawners: [],
        coinPiles,
        pistons,
        size: fallbackSize,
    }
}
