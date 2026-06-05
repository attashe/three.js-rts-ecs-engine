import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

type StructureScenario = 'house-troll' | 'house-folk' | 'tower-troll' | 'tower-folk' | 'wall-troll'

interface VisualState {
    scenario: string
    kind: 'tree' | 'house' | 'tower' | 'wall'
    seed: number
    scale?: 'troll' | 'folk'
    bounds: {
        width: number
        height: number
        depth: number
    }
    voxelCount: number
    removed: number
    topMaterials: string[]
    statsText: string
}

interface WebGpuProbe {
    hasNavigatorGpu: boolean
    supported: boolean
    reason?: string
    adapterInfo?: Record<string, unknown>
}

const SCENARIOS: StructureScenario[] = ['house-troll', 'house-folk', 'tower-troll', 'tower-folk', 'wall-troll']
const REQUIRE_WEBGPU = process.env.VISUAL_TEST_REQUIRE_WEBGPU === '1'

test('procedural structure scale variants render and emit LLM-readable artifacts', async ({ browser, browserName, baseURL }) => {
    const states = new Map<StructureScenario, VisualState>()
    for (const scenario of SCENARIOS) {
        const page = await browser.newPage({
            viewport: { width: 1280, height: 720 },
            deviceScaleFactor: 1,
        })
        const errors: string[] = []
        page.on('pageerror', (err) => {
            const text = (err.stack ?? err.message).trim()
            if (text) errors.push(text)
        })
        page.on('console', (msg) => {
            if (msg.type() !== 'error') return
            const text = msg.text().trim()
            if (text) errors.push(text)
        })

        const url = new URL(`/procedural-structures.html?visualTest=${scenario}`, baseURL ?? 'http://127.0.0.1:8000').toString()
        await page.goto(url)
        const webgpu = await page.evaluate(async (): Promise<WebGpuProbe> => {
            const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
            if (!gpu) return { hasNavigatorGpu: false, supported: false, reason: 'navigator.gpu is missing' }
            try {
                const adapter = await gpu.requestAdapter()
                if (!adapter) return { hasNavigatorGpu: true, supported: false, reason: 'requestAdapter returned null' }
                const adapterAny = adapter as { info?: Record<string, unknown>; requestAdapterInfo?: () => Promise<Record<string, unknown>> }
                const adapterInfo = adapterAny.info ?? (adapterAny.requestAdapterInfo ? await adapterAny.requestAdapterInfo().catch(() => undefined) : undefined)
                return { hasNavigatorGpu: true, supported: true, adapterInfo }
            } catch (err) {
                return {
                    hasNavigatorGpu: true,
                    supported: false,
                    reason: err instanceof Error ? err.message : String(err),
                }
            }
        })
        if (!webgpu.supported) {
            const reason = `WebGPU unavailable in Playwright for ${scenario}: ${webgpu.reason ?? 'unknown reason'}`
            await writeUnavailableSummary(scenario, page.url(), page.viewportSize(), browserName, webgpu, reason)
            if (REQUIRE_WEBGPU) expect(webgpu.supported, reason).toBe(true)
            test.skip(true, reason)
        }
        await page.waitForFunction(() => Boolean((window as any).__visualTest))
        const state = await page.evaluate(() => (window as any).__visualTest.ready()) as VisualState
        await expect(page.locator('canvas')).toBeVisible()
        states.set(scenario, state)

        await expect.poll(() => page.locator('#stats').textContent()).toContain('voxels')
        const dir = join(process.cwd(), '.tmp/visual', scenario)
        await mkdir(dir, { recursive: true })
        const screenshotPath = join(dir, 'actual.png')
        const screenshot = await page.screenshot({ path: screenshotPath, fullPage: false })
        const summary = {
            scenario,
            url: page.url(),
            viewport: page.viewportSize(),
            browser: browserName,
            status: 'passed',
            screenshot: screenshotPath,
            screenshotBytes: screenshot.length,
            webgpu,
            state,
        }
        await writeFile(join(dir, 'summary.json'), JSON.stringify(summary, null, 2))

        expect(screenshot.length, `${scenario} screenshot should not be empty`).toBeGreaterThan(10_000)
        expect(state.scenario).toBe(scenario)
        expect(state.voxelCount, `${scenario} should generate visible voxels`).toBeGreaterThan(50)
        expect(state.bounds.width, `${scenario} should have measurable width`).toBeGreaterThan(0)
        expect(state.bounds.height, `${scenario} should have measurable height`).toBeGreaterThan(0)
        expect(state.topMaterials.length, `${scenario} should report material summary`).toBeGreaterThan(0)
        expect(errors, `${scenario} should not emit page errors`).toEqual([])

        await page.close()
    }

    const houseTroll = requireState(states, 'house-troll')
    const houseFolk = requireState(states, 'house-folk')
    const towerTroll = requireState(states, 'tower-troll')
    const towerFolk = requireState(states, 'tower-folk')

    expect(houseTroll.kind).toBe('house')
    expect(houseFolk.kind).toBe('house')
    expect(houseTroll.scale).toBe('troll')
    expect(houseFolk.scale).toBe('folk')
    expect(houseFolk.bounds.width).toBeLessThan(houseTroll.bounds.width)
    expect(houseFolk.bounds.depth).toBeLessThan(houseTroll.bounds.depth)
    expect(houseFolk.bounds.height).toBeLessThan(houseTroll.bounds.height)

    expect(towerTroll.kind).toBe('tower')
    expect(towerFolk.kind).toBe('tower')
    expect(towerTroll.scale).toBe('troll')
    expect(towerFolk.scale).toBe('folk')
    expect(towerFolk.bounds.width).toBeLessThan(towerTroll.bounds.width)
    expect(towerFolk.bounds.height).toBeLessThan(towerTroll.bounds.height)

    const wallTroll = requireState(states, 'wall-troll')
    expect(wallTroll.kind).toBe('wall')
    expect(wallTroll.scale).toBe('troll')
    expect(wallTroll.bounds.width).toBeGreaterThan(20)
    expect(wallTroll.bounds.height).toBeGreaterThan(6)
})

function requireState(states: Map<StructureScenario, VisualState>, scenario: StructureScenario): VisualState {
    const state = states.get(scenario)
    if (!state) throw new Error(`Missing visual state for ${scenario}`)
    return state
}

async function writeUnavailableSummary(
    scenario: StructureScenario,
    url: string,
    viewport: { width: number; height: number } | null,
    browser: string,
    webgpu: WebGpuProbe,
    reason: string,
): Promise<void> {
    const dir = join(process.cwd(), '.tmp/visual', scenario)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'summary.json'), JSON.stringify({
        scenario,
        url,
        viewport,
        browser,
        status: 'skipped',
        reason,
        webgpu,
    }, null, 2))
}
