/**
 * 三维码放场景（Three.js）
 *
 * 场景：重心重量测量台（三点称重）→ 航空货盘 1219×1219×75 → 垛形边界 1000×1000×H
 *       左侧辊道输送线按出库顺序送来散货；货物逐件"抓取—抬升—平移—竖直下放"。
 * 重心：系统重心球 + 铅垂线 + 货盘面上的容差区（±10%）与重心轨迹（透视显示）。
 *
 * 坐标：算法 mm（X 右、Y 远离操作者、Z 上）→ 世界 m（X 右、Y 上、Z 朝向操作者）。
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import type { PalletSpec, Placement, StepSeries } from '../algo/types'
import { cartonTexture, floorTexture, glowTexture, numberTexture, palletTexture } from './textures'
import { ACCENT, BAD, COG, OK } from './palette'

const MM = 0.001
const PLATFORM_H = 0.12
const CONV_Y = 0.46
const CONV_END_X = -0.84
const CONV_LEN = 2.1
const QUEUE = 6

export interface ViewerPlan {
  placements: Placement[]
  order: number[]
  steps: StepSeries
  supporters: number[][]
  colors: string[]
  footprintX: number
  footprintY: number
  maxHeight: number
  pallet: PalletSpec
  /** 容差区半边长 mm（= 偏移限值 × 基准长度） */
  tolHalf: number
  tolRatio: number
}

export interface ViewerOptions {
  showConveyor: boolean
  accent: string
  /** 紧凑模式（对比视图）：相机更近，关闭部分装饰 */
  compact: boolean
  /** 暂停时显示下一件的目标位置虚影 */
  previewNext: boolean
}

export type CameraPreset = 'iso' | 'top' | 'front' | 'side' | 'operator'

interface Tween {
  start: number
  dur: number
  update: (t: number) => void
  done: () => void
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

export class PalletViewer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private container: HTMLElement
  private opts: ViewerOptions
  private ro: ResizeObserver
  private raf = 0
  private tweens: Tween[] = []
  private dirty = true

  private plan: ViewerPlan | null = null
  private step = 0
  private seqIndex: number[] = [] // placement → 码放序号
  private boxes: THREE.Mesh[] = []
  private labels: (THREE.Mesh | null)[] = []
  private boxGroup = new THREE.Group()
  private geoCache = new Map<string, THREE.BufferGeometry>()
  private edgeCache = new Map<string, THREE.BufferGeometry>()
  private matCache = new Map<string, THREE.MeshStandardMaterial>()
  private cardboard = cartonTexture()
  private edgeMat = new THREE.LineBasicMaterial({ color: 0x0f141c, transparent: true, opacity: 0.32 })
  private labelTex = new Map<number, THREE.Texture>()
  private showLabels = false
  private layerLimit: number | null = null
  private hover = -1
  private highlighted = new Set<number>()

  // 重心
  private cogGroup = new THREE.Group()
  private cogSphere!: THREE.Mesh
  private cogGlow!: THREE.Sprite
  private plumb!: THREE.Line
  private footDot!: THREE.Mesh
  private tolFill!: THREE.Mesh
  private tolLine!: THREE.LineLoop
  private trail!: Line2
  private trailMat!: LineMaterial
  private cogVisible = true

  // 动画辅助
  private ghost!: THREE.Mesh
  private ghostEdges!: THREE.LineSegments
  private pulse!: THREE.Mesh
  private envelope!: THREE.LineSegments
  private conveyor = new THREE.Group()
  private stageGroup = new THREE.Group()
  private animating = false
  private animBox = -1

  // 可视区域（扣除浮动面板后的空白区），相机光轴对准其中心
  private insets = { l: 0, r: 0, t: 0, b: 0 }
  private viewOff = { x: 0, y: 0 }

  onHover: (index: number | null, x: number, y: number) => void = () => {}
  onStep: (k: number) => void = () => {}

