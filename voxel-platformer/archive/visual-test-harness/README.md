# Archived Visual Test Harness

This directory keeps the inactive Playwright/WebGPU visual-test experiment for
reference. It is outside the active `tests/` tree, has no npm script, and the
repo no longer depends on `@playwright/test`.

Do not revive it unless headless Chromium can return a non-null
`navigator.gpu.requestAdapter()` on the target machine. See
`docs/archived-visual-testing.md`.
