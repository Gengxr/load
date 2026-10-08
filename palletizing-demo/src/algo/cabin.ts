/**
 * 舱内装载配平与过程重心（整托货物 → 货位）
 *
 * 坐标（机体系，mm）：X 沿机身由前向后，原点在货舱地板最前端；Y 为横向，机身中线为 0，向右为正。
 *
 * 三种重心：
 *   - 货物合成重心：只算整托货物 —— 表 2-2 第 6 项的验收量，与数模给出的理论重心比较，长宽方向 ≤ ±10%；
 *   - 各舱货物重心：多舱构型下每个舱单独的货物重心；
 *   - 含空机的系统重心：用于装载 / 投放 / 卸载全过程的包络校验（准静态，按路径端点校核）。
 *
 * 求解：货位数不多时全枚举（可证明最优），规模大时用模拟退火 + 两两交换下降。
 * 目标：装载后货物重心偏差最小；全过程系统重心不出包络；同等条件下过程峰值更小者优先。
 */

export interface Vec2 {
  x: number
  y: number
}

export type ExitKind = 'tail' | 'side' | 'belly'

export interface Door {
  id: string
  kind: ExitKind
  cabin: string
  /** 门槛中心（腹部舱门为舱口中心） */
  x: number
  y: number
  name: string
}

export interface SlotDef {
  id: string
  cabin: string
  lane: number
  x: number
  y: number
  maxWeight: number
}

export interface CabinDef {
  id: string
  name: string
  x0: number
  x1: number
  width: number
  height: number
  /** 本舱货物限重 kg */
  maxWeight: number
  /** 装载 / 卸载使用的舱门 */
  loadDoor: string
}

export interface DropMode {
  id: string
  kind: ExitKind
  door: string
  name: string
}

export interface CabinConfig {
  id: string
  name: string
  model: string
  desc: string
  version: string
  /** 基准长度、宽度（货舱地板），重心误差按它们折算成百分比 */
  length: number
  width: number
  cabins: CabinDef[]
  slots: SlotDef[]
  doors: Door[]
  drops: DropMode[]
  /** 空机质量属性（由舱段方提供并确认；此处为内置示例值） */
  emptyWeight: number
  emptyCog: Vec2
  /** 理论重心：以舱段数模的重心为准 */
  targetCog: Vec2
  /** 货物重心允许误差（长、宽方向），表 2-2 第 6 项 */
  tolX: number
  tolY: number
  /** 系统重心过程包络：[前限, 后限]（相对基准长度的比例，前为负）；地面作业与空中投放分别给出 */
  envGround: [number, number]
  envFlight: [number, number]
  /** 横向包络（相对基准宽度） */
  envLateral: number
}

export interface PalletUnit {
  id: string
  rfid: string
  /** 整托毛重 kg（货物 + 货盘） */
  weight: number
  /** 重心相对货盘几何中心的水平偏移 mm，以及距货盘底面的高度 */
  cog: { x: number; y: number; z: number }
  /** 长、宽、总高（含货盘）mm */
  size: [number, number, number]
  source: 'PREDICTED' | 'MEASURED'
  count?: number
}

export type Yaw = 0 | 90 | 180 | 270

export interface Assignment {
  palletId: string
  slotId: string
  yaw: Yaw
}

export interface Violation {
  code: string
  message: string
}

export interface LoadMetrics {
  cargoWeight: number
  totalWeight: number
  cargoCog: Vec2
  systemCog: Vec2
  cabinCogs: { cabin: string; name: string; weight: number; cog: Vec2 | null; limit: number; ok: boolean }[]
  /** 货物合成重心相对理论重心的误差（比例） */
  errX: number
  errY: number
  sysErrX: number
  sysErrY: number
  pass: boolean
  violations: Violation[]
}

export interface StagePoint {
  t: number
  op: number
  palletId: string
  /** 系统重心相对理论重心的偏差（比例） */
  devX: number
  devY: number
  system: Vec2
  /** 当前在机上的货物合成重心（机上无货时为 null） */
  cargo: Vec2 | null
  cargoMass: number
  label: string
  ok: boolean
}

export interface StageOp {
  palletId: string
  slotId: string
  dir: 'in' | 'out'
  door: Door
  /** 在机上的路径点：装载为 门槛 → 货位，投放 / 卸载为 货位 → 门槛 */
  way: Vec2[]
}

export interface StageTrack {
  mode: string
  name: string
  kind: 'load' | 'unload' | 'drop'
  exit: ExitKind
  ops: StageOp[]
  points: StagePoint[]
  /** 归一化峰值（1 = 贴到包络边界）与对应的偏差 */
  peak: number
  peakDevX: number
  peakDevY: number
  peakT: number
  env: [number, number]
  envLateral: number
  ok: boolean
  order: string[]
}

export interface SolverInfo {
  method: 'enumeration' | 'local-search' | 'manual'
  /** 评估过的布局数 / 解空间大小 */
  evaluated: number
  space: number
  optimal: boolean
  elapsedMs: number
}

export interface LoadingPlan {
  configId: string
  assignments: Assignment[]
  /** 超出货位数、未能装载的整托 */
  unassigned: string[]
  metrics: LoadMetrics
  tracks: Record<string, StageTrack>
  solver: SolverInfo
  /** 对照：按出库顺序依次装入 */
  baseline: { assignments: Assignment[]; metrics: LoadMetrics; tracks: Record<string, StageTrack> } | null
}

