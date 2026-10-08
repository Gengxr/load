import { computed, reactive, shallowRef } from 'vue'
import type { Cargo, PlanResult, SequenceResult, SequenceStrategy } from './algo/types'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE } from './algo/defaults'
import { DEFAULT_GEN, generateCargos, type GenParams } from './algo/generator'
import { DEFAULT_ALLOC, type AllocParams, type AllocationResult } from './algo/allocate'
import { planOrder, toPalletUnit, palletId, type PalletPlan } from './algo/pipeline'
import { CABIN_CONFIGS, evaluatePlan, planLoading, type Assignment, type CabinConfig, type LoadingPlan, type PalletUnit, type Yaw } from './algo/cabin'
import { colorForSku } from './viz/palette'
import { addTask, finishTask, planMany, submitPlan, type Task } from './taskPool'
import { load, save, uid } from './persist'

export type Workspace = 'order' | 'pallet' | 'cabin' | 'data'
export type ViewMode = 'plan' | 'compare' | 'station'
export type DataTab = 'datasets' | 'history' | 'api' | 'settings'

// ───────────────────────── 出库清单预设 ─────────────────────────

export interface OrderPreset {
  key: string
  name: string
  desc: string
  icon: string
  gen: Partial<GenParams>
  alloc: Partial<AllocParams>
}

export const ORDER_PRESETS: OrderPreset[] = [
  { key: 'standard', name: '标准出库单', desc: '6 盘 · 8 规格', icon: 'boxes', gen: { mode: 'standard', skuCount: 8, pallets: 6, fillRatio: 0.86, seed: 20261006 }, alloc: {} },
  { key: 'mixed', name: '多规格混装', desc: '5 盘 · 12 规格', icon: 'grid', gen: { mode: 'mixed', skuCount: 12, pallets: 5, fillRatio: 0.85, seed: 20261003 }, alloc: {} },
  { key: 'bulk', name: '大批量出库', desc: '8 盘 · 10 规格', icon: 'layers', gen: { mode: 'standard', skuCount: 10, pallets: 8, fillRatio: 0.86, seed: 20261008 }, alloc: {} },
  { key: 'fig21', name: '图 2-1 复现', desc: '单盘 · 同规格', icon: 'grid3', gen: { mode: 'single', singleIndex: 3, singleHeight: 200, pallets: 1, seed: 20261052 }, alloc: { fixedPallets: 1 } },
  { key: 'random', name: '随机尺寸', desc: '单盘 · 压力测试', icon: 'shuffle', gen: { mode: 'random', fillRatio: 0.76, heightStep: 50, pallets: 1, seed: 20261052 }, alloc: { fixedPallets: 1 } },
]

export interface Order {
  id: string
  name: string
  source: '模拟生成' | '外部导入'
  createdAt: number
  cargos: Cargo[]
}

export interface UserInfo {
  name: string
  account: string
  role: string
  dept: string
  loginAt: number
}

export interface Settings {
  /** 渲染分辨率：auto 跟随屏幕；hd 不低于 1080p；uhd 2 倍超采样 */
  quality: 'auto' | 'hd' | 'uhd'
  autoRotate: boolean
  labels: boolean
  speed: number
  /** 联动：码盘完成后自动生成装载方案 */
  autoLoading: boolean
}

export interface Dataset {
  id: string
  name: string
  source: '模拟生成' | '外部导入'
  createdAt: number
  count: number
  skus: number
  weight: number
  /** 模拟生成的数据集只存参数，载入时按种子重新生成（结果完全一致） */
  gen?: GenParams
  alloc?: Partial<AllocParams>
  preset?: string
  cargos?: Cargo[]
}

export interface HistoryRec {
  id: string
  time: number
  kind: '联合规划' | '码盘规划' | '装载规划'
  order: string
  cargoCount: number
  pallets: number
  passPallets: number
  cabin: string
  errX: number | null
  errY: number | null
  loadOk: boolean | null
  elapsedMs: number
  note: string
  gen?: GenParams
  alloc?: Partial<AllocParams>
  preset?: string
  datasetId?: string
}

