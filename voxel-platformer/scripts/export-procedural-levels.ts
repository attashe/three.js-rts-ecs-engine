import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createProceduralEditorLevel } from '../src/editor/procedural-level-export'
import {
    PROCEDURAL_LEVEL_DEFINITIONS,
    PROCEDURAL_LEVEL_SCRIPT_FILES,
    type ProceduralScriptSources,
} from '../src/game/procedural-levels'

const OUTPUT_DIR = resolve(process.cwd(), 'public', 'levels')

async function main(): Promise<void> {
    const scriptSources = await readScriptSources()
    let changed = 0

    for (const definition of PROCEDURAL_LEVEL_DEFINITIONS) {
        const level = createProceduralEditorLevel(definition.id, scriptSources)
        const outputPath = resolve(OUTPUT_DIR, level.file)
        const wrote = await writeIfChanged(outputPath, level.buffer)
        if (wrote) changed++
        console.log(`${wrote ? 'wrote' : 'current'} ${relativeOutput(outputPath)} (${level.name})`)
    }

    console.log(`procedural level export complete: ${changed} changed, ${PROCEDURAL_LEVEL_DEFINITIONS.length - changed} current`)
}

async function readScriptSources(): Promise<ProceduralScriptSources> {
    const out: ProceduralScriptSources = {}
    for (const file of PROCEDURAL_LEVEL_SCRIPT_FILES) {
        const path = resolve(process.cwd(), file.sourcePath)
        out[file.sourcePath] = await readFile(path, 'utf8')
    }
    return out
}

async function writeIfChanged(path: string, buffer: ArrayBuffer): Promise<boolean> {
    const next = Buffer.from(new Uint8Array(buffer))
    try {
        const previous = await readFile(path)
        if (Buffer.compare(previous, next) === 0) return false
    } catch {
        // Missing file, unreadable stale artifact, or new directory: write below.
    }

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, next)
    return true
}

function relativeOutput(path: string): string {
    return path.startsWith(process.cwd())
        ? path.slice(process.cwd().length + 1)
        : path
}

void main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err)
    process.exitCode = 1
})
