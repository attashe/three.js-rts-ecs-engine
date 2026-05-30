# Visual Testing Pipeline Proposal

Archived reference. This harness is not active because headless Chromium in the
current environment returned `null` from `navigator.gpu.requestAdapter()`, so
screenshots were not trustworthy WebGPU-rendering evidence. See
`docs/archived-visual-testing.md` for the active project note.

This proposal describes a visual testing loop for the voxel platformer and
editor that can be used by human developers and by coding agents. The goal is
to catch rendering, camera, FX, lighting, modal UI, and editor-state regressions
without pulling visual inspection entirely into manual browser work.

The recommended path is Playwright first, with optional pixel-level comparison
helpers only when Playwright's built-in screenshot comparison is not enough.

## Goals

- Capture deterministic screenshots of known game and editor scenarios.
- Let an LLM inspect compact structured results before opening full images.
- Keep production bundle weight at zero.
- Avoid adding a cloud service or heavyweight component-story stack before we
  need it.
- Make failures actionable: provide actual, expected, diff, and metadata files.

## Non-goals

- This is not a replacement for unit tests or script/runtime tests.
- This is not intended to compare every frame of animated gameplay.
- This should not require Storybook, Chromatic, or a hosted visual review
  service in the first version.
- This should not ship test-only code in normal gameplay paths unless it is
  behind an explicit test flag.

## Recommended Stack

### Playwright

Use `@playwright/test` as the browser automation and screenshot harness.

Playwright can:

- launch the existing Vite app,
- open `index.html`, `editor.html`, `fx-demo.html`, or dedicated test URLs,
- drive keyboard/mouse interactions,
- wait until the engine reports a stable state,
- capture screenshots,
- compare screenshots with stored baselines.

Recommended initial browser target: Chromium only.

Cost:

- App bundle weight: none, if installed as a dev dependency.
- Dependency weight: high for development because Playwright browser binaries
  are large. Chromium-only keeps this lower than installing all browsers.
- Runtime performance: slower than unit tests because it launches a browser and
  renders real scenes, but it runs outside normal gameplay.
- LLM token cost: low when the test emits JSON summaries; high only if full
  screenshots are opened in the conversation.

### WebGPU Caveat

The game renderer is WebGPU-first, so Playwright screenshots are useful only
after the browser actually has a WebGPU adapter. Playwright's default headless
Chromium path can differ from the regular browser path; do not treat a nonblank
screenshot as proof that WebGPU is configured correctly.

For Chromium visual tests, prefer the newer headless path and launch with the
same family of flags recommended by Chrome's WebGPU-in-headless guidance:

```ts
use: {
  browserName: 'chromium',
  channel: 'chromium',
  launchOptions: {
    args: [
      '--no-sandbox',
      '--enable-gpu',
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--enable-features=Vulkan',
      '--use-angle=vulkan',
      '--disable-vulkan-surface',
      '--disable-gpu-sandbox',
      '--disable-dev-shm-usage',
    ],
  },
}
```

This still depends on the host. If `navigator.gpu.requestAdapter()` returns
`null`, inspect `chrome://gpu` in the same browser family and check Vulkan/GPU
drivers. The current visual test records a small `webgpu` preflight object in
`.tmp/visual/<scenario>/summary.json` and skips when WebGPU is missing. Set
`VISUAL_TEST_REQUIRE_WEBGPU=1` when a CI/developer machine is expected to have
working headless WebGPU and the test should fail hard instead.

References:

- Chrome for Developers, "Supercharge Web AI model testing: WebGPU, WebGL, and
  Headless Chrome".
- Chrome for Developers, "WebGPU: Troubleshooting tips and fixes".
- Playwright docs, "Chromium: new headless mode".

### Optional Pixelmatch Layer

Add `pixelmatch` plus `pngjs` only if we need custom diff summaries beyond
Playwright's snapshot output.

Use cases:

- compute `diffPixels` and `diffRatio`,
- generate a custom `diff.png`,
- crop high-difference regions into small images,
- emit hotspot rectangles for the LLM to inspect.

Cost:

- App bundle weight: none, if dev-only.
- Dependency weight: small.
- Runtime performance: cheap compared with launching the browser.
- LLM token cost: very low if the agent reads only `summary.json`; screenshots
  or crops are opened only after a failure.

Do not add `pixelmatch` in version 1 unless Playwright's report is not enough.

## Deterministic Visual Harness

The game should expose a test-only URL mode, for example:

```text
index.html?level=demo&visualTest=inventory&seed=1&time=12&camera=iso-ne
editor.html?visualTest=palette&level=demo
fx-demo.html?visualTest=rain-lava
```

When `visualTest` is present, the app should:

- use a fixed viewport and device scale in Playwright,
- set a fixed camera mode and camera rotation,
- set deterministic time of day and weather state,
- seed or freeze random effects where possible,
- disable or stabilize non-essential animation,
- wait until chunk meshes, props, NPCs, FX, and UI overlays are settled,
- expose a small test API on `window.__visualTest`.

Suggested `window.__visualTest` shape:

```ts
interface VisualTestApi {
    ready(): Promise<void>
    scenario(): string
    state(): {
        levelId?: string
        levelName?: string
        camera?: string
        player?: { x: number; y: number; z: number }
        visibleFxZones?: number
        activeLights?: number
        uiOverlay?: string | null
    }
    run?(command: string, payload?: unknown): Promise<unknown>
}
```

The agent should call `await page.evaluate(() => window.__visualTest.ready())`
before taking screenshots.

## First Scenarios

Start with a small scenario set that targets our actual recent bug classes.

### Game Runtime