// ───────────────────────── 内置构型（无人运输机货舱的参数化示例，正式数据以舱段方接口为准） ─────────────────────────

function lane(cabin: string, prefix: string, xs: number[], y: number, laneIdx: number, maxWeight: number): SlotDef[] {
  return xs.map((x, i) => ({ id: `${prefix}${i + 1}`, cabin, lane: laneIdx, x, y, maxWeight }))
}
const seq = (x0: number, pitch: number, n: number) => Array.from({ length: n }, (_, i) => x0 + i * pitch)

export const CABIN_CONFIGS: CabinConfig[] = [
  {
    id: 'M6',
    name: '中型 · 单舱单列 6 位',
    model: 'UAV-M6',
    desc: '尾门装卸，支持尾投、侧投、腹投',
    version: 'v1.2',
    length: 9000,
    width: 2000,
    cabins: [{ id: 'MAIN', name: '主货舱', x0: 0, x1: 9000, width: 2000, height: 1900, maxWeight: 4200, loadDoor: 'TAIL' }],
    slots: lane('MAIN', 'A', seq(900, 1440, 6), 0, 0, 700),
    doors: [
      { id: 'TAIL', kind: 'tail', cabin: 'MAIN', x: 9000, y: 0, name: '尾门' },
      { id: 'SIDE', kind: 'side', cabin: 'MAIN', x: 2340, y: -1000, name: '左侧舱门' },
      { id: 'BELLY', kind: 'belly', cabin: 'MAIN', x: 5220, y: 0, name: '腹部舱门' },
    ],
    drops: [
      { id: 'drop-tail', kind: 'tail', door: 'TAIL', name: '尾投' },
      { id: 'drop-side', kind: 'side', door: 'SIDE', name: '侧投' },
      { id: 'drop-belly', kind: 'belly', door: 'BELLY', name: '腹投' },
    ],
    emptyWeight: 9000,
    emptyCog: { x: 4300, y: 0 },
    targetCog: { x: 4400, y: 0 },
    tolX: 0.1,
    tolY: 0.1,
    envGround: [-0.06, 0.035],
    envFlight: [-0.055, 0.035],
    envLateral: 0.045,
  },
  {
    id: 'L8',
    name: '大型 · 单舱双列 8 位',
    model: 'UAV-L8',
    desc: '双列并排，尾门装卸，支持尾投、侧投',
    version: 'v1.0',
    length: 6600,
    width: 3200,
    cabins: [{ id: 'MAIN', name: '主货舱', x0: 0, x1: 6600, width: 3200, height: 2100, maxWeight: 5600, loadDoor: 'TAIL' }],
    slots: [...lane('MAIN', 'L', seq(1000, 1500, 4), -720, 0, 700), ...lane('MAIN', 'R', seq(1000, 1500, 4), 720, 1, 700)],
    doors: [
      { id: 'TAIL', kind: 'tail', cabin: 'MAIN', x: 6600, y: 0, name: '尾门' },
      { id: 'SIDE', kind: 'side', cabin: 'MAIN', x: 1000, y: 1600, name: '右侧舱门' },
    ],
    drops: [
      { id: 'drop-tail', kind: 'tail', door: 'TAIL', name: '尾投' },
      { id: 'drop-side', kind: 'side', door: 'SIDE', name: '侧投' },
    ],
    emptyWeight: 15000,
    emptyCog: { x: 3200, y: 0 },
    targetCog: { x: 3150, y: 0 },
    tolX: 0.1,
    tolY: 0.1,
    envGround: [-0.03, 0.045],
    envFlight: [-0.03, 0.04],
    envLateral: 0.045,
  },
  {
    id: 'T7',
    name: '串列双舱 · 前 3 + 后 4',
    model: 'UAV-T7',
    desc: '前舱侧门、后舱尾门，多舱组合配平',
    version: 'v0.9',
    length: 12300,
    width: 2000,
    cabins: [
      { id: 'FWD', name: '前舱', x0: 0, x1: 4500, width: 2000, height: 1900, maxWeight: 2100, loadDoor: 'SIDE' },
      { id: 'AFT', name: '后舱', x0: 6300, x1: 12300, width: 2000, height: 1900, maxWeight: 2800, loadDoor: 'TAIL' },
    ],
    slots: [...lane('FWD', 'F', seq(800, 1440, 3), 0, 0, 700), ...lane('AFT', 'R', seq(7100, 1440, 4), 0, 0, 700)],
    doors: [
      { id: 'SIDE', kind: 'side', cabin: 'FWD', x: 3680, y: -1000, name: '前舱左侧门' },
      { id: 'TAIL', kind: 'tail', cabin: 'AFT', x: 12300, y: 0, name: '尾门' },
      { id: 'BELLY', kind: 'belly', cabin: 'AFT', x: 7100, y: 0, name: '后舱腹门' },
    ],
    drops: [
      { id: 'drop-tail', kind: 'tail', door: 'TAIL', name: '尾投（后舱）' },
      { id: 'drop-side', kind: 'side', door: 'SIDE', name: '侧投（前舱）' },
      { id: 'drop-belly', kind: 'belly', door: 'BELLY', name: '腹投（后舱）' },
    ],
    emptyWeight: 16500,
    emptyCog: { x: 6050, y: 0 },
    targetCog: { x: 6150, y: 0 },
    tolX: 0.1,
    tolY: 0.1,
    envGround: [-0.035, 0.03],
    envFlight: [-0.045, 0.03],
    envLateral: 0.03,
  },
  {
    id: 'H12',
    name: '重载 · 单舱双列 12 位',
    model: 'UAV-H12',
    desc: '大规模配载，启发式求解',
    version: 'v0.8',
    length: 9600,
    width: 3200,
    cabins: [{ id: 'MAIN', name: '主货舱', x0: 0, x1: 9600, width: 3200, height: 2100, maxWeight: 8400, loadDoor: 'TAIL' }],
    slots: [...lane('MAIN', 'L', seq(950, 1500, 6), -720, 0, 700), ...lane('MAIN', 'R', seq(950, 1500, 6), 720, 1, 700)],
    doors: [{ id: 'TAIL', kind: 'tail', cabin: 'MAIN', x: 9600, y: 0, name: '尾门' }],
    drops: [{ id: 'drop-tail', kind: 'tail', door: 'TAIL', name: '尾投' }],
    emptyWeight: 25000,
    emptyCog: { x: 4650, y: 0 },
    targetCog: { x: 4600, y: 0 },
    tolX: 0.1,
    tolY: 0.1,
    envGround: [-0.03, 0.035],
    envFlight: [-0.025, 0.03],
    envLateral: 0.035,
  },
]

