import type { AudioManifest } from '../engine/audio'

/**
 * Canonical audio asset IDs. Use these constants — not raw strings —
 * so a rename rolls cleanly through every call site.
 *
 * Groups:
 *   - Game one-shots: pickup, bow, arrow-hit, death, death-stinger
 *   - Player locomotion: footstep variants (rotated for variety),
 *     jump take-off, landing thud, high-jump lift
 *   - Music: explore / calm / action / cave background loops
 *   - Ambient loops: weather, fire, liquids, magic (loopable beds the
 *     FX system pairs with its weather / fire / lava / water zones)
 *   - One-shot effects: thunder, fire whoosh, explosion (paired with
 *     `triggerExplosion` and weather event bursts), bubble pops,
 *     magic chimes
 */
export const GameAudio = {
    Background: 'music.background',
    BackgroundCalm: 'music.background.calm',
    BackgroundAction: 'music.background.action',
    BackgroundCave: 'music.background.cave',
    /** Minimalistic piano beds — `music` bus, intended for level
     *  authors who want atmosphere instead of soundtrack. */
    PianoQuiet: 'music.piano.quiet',
    PianoNight: 'music.piano.night',
    PianoDrift: 'music.piano.drift',

    /** Ambient location set — calm, intriguing, piano-led beds in the
     *  C418 vein. `Start` / `Garden` / `Town` are the demo-location
     *  environment beds; `Tension` and `Cave` are meant to be triggered
     *  by scripts (`audio.play('music.amb.tension', { fade })`) or set as
     *  a cave level's environment track. */
    MusicStart: 'music.amb.start',
    MusicGarden: 'music.amb.garden',
    MusicTown: 'music.amb.town',
    MusicTension: 'music.amb.tension',
    MusicCave: 'music.amb.cave',
    /** Abandoned dwarf-mine bed ("Hollowdeep") — darker/heavier than
     *  `MusicCave`: a faded dwarf-hall motif, cold organ swell, ghost-forge
     *  metal rings, drip echoes, and timber creaks. Set as the environment
     *  track for deep mine levels. */
    MusicMine: 'music.amb.mine',

    /** Themed location/screen music — richer, composed pieces (vs the
     *  always-on ambient beds). Set as a level `environment` bed, the title
     *  screen track, or play from a script. */
    ThemeMenu: 'music.theme.menu',
    ThemeTavern: 'music.theme.tavern',
    ThemeRoyal: 'music.theme.royal',
    ThemeCathedral: 'music.theme.cathedral',

    PickupGold: 'sfx.pickup.gold',
    PickupArrow: 'sfx.pickup.arrow',
    Bow: 'sfx.bow',
    ArrowHit: 'sfx.arrow.hit',
    Death: 'sfx.death',
    DeathStinger: 'stinger.death',

    // ── Player locomotion ────────────────────────────────────────────
    // Footsteps are surface-aware — the locomotion system queries the
    // voxel under the player's feet and picks the matching pool. Two
    // variants per surface give just enough variety; rate jitter at
    // play time does the rest.
    //
    // Surface families:
    //   - grass  (palette: grass, leaf)         — soft, muffled
    //   - dirt   (palette: dirt, sand)          — heavy thud
    //   - stone  (palette: stone, brick, glow,  — clean click
    //             door, invisible border)
    //   - wood   (palette: wood, plank)         — hollow creak
    //   - water  (palette: water, partial-      — splash
    //             submerged)
    //
    // `Jump` is the standard take-off; `Land` fires after enough
    // airborne time; `HighJump` is a heavier enchanted lift cue —
    // louder and more layered than the plain jump without the bright
    // arcade arpeggio.
    FootstepGrass1: 'sfx.footstep.grass.1',
    FootstepGrass2: 'sfx.footstep.grass.2',
    FootstepDirt1:  'sfx.footstep.dirt.1',
    FootstepDirt2:  'sfx.footstep.dirt.2',
    FootstepStone1: 'sfx.footstep.stone.1',
    FootstepStone2: 'sfx.footstep.stone.2',
    FootstepWood1:  'sfx.footstep.wood.1',
    FootstepWood2:  'sfx.footstep.wood.2',
    FootstepWater1: 'sfx.footstep.water.1',
    FootstepWater2: 'sfx.footstep.water.2',
    Jump: 'sfx.jump',
    Land: 'sfx.land',
    HighJump: 'sfx.high.jump',
    AirPush: 'sfx.air.push',

    // ── Ambient loops (intended for `audio.playSpatial` with `loop: true`) ─
    AmbRain: 'sfx.amb.rain',
    AmbStorm: 'sfx.amb.storm',
    AmbWind: 'sfx.amb.wind',
    AmbFire: 'sfx.amb.fire',
    AmbWater: 'sfx.amb.water',
    AmbLava: 'sfx.amb.lava',
    AmbMagic: 'sfx.amb.magic',
    TorchFire: 'sfx.amb.torch',

    // ── Melee combat ─────────────────────────────────────────────────
    // Driven by the timed melee system. `swing` plays when an attack goes
    // active (whoosh of the weapon); `hit` when it lands and deals damage;
    // `block` when a raised shield catches it. Light vs heavy is chosen by
    // the attack id (staff-slam / hammer-slam → heavy).
    SwordSwing: 'sfx.melee.swing',
    HeavySwing: 'sfx.melee.swing.heavy',
    MeleeHit: 'sfx.melee.hit',
    MeleeHitHeavy: 'sfx.melee.hit.heavy',
    ShieldBlock: 'sfx.melee.block',
    /** Non-lethal "ugh" grunts when a body takes damage (death has its own
     *  cue). `PlayerHurt` plays flat (it's you); `NpcHurt` plays spatially. */
    PlayerHurt: 'sfx.hurt.player',
    NpcHurt: 'sfx.hurt.npc',

    // ── Spells ───────────────────────────────────────────────────────
    // Each staff spell has a cast cue (played as it fires) and an impact
    // cue (played where it lands). Casts are flat (you cast them); impacts
    // play spatially at the point of contact.
    SpellBoltCast: 'sfx.spell.bolt.cast',
    SpellBoltHit: 'sfx.spell.bolt.hit',
    SpellNovaCast: 'sfx.spell.nova.cast',
    SpellNovaHit: 'sfx.spell.nova.hit',
    SpellOrbCast: 'sfx.spell.orb.cast',
    SpellOrbZap: 'sfx.spell.orb.zap',

    // ── Vehicles ─────────────────────────────────────────────────────
    // Looping bed played spatially while a rail cart moves; stopped (with
    // a short fade) when the cart halts. See the rail-cart system.
    CartRolling: 'sfx.cart.rolling',

    // ── Consumables ──────────────────────────────────────────────────
    // Fired when the player uses a held consumable: a drink cue for
    // potions, an eat cue for food.
    ConsumeDrink: 'sfx.consume.drink',
    ConsumeEat: 'sfx.consume.eat',

    // ── Containers ───────────────────────────────────────────────────
    // Spatial cue when a loot chest is opened (lid creak + treasure ring).
    ChestOpen: 'sfx.chest.open',

    // ── Creatures: spider ─────────────────────────────────────────────
    // Spatial spider voice — chitter on lunge/attack, screech on hurt,
    // descending screech on death. Played from the NPC render hooks for
    // NPCs whose model is `spider`.
    SpiderChitter: 'sfx.spider.chitter',
    SpiderHurt: 'sfx.spider.hurt',
    SpiderDie: 'sfx.spider.die',

    // ── One-shot effects ─────────────────────────────────────────────
    Thunder: 'sfx.thunder',
    FireWhoosh: 'sfx.fire.whoosh',
    Explosion: 'sfx.explosion',
    ExplosionSmall: 'sfx.explosion.small',
    StoneImpact: 'sfx.stone.impact',
    Bubble: 'sfx.bubble',
    MagicChime: 'sfx.magic.chime',

    // ── Script-engine cues ───────────────────────────────────────────
    // Played by editor-authored scripts on quest-stage progression and
    // completion. Distinct from the in-world `MagicChime` so the
    // player can tell "the script said something" apart from "magic
    // happened near me".
    QuestChime:   'sfx.quest.chime',
    QuestFanfare: 'sfx.quest.fanfare',
} as const

