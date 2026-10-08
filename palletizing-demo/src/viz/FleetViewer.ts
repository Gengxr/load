/**
 * 多盘总览：整托货物暂存区里并排摆放的全部货盘（每盘是真实的码放结果）
 */
import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import type { Placement } from '../algo/types'
import { MM, Stage3D, buildPalletBase, buildStack, growStack, easeInOut, type Quality, type StackMesh } from './Stage3D'

export interface FleetPallet {
  id: string
  placements: Placement[]
  colors: string[]
  ok: boolean
}

interface Bay {
  group: THREE.Group
  stack: StackMesh
  tile: Line2
  tileMat: LineMaterial
  pick: THREE.Mesh
  pos: THREE.Vector3
  top: number
  ok: boolean
}

const PITCH = 1.82
const PALLET_H = 0.075
const ACCENT = 0x2ee0f0

export class FleetViewer extends Stage3D {
  private bays: Bay[] = []
  private root = new THREE.Group()
  private focus = -1
  private hover = -1
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private down = { x: 0, y: 0 }
  private zone: THREE.Mesh | null = null
  onPick: ((i: number) => void) | null = null
  onHover: ((i: number) => void) | null = null
  onOpen: ((i: number) => void) | null = null

  constructor(container: HTMLElement, quality: Quality = 'auto') {
    super(container, { fov: 34, minDistance: 2.5, maxDistance: 26, shadowExtent: 6.5, floorSize: 44, quality })
    this.scene.add(this.root)
    const el = this.renderer.domElement
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerleave', this.onLeave)
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('dblclick', this.onDbl)
    this.resetCamera(false)
  }

