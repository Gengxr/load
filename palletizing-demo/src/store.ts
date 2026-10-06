import { computed, reactive, shallowRef } from 'vue'
import type { Cargo, PlanResult, SequenceResult, SequenceStrategy } from './algo/types'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE } from './algo/defaults'
import { DEFAULT_GEN, generateCargos, type GenParams } from './algo/generator'
import { colorForSku } from './viz/palette'
import { runPlan } from './plannerClient'

export type ViewMode = 'plan' | 'compare' | 'station'
export type PresetKey = 'standard' | 'mixed' | 'fig21' | 'random' | 'import'

export interface Preset {
  key: PresetKey
  name: string
  desc: string
  gen: Partial<GenParams>
}

export const PRESETS: Preset[] = [
  { key: 'standard', name: '标准规格', desc: '5 种模数化纸箱，贴近仓储实际', gen: { mode: 'standard', skuCount: 5, fillRatio: 0.85 } },
  { key: 'mixed', name: '多规格混装', desc: '8–10 种规格，层内、层间混码', gen: { mode: 'mixed', skuCount: 9, fillRatio: 0.84 } },
  { key: 'fig21', name: '图 2-1 复现', desc: '单规格，复现技术要求中的堆码方式', gen: { mode: 'single', singleIndex: 3, singleHeight: 200 } },
  { key: 'random', name: '随机尺寸', desc: '每件尺寸随机，压力测试', gen: { mode: 'random', fillRatio: 0.76, heightStep: 50 } },
]

export const state = reactive({
  gen: { ...DEFAULT_GEN, ...PRESETS[0].gen } as GenParams,
  cons: { ...DEFAULT_CONSTRAINTS },
  seq: { ...DEFAULT_SEQUENCE },
  pallet: { ...DEFAULT_PALLET },
  preset: 'standard' as PresetKey,
  importName: '' as string,
  planning: false,
  progress: { stage: '', pct: 0 },
  error: '' as string,
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
  explainOpen: false,
  /** 右侧技术指标面板（默认收起，给三维演示让出空间） */
  metricsOpen: false,
  /** 左侧参数抽屉 */
  paramsOpen: false,
  /** 流程阶段：用于顶部流程条高亮 */
  stage: 0,
})

export const cargos = shallowRef<Cargo[]>([])
export const result = shallowRef<PlanResult | null>(null)
/** 本次方案对应的货物（结果与参数面板解耦，避免改参数时画面错位） */
export const planCargos = shallowRef<Cargo[]>([])

export const skuColors = computed(() => colorForSku(cargos.value.map((c) => c.sku)))
export const cargoById = computed(() => new Map(planCargos.value.map((c) => [c.id, c])))

export const currentSeq = computed<SequenceResult | null>(() => {
  const r = result.value
  if (!r) return null
  return state.strategy === 'balance' ? r.sequences.balance : r.sequences.baseline
})

export const totalSteps = computed(() => result.value?.layout.placements.length ?? 0)

export function applyPreset(key: PresetKey) {
  const p = PRESETS.find((x) => x.key === key)
  state.preset = key
  if (!p) return
  Object.assign(state.gen, DEFAULT_GEN, p.gen, { seed: state.gen.seed })
}

export function generate() {
  if (state.preset === 'import') return
  cargos.value = generateCargos({ ...state.gen })
}

export async function plan() {
  if (!cargos.value.length) generate()
  state.planning = true
  state.error = ''
  state.playing = false
  state.progress = { stage: 'layout', pct: 0.02 }
  const input = { cargos: cargos.value, pallet: { ...state.pallet }, constraints: { ...state.cons }, sequence: { ...state.seq } }
  const t0 = performance.now()
  try {
    const res = await runPlan(input, (stage, pct) => (state.progress = { stage, pct }))
    // 让进度动画至少可见一小会儿
    const wait = Math.max(0, 450 - (performance.now() - t0))
    await new Promise((r) => setTimeout(r, wait))
    planCargos.value = cargos.value
    result.value = res
    state.step = 0
    state.selectedLayer = null
    state.layerLimit = null
    state.stage = 4
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e)
  } finally {
    state.planning = false
  }
}

export async function generateAndPlan() {
  generate()
  await plan()
}

export function rerollSeed() {
  state.gen.seed = Math.floor(Math.random() * 90000000) + 10000000
}