export const configById = (id: string) => CABIN_CONFIGS.find((c) => c.id === id) ?? CABIN_CONFIGS[0]

// ───────────────────────── 基础计算 ─────────────────────────

export function rotateOffset(o: { x: number; y: number }, yaw: Yaw): Vec2 {
  switch (yaw) {
    case 90:
      return { x: -o.y, y: o.x }
    case 180:
      return { x: -o.x, y: -o.y }
    case 270:
      return { x: o.y, y: -o.x }
    default:
      return { x: o.x, y: o.y }
  }
}

const EPS = 1e-6

/** 某货位进出某舱门时在机上的路径（从门槛到货位） */
function routeFromDoor(s: SlotDef, d: Door): Vec2[] {
  if (d.kind === 'tail') return [{ x: d.x, y: s.y }, { x: s.x, y: s.y }]
  if (d.kind === 'side') {
    const pts = [{ x: d.x, y: d.y }, { x: d.x, y: s.y }]
    if (Math.abs(s.x - d.x) > EPS) pts.push({ x: s.x, y: s.y })
    return pts
  }
  const pts = [{ x: d.x, y: s.y }]
  if (Math.abs(s.x - d.x) > EPS) pts.push({ x: s.x, y: s.y })
  return pts
}

/** 必须先于 s 通过舱门 d 进入（或晚于 s 离开）的货位：同舱同列、同侧、离门更远者；位于门口工位的货位最后进、最先出 */
function fartherSlots(cfg: CabinConfig, s: SlotDef, d: Door): SlotDef[] {
  const ds = s.x - d.x
  return cfg.slots.filter((t) => {
    if (t === s || t.cabin !== s.cabin || t.lane !== s.lane) return false
    const dt = t.x - d.x
    if (Math.abs(ds) <= EPS) return Math.abs(dt) > EPS
    return Math.sign(dt) === Math.sign(ds) && Math.abs(dt) > Math.abs(ds) + EPS
  })
}

interface ModeDef {
  id: string
  name: string
  kind: 'load' | 'unload' | 'drop'
  exit: ExitKind
  env: [number, number]
  /** 每个货位：所用舱门（不参与的为 null）、路径、先后约束位掩码 */
  door: (Door | null)[]
  route: Vec2[][]
  /** load：必须先装的货位；drop/unload：必须先离开的货位 */
  before: number[]
}

interface Prep {
  cfg: CabinConfig
  S: number
  modes: ModeDef[]
  cabinIdx: number[]
}

const prepCache = new WeakMap<CabinConfig, Prep>()

function prepare(cfg: CabinConfig): Prep {
  const hit = prepCache.get(cfg)
  if (hit) return hit
  const S = cfg.slots.length
  const idx = new Map(cfg.slots.map((s, i) => [s, i]))
  const doorOf = (id: string) => cfg.doors.find((d) => d.id === id)!
  const mask = (list: SlotDef[]) => list.reduce((m, s) => m | (1 << idx.get(s)!), 0)
  const cabinDoor = (s: SlotDef) => doorOf(cfg.cabins.find((c) => c.id === s.cabin)!.loadDoor)
  const modes: ModeDef[] = []
  // 装载：离门远的先装
  modes.push({
    id: 'load',
    name: '装载',
    kind: 'load',
    exit: 'tail',
    env: cfg.envGround,
    door: cfg.slots.map(cabinDoor),
    route: cfg.slots.map((s) => routeFromDoor(s, cabinDoor(s))),
    before: cfg.slots.map((s) => mask(fartherSlots(cfg, s, cabinDoor(s)))),
  })
  // 投放：离门近的先出
  for (const dm of cfg.drops) {
    const d = doorOf(dm.door)
    modes.push({
      id: dm.id,
      name: dm.name,
      kind: 'drop',
      exit: dm.kind,
      env: cfg.envFlight,
      door: cfg.slots.map((s) => (s.cabin === d.cabin ? d : null)),
      route: cfg.slots.map((s) => (s.cabin === d.cabin ? routeFromDoor(s, d).reverse() : [])),
      before: cfg.slots.map((s) => (s.cabin === d.cabin ? mask(cfg.slots.filter((t) => fartherSlots(cfg, t, d).includes(s))) : 0)),
    })
  }
  // 卸载：装载的逆过程
  modes.push({
    id: 'unload',
    name: '卸载',
    kind: 'unload',
    exit: 'tail',
    env: cfg.envGround,
    door: cfg.slots.map(cabinDoor),
    route: cfg.slots.map((s) => routeFromDoor(s, cabinDoor(s)).reverse()),
    before: cfg.slots.map((s) => mask(cfg.slots.filter((t) => fartherSlots(cfg, t, cabinDoor(t)).includes(s)))),
  })
  const prep: Prep = { cfg, S, modes, cabinIdx: cfg.slots.map((s) => cfg.cabins.findIndex((c) => c.id === s.cabin)) }
  prepCache.set(cfg, prep)
  return prep
}

