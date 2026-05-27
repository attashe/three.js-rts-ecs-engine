import {
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    CylinderGeometry,
    SphereGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { EditorPropKind } from './prop-types'

/**
 * Procedural geometry recipes for each prop kind. Each recipe builds a
 * tree of primitive geometries with per-part RGB colours baked in as
 * vertex attributes, then merges them into a single BufferGeometry.
 *
 * The result is module-cached: every InstancedMesh of a given kind
 * shares the same merged geometry, which means GPU upload happens
 * exactly once per kind for the lifetime of the page. The shared
 * MeshStandardMaterial (vertexColors=true) lives next to the cache so
 * the whole prop system shares a single material program key — adding
 * 100 InstancedMesh objects with the same material/geometry pair adds
 * 100 instance slots, not 100 shader pipelines.
 *
 * Author guidance for new kinds:
 *
 *   - Keep poly counts small. A flower at 200 verts is plenty for
 *     iso scale; pushing past 1k is wasteful since each instance
 *     replicates the whole mesh.
 *   - Use solid block-art palette colours via `paintVertexColor`.
 *     Avoid per-vertex gradients — the iso camera + tone-mapping
 *     smooth them away and you lose the detail you "paid" for.
 *   - The model's local origin (0, 0, 0) is the prop's BASE — the
 *     point that sits on the floor / supporting voxel. Render
 *     systems translate the instance by `position` directly, so a
 *     y-offset is the model's responsibility, not the renderer's.
 */

interface PropModel {
    geometry: BufferGeometry
}

const cache = new Map<EditorPropKind, PropModel>()

export function getPropModel(kind: EditorPropKind): PropModel {
    let model = cache.get(kind)
    if (!model) {
        model = { geometry: buildKind(kind) }
        cache.set(kind, model)
    }
    return model
}

/** Test/teardown helper — drop the cached geometries. */
export function disposePropModels(): void {
    for (const model of cache.values()) model.geometry.dispose()
    cache.clear()
}

function buildKind(kind: EditorPropKind): BufferGeometry {
    switch (kind) {
        case 'flower':    return buildFlower(1)
        case 'flower-2':  return buildFlower(2)
        case 'flower-3':  return buildFlower(3)
        case 'bush':      return buildBush(1)
        case 'bush-2':    return buildBush(2)
        case 'bush-3':    return buildBush(3)
        case 'mushroom':  return buildMushroom(1)
        case 'mushroom-2': return buildMushroom(2)
        case 'mushroom-3': return buildMushroom(3)
        case 'table':     return buildTable(1)
        case 'table-2':   return buildTable(2)
        case 'chair':     return buildChair(1)
        case 'chair-2':   return buildChair(2)
        case 'book':      return buildBook(1)
        case 'book-2':    return buildBook(2)
        case 'npc-keeper': return buildKeeperNpc()
        case 'sundial':   return buildSundial()
    }
}

// ────────────────────────────────────────────────────────────────────
// Per-kind recipes. Each returns a merged BufferGeometry with `color`
// attribute populated. Local-space origin = the prop's foot/base.
// ────────────────────────────────────────────────────────────────────

function buildFlower(variant: 1 | 2 | 3): BufferGeometry {
    // Slim stem + bulb-shaped bud. Pink petals on green stem reads as
    // "flower" at iso scale; we trade fidelity for shader cost.
    const stemHeight = variant === 2 ? 0.38 : variant === 3 ? 0.28 : 0.32
    const stem = new CylinderGeometry(0.018, 0.022, stemHeight, 6)
    stem.translate(0, stemHeight * 0.5, 0)
    paintVertexColor(stem, 0.32, 0.55, 0.26)

    const bud = new SphereGeometry(variant === 2 ? 0.078 : 0.085, 8, 6)
    bud.translate(0, stemHeight + 0.035, 0)
    if (variant === 1) paintVertexColor(bud, 0.95, 0.52, 0.68)
    else if (variant === 2) paintVertexColor(bud, 0.96, 0.83, 0.28)
    else paintVertexColor(bud, 0.42, 0.56, 0.95)

    // Two leaves — flat-ish thin boxes angled out from the stem.
    const leafA = new BoxGeometry(0.12, 0.012, 0.05)
    leafA.translate(0.07, 0.14, 0)
    leafA.rotateZ(0.4)
    paintVertexColor(leafA, 0.32, 0.55, 0.26)
    const leafB = new BoxGeometry(0.12, 0.012, 0.05)
    leafB.translate(-0.07, 0.18, 0)
    leafB.rotateZ(-0.4)
    paintVertexColor(leafB, 0.32, 0.55, 0.26)

    const parts: BufferGeometry[] = [stem, bud, leafA, leafB]
    if (variant === 2) {
        for (const [x, z] of [[0.07, 0], [-0.07, 0], [0, 0.07], [0, -0.07]] as const) {
            const petal = new SphereGeometry(0.035, 6, 4)
            petal.scale(1.35, 0.45, 0.85)
            petal.translate(x, stemHeight + 0.04, z)
            paintVertexColor(petal, 1.0, 0.92, 0.48)
            parts.push(petal)
        }
    } else if (variant === 3) {
        const secondBud = new SphereGeometry(0.06, 7, 5)
        secondBud.translate(0.11, stemHeight * 0.9, 0.02)
        paintVertexColor(secondBud, 0.58, 0.68, 1.0)
        const secondStem = new CylinderGeometry(0.014, 0.018, stemHeight * 0.72, 6)
        secondStem.rotateZ(-0.28)
        secondStem.translate(0.065, stemHeight * 0.42, 0.02)
        paintVertexColor(secondStem, 0.30, 0.50, 0.24)
        parts.push(secondStem, secondBud)
    }

    return mergeAndCleanup(parts)
}

function buildBush(variant: 1 | 2 | 3): BufferGeometry {
    // Overlapping low-poly lobes keep the silhouette organic while
    // preserving one merged geometry per variant.
    const specs = variant === 1
        ? [
            [0.22, 0, 0.18, 0, 0.22, 0.42, 0.20],
            [0.18, 0.16, 0.22, 0.08, 0.24, 0.44, 0.21],
            [0.17, -0.13, 0.20, -0.06, 0.20, 0.39, 0.18],
        ]
        : variant === 2
            ? [
                [0.18, -0.18, 0.15, 0.04, 0.30, 0.50, 0.24],
                [0.24, 0.00, 0.21, 0.00, 0.25, 0.46, 0.22],
                [0.19, 0.19, 0.17, -0.05, 0.20, 0.39, 0.19],
                [0.15, 0.05, 0.29, 0.12, 0.34, 0.55, 0.26],
            ]
            : [
                [0.18, -0.14, 0.20, -0.10, 0.18, 0.33, 0.18],
                [0.19, 0.13, 0.19, 0.09, 0.20, 0.36, 0.19],
                [0.16, -0.02, 0.33, 0.00, 0.25, 0.43, 0.22],
                [0.13, 0.03, 0.43, -0.06, 0.30, 0.50, 0.25],
            ]

    const parts: BufferGeometry[] = specs.map(([radius, x, y, z, r, g, b]) => {
        const lobe = new SphereGeometry(radius, 8, 6)
        lobe.translate(x, y, z)
        paintVertexColor(lobe, r, g, b)
        return lobe
    })
    if (variant === 3) {
        const trunk = new CylinderGeometry(0.055, 0.075, 0.28, 6)
        trunk.translate(0, 0.14, 0)
        paintVertexColor(trunk, 0.24, 0.15, 0.08)
        parts.unshift(trunk)
    }

    return mergeAndCleanup(parts)
}

function buildMushroom(variant: 1 | 2 | 3): BufferGeometry {
    // Fixed from the first pass: caps are actual half-domes with a
    // small underside disk, not full spheres scaled after translation.
    if (variant === 1) {
        return mergeAndCleanup(mushroomParts({
            x: 0, z: 0,
            stemHeight: 0.21,
            stemRadius: 0.05,
            capRadius: 0.15,
            capSquash: 0.72,
            capColor: [0.82, 0.16, 0.16],
            spotted: true,
        }))
    }
    if (variant === 2) {
        return mergeAndCleanup(mushroomParts({
            x: 0, z: 0,
            stemHeight: 0.18,
            stemRadius: 0.06,
            capRadius: 0.19,
            capSquash: 0.42,
            capColor: [0.62, 0.38, 0.18],
            spotted: false,
        }))
    }
    return mergeAndCleanup([
        ...mushroomParts({
            x: -0.09, z: 0.02,
            stemHeight: 0.18,
            stemRadius: 0.038,
            capRadius: 0.11,
            capSquash: 0.65,
            capColor: [0.78, 0.18, 0.20],
            spotted: true,
        }),
        ...mushroomParts({
            x: 0.08, z: -0.04,
            stemHeight: 0.14,
            stemRadius: 0.032,
            capRadius: 0.09,
            capSquash: 0.62,
            capColor: [0.92, 0.52, 0.22],
            spotted: false,
        }),
        ...mushroomParts({
            x: 0.03, z: 0.10,
            stemHeight: 0.12,
            stemRadius: 0.028,
            capRadius: 0.075,
            capSquash: 0.60,
            capColor: [0.54, 0.28, 0.16],
            spotted: false,
        }),
    ])
}

function buildTable(variant: 1 | 2): BufferGeometry {
    if (variant === 2) {
        const height = 0.48
        const top = new CylinderGeometry(0.34, 0.34, 0.055, 12)
        top.translate(0, height, 0)
        paintVertexColor(top, 0.50, 0.30, 0.16)

        const pedestal = new CylinderGeometry(0.055, 0.07, height, 8)
        pedestal.translate(0, height * 0.5, 0)
        paintVertexColor(pedestal, 0.36, 0.21, 0.10)

        const foot = new CylinderGeometry(0.18, 0.22, 0.035, 8)
        foot.translate(0, 0.018, 0)
        paintVertexColor(foot, 0.30, 0.17, 0.08)
        return mergeAndCleanup([top, pedestal, foot])
    }
    // Top + 4 legs. Iso top-down view sees mostly the top, so the
    // legs can be chunky boxes without looking off.
    const tableHeight = 0.5
    const tableWidth = 0.7
    const tableDepth = 0.45
    const top = new BoxGeometry(tableWidth, 0.05, tableDepth)
    top.translate(0, tableHeight, 0)
    paintVertexColor(top, 0.54, 0.34, 0.18)

    const legGeo = (): BoxGeometry => new BoxGeometry(0.06, tableHeight, 0.06)
    const legX = tableWidth / 2 - 0.05
    const legZ = tableDepth / 2 - 0.05
    const positions: [number, number, number][] = [
        [ legX, tableHeight / 2,  legZ],
        [-legX, tableHeight / 2,  legZ],
        [ legX, tableHeight / 2, -legZ],
        [-legX, tableHeight / 2, -legZ],
    ]
    const legs = positions.map(([x, y, z]) => {
        const leg = legGeo()
        leg.translate(x, y, z)
        paintVertexColor(leg, 0.40, 0.24, 0.12)
        return leg
    })

    return mergeAndCleanup([top, ...legs])
}

function buildChair(variant: 1 | 2): BufferGeometry {
    if (variant === 2) {
        const seatHeight = 0.36
        const seat = new BoxGeometry(0.52, 0.055, 0.42)
        seat.translate(0, seatHeight, 0)
        paintVertexColor(seat, 0.52, 0.31, 0.17)

        const back = new BoxGeometry(0.52, 0.38, 0.045)
        back.translate(0, seatHeight + 0.21, -0.19)
        paintVertexColor(back, 0.43, 0.25, 0.13)

        const armA = new BoxGeometry(0.055, 0.15, 0.38)
        armA.translate(0.29, seatHeight + 0.07, 0.02)
        paintVertexColor(armA, 0.40, 0.23, 0.12)
        const armB = armA.clone()
        armB.translate(-0.58, 0, 0)
        paintVertexColor(armB, 0.40, 0.23, 0.12)

        const legGeo = (): BoxGeometry => new BoxGeometry(0.055, seatHeight, 0.055)
        const legs = [[0.21, 0.16], [-0.21, 0.16], [0.21, -0.14], [-0.21, -0.14]].map(([x, z]) => {
            const leg = legGeo()
            leg.translate(x, seatHeight * 0.5, z)
            paintVertexColor(leg, 0.32, 0.18, 0.09)
            return leg
        })
        return mergeAndCleanup([seat, back, armA, armB, ...legs])
    }

    const seatHeight = 0.42
    const seatWidth = 0.42
    const seatDepth = 0.42
    const seat = new BoxGeometry(seatWidth, 0.05, seatDepth)
    seat.translate(0, seatHeight, 0)
    paintVertexColor(seat, 0.48, 0.30, 0.16)

    const backHeight = 0.46
    const back = new BoxGeometry(seatWidth, backHeight, 0.04)
    back.translate(0, seatHeight + backHeight / 2, -seatDepth / 2 + 0.02)
    paintVertexColor(back, 0.42, 0.26, 0.14)

    const legGeo = (): BoxGeometry => new BoxGeometry(0.05, seatHeight, 0.05)
    const legX = seatWidth / 2 - 0.04
    const legZ = seatDepth / 2 - 0.04
    const positions: [number, number, number][] = [
        [ legX, seatHeight / 2,  legZ],
        [-legX, seatHeight / 2,  legZ],
        [ legX, seatHeight / 2, -legZ],
        [-legX, seatHeight / 2, -legZ],
    ]
    const legs = positions.map(([x, y, z]) => {
        const leg = legGeo()
        leg.translate(x, y, z)
        paintVertexColor(leg, 0.36, 0.22, 0.10)
        return leg
    })

    return mergeAndCleanup([seat, back, ...legs])
}

function buildBook(variant: 1 | 2): BufferGeometry {
    if (variant === 2) {
        const leftPage = new BoxGeometry(0.16, 0.028, 0.25)
        leftPage.translate(-0.085, 0.025, 0)
        paintVertexColor(leftPage, 0.95, 0.91, 0.78)
        const rightPage = new BoxGeometry(0.16, 0.028, 0.25)
        rightPage.translate(0.085, 0.025, 0)
        paintVertexColor(rightPage, 0.92, 0.87, 0.74)
        const spine = new BoxGeometry(0.032, 0.032, 0.26)
        spine.translate(0, 0.018, 0)
        paintVertexColor(spine, 0.28, 0.15, 0.36)
        const cover = new BoxGeometry(0.36, 0.018, 0.28)
        cover.translate(0, 0.009, 0)
        paintVertexColor(cover, 0.16, 0.22, 0.50)
        return mergeAndCleanup([cover, leftPage, rightPage, spine])
    }

    // Closed book lying on its back cover — a slim box with a
    // contrasting "spine" strip down one long side.
    const cover = new BoxGeometry(0.20, 0.045, 0.26)
    cover.translate(0, 0.022, 0)
    paintVertexColor(cover, 0.18, 0.32, 0.66)

    const spine = new BoxGeometry(0.012, 0.04, 0.26)
    spine.translate(-0.094, 0.024, 0)
    paintVertexColor(spine, 0.10, 0.20, 0.50)

    // Pages: a slightly inset thin slab of cream colour at the top
    // edge — readable from an iso angle as "this is a book, not a
    // tile of stone".
    const pages = new BoxGeometry(0.184, 0.032, 0.244)
    pages.translate(0.002, 0.022, 0)
    paintVertexColor(pages, 0.94, 0.90, 0.80)

    return mergeAndCleanup([pages, cover, spine])
}

function buildKeeperNpc(): BufferGeometry {
    const parts: BufferGeometry[] = []

    const robe = new CylinderGeometry(0.23, 0.31, 0.76, 8)
    robe.translate(0, 0.38, 0)
    paintVertexColor(robe, 0.18, 0.23, 0.32)
    parts.push(robe)

    const shoulderWrap = new CylinderGeometry(0.25, 0.23, 0.12, 8)
    shoulderWrap.translate(0, 0.74, 0)
    paintVertexColor(shoulderWrap, 0.33, 0.20, 0.12)
    parts.push(shoulderWrap)

    const hood = new SphereGeometry(0.22, 10, 8)
    hood.scale(1.0, 1.08, 0.94)
    hood.translate(0, 0.93, 0)
    paintVertexColor(hood, 0.16, 0.18, 0.25)
    parts.push(hood)

    const face = new BoxGeometry(0.13, 0.12, 0.045)
    face.translate(0.18, 0.90, 0)
    paintVertexColor(face, 0.78, 0.58, 0.40)
    parts.push(face)

    const sash = new BoxGeometry(0.08, 0.56, 0.035)
    sash.rotateZ(-0.38)
    sash.translate(0.02, 0.47, -0.24)
    paintVertexColor(sash, 0.70, 0.46, 0.18)
    parts.push(sash)

    const staff = new CylinderGeometry(0.018, 0.023, 0.92, 6)
    staff.translate(0.33, 0.46, 0.18)
    paintVertexColor(staff, 0.30, 0.18, 0.08)
    parts.push(staff)

    const lanternFrame = new BoxGeometry(0.13, 0.17, 0.13)
    lanternFrame.translate(0.33, 0.36, 0.18)
    paintVertexColor(lanternFrame, 0.12, 0.10, 0.07)
    parts.push(lanternFrame)

    const lanternGlow = new SphereGeometry(0.075, 8, 6)
    lanternGlow.scale(0.78, 0.92, 0.78)
    lanternGlow.translate(0.33, 0.36, 0.18)
    paintVertexColor(lanternGlow, 1.0, 0.70, 0.28)
    parts.push(lanternGlow)

    const footA = new BoxGeometry(0.12, 0.06, 0.16)
    footA.translate(0.08, 0.03, 0.10)
    paintVertexColor(footA, 0.10, 0.08, 0.06)
    const footB = footA.clone()
    footB.translate(-0.16, 0, -0.20)
    paintVertexColor(footB, 0.10, 0.08, 0.06)
    parts.push(footA, footB)

    return mergeAndCleanup(parts)
}

function mushroomParts(spec: {
    x: number
    z: number
    stemHeight: number
    stemRadius: number
    capRadius: number
    capSquash: number
    capColor: [number, number, number]
    spotted: boolean
}): BufferGeometry[] {
    const stem = new CylinderGeometry(spec.stemRadius * 0.8, spec.stemRadius, spec.stemHeight, 8)
    stem.translate(spec.x, spec.stemHeight * 0.5, spec.z)
    paintVertexColor(stem, 0.92, 0.87, 0.74)

    const capBaseY = spec.stemHeight * 0.88
    const underside = new CylinderGeometry(spec.capRadius * 0.82, spec.capRadius * 0.95, 0.018, 12)
    underside.translate(spec.x, capBaseY, spec.z)
    paintVertexColor(underside, 0.84, 0.78, 0.62)

    const cap = new SphereGeometry(spec.capRadius, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    cap.scale(1, spec.capSquash, 1)
    cap.translate(spec.x, capBaseY, spec.z)
    paintVertexColor(cap, spec.capColor[0], spec.capColor[1], spec.capColor[2])

    const parts: BufferGeometry[] = [stem, underside, cap]
    if (spec.spotted) {
        const dotColor: [number, number, number] = [0.94, 0.91, 0.82]
        const dotSpecs = [
            [0.34, 0.18, 0.62],
            [-0.26, -0.22, 0.72],
            [0.05, -0.34, 0.80],
        ] as const
        for (const [dx, dz, yMul] of dotSpecs) {
            const dot = new SphereGeometry(spec.capRadius * 0.115, 5, 4)
            dot.translate(
                spec.x + dx * spec.capRadius,
                capBaseY + spec.capRadius * spec.capSquash * yMul,
                spec.z + dz * spec.capRadius,
            )
            paintVertexColor(dot, dotColor[0], dotColor[1], dotColor[2])
            parts.push(dot)
        }
    }
    return parts
}

function buildSundial(): BufferGeometry {
    // Stone column + golden dial face + gnomon blade. The
    // Lantern Trial uses this as its talking interactable.
    const parts: BufferGeometry[] = []

    const pedestal = new CylinderGeometry(0.16, 0.20, 0.30, 12)
    pedestal.translate(0, 0.15, 0)
    paintVertexColor(pedestal, 0.46, 0.42, 0.36)
    parts.push(pedestal)

    const collar = new CylinderGeometry(0.21, 0.21, 0.04, 12)
    collar.translate(0, 0.32, 0)
    paintVertexColor(collar, 0.34, 0.30, 0.24)
    parts.push(collar)

    const dial = new CylinderGeometry(0.32, 0.32, 0.05, 24)
    dial.translate(0, 0.36, 0)
    paintVertexColor(dial, 0.86, 0.72, 0.36)
    parts.push(dial)

    // Hour marks — four short blocks at cardinal positions on the
    // dial face. Subtle visual detail; reads as "this is a timepiece"
    // even at iso scale.
    const markPositions: [number, number][] = [
        [0.26, 0], [-0.26, 0], [0, 0.26], [0, -0.26],
    ]
    for (const [mx, mz] of markPositions) {
        const mark = new BoxGeometry(0.04, 0.012, 0.04)
        mark.translate(mx, 0.39, mz)
        paintVertexColor(mark, 0.42, 0.34, 0.16)
        parts.push(mark)
    }

    // Gnomon — a thin triangular blade approximated by a tall box
    // rotated slightly so it casts a believable shadow line. The
    // tilt sells "the sundial knows the hour".
    const gnomon = new BoxGeometry(0.025, 0.30, 0.20)
    gnomon.translate(0, 0.52, 0)
    gnomon.rotateX(-0.42) // ~24° tilt north — visible from iso view
    paintVertexColor(gnomon, 0.95, 0.84, 0.46)
    parts.push(gnomon)

    return mergeAndCleanup(parts)
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function paintVertexColor(geo: BufferGeometry, r: number, g: number, b: number): void {
    const pos = geo.attributes.position
    if (!pos) return
    const colors = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
        colors[i * 3]     = r
        colors[i * 3 + 1] = g
        colors[i * 3 + 2] = b
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3))
}

/** Merge inputs into one BufferGeometry. Disposes each source on the
 *  way through so the cache only retains the merged result. The
 *  `mergeGeometries` helper preserves the `color` attribute as long
 *  as every input has it set (which the recipes above guarantee). */
function mergeAndCleanup(geometries: BufferGeometry[]): BufferGeometry {
    const merged = mergeGeometries(geometries, false)
    if (!merged) {
        throw new Error('Prop geometry merge failed — inputs likely have mismatched attribute sets')
    }
    for (const geo of geometries) geo.dispose()
    merged.computeBoundingSphere()
    merged.computeBoundingBox()
    return merged
}
