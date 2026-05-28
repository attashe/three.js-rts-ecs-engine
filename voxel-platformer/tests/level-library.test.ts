import test from 'node:test'
import assert from 'node:assert/strict'
import { listLevelLibrary, loadLevelBufferById } from '../src/game/level-library'

interface FakeFetch {
    fetch: typeof fetch
    calls: string[]
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

function makeFetch(routes: Record<string, () => Response>): FakeFetch {
    const calls: string[] = []
    const impl = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        calls.push(url)
        const route = routes[url]
        return route ? route() : new Response('', { status: 404 })
    }) as typeof fetch
    return { fetch: impl, calls }
}

test('level library preserves exact .vplevel filenames from the manifest', async () => {
    const fake = makeFetch({
        '/levels/manifest.json': () => jsonResponse({
            version: 1,
            levels: [{
                file: 'Castle Keep.vplevel',
                name: 'Castle Keep',
                size: 128,
            }],
        }),
    })

    const [entry] = await listLevelLibrary(fake.fetch)

    assert.equal(entry?.id, 'Castle-Keep')
    assert.equal(entry?.file, 'Castle Keep.vplevel')
    assert.equal(entry?.url, '/levels/Castle%20Keep.vplevel')
    assert.equal(entry?.name, 'Castle Keep')
    assert.equal(entry?.size, 128)
    assert.deepEqual(fake.calls, ['/__vpe/levels', '/levels/manifest.json'])
})

test('level library includes the built-in demo when no disk demo shadows it', async () => {
    const fake = makeFetch({
        '/__vpe/levels': () => jsonResponse([]),
    })

    const entries = await listLevelLibrary(fake.fetch)
    const demo = entries.find((entry) => entry.id === 'demo')

    assert.equal(demo?.name, 'Demo (built-in)')
    assert.equal(demo?.builtin, 'demo')
    assert.equal(demo?.url, 'builtin:demo')
    assert.deepEqual(fake.calls, ['/__vpe/levels'])
})

test('disk-backed demo level shadows the built-in demo entry', async () => {
    const fake = makeFetch({
        '/__vpe/levels': () => jsonResponse([{
            id: 'demo',
            file: 'demo.vplevel',
            name: 'demo',
        }]),
    })

    const entries = await listLevelLibrary(fake.fetch)
    const demos = entries.filter((entry) => entry.id === 'demo')

    assert.equal(demos.length, 1)
    assert.equal(demos[0]?.builtin, undefined)
    assert.equal(demos[0]?.url, '/levels/demo.vplevel')
})

test('loadLevelBufferById uses the library url for non-canonical filenames', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fake = makeFetch({
        '/__vpe/levels': () => jsonResponse([{
            id: 'My Level',
            file: 'My Level.vplevel',
            name: 'My Level',
        }]),
        '/levels/My%20Level.vplevel': () => new Response(bytes),
    })

    const buffer = await loadLevelBufferById('My-Level', fake.fetch)

    assert.deepEqual([...new Uint8Array(buffer)], [...bytes])
    assert.deepEqual(fake.calls, ['/__vpe/levels', '/levels/My%20Level.vplevel'])
})

test('loadLevelBufferById ignores the virtual demo entry and falls back to the canonical file url', async () => {
    const bytes = new Uint8Array([9, 8, 7])
    const fake = makeFetch({
        '/__vpe/levels': () => jsonResponse([]),
        '/levels/demo.vplevel': () => new Response(bytes),
    })

    const buffer = await loadLevelBufferById('demo', fake.fetch)

    assert.deepEqual([...new Uint8Array(buffer)], [...bytes])
    assert.deepEqual(fake.calls, ['/__vpe/levels', '/levels/demo.vplevel'])
})