/** 过程仿真（准静态）：按先后约束贪心选择下一个进 / 出的托盘，使沿途归一化偏差最小；返回归一化峰值 */
function simulate(
  prep: Prep,
  mode: ModeDef,
  occ: ArrayLike<number>,
  m: ArrayLike<number>,
  ox: ArrayLike<number>,
  oy: ArrayLike<number>,
  rec?: (slot: number, pts: { wp: Vec2; X: number; Y: number; M: number; cx: number; cy: number; cm: number }[], after: { X: number; Y: number; M: number; cx: number; cy: number; cm: number }) => void,
): number {
  const { cfg, S } = prep
  const L = cfg.length
  const W = cfg.width
  const [fwd, aft] = mode.env
  const lat = cfg.envLateral
  const tx = cfg.targetCog.x
  const ty = cfg.targetCog.y
  const adding = mode.kind === 'load'
  let M = cfg.emptyWeight
  let Mx = M * cfg.emptyCog.x
  let My = M * cfg.emptyCog.y
  let todo = 0
  for (let s = 0; s < S; s++) {
    const i = occ[s]
    if (i < 0) continue
    if (mode.door[s]) todo |= 1 << s
    if (!adding) {
      M += m[i]
      Mx += m[i] * (cfg.slots[s].x + ox[i])
      My += m[i] * (cfg.slots[s].y + oy[i])
    }
  }
  const norm = (X: number, Y: number) => {
    const dx = (X - tx) / L
    const dy = Math.abs(Y - ty) / W / lat
    const nx = dx >= 0 ? dx / aft : dx / fwd
    return nx > dy ? nx : dy
  }
  let peak = norm(Mx / M, My / M)
  let cm = 0,
    cmx = 0,
    cmy = 0
  if (rec && !adding) {
    for (let s = 0; s < S; s++) {
      const i = occ[s]
      if (i < 0) continue
      cm += m[i]
      cmx += m[i] * (cfg.slots[s].x + ox[i])
      cmy += m[i] * (cfg.slots[s].y + oy[i])
    }
  }
  while (todo) {
    let best = -1
    let bestWorst = Infinity
    for (let s = 0; s < S; s++) {
      if (!((todo >> s) & 1) || mode.before[s] & todo) continue
      const i = occ[s]
      // 该托盘沿路径各端点的系统重心（装载：把它加进来；离机：它仍在机上，只是位置变了）
      const bM = adding ? M + m[i] : M
      const bx = adding ? Mx : Mx - m[i] * (cfg.slots[s].x + ox[i])
      const by = adding ? My : My - m[i] * (cfg.slots[s].y + oy[i])
      let worst = 0
      const r = mode.route[s]
      for (let k = 0; k < r.length; k++) {
        const v = norm((bx + m[i] * (r[k].x + ox[i])) / bM, (by + m[i] * (r[k].y + oy[i])) / bM)
        if (v > worst) worst = v
      }
      if (worst < bestWorst - 1e-12) {
        bestWorst = worst
        best = s
      }
    }
    if (best < 0) break
    const s = best
    const i = occ[s]
    if (bestWorst > peak) peak = bestWorst
    if (rec) {
      const bM = adding ? M + m[i] : M
      const bx = adding ? Mx : Mx - m[i] * (cfg.slots[s].x + ox[i])
      const by = adding ? My : My - m[i] * (cfg.slots[s].y + oy[i])
      const ccm = adding ? cm + m[i] : cm
      const ccx = adding ? cmx : cmx - m[i] * (cfg.slots[s].x + ox[i])
      const ccy = adding ? cmy : cmy - m[i] * (cfg.slots[s].y + oy[i])
      const pts = mode.route[s].map((wp) => ({
        wp,
        X: (bx + m[i] * (wp.x + ox[i])) / bM,
        Y: (by + m[i] * (wp.y + oy[i])) / bM,
        M: bM,
        cx: (ccx + m[i] * (wp.x + ox[i])) / ccm,
        cy: (ccy + m[i] * (wp.y + oy[i])) / ccm,
        cm: ccm,
      }))
      if (adding) {
        cm += m[i]
        cmx += m[i] * (cfg.slots[s].x + ox[i])
        cmy += m[i] * (cfg.slots[s].y + oy[i])
      } else {
        cm -= m[i]
        cmx -= m[i] * (cfg.slots[s].x + ox[i])
        cmy -= m[i] * (cfg.slots[s].y + oy[i])
      }
      const aM = adding ? M + m[i] : M - m[i]
      const ax = adding ? Mx + m[i] * (cfg.slots[s].x + ox[i]) : Mx - m[i] * (cfg.slots[s].x + ox[i])
      const ay = adding ? My + m[i] * (cfg.slots[s].y + oy[i]) : My - m[i] * (cfg.slots[s].y + oy[i])
      rec(s, pts, { X: ax / aM, Y: ay / aM, M: aM, cx: cm > EPS ? cmx / cm : NaN, cy: cm > EPS ? cmy / cm : NaN, cm })
    }
    if (adding) {
      M += m[i]
      Mx += m[i] * (cfg.slots[s].x + ox[i])
      My += m[i] * (cfg.slots[s].y + oy[i])
    } else {
      M -= m[i]
      Mx -= m[i] * (cfg.slots[s].x + ox[i])
      My -= m[i] * (cfg.slots[s].y + oy[i])
      const v = norm(Mx / M, My / M)
      if (v > peak) peak = v
    }
    todo &= ~(1 << s)
  }
  return peak
}

