/** 规格配色：低饱和、彼此可区分，在深色场景的灯光下仍有纸箱质感 */
export const SKU_COLORS = [
  '#d8b48a', // 牛皮纸
  '#8fb3d9', // 钢蓝
  '#b5cc8e', // 鼠尾草绿
  '#e09a7b', // 陶土
  '#b3a1dc', // 薰衣草
  '#e6cf7e', // 麦秆
  '#7fc4b8', // 青灰
  '#d59ab4', // 藕粉
  '#a7b3c4', // 石板
  '#9cc7e0', // 浅钢
  '#c8d69a', // 嫩芽
]

/** 木箱：木色系；军用特种箱：橄榄绿 / 军灰色系。纸箱沿用上面的多色标签，便于区分规格 */
export const WOOD_COLORS = ['#c08a55', '#a9743f', '#cf9f6d', '#b57e4b']
export const CASE_COLORS = ['#6f8256', '#586b4e', '#7d8a68', '#5c6b62', '#8a8f6a']
export const KIND_COLOR = { carton: '#d8b48a', wood: '#b9824d', case: '#6f8256' } as const

/** 规格 → 颜色。给出包装类型时，木箱与特种箱各用自己的色系 */
export function colorForSku(skus: string[], kinds?: (string | undefined)[]): Map<string, string> {
  const kindOf = new Map<string, string>()
  skus.forEach((s, i) => kindOf.has(s) || kindOf.set(s, kinds?.[i] ?? 'carton'))
  const uniq = [...kindOf.keys()].sort()
  const m = new Map<string, string>()
  const n = { carton: 0, wood: 0, case: 0 }
  for (const s of uniq) {
    const k = kindOf.get(s)
    if (k === 'wood') m.set(s, WOOD_COLORS[n.wood++ % WOOD_COLORS.length])
    else if (k === 'case') m.set(s, CASE_COLORS[n.case++ % CASE_COLORS.length])
    else m.set(s, SKU_COLORS[n.carton++ % SKU_COLORS.length])
  }
  return m
}

/** 承压比 → 颜色：绿（余量大）→ 黄 → 红（超限） */
export function heatColor(r: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [52, 211, 153]],
    [0.5, [163, 230, 53]],
    [0.8, [251, 191, 36]],
    [1, [249, 115, 22]],
    [1.0001, [239, 68, 68]],
  ]
  if (r > 1) return 'rgb(239,68,68)'
  for (let i = 1; i < stops.length; i++) {
    if (r <= stops[i][0]) {
      const [a, ca] = stops[i - 1]
      const [b, cb] = stops[i]
      const t = (r - a) / (b - a || 1)
      return `rgb(${ca.map((v, k) => Math.round(v + (cb[k] - v) * t)).join(',')})`
    }
  }
  return 'rgb(239,68,68)'
}

export const ACCENT = '#22d3ee'
export const BASELINE = '#fb7185'
export const COG = '#fbbf24'
export const OK = '#34d399'
export const BAD = '#f87171'