const DEFAULT_SETTINGS: Settings = { quality: 'auto', autoRotate: false, labels: false, speed: 1, autoLoading: true }

export const state = reactive({
  user: load<UserInfo | null>('user', null),
  ws: 'order' as Workspace,
  dataTab: 'datasets' as DataTab,
  settings: { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('settings', {}) },

  // 出库清单与分配
  preset: 'standard',
  gen: { ...DEFAULT_GEN, ...ORDER_PRESETS[0].gen } as GenParams,
  alloc: { ...DEFAULT_ALLOC } as AllocParams,
  cons: { ...DEFAULT_CONSTRAINTS },
  seq: { ...DEFAULT_SEQUENCE },
  pallet: { ...DEFAULT_PALLET },
  importName: '',
  /** 多盘总览里高亮的货盘 */
  focus: -1,
  /** 分配明细抽屉（默认收起，给三维总览让出空间） */
  fleetOpen: false,
  fleetTab: 'pallets' as 'pallets' | 'matrix',

  // 运行状态
  planning: false,
  phase: '' as '' | 'alloc' | 'pallet' | 'loading',
  round: 0,
  error: '',

  // 单盘码放
  sel: 0,
  step: 0,
  playing: false,
  speed: 1,
  strategy: 'balance' as SequenceStrategy,
  mode: 'plan' as ViewMode,
  showLabels: false,
  showCog: true,
  autoRotate: false,
  layerLimit: null as number | null,
  selectedLayer: null as number | null,
  metricsOpen: false,
  paramsOpen: false,

  // 舱内装载
  cabinId: 'M6',
  cabinMode: 'load',
  cabinT: 0,
  cabinPlaying: false,
  cabinSel: '' as string,
  cabinPanel: false,
  processAware: true,

  // 浮层
  explainOpen: false,
  helpOpen: false,
  tasksOpen: false,
  userOpen: false,
  toast: '' as string,
})

export const order = shallowRef<Order | null>(null)
export const allocation = shallowRef<AllocationResult | null>(null)
export const pallets = shallowRef<PalletPlan[]>([])
export const runInfo = shallowRef<{ rounds: number; rerouted: number; elapsedMs: number; unplaced: number } | null>(null)
export const pipelineTasks = shallowRef<Task[]>([])
export const loading = shallowRef<LoadingPlan | null>(null)
/** 求解器给出的最优方案（人工调整后可一键恢复） */
export const loadingBest = shallowRef<LoadingPlan | null>(null)
/** 实测回传的整托数据（覆盖预测值） */
export const measured = shallowRef<Record<string, PalletUnit>>({})
export const customConfigs = shallowRef<CabinConfig[]>([])

export interface ApiLog {
  id: number
  time: number
  sys: 'wms' | 'cabin'
  dir: 'in' | 'out'
  method: string
  path: string
  status: number
  note: string
}
/** 接口报文日志（演示版由仿真桩产生；正式版为真实收发记录） */
export const apiLog = shallowRef<ApiLog[]>([])
let apiSeq = 0
export function logApi(sys: ApiLog['sys'], dir: ApiLog['dir'], method: string, path: string, status: number, note: string) {
  apiLog.value = [{ id: ++apiSeq, time: Date.now(), sys, dir, method, path, status, note }, ...apiLog.value].slice(0, 60)
}

export const datasets = shallowRef<Dataset[]>(load<Dataset[]>('datasets', []))
export const history = shallowRef<HistoryRec[]>(load<HistoryRec[]>('history', []))

// ───────────────────────── 派生数据（单盘视图沿用原有命名） ─────────────────────────

export const current = computed<PalletPlan | null>(() => pallets.value[state.sel] ?? null)
export const cargos = computed<Cargo[]>(() => current.value?.cargos ?? [])
export const planCargos = cargos
export const result = computed<PlanResult | null>(() => current.value?.result ?? null)
export const allCargos = computed<Cargo[]>(() => order.value?.cargos ?? [])
export const skuColors = computed(() => colorForSku(allCargos.value.map((c) => c.sku)))
export const cargoById = computed(() => new Map(allCargos.value.map((c) => [c.id, c])))

