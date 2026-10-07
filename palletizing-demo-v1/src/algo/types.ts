/**
 * 单盘动态码放规划 —— 领域数据模型
 *
 * 坐标约定（算法内部）：
 *   - 垛形局部坐标系：原点在 1000×1000 垛形区域的左前角（货盘上表面），
 *     X 向右、Y 向远离操作者（操作者站在 Y=0 一侧）、Z 向上，单位 mm。
 *   - 垛形区域居中放置在货盘上，因此货盘几何中心 = (footprintX/2, footprintY/2)。
 *   - 货物位置 (x,y,z) 取旋转后的最小角点。
 */

export interface Cargo {
  id: string
  rfid: string
  /** 规格编号：同规格 = 同尺寸（重量可以不同） */
  sku: string
  /** 长 ≥ 宽，mm */
  length: number
  width: number
  height: number
  /** kg，重心默认在几何中心 */
  weight: number
}

export interface PalletSpec {
  length: number
  width: number
  height: number
  /** 货盘自重 kg，重心按几何中心（对称假设） */
  tareWeight: number
}

export type OffsetBase = 'pallet' | 'footprint'

export interface Constraints {
  /** 垛形外边界（长宽方向），技术要求：≤1000×1000 */
  footprintX: number
  footprintY: number
  /** 垛高上限（仅货物，不含货盘），技术要求：1000–1200 */
  maxStackHeight: number
  /** 垛高下限（软约束，货量不足时仅提示） */
  minStackHeight: number
  /** 重心高度 ≤ ratio × (货物+货盘总高)，技术要求 1/2+10% */
  cogHeightRatioMax: number
  /** 水平重心偏离 ≤ ratio × 基准长度，技术要求 ±10% */
  cogOffsetRatioMax: number
  /** 偏移基准：货盘尺寸 1219 还是垛形 1000（待甲方确认，默认货盘） */
  cogOffsetBase: OffsetBase
  /** 层利用率下限（相对 1000×1000，与技术要求图 2-1 的口径一致） */
  utilizationMin: number
  /** 上层外轮廓超出下层外轮廓的最大比例，技术要求 5% */
  overhangRatioMax: number
  /** 单件底面支撑率下限（研发假设，待确认） */
  supportRatioMin: number
  /** 同层高度容差 mm */
  heightTolerance: number
  /** 是否允许侧放（改变竖直方向） */
  allowTipping: boolean
}

/** balance：本方案；layer-row：对照基线（逐层行扫描）；dblf：对照算法 DBLF 自带的放置次序 */
export type SequenceStrategy = 'balance' | 'layer-row' | 'dblf'

export interface SequenceParams {
  /** 允许提前开始上层的层数：0 = 严格逐层；1 = 下层局部完成后可先码上层 */
  layerLead: number
  beamWidth: number
  /** 权重：过程峰值偏心 / 平均偏心 / 封闭孔位 / 行走距离 / 每次换层 */
  wPeak: number
  wMean: number
  wHole: number
  wTravel: number
  wLayerJump: number
}

export interface PlanInput {
  cargos: Cargo[]
  pallet: PalletSpec
  constraints: Constraints
  sequence: SequenceParams
}

export interface Placement {
  cargoId: string
  sku: string
  x: number
  y: number
  z: number
  /** 旋转后的尺寸 */
  dx: number
  dy: number
  dz: number
  /** 长边沿 Y（绕竖轴转 90°） */
  rotated: boolean
  /** 是否侧放 */
  tipped: boolean
  /** 所属层（从 0 开始） */
  layer: number
  weight: number
}

export type LayerKind = 'pattern' | 'mixed' | 'cap' | 'free'

export interface LayerInfo {
  index: number
  z: number
  height: number
  kind: LayerKind
  count: number
  /** 相对 footprint 面积的投影利用率 */
  utilization: number
  bbox: [number, number, number, number]
  weight: number
}

export interface LayoutResult {
  placements: Placement[]
  layers: LayerInfo[]
  /** 未能放入的货物（保留人工处理接口） */
  remaining: Cargo[]
  strategy: 'layered' | 'free'
}

export interface StepSeries {
  /** 第 k 步（放完第 k 件后）的系统重心（货物+货盘），长度 n+1，k=0 为空托盘 */
  cogX: number[]
  cogY: number[]
  cogZ: number[]
  mass: number[]
  /** 偏心率 = max(|dx|/base, |dy|/base) */
  ratio: number[]
  /** 偏载力矩 N·m */
  moment: number[]
  /** 本步放置货物的支撑率 */
  support: number[]
  /** 本步放置货物被同层已放货物封闭的侧面数 */
  enclosed: number[]
  /** 本步是否换层（与上一件不在同一层） */
  layerJump: boolean[]
}

export interface SequenceSummary {
  peakRatio: number
  meanRatio: number
  /** 峰值出现的步号 */
  peakStep: number
  peakMoment: number
  /** 超出容差的步数（不计入前 warmupSteps 步） */
  exceedSteps: number
  holes: number
  travel: number
  /** 换层次数（严格逐层 = 层数 − 1） */
  layerJumps: number
  valid: boolean
}

export interface SequenceResult {
  strategy: SequenceStrategy
  /** placements 下标的码放顺序 */
  order: number[]
  steps: StepSeries
  summary: SequenceSummary
  elapsedMs: number
}

export interface MetricItem {
  key: string
  name: string
  value: number
  display: string
  limit: string
  /** true 达标 / false 未达标 / null 仅供参考 */
  pass: boolean | null
  source: string
  note?: string
}

export interface LayoutMetrics {
  stackSize: [number, number, number]
  cargoWeight: number
  grossWeight: number
  /** 系统重心（货物+货盘），垛形局部坐标 */
  cog: [number, number, number]
  cogOffsetRatio: [number, number]
  /** 重心高度（从货盘底面起算）/ 总高 */
  cogHeightRatio: number
  cogHeightTotal: number
  layerUtilization: number[]
  minLayerUtilization: number
  maxOverhangRatio: number
  minSupportRatio: number
  interlockRatio: number
  collisions: number
  outOfBounds: number
  items: MetricItem[]
}

/** 对照算法（DBLF）的完整结果：位置、顺序与指标都由它自己生成 */
export interface BaselinePlan {
  layout: LayoutResult
  supporters: number[][]
  sequence: SequenceResult
  metrics: LayoutMetrics
  elapsedMs: number
}

export interface PlanResult {
  layout: LayoutResult
  /** 每件货物的直接支撑者（placements 下标） */
  supporters: number[][]
  sequences: { balance: SequenceResult; baseline: SequenceResult }
  metrics: LayoutMetrics
  /** 公认的经典算法 DBLF 在同一批货物上的结果，用于整体对比 */
  dblf: BaselinePlan
  timings: { layoutMs: number; sequenceMs: number; totalMs: number }
}

export type ProgressFn = (stage: string, pct: number) => void
