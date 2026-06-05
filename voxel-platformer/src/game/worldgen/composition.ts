import type { WorldgenReport } from './spec-types'
import { addWorldgenError } from './report'
import { isRecord } from './worldgen-util'

export function expandWorldSpecRefs(input: Record<string, unknown>, report: WorldgenReport): Record<string, unknown> {
    const defs = input.defs
    if (defs !== undefined && !isRecord(defs)) {
        addWorldgenError(report, {
            code: 'invalid_section',
            message: 'WorldSpec.defs must be an object when provided.',
            path: '$.defs',
            details: { value: defs },
        })
    }
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) {
        if (key === 'defs') continue
        if (key === 'world' || key === 'materials') out[key] = cloneRefDisallowed(value, `$.${key}`, report)
        else out[key] = expandValue(value, `$.${key}`, input, report, [])
    }
    return out
}

function expandValue(
    value: unknown,
    path: string,
    root: Record<string, unknown>,
    report: WorldgenReport,
    stack: string[],
): unknown {
    if (Array.isArray(value)) {
        return value.map((item, i) => expandValue(item, `${path}[${i}]`, root, report, stack))
    }
    if (!isRecord(value)) return value

    if ('$ref' in value) {
        const ref = value.$ref
        if (typeof ref !== 'string' || ref.trim().length === 0) {
            addWorldgenError(report, {
                code: 'invalid_ref',
                message: `${path}.$ref must be a non-empty local defs reference.`,
                path: `${path}.$ref`,
                details: { value: ref },
            })
            return expandObjectWithoutRef(value, path, root, report, stack)
        }
        const normalizedRef = ref.trim()
        if (stack.includes(normalizedRef)) {
            addWorldgenError(report, {
                code: 'ref_cycle',
                message: `${path}.$ref creates a composition cycle.`,
                path: `${path}.$ref`,
                details: { ref: normalizedRef, stack },
            })
            return expandObjectWithoutRef(value, path, root, report, stack)
        }
        const target = resolveDefRef(root, normalizedRef, path, report)
        if (target === undefined) return expandObjectWithoutRef(value, path, root, report, stack)
        if (!isRecord(target)) {
            addWorldgenError(report, {
                code: 'invalid_ref',
                message: `${path}.$ref must resolve to an object definition.`,
                path: `${path}.$ref`,
                details: { ref: normalizedRef, value: target },
            })
            return expandObjectWithoutRef(value, path, root, report, stack)
        }
        const expandedTarget = expandValue(target, defPathForRef(normalizedRef), root, report, [...stack, normalizedRef])
        const local = expandObjectWithoutRef(value, path, root, report, stack)
        return mergeRecords(isRecord(expandedTarget) ? expandedTarget : {}, local)
    }

    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = expandValue(item, `${path}.${key}`, root, report, stack)
    return out
}

function expandObjectWithoutRef(
    value: Record<string, unknown>,
    path: string,
    root: Record<string, unknown>,
    report: WorldgenReport,
    stack: string[],
): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
        if (key === '$ref') continue
        out[key] = expandValue(item, `${path}.${key}`, root, report, stack)
    }
    return out
}

function cloneRefDisallowed(value: unknown, path: string, report: WorldgenReport): unknown {
    if (Array.isArray(value)) return value.map((item, i) => cloneRefDisallowed(item, `${path}[${i}]`, report))
    if (!isRecord(value)) return value
    if ('$ref' in value) {
        addWorldgenError(report, {
            code: 'unsupported_ref',
            message: '$ref composition is not supported in world or materials sections.',
            path: `${path}.$ref`,
            details: { value: value.$ref },
        })
    }
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
        if (key === '$ref') continue
        out[key] = cloneRefDisallowed(item, `${path}.${key}`, report)
    }
    return out
}

function resolveDefRef(root: Record<string, unknown>, ref: string, path: string, report: WorldgenReport): unknown {
    if (!ref.startsWith('#/defs/')) {
        addWorldgenError(report, {
            code: 'invalid_ref',
            message: `${path}.$ref must point under #/defs/.`,
            path: `${path}.$ref`,
            details: { ref },
        })
        return undefined
    }
    const parts = ref.slice(2).split('/').map(decodePointerPart)
    let current: unknown = root
    for (const part of parts) {
        if (!isRecord(current) || !(part in current)) {
            addWorldgenError(report, {
                code: 'missing_reference',
                message: `${path}.$ref references missing definition "${ref}".`,
                path: `${path}.$ref`,
                details: { ref },
            })
            return undefined
        }
        current = current[part]
    }
    return current
}

function decodePointerPart(value: string): string {
    return value.replace(/~1/g, '/').replace(/~0/g, '~')
}

function defPathForRef(ref: string): string {
    return `$${ref.slice(1).replace(/\//g, '.')}`
}

function mergeRecords(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(base)) out[key] = clone(value)
    for (const [key, value] of Object.entries(override)) {
        const current = out[key]
        out[key] = isRecord(current) && isRecord(value)
            ? mergeRecords(current, value)
            : clone(value)
    }
    return out
}

function clone(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => clone(item))
    if (isRecord(value)) {
        const out: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(value)) out[key] = clone(item)
        return out
    }
    return value
}
