import type { AudioManifest } from '../engine/audio'

export const GameAudio = {
    Background: 'music.background',
    PickupGold: 'sfx.pickup.gold',
    PickupArrow: 'sfx.pickup.arrow',
    Bow: 'sfx.bow',
    ArrowHit: 'sfx.arrow.hit',
    Death: 'sfx.death',
    DeathStinger: 'stinger.death',
} as const

export const GAME_AUDIO_MANIFEST: AudioManifest = {
    sounds: [
        { id: GameAudio.PickupGold, url: '/audio/8bit/pickup-gold.wav', volume: 0.42, maxInstances: 4, priority: 3 },
        { id: GameAudio.PickupArrow, url: '/audio/8bit/pickup-arrow.wav', volume: 0.38, maxInstances: 4, priority: 3 },
        { id: GameAudio.Bow, url: '/audio/8bit/bow.wav', volume: 0.48, maxInstances: 3, priority: 2 },
        { id: GameAudio.ArrowHit, url: '/audio/8bit/arrow-hit.wav', volume: 0.52, maxInstances: 5, priority: 2 },
        { id: GameAudio.Death, url: '/audio/8bit/death.wav', volume: 0.62, maxInstances: 1, priority: 8 },
    ],
    music: [
        { id: GameAudio.Background, url: '/audio/8bit/background-loop.wav', volume: 0.36, loop: true, priority: 1 },
    ],
    stingers: [
        { id: GameAudio.DeathStinger, url: '/audio/8bit/death-stinger.wav', volume: 0.78, priority: 9 },
    ],
}
