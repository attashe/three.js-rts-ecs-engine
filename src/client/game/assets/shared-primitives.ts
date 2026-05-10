import {
    BoxGeometry,
    BufferGeometry,
    CapsuleGeometry,
    ConeGeometry,
    CylinderGeometry,
    MeshStandardMaterial,
    SphereGeometry,
    TorusGeometry,
} from 'three'

export const SHARED_ASSET_RESOURCE = 'sharedAssetResource'

const geometryByKey = new Map<string, BufferGeometry>()
const materialByKey = new Map<string, MeshStandardMaterial>()

export function sharedMaterial(color: number, roughness = 0.7, metalness = 0): MeshStandardMaterial {
    const key = `standard:${color}:${roughness}:${metalness}`
    let existing = materialByKey.get(key)
    if (!existing) {
        existing = new MeshStandardMaterial({ color, roughness, metalness })
        existing.userData[SHARED_ASSET_RESOURCE] = true
        materialByKey.set(key, existing)
    }
    return existing
}

export function sharedBoxGeometry(width: number, height: number, depth: number): BoxGeometry {
    return sharedGeometry(
        `box:${width}:${height}:${depth}`,
        () => new BoxGeometry(width, height, depth),
    ) as BoxGeometry
}

export function sharedSphereGeometry(
    radius = 1,
    widthSegments = 32,
    heightSegments = 16,
    phiStart = 0,
    phiLength = Math.PI * 2,
    thetaStart = 0,
    thetaLength = Math.PI,
): SphereGeometry {
    return sharedGeometry(
        `sphere:${radius}:${widthSegments}:${heightSegments}:${phiStart}:${phiLength}:${thetaStart}:${thetaLength}`,
        () => new SphereGeometry(radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength),
    ) as SphereGeometry
}

export function sharedCylinderGeometry(
    radiusTop = 1,
    radiusBottom = 1,
    height = 1,
    radialSegments = 32,
    heightSegments = 1,
    openEnded = false,
): CylinderGeometry {
    return sharedGeometry(
        `cylinder:${radiusTop}:${radiusBottom}:${height}:${radialSegments}:${heightSegments}:${openEnded}`,
        () => new CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded),
    ) as CylinderGeometry
}

export function sharedConeGeometry(radius = 1, height = 1, radialSegments = 32): ConeGeometry {
    return sharedGeometry(
        `cone:${radius}:${height}:${radialSegments}`,
        () => new ConeGeometry(radius, height, radialSegments),
    ) as ConeGeometry
}

export function sharedCapsuleGeometry(
    radius = 1,
    length = 1,
    capSegments = 4,
    radialSegments = 8,
): CapsuleGeometry {
    return sharedGeometry(
        `capsule:${radius}:${length}:${capSegments}:${radialSegments}`,
        () => new CapsuleGeometry(radius, length, capSegments, radialSegments),
    ) as CapsuleGeometry
}

export function sharedTorusGeometry(
    radius = 1,
    tube = 0.4,
    radialSegments = 12,
    tubularSegments = 48,
): TorusGeometry {
    return sharedGeometry(
        `torus:${radius}:${tube}:${radialSegments}:${tubularSegments}`,
        () => new TorusGeometry(radius, tube, radialSegments, tubularSegments),
    ) as TorusGeometry
}

function sharedGeometry(key: string, create: () => BufferGeometry): BufferGeometry {
    let existing = geometryByKey.get(key)
    if (!existing) {
        existing = create()
        existing.userData[SHARED_ASSET_RESOURCE] = true
        geometryByKey.set(key, existing)
    }
    return existing
}