export const currentSeq = computed<SequenceResult | null>(() => {
  const r = result.value
  if (!r) return null
  return state.strategy === 'balance' ? r.sequences.balance : r.sequences.baseline
})
export const totalSteps = computed(() => result.value?.layout.placements.length ?? 0)

export const configs = computed(() => [...CABIN_CONFIGS, ...customConfigs.value])
export const cabin = computed<CabinConfig>(() => configs.value.find((c) => c.id === state.cabinId) ?? CABIN_CONFIGS[0])
export const units = computed<PalletUnit[]>(() => pallets.value.map((p) => measured.value[p.id] ?? toPalletUnit(p, state.pallet, state.cons)))
export const track = computed(() => loading.value?.tracks[state.cabinMode] ?? loading.value?.tracks.load ?? null)

export const palletPass = (p: PalletPlan) => p.result.metrics.items.every((m) => m.pass !== false) && p.result.layout.remaining.length === 0

export const summary = computed(() => {
  const ps = pallets.value
  if (!ps.length) return null
  const hs = ps.map((p) => p.result.metrics.stackSize[2])
  const ws = ps.map((p) => p.result.metrics.grossWeight)
  const utils = ps.flatMap((p) => {
    const u = p.result.metrics.layerUtilization
    return u.length > 1 ? u.slice(0, -1) : u
  })
  return {
    pallets: ps.length,
    pass: ps.filter(palletPass).length,
    boxes: ps.reduce((s, p) => s + p.result.layout.placements.length, 0),
    weight: ws.reduce((a, b) => a + b, 0),
    hMin: Math.min(...hs),
    hMax: Math.max(...hs),
    wMin: Math.min(...ws),
    wMax: Math.max(...ws),
    util: utils.length ? utils.reduce((a, b) => a + b, 0) / utils.length : 0,
    unplaced: ps.reduce((s, p) => s + p.result.layout.remaining.length, 0),
  }
})

// ───────────────────────── 会话与设置 ─────────────────────────

export function login(account: string, name?: string) {
  state.user = { name: name || (account === 'admin' ? '系统管理员' : account), account, role: account === 'admin' ? '管理员' : '规划员', dept: '航空货运实验室', loginAt: Date.now() }
  save('user', state.user)
}
export function logout() {
  state.user = null
  state.userOpen = false
  save('user', null)
}
export function saveProfile(patch: Partial<UserInfo>) {
  if (!state.user) return
  Object.assign(state.user, patch)
  save('user', state.user)
}
export function saveSettings() {
  save('settings', state.settings)
  state.autoRotate = state.settings.autoRotate
  state.showLabels = state.settings.labels
  state.speed = state.settings.speed
}
export function toast(msg: string) {
  state.toast = msg
  const mine = msg
  setTimeout(() => state.toast === mine && (state.toast = ''), 2600)
}

// ───────────────────────── 出库清单 ─────────────────────────

let orderSeq = load<number>('orderSeq', 0)
function nextOrderId() {
  orderSeq++
  save('orderSeq', orderSeq)
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `CK${ymd}-${String(orderSeq).padStart(3, '0')}`
}

export function applyPreset(key: string) {
  const p = ORDER_PRESETS.find((x) => x.key === key)
  if (!p) return
  state.preset = key
  state.importName = ''
  Object.assign(state.gen, DEFAULT_GEN, p.gen)
  Object.assign(state.alloc, DEFAULT_ALLOC, p.alloc)
}

export function rerollSeed() {
  state.gen.seed = Math.floor(Math.random() * 90000000) + 10000000
}

export function generateOrder() {
  const p = ORDER_PRESETS.find((x) => x.key === state.preset)
  order.value = { id: nextOrderId(), name: p?.name ?? '模拟出库单', source: '模拟生成', createdAt: Date.now(), cargos: generateCargos({ ...state.gen }) }
}

