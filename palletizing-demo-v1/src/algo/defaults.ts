import type { Constraints, PalletSpec, SequenceParams } from './types'

/** 技术要求第 3 章：货盘 1219×1219×75 */
export const DEFAULT_PALLET: PalletSpec = {
  length: 1219,
  width: 1219,
  height: 75,
  tareWeight: 20,
}

/** 技术要求表 2-2；标注"研发假设"的参数待甲方确认 */
export const DEFAULT_CONSTRAINTS: Constraints = {
  footprintX: 1000,
  footprintY: 1000,
  maxStackHeight: 1200,
  minStackHeight: 1000,
  cogHeightRatioMax: 0.6,
  cogOffsetRatioMax: 0.1,
  cogOffsetBase: 'pallet',
  utilizationMin: 0.8,
  overhangRatioMax: 0.05,
  supportRatioMin: 0.8,
  heightTolerance: 5,
  allowTipping: false,
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
