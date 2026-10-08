/**
 * 舱内装载三维场景：货运无人机货舱（透视骨架）+ 货位 + 整托货物 + 重心标记
 *
 * 机体坐标 → 世界坐标：X（前→后）沿世界 +X，居中放置；Y（右为正）对应世界 −Z；地板面高度 DECK。
 * 整托货物用各盘真实的码放结果渲染；随时间轴参数 t 沿装载 / 投放 / 卸载路径移动。
 */
import * as THREE from 'three'
import type { Placement } from '../algo/types'
import { trackAt, type Assignment, type CabinConfig, type Door, type PalletUnit, type StageTrack, type Vec2 } from '../algo/cabin'
import { MM, Stage3D, buildPalletBase, buildStack, easeInOut, type Quality } from './Stage3D'
import { glowTexture } from './textures'

export interface CabinPallet {
  unit: PalletUnit
  placements: Placement[] | null
  colors: string[]
}

export type CabinCamera = 'iso' | 'top' | 'side' | 'tail'

interface PalletObj {
  id: string
  group: THREE.Group
  pick: THREE.Mesh
  outline: THREE.LineSegments
  height: number
  cogZ: number
  weight: number
}

const DECK = 1.0
const PAL_H = 0.075
const ACCENT = 0x2ee0f0
const COG = 0xffc24b
const OK = 0x3ddc97
const BAD = 0xff6b6b

export class CabinViewer extends Stage3D {
  private cfg: CabinConfig | null = null
  private craft = new THREE.Group()
  private palletRoot = new THREE.Group()
  private marks = new THREE.Group()
  private objs = new Map<string, PalletObj>()
  private slotTiles = new Map<string, THREE.Mesh>()
  private assign = new Map<string, Assignment>()
  private track: StageTrack | null = null
  private t = 0
  private sel = ''
  private hoverSlot = ''
  private hoverPallet = ''
  private FX = 1000
  private FY = 1000
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private down = { x: 0, y: 0 }
  private cam: CabinCamera = 'iso'
  // 重心标记
  private cargoBall!: THREE.Mesh
  private cargoGlow!: THREE.Sprite
  private cargoLine!: THREE.Line
  private cargoDot!: THREE.Mesh
  private sysMark!: THREE.Mesh
  private tolZone: THREE.Mesh | null = null
  private tolEdge: THREE.LineLoop | null = null
  private envEdge: THREE.LineLoop | null = null
  private targetMark: THREE.Group | null = null
  private cargoPos = new THREE.Vector3()
  private sysPos = new THREE.Vector3()
  private cargoVisible = false

  onPick: ((kind: 'pallet' | 'slot' | 'none', id: string) => void) | null = null
  onHover: ((kind: 'pallet' | 'slot' | 'none', id: string) => void) | null = null

  constructor(container: HTMLElement, quality: Quality = 'auto') {
    super(container, { fov: 32, minDistance: 3, maxDistance: 60, shadowExtent: 11, floorSize: 80, quality })
    this.scene.add(this.craft, this.palletRoot, this.marks)
    this.buildMarks()
    const el = this.renderer.domElement
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerleave', this.onLeave)
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointerup', this.onUp)
  }

  // ───────────────────────── 坐标 ─────────────────────────

  private wx(x: number) {
    return (x - (this.cfg?.length ?? 0) / 2) * MM
  }
  private wz(y: number) {
    return -y * MM
  }

  // ───────────────────────── 机体 ─────────────────────────