- `demo-start-iso`: initial demo level at fixed iso camera.
- `inventory-open`: press `Tab`, verify inventory overlay layout.
- `dialogue-choice`: interact with Keeper Arlen and show the dialogue panel.
- `shop-open`: open the arrow shop from dialogue.
- `rain-bridge-torch`: verify rain, upper bridge occlusion, and torch light.
- `portal-magic-active`: paid portal FX active, verify no large shader stall
  after warmup.

### Editor

- `editor-palette`: standard palette visible with expected swatches.
- `editor-select-gizmo`: selected NPC or sound source shows transform gizmo.
- `editor-top-view-cutaway`: top-down active layer highlighting and hidden
  upper layers.
- `editor-orbit-camera`: orbit camera view renders terrain and gizmo.

### FX Demo

- `fx-water-surface`: water surface visible and nonblank.
- `fx-lava-surface`: lava surface renders on top face, not side faces.
- `fx-lightning`: lightning produces bright short-lived light and thunder.
- `fx-bonfire`: bonfire smoke/flame is compact, not a sky column.

## Artifact Layout

Write artifacts outside source folders, for example:

```text
.tmp/visual/
  inventory-open/
    actual.png
    expected.png
    diff.png
    summary.json
```

Suggested `summary.json`:

```json
{
  "scenario": "inventory-open",
  "url": "http://localhost:8000/index.html?level=demo&visualTest=inventory",
  "viewport": "1280x720",
  "browser": "chromium",
  "status": "failed",
  "diffPixels": 421,
  "diffRatio": 0.00046,
  "threshold": 0.001,
  "hotspots": [
    { "x": 912, "y": 140, "w": 160, "h": 96 }
  ],
  "state": {
    "levelName": "Demo",
    "camera": "iso-ne",
    "uiOverlay": "inventory"
  }
}
```

The LLM loop should inspect `summary.json` first. Only open `actual.png`,
`diff.png`, or a hotspot crop when the summary indicates a meaningful
regression.

## Suggested Commands

```bash
npm run visual:test
npm run visual:test -- --scenario inventory-open
npm run visual:update
```

Recommended behavior:

- `visual:test` runs deterministic scenarios and compares against baselines.
- `visual:update` refreshes baselines after an intentional visual change.
- CI can run a reduced smoke set first, with the full visual set optional or
  nightly.

## Baseline Policy

Store baselines in a predictable test folder, for example:

```text
tests/visual/__screenshots__/
```

Rules:

- Baselines are committed only for stable scenarios.
- Dynamic scenes should freeze time, random seeds, and camera before capture.
- Avoid full-screen screenshots when a smaller locator screenshot is enough.
- Use thresholds sparingly. A high threshold can hide real regressions.
- If a scene is intentionally animated, capture at a fixed simulation time.

## LLM Loop

The intended agent workflow:

1. Run a visual scenario.
2. Read `summary.json`.
3. If passed, continue without opening images.
4. If failed, open `diff.png` or a cropped hotspot image.
5. Patch code.
6. Re-run the same scenario.
7. Re-run the relevant unit/type tests.

This keeps token usage controlled. A JSON summary is cheap; full screenshots
should be used only when visual context is actually needed.

## Performance Considerations

- Run Chromium-only initially.
- Keep viewport fixed, for example `1280x720` and optionally `390x844` for
  mobile-like UI.
- Prefer a few targeted screenshots over one giant all-purpose screenshot.
- Warm up expensive shaders before capture when testing FX zones.
- Do not capture while chunks are still streaming or while first-use shaders
  are compiling.
- Disable debug overlays unless the scenario explicitly tests debug rendering.
- Use test flags to silence ambient random effects that are not under test.

## Dependency and Bundle Impact

| Tool | Runtime bundle | Dev dependency cost | Notes |
| --- | --- | --- | --- |
| Playwright | none | high | Browser binaries are the real cost. Use Chromium only first. |
| pixelmatch | none | low | Optional custom image diff helper. |
| pngjs | none | low | Needed if we manually decode PNGs for pixelmatch. |
| looks-same | none | moderate | More perceptual diffing, but heavier than pixelmatch. |
| Storybook/Chromatic | none in game | high | Useful later for DOM components, not first choice for engine visuals. |

## Proposed Version 1

Implement only:

1. `@playwright/test` with Chromium.
2. `visualTest` URL mode for game/editor deterministic setup.
3. Three to five initial scenarios:
   - `demo-start-iso`
   - `inventory-open`
   - `dialogue-choice`
   - `editor-top-view-cutaway`
   - `fx-lava-surface`
4. Artifact output with `actual.png` and `summary.json`.
5. Use Playwright snapshots first; defer pixelmatch unless the built-in report
   is not enough for agent iteration.

This gives a useful LLM-visible loop with zero production bundle impact and
keeps the first implementation small enough to validate quickly.

## Implemented Version 1

The first pipeline is in place for the procedural structures page.

Commands:

```bash
npm run visual:test
npm run visual:update
```

Current coverage:

- `procedural-structures.html?visualTest=procedural-structures`
- `house-troll`
- `house-folk`
- `tower-troll`
- `tower-folk`
- `wall-troll`

The page exposes `window.__visualTest` with `ready`, `state`, and `run`.
The Playwright test drives scenarios through that API, captures screenshots,
and writes compact summaries to:

```text
.tmp/visual/<scenario>/actual.png
.tmp/visual/<scenario>/summary.json
```

Version 1 intentionally does not commit baseline PNGs. It validates that
Playwright exposes a WebGPU adapter, the WebGPU page renders, the screenshot is
non-empty, the scenario metadata is stable, and the small-folk structures are
measurably smaller than the troll-town variants. Add Playwright snapshot
baselines or a pixelmatch layer after the scenarios stabilize visually.
