import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    testDir: './tests/visual',
    outputDir: '.tmp/playwright',
    timeout: 45_000,
    expect: {
        timeout: 10_000,
    },
    fullyParallel: false,
    reporter: [['list']],
    use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:8000',
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        trace: 'retain-on-failure',
        video: 'off',
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
    },
    webServer: {
        command: 'VISUAL_TEST=1 npx vite --host 127.0.0.1 --port 8000',
        url: 'http://127.0.0.1:8000/procedural-structures.html',
        reuseExistingServer: true,
        timeout: 60_000,
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium', channel: 'chromium' },
        },
    ],
})
