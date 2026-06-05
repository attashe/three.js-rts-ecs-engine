# Script Engine — Syntax Review & Proposals

A pass over the script-authoring syntax as it actually behaves (runtime +
bindings) versus as documented, done while building the
`voxel-script-authoring` skill. Each finding lists what's wrong, the root
cause, and the disposition (fixed now / proposed). The two fixed items
shipped with this review; the proposals are scoped but deferred.

Companion docs: `script-engine.md` (design + reference),
`script-engine-examples.md` (canonical examples), `types/script-api.d.ts`
(typed contract, authored as part of this review — it was promised by
§3.3 but did not previously exist).

---

## Findings

### F1 — `once: true` inside a filter object silently never fired  · FIXED

Every doc example wrote the one-shot form with `once` *inside* the filter:

```js
on('zone-enter', { zoneId: GROVE, once: true }, async () => { /* ... */ })
```

But the runtime (`runtime.ts → matchFilter`) compares **every** filter key
by strict equality against the event payload. Zone/pickup/input payloads
have no `once` field, so `event.once === true` was always false — the
filter never matched and **the handler never ran**. The one-shot examples
in `script-engine.md` §A.5 and `script-engine-examples.md` §1 (the
Whispering Grove "first-visit reveal") were dead code as written, and the
synthesis section formalised the broken pattern as a recommendation.

The signature in `types.ts` is correct — `on(event, filter, handler, opts?)`
with `opts.once` — so the *intended* call was `..., handler, { once: true }`.
The examples just put it in the wrong place, and nothing caught it because
a mismatched filter is indistinguishable from "the event hasn't happened
yet."

**Root cause:** `once` is a *registration* option (it disposes the sub
after the first firing), but it reads naturally co-located with the filter,
and the filter object is an untyped grab-bag with no reserved-key handling.

**Fix:** `bindings.ts` now lifts a boolean `once` out of the filter onto the
registration channel (`liftOnceFromFilter`). Both spellings are now
equivalent and correct; an explicit 4th-arg `opts.once` wins on conflict; a
filter containing only `once` collapses to match-all. `once` becomes a
reserved filter key (documented). Regression coverage:
`tests/script-once-filter.test.ts` (6 cases). The existing doc examples are
now correct as written, and §3.1 documents the equivalence.

### F2 — `zone-inside` was documented but never emitted  · FIXED (doc)

§3.1's event table listed `zone-inside` with a `{ zoneId, everyTicks? }`
filter. No producer ever pushes a `zone-inside` event — grepping the source
finds zero emit sites — so `on('zone-inside', ...)` could never fire. It was
a phantom API.

**Root cause — same as F1.** `everyTicks` is a per-subscription *throttle*,
not a data-match key. The strict-equality matcher can only carry data keys,
so `everyTicks` could never have worked as a filter even if a producer
existed: a single producer can't know each subscriber's throttle. The
feature was specced against a matcher that structurally can't express it.

**Fix:** removed `zone-inside` from §3.1 and added a note (in §3.1 and the
extending guide) that filters carry data-match keys only — throttles/options
live on registration. The `await wait(n)` + `zone.contains(...)` pattern
already covers "still inside N seconds later," as `script-engine-examples.md`
§1 itself argues. If a true periodic in-zone trigger is wanted later, see
P1.

### F3 — `travel.*` shipped undocumented  · FIXED (doc)

`travel.to(levelId, opts?)` / `travel.reload(opts?)` exist across
`types.ts`, `bindings.ts`, `compile.ts` (`PRELUDE_LOCALS`), and
`script-system.ts`, and are covered by `tests/script-bindings.test.ts` — but
the namespace was absent from `script-engine.md` §3.2's World API. An author
reading only the design doc wouldn't know level-to-level travel was
scriptable.

**Fix:** documented `travel.*` in §3.2 and in the skill's API cheat-sheet
and `script-api.d.ts`.