// ───────────────────────── 评估（也用于人工调整后的即时重算） ─────────────────────────

function toArrays(cfg: CabinConfig, pallets: PalletUnit[], assignments: Assignment[]) {
  const pIdx = new Map(pallets.map((p, i) => [p.id, i]))
  const sIdx = new Map(cfg.slots.map((s, i) => [s.id, i]))
  const occ = new Int8Array(cfg.slots.length).fill(-1)
  const m = new Float64Array(pallets.length)
  const ox = new Float64Array(pallets.length)
  const oy = new Float64Array(pallets.length)
  pallets.forEach((p, i) => (m[i] = p.weight))
  for (const a of assignments) {
    const i = pIdx.get(a.palletId)
    const s = sIdx.get(a.slotId)
    if (i === undefined || s === undefined) continue
    occ[s] = i
    const o = rotateOffset(pallets[i].cog, a.yaw)
    ox[i] = o.x
    oy[i] = o.y
  }
  return { occ, m, ox, oy }
}

export function evaluateStatic(cfg: CabinConfig, pallets: PalletUnit[], assignments: Assignment[]): LoadMetrics {
  const { occ, m, ox, oy } = toArrays(cfg, pallets, assignments)
  let cm = 0,
    cx = 0,
    cy = 0
  const cab = cfg.cabins.map(() => ({ m: 0, x: 0, y: 0 }))
  const violations: Violation[] = []
  cfg.slots.forEach((s, k) => {
    const i = occ[k]
    if (i < 0) return
    cm += m[i]
    cx += m[i] * (s.x + ox[i])
    cy += m[i] * (s.y + oy[i])
    const c = cab[cfg.cabins.findIndex((c) => c.id === s.cabin)]
    c.m += m[i]
    c.x += m[i] * (s.x + ox[i])
    c.y += m[i] * (s.y + oy[i])
    if (m[i] > s.maxWeight + EPS) violations.push({ code: 'SLOT_OVERWEIGHT', message: `${pallets[i].id} 重 ${m[i].toFixed(0)} kg，超过货位 ${s.id} 限重 ${s.maxWeight} kg` })
    const cabin = cfg.cabins.find((c) => c.id === s.cabin)!
    if (pallets[i].size[2] > cabin.height - 150) violations.push({ code: 'TOO_TALL', message: `${pallets[i].id} 总高 ${pallets[i].size[2]} mm，超过${cabin.name}净高` })
  })
  const cargoCog = cm > EPS ? { x: cx / cm, y: cy / cm } : { ...cfg.targetCog }
  const M = cfg.emptyWeight + cm
  const systemCog = { x: (cfg.emptyWeight * cfg.emptyCog.x + cx) / M, y: (cfg.emptyWeight * cfg.emptyCog.y + cy) / M }
  const cabinCogs = cfg.cabins.map((c, k) => {
    const ok = cab[k].m <= c.maxWeight + EPS
    if (!ok) violations.push({ code: 'CABIN_OVERWEIGHT', message: `${c.name}装载 ${cab[k].m.toFixed(0)} kg，超过限重 ${c.maxWeight} kg` })
    return { cabin: c.id, name: c.name, weight: cab[k].m, cog: cab[k].m > EPS ? { x: cab[k].x / cab[k].m, y: cab[k].y / cab[k].m } : null, limit: c.maxWeight, ok }
  })
  const errX = cm > EPS ? (cargoCog.x - cfg.targetCog.x) / cfg.length : 0
  const errY = cm > EPS ? (cargoCog.y - cfg.targetCog.y) / cfg.width : 0
  if (Math.abs(errX) > cfg.tolX + 1e-9) violations.push({ code: 'COG_X', message: `货物重心长向误差 ${(errX * 100).toFixed(1)}% 超过 ±${cfg.tolX * 100}%` })
  if (Math.abs(errY) > cfg.tolY + 1e-9) violations.push({ code: 'COG_Y', message: `货物重心宽向误差 ${(errY * 100).toFixed(1)}% 超过 ±${cfg.tolY * 100}%` })
  return {
    cargoWeight: cm,
    totalWeight: M,
    cargoCog,
    systemCog,
    cabinCogs,
    errX,
    errY,
    sysErrX: (systemCog.x - cfg.targetCog.x) / cfg.length,
    sysErrY: (systemCog.y - cfg.targetCog.y) / cfg.width,
    pass: violations.length === 0,
    violations,
  }
}

