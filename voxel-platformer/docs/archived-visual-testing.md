# Archived Visual Testing Harness

The Playwright visual-test experiment is archived. It is intentionally not part
of the active npm scripts, dependency graph, test suite, or TypeScript build.

## Why It Was Archived

The game renderer is WebGPU-first. In this environment, headless Chromium could
open the procedural structures page and exposed `navigator.gpu`, but
`navigator.gpu.requestAdapter()` returned `null`.

That means the browser did not provide a usable WebGPU adapter. Any screenshot
from that run would only prove that a browser page existed, not that the real
WebGPU renderer produced correct pixels. Keeping Playwright active would add
browser downloads, setup time, and agent attention cost without reliable visual
coverage.

Observed diagnostic:

```json
{
  "status": "skipped",
  "reason": "WebGPU unavailable in Playwright for house-troll: requestAdapter returned null",
  "webgpu": {
    "hasNavigatorGpu": true,
    "supported": false,
    "reason": "requestAdapter returned null"
  }
}
```

## Archived Files

The inactive harness files are stored under:

```text
archive/visual-test-harness/
  playwright.config.ts
  procedural-structures.spec.ts
  visual-testing-pipeline.md
```

The archived proposal still contains the WebGPU launch flags and the original
scenario design. It should be treated as reference material, not active project
documentation.

## Active Verification Policy

Use the normal checks for automated coverage:

```bash
npm test
npm run typecheck
npm run build
```

For rendering, editor UI, FX, lighting, and audio changes, do a manual browser
pass through the local dev server. This is currently more reliable than a
headless screenshot harness because it uses the same visible browser path a
developer actually inspects.

## Re-Enabling Criteria

Only restore the harness if a target machine can prove headless WebGPU support.
At minimum:

1. Headless Chromium must return a non-null `navigator.gpu.requestAdapter()`.
2. The visual test must record adapter metadata in its summary.
3. The harness must fail hard when WebGPU is unavailable, not silently accept
   non-rendered screenshots.
4. The first restored scenarios should still be small and targeted, such as the
   procedural structures page.

To revive the archived version:

1. Re-add `@playwright/test` as a dev dependency.
2. Restore `archive/visual-test-harness/playwright.config.ts` to the repo root.
3. Restore `archive/visual-test-harness/procedural-structures.spec.ts` under
   `tests/visual/`.
4. Add npm scripts for `visual:test` and optionally `visual:update`.
5. Run with a hard WebGPU requirement, for example:

```bash
VISUAL_TEST_REQUIRE_WEBGPU=1 npm run visual:test
```

If `requestAdapter()` returns `null`, keep the harness archived.
