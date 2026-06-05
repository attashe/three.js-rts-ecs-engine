import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { defineConfig, type Plugin } from 'vite'
import { basename, extname, join, resolve } from 'node:path'

const LEVELS_DIR = resolve(__dirname, 'public/levels')

// `--mode game` ships the public bundle: only the game page (index.html). The
// default build keeps every page (editor + demos) so dev/authoring tools still
// build. `__GAME_BUILD__` lets game code drop editor-only affordances.
export default defineConfig(({ mode }) => {
  const gameOnly = mode === 'game'
  const fullInput = {
    game: resolve(__dirname, 'index.html'),
    editor: resolve(__dirname, 'editor.html'),
    fxDemo: resolve(__dirname, 'fx-demo.html'),
    soundDemo: resolve(__dirname, 'sound-demo.html'),
    proceduralStructures: resolve(__dirname, 'procedural-structures.html'),
    backdropDemo: resolve(__dirname, 'backdrop-demo.html'),
    animation: resolve(__dirname, 'animation.html'),
  }
  return {
    root: '.',
    plugins: [levelLibraryPlugin()],
    define: {
      __GAME_BUILD__: JSON.stringify(gameOnly),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'esnext',
      rollupOptions: {
        input: gameOnly ? { game: resolve(__dirname, 'index.html') } : fullInput,
      },
    },
    server: {
      port: 8001,
      open: process.env.VISUAL_TEST ? false : '/index.html',
    },
    worker: {
      format: 'es',
    },
  }
})

function levelLibraryPlugin(): Plugin {
  return {
    name: 'voxel-platformer-level-library',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/__vpe/levels')) {
          next()
          return
        }

        try {
          if (req.method === 'GET' && url.pathname === '/__vpe/levels') {
            await sendJson(res, await scanLevelLibrary())
            return
          }
          if (req.method === 'POST' && url.pathname === '/__vpe/levels/save') {
            const name = url.searchParams.get('name') ?? 'untitled-level'
            const body = await readRequestBody(req)
            const entry = await saveLevelFile(name, body)
            await sendJson(res, entry)
            return
          }
          res.statusCode = 404
          res.end('Not found')
        } catch (err) {
          res.statusCode = 500
          res.end(err instanceof Error ? err.message : String(err))
        }
      })
    },
    async generateBundle() {
      const levels = await scanLevelLibrary()
      this.emitFile({
        type: 'asset',
        fileName: 'levels/manifest.json',
        source: JSON.stringify({ version: 1, levels }, null, 2),
      })
    },
  }
}

async function scanLevelLibrary() {
  await mkdir(LEVELS_DIR, { recursive: true })
  const files = await readdir(LEVELS_DIR)
  const levels = []
  for (const file of files) {
    if (extname(file).toLowerCase() !== '.vplevel') continue
    const path = join(LEVELS_DIR, file)
    const info = await stat(path)
    const id = basename(file, extname(file))
    levels.push({
      id,
      name: id,
      file,
      url: `/levels/${encodeURIComponent(file)}`,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
    })
  }
  levels.sort((a, b) => a.name.localeCompare(b.name))
  return levels
}

async function saveLevelFile(name: string, bytes: Uint8Array) {
  await mkdir(LEVELS_DIR, { recursive: true })
  const id = normalizeLevelId(name)
  const file = `${id}.vplevel`
  const path = join(LEVELS_DIR, file)
  await writeFile(path, bytes)
  const info = await stat(path)
  return {
    id,
    name: id,
    file,
    url: `/levels/${encodeURIComponent(file)}`,
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
  }
}

async function readRequestBody(req: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Uint8Array)
  }
  return Buffer.concat(chunks)
}

async function sendJson(res: NodeJS.WritableStream & { setHeader(name: string, value: string): void }, value: unknown): Promise<void> {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

function normalizeLevelId(input: string): string {
  const safe = input
    .trim()
    .replace(/\.vplevel$/i, '')
    .replace(/[/\\]+/g, '-')
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
  return safe || 'untitled-level'
}