export type GameAudioId = (typeof GameAudio)[keyof typeof GameAudio]

const path = (file: string): string => `/audio/8bit/${file}`

export const GAME_AUDIO_MANIFEST: AudioManifest = {
    sounds: [
        // Gameplay one-shots
        { id: GameAudio.PickupGold,  url: path('pickup-gold.wav'),  volume: 0.42, maxInstances: 4, priority: 3 },
        { id: GameAudio.PickupArrow, url: path('pickup-arrow.wav'), volume: 0.38, maxInstances: 4, priority: 3 },
        { id: GameAudio.Bow,         url: path('bow.wav'),          volume: 0.48, maxInstances: 3, priority: 2 },
        { id: GameAudio.ArrowHit,    url: path('arrow-hit.wav'),    volume: 0.52, maxInstances: 5, priority: 2 },
        { id: GameAudio.Death,       url: path('death.wav'),        volume: 0.62, maxInstances: 1, priority: 8 },

        // Melee combat — short, rapid-fire cues. `maxInstances` is generous
        // so a flurry of swings/hits never starves a voice.
        { id: GameAudio.SwordSwing,    url: path('sword-swing.wav'),     volume: 0.40, maxInstances: 5, priority: 2 },
        { id: GameAudio.HeavySwing,    url: path('heavy-swing.wav'),     volume: 0.46, maxInstances: 4, priority: 2 },
        { id: GameAudio.MeleeHit,      url: path('melee-hit.wav'),       volume: 0.52, maxInstances: 5, priority: 3 },
        { id: GameAudio.MeleeHitHeavy, url: path('melee-hit-heavy.wav'), volume: 0.60, maxInstances: 4, priority: 4 },
        { id: GameAudio.ShieldBlock,   url: path('shield-block.wav'),    volume: 0.56, maxInstances: 4, priority: 4 },
        { id: GameAudio.PlayerHurt,    url: path('player-hurt.wav'),     volume: 0.50, maxInstances: 2, priority: 5 },
        { id: GameAudio.NpcHurt,       url: path('npc-hurt.wav'),        volume: 0.44, maxInstances: 4, priority: 2 },

        // Spells — cast + impact cues.
        { id: GameAudio.SpellBoltCast, url: path('bolt-cast.wav'),       volume: 0.46, maxInstances: 3, priority: 3 },
        { id: GameAudio.SpellBoltHit,  url: path('bolt-hit.wav'),        volume: 0.50, maxInstances: 4, priority: 3 },
        { id: GameAudio.SpellNovaCast, url: path('nova-cast.wav'),       volume: 0.46, maxInstances: 2, priority: 3 },
        { id: GameAudio.SpellNovaHit,  url: path('nova-hit.wav'),        volume: 0.42, maxInstances: 5, priority: 2 },
        { id: GameAudio.SpellOrbCast,  url: path('orb-cast.wav'),        volume: 0.46, maxInstances: 3, priority: 3 },
        { id: GameAudio.SpellOrbZap,   url: path('orb-zap.wav'),         volume: 0.48, maxInstances: 5, priority: 3 },

        // Player locomotion — kept quiet by default so the constant
        // walking cadence doesn't dominate the mix. The locomotion
        // system applies a small rate-jitter on each play for variety.
        // Water footsteps are louder because the player needs to *feel*
        // wading even when ambient water hum is playing.
        { id: GameAudio.FootstepGrass1, url: path('footstep-grass-1.wav'), volume: 0.30, maxInstances: 4, priority: 1 },
        { id: GameAudio.FootstepGrass2, url: path('footstep-grass-2.wav'), volume: 0.30, maxInstances: 4, priority: 1 },
        { id: GameAudio.FootstepDirt1,  url: path('footstep-dirt-1.wav'),  volume: 0.34, maxInstances: 4, priority: 1 },
        { id: GameAudio.FootstepDirt2,  url: path('footstep-dirt-2.wav'),  volume: 0.34, maxInstances: 4, priority: 1 },
        { id: GameAudio.FootstepStone1, url: path('footstep-stone-1.wav'), volume: 0.36, maxInstances: 4, priority: 1 },
        { id: GameAudio.FootstepStone2, url: path('footstep-stone-2.wav'), volume: 0.36, maxInstances: 4, priority: 1 },
        { id: GameAudio.FootstepWood1,  url: path('footstep-wood-1.wav'),  volume: 0.34, maxInstances: 4, priority: 1 },
        { id: GameAudio.FootstepWood2,  url: path('footstep-wood-2.wav'),  volume: 0.34, maxInstances: 4, priority: 1 },
        { id: GameAudio.FootstepWater1, url: path('footstep-water-1.wav'), volume: 0.46, maxInstances: 4, priority: 1 },
        { id: GameAudio.FootstepWater2, url: path('footstep-water-2.wav'), volume: 0.46, maxInstances: 4, priority: 1 },
        { id: GameAudio.Jump,      url: path('jump.wav'),       volume: 0.40, maxInstances: 3, priority: 2 },
        { id: GameAudio.Land,      url: path('land.wav'),       volume: 0.44, maxInstances: 3, priority: 2 },
        { id: GameAudio.HighJump,  url: path('high-jump.wav'),  volume: 0.72, maxInstances: 2, priority: 4 },
        { id: GameAudio.AirPush,   url: path('air-push.wav'),   volume: 0.58, maxInstances: 3, priority: 4 },

        // Ambient loops — `loop: true` is the asset default; callers
        // can override via `playSpatial(id, pos, { loop: false })`.
        { id: GameAudio.AmbRain,   url: path('rain-loop.wav'),   volume: 0.32, loop: true, maxInstances: 2, priority: 1 },
        { id: GameAudio.AmbStorm,  url: path('storm-loop.wav'),  volume: 0.34, loop: true, maxInstances: 2, priority: 1 },
        { id: GameAudio.AmbWind,   url: path('wind-loop.wav'),   volume: 0.28, loop: true, maxInstances: 2, priority: 1 },
        { id: GameAudio.AmbFire,   url: path('fire-loop.wav'),   volume: 0.42, loop: true, maxInstances: 6, priority: 2 },
        { id: GameAudio.AmbWater,  url: path('water-loop.wav'),  volume: 0.30, loop: true, maxInstances: 4, priority: 1 },
        { id: GameAudio.AmbLava,   url: path('lava-loop.wav'),   volume: 0.38, loop: true, maxInstances: 4, priority: 2 },
        { id: GameAudio.AmbMagic,  url: path('magic-loop.wav'),  volume: 0.30, loop: true, maxInstances: 3, priority: 1 },
        { id: GameAudio.TorchFire, url: path('torch-loop.wav'),  volume: 0.22, loop: true, maxInstances: 8, priority: 1 },

        // Vehicles — looping rolling bed; a couple of carts may move at once.
        { id: GameAudio.CartRolling, url: path('cart-rolling-loop.wav'), volume: 0.34, loop: true, maxInstances: 4, priority: 2 },

        // Consumables — short one-shots on use (drink potion / eat food).
        { id: GameAudio.ConsumeDrink, url: path('consume-drink.wav'), volume: 0.52, maxInstances: 3, priority: 3 },
        { id: GameAudio.ConsumeEat,   url: path('consume-eat.wav'),   volume: 0.48, maxInstances: 3, priority: 3 },

        // Containers — chest open (spatial). Few open at once, so a small cap.
        { id: GameAudio.ChestOpen, url: path('chest-open.wav'), volume: 0.56, maxInstances: 3, priority: 3 },

        // Creatures: spider — spatial, played from NPC render hooks. Caps are
        // generous so a nest of spiders attacking at once never starves voices.
        { id: GameAudio.SpiderChitter, url: path('spider-chitter.wav'), volume: 0.44, maxInstances: 5, priority: 2 },
        { id: GameAudio.SpiderHurt,    url: path('spider-hurt.wav'),    volume: 0.46, maxInstances: 5, priority: 2 },
        { id: GameAudio.SpiderDie,     url: path('spider-die.wav'),     volume: 0.52, maxInstances: 4, priority: 3 },

        // One-shot effects
        { id: GameAudio.Thunder,        url: path('thunder.wav'),         volume: 0.78, maxInstances: 2, priority: 5 },
        { id: GameAudio.FireWhoosh,     url: path('fire-whoosh.wav'),     volume: 0.55, maxInstances: 3, priority: 3 },
        { id: GameAudio.Explosion,      url: path('explosion.wav'),       volume: 0.88, maxInstances: 3, priority: 6 },
        { id: GameAudio.ExplosionSmall, url: path('explosion-small.wav'), volume: 0.70, maxInstances: 4, priority: 5 },
        // Stone impact — short clack. `maxInstances` is generous because
        // a single stone can produce a quick cluster of contacts as it
        // bounces and settles; we let the audio engine cull stale ones.
        { id: GameAudio.StoneImpact,    url: path('stone-impact.wav'),    volume: 0.52, maxInstances: 6, priority: 2 },
        { id: GameAudio.Bubble,         url: path('bubble.wav'),          volume: 0.42, maxInstances: 8, priority: 1 },
        { id: GameAudio.MagicChime,     url: path('magic-chime.wav'),     volume: 0.48, maxInstances: 4, priority: 2 },
        { id: GameAudio.QuestChime,     url: path('quest-chime.wav'),     volume: 0.55, maxInstances: 4, priority: 3 },
        { id: GameAudio.QuestFanfare,   url: path('quest-fanfare.wav'),   volume: 0.62, maxInstances: 2, priority: 5 },
    ],
    music: [
        { id: GameAudio.Background,       url: path('background-loop.wav'),       volume: 0.36, loop: true, priority: 1 },
        { id: GameAudio.BackgroundCalm,   url: path('background-calm-loop.wav'),  volume: 0.34, loop: true, priority: 1 },
        { id: GameAudio.BackgroundAction, url: path('background-action-loop.wav'),volume: 0.32, loop: true, priority: 1 },
        { id: GameAudio.BackgroundCave,   url: path('background-cave-loop.wav'),  volume: 0.38, loop: true, priority: 1 },
        // Piano ambients — quieter than the gameplay loops so they
        // can sit comfortably under spoken-word or zone audio.
        { id: GameAudio.PianoQuiet,       url: path('piano-ambient-quiet.wav'),   volume: 0.30, loop: true, priority: 1 },
        { id: GameAudio.PianoNight,       url: path('piano-ambient-night.wav'),   volume: 0.28, loop: true, priority: 1 },
        { id: GameAudio.PianoDrift,       url: path('piano-ambient-drift.wav'),   volume: 0.30, loop: true, priority: 1 },
        // Ambient location set (calm/intriguing, C418-style). Volumes here
        // are the defaults used when a script plays them without an
        // explicit volume; the demo locations override via `environment`.
        { id: GameAudio.MusicStart,       url: path('amb-start-loop.wav'),        volume: 0.34, loop: true, priority: 1 },
        { id: GameAudio.MusicGarden,      url: path('amb-garden-loop.wav'),       volume: 0.30, loop: true, priority: 1 },
        { id: GameAudio.MusicTown,        url: path('amb-town-loop.wav'),         volume: 0.30, loop: true, priority: 1 },
        { id: GameAudio.MusicTension,     url: path('amb-tension-loop.wav'),      volume: 0.40, loop: true, priority: 1 },
        { id: GameAudio.MusicCave,        url: path('amb-cave-loop.wav'),         volume: 0.40, loop: true, priority: 1 },
        { id: GameAudio.MusicMine,        url: path('amb-mine-loop.wav'),         volume: 0.42, loop: true, priority: 1 },
        // Themed location/screen music.
        { id: GameAudio.ThemeMenu,        url: path('theme-menu-loop.wav'),       volume: 0.34, loop: true, priority: 1 },
        { id: GameAudio.ThemeTavern,      url: path('theme-tavern-loop.wav'),     volume: 0.32, loop: true, priority: 1 },
        { id: GameAudio.ThemeRoyal,       url: path('theme-royal-loop.wav'),      volume: 0.32, loop: true, priority: 1 },
        { id: GameAudio.ThemeCathedral,   url: path('theme-cathedral-loop.wav'),  volume: 0.34, loop: true, priority: 1 },
    ],
    stingers: [
        { id: GameAudio.DeathStinger, url: path('death-stinger.wav'), volume: 0.78, priority: 9 },
    ],
}