  /** 货盘排布：不超过 4 盘排成一行，更多时排成两行 */
  private layout(n: number): THREE.Vector3[] {
    const rows = n > 4 ? 2 : 1
    const cols = Math.ceil(n / rows)
    const out: THREE.Vector3[] = []
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols)
      const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols
      const c = i - r * cols
      out.push(new THREE.Vector3((c - (inRow - 1) / 2) * PITCH, PALLET_H, (r - (rows - 1) / 2) * PITCH * 1.08))
    }
    return out
  }

  setPallets(list: FleetPallet[], FX: number, FY: number, animate = true) {
    for (const b of this.bays) {
      this.root.remove(b.group)
      b.stack.mesh.dispose()
      b.tile.geometry.dispose()
      b.tileMat.dispose()
      b.pick.geometry.dispose()
    }
    if (this.zone) {
      this.root.remove(this.zone)
      this.zone.geometry.dispose()
      ;(this.zone.material as THREE.MeshBasicMaterial).map?.dispose()
      ;(this.zone.material as THREE.Material).dispose()
      this.zone = null
    }
    this.bays = []
    this.focus = -1
    this.hover = -1
    const pos = this.layout(list.length)
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    list.forEach((p, i) => {
      const group = new THREE.Group()
      group.position.copy(pos[i])
      group.add(buildPalletBase())
      const stack = buildStack(p.placements, p.colors, FX, FY)
      group.add(stack.mesh)
      // 地面定位框
      const s = 0.78
      const geo = new LineGeometry()
      geo.setPositions([-s, 0, -s, s, 0, -s, s, 0, s, -s, 0, s, -s, 0, -s])
      const tileMat = new LineMaterial({ color: 0x5b6b82, linewidth: 1.6, transparent: true, opacity: 0.55, depthWrite: false })
      tileMat.resolution.set(w, h)
      const tile = new Line2(geo, tileMat)
      tile.position.y = -PALLET_H + 0.004
      group.add(tile)
      const top = stack.height
      const pick = new THREE.Mesh(new THREE.BoxGeometry(1.24, top + PALLET_H + 0.02, 1.24), new THREE.MeshBasicMaterial({ visible: false }))
      pick.position.y = (top - PALLET_H) / 2
      pick.userData.index = i
      group.add(pick)
      this.root.add(group)
      this.bays.push({ group, stack, tile, tileMat, pick, pos: pos[i], top, ok: p.ok })
    })
    this.buildZone(pos)
    this.controls.maxDistance = 18 + list.length * 2
    this.resetCamera(animate)
    if (animate && list.length) {
      this.bays.forEach((b) => growStack(b.stack, 0))
      const n = this.bays.length
      this.tween(1500 + n * 110, (t) => {
        this.bays.forEach((b, i) => {
          const lag = n > 1 ? (i / (n - 1)) * 0.3 : 0
          growStack(b.stack, Math.max(0, Math.min(1, (t - lag) / (1 - 0.3 * (n > 1 ? 1 : 0)))))
        })
      })
    }
    this.dirty = true
  }

  /** 暂存区地面标识：浅色区域 + 黄色警示边线 */
  private buildZone(pos: THREE.Vector3[]) {
    if (!pos.length) return
    const xs = pos.map((p) => p.x)
    const zs = pos.map((p) => p.z)
    const W = Math.max(...xs) - Math.min(...xs) + PITCH + 0.5
    const D = Math.max(...zs) - Math.min(...zs) + PITCH + 0.5
    const k = 160
    const cv = document.createElement('canvas')
    cv.width = Math.round(W * k)
    cv.height = Math.round(D * k)
    const g = cv.getContext('2d')!
    const r = 0.16 * k
    const path = (inset: number) => {
      g.beginPath()
      g.roundRect(inset, inset, cv.width - inset * 2, cv.height - inset * 2, r)
    }
    path(6)
    g.fillStyle = 'rgba(120,150,190,0.055)'
    g.fill()
    path(10)
    g.setLineDash([26, 18])
    g.lineWidth = 5
    g.strokeStyle = 'rgba(255,194,75,0.55)'
    g.stroke()
    g.setLineDash([])
    g.font = `600 ${0.16 * k}px "PingFang SC", "Microsoft YaHei", sans-serif`
    g.fillStyle = 'rgba(255,255,255,0.22)'
    g.textBaseline = 'bottom'
    g.fillText('整托货物暂存区', 0.3 * k, cv.height - 0.2 * k)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
    zone.rotation.x = -Math.PI / 2
    zone.position.set((Math.max(...xs) + Math.min(...xs)) / 2, 0.002, (Math.max(...zs) + Math.min(...zs)) / 2)
    zone.renderOrder = -1
    this.zone = zone
    this.root.add(zone)
  }

  private extent() {
    const n = this.bays.length || 1
    const rows = n > 4 ? 2 : 1
    const cols = Math.ceil(n / rows)
    return { w: cols * PITCH, d: rows * PITCH * 1.08, h: 1.3 }
  }

  resetCamera(animate = true) {
    const { w, d, h } = this.extent()
    const dir = new THREE.Vector3(0.5, 0.6, 1).normalize()
    const target = new THREE.Vector3(0, h * 0.4, 0)
    // 暂存区包围盒的 8 个角 + 顶部标签的高度，全部落进可视区域
    const pts: THREE.Vector3[] = []
    for (const x of [-w / 2 - 0.15, w / 2 + 0.15]) for (const z of [-d / 2 - 0.15, d / 2 + 0.15]) for (const y of [0, h + 0.3]) pts.push(new THREE.Vector3(x, y, z))
    const dist = this.fitDistance(pts, target, dir, 0.93, 3.5)
    this.flyTo(target.clone().addScaledVector(dir, dist), target, animate ? 900 : 0)
  }

  focusOn(i: number) {
    this.setFocus(i)
    const b = this.bays[i]
    if (!b) return this.resetCamera()
    const target = new THREE.Vector3(b.pos.x, b.top * 0.5, b.pos.z)
    const dir = new THREE.Vector3(0.6, 0.58, 1).normalize()
    this.flyTo(target.clone().addScaledVector(dir, 5.4), target)
  }

  setFocus(i: number) {
    this.focus = i
    this.paint()
  }

  private paint() {
    this.bays.forEach((b, i) => {
      const on = i === this.focus
      const hv = i === this.hover
      b.tileMat.color.setHex(on ? ACCENT : hv ? 0xbfd3ea : b.ok ? 0x5b6b82 : 0xff6b6b)
      b.tileMat.opacity = on ? 1 : hv ? 0.9 : 0.55
      b.tileMat.linewidth = on ? 3 : 1.6
    })
    this.dirty = true
  }

  /** 各货盘顶部标签的屏幕位置 */
  labelPositions(): { x: number; y: number; visible: boolean }[] {
    return this.bays.map((b) => this.project(new THREE.Vector3(b.pos.x, b.pos.y + b.top + 0.16, b.pos.z)))
  }

  protected onResize(w: number, h: number) {
    for (const b of this.bays ?? []) b.tileMat.resolution.set(w, h)
  }

  private hit(e: PointerEvent | MouseEvent): number {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.bays.map((b) => b.pick), false)
    return hits.length ? (hits[0].object.userData.index as number) : -1
  }
  private onMove = (e: PointerEvent) => {
    if (e.buttons) return
    const i = this.hit(e)
    if (i !== this.hover) {
      this.hover = i
      this.renderer.domElement.style.cursor = i >= 0 ? 'pointer' : ''
      this.paint()
      this.onHover?.(i)
    }
  }
  private onLeave = () => {
    if (this.hover !== -1) {
      this.hover = -1
      this.paint()
      this.onHover?.(-1)
    }
  }
  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY }
  }
  private onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return
    this.onPick?.(this.hit(e))
  }
  private onDbl = (e: MouseEvent) => {
    const i = this.hit(e)
    if (i >= 0) this.onOpen?.(i)
  }

  /** 选中盘轻微呼吸 */
  protected onFrame(now: number) {
    const b = this.bays[this.focus]
    if (b) {
      b.tileMat.opacity = 0.7 + 0.3 * Math.sin(now / 320)
      this.dirty = true
    }
  }

  dispose() {
    const el = this.renderer.domElement
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerleave', this.onLeave)
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('dblclick', this.onDbl)
    super.dispose()
  }
}

export { MM, easeInOut }
