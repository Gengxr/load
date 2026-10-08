/**
 * 三维场景基类：渲染器、相机、轨道控制、灯光环境、补间动画、可视区域偏移（浮动面板遮挡补偿）
 * 多盘总览（FleetViewer）与舱内装载（CabinViewer）共用。
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Placement } from '../algo/types'
import { floorTexture, glowTexture, palletTexture } from './textures'

export const MM = 0.001

export interface Tween {
  start: number
  dur: number
  update: (t: number) => void
  done?: () => void
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
export const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

export type Quality = 'auto' | 'hd' | 'uhd'

export interface StageOptions {
  fov: number
  minDistance: number
  maxDistance: number
  /** 阴影相机覆盖的半径（米） */
  shadowExtent: number
  floorSize: number
  quality: Quality
}

export class Stage3D {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  protected container: HTMLElement
  protected tweens: Tween[] = []
  protected dirty = true
  protected raf = 0
  private ro: ResizeObserver
  private insets = { l: 0, r: 0, t: 0, b: 0 }
  private viewOff = { x: 0, y: 0 }
  private quality: Quality
  protected keyLight!: THREE.DirectionalLight
  /** 每帧渲染后回调（用于更新 HTML 标签位置） */
  onRender: (() => void) | null = null

  constructor(container: HTMLElement, opts: Partial<StageOptions> = {}) {
    const o: StageOptions = { fov: 36, minDistance: 2, maxDistance: 30, shadowExtent: 6, floorSize: 40, quality: 'auto', ...opts }
    this.container = container
    this.quality = o.quality
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.setClearColor(0x000000, 0)
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.display = 'block'

    this.camera = new THREE.PerspectiveCamera(o.fov, 1, 0.05, 200)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = o.minDistance
    this.controls.maxDistance = o.maxDistance
    this.controls.maxPolarAngle = Math.PI * 0.495
    this.controls.addEventListener('change', () => (this.dirty = true))

    this.buildEnvironment(o.shadowExtent)
    this.buildFloor(o.floorSize)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    // 下一帧再启动循环：子类的字段此时尚未初始化
    this.raf = requestAnimationFrame(this.loop)
  }

