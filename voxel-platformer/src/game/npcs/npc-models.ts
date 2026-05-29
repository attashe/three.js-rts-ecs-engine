import {
    Group,
    Mesh,
} from 'three'
import {
    createMainCharacter,
    sharedBoxGeometry,
    sharedCylinderGeometry,
    sharedMaterial,
    sharedSphereGeometry,
} from '../assets'
import type { NpcModelKind } from './npc-types'

export function createNpcModel(kind: NpcModelKind): Group {
    switch (kind) {
        case 'player':
            return createPlayerNpcModel()
        case 'keeper':
            return createKeeperNpcModel()
        case 'large-troll':
            return createLargeTrollModel()
    }
}

function createPlayerNpcModel(): Group {
    const root = createMainCharacter({
        tunicColor: 0x2f5e8f,
        cloakColor: 0x7a2430,
        skinColor: 0xd8a06a,
        metalColor: 0xc8b56f,
        bootColor: 0x2b211d,
    })
    root.name = 'NpcModel:player'
    return root
}

function createKeeperNpcModel(): Group {
    const root = createMainCharacter({
        tunicColor: 0x1f2c3f,
        cloakColor: 0x3f2818,
        skinColor: 0xc89461,
        metalColor: 0xffc462,
        bootColor: 0x17120d,
    })
    root.name = 'NpcModel:keeper'

    const staff = shadowed(new Mesh(
        sharedCylinderGeometry(0.018, 0.024, 1.18, 7),
        sharedMaterial(0x4a2c12, 0.86),
    ))
    staff.name = 'KeeperStaff'
    staff.position.set(0.42, 0.62, 0.18)
    root.add(staff)

    const staffCap = shadowed(new Mesh(
        sharedSphereGeometry(0.052, 7, 5),
        sharedMaterial(0xffc462, 0.38, 0.18),
    ))
    staffCap.name = 'KeeperStaffCap'
    staffCap.position.set(0.42, 1.23, 0.18)
    staffCap.scale.set(1, 0.78, 1)
    root.add(staffCap)

    const lanternGlow = shadowed(new Mesh(
        sharedSphereGeometry(0.08, 8, 6),
        sharedMaterial(0xffb54d, 0.42, 0.08),
    ))
    lanternGlow.name = 'KeeperLanternGlow'
    lanternGlow.position.set(0.42, 0.36, 0.18)
    lanternGlow.scale.set(0.78, 0.94, 0.78)
    root.add(lanternGlow)

    const darkMetal = sharedMaterial(0x17120d, 0.72, 0.1)
    const lanternTop = shadowed(new Mesh(sharedBoxGeometry(0.16, 0.02, 0.16), darkMetal))
    lanternTop.name = 'KeeperLanternTop'
    lanternTop.position.set(0.42, 0.45, 0.18)
    root.add(lanternTop)
    const lanternBottom = shadowed(new Mesh(sharedBoxGeometry(0.16, 0.02, 0.16), darkMetal))
    lanternBottom.name = 'KeeperLanternBottom'
    lanternBottom.position.set(0.42, 0.27, 0.18)
    root.add(lanternBottom)

    for (const [x, z] of [[0.35, 0.11], [0.35, 0.25], [0.49, 0.11], [0.49, 0.25]] as const) {
        const bar = shadowed(new Mesh(sharedBoxGeometry(0.018, 0.16, 0.018), darkMetal))
        bar.name = 'KeeperLanternBar'
        bar.position.set(x, 0.36, z)
        root.add(bar)
    }

    const beard = shadowed(new Mesh(
        sharedBoxGeometry(0.08, 0.22, 0.18),
        sharedMaterial(0xb6b09a, 0.9),
    ))
    beard.name = 'KeeperBeard'
    beard.position.set(0, 1.23, 0.19)
    root.add(beard)

    return root
}

function createLargeTrollModel(): Group {
    const root = new Group()
    root.name = 'NpcModel:large-troll'

    const figure = createMainCharacter({
        tunicColor: 0x394b4f,
        cloakColor: 0x4f2430,
        skinColor: 0x6f8d6b,
        metalColor: 0xd2b45f,
        bootColor: 0x251f19,
    })
    figure.name = 'LargeTrollFigure'
    figure.scale.setScalar(1.85)
    root.add(figure)

    const robe = shadowed(new Mesh(
        sharedBoxGeometry(0.92, 0.1, 0.64),
        sharedMaterial(0x24343c, 0.82),
    ))
    robe.name = 'LargeTrollRobeHem'
    robe.position.set(0, 0.52, 0.02)
    root.add(robe)

    const sash = shadowed(new Mesh(
        sharedBoxGeometry(1.02, 0.1, 0.08),
        sharedMaterial(0xb98f45, 0.48, 0.16),
    ))
    sash.name = 'LargeTrollSash'
    sash.position.set(0, 1.34, 0.47)
    root.add(sash)

    const brow = shadowed(new Mesh(
        sharedBoxGeometry(0.56, 0.08, 0.12),
        sharedMaterial(0x42573e, 0.78),
    ))
    brow.name = 'LargeTrollHeavyBrow'
    brow.position.set(0, 2.67, 0.31)
    root.add(brow)

    const leftLens = shadowed(new Mesh(
        sharedSphereGeometry(0.09, 10, 6),
        sharedMaterial(0x9fd7d3, 0.32, 0.08, 0.54),
    ))
    leftLens.name = 'LargeTrollLeftLens'
    leftLens.position.set(-0.18, 2.57, 0.35)
    leftLens.scale.set(1.1, 0.72, 0.2)
    root.add(leftLens)

    const rightLens = shadowed(new Mesh(
        sharedSphereGeometry(0.09, 10, 6),
        sharedMaterial(0x9fd7d3, 0.32, 0.08, 0.54),
    ))
    rightLens.name = 'LargeTrollRightLens'
    rightLens.position.set(0.18, 2.57, 0.35)
    rightLens.scale.set(1.1, 0.72, 0.2)
    root.add(rightLens)

    const bridge = shadowed(new Mesh(
        sharedBoxGeometry(0.14, 0.025, 0.035),
        sharedMaterial(0xd2b45f, 0.42, 0.24),
    ))
    bridge.name = 'LargeTrollGlassesBridge'
    bridge.position.set(0, 2.57, 0.38)
    root.add(bridge)

    const book = shadowed(new Mesh(
        sharedBoxGeometry(0.56, 0.08, 0.42),
        sharedMaterial(0x6c2f34, 0.68),
    ))
    book.name = 'LargeTrollBook'
    book.position.set(-0.58, 1.26, 0.36)
    book.rotation.z = 0.2
    root.add(book)

    const pages = shadowed(new Mesh(
        sharedBoxGeometry(0.48, 0.03, 0.34),
        sharedMaterial(0xe6dcc3, 0.72),
    ))
    pages.name = 'LargeTrollBookPages'
    pages.position.set(-0.58, 1.31, 0.36)
    pages.rotation.z = 0.2
    root.add(pages)

    return root
}

function shadowed(mesh: Mesh): Mesh {
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
}
