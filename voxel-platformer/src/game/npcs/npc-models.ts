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

function shadowed(mesh: Mesh): Mesh {
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
}