export function buildTracks(cfg: CabinConfig, pallets: PalletUnit[], assignments: Assignment[]): Record<string, StageTrack> {
  const prep = prepare(cfg)
  const { occ, m, ox, oy } = toArrays(cfg, pallets, assignments)
  const out: Record<string, StageTrack> = {}
  const L = cfg.length
  const W = cfg.width
  for (const mode of prep.modes) {
    const ops: StageOp[] = []
    const points: StagePoint[] = []
    const order: string[] = []
    const [fwd, aft] = mode.env
    const within = (dx: number, dy: number) => dx >= fwd - 1e-9 && dx <= aft + 1e-9 && Math.abs(dy) <= cfg.envLateral + 1e-9
    const push = (t: number, op: number, pid: string, X: number, Y: number, cx: number, cy: number, cm: number, label: string) => {
      const devX = (X - cfg.targetCog.x) / L
      const devY = (Y - cfg.targetCog.y) / W
      points.push({ t, op, palletId: pid, devX, devY, system: { x: X, y: Y }, cargo: cm > EPS ? { x: cx, y: cy } : null, cargoMass: cm, label, ok: within(devX, devY) })
    }
    // 起始状态
    {
      let M = cfg.emptyWeight,
        Mx = M * cfg.emptyCog.x,
        My = M * cfg.emptyCog.y,
        cm = 0,
        cx = 0,
        cy = 0
      if (mode.kind !== 'load')
        cfg.slots.forEach((s, k) => {
          const i = occ[k]
          if (i < 0) return
          M += m[i]
          Mx += m[i] * (s.x + ox[i])
          My += m[i] * (s.y + oy[i])
          cm += m[i]
          cx += m[i] * (s.x + ox[i])
          cy += m[i] * (s.y + oy[i])
        })
      push(0, -1, '', Mx / M, My / M, cm ? cx / cm : 0, cm ? cy / cm : 0, cm, mode.kind === 'load' ? '空舱' : '满载')
    }
    const peak = simulate(prep, mode, occ, m, ox, oy, (s, pts, after) => {
      const k = ops.length
      const pid = pallets[occ[s]].id
      const slot = cfg.slots[s]
      order.push(pid)
      ops.push({ palletId: pid, slotId: slot.id, dir: mode.kind === 'load' ? 'in' : 'out', door: mode.door[s]!, way: pts.map((p) => p.wp) })
      // 时间片：装载 [k+0.3, k+1] 在机上移动；离机 [k, k+0.7] 在机上移动，随后离开
      const a = mode.kind === 'load' ? 0.3 : 0
      const b = mode.kind === 'load' ? 1 : 0.7
      // 装载：托盘越过门槛之前不计入系统，重心保持上一状态，过门槛瞬间跳变
      if (mode.kind === 'load') {
        const prev = points[points.length - 1]
        points.push({ ...prev, t: k + a, label: `${pid} 待装` })
      }
      pts.forEach((p, j) => {
        const t = k + a + ((b - a) * j) / Math.max(1, pts.length - 1)
        const last = j === pts.length - 1
        const label =
          mode.kind === 'load'
            ? j === 0
              ? `${pid} 进入${mode.door[s]!.name}`
              : last
                ? `${pid} 到位 ${slot.id}`
                : `${pid} 移动中`
            : j === 0
              ? `${pid} 解锁`
              : last
                ? `${pid} 到达${mode.door[s]!.name}`
                : `${pid} 移动中`
        push(pts.length === 1 ? k + b : t, k, pid, p.X, p.Y, p.cx, p.cy, p.cm, label)
      })
      if (mode.kind !== 'load') push(k + b, k, pid, after.X, after.Y, after.cx, after.cy, after.cm, `${pid} ${mode.kind === 'drop' ? '离机' : '卸下'}`)
    })
    let peakDevX = 0,
      peakDevY = 0,
      peakT = 0,
      worst = -1
    for (const p of points) {
      const nx = p.devX >= 0 ? p.devX / aft : p.devX / fwd
      const ny = Math.abs(p.devY) / cfg.envLateral
      const v = Math.max(nx, ny)
      if (v > worst) {
        worst = v
        peakDevX = p.devX
        peakDevY = p.devY
        peakT = p.t
      }
    }
    out[mode.id] = {
      mode: mode.id,
      name: mode.name,
      kind: mode.kind,
      exit: mode.exit,
      ops,
      points,
      peak,
      peakDevX,
      peakDevY,
      peakT,
      env: mode.env,
      envLateral: cfg.envLateral,
      ok: peak <= 1 + 1e-9,
      order,
    }
  }
  return out
}

