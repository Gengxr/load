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

/** 木箱纹理：横向木板 + 木纹 + 两道竖向加强条与钉子（白底，由材质颜色着色） */
export function woodTexture(): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = '#efefef'
  g.fillRect(0, 0, S, S)
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const planks = 5
  const ph = S / planks
  for (let k = 0; k < planks; k++) {
    const v = 222 + Math.floor(rnd() * 26)
    g.fillStyle = `rgb(${v},${v},${v})`
    g.fillRect(0, k * ph, S, ph)
    // 木纹
    for (let i = 0; i < 26; i++) {
      const y = k * ph + 3 + rnd() * (ph - 6)
      g.strokeStyle = `rgba(0,0,0,${0.03 + rnd() * 0.07})`
      g.lineWidth = 0.6 + rnd() * 0.9
      g.beginPath()
      g.moveTo(0, y)
      g.bezierCurveTo(S * 0.3, y + (rnd() - 0.5) * 5, S * 0.7, y + (rnd() - 0.5) * 5, S, y + (rnd() - 0.5) * 3)
      g.stroke()
    }
    // 板缝
    g.fillStyle = 'rgba(0,0,0,0.30)'
    g.fillRect(0, k * ph, S, 2)
    g.fillStyle = 'rgba(255,255,255,0.18)'
    g.fillRect(0, k * ph + 2, S, 1)
  }
  // 竖向加强条
  for (const x of [S * 0.1, S * 0.9]) {
    const w = S * 0.11
    g.fillStyle = 'rgba(0,0,0,0.14)'
    g.fillRect(x - w / 2, 0, w, S)
    g.fillStyle = 'rgba(0,0,0,0.22)'
    g.fillRect(x - w / 2, 0, 1.5, S)
    g.fillRect(x + w / 2 - 1.5, 0, 1.5, S)
    for (let k = 0; k < planks; k++) {
      g.fillStyle = 'rgba(0,0,0,0.45)'
      g.beginPath()
      g.arc(x, k * ph + ph / 2, 2.2, 0, Math.PI * 2)
      g.fill()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** 军用特种箱纹理：滚塑箱体的加强筋、包角、搭扣与一道标识带（白底，由材质颜色着色） */
export function caseTexture(): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = '#e9e9e9'
  g.fillRect(0, 0, S, S)
  let seed = 23
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.05})`
    g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5)
  }
  // 横向加强筋
  for (const y of [S * 0.2, S * 0.36, S * 0.64, S * 0.8]) {
    const grad = g.createLinearGradient(0, y - 7, 0, y + 7)
    grad.addColorStop(0, 'rgba(255,255,255,0.20)')
    grad.addColorStop(0.5, 'rgba(0,0,0,0.02)')
    grad.addColorStop(1, 'rgba(0,0,0,0.26)')
    g.fillStyle = grad
    g.fillRect(S * 0.06, y - 7, S * 0.88, 14)
  }
  // 合盖线
  g.fillStyle = 'rgba(0,0,0,0.42)'
  g.fillRect(0, S * 0.5 - 1.5, S, 3)
  g.fillStyle = 'rgba(255,255,255,0.18)'
  g.fillRect(0, S * 0.5 + 1.5, S, 1)
  // 搭扣
  for (const x of [S * 0.27, S * 0.73]) {
    g.fillStyle = 'rgba(20,24,28,0.85)'
    g.fillRect(x - 11, S * 0.5 - 15, 22, 30)
    g.fillStyle = 'rgba(235,238,242,0.9)'
    g.fillRect(x - 7, S * 0.5 - 10, 14, 9)
  }
  // 包角
  const k = S * 0.13
  g.fillStyle = 'rgba(0,0,0,0.30)'
  for (const [x, y] of [[0, 0], [S - k, 0], [0, S - k], [S - k, S - k]]) g.fillRect(x, y, k, k)
  // 标识带
  g.fillStyle = 'rgba(255,255,255,0.55)'
  g.fillRect(S * 0.38, S * 0.085, S * 0.24, S * 0.05)
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
