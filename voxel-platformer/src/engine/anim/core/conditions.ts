// Pure condition evaluation against a numeric param bag.
import type { Condition } from './state-graph'

/** Named numeric inputs the state machine evaluates conditions against.
 *  Booleans are encoded as 0/1 by the signal layer (see signals.ts). */
export type AnimParamBag = Record<string, number>

export function evalCondition(c: Condition, params: AnimParamBag): boolean {
    const left = params[c.param] ?? 0
    switch (c.op) {
        case '<': return left < c.value
        case '<=': return left <= c.value
        case '>': return left > c.value
        case '>=': return left >= c.value
        case '==': return left === c.value
        case '!=': return left !== c.value
        default: return false
    }
}

/** ANDs every condition. Empty/undefined => satisfied (exit-time transition). */
export function evalConditions(conds: Condition[] | undefined, params: AnimParamBag): boolean {
    if (!conds || conds.length === 0) return true
    for (const c of conds) {
        if (!evalCondition(c, params)) return false
    }
    return true
}