/** 时间 t 处的系统 / 货物重心（在相邻校核点之间线性插值；离机瞬间取跳变后的值） */
export function trackAt(track: StageTrack, t: number): StagePoint {
  const pts = track.points
  if (t <= pts[0].t) return pts[0]
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].t <= t + 1e-9) {
      const a = pts[i]
      const b = pts[i + 1]
      if (!b || b.t - a.t < 1e-9 || !a.cargo !== !b.cargo) return a
      const f = Math.min(1, (t - a.t) / (b.t - a.t))
      const mix = (p: number, q: number) => p + (q - p) * f
      return {
        ...a,
        t,
        devX: mix(a.devX, b.devX),
        devY: mix(a.devY, b.devY),
        system: { x: mix(a.system.x, b.system.x), y: mix(a.system.y, b.system.y) },
        cargo: a.cargo && b.cargo && b.op === a.op ? { x: mix(a.cargo.x, b.cargo.x), y: mix(a.cargo.y, b.cargo.y) } : a.cargo,
        ok: a.ok && b.ok,
        label: f > 0.02 && f < 0.98 ? (b.op >= 0 ? `${b.palletId} 移动中` : a.label) : f >= 0.98 ? b.label : a.label,
      }
    }
  }
  return pts[pts.length - 1]
}

// ───────────────────────── 求解 ─────────────────────────

export interface LoadingOptions {
  /** 参与优化的过程：装载 + 该投放方式（缺省取构型的第一种） */
  dropMode?: string
  /** 是否把过程重心纳入优化（关闭后只按装载后的静态重心） */
  processAware?: boolean
  seed?: number
}

const ENUM_LIMIT = 60000

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function planLoading(cfg: CabinConfig, all: PalletUnit[], opts: LoadingOptions = {}): LoadingPlan {
  const t0 = performance.now()
  const prep = prepare(cfg)
  const S = prep.S
  const pallets = all.slice(0, S)
  const unassigned = all.slice(S).map((p) => p.id)
  const n = pallets.length
  const processAware = opts.processAware ?? true
  const dropId = opts.dropMode ?? cfg.drops[0]?.id
  const procModes = prep.modes.filter((md) => md.id === 'load' || md.id === dropId)
  const m = Float64Array.from(pallets, (p) => p.weight)
  const ox = Float64Array.from(pallets, (p) => p.cog.x)
  const oy = Float64Array.from(pallets, (p) => p.cog.y)
  const cabinMax = cfg.cabins.map((c) => c.maxWeight)
  const tx = cfg.targetCog.x
  const ty = cfg.targetCog.y

  const staticScore = (occ: ArrayLike<number>) => {
    let cm = 0,
      cx = 0,
      cy = 0
    for (let s = 0; s < S; s++) {
      const i = occ[s]
      if (i < 0) continue
      cm += m[i]
      cx += m[i] * (cfg.slots[s].x + ox[i])
      cy += m[i] * (cfg.slots[s].y + oy[i])
    }
    if (cm <= EPS) return 0
    const ex = Math.abs(cx / cm - tx) / cfg.length / cfg.tolX
    const ey = Math.abs(cy / cm - ty) / cfg.width / cfg.tolY
    return Math.max(ex, ey) + 0.25 * (ex + ey)
  }
  const procScore = (occ: ArrayLike<number>) => {
    let p = 0
    for (const md of procModes) p = Math.max(p, simulate(prep, md, occ, m, ox, oy))
    return p
  }
  const total = (st: number, p: number) => st + 0.15 * p + (p > 1 ? 10 * (p - 1) : 0)
  const penalty = (occ: ArrayLike<number>) => {
    let pen = 0
    const cw = cabinMax.map(() => 0)
    for (let s = 0; s < S; s++) {
      const i = occ[s]
      if (i < 0) continue
      if (m[i] > cfg.slots[s].maxWeight + EPS) pen += 5
      cw[prep.cabinIdx[s]] += m[i]
    }
    cw.forEach((w, k) => (pen += w > cabinMax[k] + EPS ? 5 + (w - cabinMax[k]) / 100 : 0))
    return pen
  }

  let space = 1
  for (let k = 0; k < n; k++) space *= S - k
  let best: Int8Array = new Int8Array(S).fill(-1)
  let bestJ = Infinity
  let evaluated = 0
  let method: SolverInfo['method'] = 'enumeration'
  let optimal = false

  if (n === 0) {
    bestJ = 0
    optimal = true
  } else if (space <= ENUM_LIMIT) {
    // 全枚举：逐个货位决定放哪一盘（或留空），带限重剪枝
    const rows: Int8Array[] = []
    const scores: number[] = []
    const occ = new Int8Array(S).fill(-1)
    const usedP = new Array<boolean>(n).fill(false)
    const cw = cabinMax.map(() => 0)
    const empties = S - n
    const dfs = (s: number, left: number, emptyLeft: number) => {
      if (s === S) {
        rows.push(occ.slice())
        scores.push(staticScore(occ))
        return
      }
      if (emptyLeft > 0) {
        occ[s] = -1
        dfs(s + 1, left, emptyLeft - 1)
      }
      if (left > 0) {
        const c = prep.cabinIdx[s]
        for (let i = 0; i < n; i++) {
          if (usedP[i] || m[i] > cfg.slots[s].maxWeight + EPS || cw[c] + m[i] > cabinMax[c] + EPS) continue
          usedP[i] = true
          cw[c] += m[i]
          occ[s] = i
          dfs(s + 1, left - 1, emptyLeft)
          usedP[i] = false
          cw[c] -= m[i]
        }
        occ[s] = -1
      }
    }
    dfs(0, n, empties)
    const idx = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b])
    for (const k of idx) {
      // 下界：总分 ≥ 静态分；按静态分升序扫描，可以提前结束
      if (scores[k] >= bestJ) break
      const J = total(scores[k], processAware ? procScore(rows[k]) : 0)
      evaluated++
      if (J < bestJ) {
        bestJ = J
        best = rows[k]
      }
    }
    optimal = rows.length > 0
    evaluated = Math.max(evaluated, rows.length)
    if (!rows.length) method = 'local-search'
  }
  if (!optimal && n > 0) {
    // 模拟退火 + 两两交换下降
    method = 'local-search'
    const rnd = mulberry(opts.seed ?? 7)
    const J = (occ: ArrayLike<number>) => total(staticScore(occ), processAware ? procScore(occ) : 0) + penalty(occ)
    for (let restart = 0; restart < 4; restart++) {
      const occ = new Int8Array(S).fill(-1)
      const perm = Array.from({ length: S }, (_, i) => i)
      for (let i = S - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1))
        ;[perm[i], perm[j]] = [perm[j], perm[i]]
      }
      for (let i = 0; i < n; i++) occ[perm[i]] = i
      let cur = J(occ)
      evaluated++
      let T = 0.5
      for (let it = 0; it < 5000; it++, T *= 0.9988) {
        const a = Math.floor(rnd() * S)
        const b = Math.floor(rnd() * S)
        if (a === b || (occ[a] < 0 && occ[b] < 0)) continue
        ;[occ[a], occ[b]] = [occ[b], occ[a]]
        const nx = J(occ)
        evaluated++
        if (nx <= cur || rnd() < Math.exp((cur - nx) / T)) cur = nx
        else [occ[a], occ[b]] = [occ[b], occ[a]]
      }
      for (let improved = true; improved; ) {
        improved = false
        for (let a = 0; a < S; a++)
          for (let b = a + 1; b < S; b++) {
            if (occ[a] < 0 && occ[b] < 0) continue
            ;[occ[a], occ[b]] = [occ[b], occ[a]]
            const nx = J(occ)
            evaluated++
            if (nx < cur - 1e-12) {
              cur = nx
              improved = true
            } else [occ[a], occ[b]] = [occ[b], occ[a]]
          }
      }
      if (cur < bestJ) {
        bestJ = cur
        best = occ.slice()
      }
    }
  }

  // 朝向微调：逐盘在 0/90/180/270 中取使静态偏差最小者
  const yaw: Yaw[] = pallets.map(() => 0)
  const YAWS: Yaw[] = [0, 90, 180, 270]
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      let by = yaw[i]
      let bs = Infinity
      for (const y of YAWS) {
        const o = rotateOffset(pallets[i].cog, y)
        ox[i] = o.x
        oy[i] = o.y
        const sc = staticScore(best)
        if (sc < bs - 1e-12) {
          bs = sc
          by = y
        }
      }
      yaw[i] = by
      const o = rotateOffset(pallets[i].cog, by)
      ox[i] = o.x
      oy[i] = o.y
    }
  }

  const assignments: Assignment[] = []
  for (let s = 0; s < S; s++) if (best[s] >= 0) assignments.push({ palletId: pallets[best[s]].id, slotId: cfg.slots[s].id, yaw: yaw[best[s]] })
  assignments.sort((a, b) => (a.palletId < b.palletId ? -1 : 1))
  const elapsedMs = performance.now() - t0

  return {
    configId: cfg.id,
    assignments,
    unassigned,
    metrics: evaluateStatic(cfg, pallets, assignments),
    tracks: buildTracks(cfg, pallets, assignments),
    solver: { method, evaluated, space, optimal, elapsedMs },
    baseline: baselinePlan(cfg, pallets),
  }
}

