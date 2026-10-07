import * as THREE from 'three'

/** 纸箱纹理：瓦楞纸底色（白底，由材质颜色着色）+ 纤维噪点 + 中间一道封箱胶带 */
export function cartonTexture(): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = '#f2f2f2'
  g.fillRect(0, 0, S, S)
  // 纤维与噪点（固定种子，保证每次一致）
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 2200; i++) {
    const v = 215 + Math.floor(rnd() * 40)
    g.fillStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.35})`
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1)
  }
  for (let y = 0; y < S; y += 3) {
    g.fillStyle = `rgba(0,0,0,${0.012 + (y % 6 ? 0 : 0.012)})`
    g.fillRect(0, y, S, 1)
  }
  // 胶带
  const tw = S * 0.16
  const grad = g.createLinearGradient(S / 2 - tw / 2, 0, S / 2 + tw / 2, 0)
  grad.addColorStop(0, 'rgba(255,255,255,0.10)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.28)')
  grad.addColorStop(1, 'rgba(255,255,255,0.10)')
  g.fillStyle = grad
  g.fillRect(S / 2 - tw / 2, 0, tw, S)
  g.fillStyle = 'rgba(0,0,0,0.10)'
  g.fillRect(S / 2 - tw / 2, 0, 1.5, S)
  g.fillRect(S / 2 + tw / 2 - 1.5, 0, 1.5, S)
  // 边缘压暗
  const vg = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.10)')
  g.fillStyle = vg
  g.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** 航空货盘上表面：铝板拉丝 + 滚道纹 */
export function palletTexture(): THREE.CanvasTexture {
  const S = 512
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = '#c9ced6'
  g.fillRect(0, 0, S, S)
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let y = 0; y < S; y++) {
    const v = 190 + Math.floor(rnd() * 30)
    g.fillStyle = `rgba(${v},${v + 3},${v + 8},0.35)`
    g.fillRect(0, y, S, 1)
  }
  g.strokeStyle = 'rgba(60,70,85,0.22)'
  g.lineWidth = 2
  for (let i = 1; i < 8; i++) {
    const p = (i / 8) * S
    g.beginPath()
    g.moveTo(p, 0)
    g.lineTo(p, S)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** 地面：径向渐隐的细网格 */
export function floorTexture(): THREE.CanvasTexture {
  const S = 1024
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.clearRect(0, 0, S, S)
  const cells = 32
  for (let i = 0; i <= cells; i++) {
    const p = (i / cells) * S
    const major = i % 4 === 0
    g.strokeStyle = major ? 'rgba(148,180,220,0.22)' : 'rgba(148,180,220,0.09)'
    g.lineWidth = major ? 2 : 1
    g.beginPath()
    g.moveTo(p, 0)
    g.lineTo(p, S)
    g.stroke()
    g.beginPath()
    g.moveTo(0, p)
    g.lineTo(S, p)
    g.stroke()
  }
  // 径向遮罩
  g.globalCompositeOperation = 'destination-in'
  const rg = g.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.5)
  rg.addColorStop(0, 'rgba(0,0,0,1)')
  rg.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = rg
  g.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** 圆形柔光贴图（重心光晕、地面光斑） */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  rg.addColorStop(0, inner)
  rg.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.35)'))
  rg.addColorStop(1, outer)
  g.fillStyle = rg
  g.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 顶面序号标签 */
export function numberTexture(n: number): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  // 白色货运标签
  const r = 16
  const x0 = 8,
    y0 = 20,
    w = S - 16,
    h = S - 40
  g.fillStyle = 'rgba(248,250,252,0.96)'
  g.beginPath()
  g.moveTo(x0 + r, y0)
  g.arcTo(x0 + w, y0, x0 + w, y0 + h, r)
  g.arcTo(x0 + w, y0 + h, x0, y0 + h, r)
  g.arcTo(x0, y0 + h, x0, y0, r)
  g.arcTo(x0, y0, x0 + w, y0, r)
  g.fill()
  g.fillStyle = '#0f172a'
  g.font = `700 ${n >= 100 ? 54 : 64}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(String(n), S / 2, S / 2 + 3)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
