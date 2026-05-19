import { Vector3 } from 'three'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { System } from '../../engine/ecs/systems/system'

const SVG_NS = 'http://www.w3.org/2000/svg'
const SIZE = 112
const CENTER = SIZE / 2
const AXIS_LENGTH = 34
const MIN_PROJECTED_AXIS = 0.04

interface AxisView {
    line: SVGLineElement
    arrow: SVGPolygonElement
    dot: SVGCircleElement
    label: SVGTextElement
    axis: Vector3
    colour: string
    name: string
}

/**
 * Fixed viewport axis indicator for the editor. It is DOM/SVG rather than
 * scene geometry so it never participates in world depth, shadows, or the
 * top-down cut plane.
 */
export function createAxisGizmoSystem(iso: IsometricCamera): System {
    const root = document.createElement('div')
    root.className = 'vpe-axis-gizmo'

    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`)
    svg.setAttribute('width', String(SIZE))
    svg.setAttribute('height', String(SIZE))
    svg.setAttribute('aria-hidden', 'true')
    root.appendChild(svg)

    const axes: AxisView[] = [
        makeAxis(svg, 'X', '#ff625f', new Vector3(1, 0, 0)),
        makeAxis(svg, 'Y', '#65d66e', new Vector3(0, 1, 0)),
        makeAxis(svg, 'Z', '#5fa8ff', new Vector3(0, 0, 1)),
    ]

    const origin = new Vector3()
    const projectedOrigin = new Vector3()
    const projectedTip = new Vector3()

    return {
        order: RenderOrder.cameraControl + 2,
        init() {
            injectCss()
            document.body.appendChild(root)
        },
        update() {
            iso.camera.updateMatrixWorld(true)
            origin.copy(iso.target)
            projectedOrigin.copy(origin).project(iso.camera)

            for (const axis of axes) {
                projectedTip.copy(origin).add(axis.axis).project(iso.camera)
                const dx = projectedTip.x - projectedOrigin.x
                const dy = -(projectedTip.y - projectedOrigin.y)
                const len = Math.hypot(dx, dy)
                if (len < MIN_PROJECTED_AXIS) {
                    showDotAxis(axis)
                    continue
                }

                const nx = dx / len
                const ny = dy / len
                const x2 = CENTER + nx * AXIS_LENGTH
                const y2 = CENTER + ny * AXIS_LENGTH
                showLineAxis(axis, x2, y2, nx, ny)
            }
        },
        dispose() {
            root.remove()
        },
    }
}

function makeAxis(svg: SVGSVGElement, name: string, colour: string, axis: Vector3): AxisView {
    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('stroke', colour)
    line.setAttribute('stroke-width', '3')
    line.setAttribute('stroke-linecap', 'round')
    line.setAttribute('x1', String(CENTER))
    line.setAttribute('y1', String(CENTER))
    svg.appendChild(line)

    const arrow = document.createElementNS(SVG_NS, 'polygon')
    arrow.setAttribute('fill', colour)
    svg.appendChild(arrow)

    const dot = document.createElementNS(SVG_NS, 'circle')
    dot.setAttribute('cx', String(CENTER))
    dot.setAttribute('cy', String(CENTER))
    dot.setAttribute('r', '5')
    dot.setAttribute('fill', 'rgba(8, 12, 16, 0.92)')
    dot.setAttribute('stroke', colour)
    dot.setAttribute('stroke-width', '3')
    svg.appendChild(dot)

    const label = document.createElementNS(SVG_NS, 'text')
    label.textContent = name
    label.setAttribute('fill', colour)
    label.setAttribute('font-size', '12')
    label.setAttribute('font-weight', '700')
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('dominant-baseline', 'middle')
    svg.appendChild(label)

    return { line, arrow, dot, label, axis, colour, name }
}

function showLineAxis(axis: AxisView, x2: number, y2: number, nx: number, ny: number): void {
    axis.line.style.display = ''
    axis.arrow.style.display = ''
    axis.dot.style.display = 'none'

    axis.line.setAttribute('x2', x2.toFixed(2))
    axis.line.setAttribute('y2', y2.toFixed(2))

    const px = -ny
    const py = nx
    const bx = x2 - nx * 8
    const by = y2 - ny * 8
    axis.arrow.setAttribute('points', [
        `${x2.toFixed(2)},${y2.toFixed(2)}`,
        `${(bx + px * 4).toFixed(2)},${(by + py * 4).toFixed(2)}`,
        `${(bx - px * 4).toFixed(2)},${(by - py * 4).toFixed(2)}`,
    ].join(' '))

    axis.label.setAttribute('x', (x2 + nx * 13).toFixed(2))
    axis.label.setAttribute('y', (y2 + ny * 13).toFixed(2))
}

function showDotAxis(axis: AxisView): void {
    axis.line.style.display = 'none'
    axis.arrow.style.display = 'none'
    axis.dot.style.display = ''
    axis.label.setAttribute('x', String(CENTER))
    axis.label.setAttribute('y', String(CENTER - 16))
}

let cssInjected = false
function injectCss(): void {
    if (cssInjected) return
    cssInjected = true
    const style = document.createElement('style')
    style.textContent = `
.vpe-axis-gizmo {
    position: fixed;
    left: 12px;
    top: 42px;
    width: ${SIZE}px;
    height: ${SIZE}px;
    pointer-events: none;
    z-index: 950;
    border-radius: 6px;
    background: rgba(8, 12, 16, 0.44);
    box-shadow: 0 2px 10px rgba(0,0,0,0.22);
}
.vpe-axis-gizmo svg {
    display: block;
    overflow: visible;
}
`
    document.head.appendChild(style)
}