/** 对照方案：按出库顺序（盘号）依次装入，先到的放最里面 */
export function baselinePlan(cfg: CabinConfig, pallets: PalletUnit[]) {
  const prep = prepare(cfg)
  const load = prep.modes[0]
  const S = prep.S
  const order: number[] = []
  let todo = (1 << S) - 1
  while (todo) {
    let pick = -1
    for (let s = 0; s < S; s++) {
      if (!((todo >> s) & 1) || load.before[s] & todo) continue
      pick = s
      break
    }
    if (pick < 0) break
    order.push(pick)
    todo &= ~(1 << pick)
  }
  const assignments: Assignment[] = pallets.slice(0, S).map((p, i) => ({ palletId: p.id, slotId: cfg.slots[order[i]].id, yaw: 0 as Yaw }))
  return { assignments, metrics: evaluateStatic(cfg, pallets, assignments), tracks: buildTracks(cfg, pallets, assignments) }
}

/** 人工调整后的即时重算 */
export function evaluatePlan(cfg: CabinConfig, pallets: PalletUnit[], assignments: Assignment[], base?: LoadingPlan): LoadingPlan {
  const t0 = performance.now()
  const placed = new Set(assignments.map((a) => a.palletId))
  return {
    configId: cfg.id,
    assignments,
    unassigned: pallets.filter((p) => !placed.has(p.id)).map((p) => p.id),
    metrics: evaluateStatic(cfg, pallets, assignments),
    tracks: buildTracks(cfg, pallets, assignments),
    solver: { method: 'manual', evaluated: 1, space: base?.solver.space ?? 1, optimal: false, elapsedMs: performance.now() - t0 },
    baseline: base?.baseline ?? null,
  }
}
