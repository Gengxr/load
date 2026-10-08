import type { Constraints, PalletSpec, SequenceParams } from './types'

/** 技术要求第 3 章：货盘 1219×1219×75 */
export const DEFAULT_PALLET: PalletSpec = {
  length: 1219,
  width: 1219,
  height: 75,
  tareWeight: 20,
}

/** 货盘可用空间的两种口径 */
export const ENVELOPES = {
  /** 本项目：单码盘可用空间 1.2 m × 1.2 m × 1.5 m */
  project: { footprintX: 1200, footprintY: 1200, maxStackHeight: 1500, minStackHeight: 0 },
  /** 技术要求表 2-2 / 图 2-1：垛形 1000×1000×(1000–1200) */
  spec: { footprintX: 1000, footprintY: 1000, maxStackHeight: 1200, minStackHeight: 1000 },
} as const
export type EnvelopeKey = keyof typeof ENVELOPES

/** 技术要求表 2-2 的指标限值 + 本项目的货盘可用空间；标注"研发假设"的参数待甲方确认 */
export const DEFAULT_CONSTRAINTS: Constraints = {
  ...ENVELOPES.project,
  cogHeightRatioMax: 0.6,
  cogOffsetRatioMax: 0.1,
  cogOffsetBase: 'pallet',
  utilizationMin: 0.8,
  overhangRatioMax: 0.05,
  supportRatioMin: 0.8,
  heightTolerance: 5,
  allowTipping: false,
  heavyBottom: true,
  bigBottom: true,
  bearing: true,
}

export const DEFAULT_SEQUENCE: SequenceParams = {
  layerLead: 1,
  beamWidth: 96,
  wPeak: 1.0,
  wMean: 0.6,
  wHole: 0.04,
  wTravel: 0.01,
  wLayerJump: 0.003,
}