export function importOrder(name: string, list: Cargo[]) {
  state.preset = 'import'
  state.importName = name
  Object.assign(state.alloc, DEFAULT_ALLOC)
  order.value = { id: nextOrderId(), name: name.replace(/\.json$/i, ''), source: '外部导入', createdAt: Date.now(), cargos: list }
}

// ───────────────────────── 数据集与历史 ─────────────────────────

export function saveDataset(name?: string): Dataset | null {
  const o = order.value
  if (!o) return null
  const generated = o.source === '模拟生成'
  const ds: Dataset = {
    id: uid('DS'),
    name: name || `${o.name} ${o.id}`,
    source: o.source,
    createdAt: Date.now(),
    count: o.cargos.length,
    skus: new Set(o.cargos.map((c) => c.sku)).size,
    weight: o.cargos.reduce((s, c) => s + c.weight, 0),
    gen: generated ? { ...state.gen } : undefined,
    alloc: { ...state.alloc },
    preset: state.preset,
    cargos: generated ? undefined : o.cargos,
  }
  datasets.value = [ds, ...datasets.value]
  if (!save('datasets', datasets.value)) {
    datasets.value = datasets.value.slice(1)
    toast('本地存储空间不足，未能保存')
    return null
  }
  return ds
}
export function deleteDataset(id: string) {
  datasets.value = datasets.value.filter((d) => d.id !== id)
  save('datasets', datasets.value)
}
export function renameDataset(id: string, name: string) {
  datasets.value = datasets.value.map((d) => (d.id === id ? { ...d, name } : d))
  save('datasets', datasets.value)
}
export async function loadDataset(id: string) {
  const d = datasets.value.find((x) => x.id === id)
  if (!d) return
  if (d.gen) {
    state.preset = d.preset ?? 'standard'
    state.importName = ''
    Object.assign(state.gen, DEFAULT_GEN, d.gen)
    Object.assign(state.alloc, DEFAULT_ALLOC, d.alloc ?? {})
    generateOrder()
  } else if (d.cargos) {
    importOrder(d.name, d.cargos)
    Object.assign(state.alloc, DEFAULT_ALLOC, d.alloc ?? {})
  }
  order.value = { ...order.value!, name: d.name }
  state.ws = 'order'
  await runPipeline()
}

function addHistory(rec: Omit<HistoryRec, 'id' | 'time'>) {
  history.value = [{ id: uid('H'), time: Date.now(), ...rec }, ...history.value].slice(0, 80)
  save('history', history.value)
}
export function deleteHistory(id: string) {
  history.value = history.value.filter((h) => h.id !== id)
  save('history', history.value)
}
export function clearHistory() {
  history.value = []
  save('history', [])
}
export async function replay(h: HistoryRec) {
  if (h.gen) {
    state.preset = h.preset ?? 'standard'
    state.importName = ''
    Object.assign(state.gen, DEFAULT_GEN, h.gen)
    Object.assign(state.alloc, DEFAULT_ALLOC, h.alloc ?? {})
    if (configs.value.some((c) => c.id === h.cabin)) state.cabinId = h.cabin
    generateOrder()
    state.ws = 'order'
    await runPipeline()
  } else if (h.datasetId) await loadDataset(h.datasetId)
  else toast('该记录来自外部导入的数据，原始清单未保存，无法复现')
}

// ───────────────────────── 规划流程 ─────────────────────────

function resetPalletView(i = 0) {
  state.playing = false
  state.sel = Math.max(0, Math.min(pallets.value.length - 1, i))
  state.step = pallets.value[state.sel]?.result.layout.placements.length ?? 0
  state.selectedLayer = null
  state.layerLimit = null
}

