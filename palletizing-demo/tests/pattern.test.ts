import { describe, expect, it } from 'vitest'
import { bestPattern } from '../src/algo/pattern'
import { FIG21_PATTERNS } from '../src/algo/generator'
import { rectsOverlap } from '../src/algo/geometry'

describe('同规格单层排布 vs 技术要求图 2-1', () => {
  for (const { l, w, n } of FIG21_PATTERNS) {
    it(`${l}×${w} 在 1000×1000 内应至少放 ${n} 件`, () => {
      const t0 = performance.now()
      const res = bestPattern(l, w, 1000, 1000)
      const ms = performance.now() - t0
      expect(res.count).toBeGreaterThanOrEqual(n)
      expect(ms).toBeLessThan(1500)
      // 不重叠、不越界、尺寸正确
      for (const r of res.rects) {
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w).toBeLessThanOrEqual(1000)
        expect(r.y + r.h).toBeLessThanOrEqual(1000)
        expect([r.w, r.h].sort((p, q) => p - q)).toEqual([w, l].sort((p, q) => p - q))
      }
      for (let i = 0; i < res.rects.length; i++)
        for (let j = i + 1; j < res.rects.length; j++) expect(rectsOverlap(res.rects[i], res.rects[j])).toBe(false)
    })
  }
})
