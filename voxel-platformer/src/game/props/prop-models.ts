import {
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    ConeGeometry,
    CylinderGeometry,
    SphereGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { EditorPropKind } from './prop-types'

export const LIFT_CABIN_REPAIRED_INTERIOR_CLEARANCE = 1.68

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
        case 'haste-shrine': return buildHasteShrine()
        case 'portal-shrine': return buildPortalShrine()
        case 'road-sign': return buildRoadSign()
        case 'high-jump-boots': return buildHighJumpBoots()
        case 'lift-cabin-broken': return buildLiftCabin('broken')
        case 'lift-cabin-repaired': return buildLiftCabin('repaired')
        case 'lift-control-lever': return buildLiftControlLever()
        case 'market-meat': return buildMarketMeat()
        case 'market-apples': return buildMarketApples()
        case 'market-fish': return buildMarketFish()
        case 'spear-rack': return buildSpearRack()
        case 'arrow-barrel': return buildArrowBarrel()
        case 'helmet-stand': return buildHelmetStand()
        case 'hat-display': return buildHatDisplay()
        case 'boot-rack': return buildBootRack()
        case 'potion-shelf': return buildPotionShelf()
        case 'alchemy-cauldron': return buildAlchemyCauldron()
        case 'broken-wagon': return buildBrokenWagon()
        case 'fallen-driver': return buildFallenDriver()
        case 'repair-materials-crate': return buildRepairMaterialsCrate()
        case 'ore-pile': return buildOrePile()
        case 'ore-crate': return buildOreCrate()
        case 'mine-tool-rack': return buildMineToolRack()
        case 'broken-rail-cart': return buildBrokenRailCart()
        case 'support-debris': return buildSupportDebris()
        case 'notice-board': return buildNoticeBoard()
        case 'vent-fan': return buildVentFan()
        case 'abandoned-lamp-cluster': return buildAbandonedLampCluster()
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

function buildHighJumpBoots(): BufferGeometry {
    const parts: BufferGeometry[] = []
    for (const [x, yaw] of [[-0.12, -0.08], [0.12, 0.08]] as const) {
        const sole = new BoxGeometry(0.18, 0.055, 0.32)
        sole.rotateY(yaw)
        sole.translate(x, 0.04, 0.02)
        paintVertexColor(sole, 0.08, 0.09, 0.13)

        const upper = new BoxGeometry(0.15, 0.20, 0.20)
        upper.rotateY(yaw)
        upper.translate(x, 0.16, -0.03)
        paintVertexColor(upper, 0.17, 0.14, 0.19)

        const toe = new BoxGeometry(0.17, 0.085, 0.15)
        toe.rotateY(yaw)
        toe.translate(x, 0.09, 0.13)
        paintVertexColor(toe, 0.17, 0.14, 0.19)

        const spring = new CylinderGeometry(0.022, 0.022, 0.22, 8)
        spring.rotateX(Math.PI * 0.5)
        spring.rotateY(yaw)
        spring.translate(x, 0.12, -0.16)
        paintVertexColor(spring, 0.82, 0.65, 0.29)

        const gem = new SphereGeometry(0.035, 8, 6)
        gem.translate(x, 0.18, 0.12)
        paintVertexColor(gem, 0.40, 0.84, 1.0)

        parts.push(sole, upper, toe, spring, gem)
    }
    return mergeAndCleanup(parts)
}

function buildLiftCabin(state: 'broken' | 'repaired'): BufferGeometry {
    const parts: BufferGeometry[] = []
    const wood: [number, number, number] = state === 'repaired' ? [0.50, 0.31, 0.16] : [0.36, 0.24, 0.14]
    const darkWood: [number, number, number] = state === 'repaired' ? [0.30, 0.18, 0.09] : [0.20, 0.13, 0.08]
    const rope: [number, number, number] = [0.58, 0.45, 0.25]
    const metal: [number, number, number] = [0.34, 0.34, 0.36]
    const floorCenterY = 0.035
    const floorThickness = 0.065
    const floorTopY = floorCenterY + floorThickness * 0.5

    const addBox = (
        size: [number, number, number],
        pos: [number, number, number],
        color: [number, number, number],
        rot: [number, number, number] = [0, 0, 0],
    ): void => {
        const box = new BoxGeometry(size[0], size[1], size[2])
        if (rot[0]) box.rotateX(rot[0])
        if (rot[1]) box.rotateY(rot[1])
        if (rot[2]) box.rotateZ(rot[2])
        box.translate(pos[0], pos[1], pos[2])
        paintVertexColor(box, color[0], color[1], color[2])
        parts.push(box)
    }

    // Floor planks. Broken variant keeps the same footprint but staggers
    // planks so the state reads clearly even at the demo camera distance.
    for (let i = 0; i < 4; i++) {
        const z = -0.36 + i * 0.24
        const lift = state === 'broken' && i % 2 === 1 ? 0.025 : 0
        const yaw = state === 'broken' ? (i - 1.5) * 0.08 : 0
        addBox([1.08, floorThickness, 0.18], [0, floorCenterY + lift, z], i % 2 === 0 ? wood : darkWood, [0, yaw, 0])
    }

    if (state === 'repaired') {
        const roofThickness = 0.08
        const roofCenterY = floorTopY + LIFT_CABIN_REPAIRED_INTERIOR_CLEARANCE + roofThickness * 0.5
        const postBottomY = 0.10
        const postHeight = roofCenterY + roofThickness * 0.5 - postBottomY
        const postCenterY = postBottomY + postHeight * 0.5
        const upperRailY = floorTopY + 0.86
        const roofTrimY = roofCenterY + 0.09
        const cableHeight = 1.16
        const cableCenterY = roofTrimY + cableHeight * 0.5

        addBox([1.18, 0.08, 0.10], [0, 0.15, -0.58], darkWood)
        addBox([1.18, 0.08, 0.10], [0, 0.15, 0.58], darkWood)
        addBox([0.10, 0.08, 1.18], [-0.58, 0.15, 0], darkWood)
        addBox([0.10, 0.08, 1.18], [0.58, 0.15, 0], darkWood)

        for (const x of [-0.48, 0.48]) {
            for (const z of [-0.48, 0.48]) addBox([0.09, postHeight, 0.09], [x, postCenterY, z], darkWood)
        }
        addBox([1.18, 0.07, 0.08], [0, upperRailY, -0.52], wood)
        addBox([1.18, 0.07, 0.08], [0, upperRailY, 0.52], wood)
        addBox([0.08, 0.07, 1.18], [-0.52, upperRailY, 0], wood)
        addBox([0.08, 0.07, 1.18], [0.52, upperRailY, 0], wood)
        addBox([1.22, roofThickness, 1.00], [0, roofCenterY, 0], [0.42, 0.24, 0.12])
        addBox([1.30, 0.075, 0.12], [0, roofTrimY, 0], [0.62, 0.45, 0.20], [0, 0, 0.12])
        addBox([0.06, cableHeight, 0.06], [0, cableCenterY, 0], rope)
    } else {
        addBox([0.10, 0.58, 0.10], [-0.48, 0.30, -0.48], darkWood, [0, 0, -0.28])
        addBox([0.10, 0.42, 0.10], [0.50, 0.24, -0.46], darkWood, [0.18, 0, 0.20])
        addBox([0.09, 0.34, 0.09], [-0.50, 0.19, 0.46], darkWood, [0, 0, 0.40])
        addBox([0.90, 0.07, 0.10], [0.05, 0.48, -0.52], wood, [0, 0.18, -0.20])
        addBox([0.08, 0.07, 0.92], [0.54, 0.40, 0.02], wood, [0.20, 0, 0.12])
        addBox([0.92, 0.08, 0.46], [-0.16, 0.28, 0.34], [0.25, 0.15, 0.08], [0.10, -0.28, 0.44])
        addBox([0.05, 0.54, 0.05], [0.17, 0.47, 0.18], rope, [0.52, 0.18, -0.20])
    }

    const wheel = new CylinderGeometry(0.18, 0.18, 0.055, 12)
    wheel.rotateZ(Math.PI * 0.5)
    wheel.translate(state === 'repaired' ? 0.66 : 0.45, state === 'repaired' ? 1.30 : 0.20, state === 'repaired' ? -0.30 : 0.46)
    paintVertexColor(wheel, metal[0], metal[1], metal[2])
    parts.push(wheel)

    const hub = new CylinderGeometry(0.055, 0.055, 0.075, 8)
    hub.rotateZ(Math.PI * 0.5)
    hub.translate(state === 'repaired' ? 0.69 : 0.48, state === 'repaired' ? 1.30 : 0.20, state === 'repaired' ? -0.30 : 0.46)
    paintVertexColor(hub, rope[0], rope[1], rope[2])
    parts.push(hub)

    return mergeAndCleanup(parts)
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

    const robe = new CylinderGeometry(0.24, 0.34, 0.78, 8)
    robe.translate(0, 0.39, 0)
    paintVertexColor(robe, 0.15, 0.20, 0.30)
    parts.push(robe)

    const hem = new CylinderGeometry(0.35, 0.36, 0.055, 8)
    hem.translate(0, 0.075, 0)
    paintVertexColor(hem, 0.09, 0.12, 0.18)
    parts.push(hem)

    const frontPanel = new BoxGeometry(0.032, 0.57, 0.18)
    frontPanel.translate(0.245, 0.39, 0)
    paintVertexColor(frontPanel, 0.20, 0.28, 0.40)
    parts.push(frontPanel)

    const trimA = new BoxGeometry(0.038, 0.58, 0.024)
    trimA.translate(0.266, 0.39, -0.105)
    paintVertexColor(trimA, 0.72, 0.50, 0.20)
    const trimB = trimA.clone()
    trimB.translate(0, 0, 0.21)
    paintVertexColor(trimB, 0.72, 0.50, 0.20)
    parts.push(trimA, trimB)

    const shoulderWrap = new CylinderGeometry(0.25, 0.23, 0.12, 8)
    shoulderWrap.translate(0, 0.74, 0)
    paintVertexColor(shoulderWrap, 0.36, 0.22, 0.13)
    parts.push(shoulderWrap)

    const leftSleeve = new CylinderGeometry(0.054, 0.066, 0.36, 6)
    leftSleeve.rotateZ(-0.46)
    leftSleeve.translate(0.16, 0.56, -0.245)
    paintVertexColor(leftSleeve, 0.13, 0.17, 0.25)
    const rightSleeve = new CylinderGeometry(0.052, 0.064, 0.32, 6)
    rightSleeve.rotateZ(-0.28)
    rightSleeve.translate(0.19, 0.56, 0.235)
    paintVertexColor(rightSleeve, 0.13, 0.17, 0.25)
    parts.push(leftSleeve, rightSleeve)

    const handA = new BoxGeometry(0.052, 0.052, 0.06)
    handA.translate(0.30, 0.47, -0.245)
    paintVertexColor(handA, 0.76, 0.56, 0.38)
    const handB = handA.clone()
    handB.translate(0.02, 0.08, 0.475)
    paintVertexColor(handB, 0.76, 0.56, 0.38)
    parts.push(handA, handB)

    const hood = new SphereGeometry(0.235, 8, 5)
    hood.scale(1.06, 1.12, 0.98)
    hood.translate(0, 0.94, 0)
    paintVertexColor(hood, 0.11, 0.14, 0.21)
    parts.push(hood)

    const hoodBrow = new BoxGeometry(0.048, 0.05, 0.19)
    hoodBrow.translate(0.218, 1.005, 0)
    paintVertexColor(hoodBrow, 0.07, 0.09, 0.14)
    const hoodSideA = new BoxGeometry(0.044, 0.20, 0.036)
    hoodSideA.translate(0.225, 0.905, -0.095)
    paintVertexColor(hoodSideA, 0.07, 0.09, 0.14)
    const hoodSideB = hoodSideA.clone()
    hoodSideB.translate(0, 0, 0.19)
    paintVertexColor(hoodSideB, 0.07, 0.09, 0.14)
    parts.push(hoodBrow, hoodSideA, hoodSideB)

    const face = new BoxGeometry(0.034, 0.15, 0.142)
    face.translate(0.247, 0.925, 0)
    paintVertexColor(face, 0.78, 0.58, 0.40)
    parts.push(face)

    const beard = new BoxGeometry(0.032, 0.15, 0.13)
    beard.translate(0.266, 0.835, 0)
    paintVertexColor(beard, 0.70, 0.69, 0.62)
    parts.push(beard)

    const moustache = new BoxGeometry(0.018, 0.028, 0.14)
    moustache.translate(0.286, 0.885, 0)
    paintVertexColor(moustache, 0.82, 0.78, 0.66)
    parts.push(moustache)

    for (const z of [-0.038, 0.038]) {
        const eye = new BoxGeometry(0.012, 0.016, 0.018)
        eye.translate(0.291, 0.947, z)
        paintVertexColor(eye, 0.05, 0.06, 0.07)
        parts.push(eye)
    }

    const sash = new BoxGeometry(0.08, 0.56, 0.04)
    sash.rotateZ(-0.38)
    sash.translate(0.07, 0.47, -0.235)
    paintVertexColor(sash, 0.76, 0.52, 0.20)
    parts.push(sash)

    const brooch = new SphereGeometry(0.055, 6, 4)
    brooch.scale(1, 0.72, 1)
    brooch.translate(0.292, 0.69, -0.035)
    paintVertexColor(brooch, 1.0, 0.72, 0.24)
    parts.push(brooch)

    const staff = new CylinderGeometry(0.017, 0.024, 1.08, 7)
    staff.translate(0.36, 0.54, 0.23)
    paintVertexColor(staff, 0.30, 0.18, 0.08)
    parts.push(staff)

    const staffCap = new SphereGeometry(0.045, 6, 4)
    staffCap.scale(1, 0.82, 1)
    staffCap.translate(0.36, 1.105, 0.23)
    paintVertexColor(staffCap, 0.86, 0.58, 0.18)
    parts.push(staffCap)

    const lanternGlow = new SphereGeometry(0.075, 6, 4)
    lanternGlow.scale(0.78, 0.92, 0.78)
    lanternGlow.translate(0.36, 0.34, 0.23)
    paintVertexColor(lanternGlow, 1.0, 0.70, 0.28)
    parts.push(lanternGlow)

    const lanternTop = new BoxGeometry(0.15, 0.018, 0.15)
    lanternTop.translate(0.36, 0.43, 0.23)
    paintVertexColor(lanternTop, 0.10, 0.08, 0.06)
    const lanternBottom = lanternTop.clone()
    lanternBottom.translate(0, -0.18, 0)
    paintVertexColor(lanternBottom, 0.10, 0.08, 0.06)
    parts.push(lanternTop, lanternBottom)

    for (const [x, z] of [[0.30, 0.17], [0.30, 0.29], [0.42, 0.17], [0.42, 0.29]] as const) {
        const bar = new BoxGeometry(0.018, 0.16, 0.018)
        bar.translate(x, 0.34, z)
        paintVertexColor(bar, 0.10, 0.08, 0.06)
        parts.push(bar)
    }

    const lanternHook = new BoxGeometry(0.018, 0.11, 0.018)
    lanternHook.rotateZ(-0.38)
    lanternHook.translate(0.36, 0.49, 0.23)
    paintVertexColor(lanternHook, 0.10, 0.08, 0.06)
    parts.push(lanternHook)

    const footA = new BoxGeometry(0.12, 0.06, 0.16)
    footA.translate(0.11, 0.03, 0.11)
    paintVertexColor(footA, 0.10, 0.08, 0.06)
    const footB = footA.clone()
    footB.translate(-0.20, 0, -0.22)
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

function buildHasteShrine(): BufferGeometry {
    // Small interactable shrine used by the demo to exercise live
    // player-settings mutation. The cyan rune + tilted side fins make
    // it read as "speed / movement" without adding a new material path.
    const parts: BufferGeometry[] = []

    const base = new CylinderGeometry(0.32, 0.40, 0.18, 12)
    base.translate(0, 0.09, 0)
    paintVertexColor(base, 0.30, 0.34, 0.36)
    parts.push(base)

    const step = new CylinderGeometry(0.25, 0.29, 0.10, 12)
    step.translate(0, 0.23, 0)
    paintVertexColor(step, 0.42, 0.45, 0.44)
    parts.push(step)

    const pillar = new BoxGeometry(0.24, 0.62, 0.24)
    pillar.translate(0, 0.58, 0)
    paintVertexColor(pillar, 0.58, 0.62, 0.60)
    parts.push(pillar)

    const cap = new CylinderGeometry(0.20, 0.24, 0.10, 8)
    cap.translate(0, 0.94, 0)
    paintVertexColor(cap, 0.78, 0.66, 0.30)
    parts.push(cap)

    const gem = new SphereGeometry(0.135, 10, 6)
    gem.scale(1, 1.24, 1)
    gem.translate(0, 1.10, 0)
    paintVertexColor(gem, 0.18, 0.88, 0.96)
    parts.push(gem)

    const glowRing = new CylinderGeometry(0.19, 0.19, 0.025, 16)
    glowRing.translate(0, 1.0, 0)
    paintVertexColor(glowRing, 0.30, 0.90, 0.88)
    parts.push(glowRing)

    for (const [x, z, yaw] of [
        [0.30, 0, -0.48],
        [-0.30, 0, 0.48],
        [0, 0.30, 0.48],
        [0, -0.30, -0.48],
    ] as const) {
        const fin = new BoxGeometry(0.09, 0.44, 0.045)
        fin.rotateY(yaw)
        fin.rotateZ(x === 0 ? 0 : x > 0 ? -0.22 : 0.22)
        fin.translate(x, 0.53, z)
        paintVertexColor(fin, 0.24, 0.58, 0.62)
        parts.push(fin)
    }

    for (const y of [0.44, 0.60, 0.76]) {
        const rune = new BoxGeometry(0.035, 0.11, 0.028)
        rune.rotateZ(-0.62)
        rune.translate(0.13, y, 0.13)
        paintVertexColor(rune, 0.20, 0.92, 0.90)
        parts.push(rune)
    }

    return mergeAndCleanup(parts)
}

function buildPortalShrine(): BufferGeometry {
    // Toll shrine for portal activation. Reuses the same compact silhouette
    // as the Haste shrine, but shifts the palette to violet/gold and adds a
    // small arch so it connects visually with the nearby gate.
    const parts: BufferGeometry[] = []

    const base = new CylinderGeometry(0.34, 0.44, 0.18, 12)
    base.translate(0, 0.09, 0)
    paintVertexColor(base, 0.26, 0.24, 0.34)
    parts.push(base)

    const step = new CylinderGeometry(0.27, 0.31, 0.10, 12)
    step.translate(0, 0.23, 0)
    paintVertexColor(step, 0.42, 0.36, 0.50)
    parts.push(step)

    const pillar = new BoxGeometry(0.24, 0.62, 0.24)
    pillar.translate(0, 0.58, 0)
    paintVertexColor(pillar, 0.55, 0.50, 0.66)
    parts.push(pillar)

    const cap = new CylinderGeometry(0.22, 0.26, 0.10, 8)
    cap.translate(0, 0.94, 0)
    paintVertexColor(cap, 0.86, 0.67, 0.24)
    parts.push(cap)

    const gem = new SphereGeometry(0.145, 10, 6)
    gem.scale(1, 1.24, 1)
    gem.translate(0, 1.10, 0)
    paintVertexColor(gem, 0.68, 0.42, 1.0)
    parts.push(gem)

    const glowRing = new CylinderGeometry(0.20, 0.20, 0.025, 16)
    glowRing.translate(0, 1.0, 0)
    paintVertexColor(glowRing, 0.78, 0.52, 1.0)
    parts.push(glowRing)

    const archTop = new BoxGeometry(0.72, 0.08, 0.08)
    archTop.translate(0, 0.82, -0.31)
    paintVertexColor(archTop, 0.80, 0.63, 0.28)
    parts.push(archTop)

    for (const x of [-0.31, 0.31]) {
        const archLeg = new BoxGeometry(0.08, 0.48, 0.08)
        archLeg.translate(x, 0.58, -0.31)
        paintVertexColor(archLeg, 0.72, 0.55, 0.24)
        parts.push(archLeg)
    }

    for (const y of [0.44, 0.60, 0.76]) {
        const rune = new BoxGeometry(0.035, 0.11, 0.028)
        rune.rotateZ(0.62)
        rune.translate(0.13, y, 0.13)
        paintVertexColor(rune, 0.78, 0.52, 1.0)
        parts.push(rune)
    }

    return mergeAndCleanup(parts)
}

function buildMarketMeat(): BufferGeometry {
    const parts: BufferGeometry[] = [
        boxPart([0.78, 0.10, 0.46], [0, 0.05, 0], [0.42, 0.24, 0.12]),
        boxPart([0.86, 0.045, 0.08], [0, 0.13, -0.23], [0.56, 0.36, 0.18]),
        boxPart([0.86, 0.045, 0.08], [0, 0.13, 0.23], [0.56, 0.36, 0.18]),
    ]
    for (const [x, z, w] of [[-0.22, -0.08, 0.22], [0.02, 0.04, 0.26], [0.25, -0.02, 0.18]] as const) {
        parts.push(boxPart([w, 0.08, 0.18], [x, 0.19, z], [0.76, 0.20, 0.18], [0, 0.18, 0]))
        const bone = new CylinderGeometry(0.018, 0.018, w + 0.08, 6)
        bone.rotateZ(Math.PI * 0.5)
        bone.translate(x, 0.23, z)
        paintVertexColor(bone, 0.92, 0.86, 0.72)
        parts.push(bone)
    }
    return mergeAndCleanup(parts)
}

function buildMarketApples(): BufferGeometry {
    const parts: BufferGeometry[] = []
    const basket = new CylinderGeometry(0.34, 0.40, 0.22, 12)
    basket.translate(0, 0.11, 0)
    paintVertexColor(basket, 0.55, 0.33, 0.16)
    parts.push(basket)
    const rim = new CylinderGeometry(0.42, 0.42, 0.035, 12)
    rim.translate(0, 0.24, 0)
    paintVertexColor(rim, 0.68, 0.45, 0.22)
    parts.push(rim)
    for (const [x, z, y, r, g] of [
        [-0.16, -0.06, 0.30, 0.84, 0.12],
        [0.00, -0.11, 0.33, 0.90, 0.18],
        [0.15, -0.03, 0.30, 0.78, 0.10],
        [-0.08, 0.10, 0.34, 0.95, 0.24],
        [0.11, 0.11, 0.33, 0.82, 0.15],
    ] as const) {
        parts.push(spherePart(0.095, [x, y, z], [r, g, 0.08], [1, 0.92, 1]))
        parts.push(boxPart([0.018, 0.055, 0.018], [x + 0.02, y + 0.075, z], [0.24, 0.14, 0.06], [0, 0, 0.18]))
    }
    return mergeAndCleanup(parts)
}

function buildMarketFish(): BufferGeometry {
    const parts: BufferGeometry[] = [
        boxPart([0.78, 0.08, 0.40], [0, 0.04, 0], [0.44, 0.30, 0.16]),
    ]
    for (const [x, z, color] of [
        [-0.22, -0.08, [0.52, 0.68, 0.72]],
        [0.04, 0.05, [0.68, 0.74, 0.62]],
        [0.25, -0.02, [0.58, 0.65, 0.78]],
    ] as const) {
        parts.push(spherePart(0.12, [x, 0.16, z], color as [number, number, number], [1.55, 0.45, 0.62]))
        const tail = new ConeGeometry(0.055, 0.13, 4)
        tail.rotateZ(-Math.PI * 0.5)
        tail.translate(x - 0.16, 0.16, z)
        paintVertexColor(tail, color[0] * 0.85, color[1] * 0.85, color[2] * 0.85)
        parts.push(tail)
        parts.push(spherePart(0.018, [x + 0.11, 0.18, z + 0.045], [0.05, 0.06, 0.07]))
    }
    return mergeAndCleanup(parts)
}

function buildSpearRack(): BufferGeometry {
    const parts: BufferGeometry[] = [
        boxPart([0.76, 0.08, 0.18], [0, 0.04, 0], [0.34, 0.20, 0.10]),
        boxPart([0.08, 0.64, 0.08], [-0.34, 0.34, 0], [0.34, 0.20, 0.10]),
        boxPart([0.08, 0.64, 0.08], [0.34, 0.34, 0], [0.34, 0.20, 0.10]),
        boxPart([0.82, 0.06, 0.08], [0, 0.50, 0], [0.44, 0.27, 0.13]),
    ]
    for (const x of [-0.22, 0, 0.22]) {
        const shaft = new CylinderGeometry(0.015, 0.018, 0.92, 7)
        shaft.rotateZ(-0.12)
        shaft.translate(x, 0.52, 0.04)
        paintVertexColor(shaft, 0.52, 0.30, 0.14)
        parts.push(shaft)
        const head = new ConeGeometry(0.055, 0.16, 8)
        head.rotateZ(-0.12)
        head.translate(x + 0.055, 1.01, 0.04)
        paintVertexColor(head, 0.80, 0.86, 0.90)
        parts.push(head)
    }
    return mergeAndCleanup(parts)
}

function buildArrowBarrel(): BufferGeometry {
    const parts: BufferGeometry[] = []
    const barrel = new CylinderGeometry(0.25, 0.30, 0.46, 12)
    barrel.translate(0, 0.23, 0)
    paintVertexColor(barrel, 0.48, 0.29, 0.14)
    parts.push(barrel)
    for (const y of [0.12, 0.36]) {
        const band = new CylinderGeometry(0.31, 0.31, 0.035, 12)
        band.translate(0, y, 0)
        paintVertexColor(band, 0.24, 0.25, 0.26)
        parts.push(band)
    }
    for (const [x, z, lean] of [[-0.08, 0, -0.12], [0.02, 0.04, 0.06], [0.11, -0.03, 0.12], [-0.01, -0.09, -0.04]] as const) {
        const shaft = new CylinderGeometry(0.009, 0.009, 0.62, 6)
        shaft.rotateZ(lean)
        shaft.translate(x, 0.62, z)
        paintVertexColor(shaft, 0.68, 0.43, 0.20)
        parts.push(shaft)
        const head = new ConeGeometry(0.028, 0.09, 6)
        head.rotateZ(lean)
        head.translate(x + lean * 0.05, 0.96, z)
        paintVertexColor(head, 0.82, 0.88, 0.92)
        parts.push(head)
    }
    return mergeAndCleanup(parts)
}

function buildHelmetStand(): BufferGeometry {
    const parts: BufferGeometry[] = [
        boxPart([0.38, 0.06, 0.38], [0, 0.03, 0], [0.30, 0.18, 0.09]),
        cylPart(0.045, 0.055, 0.42, [0, 0.24, 0], [0.36, 0.22, 0.11]),
        spherePart(0.11, [0, 0.47, 0], [0.58, 0.38, 0.20], [1, 0.72, 1]),
    ]
    const dome = new SphereGeometry(0.22, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.62)
    dome.translate(0, 0.52, 0)
    paintVertexColor(dome, 0.78, 0.84, 0.88)
    parts.push(dome)
    parts.push(cylPart(0.23, 0.23, 0.035, [0, 0.49, 0], [0.36, 0.40, 0.44]))
    parts.push(boxPart([0.035, 0.16, 0.035], [0, 0.45, 0.22], [0.36, 0.40, 0.44]))
    return mergeAndCleanup(parts)
}

function buildHatDisplay(): BufferGeometry {
    const parts: BufferGeometry[] = [
        boxPart([0.86, 0.08, 0.36], [0, 0.04, 0], [0.48, 0.30, 0.15]),
        boxPart([0.08, 0.36, 0.08], [-0.34, 0.22, -0.12], [0.34, 0.20, 0.10]),
        boxPart([0.08, 0.36, 0.08], [0.34, 0.22, -0.12], [0.34, 0.20, 0.10]),
        boxPart([0.82, 0.06, 0.08], [0, 0.38, -0.12], [0.44, 0.27, 0.13]),
    ]
    for (const [x, c] of [[-0.24, [0.20, 0.36, 0.18]], [0.02, [0.20, 0.24, 0.58]], [0.28, [0.82, 0.62, 0.18]]] as const) {
        parts.push(cylPart(0.15, 0.14, 0.03, [x, 0.42, -0.12], c as [number, number, number], 12, [0, 0, 0]))
        const crown = new CylinderGeometry(0.09, 0.12, 0.16, 10)
        crown.translate(x, 0.50, -0.12)
        paintVertexColor(crown, c[0], c[1], c[2])
        parts.push(crown)
    }
    return mergeAndCleanup(parts)
}

function buildBootRack(): BufferGeometry {
    const parts: BufferGeometry[] = [
        boxPart([0.82, 0.07, 0.24], [0, 0.035, 0], [0.40, 0.24, 0.12]),
        boxPart([0.76, 0.05, 0.08], [0, 0.38, -0.07], [0.47, 0.30, 0.15]),
        boxPart([0.05, 0.42, 0.05], [-0.35, 0.22, -0.07], [0.33, 0.19, 0.09]),
        boxPart([0.05, 0.42, 0.05], [0.35, 0.22, -0.07], [0.33, 0.19, 0.09]),
    ]
    for (const [x, color] of [[-0.22, [0.16, 0.13, 0.18]], [0.18, [0.12, 0.18, 0.22]]] as const) {
        for (const dx of [-0.055, 0.055]) {
            parts.push(boxPart([0.09, 0.20, 0.12], [x + dx, 0.20, 0.05], color as [number, number, number]))
            parts.push(boxPart([0.11, 0.06, 0.20], [x + dx, 0.10, 0.13], color as [number, number, number]))
        }
    }
    return mergeAndCleanup(parts)
}

function buildPotionShelf(): BufferGeometry {
    const parts: BufferGeometry[] = [
        boxPart([0.88, 0.08, 0.26], [0, 0.04, 0], [0.36, 0.22, 0.12]),
        boxPart([0.88, 0.06, 0.24], [0, 0.38, 0], [0.42, 0.26, 0.14]),
        boxPart([0.06, 0.62, 0.06], [-0.40, 0.32, 0], [0.30, 0.18, 0.10]),
        boxPart([0.06, 0.62, 0.06], [0.40, 0.32, 0], [0.30, 0.18, 0.10]),
    ]
    const bottles = [
        [-0.27, 0.17, -0.03, [0.90, 0.18, 0.26]],
        [-0.06, 0.17, 0.04, [0.20, 0.82, 0.78]],
        [0.16, 0.17, -0.02, [0.66, 0.32, 0.92]],
        [0.30, 0.50, 0.02, [0.92, 0.72, 0.18]],
        [-0.18, 0.50, 0.03, [0.28, 0.84, 0.38]],
    ] as const
    for (const [x, y, z, color] of bottles) {
        parts.push(cylPart(0.04, 0.052, 0.14, [x, y, z], color as [number, number, number], 8))
        parts.push(cylPart(0.022, 0.026, 0.07, [x, y + 0.10, z], [0.86, 0.78, 0.62], 7))
    }
    return mergeAndCleanup(parts)
}

function buildAlchemyCauldron(): BufferGeometry {
    const parts: BufferGeometry[] = []
    const pot = new SphereGeometry(0.34, 12, 8)
    pot.scale(1, 0.64, 1)
    pot.translate(0, 0.31, 0)
    paintVertexColor(pot, 0.08, 0.10, 0.12)
    parts.push(pot)
    parts.push(cylPart(0.31, 0.32, 0.06, [0, 0.52, 0], [0.16, 0.18, 0.19], 12))
    parts.push(cylPart(0.24, 0.24, 0.025, [0, 0.555, 0], [0.32, 0.88, 0.56], 12))
    for (const [x, z] of [[-0.23, -0.18], [0.23, -0.18], [0, 0.25]] as const) {
        parts.push(cylPart(0.035, 0.04, 0.20, [x, 0.10, z], [0.09, 0.08, 0.07], 7))
    }
    for (const [x, z, r] of [[-0.12, 0.02, 0.055], [0.08, -0.04, 0.045], [0.16, 0.09, 0.035]] as const) {
        parts.push(spherePart(r, [x, 0.66 + r, z], [0.48, 1.0, 0.72], [1, 1, 1]))
    }
    return mergeAndCleanup(parts)
}

function buildRoadSign(): BufferGeometry {
    const post = [0.34, 0.20, 0.10] as const
    const board = [0.58, 0.36, 0.18] as const
    const boardDark = [0.34, 0.19, 0.10] as const
    const warning = [0.86, 0.60, 0.20] as const
    const ink = [0.08, 0.07, 0.05] as const
    const parts: BufferGeometry[] = [
        boxPart([0.12, 1.08, 0.12], [-0.34, 0.54, 0], post),
        boxPart([0.12, 1.02, 0.12], [0.34, 0.51, 0], post),
        boxPart([1.22, 0.50, 0.12], [0, 1.02, 0], board, [0, 0, -0.035]),
        boxPart([1.34, 0.08, 0.15], [0, 1.30, 0], boardDark, [0, 0, -0.035]),
        boxPart([1.30, 0.07, 0.15], [0, 0.75, 0], boardDark, [0, 0, -0.035]),
        boxPart([0.18, 0.56, 0.15], [-0.68, 1.02, 0], boardDark, [0, 0, -0.035]),
        boxPart([0.18, 0.56, 0.15], [0.68, 1.02, 0], boardDark, [0, 0, -0.035]),
        boxPart([0.30, 0.20, 0.155], [-0.41, 1.05, -0.005], warning, [0, 0, -0.035]),
        boxPart([0.10, 0.22, 0.165], [-0.39, 1.05, -0.09], ink, [0, 0, -0.42]),
        boxPart([0.10, 0.22, 0.165], [-0.24, 1.05, -0.09], ink, [0, 0, 0.42]),
        boxPart([0.46, 0.035, 0.165], [0.23, 1.09, -0.09], ink, [0, 0, -0.035]),
        boxPart([0.36, 0.035, 0.165], [0.18, 0.98, -0.09], ink, [0, 0, -0.035]),
        boxPart([0.12, 0.10, 0.13], [-0.34, 0.05, 0], [0.22, 0.14, 0.08]),
        boxPart([0.12, 0.10, 0.13], [0.34, 0.05, 0], [0.22, 0.14, 0.08]),
    ]
    return mergeAndCleanup(parts)
}

function buildBrokenWagon(): BufferGeometry {
    const wood = [0.43, 0.24, 0.12] as const
    const darkWood = [0.23, 0.13, 0.07] as const
    const iron = [0.20, 0.22, 0.23] as const
    const cloth = [0.46, 0.37, 0.24] as const
    const parts: BufferGeometry[] = [
        boxPart([1.25, 0.18, 0.72], [0.03, 0.33, 0], wood, [0, 0, -0.08]),
        boxPart([1.12, 0.12, 0.12], [0.00, 0.48, -0.38], darkWood, [0, 0, -0.08]),
        boxPart([1.06, 0.12, 0.12], [0.08, 0.48, 0.38], darkWood, [0, 0, -0.18]),
        boxPart([0.12, 0.32, 0.82], [-0.58, 0.39, 0], darkWood, [0.1, 0, 0]),
        boxPart([0.12, 0.25, 0.78], [0.64, 0.37, 0], darkWood, [-0.08, 0, -0.2]),
        boxPart([1.65, 0.08, 0.08], [0.05, 0.22, 0], darkWood, [0, 0.08, -0.28]),
        boxPart([0.62, 0.34, 0.42], [-0.18, 0.62, -0.02], cloth, [0.04, 0.18, -0.13]),
        boxPart([0.34, 0.28, 0.34], [0.38, 0.58, 0.18], [0.52, 0.31, 0.16], [0.02, -0.18, 0.16]),
    ]

    for (const [x, z, tilt] of [[-0.42, -0.47, Math.PI * 0.5], [-0.40, 0.47, Math.PI * 0.5], [0.55, -0.43, 0.9]] as const) {
        parts.push(cylPart(0.22, 0.22, 0.08, [x, 0.23, z], darkWood, 12, [Math.PI * 0.5, 0, tilt]))
        parts.push(cylPart(0.12, 0.12, 0.09, [x, 0.23, z], iron, 10, [Math.PI * 0.5, 0, tilt]))
    }
    parts.push(boxPart([0.34, 0.05, 0.08], [0.76, 0.20, 0.44], darkWood, [0.1, 0.5, 0.7]))
    parts.push(boxPart([0.28, 0.05, 0.08], [0.77, 0.15, 0.55], darkWood, [0.1, -0.2, -0.2]))
    const geometry = mergeAndCleanup(parts)
    geometry.translate(0, 0.06, 0)
    return geometry
}

function buildFallenDriver(): BufferGeometry {
    const tunic = [0.28, 0.34, 0.30] as const
    const boots = [0.12, 0.08, 0.06] as const
    const skin = [0.70, 0.52, 0.36] as const
    const beard = [0.42, 0.28, 0.17] as const
    const parts: BufferGeometry[] = [
        boxPart([0.34, 0.16, 0.66], [0, 0.15, 0], tunic, [0.05, 0.18, -0.04]),
        spherePart(0.16, [0.02, 0.20, -0.42], skin, [1, 0.78, 0.9]),
        boxPart([0.22, 0.06, 0.16], [0.02, 0.12, -0.52], beard, [0.04, 0.1, 0]),
        boxPart([0.10, 0.08, 0.38], [-0.15, 0.12, 0.44], boots, [0.08, 0.12, 0.18]),
        boxPart([0.10, 0.08, 0.36], [0.16, 0.12, 0.42], boots, [0.05, -0.2, -0.08]),
        boxPart([0.09, 0.07, 0.42], [-0.28, 0.15, -0.04], skin, [0.1, 0.36, 0.08]),
        boxPart([0.09, 0.07, 0.36], [0.29, 0.15, 0.02], skin, [-0.06, -0.32, -0.08]),
        boxPart([0.36, 0.035, 0.24], [-0.02, 0.035, -0.02], [0.14, 0.12, 0.10], [0, 0.1, 0]),
    ]
    return mergeAndCleanup(parts)
}

function buildRepairMaterialsCrate(): BufferGeometry {
    const wood = [0.46, 0.29, 0.16] as const
    const rope = [0.74, 0.60, 0.34] as const
    const metal = [0.40, 0.43, 0.45] as const
    const parts: BufferGeometry[] = [
        boxPart([0.58, 0.34, 0.46], [0, 0.19, 0], wood),
        boxPart([0.64, 0.06, 0.50], [0, 0.39, 0], [0.33, 0.19, 0.10]),
        boxPart([0.07, 0.42, 0.52], [-0.24, 0.23, 0], [0.28, 0.16, 0.08]),
        boxPart([0.07, 0.42, 0.52], [0.24, 0.23, 0], [0.28, 0.16, 0.08]),
        cylPart(0.035, 0.035, 0.74, [0, 0.48, -0.04], rope, 8, [0, 0, Math.PI * 0.5]),
        cylPart(0.04, 0.04, 0.42, [0.06, 0.54, 0.18], rope, 8, [Math.PI * 0.5, 0, 0]),
        cylPart(0.045, 0.045, 0.52, [-0.18, 0.18, -0.34], metal, 8, [Math.PI * 0.5, 0, 0.1]),
        boxPart([0.16, 0.08, 0.12], [0.22, 0.47, 0.05], metal, [0.05, 0.3, 0.1]),
    ]
    return mergeAndCleanup(parts)
}

function buildLiftControlLever(): BufferGeometry {
    const stone = [0.34, 0.36, 0.38] as const
    const metal = [0.18, 0.20, 0.22] as const
    const brass = [0.86, 0.64, 0.26] as const
    const red = [0.86, 0.15, 0.10] as const
    const parts: BufferGeometry[] = [
        boxPart([0.52, 0.12, 0.44], [0, 0.06, 0], stone),
        boxPart([0.34, 0.18, 0.28], [0, 0.20, 0], metal),
        cylPart(0.09, 0.11, 0.14, [0, 0.32, 0], brass, 10),
        cylPart(0.04, 0.05, 0.58, [0.16, 0.58, 0], metal, 8, [0, 0, -0.58]),
        spherePart(0.105, [0.31, 0.82, 0], red, [1, 1.06, 1]),
        boxPart([0.42, 0.025, 0.06], [0, 0.31, -0.19], brass),
        boxPart([0.42, 0.025, 0.06], [0, 0.31, 0.19], brass),
    ]
    return mergeAndCleanup(parts)
}

function buildOrePile(): BufferGeometry {
    const rock = [0.20, 0.22, 0.23] as const
    const iron = [0.56, 0.58, 0.57] as const
    const copper = [0.72, 0.38, 0.20] as const
    const crystal = [0.24, 0.72, 0.90] as const
    const parts: BufferGeometry[] = [
        spherePart(0.22, [-0.18, 0.13, 0.02], rock, [1.25, 0.55, 0.9]),
        spherePart(0.18, [0.08, 0.12, -0.10], iron, [1.15, 0.58, 0.95]),
        spherePart(0.16, [0.20, 0.10, 0.16], copper, [1.2, 0.52, 0.8]),
        spherePart(0.12, [-0.02, 0.25, 0.10], rock, [0.95, 0.70, 0.8]),
        boxPart([0.08, 0.20, 0.08], [-0.10, 0.27, -0.18], crystal, [0.32, 0.1, 0.18]),
        boxPart([0.07, 0.16, 0.07], [0.16, 0.23, 0.00], crystal, [-0.22, 0.16, -0.12]),
    ]
    return mergeAndCleanup(parts)
}

function buildOreCrate(): BufferGeometry {
    const wood = [0.39, 0.23, 0.12] as const
    const darkWood = [0.24, 0.14, 0.08] as const
    const ore = [0.54, 0.48, 0.42] as const
    const copper = [0.70, 0.34, 0.18] as const
    const parts: BufferGeometry[] = [
        boxPart([0.66, 0.34, 0.48], [0, 0.19, 0], wood),
        boxPart([0.72, 0.06, 0.54], [0, 0.39, 0], darkWood),
        boxPart([0.08, 0.42, 0.56], [-0.27, 0.23, 0], darkWood),
        boxPart([0.08, 0.42, 0.56], [0.27, 0.23, 0], darkWood),
        spherePart(0.12, [-0.18, 0.50, -0.07], ore, [1.12, 0.62, 0.9]),
        spherePart(0.10, [0.06, 0.48, 0.08], copper, [1.05, 0.58, 0.85]),
        spherePart(0.08, [0.22, 0.47, -0.04], ore, [1.0, 0.62, 1.0]),
    ]
    return mergeAndCleanup(parts)
}

function buildMineToolRack(): BufferGeometry {
    const wood = [0.34, 0.20, 0.10] as const
    const metal = [0.48, 0.50, 0.50] as const
    const handle = [0.50, 0.31, 0.15] as const
    const parts: BufferGeometry[] = [
        boxPart([0.92, 0.08, 0.12], [0, 0.12, 0], wood),
        boxPart([0.92, 0.08, 0.12], [0, 0.78, 0], wood),
        boxPart([0.08, 0.82, 0.10], [-0.42, 0.43, 0], wood),
        boxPart([0.08, 0.82, 0.10], [0.42, 0.43, 0], wood),
        boxPart([0.05, 0.72, 0.05], [-0.22, 0.46, -0.08], handle, [0, 0, -0.12]),
        boxPart([0.24, 0.08, 0.06], [-0.25, 0.82, -0.10], metal, [0, 0, -0.12]),
        boxPart([0.05, 0.68, 0.05], [0.02, 0.45, -0.09], handle, [0, 0, 0.18]),
        boxPart([0.20, 0.14, 0.06], [0.08, 0.78, -0.11], metal, [0, 0, 0.18]),
        boxPart([0.05, 0.62, 0.05], [0.28, 0.43, -0.08], handle, [0, 0, -0.32]),
        boxPart([0.18, 0.07, 0.07], [0.18, 0.72, -0.09], metal, [0, 0, -0.32]),
    ]
    return mergeAndCleanup(parts)
}

function buildBrokenRailCart(): BufferGeometry {
    const wood = [0.36, 0.21, 0.11] as const
    const darkWood = [0.20, 0.12, 0.07] as const
    const metal = [0.22, 0.24, 0.25] as const
    const ore = [0.48, 0.42, 0.36] as const
    const parts: BufferGeometry[] = [
        boxPart([0.96, 0.28, 0.58], [0.00, 0.30, 0], wood, [0, 0, -0.12]),
        boxPart([1.04, 0.08, 0.10], [0.00, 0.47, -0.32], darkWood, [0, 0, -0.12]),
        boxPart([0.92, 0.08, 0.10], [0.08, 0.46, 0.32], darkWood, [0, 0, -0.22]),
        boxPart([0.10, 0.34, 0.66], [-0.49, 0.34, 0], darkWood, [0.04, 0, -0.08]),
        boxPart([0.10, 0.24, 0.56], [0.51, 0.30, 0], darkWood, [-0.1, 0, -0.34]),
        boxPart([1.14, 0.05, 0.06], [0, 0.16, -0.38], metal, [0, 0.02, 0]),
        boxPart([1.14, 0.05, 0.06], [0, 0.16, 0.38], metal, [0, -0.02, 0]),
        spherePart(0.12, [-0.14, 0.56, -0.04], ore, [1.12, 0.58, 0.9]),
        spherePart(0.10, [0.14, 0.52, 0.09], ore, [1.0, 0.55, 0.86]),
    ]
    for (const [x, z, yaw] of [[-0.34, -0.34, 0], [-0.34, 0.34, 0.1], [0.36, -0.34, -0.15], [0.46, 0.34, 0.55]] as const) {
        parts.push(cylPart(0.13, 0.13, 0.07, [x, 0.17, z], metal, 10, [Math.PI * 0.5, 0, yaw]))
    }
    return mergeAndCleanup(parts)
}

function buildSupportDebris(): BufferGeometry {
    const wood = [0.33, 0.19, 0.09] as const
    const stone = [0.32, 0.34, 0.35] as const
    const parts: BufferGeometry[] = [
        boxPart([0.92, 0.10, 0.12], [-0.05, 0.18, 0.02], wood, [0.04, 0.18, -0.36]),
        boxPart([0.76, 0.09, 0.11], [0.14, 0.28, -0.10], wood, [0.02, -0.38, 0.24]),
        boxPart([0.48, 0.08, 0.10], [-0.22, 0.11, 0.20], wood, [0.1, 0.56, 0.08]),
        spherePart(0.16, [0.25, 0.10, 0.18], stone, [1.2, 0.48, 0.9]),
        spherePart(0.12, [-0.30, 0.08, -0.16], stone, [1.0, 0.55, 0.82]),
    ]
    const geometry = mergeAndCleanup(parts)
    geometry.translate(0, 0.08, 0)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
}

function buildNoticeBoard(): BufferGeometry {
    const wood = [0.38, 0.23, 0.12] as const
    const paper = [0.86, 0.78, 0.58] as const
    const ink = [0.10, 0.08, 0.06] as const
    const parts: BufferGeometry[] = [
        boxPart([0.10, 1.02, 0.10], [-0.46, 0.51, 0], wood),
        boxPart([0.10, 1.02, 0.10], [0.46, 0.51, 0], wood),
        boxPart([1.04, 0.62, 0.10], [0, 0.82, 0], [0.46, 0.30, 0.16]),
        boxPart([0.28, 0.24, 0.04], [-0.27, 0.88, -0.06], paper, [0, 0, -0.04]),
        boxPart([0.24, 0.20, 0.04], [0.12, 0.76, -0.06], paper, [0, 0, 0.05]),
        boxPart([0.06, 0.18, 0.045], [-0.30, 0.88, -0.09], ink, [0, 0, -0.25]),
        boxPart([0.18, 0.025, 0.045], [-0.18, 0.94, -0.09], ink),
        boxPart([0.14, 0.025, 0.045], [0.14, 0.80, -0.09], ink),
    ]
    return mergeAndCleanup(parts)
}

function buildVentFan(): BufferGeometry {
    const metal = [0.22, 0.24, 0.25] as const
    const dark = [0.08, 0.09, 0.10] as const
    const brass = [0.62, 0.48, 0.24] as const
    const parts: BufferGeometry[] = [
        cylPart(0.34, 0.34, 0.08, [0, 0.36, 0], metal, 14, [Math.PI * 0.5, 0, 0]),
        cylPart(0.25, 0.25, 0.09, [0, 0.36, 0], dark, 14, [Math.PI * 0.5, 0, 0]),
        cylPart(0.06, 0.07, 0.12, [0, 0.36, -0.02], brass, 10, [Math.PI * 0.5, 0, 0]),
    ]
    for (let i = 0; i < 4; i++) {
        const blade = boxPart([0.10, 0.025, 0.26], [0, 0.36, -0.04], metal, [0, 0, i * Math.PI * 0.5 + 0.35])
        parts.push(blade)
    }
    parts.push(boxPart([0.78, 0.08, 0.08], [0, 0.04, 0], metal))
    return mergeAndCleanup(parts)
}

function buildAbandonedLampCluster(): BufferGeometry {
    const metal = [0.24, 0.24, 0.23] as const
    const glass = [0.94, 0.72, 0.32] as const
    const soot = [0.08, 0.07, 0.06] as const
    const parts: BufferGeometry[] = [
        boxPart([0.46, 0.05, 0.32], [0, 0.04, 0], soot, [0, 0.1, 0.02]),
        cylPart(0.06, 0.07, 0.18, [-0.12, 0.16, -0.04], glass, 8, [0.08, 0, 0.12]),
        cylPart(0.07, 0.08, 0.20, [0.13, 0.17, 0.05], glass, 8, [-0.04, 0, -0.18]),
        cylPart(0.08, 0.09, 0.04, [-0.12, 0.27, -0.04], metal, 8),
        cylPart(0.08, 0.09, 0.04, [0.13, 0.29, 0.05], metal, 8),
        boxPart([0.36, 0.035, 0.035], [0.02, 0.09, -0.20], metal, [0, 0.35, 0.04]),
    ]
    return mergeAndCleanup(parts)
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function boxPart(
    size: readonly [number, number, number],
    pos: readonly [number, number, number],
    color: readonly [number, number, number],
    rot: readonly [number, number, number] = [0, 0, 0],
): BufferGeometry {
    const geo = new BoxGeometry(size[0], size[1], size[2])
    if (rot[0]) geo.rotateX(rot[0])
    if (rot[1]) geo.rotateY(rot[1])
    if (rot[2]) geo.rotateZ(rot[2])
    geo.translate(pos[0], pos[1], pos[2])
    paintVertexColor(geo, color[0], color[1], color[2])
    return geo
}

function cylPart(
    radiusTop: number,
    radiusBottom: number,
    height: number,
    pos: readonly [number, number, number],
    color: readonly [number, number, number],
    segments = 10,
    rot: readonly [number, number, number] = [0, 0, 0],
): BufferGeometry {
    const geo = new CylinderGeometry(radiusTop, radiusBottom, height, segments)
    if (rot[0]) geo.rotateX(rot[0])
    if (rot[1]) geo.rotateY(rot[1])
    if (rot[2]) geo.rotateZ(rot[2])
    geo.translate(pos[0], pos[1], pos[2])
    paintVertexColor(geo, color[0], color[1], color[2])
    return geo
}

function spherePart(
    radius: number,
    pos: readonly [number, number, number],
    color: readonly [number, number, number],
    scale: readonly [number, number, number] = [1, 1, 1],
): BufferGeometry {
    const geo = new SphereGeometry(radius, 8, 6)
    geo.scale(scale[0], scale[1], scale[2])
    geo.translate(pos[0], pos[1], pos[2])
    paintVertexColor(geo, color[0], color[1], color[2])
    return geo
}

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