### F4 — `script-api.d.ts` was promised but missing  · FIXED (new file)

§3.3 described `voxel-platformer/types/script-api.d.ts` as "published
alongside the engine," the entire IDE-authoring story — but the file didn't
exist. Authors (and AI assistants) had no typed contract to check against,
which is part of why F1–F3 went unnoticed.

**Fix:** authored `types/script-api.d.ts` — self-contained ambient globals
for the whole surface, kept in sync with `types.ts` by hand (no codegen).
Validated by type-checking `examples/scripts/demo-quest.js` against it
(clean). Also caught a latent doc/impl drift: the §2.2 compile snippet's
destructure list omitted six bindings; updated to match `PRELUDE_LOCALS`.

---

## Proposals (deferred)

Scoped improvements that aren't bugs. None block current authoring.

### P1 — A real `zone-inside` periodic trigger (subscription-side throttle)

If per-tick / per-N-tick in-zone logic is wanted (HUD ticks, damage volumes,
proximity fades), implement it as registration state, not a filter:

```js
on('zone-inside', { zoneId: 'lava' }, h, { everyTicks: 6 })
```

The `zone-trigger-system` already tracks `activePlayers` per (zone, entity);
it would emit `zone-inside` each tick a tracked overlap persists, and the
*subscription* would carry the `everyTicks` divisor (a new `OnOptions`
field), throttling in `runtime.ts`. This is the correct home for the
throttle and avoids re-introducing F2's category error. Cost: a producer
change + runtime throttle + tests. Verdict: build only when a concrete level
needs it — `wait + contains` covers most cases.

### P2 — Dev-mode diagnostic for never-matching registrations

F1/F2's whole failure mode is "handler silently never fires." A
development-only check could warn when a script registers
`on('zone-enter', { zoneId: X })` for an `X` that doesn't exist in the level
(zone/pickup/piston id registries are all enumerable at compile time). Emit
a one-time `log(..., 'warn')` per unknown id at compile. Turns the silent
class of bug into a visible one in the Logic tab. Cost: small; needs the
registries threaded to the compile step. Verdict: high value-to-cost for
authoring ergonomics; good next pickup.

### P3 — Named-place registry: `level.coord('lantern.position')`

Already on the §11 roadmap. Scripts hard-code coordinates
(`{ x: 9, y: 5, z: 9 }`) that drift when a level is re-laid-out. A named
registry authored in the editor (`level.coord(id)` →  `VoxelCoord`) would
decouple scripts from absolute positions. Verdict: worthwhile once levels
churn; needs editor authoring UI.

### P4 — Reserved-key guard / typed filters

With `once` now reserved (F1), consider validating filter objects against
the known data keys for built-in events and warning on unknown keys (catches
`{ zoneID: ... }` casing typos, `{ once: 1 }` non-boolean, etc.). The
`script-api.d.ts` overloads already give this in-IDE for `.ts`/checked-`.js`
authors; P4 is the runtime backstop for pasted snippets. Verdict: pairs
naturally with P2.

---

## Summary

| ID | Issue | Status |
| -- | ----- | ------ |
| F1 | `once` in filter never fired | Fixed (engine + tests + docs) |
| F2 | `zone-inside` phantom event | Fixed (docs; root-caused) |
| F3 | `travel.*` undocumented | Fixed (docs + d.ts) |
| F4 | `script-api.d.ts` missing | Fixed (new file) |
| P1 | Real `zone-inside` throttle | Proposed |
| P2 | Unknown-id registration warning | Proposed |
| P3 | Named-place registry | Proposed (roadmap) |
| P4 | Filter reserved-key guard | Proposed |

The through-line in F1 and F2: **the filter object conflates data-match
keys with registration options.** Both were the same mistake surfacing
twice. The fix (lift `once`, document the constraint) plus P2/P4 (make
silent mismatches loud) close the category rather than the instances.