/** 联动运行：多盘分配 → 各盘并行码放（放不下自动回流）→ 舱内装载 */
export async function runPipeline() {
  if (state.planning) return
  if (!order.value) generateOrder()
  const o = order.value!
  state.planning = true
  state.error = ''
  state.playing = false
  state.cabinPlaying = false
  state.phase = 'alloc'
  state.round = 0
  pipelineTasks.value = []
  measured.value = {}
  const t0 = performance.now()
  logApi('wms', 'in', 'POST', '/ext/v1/wms/palletizing-requests', 202, `出库清单 ${o.id} · ${o.cargos.length} 件`)
  const allocTask = addTask('alloc', `多盘分配 · ${o.cargos.length} 件`)
  try {
    const slots = cabin.value.slots.length
    const res = await planOrder(
      o.cargos,
      { ...state.pallet },
      { ...state.cons },
      { ...state.seq },
      { ...state.alloc, maxPallets: state.alloc.fixedPallets ? 0 : Math.max(slots, ...configs.value.map((c) => c.slots.length)) },
      (inputs, onDone) => {
        const base = pipelineTasks.value.length
        const titles = inputs.map((inp, k) => `码盘规划 · 第 ${state.round} 轮 · ${inp.cargos.length} 件 #${base + k + 1}`)
        const list: Task[] = []
        const p = planMany(inputs, titles, onDone, (k, t) => (list[k] = t))
        pipelineTasks.value = [...pipelineTasks.value, ...list]
        return p
      },
      {
        onAllocated: (a) => {
          allocation.value = a
          finishTask(allocTask, `${a.stats.fullLayers} 个整层 + ${a.stats.mixedLayers} 个混合层 → ${a.groups.length} 盘`)
          state.phase = 'pallet'
        },
        onRound: (r) => (state.round = r + 1),
      },
    )
    // 让并行进度至少可见一小会儿
    await new Promise((r) => setTimeout(r, Math.max(0, 600 - (performance.now() - t0))))
    allocation.value = res.allocation
    pallets.value = res.pallets
    runInfo.value = { rounds: res.rounds, rerouted: res.rerouted, elapsedMs: res.elapsedMs, unplaced: res.unplaced.length }
    state.focus = -1
    resetPalletView(0)
    logApi('wms', 'out', 'POST', '{wms}/palletizing-plans', 200, `码盘方案 PP-${o.id} · ${res.pallets.length} 盘及散货出库顺序`)
    // 货位不够时自动换用更大的构型
    if (res.pallets.length > cabin.value.slots.length) {
      const bigger = [...configs.value].sort((a, b) => a.slots.length - b.slots.length).find((c) => c.slots.length >= res.pallets.length)
      if (bigger) {
        state.cabinId = bigger.id
        toast(`共 ${res.pallets.length} 盘，已自动切换到「${bigger.name}」`)
      }
    }
    state.phase = 'loading'
    if (state.settings.autoLoading) runLoading(false)
    const lp = loading.value
    addHistory({
      kind: '联合规划',
      order: `${o.name} ${o.id}`,
      cargoCount: o.cargos.length,
      pallets: res.pallets.length,
      passPallets: res.pallets.filter(palletPass).length,
      cabin: state.cabinId,
      errX: lp ? lp.metrics.errX : null,
      errY: lp ? lp.metrics.errY : null,
      loadOk: lp ? lp.metrics.pass && Object.values(lp.tracks).every((t) => t.ok) : null,
      elapsedMs: performance.now() - t0,
      note: res.rerouted ? `回流 ${res.rerouted} 件` : '',
      gen: o.source === '模拟生成' ? { ...state.gen } : undefined,
      alloc: { ...state.alloc },
      preset: state.preset,
    })
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e)
    if (allocTask.status === 'running') finishTask(allocTask, state.error, false)
  } finally {
    state.planning = false
    state.phase = ''
  }
}

export async function newOrderAndRun(presetKey?: string) {
  if (presetKey) applyPreset(presetKey)
  generateOrder()
  await runPipeline()
}

