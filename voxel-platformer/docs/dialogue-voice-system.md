# Dialogue Voice System

The dialogue voice system turns readable script dialogue into deterministic
fantasy-babble audio. It is not external TTS: synthesis runs in the browser,
uses generated PCM, and routes through the existing `AudioEngine` UI bus.

## Architecture

- `src/game/dialogue-voice/presets.ts` owns typed creature presets and
  normalization for author settings.
- `src/game/dialogue-voice/text.ts` maps English dialogue into stable fantasy
  syllable sequences by `{ text, preset, seed }`.
- `src/game/dialogue-voice/synth.ts` renders DOM-free mono PCM, so tests and
  the game share the same generator.
- `src/game/dialogue-voice/service.ts` adds worker-backed synthesis, a bounded
  LRU cache, cancellation, and playback via `audio.playGenerated(...)`.
- `src/game/dialogue-system.ts` starts voice playback when a modal dialogue
  line appears, applies the game dialogue playback rate multiplier, and fades
  the current line when the player advances.

## Authoring

NPCs have a Dialogue Voice section in the editor. Model defaults are:

- keeper: `dwarf`
- large troll: `troll`
- player model: `player`

Scripts can override the voice per speaker or per line:

```js
await ui.dialogue({
  npc: {
    id: 'keeper',
    name: 'Keeper Arlen',
    avatar: 'keeper',
    voice: { preset: 'dwarf', seed: 'keeper-arlen', volume: 0.55 },
  },
  player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },
  lines: [{ speaker: 'keeper', text: 'Welcome, traveler.' }],
})
```

Floating popup lines from `ui.say(...)` are intentionally silent. Use them for
short world hints; use `ui.dialogue(...)` when a line is important enough to
interrupt play flow with generated voice.

## Performance Notes

- Long lines are capped during render; author shorter dialogue beats for better
  responsiveness.
- Modal dialogue playback doubles the authored `rate`, so existing character
  voices keep their relative style while lines finish faster.
- Identical `{ text, preset, seed, rate, pitchOffset }` requests are cached.
- Synthesis uses a worker in browsers that support module workers and falls
  back to main-thread rendering if the worker fails.
- Runtime playback uses the existing UI bus, global unlock handling, and voice
  stealing rules.

Use `/voice-demo.html` to tune presets, inspect the generated fantasy line,
preview waveform shape, and export WAVs for comparison.
