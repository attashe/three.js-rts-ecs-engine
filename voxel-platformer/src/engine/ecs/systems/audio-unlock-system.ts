import type { AudioEngine } from '../../audio'
import type { System } from './system'

export function createAudioUnlockSystem(audio: AudioEngine, target: Window = window): System {
    let disposed = false

    const unlock = () => {
        if (disposed || audio.unlocked) return
        void audio.unlock().catch((err) => {
            console.warn('Audio unlock failed:', err)
        })
    }

    return {
        name: 'audioUnlock',
        init() {
            target.addEventListener('pointerdown', unlock, { capture: true })
            target.addEventListener('keydown', unlock, { capture: true })
        },
        update() {
            // Event-driven; no per-frame work.
        },
        dispose() {
            disposed = true
            target.removeEventListener('pointerdown', unlock, { capture: true })
            target.removeEventListener('keydown', unlock, { capture: true })
            audio.dispose()
        },
    }
}