/** 独立运行：只重新规划当前货盘（参数调整后），其余货盘与装载任务不受影响 */
export async function replanPallet(i = state.sel) {
  const p = pallets.value[i]
  if (!p || state.planning) return
  state.playing = false
  const t0 = performance.now()
  const { task, done } = submitPlan({ cargos: p.cargos, pallet: { ...state.pallet }, constraints: { ...state.cons }, sequence: { ...state.seq } }, `码盘规划 · ${p.id} 重新规划`)
  pipelineTasks.value = [task]
  state.planning = true
  state.phase = 'pallet'
  try {
    const res = await done
    await new Promise((r) => setTimeout(r, Math.max(0, 450 - (performance.now() - t0))))
    const next = [...pallets.value]
    next[i] = { ...p, result: res }
    pallets.value = next
    resetPalletView(i)
    state.step = 0
    measured.value = {}
    if (state.settings.autoLoading) runLoading(false)
    addHistory({
      kind: '码盘规划',
      order: `${order.value?.name ?? ''} · ${p.id}`,
      cargoCount: p.cargos.length,
      pallets: 1,
      passPallets: palletPass(next[i]) ? 1 : 0,
      cabin: '',
      errX: null,
      errY: null,
      loadOk: null,
      elapsedMs: performance.now() - t0,
      note: '单盘重新规划',
    })
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e)
  } finally {
    state.planning = false
    state.phase = ''
  }
}

/** 装载规划（可独立运行）：货位分配 + 朝向 + 装载 / 投放顺序 + 过程重心 */
export function runLoading(record = true) {
  const us = units.value
  if (!us.length) return
  const cfg = cabin.value
  logApi('cabin', 'out', 'GET', `{cabin}/configs/${cfg.id}`, 200, `构型参数 ${cfg.model} ${cfg.version}`)
  const task = addTask('loading', `舱内装载 · ${cfg.model} · ${us.length} 盘`)
  const dropMode = cfg.drops.some((d) => d.id === state.cabinMode) ? state.cabinMode : cfg.drops[0]?.id
  const plan = planLoading(cfg, us, { dropMode, processAware: state.processAware })
  loading.value = plan
  loadingBest.value = plan
  if (!plan.tracks[state.cabinMode]) state.cabinMode = 'load'
  state.cabinPlaying = false
  state.cabinT = plan.tracks[state.cabinMode].ops.length
  state.cabinSel = ''
  const ok = plan.metrics.pass && Object.values(plan.tracks).every((t) => t.ok)
  finishTask(task, `${plan.solver.method === 'enumeration' ? `枚举 ${plan.solver.evaluated.toLocaleString()} 种` : `启发式评估 ${plan.solver.evaluated.toLocaleString()} 次`} · 重心误差 ${(plan.metrics.errX * 100).toFixed(2)}%`, ok)
  task.ms = plan.solver.elapsedMs
  logApi('cabin', 'out', 'POST', '{cabin}/loading-plans', 200, `装载方案 · ${plan.assignments.length} 盘 · 货位与装载 / 投放顺序`)
  logApi('wms', 'out', 'POST', '{wms}/loading-sequences', 200, `整托出库顺序 ${plan.tracks.load.order.join(' → ')}`)
  if (record)
    addHistory({
      kind: '装载规划',
      order: `${order.value?.name ?? ''} ${order.value?.id ?? ''}`,
      cargoCount: us.reduce((s, u) => s + (u.count ?? 0), 0),
      pallets: us.length,
      passPallets: pallets.value.filter(palletPass).length,
      cabin: cfg.id,
      errX: plan.metrics.errX,
      errY: plan.metrics.errY,
      loadOk: ok,
      elapsedMs: plan.solver.elapsedMs,
      note: plan.solver.optimal ? '全枚举最优' : '启发式',
    })
}

export function setCabin(id: string) {
  if (state.cabinId === id) return
  state.cabinId = id
  runLoading()
}

export function setCabinMode(mode: string) {
  const lp = loading.value
  if (!lp || !lp.tracks[mode]) return
  state.cabinPlaying = false
  state.cabinMode = mode
  state.cabinT = mode === 'load' ? lp.tracks[mode].ops.length : 0
}

function applyManual(assignments: Assignment[]) {
  const base = loadingBest.value ?? undefined
  loading.value = evaluatePlan(cabin.value, units.value, assignments, base)
  state.cabinPlaying = false
  const tr = loading.value.tracks[state.cabinMode]
  state.cabinT = state.cabinMode === 'load' ? tr.ops.length : 0
}