  private buildEnvironment(ext: number) {
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.45
    pmrem.dispose()
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a2230, 0.55))
    const key = new THREE.DirectionalLight(0xfff4e6, 2.1)
    key.position.set(ext * 0.55, ext * 1.1, ext * 0.7)
    key.castShadow = true
    key.shadow.mapSize.set(4096, 4096)
    key.shadow.camera.left = -ext
    key.shadow.camera.right = ext
    key.shadow.camera.top = ext
    key.shadow.camera.bottom = -ext
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = ext * 4
    key.shadow.bias = -0.0005
    key.shadow.normalBias = 0.03
    key.shadow.radius = 4
    this.keyLight = key
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x7dd3fc, 0.9)
    rim.position.set(-ext, ext * 0.7, -ext)
    this.scene.add(rim)
    const fill = new THREE.DirectionalLight(0xc7d2fe, 0.35)
    fill.position.set(-ext * 0.8, ext * 0.5, ext * 0.8)
    this.scene.add(fill)
  }

  private buildFloor(size: number) {
    const tex = floorTexture()
    tex.repeat.set(size / 14, size / 14)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 }))
    grid.rotation.x = -Math.PI / 2
    grid.position.y = 0.0005
    grid.renderOrder = -2
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.ShadowMaterial({ opacity: 0.38 }))
    shadow.rotation.x = -Math.PI / 2
    shadow.receiveShadow = true
    shadow.renderOrder = -3
    this.scene.add(shadow, grid)
  }

  /** 地面上的柔光斑 */
  protected addGlow(x: number, z: number, size: number, color = 'rgba(56,189,248,0.18)') {
    const spot = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: glowTexture(color, 'rgba(56,189,248,0)'), transparent: true, depthWrite: false }))
    spot.rotation.x = -Math.PI / 2
    spot.position.set(x, 0.001, z)
    spot.renderOrder = -1
    this.scene.add(spot)
    return spot
  }

  tween(dur: number, update: (t: number) => void, done?: () => void) {
    this.tweens.push({ start: performance.now(), dur, update, done })
  }

  flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 800) {
    if (dur <= 0) {
      this.camera.position.copy(pos)
      this.controls.target.copy(target)
      this.controls.update()
      this.dirty = true
      return
    }
    const p0 = this.camera.position.clone()
    const t0 = this.controls.target.clone()
    this.tween(dur, (t) => {
      const e = easeInOut(t)
      this.camera.position.lerpVectors(p0, pos, e)
      this.controls.target.lerpVectors(t0, target, e)
      this.controls.update()
    })
  }

  /** 设置被浮动面板遮挡的边距（像素），画面中心平滑移到剩余可视区域的中心 */
  setViewInsets(ins: { l: number; r: number; t: number; b: number }, animate = true) {
    this.insets = ins
    const target = this.offsetTarget()
    if (!animate) return this.applyViewOffset(target.x, target.y)
    const from = { ...this.viewOff }
    this.tween(480, (t) => {
      const e = easeInOut(t)
      this.applyViewOffset(THREE.MathUtils.lerp(from.x, target.x, e), THREE.MathUtils.lerp(from.y, target.y, e))
    })
  }

  /** 可视区域（扣除面板后）的宽高比，供子类选择相机距离 */
  protected visibleAspect() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    const i = this.insets
    return Math.max(0.3, (w - i.l - i.r) / Math.max(1, h - i.t - i.b))
  }
  protected visibleFraction() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    const i = this.insets
    return { fx: Math.max(0.2, (w - i.l - i.r) / w), fy: Math.max(0.2, (h - i.t - i.b) / h) }
  }

  /**
   * 求相机距离：从 target 沿 dir 方向后退多远，才能让给定的点全部落在"扣除面板后的可视区域"内。
   * 二分搜索，margin 为可视区域内再留出的边距比例。
   */
  protected fitDistance(points: THREE.Vector3[], target: THREE.Vector3, dir: THREE.Vector3, margin = 0.9, min = 2, max = 80): number {
    const { fx, fy } = this.visibleFraction()
    const cam = new THREE.PerspectiveCamera(this.camera.fov, (this.container.clientWidth || 1) / (this.container.clientHeight || 1), 0.05, 400)
    const fits = (dist: number) => {
      cam.position.copy(target).addScaledVector(dir, dist)
      cam.lookAt(target)
      cam.updateMatrixWorld()
      cam.updateProjectionMatrix()
      const v = new THREE.Vector3()
      for (const p of points) {
        v.copy(p).project(cam)
        if (v.z > 1 || Math.abs(v.x) > fx * margin || Math.abs(v.y) > fy * margin) return false
      }
      return true
    }
    let lo = min
    let hi = max
    if (fits(lo)) return lo
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) hi = mid
      else lo = mid
    }
    return hi
  }

  private offsetTarget() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    const i = this.insets
    return { x: w / 2 - (i.l + (w - i.l - i.r) / 2), y: h / 2 - (i.t + (h - i.t - i.b) / 2) }
  }

  private applyViewOffset(x: number, y: number) {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.viewOff = { x, y }
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) this.camera.clearViewOffset()
    else this.camera.setViewOffset(w, h, x, y, w, h)
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on
    this.controls.autoRotateSpeed = 0.5
  }

  setQuality(q: Quality) {
    this.quality = q
    this.resize()
  }

  /** 世界坐标 → 容器内像素坐标 */
  project(v: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.camera)
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, visible: p.z < 1 && p.z > -1 }
  }

  snapshot(): string {
    this.renderer.render(this.scene, this.camera)
    return this.renderer.domElement.toDataURL('image/png')
  }

  protected onResize(_w: number, _h: number) {}
  protected onFrame(_now: number) {}

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    const dpr = window.devicePixelRatio || 1
    // 渲染分辨率：hd 保证后备缓冲不低于 1080p，uhd 再提高一档
    const ratio = this.quality === 'auto' ? Math.min(dpr, 2) : this.quality === 'hd' ? Math.min(3, Math.max(dpr, 1080 / h, 1920 / w)) : Math.min(3, Math.max(dpr, 2, 2160 / h))
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = w + 'px'
    this.renderer.domElement.style.height = h + 'px'
    this.camera.aspect = w / h
    const t = this.offsetTarget()
    this.applyViewOffset(t.x, t.y)
    this.onResize(w, h)
    this.dirty = true
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    if (this.tweens.length) {
      const active = this.tweens
      this.tweens = []
      const keep: Tween[] = []
      for (const t of active) {
        const u = clamp01((now - t.start) / t.dur)
        t.update(u)
        if (u >= 1) t.done?.()
        else keep.push(t)
      }
      this.tweens = keep.concat(this.tweens)
      this.dirty = true
    }
    this.onFrame(now)
    if (this.controls.autoRotate) this.dirty = true
    this.controls.update()
    if (this.dirty) {
      this.renderer.render(this.scene, this.camera)
      this.dirty = false
      this.onRender?.()
    }
  }

  invalidate() {
    this.dirty = true
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.controls.dispose()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

// ───────────────────────── 共用模型 ─────────────────────────

let boxMat: THREE.MeshStandardMaterial | null = null
/** 纸箱材质：实例化渲染 + 着色器里按 UV 画出等宽的箱体棱线（不随箱子大小变粗细） */
export function cartonMaterial(): THREE.MeshStandardMaterial {
  if (boxMat) return boxMat
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.02 })
  m.defines = { ...(m.defines ?? {}), USE_UV: '' }
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        vec2 e2 = min(vUv, 1.0 - vUv);
        float d = min(e2.x, e2.y);
        float w = fwidth(d) * 1.35;
        float edge = smoothstep(0.0, w, d);
        diffuseColor.rgb *= mix(0.5, 1.0, edge);
      }`,
    )
  }
  boxMat = m
  return m
}

const unitBox = new THREE.BoxGeometry(1, 1, 1)

export interface StackMesh {
  mesh: THREE.InstancedMesh
  /** 每件的中心与尺寸（货盘局部坐标，米），用于生长动画 */
  items: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[]
  height: number
}

/** 一个货盘上的整垛货物（实例化网格）；局部原点在货盘上表面中心 */
export function buildStack(placements: Placement[], colors: string[], FX: number, FY: number): StackMesh {
  const n = placements.length
  const mesh = new THREE.InstancedMesh(unitBox, cartonMaterial(), Math.max(1, n))
  mesh.count = n
  mesh.castShadow = true
  mesh.receiveShadow = true
  const items: StackMesh['items'] = []
  const m4 = new THREE.Matrix4()
  const c = new THREE.Color()
  let height = 0
  placements.forEach((p, i) => {
    const it = {
      x: (p.x + p.dx / 2 - FX / 2) * MM,
      y: (p.z + p.dz / 2) * MM,
      z: -(p.y + p.dy / 2 - FY / 2) * MM,
      sx: p.dx * MM - 0.0015,
      sy: p.dz * MM - 0.0008,
      sz: p.dy * MM - 0.0015,
    }
    items.push(it)
    height = Math.max(height, (p.z + p.dz) * MM)
    m4.makeScale(it.sx, it.sy, it.sz).setPosition(it.x, it.y, it.z)
    mesh.setMatrixAt(i, m4)
    // 轻微的明度抖动，避免同规格箱子连成一片
    const j = 0.93 + 0.1 * (((i * 2654435761) >>> 0) / 4294967296)
    c.set(colors[i] ?? '#cbd5e1').multiplyScalar(j)
    mesh.setColorAt(i, c)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  return { mesh, items, height }
}

/** 把整垛货物设置为"生长到 f"的状态：按高度自下而上出现，带轻微下落 */
export function growStack(s: StackMesh, f: number) {
  const m4 = new THREE.Matrix4()
  const H = Math.max(0.2, s.height)
  s.items.forEach((it, i) => {
    const start = ((it.y - it.sy / 2) / H) * 0.72
    const t = clamp01((f - start) / 0.28)
    const e = easeOut(t)
    if (t <= 0) m4.makeScale(1e-6, 1e-6, 1e-6).setPosition(it.x, it.y, it.z)
    else m4.makeScale(it.sx, it.sy, it.sz).setPosition(it.x, it.y + (1 - e) * 0.35, it.z)
    s.mesh.setMatrixAt(i, m4)
  })
  s.mesh.instanceMatrix.needsUpdate = true
}

let palMats: THREE.Material[] | null = null
/** 航空货盘 1219×1219×75（简化模型）；局部原点在货盘上表面中心 */
export function buildPalletBase(L = 1.219, W = 1.219, H = 0.075): THREE.Group {
  if (!palMats) {
    const top = new THREE.MeshStandardMaterial({ color: 0x9ea7b4, metalness: 0.8, roughness: 0.42, map: palletTexture() })
    const side = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.85, roughness: 0.32 })
    palMats = [side, side, top, side, side, side]
  }
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), palMats)
  body.position.y = -H / 2
  body.castShadow = body.receiveShadow = true
  g.add(body)
  return g
}
