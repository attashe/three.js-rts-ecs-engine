import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { compileWorldSpecToEditorLevel } from '../src/editor/worldgen-level-export'
import {
    addWorldgenError,
    createWorldgenReport,
    finalizeWorldgenReport,
    hashHex,
    type WorldgenReport,
} from '../src/game/worldgen'
import { relativeOutput, writeIfChanged } from './file-output'

interface CliOptions {
    specPath: string
    outPath?: string
    reportPath?: string
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2))
    if (!opts) return
    const source = await readFile(opts.specPath, 'utf8')
    const parsed = parseSpecJson(source, opts.specPath)

    if (!parsed.ok) {
        const reportPath = resolve(process.cwd(), opts.reportPath ?? '.tmp/worldgen/invalid-world-spec.report.json')
        await writeReport(reportPath, parsed.report)
        printReportDiagnostics(parsed.report)
        console.error(`worldgen compile failed; wrote ${relativeOutput(reportPath)}`)
        process.exitCode = 1
        return
    }

    const compiled = compileWorldSpecToEditorLevel(parsed.spec)
    const outputId = safeOutputId(compiled.report.specId ?? rawWorldId(parsed.spec) ?? 'worldgen-spec')
    const reportPath = resolve(process.cwd(), opts.reportPath ?? `.tmp/worldgen/${outputId}.report.json`)
    await writeReport(reportPath, compiled.report)

    if (compiled.report.status === 'failed' || !compiled.buffer) {
        printReportDiagnostics(compiled.report)
        console.error(`worldgen compile failed; wrote ${relativeOutput(reportPath)}`)
        process.exitCode = 1
        return
    }

    const outPath = resolve(process.cwd(), opts.outPath ?? `public/levels/${outputId}.vplevel`)
    const wroteLevel = await writeIfChanged(outPath, compiled.buffer)
    console.log(`${wroteLevel ? 'wrote' : 'current'} ${relativeOutput(outPath)} (${compiled.runtimeMeta.name})`)
    console.log(`wrote ${relativeOutput(reportPath)} (${compiled.report.status})`)
}

function parseArgs(argv: readonly string[]): CliOptions | null {
    let specPath = ''
    let outPath: string | undefined
    let reportPath: string | undefined
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i]!
        if (arg === '--out') {
            outPath = requiredValue(argv, i, arg)
            i += 1
        } else if (arg === '--report') {
            reportPath = requiredValue(argv, i, arg)
            i += 1
        } else if (arg === '--help' || arg === '-h') {
            printUsage()
            return null
        } else if (arg.startsWith('--')) {
            throw new CliUsageError(`Unknown option "${arg}".`)
        } else if (!specPath) {
            specPath = arg
        } else {
            throw new CliUsageError(`Unexpected argument "${arg}".`)
        }
    }
    if (!specPath) {
        printUsage()
        throw new CliUsageError('Missing spec JSON path.')
    }
    return { specPath: resolve(process.cwd(), specPath), outPath, reportPath }
}

function requiredValue(argv: readonly string[], index: number, option: string): string {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new CliUsageError(`${option} requires a value.`)
    return value
}

function parseSpecJson(source: string, specPath: string): { ok: true; spec: unknown } | { ok: false; report: WorldgenReport } {
    try {
        return { ok: true, spec: JSON.parse(source) as unknown }
    } catch (err) {
        const report = createWorldgenReport('invalid-world-spec', hashHex({ specPath, source }))
        addWorldgenError(report, {
            code: 'invalid_spec',
            message: err instanceof Error ? err.message : String(err),
            path: '$',
            details: { specPath },
        })
        finalizeWorldgenReport(report)
        return { ok: false, report }
    }
}

async function writeReport(path: string, report: WorldgenReport): Promise<void> {
    await writeIfChanged(path, `${JSON.stringify(report, null, 2)}\n`)
}

function printReportDiagnostics(report: WorldgenReport): void {
    const diagnostics = [...report.errors, ...report.warnings]
    for (const entry of diagnostics.slice(0, 8)) {
        const path = entry.path ? ` ${entry.path}` : ''
        console.error(`- ${entry.code}${path}: ${entry.message}`)
    }
    if (diagnostics.length > 8) {
        console.error(`- ... ${diagnostics.length - 8} more diagnostics in the report`)
    }
}

function safeOutputId(value: string): string {
    const safe = value
        .trim()
        .replace(/\.vplevel$/i, '')
        .replace(/[/\\]+/g, '-')
        .replace(/[^a-zA-Z0-9._ -]+/g, '')
        .trim()
        .replace(/\s+/g, '-')
    return safe || 'worldgen-spec'
}

function rawWorldId(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return undefined
    const world = (value as Record<string, unknown>).world
    if (!world || typeof world !== 'object') return undefined
    const id = (world as Record<string, unknown>).id
    return typeof id === 'string' ? id : undefined
}

function printUsage(): void {
    console.log('Usage: npm run worldgen:compile -- <spec.json> [--out <file.vplevel>] [--report <report.json>]')
}

class CliUsageError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'CliUsageError'
    }
}

void main().catch((err) => {
    if (err instanceof CliUsageError) {
        console.error(err.message)
        process.exitCode = 1
        return
    }
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exitCode = 1
})
