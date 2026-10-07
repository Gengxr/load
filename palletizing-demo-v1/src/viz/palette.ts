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
  '#c9a882', // 驼色
  '#9cc7e0', // 浅钢
  '#c8d69a', // 嫩芽
]

export function colorForSku(skus: string[]): Map<string, string> {
  const uniq = [...new Set(skus)].sort()
  const m = new Map<string, string>()
  uniq.forEach((s, i) => m.set(s, SKU_COLORS[i % SKU_COLORS.length]))
  return m
}

export const ACCENT = '#22d3ee'
export const BASELINE = '#fb7185'
export const COG = '#fbbf24'
export const OK = '#34d399'
export const BAD = '#f87171'