  constructor(container: HTMLElement, opts: Partial<ViewerOptions> = {}) {
    this.container = container
    this.opts = { showConveyor: true, accent: ACCENT, compact: false, previewNext: true, ...opts }
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.setClearColor(0x000000, 0)
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.display = 'block'

    this.camera = new THREE.PerspectiveCamera(this.opts.compact ? 36 : 38, 1, 0.05, 60)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 1.2
    this.controls.maxDistance = 9
    this.controls.maxPolarAngle = Math.PI * 0.495
    this.controls.addEventListener('change', () => (this.dirty = true))

    this.buildEnvironment()
    this.buildStage()
    this.buildCog()
    this.buildHelpers()
    this.scene.add(this.stageGroup, this.boxGroup, this.cogGroup)
    this.setCameraPreset('iso', false)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave)
    this.loop()
  }

  // ───────────────────────── 场景搭建 ─────────────────────────

  private buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.45
    pmrem.dispose()

    const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x1a2230, 0.55)
    this.scene.add(hemi)
    const key = new THREE.DirectionalLight(0xfff4e6, 2.1)
    key.position.set(2.6, 4.2, 3.0)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -2.4
    key.shadow.camera.right = 2.4
    key.shadow.camera.top = 2.4
    key.shadow.camera.bottom = -2.4
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 12
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    key.shadow.radius = 4
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x7dd3fc, 0.9)
    rim.position.set(-3, 2.2, -3.2)
    this.scene.add(rim)
    const fill = new THREE.DirectionalLight(0xc7d2fe, 0.35)
    fill.position.set(-2.5, 1.5, 2.5)
    this.scene.add(fill)
  }

  private buildStage() {
    const floorY = -0.075 - PLATFORM_H
    // 地面网格 + 阴影
    const grid = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshBasicMaterial({ map: floorTexture(), transparent: true, depthWrite: false }),
    )
    grid.rotation.x = -Math.PI / 2
    grid.position.y = floorY + 0.0005
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.38 }))
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = floorY
    shadow.receiveShadow = true
    const spot = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 4.2),
      new THREE.MeshBasicMaterial({ map: glowTexture('rgba(56,189,248,0.20)', 'rgba(56,189,248,0)'), transparent: true, depthWrite: false }),
    )
    spot.rotation.x = -Math.PI / 2
    spot.position.y = floorY + 0.001
    this.stageGroup.add(shadow, grid, spot)

    // 重心重量测量台（三点称重）
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b3340, metalness: 0.7, roughness: 0.45 })
    const plat = new THREE.Mesh(new THREE.BoxGeometry(1.36, PLATFORM_H - 0.03, 1.36), metal)
    plat.position.y = -0.075 - 0.03 - (PLATFORM_H - 0.03) / 2
    plat.castShadow = plat.receiveShadow = true
    const topPlate = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.03, 1.3),
      new THREE.MeshStandardMaterial({ color: 0x3a4454, metalness: 0.8, roughness: 0.35 }),
    )
    topPlate.position.y = -0.075 - 0.015
    topPlate.castShadow = topPlate.receiveShadow = true
    this.stageGroup.add(plat, topPlate)
    const cellMat = new THREE.MeshStandardMaterial({ color: 0xc7ced8, metalness: 0.9, roughness: 0.25 })
    const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.opts.accent) })
    const cells: [number, number][] = [
      [-0.55, 0.55],
      [0.55, 0.55],
      [0, -0.6],
    ]
    for (const [x, z] of cells) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.05, 32), cellMat)
      c.position.set(x, floorY + 0.025, z)
      c.castShadow = true
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 16), ledMat)
      led.position.set(x + (x ? Math.sign(x) * 0.02 : 0), -0.075 - 0.06, z + (z > 0 ? 0.682 - z : -0.682 - z))
      this.stageGroup.add(c, led)
    }

    // 航空货盘
    const pl = 1.219
    const pal = new THREE.Group()
    const topMat = new THREE.MeshStandardMaterial({ color: 0x9ea7b4, metalness: 0.8, roughness: 0.42, map: palletTexture() })
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.85, roughness: 0.32 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(pl, 0.075, pl), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat])
    body.position.y = -0.0375
    body.castShadow = body.receiveShadow = true
    pal.add(body)
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x6b7686, metalness: 0.9, roughness: 0.3 })
    for (const [w, d, x, z] of [
      [pl, 0.035, 0, pl / 2 - 0.0175],
      [pl, 0.035, 0, -pl / 2 + 0.0175],
      [0.035, pl, pl / 2 - 0.0175, 0],
      [0.035, pl, -pl / 2 + 0.0175, 0],
    ]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), rimMat)
      r.position.set(x, 0.006, z)
      r.castShadow = true
      pal.add(r)
    }
    // 系留环
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.95, roughness: 0.2 })
    for (let i = -2; i <= 2; i++) {
      for (const side of [0, 1, 2, 3]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 8, 24), ringMat)
        const t = i * 0.24
        const e = pl / 2 + 0.006
        if (side === 0) ring.position.set(t, -0.035, e)
        if (side === 1) ring.position.set(t, -0.035, -e)
        if (side === 2) (ring.position.set(e, -0.035, t), (ring.rotation.y = Math.PI / 2))
        if (side === 3) (ring.position.set(-e, -0.035, t), (ring.rotation.y = Math.PI / 2))
        pal.add(ring)
      }
    }
    this.stageGroup.add(pal)
    this.buildConveyor()
  }

  private buildConveyor() {
    const g = this.conveyor
    const frame = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.5 })
    const roller = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.9, roughness: 0.22 })
    const x0 = CONV_END_X - CONV_LEN
    const cx = CONV_END_X - CONV_LEN / 2
    const W = 0.62
    for (const z of [-W / 2, W / 2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(CONV_LEN, 0.07, 0.035), frame)
      rail.position.set(cx, CONV_Y - 0.03, z)
      rail.castShadow = true
      g.add(rail)
    }
    const rollerGeo = new THREE.CylinderGeometry(0.022, 0.022, W - 0.03, 20)
    for (let x = x0 + 0.05; x < CONV_END_X; x += 0.075) {
      const r = new THREE.Mesh(rollerGeo, roller)
      r.rotation.x = Math.PI / 2
      r.position.set(x, CONV_Y - 0.022, 0)
      r.castShadow = true
      g.add(r)
    }
    const floorY = -0.075 - PLATFORM_H
    const legGeo = new THREE.BoxGeometry(0.04, CONV_Y - 0.06 - floorY, 0.04)
    for (const x of [x0 + 0.12, cx, CONV_END_X - 0.12])
      for (const z of [-W / 2, W / 2]) {
        const leg = new THREE.Mesh(legGeo, frame)
        leg.position.set(x, floorY + (CONV_Y - 0.06 - floorY) / 2, z)
        leg.castShadow = true
        g.add(leg)
      }
    // 端部挡块 + 指示灯
    const stop = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, W), new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.3, roughness: 0.5 }))
    stop.position.set(CONV_END_X + 0.015, CONV_Y + 0.0, 0)
    g.add(stop)
    g.visible = this.opts.showConveyor
    this.stageGroup.add(g)
  }

  private buildCog() {
    const cogColor = new THREE.Color(COG)
    this.cogSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 32, 32),
      new THREE.MeshBasicMaterial({ color: cogColor, depthTest: false, transparent: true }),
    )
    this.cogSphere.renderOrder = 30
    this.cogGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture('rgba(251,191,36,0.9)', 'rgba(251,191,36,0)'), depthTest: false, transparent: true, blending: THREE.AdditiveBlending }),
    )
    this.cogGlow.scale.setScalar(0.16)
    this.cogGlow.renderOrder = 29
    const plumbGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)])
    this.plumb = new THREE.Line(plumbGeo, new THREE.LineDashedMaterial({ color: cogColor, dashSize: 0.02, gapSize: 0.014, depthTest: false, transparent: true, opacity: 0.9 }))
    this.plumb.renderOrder = 28
    this.footDot = new THREE.Mesh(
      new THREE.RingGeometry(0.012, 0.022, 32),
      new THREE.MeshBasicMaterial({ color: cogColor, depthTest: false, transparent: true, side: THREE.DoubleSide }),
    )
    this.footDot.rotation.x = -Math.PI / 2
    this.footDot.renderOrder = 27

    this.tolFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(OK), transparent: true, opacity: 0.14, depthTest: false, side: THREE.DoubleSide }),
    )
    this.tolFill.rotation.x = -Math.PI / 2
    this.tolFill.renderOrder = 25
    this.tolLine = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 0, -0.5), new THREE.Vector3(0.5, 0, 0.5), new THREE.Vector3(-0.5, 0, 0.5)]),
      new THREE.LineBasicMaterial({ color: new THREE.Color(OK), transparent: true, opacity: 0.85, depthTest: false }),
    )
    this.tolLine.renderOrder = 26

    this.trailMat = new LineMaterial({ color: new THREE.Color(this.opts.accent).getHex(), linewidth: 2.4, transparent: true, opacity: 0.95, depthTest: false })
    this.trail = new Line2(new LineGeometry(), this.trailMat)
    this.trail.renderOrder = 26
    this.trail.visible = false

    this.cogGroup.add(this.tolFill, this.tolLine, this.trail, this.plumb, this.footDot, this.cogGlow, this.cogSphere)
  }

  private buildHelpers() {
    const accent = new THREE.Color(this.opts.accent)
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.12, depthWrite: false }))
    this.ghostEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.9 }),
    )
    this.ghost.add(this.ghostEdges)
    this.ghost.visible = false
    this.pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.5, 48),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    )
    this.pulse.rotation.x = -Math.PI / 2
    this.scene.add(this.ghost, this.pulse)
  }

  private buildEnvelope(p: ViewerPlan) {
    if (this.envelope) {
      this.scene.remove(this.envelope)
      this.envelope.geometry.dispose()
    }
    const w = p.footprintX * MM
    const d = p.footprintY * MM
    const h = p.maxHeight * MM
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d))
    this.envelope = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({ color: new THREE.Color(this.opts.accent), dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.32 }))
    this.envelope.computeLineDistances()
    this.envelope.position.y = h / 2
    this.scene.add(this.envelope)
    // 垛形区域外框（货盘面）
    const fp = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, 0, -d / 2), new THREE.Vector3(w / 2, 0, d / 2), new THREE.Vector3(-w / 2, 0, d / 2)]),
      new THREE.LineBasicMaterial({ color: new THREE.Color(this.opts.accent), transparent: true, opacity: 0.7 }),
    )
    fp.position.y = -h / 2 + 0.0015
    this.envelope.add(fp)
  }

  // ───────────────────────── 方案 ─────────────────────────

  private toWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.plan!
    return out.set((x - p.footprintX / 2) * MM, z * MM, -(y - p.footprintY / 2) * MM)
  }

  setPlan(plan: ViewerPlan | null) {
    this.finishTweens()
    for (let i = 0; i < this.boxes.length; i++) this.setEmissive(i, 0)
    for (const b of this.boxes) this.boxGroup.remove(b)
    for (const l of this.labels)
      if (l) {
        l.parent?.remove(l)
        l.geometry.dispose()
        ;(l.material as THREE.Material).dispose()
      }
    this.boxes = []
    this.labels = []
    this.highlighted.clear()
    this.hover = -1
    this.plan = plan
    if (!plan) {
      this.cogGroup.visible = false
      this.dirty = true
      return
    }
    this.buildEnvelope(plan)
    this.seqIndex = new Array(plan.placements.length).fill(0)
    plan.order.forEach((pi, k) => (this.seqIndex[pi] = k))
    plan.placements.forEach((p, i) => {
      const key = `${p.dx}x${p.dy}x${p.dz}`
      let geo = this.geoCache.get(key)
      if (!geo) {
        const r = Math.min(6, Math.min(p.dx, p.dy, p.dz) * 0.06) * MM
        geo = new RoundedBoxGeometry(p.dx * MM, p.dz * MM, p.dy * MM, 2, r)
        this.geoCache.set(key, geo)
        this.edgeCache.set(key, new THREE.EdgesGeometry(new THREE.BoxGeometry(p.dx * MM, p.dz * MM, p.dy * MM)))
      }
      const mat = this.material(plan.colors[i])
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = mesh.receiveShadow = true
      mesh.userData.index = i
      const edges = new THREE.LineSegments(this.edgeCache.get(key)!, this.edgeMat)
      mesh.add(edges)
      mesh.visible = false
      this.boxes.push(mesh)
      this.labels.push(null)
      this.boxGroup.add(mesh)
    })
    const s = plan.tolHalf * 2 * MM
    this.tolFill.scale.set(s, s, 1)
    this.tolLine.scale.set(s, 1, s)
    this.cogGroup.visible = this.cogVisible
    this.gotoStep(0)
  }

  private material(color: string): THREE.MeshStandardMaterial {
    let m = this.matCache.get(color)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.82, metalness: 0.0, map: this.cardboard })
      this.matCache.set(color, m)
    }
    return m
  }

  get currentStep() {
    return this.step
  }

  get isAnimating() {
    return this.animating
  }

  /** 立即跳到第 k 步（前 k 件已放好） */
  gotoStep(k: number) {
    this.finishTweens()
    const p = this.plan
    if (!p) return
    k = Math.max(0, Math.min(p.order.length, k))
    this.step = k
    const placed = new Set(p.order.slice(0, k))
    p.placements.forEach((pl, i) => {
      const m = this.boxes[i]
      if (placed.has(i)) {
        this.toWorld(pl.x + pl.dx / 2, pl.y + pl.dy / 2, pl.z + pl.dz / 2, m.position)
        m.rotation.set(0, 0, 0)
        m.scale.setScalar(1)
        m.visible = this.layerLimit === null || pl.layer <= this.layerLimit
      } else m.visible = false
    })
    this.layoutQueue(k, 0)
    this.updateLabels()
    this.setCog(k, 0)
    this.applyHighlight()
    this.previewGhost()
    this.dirty = true
    this.onStep(k)
  }

  /** 暂停状态：在下一件的目标位置显示呼吸虚影 */
  private previewGhost() {
    const p = this.plan
    if (!p || this.animating || !this.opts.previewNext || this.step >= p.order.length) {
      if (!this.animating) this.ghost.visible = false
      return
    }
    const pl = p.placements[p.order[this.step]]
    this.toWorld(pl.x + pl.dx / 2, pl.y + pl.dy / 2, pl.z + pl.dz / 2, this.ghost.position)
    this.ghost.scale.set(pl.dx * MM * 1.002, pl.dz * MM * 1.002, pl.dy * MM * 1.002)
    this.ghost.visible = this.layerLimit === null || pl.layer <= this.layerLimit
  }

  /**
   * 输送线上排队的货物：第 k 步时，接下来 QUEUE 件依次排在辊道上。
   * shift ∈ (0,1] 表示从第 k−1 步到第 k 步的前移动画进度（每件从上一步的槽位前移一格，末位淡入）。
   */
  private layoutQueue(k: number, shift: number) {
    const p = this.plan!
    if (!this.opts.showConveyor) return
    for (let q = 0; q < QUEUE && k + q < p.order.length; q++) {
      const idx = p.order[k + q]
      const pl = p.placements[idx]
      const m = this.boxes[idx]
      const target = this.queueSlotX(k, q)
      const xPos = shift > 0 && k > 0 ? THREE.MathUtils.lerp(this.queueSlotX(k - 1, q + 1), target, easeInOut(shift)) : target
      const minX = CONV_END_X - CONV_LEN + Math.max(pl.dx, pl.dy) * MM * 0.5
      m.visible = xPos >= minX - 0.4
      m.position.set(xPos, CONV_Y + (pl.dz * MM) / 2, 0)
      m.rotation.set(0, pl.dx >= pl.dy ? 0 : Math.PI / 2, 0)
      const fade = q === QUEUE - 1 && shift > 0 ? easeInOut(shift) : 1
      m.scale.setScalar(0.5 + 0.5 * fade)
    }
  }

  /** 第 k 步时，第 q 个排队槽位的 x（用于前移插值） */
  private queueSlotX(k: number, q: number): number {
    const p = this.plan!
    let x = CONV_END_X - 0.04
    for (let i = 0; i <= q && k + i < p.order.length; i++) {
      const pl = p.placements[p.order[k + i]]
      const len = Math.max(pl.dx, pl.dy) * MM
      if (i === q) return x - len / 2
      x -= len + 0.06
    }
    return x
  }

  /** 动画：码放第 k+1 件 */
  animateNext(durationMs = 1100): Promise<void> {
    const p = this.plan
    if (!p || this.step >= p.order.length) return Promise.resolve()
    this.finishTweens()
    const k = this.step
    const idx = p.order[k]
    const pl = p.placements[idx]
    const m = this.boxes[idx]
    const target = this.toWorld(pl.x + pl.dx / 2, pl.y + pl.dy / 2, pl.z + pl.dz / 2)
    const start = this.opts.showConveyor
      ? new THREE.Vector3(this.queueSlotX(k, 0), CONV_Y + (pl.dz * MM) / 2, 0)
      : new THREE.Vector3(target.x * 0.2 - 1.1, target.y + 0.6, target.z * 0.2 + 0.6)
    const startYaw = this.opts.showConveyor ? (pl.dx >= pl.dy ? 0 : Math.PI / 2) : 0
    let stackTop = 0
    for (const j of p.order.slice(0, k)) stackTop = Math.max(stackTop, (p.placements[j].z + p.placements[j].dz) * MM)
    const safeY = Math.max(stackTop + (pl.dz * MM) / 2 + 0.22, start.y + 0.18, target.y + 0.2)
    const visibleNow = this.layerLimit === null || pl.layer <= this.layerLimit
    m.visible = visibleNow
    m.scale.setScalar(1)
    this.animating = true
    this.animBox = idx
    // 目标虚影
    this.ghost.visible = visibleNow
    this.ghost.position.copy(target)
    this.ghost.scale.set(pl.dx * MM * 1.002, pl.dz * MM * 1.002, pl.dy * MM * 1.002)
    const supporters = p.supporters[idx]
    const tmp = new THREE.Vector3()
    return new Promise((resolve) => {
      this.tweens.push({
        start: performance.now(),
        dur: durationMs,
        update: (t) => {
          const a = clamp01(t / 0.2)
          const b = clamp01((t - 0.2) / 0.42)
          const c = clamp01((t - 0.62) / 0.38)
          if (t < 0.2) {
            tmp.set(start.x, THREE.MathUtils.lerp(start.y, safeY, easeInOut(a)), start.z)
          } else if (t < 0.62) {
            const e = easeInOut(b)
            tmp.set(THREE.MathUtils.lerp(start.x, target.x, e), safeY + Math.sin(Math.PI * e) * 0.05, THREE.MathUtils.lerp(start.z, target.z, e))
          } else {
            tmp.set(target.x, THREE.MathUtils.lerp(safeY, target.y, easeOut(c)), target.z)
          }
          m.position.copy(tmp)
          m.rotation.y = THREE.MathUtils.lerp(startYaw, 0, easeInOut(b))
          ;(this.ghostEdges.material as THREE.LineBasicMaterial).opacity = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * Math.PI * 6))
          this.layoutQueue(k + 1, clamp01(t / 0.6))
          // 支撑件高亮
          const glow = t > 0.55 ? Math.sin(Math.PI * clamp01((t - 0.55) / 0.45)) : 0
          for (const s of supporters) this.setEmissive(s, glow * 0.35, this.opts.accent)
          this.setCog(k, easeOut(c))
        },
        done: () => {
          for (const s of supporters) this.setEmissive(s, 0)
          m.position.copy(target)
          m.rotation.set(0, 0, 0)
          this.ghost.visible = false
          this.animating = false
          this.animBox = -1
          this.step = k + 1
          this.layoutQueue(k + 1, 0)
          this.updateLabels()
          this.setCog(k + 1, 0)
          this.firePulse(pl)
          this.applyHighlight()
          this.previewGhost()
          this.onStep(this.step)
          resolve()
        },
      })
    })
  }

  private firePulse(pl: Placement) {
    const pos = this.toWorld(pl.x + pl.dx / 2, pl.y + pl.dy / 2, pl.z + 1)
    this.pulse.position.copy(pos)
    const base = Math.max(pl.dx, pl.dy) * MM
    const mat = this.pulse.material as THREE.MeshBasicMaterial
    this.tweens.push({
      start: performance.now(),
      dur: 520,
      update: (t) => {
        this.pulse.scale.setScalar(base * (1 + t * 0.9))
        mat.opacity = 0.55 * (1 - t)
      },
      done: () => (mat.opacity = 0),
    })
  }

  private finishTweens() {
    const ts = this.tweens
    this.tweens = []
    for (const t of ts) {
      t.update(1)
      t.done()
    }
  }

  private setEmissive(i: number, v: number, color = this.opts.accent) {
    const m = this.boxes[i]
    if (!m) return
    if (v <= 0) {
      if (m.material !== this.material(this.plan!.colors[i])) {
        ;(m.material as THREE.Material).dispose()
        m.material = this.material(this.plan!.colors[i])
      }
      return
    }
    let mat = m.material as THREE.MeshStandardMaterial
    if (mat === this.material(this.plan!.colors[i])) {
      mat = mat.clone()
      m.material = mat
    }
    mat.emissive.set(color)
    mat.emissiveIntensity = v
  }

  // ───────────────────────── 重心 ─────────────────────────

  private setCog(k: number, frac: number) {
    const p = this.plan
    if (!p) return
    const s = p.steps
    const k1 = Math.min(k + 1, s.cogX.length - 1)
    const lerp = (a: number[], i: number) => THREE.MathUtils.lerp(a[k], a[k1], i)
    const x = lerp(s.cogX, frac)
    const y = lerp(s.cogY, frac)
    const z = lerp(s.cogZ, frac)
    const ratio = lerp(s.ratio, frac)
    const pos = this.toWorld(x, y, z)
    this.cogSphere.position.copy(pos)
    this.cogGlow.position.copy(pos)
    const foot = this.toWorld(x, y, 0)
    foot.y = 0.004
    this.footDot.position.copy(foot)
    const pts = this.plumb.geometry.attributes.position as THREE.BufferAttribute
    pts.setXYZ(0, pos.x, pos.y, pos.z)
    pts.setXYZ(1, foot.x, foot.y, foot.z)
    pts.needsUpdate = true
    this.plumb.computeLineDistances()
    this.plumb.geometry.computeBoundingSphere()
    this.tolFill.position.set(0, 0.002, 0)
    this.tolLine.position.set(0, 0.0025, 0)
    const bad = ratio > p.tolRatio + 1e-9
    const zoneColor = new THREE.Color(bad ? BAD : OK)
    ;(this.tolFill.material as THREE.MeshBasicMaterial).color.copy(zoneColor)
    ;(this.tolFill.material as THREE.MeshBasicMaterial).opacity = bad ? 0.2 : 0.13
    ;(this.tolLine.material as THREE.LineBasicMaterial).color.copy(zoneColor)
    ;(this.cogSphere.material as THREE.MeshBasicMaterial).color.set(bad ? BAD : COG)
    // 轨迹
    const flat: number[] = []
    for (let i = 0; i <= k; i++) {
      const v = this.toWorld(s.cogX[i], s.cogY[i], 0)
      flat.push(v.x, 0.003, v.z)
    }
    if (frac > 0) flat.push(foot.x, 0.003, foot.z)
    if (flat.length >= 6) {
      const geo = new LineGeometry()
      geo.setPositions(flat)
      this.trail.geometry.dispose()
      this.trail.geometry = geo
      this.trail.computeLineDistances()
      this.trail.visible = this.cogVisible
    } else this.trail.visible = false
    this.dirty = true
  }

  setCogVisible(v: boolean) {
    this.cogVisible = v
    this.cogGroup.visible = v && !!this.plan
    this.dirty = true
  }

  // ───────────────────────── 显示选项 ─────────────────────────

  setLabels(on: boolean) {
    this.showLabels = on
    this.updateLabels()
  }

  private updateLabels() {
    const p = this.plan
    if (!p) return
    const placed = new Set(p.order.slice(0, this.step))
    p.placements.forEach((pl, i) => {
      const want = this.showLabels && placed.has(i) && this.boxes[i].visible
      let l = this.labels[i]
      if (want && !l) {
        const n = this.seqIndex[i] + 1
        let tex = this.labelTex.get(n)
        if (!tex) this.labelTex.set(n, (tex = numberTexture(n)))
        const size = Math.min(pl.dx, pl.dy, 160) * 0.62 * MM
        l = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
        l.rotation.x = -Math.PI / 2
        l.position.y = (pl.dz * MM) / 2 + 0.0015
        this.boxes[i].add(l)
        this.labels[i] = l
      }
      if (l) l.visible = want
    })
    this.dirty = true
  }

  setLayerLimit(limit: number | null) {
    this.layerLimit = limit
    const p = this.plan
    if (!p) return
    const placed = new Set(p.order.slice(0, this.step))
    p.placements.forEach((pl, i) => {
      if (placed.has(i)) this.boxes[i].visible = limit === null || pl.layer <= limit
    })
    this.updateLabels()
    this.dirty = true
  }

  /** 高亮一组货物（例如分层视图中选中的层、悬停货物及其支撑件） */
  setHighlight(indices: number[]) {
    this.highlighted = new Set(indices)
    this.applyHighlight()
  }

  private applyHighlight() {
    if (!this.plan) return
    this.boxes.forEach((_, i) => {
      if (i === this.animBox) return
      if (i === this.hover) this.setEmissive(i, 0.45, '#ffffff')
      else if (this.hover >= 0 && this.plan!.supporters[this.hover].includes(i)) this.setEmissive(i, 0.4, this.opts.accent)
      else if (this.highlighted.has(i)) this.setEmissive(i, 0.3, this.opts.accent)
      else this.setEmissive(i, 0)
    })
    this.dirty = true
  }

  // ───────────────────────── 相机 ─────────────────────────

  setCameraPreset(name: CameraPreset, animate = true) {
    const c = this.opts.compact
    const presets: Record<CameraPreset, [THREE.Vector3, THREE.Vector3]> = {
      iso: [c ? new THREE.Vector3(1.78, 1.62, 2.12) : new THREE.Vector3(2.55, 2.3, 3.3), new THREE.Vector3(c ? 0 : -0.34, c ? 0.36 : 0.44, 0)],
      top: [new THREE.Vector3(0.0001, c ? 3.3 : 3.9, 0.0001), new THREE.Vector3(0, 0, 0)],
      front: [new THREE.Vector3(0, 0.75, c ? 3.0 : 3.5), new THREE.Vector3(0, 0.5, 0)],
      side: [new THREE.Vector3(c ? 3.0 : 3.5, 0.75, 0), new THREE.Vector3(0, 0.5, 0)],
      operator: [new THREE.Vector3(0.28, 1.95, 2.3), new THREE.Vector3(0, 0.3, -0.05)],
    }
    const [pos, target] = presets[name]
    if (!animate) {
      this.camera.position.copy(pos)
      this.controls.target.copy(target)
      this.controls.update()
      this.dirty = true
      return
    }
    const p0 = this.camera.position.clone()
    const t0 = this.controls.target.clone()
    this.tweens.push({
      start: performance.now(),
      dur: 750,
      update: (t) => {
        const e = easeInOut(t)
        this.camera.position.lerpVectors(p0, pos, e)
        this.controls.target.lerpVectors(t0, target, e)
        this.controls.update()
      },
      done: () => {},
    })
  }

  /** 设置被浮动面板遮挡的边距（像素），画面中心平滑移到剩余可视区域的中心 */
  setViewInsets(ins: { l: number; r: number; t: number; b: number }, animate = true) {
    this.insets = ins
    const target = this.offsetTarget()
    if (!animate) {
      this.applyViewOffset(target.x, target.y)
      return
    }
    const from = { ...this.viewOff }
    this.tweens.push({
      start: performance.now(),
      dur: 480,
      update: (t) => {
        const e = easeInOut(t)
        this.applyViewOffset(THREE.MathUtils.lerp(from.x, target.x, e), THREE.MathUtils.lerp(from.y, target.y, e))
      },
      done: () => {},
    })
  }

  private offsetTarget() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    const i = this.insets
    const cx = i.l + (w - i.l - i.r) / 2
    const cy = i.t + (h - i.t - i.b) / 2
    return { x: w / 2 - cx, y: h / 2 - cy }
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
    this.controls.autoRotateSpeed = 0.6
  }

  snapshot(): string {
    this.renderer.render(this.scene, this.camera)
    return this.renderer.domElement.toDataURL('image/png')
  }

  // ───────────────────────── 交互与循环 ─────────────────────────

  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()

  private onPointerMove = (e: PointerEvent) => {
    if (!this.plan) return
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.boxes.filter((b) => b.visible), false)
    const placed = new Set(this.plan.order.slice(0, this.step))
    const hit = hits.find((h) => placed.has(h.object.userData.index))
    const idx = hit ? (hit.object.userData.index as number) : -1
    if (idx !== this.hover) {
      this.hover = idx
      this.applyHighlight()
    }
    this.onHover(idx >= 0 ? idx : null, e.clientX - r.left, e.clientY - r.top)
  }

  private onPointerLeave = () => {
    if (this.hover !== -1) {
      this.hover = -1
      this.applyHighlight()
    }
    this.onHover(null, 0, 0)
  }

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = w + 'px'
    this.renderer.domElement.style.height = h + 'px'
    this.camera.aspect = w / h
    const t = this.offsetTarget()
    this.applyViewOffset(t.x, t.y)
    this.trailMat.resolution.set(w, h)
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
        if (u >= 1) t.done()
        else keep.push(t)
      }
      // done() 中可能新增 tween
      this.tweens = keep.concat(this.tweens)
      this.dirty = true
    }
    // 目标虚影、重心光晕呼吸
    if (this.ghost.visible && !this.animating)
      (this.ghostEdges.material as THREE.LineBasicMaterial).opacity = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(now / 240))
    const breathe = 0.15 + 0.02 * Math.sin(now / 380)
    this.cogGlow.scale.setScalar(breathe)
    if (this.controls.autoRotate) this.dirty = true
    this.controls.update()
    if (this.dirty || this.plan) {
      this.renderer.render(this.scene, this.camera)
      this.dirty = false
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave)
    this.controls.dispose()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
    for (const t of this.labelTex.values()) t.dispose()
    this.cardboard.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