  setConfig(cfg: CabinConfig) {
    this.cfg = cfg
    this.assign.clear()
    this.track = null
    this.disposeGroup(this.craft)
    this.slotTiles.clear()
    const L = cfg.length * MM
    const W = Math.max(...cfg.cabins.map((c) => c.width)) * MM
    const Hc = Math.max(...cfg.cabins.map((c) => c.height)) * MM + 0.25
    const a = W / 2 + 0.16
    const R = (Hc * Hc + a * a) / (2 * Hc)
    const yc = DECK + Hc - R

    const lineMat = new THREE.MeshBasicMaterial({ color: 0x6fdcf5, transparent: true, opacity: 0.5, depthWrite: false })
    const faintMat = new THREE.MeshBasicMaterial({ color: 0x6fdcf5, transparent: true, opacity: 0.18, depthWrite: false })
    const noseLen = Math.min(3.0, R * 1.9)
    const tailLen = Math.min(4.2, R * 2.6)
    const xFront = -L / 2
    const xBack = L / 2
    // 机身半径沿轴向的变化：机头收尖、货舱段等直径、机尾收窄
    const radiusAt = (x: number) => {
      if (x < xFront) {
        const u = (xFront - x) / noseLen
        return R * Math.sqrt(Math.max(0.02, 1 - u * u * 0.98))
      }
      if (x > xBack) {
        const u = (x - xBack) / tailLen
        return R * (1 - 0.72 * u * u)
      }
      return R
    }
    const riseAt = (x: number) => (x > xBack ? ((x - xBack) / tailLen) ** 2 * R * 0.55 : 0)

    // 隔框
    const step = 0.72
    for (let x = xFront - noseLen + 0.25; x <= xBack + tailLen + 1e-6; x += step) {
      const r = radiusAt(x)
      const inside = x >= xFront - 1e-6 && x <= xBack + 1e-6
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, inside ? 0.011 : 0.008, 6, 56), inside ? lineMat : faintMat)
      ring.rotation.y = Math.PI / 2
      ring.position.set(x, yc + riseAt(x), 0)
      this.craft.add(ring)
    }
    // 桁条（货舱段）
    for (const deg of [20, 55, 90, 125, 160, 200, 250, 290, 340]) {
      const th = THREE.MathUtils.degToRad(deg)
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, L, 5), faintMat)
      s.rotation.z = Math.PI / 2
      s.position.set(0, yc + R * Math.sin(th), R * Math.cos(th))
      this.craft.add(s)
    }
    // 蒙皮（半透明回转面）
    const prof: THREE.Vector2[] = []
    for (let i = 0; i <= 60; i++) {
      const x = xFront - noseLen + ((L + noseLen + tailLen) * i) / 60
      prof.push(new THREE.Vector2(Math.max(0.02, radiusAt(x)), x))
    }
    const skin = new THREE.Mesh(
      new THREE.LatheGeometry(prof, 56),
      new THREE.MeshBasicMaterial({ color: 0x58cfee, transparent: true, opacity: 0.042, side: THREE.DoubleSide, depthWrite: false }),
    )
    skin.rotation.z = -Math.PI / 2
    skin.position.y = yc
    skin.renderOrder = 5
    this.craft.add(skin)

    // 机翼、尾翼、发动机（示意）
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x2a3c58, transparent: true, opacity: 0.11, metalness: 0.5, roughness: 0.5, depthWrite: false })
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x6fdcf5, transparent: true, opacity: 0.3 })
    const slab = (root: number, tip: number, span: number, sweep: number, thick: number) => {
      const sh = new THREE.Shape()
      sh.moveTo(-root / 2, 0)
      sh.lineTo(root / 2, 0)
      sh.lineTo(sweep + tip / 2, span)
      sh.lineTo(sweep - tip / 2, span)
      sh.closePath()
      const geo = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false })
      geo.rotateX(Math.PI / 2)
      const g = new THREE.Group()
      const m = new THREE.Mesh(geo, wingMat)
      m.renderOrder = 6
      g.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat))
      return g
    }
    const wingX = this.wx(cfg.targetCog.x) + 0.15
    const wingY = yc + R * 0.86
    const span = Math.max(6.5, L * 0.72)
    for (const side of [1, -1]) {
      const w = slab(2.3, 1.15, span, 0.5, 0.14)
      w.position.set(wingX, wingY, side * R * 0.5)
      w.scale.z = side
      this.craft.add(w)
      const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 1.7, 20), wingMat)
      nac.rotation.z = Math.PI / 2
      nac.position.set(wingX - 0.5, wingY - 0.3, side * (R + span * 0.3))
      const prop = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), new THREE.MeshBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }))
      prop.rotation.y = Math.PI / 2
      prop.position.set(wingX - 1.4, wingY - 0.3, side * (R + span * 0.3))
      this.craft.add(nac, prop)
      const tailPlane = slab(1.3, 0.7, 2.6, 0.5, 0.08)
      tailPlane.position.set(xBack + tailLen - 0.7, yc + riseAt(xBack + tailLen) + 0.25, side * 0.15)
      tailPlane.scale.z = side
      this.craft.add(tailPlane)
    }
    const fin = slab(1.9, 0.8, 2.3, 1.0, 0.08)
    fin.rotation.x = -Math.PI / 2
    fin.position.set(xBack + tailLen - 1.0, yc + riseAt(xBack + tailLen - 0.6) + 0.2, 0.04)
    this.craft.add(fin)

    // 起落架
    const tyre = new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.9 })
    const strut = new THREE.MeshStandardMaterial({ color: 0x8793a5, metalness: 0.8, roughness: 0.35 })
    const gear = (x: number, z: number) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 24), tyre)
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(x, 0.26, z)
      wheel.castShadow = true
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, yc - R + 0.3, 10), strut)
      leg.position.set(x, (yc - R + 0.3) / 2 + 0.2, z)
      this.craft.add(wheel, leg)
    }
    gear(xFront - noseLen * 0.35, 0)
    gear(wingX + 0.5, a * 0.72)
    gear(wingX + 0.5, -a * 0.72)

    // 各舱地板、货位、舱门
    const deckSide = new THREE.MeshStandardMaterial({ color: 0x1c2534, metalness: 0.75, roughness: 0.45 })
    for (const cab of cfg.cabins) {
      const len = (cab.x1 - cab.x0) * MM
      const wid = cab.width * MM
      const tex = this.deckTexture(cfg, cab.id)
      const top = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.55, roughness: 0.55 })
      const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, wid), [deckSide, deckSide, top, deckSide, deckSide, deckSide])
      deck.position.set(this.wx((cab.x0 + cab.x1) / 2), DECK - 0.035, 0)
      deck.receiveShadow = true
      deck.castShadow = true
      this.craft.add(deck)
    }
    // 多舱之间的中央翼盒
    for (let i = 0; i + 1 < cfg.cabins.length; i++) {
      const g0 = cfg.cabins[i].x1
      const g1 = cfg.cabins[i + 1].x0
      if (g1 - g0 < 200) continue
      const geo = new THREE.BoxGeometry((g1 - g0) * MM - 0.1, 1.5, W - 0.1)
      const box = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x223049, transparent: true, opacity: 0.5, metalness: 0.6, roughness: 0.5 }))
      box.position.set(this.wx((g0 + g1) / 2), DECK + 0.75, 0)
      this.craft.add(box, new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat).translateX(box.position.x).translateY(box.position.y))
    }
    // 货位感应片（悬停 / 选中时点亮）
    for (const s of cfg.slots) {
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false }))
      tile.rotation.x = -Math.PI / 2
      tile.position.set(this.wx(s.x), DECK + 0.004, this.wz(s.y))
      tile.userData = { slot: s.id }
      tile.renderOrder = 1
      this.slotTiles.set(s.id, tile)
      this.craft.add(tile)
    }
    // 舱门
    const doorMat = new THREE.LineBasicMaterial({ color: COG, transparent: true, opacity: 0.85 })
    for (const d of cfg.doors) {
      const cab = cfg.cabins.find((c) => c.id === d.cabin)!
      if (d.kind === 'tail') {
        // 尾门跳板
        const rampLen = 3.0
        const wid = cab.width * MM - 0.3
        const ang = Math.atan2(DECK - 0.04, rampLen)
        const ramp = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(rampLen, DECK), 0.05, wid), new THREE.MeshStandardMaterial({ color: 0x1f2a3c, metalness: 0.7, roughness: 0.45, transparent: true, opacity: 0.82 }))
        ramp.position.set(this.wx(d.x) + rampLen / 2, DECK / 2, 0)
        ramp.rotation.z = -ang
        ramp.castShadow = ramp.receiveShadow = true
        this.craft.add(ramp)
        const pts = [new THREE.Vector3(this.wx(d.x), DECK + 0.01, -wid / 2), new THREE.Vector3(this.wx(d.x), DECK + 0.01, wid / 2)]
        this.craft.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), doorMat))
      } else if (d.kind === 'side') {
        const side = Math.sign(d.y) || 1
        const z = this.wz(side * (cab.width / 2))
        const x = this.wx(d.x)
        const hw = 0.78
        const hgt = Math.min(1.75, cab.height * MM - 0.15)
        const pts = [
          [x - hw, DECK, z],
          [x - hw, DECK + hgt, z],
          [x + hw, DECK + hgt, z],
          [x + hw, DECK, z],
        ].map((p) => new THREE.Vector3(p[0], p[1], p[2]))
        this.craft.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), doorMat))
        // 侧门外的升降装载平台
        if (cfg.cabins.some((c) => c.loadDoor === d.id)) {
          const out = -side
          const plat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 2.0), new THREE.MeshStandardMaterial({ color: 0x2c3a52, metalness: 0.7, roughness: 0.4 }))
          plat.position.set(x, DECK - 0.04, z + out * 1.12)
          plat.castShadow = plat.receiveShadow = true
          this.craft.add(plat)
          for (const dx of [-0.6, 0.6]) {
            for (const tilt of [1, -1]) {
              const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, Math.hypot(DECK, 1.4), 0.05), strut)
              bar.position.set(x + dx, DECK / 2 - 0.04, z + out * 1.12)
              bar.rotation.x = tilt * Math.atan2(1.4, DECK)
              this.craft.add(bar)
            }
          }
        }
      } else {
        const x = this.wx(d.x)
        const z = this.wz(d.y)
        const h = 0.7
        const pts = [
          [x - h, z - h],
          [x + h, z - h],
          [x + h, z + h],
          [x - h, z + h],
        ].map((p) => new THREE.Vector3(p[0], DECK + 0.008, p[1]))
        this.craft.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), doorMat))
      }
    }

    this.buildZones(cfg)
    this.controls.maxDistance = L * 3 + 14
    this.setCameraPreset('iso', false)
    this.dirty = true
  }

  /** 地板贴图：滚棒导轨、货位框与编号 */
  private deckTexture(cfg: CabinConfig, cabinId: string): THREE.CanvasTexture {
    const cab = cfg.cabins.find((c) => c.id === cabinId)!
    const k = 110
    const len = (cab.x1 - cab.x0) * MM
    const wid = cab.width * MM
    const cv = document.createElement('canvas')
    cv.width = Math.round(len * k)
    cv.height = Math.round(wid * k)
    const g = cv.getContext('2d')!
    g.fillStyle = '#1a2231'
    g.fillRect(0, 0, cv.width, cv.height)
    // 画布 u 沿机体 X，v 沿世界 +Z（即机体 −Y）
    const u = (x: number) => (x - cab.x0) * MM * k
    const v = (y: number) => (wid / 2 - y * MM) * k
    const lanes = [...new Set(cfg.slots.filter((s) => s.cabin === cabinId).map((s) => s.y))]
    for (const y of lanes) {
      for (const off of [-0.42, 0.42]) {
        const vv = v(y) + off * k
        g.fillStyle = 'rgba(150,170,200,0.10)'
        g.fillRect(0, vv - 0.05 * k, cv.width, 0.1 * k)
        g.fillStyle = 'rgba(200,215,235,0.22)'
        for (let x = 0.08 * k; x < cv.width; x += 0.16 * k) g.fillRect(x, vv - 0.04 * k, 0.06 * k, 0.08 * k)
      }
    }
    for (const s of cfg.slots) {
      if (s.cabin !== cabinId) continue
      const h = 0.64 * k
      g.strokeStyle = 'rgba(180,200,230,0.42)'
      g.lineWidth = 2.5
      g.setLineDash([12, 9])
      g.beginPath()
      g.roundRect(u(s.x) - h, v(s.y) - h, h * 2, h * 2, 10)
      g.stroke()
      g.setLineDash([])
      g.save()
      g.translate(u(s.x), v(s.y))
      g.fillStyle = 'rgba(255,255,255,0.16)'
      g.font = `700 ${0.4 * k}px "Inter Var", "SF Pro Display", Arial, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(s.id, 0, 4)
      g.restore()
    }
    g.strokeStyle = 'rgba(111,220,245,0.35)'
    g.lineWidth = 4
    g.strokeRect(2, 2, cv.width - 4, cv.height - 4)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }

  /** 理论重心、货物重心允许区（±10%）、系统重心过程包络 */
  private buildZones(cfg: CabinConfig) {
    for (const o of [this.tolZone, this.tolEdge, this.envEdge, this.targetMark]) {
      if (!o) continue
      this.marks.remove(o)
      o.traverse((c) => {
        const m = c as THREE.Mesh
        m.geometry?.dispose()
        ;(m.material as THREE.Material | undefined)?.dispose()
      })
    }
    const tx = this.wx(cfg.targetCog.x)
    const tz = this.wz(cfg.targetCog.y)
    const hx = cfg.tolX * cfg.length * MM
    const hz = cfg.tolY * cfg.width * MM
    const y = DECK + 0.012
    this.tolZone = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hz * 2), new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.1, depthWrite: false }))
    this.tolZone.rotation.x = -Math.PI / 2
    this.tolZone.position.set(tx, y, tz)
    this.tolZone.renderOrder = 2
    const rect = (x0: number, x1: number, z0: number, z1: number, color: number, yy: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, yy, z0), new THREE.Vector3(x1, yy, z0), new THREE.Vector3(x1, yy, z1), new THREE.Vector3(x0, yy, z1)])
      const line = new THREE.LineLoop(geo, new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.9, depthTest: false }))
      line.computeLineDistances()
      line.renderOrder = 8
      return line
    }
    this.tolEdge = rect(tx - hx, tx + hx, tz - hz, tz + hz, OK, y + 0.002)
    const env = cfg.envGround
    const ez = cfg.envLateral * cfg.width * MM
    this.envEdge = rect(tx + env[0] * cfg.length * MM, tx + env[1] * cfg.length * MM, tz - ez, tz + ez, ACCENT, y + 0.004)
    // 理论重心：地板上的十字圆环
    const g = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.125, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    const cross = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.2, 0, 0), new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(0, 0, -0.2), new THREE.Vector3(0, 0, 0.2)]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false }),
    )
    g.add(ring, cross)
    g.position.set(tx, y + 0.006, tz)
    g.renderOrder = 9
    ring.renderOrder = cross.renderOrder = 9
    this.targetMark = g
    this.marks.add(this.tolZone, this.tolEdge, this.envEdge, g)
  }

  private buildMarks() {
    this.cargoBall = new THREE.Mesh(new THREE.SphereGeometry(0.085, 28, 28), new THREE.MeshBasicMaterial({ color: COG, depthTest: false }))
    this.cargoBall.renderOrder = 12
    this.cargoGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,194,75,0.9)', 'rgba(255,194,75,0)'), transparent: true, depthTest: false, depthWrite: false }))
    this.cargoGlow.scale.setScalar(0.6)
    this.cargoGlow.renderOrder = 11
    this.cargoLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]), new THREE.LineBasicMaterial({ color: COG, transparent: true, opacity: 0.9, depthTest: false }))
    this.cargoLine.renderOrder = 11
    this.cargoDot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 28), new THREE.MeshBasicMaterial({ color: COG, depthTest: false }))
    this.cargoDot.rotation.x = -Math.PI / 2
    this.cargoDot.renderOrder = 11
    this.sysMark = new THREE.Mesh(new THREE.OctahedronGeometry(0.085), new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false }))
    this.sysMark.renderOrder = 12
    this.marks.add(this.cargoBall, this.cargoGlow, this.cargoLine, this.cargoDot, this.sysMark)
  }

  // ───────────────────────── 整托货物 ─────────────────────────

  setPallets(list: CabinPallet[], FX: number, FY: number) {
    this.FX = FX
    this.FY = FY
    this.disposeGroup(this.palletRoot)
    this.objs.clear()
    for (const p of list) {
      const group = new THREE.Group()
      const [pl, pw, ph] = p.unit.size
      group.add(buildPalletBase(pl * MM, pw * MM, PAL_H))
      let height = Math.max(0.2, ph * MM - PAL_H)
      if (p.placements && p.placements.length) {
        const st = buildStack(p.placements, p.colors, this.FX, this.FY)
        group.add(st.mesh)
        height = st.height
      } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, height, 1.0), new THREE.MeshStandardMaterial({ color: 0xb9a888, roughness: 0.8 }))
        box.position.y = height / 2
        box.castShadow = true
        group.add(box)
      }
      const pickGeo = new THREE.BoxGeometry(pl * MM + 0.02, height + PAL_H, pw * MM + 0.02)
      const pick = new THREE.Mesh(pickGeo, new THREE.MeshBasicMaterial({ visible: false }))
      pick.position.y = (height - PAL_H) / 2
      pick.userData = { pallet: p.unit.id }
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, height + 0.02, 1.04)), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95, depthTest: false }))
      outline.position.y = height / 2
      outline.visible = false
      outline.renderOrder = 10
      group.add(pick, outline)
      // 朝向标记：货盘前缘的小箭头
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 3), new THREE.MeshBasicMaterial({ color: 0xe8f6ff }))
      arrow.rotation.z = -Math.PI / 2
      arrow.position.set(pl * MM * 0.5 - 0.09, 0.012, 0)
      arrow.scale.y = 0.2
      group.add(arrow)
      group.visible = false
      this.palletRoot.add(group)
      this.objs.set(p.unit.id, { id: p.unit.id, group, pick, outline, height, cogZ: Math.max(0.1, p.unit.cog.z * MM - PAL_H), weight: p.unit.weight })
    }
    this.apply()
  }

  setPlan(assignments: Assignment[], track: StageTrack | null) {
    this.assign = new Map(assignments.map((a) => [a.palletId, a]))
    this.track = track
    if (this.cfg && this.envEdge && track) {
      // 包络随作业场景切换（地面 / 空中）
      const tx = this.wx(this.cfg.targetCog.x)
      const pos = this.envEdge.geometry.getAttribute('position') as THREE.BufferAttribute
      const x0 = tx + track.env[0] * this.cfg.length * MM
      const x1 = tx + track.env[1] * this.cfg.length * MM
      pos.setX(0, x0)
      pos.setX(3, x0)
      pos.setX(1, x1)
      pos.setX(2, x1)
      pos.needsUpdate = true
      this.envEdge.computeLineDistances()
    }
    this.apply()
  }

  setTime(t: number) {
    this.t = t
    this.apply()
  }

  setSelection(id: string) {
    this.sel = id
    this.paint()
  }

  private slotPos(id: string): Vec2 | null {
    const s = this.cfg?.slots.find((x) => x.id === id)
    return s ? { x: s.x, y: s.y } : null
  }

  /** 舱门外侧的起止点（世界坐标）与离机方式 */
  private outside(door: Door, lane: number, mode: StageTrack['kind'], exit: StageTrack['exit']): { p: THREE.Vector3; fall: number } {
    const cab = this.cfg!.cabins.find((c) => c.id === door.cabin)!
    if (door.kind === 'tail') {
      // 地面作业沿跳板上下；空中投放滑出后下落
      if (mode === 'drop') return { p: new THREE.Vector3(this.wx(door.x) + 2.4, DECK + PAL_H, this.wz(lane)), fall: 1.7 }
      return { p: new THREE.Vector3(this.wx(door.x) + 3.0, PAL_H + 0.04, this.wz(lane)), fall: 0 }
    }
    if (door.kind === 'side') {
      const side = Math.sign(door.y) || 1
      const z = this.wz(side * (cab.width / 2)) - side * 1.25
      return { p: new THREE.Vector3(this.wx(door.x), DECK + PAL_H, z), fall: mode === 'drop' ? 1.5 : 0 }
    }
    return { p: new THREE.Vector3(this.wx(door.x), DECK + PAL_H - 0.2, this.wz(door.y)), fall: exit === 'belly' ? 1.9 : 0 }
  }

  /** 按当前时间 t 摆放所有托盘，并更新重心标记 */
  private apply() {
    const cfg = this.cfg
    if (!cfg) return
    const tr = this.track
    const opOf = new Map<string, number>()
    tr?.ops.forEach((o, i) => opOf.set(o.palletId, i))
    for (const o of this.objs.values()) {
      const a = this.assign.get(o.id)
      const g = o.group
      if (!a) {
        g.visible = false
        continue
      }
      const sp = this.slotPos(a.slotId)
      // 构型刚切换、新方案尚未到达时，旧方案引用的货位可能不存在
      if (!sp) {
        g.visible = false
        continue
      }
      g.rotation.y = THREE.MathUtils.degToRad(a.yaw)
      g.scale.setScalar(1)
      const home = new THREE.Vector3(this.wx(sp.x), DECK + PAL_H, this.wz(sp.y))
      const k = opOf.get(o.id)
      if (!tr || k === undefined) {
        g.visible = true
        g.position.copy(home)
        continue
      }
      const op = tr.ops[k]
      const u = this.t - k
      const way = op.way.map((w) => new THREE.Vector3(this.wx(w.x), DECK + PAL_H, this.wz(w.y)))
      const out = this.outside(op.door, sp.y, tr.kind, tr.exit)
      const along = (f: number) => {
        // f ∈ [0,1] 沿 way 的各段等时移动
        if (way.length === 1) return way[0].clone()
        const x = Math.max(0, Math.min(1, f)) * (way.length - 1)
        const i = Math.min(way.length - 2, Math.floor(x))
        return way[i].clone().lerp(way[i + 1], easeInOut(x - i))
      }
      if (op.dir === 'in') {
        if (u <= 0) g.visible = false
        else if (u >= 1) {
          g.visible = true
          g.position.copy(home)
        } else if (u < 0.3) {
          g.visible = true
          g.position.copy(out.p).lerp(way[0], easeInOut(u / 0.3))
        } else {
          g.visible = true
          g.position.copy(along((u - 0.3) / 0.7))
        }
      } else {
        if (u <= 0) {
          g.visible = true
          g.position.copy(home)
        } else if (u >= 1) g.visible = false
        else if (u <= 0.7) {
          g.visible = true
          g.position.copy(along(u / 0.7))
        } else {
          const e = (u - 0.7) / 0.3
          g.visible = true
          g.position.copy(way[way.length - 1]).lerp(out.p, Math.min(1, e * 1.25))
          g.position.y -= out.fall * e * e
          if (out.fall) g.scale.setScalar(1 - 0.35 * e)
        }
      }
    }
    this.updateCog()
    this.paint()
    this.dirty = true
  }

  private updateCog() {
    const cfg = this.cfg
    if (!cfg) return
    const tr = this.track
    if (!tr) return
    const sp = trackAt(tr, this.t)
    const y0 = DECK + 0.02
    this.sysPos.set(this.wx(sp.system.x), y0 + 0.1, this.wz(sp.system.y))
    this.sysMark.position.copy(this.sysPos)
    this.sysMark.rotation.y = performance.now() / 900
    ;(this.sysMark.material as THREE.MeshBasicMaterial).color.setHex(sp.ok ? ACCENT : BAD)
    const atEnd = tr.kind === 'load' ? this.t >= tr.ops.length - 1e-6 : this.t <= 1e-6
    const show = !!sp.cargo
    this.cargoVisible = show
    for (const o of [this.cargoBall, this.cargoGlow, this.cargoLine, this.cargoDot]) o.visible = show
    if (sp.cargo) {
      let mz = 0,
        m = 0
      for (const o of this.objs.values()) {
        if (!o.group.visible) continue
        mz += o.weight * o.cogZ
        m += o.weight
      }
      const h = m ? mz / m : 0.5
      this.cargoPos.set(this.wx(sp.cargo.x), DECK + PAL_H + h, this.wz(sp.cargo.y))
      this.cargoBall.position.copy(this.cargoPos)
      this.cargoGlow.position.copy(this.cargoPos)
      this.cargoDot.position.set(this.cargoPos.x, y0, this.cargoPos.z)
      const pos = this.cargoLine.geometry.getAttribute('position') as THREE.BufferAttribute
      pos.setXYZ(0, this.cargoPos.x, this.cargoPos.y, this.cargoPos.z)
      pos.setXYZ(1, this.cargoPos.x, y0, this.cargoPos.z)
      pos.needsUpdate = true
      const ex = Math.abs(sp.cargo.x - cfg.targetCog.x) / cfg.length
      const ey = Math.abs(sp.cargo.y - cfg.targetCog.y) / cfg.width
      const inTol = ex <= cfg.tolX + 1e-9 && ey <= cfg.tolY + 1e-9
      // 验收区只在"装载完成"的状态下判定；过程中降低存在感
      const zoneColor = atEnd ? (inTol ? OK : BAD) : 0x8aa0b8
      ;(this.tolZone!.material as THREE.MeshBasicMaterial).color.setHex(zoneColor)
      ;(this.tolZone!.material as THREE.MeshBasicMaterial).opacity = atEnd ? 0.12 : 0.05
      ;(this.tolEdge!.material as THREE.LineDashedMaterial).color.setHex(zoneColor)
      ;(this.tolEdge!.material as THREE.LineDashedMaterial).opacity = atEnd ? 0.9 : 0.45
    }
  }

  private paint() {
    for (const [id, tile] of this.slotTiles) {
      const m = tile.material as THREE.MeshBasicMaterial
      const selSlot = this.sel ? this.assign.get(this.sel)?.slotId : ''
      m.opacity = id === this.hoverSlot ? 0.3 : this.sel ? (id === selSlot ? 0.22 : 0.1) : 0
    }
    for (const o of this.objs.values()) {
      o.outline.visible = o.id === this.sel || o.id === this.hoverPallet
      ;(o.outline.material as THREE.LineBasicMaterial).opacity = o.id === this.sel ? 0.95 : 0.5
    }
    this.dirty = true
  }

  // ───────────────────────── 相机 ─────────────────────────

  setCameraPreset(name: CabinCamera, animate = true) {
    const cfg = this.cfg
    if (!cfg) return
    this.cam = name
    const L = cfg.length * MM
    const W = cfg.width * MM
    const { fx, fy } = this.visibleFraction()
    const aspect = (this.container.clientWidth / Math.max(1, this.container.clientHeight)) * (fx / fy)
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
    const fit = (w: number, h: number) => Math.max(h / 2 / (half * fy), w / 2 / (half * fy * aspect))
    const target = new THREE.Vector3(0, DECK + 0.55, 0)
    let pos: THREE.Vector3
    if (name === 'top') {
      target.set(0, DECK, 0)
      pos = new THREE.Vector3(0.0001, DECK + fit(L + 4.6, W + 3.2) * 1.02, 0.0001)
    } else if (name === 'side') {
      pos = new THREE.Vector3(0, DECK + 0.9, fit(L + 5.2, 4.8) * 1.02)
    } else if (name === 'tail') {
      target.set(L * 0.1, DECK + 0.7, 0)
      pos = new THREE.Vector3(L / 2 + 6.2, DECK + 2.5, W * 0.9 + 1.6)
    } else {
      const dir = new THREE.Vector3(0.32, 0.5, 1).normalize()
      // 货舱段（含尾门跳板的一部分）落进可视区域；机头、机翼允许出画
      const pts: THREE.Vector3[] = []
      for (const x of [-L / 2 - 0.6, L / 2 + 1.4]) for (const z of [-W / 2 - 0.4, W / 2 + 0.4]) for (const y of [DECK - 0.5, DECK + 2.0]) pts.push(new THREE.Vector3(x, y, z))
      const dist = this.fitDistance(pts, target, dir, 0.92, 4)
      pos = target.clone().addScaledVector(dir, dist)
    }
    this.flyTo(pos, target, animate ? 900 : 0)
  }

  refit() {
    this.setCameraPreset(this.cam)
  }

  // ───────────────────────── 标签位置 ─────────────────────────

  labelPositions() {
    const pallets: Record<string, { x: number; y: number; visible: boolean }> = {}
    for (const o of this.objs.values()) {
      const p = this.project(new THREE.Vector3(o.group.position.x, o.group.position.y + o.height * o.group.scale.y + 0.2, o.group.position.z))
      pallets[o.id] = { ...p, visible: p.visible && o.group.visible }
    }
    const doors: { id: string; x: number; y: number; visible: boolean }[] = []
    if (this.cfg)
      for (const d of this.cfg.doors) {
        const cab = this.cfg.cabins.find((c) => c.id === d.cabin)!
        const v =
          d.kind === 'tail'
            ? new THREE.Vector3(this.wx(d.x) + 1.7, DECK * 0.5 + 0.35, 0)
            : d.kind === 'side'
              ? new THREE.Vector3(this.wx(d.x), DECK + Math.min(1.75, cab.height * MM - 0.15) + 0.14, this.wz((Math.sign(d.y) || 1) * (cab.width / 2)))
              : new THREE.Vector3(this.wx(d.x), DECK - 0.95, this.wz(d.y) + 0.9)
        doors.push({ id: d.id, ...this.project(v) })
      }
    return {
      pallets,
      doors,
      cargo: { ...this.project(this.cargoPos.clone().add(new THREE.Vector3(0, 0.2, 0))), visible: this.cargoVisible },
      system: this.project(this.sysPos.clone().add(new THREE.Vector3(0, 0.16, 0))),
      target: this.targetMark ? this.project(this.targetMark.position.clone()) : { x: 0, y: 0, visible: false },
    }
  }

  // ───────────────────────── 交互 ─────────────────────────

  private hit(e: PointerEvent): { kind: 'pallet' | 'slot' | 'none'; id: string } {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const picks = [...this.objs.values()].filter((o) => o.group.visible).map((o) => o.pick)
    const hp = this.raycaster.intersectObjects(picks, false)
    if (hp.length) return { kind: 'pallet', id: hp[0].object.userData.pallet as string }
    const hs = this.raycaster.intersectObjects([...this.slotTiles.values()], false)
    if (hs.length) return { kind: 'slot', id: hs[0].object.userData.slot as string }
    return { kind: 'none', id: '' }
  }
  private onMove = (e: PointerEvent) => {
    if (e.buttons) return
    const h = this.hit(e)
    const hp = h.kind === 'pallet' ? h.id : ''
    const hs = h.kind === 'slot' ? h.id : ''
    if (hp !== this.hoverPallet || hs !== this.hoverSlot) {
      this.hoverPallet = hp
      this.hoverSlot = hs
      this.renderer.domElement.style.cursor = h.kind === 'pallet' || (h.kind === 'slot' && this.sel) ? 'pointer' : ''
      this.paint()
      this.onHover?.(h.kind, h.id)
    }
  }
  private onLeave = () => {
    this.hoverPallet = this.hoverSlot = ''
    this.paint()
    this.onHover?.('none', '')
  }
  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY }
  }
  private onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return
    const h = this.hit(e)
    this.onPick?.(h.kind, h.id)
  }

  protected onFrame(now: number) {
    if (!this.cargoGlow) return
    this.cargoGlow.scale.setScalar(0.55 + 0.08 * Math.sin(now / 380))
    this.sysMark.rotation.y = now / 900
    this.dirty = true
  }

  private disposeGroup(g: THREE.Group) {
    g.traverse((o) => {
      const m = o as THREE.Mesh
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose()
      else if (m.geometry && m.geometry.type !== 'BoxGeometry') m.geometry.dispose()
    })
    g.clear()
  }

  dispose() {
    const el = this.renderer.domElement
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerleave', this.onLeave)
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointerup', this.onUp)
    super.dispose()
  }
}