/** 人工调整：把托盘移到指定货位（货位上已有托盘则两者互换），即时重算重心 */
export function movePallet(pid: string, slotId: string) {
  const lp = loading.value
  if (!lp) return
  const as = lp.assignments.map((a) => ({ ...a }))
  const me = as.find((a) => a.palletId === pid)
  if (!me || me.slotId === slotId) return
  const other = as.find((a) => a.slotId === slotId)
  if (other) other.slotId = me.slotId
  me.slotId = slotId
  applyManual(as)
}
export function rotatePallet(pid: string) {
  const lp = loading.value
  if (!lp) return
  const as = lp.assignments.map((a) => (a.palletId === pid ? { ...a, yaw: ((a.yaw + 90) % 360) as Yaw } : { ...a }))
  applyManual(as)
}
export function restoreLoading() {
  if (!loadingBest.value) return
  loading.value = loadingBest.value
  state.cabinPlaying = false
  state.cabinT = state.cabinMode === 'load' ? loadingBest.value.tracks[state.cabinMode].ops.length : 0
}

/** 模拟"三点称重实测回传"：在预测值上叠加测量偏差，并用实测值复核当前装载方案 */
export function simulateMeasure() {
  let seed = (order.value?.cargos.length ?? 1) * 7919 + pallets.value.length * 104729
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296 - 0.5
  }
  const out: Record<string, PalletUnit> = {}
  for (const p of pallets.value) {
    const u = toPalletUnit(p, state.pallet, state.cons)
    out[p.id] = {
      ...u,
      weight: Math.round(u.weight * (1 + rnd() * 0.024) * 100) / 100,
      cog: { x: Math.round((u.cog.x + rnd() * 24) * 10) / 10, y: Math.round((u.cog.y + rnd() * 24) * 10) / 10, z: Math.round((u.cog.z + rnd() * 30) * 10) / 10 },
      source: 'MEASURED',
    }
  }
  measured.value = out
  logApi('wms', 'in', 'POST', '/ext/v1/wms/pallet-measurements', 202, `整托实测记录 · ${Object.keys(out).length} 盘（三点称重）`)
  if (loading.value) applyManual(loading.value.assignments.map((a) => ({ ...a })))
}
export function clearMeasure() {
  measured.value = {}
  if (loading.value) applyManual(loading.value.assignments.map((a) => ({ ...a })))
}

/** 导入外部整托数据（仓储系统实测）用于装载规划 */
export function importUnits(list: PalletUnit[]) {
  const out: Record<string, PalletUnit> = {}
  pallets.value.forEach((p, i) => {
    if (list[i]) out[p.id] = { ...list[i], id: p.id, source: 'MEASURED' }
  })
  measured.value = out
  runLoading()
}

export function addConfig(cfg: CabinConfig) {
  customConfigs.value = [...customConfigs.value.filter((c) => c.id !== cfg.id), cfg]
  state.cabinId = cfg.id
  runLoading()
}

export { palletId }

/** 把导入的清单直接存为数据集（导入货物信息管理） */
export function addImportedDataset(name: string, list: Cargo[]): Dataset | null {
  const ds: Dataset = {
    id: uid('DS'),
    name: name.replace(/\.json$/i, ''),
    source: '外部导入',
    createdAt: Date.now(),
    count: list.length,
    skus: new Set(list.map((c) => c.sku)).size,
    weight: list.reduce((s, c) => s + c.weight, 0),
    cargos: list,
  }
  datasets.value = [ds, ...datasets.value]
  if (!save('datasets', datasets.value)) {
    datasets.value = datasets.value.slice(1)
    toast('本地存储空间不足，未能保存')
    return null
  }
  return ds
}

export function datasetCargos(d: Dataset): Cargo[] {
  return d.cargos ?? (d.gen ? generateCargos({ ...DEFAULT_GEN, ...d.gen }) : [])
}

export function resetLocalData() {
  datasets.value = []
  history.value = []
  save('datasets', [])
  save('history', [])
  Object.assign(state.settings, DEFAULT_SETTINGS)
  saveSettings()
}
