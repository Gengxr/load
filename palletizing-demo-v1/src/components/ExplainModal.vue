<script setup lang="ts">
import { computed } from 'vue'
import { bestPattern } from '../algo/pattern'
import { maxRectsPack, type Heuristic, type PackItem } from '../algo/maxrects'
import { FIG21_PATTERNS } from '../algo/generator'
import { result, state } from '../store'
import { pct } from '../format'
import { SKU_COLORS } from '../viz/palette'
import DocShell from './DocShell.vue'
import FigBeam from './FigBeam.vue'
import BalanceChart from './BalanceChart.vue'
import Icon from './Icon.vue'

/** 算法原理：把"每件放在哪、先放哪件、指标怎么算"讲清楚（配图 + 说明 + 当前方案的实时数字） */
const chapters = [
  { id: 'overview', title: '问题与思路', sub: '要解决什么、为什么分两步' },
  { id: 'layout', title: '第一步 · 空间布局', sub: '每件货物放在哪' },
  { id: 'sequence', title: '第二步 · 码放顺序', sub: '先放哪件、后放哪件' },
  { id: 'metrics', title: '重心与指标', sub: '怎么算、怎么判定' },
  { id: 'io', title: '数据接口与口径', sub: '输入输出与待确认事项' },
]

// ── 图 2-1 的 14 种单规格排布（现场计算） ──
const gallery = computed(() =>
  FIG21_PATTERNS.map((f, i) => {
    const t0 = performance.now()
    const r = bestPattern(f.l, f.w, 1000, 1000)
    return { ...f, got: r.count, rects: r.rects, structure: r.structure, ms: performance.now() - t0, color: SKU_COLORS[i % SKU_COLORS.length] }
  }),
)
const matched = computed(() => gallery.value.filter((g) => g.got >= g.n).length)
const demoA = computed(() => gallery.value.find((g) => g.l === 250 && g.w === 200)!)
const demoB = computed(() => gallery.value.find((g) => g.l === 400 && g.w === 300)!)

// ── 混合规格的一层（现场用 MaxRects 计算） ──
const mixed = computed(() => {
  const defs: [number, number, number, string][] = [
    [600, 400, 1, SKU_COLORS[2]],
    [400, 300, 3, SKU_COLORS[1]],
    [300, 200, 4, SKU_COLORS[0]],
    [250, 200, 3, SKU_COLORS[4]],
    [200, 200, 4, SKU_COLORS[5]],
  ]
  const items: PackItem[] = []
  const color: string[] = []
  for (const [w, h, n, c] of defs)
    for (let i = 0; i < n; i++) {
      items.push({ id: items.length, w, h, canRotate: true, prio: 0 })
      color.push(c)
    }
  let best: { x: number; y: number; w: number; h: number; id: number }[] = []
  let area = 0
  for (const heu of ['cp', 'bssf', 'bl'] as Heuristic[]) {
    const packed = maxRectsPack(items, 1000, 1000, heu)
    const a = packed.reduce((s, p) => s + p.w * p.h, 0)
    if (a > area) {
      area = a
      best = packed
    }
  }
  return { rects: best.map((p) => ({ ...p, color: color[p.id] })), util: area / 1e6, n: best.length, kinds: defs.length }
})

// ── 当前方案的实时数字 ──
const r = computed(() => result.value)
const sum = computed(() => {
  const res = r.value
  if (!res) return null
  const a = res.sequences.balance.summary
  const b = res.sequences.baseline.summary
  const m = res.metrics
  return {
    n: res.layout.placements.length,
    layers: res.layout.layers.length,
    strategy: res.layout.strategy === 'layered' ? '分层码放' : '自由码放',
    peakA: a.peakRatio,
    peakB: b.peakRatio,
    meanA: a.meanRatio,
    meanB: b.meanRatio,
    exceedA: a.exceedSteps,
    exceedB: b.exceedSteps,
    reduce: b.peakRatio > 0 ? 1 - a.peakRatio / b.peakRatio : 0,
    hr: m.cogHeightRatio,
    off: Math.max(Math.abs(m.cogOffsetRatio[0]), Math.abs(m.cogOffsetRatio[1])),
    util: m.minLayerUtilization,
    layoutMs: res.timings.layoutMs,
    seqMs: res.timings.sequenceMs,
    totalMs: res.timings.totalMs,
    pass: m.items.filter((x) => x.source.startsWith('表') && x.pass).length,
    all: m.items.filter((x) => x.source.startsWith('表')).length,
  }
})
/** 三种做法在当前这批货物上的结果：本方案 / 逐层行扫描（同一垛形） / DBLF（自己的垛形） */
const cmp = computed(() => {
  const res = r.value
  if (!res) return null
  type M = typeof res.metrics
  const off = (m: M) => Math.max(Math.abs(m.cogOffsetRatio[0]), Math.abs(m.cogOffsetRatio[1]))
  const judged = (m: M) => m.items.filter((x) => x.source.startsWith('表'))
  const col = (name: string, rem: number, m: M, sq: typeof res.sequences.balance) => ({
    name,
    peak: sq.summary.peakRatio,
    mean: sq.summary.meanRatio,
    exceed: sq.summary.exceedSteps,
    off: off(m),
    hr: m.cogHeightRatio,
    util: m.minLayerUtilization,
    pass: `${judged(m).filter((x) => x.pass).length} / ${judged(m).length}`,
    rem,
  })
  return [
    col('ours', res.layout.remaining.length, res.metrics, res.sequences.balance),
    col('row', res.layout.remaining.length, res.metrics, res.sequences.baseline),
    col('dblf', res.dblf.layout.remaining.length, res.dblf.metrics, res.dblf.sequence),
  ]
})

/** n 件货物的排列数 n! 的数量级 */
const perms = computed(() => {
  const n = sum.value?.n ?? 100
  let lg = 0
  for (let i = 2; i <= n; i++) lg += Math.log10(i)
  return Math.floor(lg)
})

const how: Record<string, string> = {
  cogHeight: '把每件货物的"重量 × 中心高度"加起来，连同货盘自重一起除以总重，得到重心离货盘底面的高度；再除以"货物 + 货盘"的总高。越低越稳。',
  cogOffset: '水平方向同理：每件货物的"重量 × 位置"求和后除以总重，得到重心在长、宽方向偏离货盘几何中心多少毫米，再除以货盘边长。两个方向分别判定。',
  utilization: '每一层货物的底面积之和 ÷ 垛形承载面 1000×1000（与技术要求图 2-1 的算法一致）。逐层计算；最顶上一层往往是零头，不考核。',
  envelope: '整垛的外包络尺寸：长、宽取所有货物的最外边界，高取最高货物的顶面（不含货盘）。',
  overhang: '相邻两层比较外轮廓：上层任意一侧伸出下层的距离 ÷ 下层在该方向的长度。保证垛形是规整的立方体。',
  time: '从拿到货物清单到给出每件位置和码放顺序的计算时间。',
  support: '每件货物的底面有多大比例被下方货物托住，并且它的重心投影必须落在支撑面以内。下限 80% 是研发设定，可调。',
  collision: '任意两件货物不得在空间上重叠；任何货物不得超出垛形边界。这是硬约束，必须为 0。',
  interlock: '下层内部的接缝，有多大比例的长度被上层货物跨住（像砌砖一样错缝）。越高越不易散垛，作为参考。',
}

const sampleIn = `{
  "schemaVersion": "0.1",
  "pallets": [
    { "palletNo": 1,
      "cargos": [
        { "id": "C0001", "rfid": "E2000017221101441890",
          "sku": "S01", "length": 400, "width": 300,
          "height": 200, "weight": 8.5 }
      ] }
  ]
}`
const sampleOut = `{
  "planType": "palletizing",
  "solveStatus": "COMPLETE",
  "placements": [
    { "seq": 1, "rfid": "E2000017221101441890",
      "layer": 1, "x": 0, "y": 0, "z": 0,
      "size": [400, 300, 200], "rotated": false,
      "supporters": [] }
  ],
  "pickSequence": ["E2000017221101441890", "…"],
  "remainingCargo": [],
  "metrics": { "cogOffset": { "display": "X +0.7% · Y +0.9%", "pass": true } },
  "process": { "balance": { "peakRatio": 0.009 } }
}`
</script>

<template>
  <DocShell title="算法原理" sub="单盘动态码放规划 · 每一步在做什么、为什么这样做" icon="book" :chapters="chapters" @close="state.explainOpen = false">
    <template #actions>
      <button class="btn" @click="((state.explainOpen = false), (state.guideOpen = true))"><Icon name="help" :size="15" />使用手册</button>
    </template>

    <!-- ═══════════ 1 问题与思路 ═══════════ -->
    <section data-ch="overview">
      <h2><span class="no">1</span>问题与思路</h2>
      <p class="lead">
        给定<b>一个货盘</b>和<b>分到这个货盘上的一批货物</b>（长方体，尺寸、重量各不相同），算法要回答两个问题：
        <b class="c">每一件放在哪里</b>，以及<b class="c">按什么顺序一件一件放上去</b>。不仅码完之后要稳，<b>每放一件之后的中间状态</b>也要平衡、稳定。
      </p>

      <div class="cards">
        <div class="card">
          <h4>输入</h4>
          <p>货物清单：每件的 RFID、长宽高（120×100×100 ~ 600×400×300 mm）、重量。<br />货盘：1219×1219×75 mm，自重 {{ state.pallet.tareWeight }} kg。</p>
        </div>
        <div class="card">
          <h4>输出</h4>
          <p>每件货物的位置、朝向、所在层；逐件码放顺序（也就是仓储系统的出库顺序）；六项技术指标的自动核算结果。</p>
        </div>
        <div class="card">
          <h4>必须满足的约束</h4>
          <p>垛形不超过 1000×1000×1200；每层利用率 ≥ 80%；重心偏离中心 ≤ ±10%；重心高度 ≤ 总高的 60%；上层不超出下层 5%；每件都被托住。</p>
        </div>
      </div>

      <h3>为什么分成两步</h3>
      <div class="flow">
        <div class="node in"><em>输入</em>货物集合<small>出库清单</small></div>
        <div class="arr" />
        <div class="group">
          <div class="gt">第一步 · 空间布局：每件放哪</div>
          <div class="node">凑成平整的层<small>同规格最优图案 / 混合装填</small></div>
          <div class="node">选层、排上下<small>束搜索，重的在下</small></div>
          <div class="node">收顶与精修<small>零头收尾、重心拉回中心</small></div>
        </div>
        <div class="arr" />
        <div class="group">
          <div class="gt">第二步 · 码放顺序：先放哪件</div>
          <div class="node">先后约束图<small>下面的必须先放</small></div>
          <div class="node">平衡优先搜索<small>全过程偏心最小</small></div>
        </div>
        <div class="arr" />
        <div class="node out"><em>输出</em>码盘方案<small>位置 · 顺序 · 指标</small></div>
      </div>
      <div class="note">
        <span class="tag">通俗地说</span>
        <div>
          <p>第一步相当于画好"图纸"——码完之后每件货在什么位置；第二步相当于排"施工顺序"——照着图纸，先放哪件、后放哪件。</p>
          <p>
            两步的目标不同：<b>放在哪</b>决定最终垛形的利用率、重心和稳定性；<b>先放哪件</b>决定码放途中会不会偏载。分开求解，每一步都更快，也更容易说清"为什么这样放"。
          </p>
        </div>
      </div>
      <div class="note ok">
        <span class="tag">算法选型</span>
        <div>
          这是带约束的组合优化问题（三维装箱的一种）。我们用的都是经典、可解释、耗时可控的方法：动态规划、矩形装填、束搜索、局部搜索，没有使用黑箱模型。
          <template v-if="sum">当前这批 {{ sum.n }} 件货物，布局用时 <b class="c">{{ sum.layoutMs.toFixed(0) }} ms</b>，顺序用时 <b class="c">{{ sum.seqMs.toFixed(0) }} ms</b>（技术要求：每垛不超过 2 分钟）。</template>
        </div>
      </div>
    </section>

    <!-- ═══════════ 2 空间布局 ═══════════ -->
    <section data-ch="layout">
      <h2><span class="no">2</span>第一步 · 空间布局：每件货物放在哪</h2>
      <p class="lead">
        基本思路是<b class="c">一层一层地搭</b>：先把货物凑成一个个顶面平整的"层"，再决定用哪些层、谁在下谁在上，最后处理凑不成层的零头，并把重心拉回中心。下面按顺序讲 7 个环节。
      </p>

      <div class="step">
        <div class="tx">
          <h3><span class="sn">2.1</span>按高度分组，凑成顶面平整的层</h3>
          <p>同一层里的货物<b>高度相同</b>（允许 {{ state.cons.heightTolerance }} mm 以内的误差），这样这一层的顶面是平的，上面一层才放得稳。</p>
          <p>如果某种货物的高度正好是这一层的一半或三分之一，就把两三件<b>叠成一"列"</b>补齐高度，和其他货物一起组成一层。</p>
          <div class="note">
            <span class="tag">为什么</span>
            <div>平整的层能保证上层货物底面被充分托住，垛形规整（技术要求：上层不超出下层 5%），也方便工人一层层操作。</div>
          </div>
        </div>
        <figure class="fig">
          <svg viewBox="0 0 360 170">
            <rect x="14" y="134" width="332" height="12" rx="3" fill="#64748b" />
            <text x="180" y="164" text-anchor="middle" font-size="11" fill="#74829a">货盘（侧视）</text>
            <g stroke="#0b1220" stroke-width="1.5">
              <rect x="20" y="70" width="78" height="64" rx="4" fill="#d8b48a" />
              <rect x="100" y="70" width="78" height="64" rx="4" fill="#d8b48a" />
              <rect x="180" y="103" width="78" height="31" rx="4" fill="#8fb3d9" />
              <rect x="180" y="70" width="78" height="31" rx="4" fill="#8fb3d9" />
              <rect x="260" y="70" width="80" height="64" rx="4" fill="#b5cc8e" />
            </g>
            <g font-size="11.5" font-weight="700" fill="#0f172a" text-anchor="middle">
              <text x="59" y="106">高 200</text><text x="139" y="106">高 200</text>
              <text x="219" y="123">高 100</text><text x="219" y="90">高 100</text>
              <text x="300" y="106">高 200</text>
            </g>
            <line x1="14" y1="70" x2="346" y2="70" stroke="#2ee0f0" stroke-width="1.5" stroke-dasharray="6 5" />
            <text x="346" y="62" text-anchor="end" font-size="11.5" fill="#2ee0f0">顶面齐平</text>
            <path d="M219 52v10m-4 -4l4 4l4 -4" stroke="#aab6c8" stroke-width="1.4" fill="none" />
            <text x="219" y="46" text-anchor="middle" font-size="11" fill="#aab6c8">两件叠成一列</text>
          </svg>
          <figcaption>同一层的货物高度一致；矮件叠成列补齐</figcaption>
        </figure>
      </div>

      <div class="step">
        <div class="tx">
          <h3><span class="sn">2.2</span>同一种规格的层：一层最多放几件</h3>
          <p>一层只放一种规格时，问题变成：<b>在 1000×1000 的正方形里，最多能摆几个 a×b 的矩形？</b>我们用两种方法各算一遍，取件数多的：</p>
          <ul>
            <li>
              <b>分块式（断头台切割 + 动态规划）</b>：一块区域要么整排同向摆满，要么一刀切成左右两块、或上下两块，每块再各自求最优。把所有可能的下刀位置都试一遍，用动态规划记住每块的最优结果，避免重复计算。
            </li>
            <li>
              <b>风车式（五块结构）</b>：四个角各放一块、中间留一块，四块像风车叶片一样首尾相接。这种排法一刀切不出来，但常常能多放几件。
            </li>
          </ul>
          <div class="note eg">
            <span class="tag">举例</span>
            <div>400×300 的箱子：整排摆最多 2×3 = 6 件（利用率 72%，不达标）；风车式能放 <b>8 件</b>（96%），中间正好留出 200×200 的空——这正是技术要求图 2-1 里的那种排法。</div>
          </div>
        </div>
        <div class="figs">
          <figure v-for="d in [demoA, demoB]" :key="d.l" class="fig">
            <svg viewBox="-12 -12 1024 1024">
              <rect x="0" y="0" width="1000" height="1000" fill="none" stroke="rgba(46,224,240,0.5)" stroke-width="5" stroke-dasharray="18 12" />
              <rect v-for="(q, k) in d.rects" :key="k" :x="q.x + 5" :y="1000 - q.y - q.h + 5" :width="q.w - 10" :height="q.h - 10" rx="10" :fill="q.w >= q.h ? '#8fb3d9' : '#d8b48a'" />
            </svg>
            <figcaption>
              {{ d.l }}×{{ d.w }}：{{ d.got }} 件 · {{ pct((d.got * d.l * d.w) / 1e6, 0) }}<br />{{ d.structure === 'pinwheel' ? '风车式' : '分块式' }}
            </figcaption>
          </figure>
        </div>
      </div>

      <div class="step wide">
        <div class="tx">
          <h4>对照技术要求图 2-1：14 种规格全部现场计算</h4>
          <p>
            下面每张图都是算法<b>此刻实时算出来的</b>，不是预先画好的。<b :class="matched === 14 ? 'g' : 'b'">{{ matched }} / 14 达到或超过图 2-1 中的件数。</b>
            蓝色、棕色表示箱子的两种朝向（横放 / 竖放）。
          </p>
          <div class="gal">
            <div v-for="g in gallery" :key="g.l + 'x' + g.w" class="gi">
              <svg viewBox="-12 -12 1024 1024">
                <rect x="-12" y="-12" width="1024" height="1024" rx="26" fill="rgba(148,163,184,0.06)" />
                <rect x="0" y="0" width="1000" height="1000" fill="none" stroke="rgba(46,224,240,0.45)" stroke-width="4" stroke-dasharray="16 10" />
                <rect v-for="(q, k) in g.rects" :key="k" :x="q.x + 4" :y="1000 - q.y - q.h + 4" :width="q.w - 8" :height="q.h - 8" rx="8" :fill="q.w >= q.h ? '#8fb3d9' : '#d8b48a'" fill-opacity="0.92" />
              </svg>
              <div class="gm">
                <b class="num">{{ g.l }}×{{ g.w }}</b>
                <span class="num">{{ g.got }} 件</span>
              </div>
              <div class="gs">
                <span class="pill" :class="g.got >= g.n ? 'ok' : 'bad'">图 2-1：{{ g.n }}</span>
                <em>{{ pct((g.got * g.l * g.w) / 1e6, 0) }}</em>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="step">
        <div class="tx">
          <h3><span class="sn">2.3</span>多种规格混在一层：矩形装填</h3>
          <p>高度相同、但长宽不同的货物要拼成一层时，用 <b>MaxRects（最大空闲矩形）</b>方法：</p>
          <ol>
            <li>记下"当前还空着的地方"——用若干个尽量大的矩形表示（它们可以互相重叠）。</li>
            <li>在"所有剩余规格 × 所有空闲矩形 × 横放竖放"里，挑评分最好的一个位置放下一件。</li>
            <li>被占掉的空闲矩形切成新的小矩形，回到第 2 步，直到放不下。</li>
          </ol>
          <p>评分规则有三种（贴边最多、短边最贴合、最靠左下），每种各跑一遍，取利用率最高的结果。拼好后整体平移到居中。</p>
          <div class="note">
            <span class="tag">说明</span>
            <div>"贴边最多"是指新放的箱子与已放箱子或边界接触的边越长越好——这样排得紧凑，不留细碎的缝，外轮廓也规整。</div>
          </div>
        </div>
        <div class="figs">
          <figure class="fig">
            <svg viewBox="-6 -6 312 312">
              <rect x="0" y="0" width="300" height="300" fill="none" stroke="rgba(46,224,240,0.5)" stroke-width="2" stroke-dasharray="7 5" />
              <g stroke="#0b1220" stroke-width="1.5">
                <rect x="0" y="210" width="120" height="90" rx="3" fill="#8fb3d9" />
                <rect x="120" y="210" width="120" height="90" rx="3" fill="#8fb3d9" />
                <rect x="0" y="150" width="90" height="60" rx="3" fill="#d8b48a" />
              </g>
              <rect x="92" y="2" width="206" height="206" fill="rgba(255,194,75,0.07)" stroke="#ffc24b" stroke-width="1.6" stroke-dasharray="6 4" />
              <rect x="2" y="2" width="296" height="146" fill="rgba(181,204,142,0.07)" stroke="#b5cc8e" stroke-width="1.6" stroke-dasharray="6 4" />
              <rect x="90" y="150" width="90" height="60" rx="3" fill="rgba(46,224,240,0.25)" stroke="#2ee0f0" stroke-width="2" />
              <path d="M90 150v60M90 210h90" stroke="#2ee0f0" stroke-width="5" stroke-linecap="round" />
              <text x="195" y="84" text-anchor="middle" font-size="12" fill="#ffc24b">空闲矩形 A</text>
              <text x="52" y="28" text-anchor="middle" font-size="12" fill="#b5cc8e">空闲矩形 B</text>
              <text x="135" y="184" text-anchor="middle" font-size="11" fill="#e6fbff">下一件</text>
            </svg>
            <figcaption>空闲矩形与"贴边"（粗线）</figcaption>
          </figure>
          <figure class="fig">
            <svg viewBox="-12 -12 1024 1024">
              <rect x="0" y="0" width="1000" height="1000" fill="none" stroke="rgba(46,224,240,0.5)" stroke-width="5" stroke-dasharray="18 12" />
              <rect v-for="(q, k) in mixed.rects" :key="k" :x="q.x + 5" :y="1000 - q.y - q.h + 5" :width="q.w - 10" :height="q.h - 10" rx="10" :fill="q.color" />
            </svg>
            <figcaption>现场计算：{{ mixed.kinds }} 种规格拼成一层<br />{{ mixed.n }} 件 · 利用率 {{ pct(mixed.util, 0) }}</figcaption>
          </figure>
        </div>
      </div>

      <div class="step">
        <div class="tx">
          <h3><span class="sn">2.4</span>层与层之间：托得住、压住缝</h3>
          <p>一个候选层放到当前垛顶之前，会试几种摆法：<b>左右镜像、前后镜像</b>，区域是正方形时还可以<b>转 90°</b>。从中选出：</p>
          <ul>
            <li>被完整托住的件数最多（每件底面至少 {{ pct(state.cons.supportRatioMin, 0) }} 落在下层货物上，且重心投影在支撑面内）；</li>
            <li>与下层的接缝错得最开（压缝）；</li>
            <li>让整垛重心更靠近中心。</li>
          </ul>
          <p>仍然托不住的件从这一层剔除，留给后面处理。上层的外轮廓不允许超出下层 {{ pct(state.cons.overhangRatioMax, 0) }}。</p>
          <div class="note">
            <span class="tag">通俗地说</span>
            <div>和砌砖一个道理：上一层的箱子要跨在下一层两个箱子的接缝上，垛才不容易从缝里散开。同一个图案转个方向再放，缝就错开了。</div>
          </div>
        </div>
        <figure class="fig">
          <svg viewBox="0 0 360 190">
            <g transform="translate(14 12)">
              <rect width="150" height="150" fill="rgba(148,163,184,0.08)" stroke="#4b586c" />
              <path d="M75 0v150M0 75h150" stroke="#ff7189" stroke-width="3" />
              <g fill="none" stroke="#aab6c8" stroke-width="1.6"><rect x="3" y="3" width="69" height="69" rx="3" /><rect x="78" y="3" width="69" height="69" rx="3" /><rect x="3" y="78" width="69" height="69" rx="3" /><rect x="78" y="78" width="69" height="69" rx="3" /></g>
              <text x="75" y="170" text-anchor="middle" font-size="12" fill="#ff7189">通缝：上下层接缝重合 ✗</text>
            </g>
            <g transform="translate(196 12)">
              <rect width="150" height="150" fill="rgba(148,163,184,0.08)" stroke="#4b586c" />
              <path d="M75 0v150M0 75h150" stroke="#64748b" stroke-width="2" stroke-dasharray="5 4" />
              <g fill="rgba(46,224,240,0.14)" stroke="#2ee0f0" stroke-width="1.6">
                <rect x="3" y="3" width="94" height="44" rx="3" /><rect x="103" y="3" width="44" height="94" rx="3" /><rect x="53" y="103" width="94" height="44" rx="3" /><rect x="3" y="53" width="44" height="94" rx="3" /><rect x="53" y="53" width="44" height="44" rx="3" />
              </g>
              <text x="75" y="170" text-anchor="middle" font-size="12" fill="#3ddc97">压缝：上层跨住下层的缝 ✓</text>
            </g>
          </svg>
          <figcaption>俯视：虚线 / 红线是下层的接缝，方框是上层货物</figcaption>
        </figure>
      </div>

      <div class="step">
        <div class="tx">
          <h3><span class="sn">2.5</span>用哪些层、谁在下面：束搜索</h3>
          <p>
            货物能凑出很多种"候选层"，怎么组合才最好？从空货盘开始，每一步为当前垛顶生成候选层，挑最好的 4 个分别往上加，得到一批"半成品垛"；
            然后只保留评分最高的 <b>6 个</b>继续往上搭，直到货物用完或到达垛高上限 {{ state.cons.maxStackHeight }} mm。
          </p>
          <p>半成品的评分看三点：<b>填得满</b>（已放体积 ÷ 已用空间）、<b>没有利用率不足 80% 的层</b>、<b>重的先放</b>（已放重量的占比高于已放体积的占比，说明密度大的货在下面）。</p>
          <div class="note">
            <span class="tag">为什么不"每步选最好的"</span>
            <div>只顾眼前（贪心）容易把好凑的货先用完，最后剩一堆凑不成层的零头。同时保留 6 个半成品，相当于留了后悔的余地——眼前稍差但后劲足的组合不会被过早丢掉。</div>
          </div>
        </div>
        <figure class="fig">
          <FigBeam :rows="['空货盘', '第 1 层', '第 2 层', '第 3 层']" keep="保留，继续往上搭" />
          <figcaption>每一步只留下最好的几个半成品（示意图中保留 2 个）</figcaption>
        </figure>
      </div>

      <div class="step">
        <div class="tx">
          <h3><span class="sn">2.6</span>凑不成层的零头：顶部自由码放</h3>
          <p>剩下的货物不够凑一层时，用<b>"高度图"</b>收顶：把垛顶按 10 mm 的小格子记下每一格现在有多高；每件零头把所有位置、两种朝向都试一遍，选出：</p>
          <ul>
            <li>落下后<b>位置最低</b>；</li>
            <li>底面支撑率 ≥ {{ pct(state.cons.supportRatioMin, 0) }}，重心投影落在支撑面内；</li>
            <li>下方空隙最小、和旁边货物贴得最紧、尽量靠近中心。</li>
          </ul>
          <p>最顶上这一层是零头，不考核利用率。</p>
          <div class="note">
            <span class="tag">兜底</span>
            <div>
              如果货物尺寸太杂，根本凑不出平整的层，算法会整垛都用这种方式码放（"自由码放"），并与分层的结果比较，取综合评分高的一个。
              <template v-if="sum">当前方案采用的是<b>{{ sum.strategy }}</b>，共 {{ sum.layers }} 层。</template>
              实在放不下的货物不会硬塞，列入"人工处理"清单。
            </div>
          </div>
        </div>
        <figure class="fig">
          <svg viewBox="0 0 360 180">
            <rect x="14" y="150" width="332" height="12" rx="3" fill="#64748b" />
            <g stroke="#0b1220" stroke-width="1.5">
              <rect x="20" y="70" width="90" height="80" rx="3" fill="#d8b48a" />
              <rect x="112" y="104" width="100" height="46" rx="3" fill="#b5cc8e" />
              <rect x="214" y="70" width="80" height="80" rx="3" fill="#d8b48a" />
              <rect x="296" y="88" width="46" height="62" rx="3" fill="#8fb3d9" />
            </g>
            <path d="M20 70h90v34h102v-34h82v18h48" fill="none" stroke="#2ee0f0" stroke-width="2" />
            <g stroke="rgba(46,224,240,0.35)" stroke-width="1"><path v-for="i in 32" :key="i" :d="`M${20 + i * 10} 150v6`" /></g>
            <rect x="116" y="18" width="92" height="34" rx="3" fill="rgba(255,194,75,0.25)" stroke="#ffc24b" stroke-width="1.8" />
            <path d="M162 56v38m-5 -6l5 6l5 -6" stroke="#ffc24b" stroke-width="1.8" fill="none" />
            <rect x="116" y="70" width="92" height="34" rx="3" fill="none" stroke="#ffc24b" stroke-width="1.6" stroke-dasharray="5 4" />
            <text x="162" y="40" text-anchor="middle" font-size="11.5" fill="#ffe2a8">零头</text>
            <text x="300" y="60" text-anchor="middle" font-size="11.5" fill="#2ee0f0">高度图</text>
            <text x="180" y="176" text-anchor="middle" font-size="11" fill="#74829a">落到最低、托得最稳的位置</text>
          </svg>
          <figcaption>侧视：蓝线是当前垛顶的高度轮廓</figcaption>
        </figure>
      </div>

      <div class="step wide">
        <div class="tx">
          <h3><span class="sn">2.7</span>精修：重的在下，重心拉回中心</h3>
          <p>到这里每件货都有位置了，再做三件事让方案更稳：</p>
          <div class="cards">
            <div class="card">
              <h4>① 重层下沉</h4>
              <p>相邻两层如果上面那层密度更大，就试着上下对调。对调后重新检查支撑、5% 外扩、是否干涉，全部通过才保留。重的在下，重心就低。</p>
            </div>
            <div class="card">
              <h4>② 逐层镜像、微移</h4>
              <p>从上到下逐层尝试镜像，或把整层平移几毫米到几十毫米，只要能让整垛的水平重心更靠近货盘中心、且仍然托得住，就采纳。</p>
            </div>
            <div class="card">
              <h4>③ 同规格货物互换</h4>
              <p>同一规格的货物重量并不完全相同：较重的指派到低处；同一层里两两互换位置，把剩余的一点偏心再配平。</p>
            </div>
          </div>
          <div v-if="sum" class="note ok">
            <span class="tag">当前方案</span>
            <div>
              重心高度为总高的 <b class="g">{{ pct(sum.hr) }}</b>（要求 ≤ {{ pct(state.cons.cogHeightRatioMax, 0) }}），水平偏离中心 <b class="g">{{ pct(sum.off) }}</b>（要求 ≤ ±{{ pct(state.cons.cogOffsetRatioMax, 0) }}），非顶层的最低利用率
              <b :class="sum.util >= state.cons.utilizationMin ? 'g' : 'b'">{{ pct(sum.util) }}</b>（要求 ≥ {{ pct(state.cons.utilizationMin, 0) }}）。
            </div>
          </div>
          <div class="note">
            <span class="tag">独立校验</span>
            <div>布局生成后，由一个与生成算法<b>不共用代码</b>的评估器重新检查：是否有重叠、越界，每件的支撑率，每层的利用率和外扩，以及重心——结果就是界面右上角的"技术指标自动报告"。</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════════ 3 码放顺序 ═══════════ -->
    <section data-ch="sequence">
      <h2><span class="no">3</span>第二步 · 码放顺序：先放哪件</h2>
      <p class="lead">
        位置定了以后，<b>先放哪件</b>同样重要。最常见的人工习惯是"一层码满再码下一层，从一个角扫到另一个角"（下文称<b>逐层行扫描</b>，本系统把它作为对照基线）——每层刚开始时货物都堆在一侧，重心会明显偏向那一边。
        我们的做法是：在所有<b>允许的</b>顺序里，找一个<b class="c">全过程重心最稳</b>的。
      </p>
      <div v-if="sum" class="note warn">
        <span class="tag">当前这批货</span>
        <div>
          按逐层行扫描的顺序码放，过程中重心最大偏到 <b class="b">{{ pct(sum.peakB) }}</b>，有 {{ sum.exceedB }} 步超出 ±10%；用本方案的顺序，最大只有 <b class="c">{{ pct(sum.peakA) }}</b>，超出 {{ sum.exceedA }} 步。
          最终垛形完全一样，差别只在顺序。
        </div>
      </div>

      <div class="step wide">
        <div class="tx">
          <h3><span class="sn">3.1</span>哪些顺序是允许的：先后约束图</h3>
          <p>
            无论人工还是机械手，货物都是<b>从上方竖直放下</b>的。所以放某一件时，它正下方、俯视投影有重叠的货物必须已经就位——这既保证"放得下去"，也保证<b>每个中间状态里每件货都被完整托住</b>。
          </p>
          <p>把"谁必须先于谁"画成箭头，就得到一张先后约束图。任何不违反箭头方向的顺序都是合法的。</p>
          <div class="note">
            <span class="tag">可以跨层</span>
            <div>
              合法顺序并不要求"一层码完再码下一层"。下层某个局部码好之后，就可以先在它上面放货，用来平衡另一侧。为了不让操作太跳跃，参数里可以限制最多超前几层（当前：<b>{{
                state.seq.layerLead === 0 ? '严格逐层' : `可超前 ${state.seq.layerLead} 层`
              }}</b>）。
            </div>
          </div>
        </div>
        <figure class="fig mid">
          <svg viewBox="0 0 560 206">
            <defs>
              <marker id="ah" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#2ee0f0" /></marker>
            </defs>
            <text x="160" y="18" text-anchor="middle" font-size="13" fill="#74829a">侧视</text>
            <rect x="10" y="150" width="300" height="12" rx="3" fill="#64748b" />
            <rect x="20" y="100" width="90" height="50" rx="5" fill="#d8b48a" /><rect x="115" y="100" width="90" height="50" rx="5" fill="#d8b48a" /><rect x="210" y="100" width="90" height="50" rx="5" fill="#d8b48a" />
            <rect x="62" y="45" width="100" height="55" rx="5" fill="#8fb3d9" /><rect x="167" y="45" width="100" height="55" rx="5" fill="#8fb3d9" />
            <g font-size="17" fill="#0f172a" font-weight="700" text-anchor="middle">
              <text x="65" y="131">A</text><text x="160" y="131">B</text><text x="255" y="131">C</text><text x="112" y="79">D</text><text x="217" y="79">E</text>
            </g>
            <text x="440" y="18" text-anchor="middle" font-size="13" fill="#74829a">先后约束图</text>
            <g stroke="#2ee0f0" stroke-width="2.2" fill="none" marker-end="url(#ah)">
              <path d="M372 150 L398 78" /><path d="M440 150 L412 78" /><path d="M448 150 L476 78" /><path d="M510 150 L488 78" />
            </g>
            <g font-size="15" font-weight="700" text-anchor="middle">
              <circle cx="368" cy="165" r="16" fill="#d8b48a" /><text x="368" y="170" fill="#0f172a">A</text>
              <circle cx="444" cy="165" r="16" fill="#d8b48a" /><text x="444" y="170" fill="#0f172a">B</text>
              <circle cx="514" cy="165" r="16" fill="#d8b48a" /><text x="514" y="170" fill="#0f172a">C</text>
              <circle cx="405" cy="62" r="16" fill="#8fb3d9" /><text x="405" y="67" fill="#0f172a">D</text>
              <circle cx="482" cy="62" r="16" fill="#8fb3d9" /><text x="482" y="67" fill="#0f172a">E</text>
            </g>
            <text x="160" y="192" text-anchor="middle" font-size="13" fill="#aab6c8">D 压在 A、B 上；E 压在 B、C 上</text>
            <text x="440" y="202" text-anchor="middle" font-size="13" fill="#aab6c8">合法顺序例：B → A → D → C → E</text>
          </svg>
          <figcaption>箭头表示"必须先放"：A、B 都放好之后才能放 D</figcaption>
        </figure>
      </div>

      <div class="step wide">
        <div class="tx">
          <h3><span class="sn">3.2</span>怎样评价一个顺序好不好：五项代价</h3>
          <p>给每个顺序打一个"代价"分，越低越好。代价是五项的加权和，权重体现了轻重缓急——<b>平衡是第一位的</b>，其余几项只在平衡差不多时起作用。</p>
          <div class="formula">
            代价 = {{ state.seq.wPeak }} × 峰值偏心 + {{ state.seq.wMean }} × 平均偏心 + {{ state.seq.wHole }} × 封闭孔位 + {{ state.seq.wTravel }} × 行走距离 + {{ state.seq.wLayerJump }} × 换层次数
            <small>偏心率 = 放完某一件后，"货物 + 货盘"的重心偏离货盘中心的距离 ÷ 货盘边长（长、宽两个方向取大的）</small>
          </div>
          <div class="cards">
            <div class="card"><span class="w">权重 {{ state.seq.wPeak }}</span><h4>峰值偏心</h4><p>整个码放过程中重心偏得最厉害的那一刻。它决定了会不会倾覆，所以权重最大。</p></div>
            <div class="card"><span class="w">权重 {{ state.seq.wMean }}</span><h4>平均偏心</h4><p>每一步偏心率的平均值。不只压住最坏的一刻，还要全程都靠近中心。</p></div>
            <div class="card"><span class="w">权重 {{ state.seq.wHole }}</span><h4>封闭孔位</h4><p>如果一个空位四面都先被围住，后面只能把箱子从上面硬"塞"进去，工人很难操作。出现一次罚一次。</p></div>
            <div class="card"><span class="w">权重 {{ state.seq.wTravel }}</span><h4>行走距离</h4><p>相邻两件落点之间的距离。别让工人左一件右一件来回跑得太远。</p></div>
            <div class="card"><span class="w">权重 {{ state.seq.wLayerJump }}</span><h4>换层次数</h4><p>上一件和这一件不在同一层就算换一次层。允许跨层，但不要无谓地上下折腾。</p></div>
          </div>
          <div class="figs two">
            <figure class="fig">
              <svg viewBox="0 0 240 200">
                <rect x="34" y="8" width="172" height="172" rx="6" fill="rgba(148,163,184,0.08)" stroke="#64748b" stroke-width="1.5" />
                <rect x="84" y="58" width="72" height="72" rx="4" fill="rgba(61,220,151,0.10)" stroke="#3ddc97" stroke-width="1.5" stroke-dasharray="5 4" />
                <path d="M120 58v72M84 94h72" stroke="rgba(255,255,255,0.22)" />
                <path d="M120 94h26" stroke="#2ee0f0" stroke-width="2" /><path d="M146 94v-20" stroke="#2ee0f0" stroke-width="2" />
                <circle cx="120" cy="94" r="2.5" fill="#fff" />
                <circle cx="146" cy="74" r="6" fill="#ffc24b" stroke="#0b1220" stroke-width="1.5" />
                <text x="133" y="108" text-anchor="middle" font-size="11" fill="#2ee0f0">Δx</text><text x="151" y="91" font-size="11" fill="#2ee0f0">Δy</text>
                <text x="120" y="50" text-anchor="middle" font-size="11" fill="#3ddc97">±10% 允许区</text>
                <text x="120" y="196" text-anchor="middle" font-size="11" fill="#74829a">货盘（俯视，示意）· 黄点为当前重心</text>
              </svg>
              <figcaption>偏心率：重心离货盘中心有多远</figcaption>
            </figure>
            <figure class="fig">
              <svg viewBox="0 0 240 200">
                <g stroke="#0b1220" stroke-width="1.5" fill="#d8b48a">
                  <rect x="42" y="22" width="50" height="50" rx="3" /><rect x="95" y="22" width="50" height="50" rx="3" /><rect x="148" y="22" width="50" height="50" rx="3" />
                  <rect x="42" y="75" width="50" height="50" rx="3" /><rect x="148" y="75" width="50" height="50" rx="3" />
                  <rect x="42" y="128" width="50" height="50" rx="3" /><rect x="95" y="128" width="50" height="50" rx="3" /><rect x="148" y="128" width="50" height="50" rx="3" />
                </g>
                <rect x="96" y="76" width="48" height="48" rx="3" fill="rgba(255,113,137,0.12)" stroke="#ff7189" stroke-width="1.8" stroke-dasharray="5 4" />
                <text x="120" y="104" text-anchor="middle" font-size="11" fill="#ff7189">空位</text>
                <text x="120" y="196" text-anchor="middle" font-size="11" fill="#74829a">四面被围，只能从上方塞入</text>
              </svg>
              <figcaption>封闭孔位：应当避免的情况</figcaption>
            </figure>
          </div>
        </div>
      </div>

      <div class="step">
        <div class="tx">
          <h3><span class="sn">3.3</span>怎样找到好顺序：束搜索</h3>
          <p>
            合法的顺序多得数不过来<template v-if="sum">——{{ sum.n }} 件货物的排列数量级约为 10<sup>{{ perms }}</sup></template>，不可能逐个比较。束搜索的做法是"一件一件往下排，边排边淘汰"：
          </p>
          <ol>
            <li>手上有若干条"排到一半的顺序"（一开始只有一条：还没放任何货）。</li>
            <li>每一条都往下延长一件——只能选<b>此刻允许放</b>的货（下面的都已放好），算出延长后的代价。</li>
            <li>"已经放了哪些货"相同的只留代价最低的一条；再从全部结果里留下最好的 <b>{{ state.seq.beamWidth }}</b> 条。</li>
            <li>重复 2、3，直到所有货都排完，取代价最低的一条。</li>
          </ol>
          <div class="note">
            <span class="tag">"束搜索宽度"是什么</span>
            <div>
              就是第 3 步里保留的条数（当前 {{ state.seq.beamWidth }}）。宽度为 1 等于每步只看眼前；宽度越大，越不容易错过"眼前稍差、整体更好"的顺序，但计算时间也相应增加。{{
                state.seq.beamWidth
              }} 以上通常改善很小。
            </div>
          </div>
          <div class="note eg">
            <span class="tag">为什么算得快</span>
            <div>每延长一件，重心不用重新从头算：新的"重量 × 位置"之和 = 旧的 + 这一件的。一次加法就够了，所以几百件货物也只要几十到几百毫秒。</div>
          </div>
        </div>
        <figure class="fig">
          <FigBeam :rows="['开始', '第 1 件', '第 2 件', '第 3 件']" keep="保留，继续往下排" />
          <figcaption>每放一件淘汰一批，只沿着最有希望的几条往下走（示意）</figcaption>
        </figure>
      </div>

      <div class="step wide">
        <div class="tx">
          <h3><span class="sn">3.4</span>结果长什么样</h3>
          <p>
            优化出来的顺序自然呈现出<b>"先中间、后四周，左右交替"</b>的规律：一侧放了重货，很快就会在对侧补一件把重心拉回来；下层局部完成后，会提前在上面放货来配平。这和有经验的码垛工人的做法是一致的。
          </p>
          <div v-if="r && sum" class="live">
            <div class="live-h">
              每放一件后的重心偏心率 ·
              <span class="o">本方案</span> 峰值 {{ pct(sum.peakA) }}、平均 {{ pct(sum.meanA) }} · <span class="bb">逐层行扫描（对照）</span> 峰值 {{ pct(sum.peakB) }}、平均 {{ pct(sum.meanB) }} · 峰值降低
              <b class="g">{{ (sum.reduce * 100).toFixed(0) }}%</b>
            </div>
            <BalanceChart :ours="r.sequences.balance.steps.ratio" :base="r.sequences.baseline.steps.ratio" :k="r.sequences.balance.steps.ratio.length - 1" :tol="state.cons.cogOffsetRatioMax" :height="170" />
          </div>
          <div class="note">
            <span class="tag">想亲眼看到</span>
            <div>关闭本页，点顶部的"方案对比"：左右两个工位码放同一批货，重心轨迹的差别一目了然。左上角可以切换对照对象（见下一节）。</div>
          </div>
        </div>
      </div>
      <div class="step wide">
        <div class="tx">
          <h3><span class="sn">3.5</span>和谁比：对照基线与对照算法</h3>
          <p>
            "码放顺序"和"过程重心"目前没有查到公认的行业标准或公开基准。因此"方案对比"页提供两个对照对象，各回答一个问题：
          </p>
          <div class="cards two">
            <div class="card">
              <h4>对照基线 · 逐层行扫描<span class="w">只比顺序</span></h4>
              <p>
                一层码满再码下一层，每层由远到近、从左到右。它反映常见的人工习惯，是本系统<b>自定义的基线，不是某项标准</b>。
                它和本方案用<b>同一个垛形</b>，只有先后不同，所以两者的差别完全来自"顺序"。
              </p>
            </div>
            <div class="card">
              <h4>对照算法 · DBLF<span class="w">整体对比</span></h4>
              <p>
                Deepest-Bottom-Left with Fill（最深-最低-最左填充），是三维装箱文献中最常用的对照算法之一。规则只有一句：每件货物放到<b>最靠里</b>的可行位置；一样靠里取<b>最低</b>；再一样取<b>最左</b>；每次都重新考察所有空位。
                它<b>同时决定位置和顺序</b>，所以是和本方案的整体对比。
              </p>
            </div>
          </div>
          <div class="note">
            <span class="tag">DBLF 用在货盘上的约定</span>
            <div>
              "里"取远离操作者的一侧（与集装箱"从里向外装"一致）；货物按体积从大到小依次放置（原文用遗传算法搜索放置次序，这里取文献中常用的静态排序）；不允许侧放；
              与本方案受<b>同样的硬约束</b>（垛形边界、底面支撑率），并用<b>同一个评估器</b>核算指标。
            </div>
          </div>
          <table v-if="cmp" class="tb cmpt">
            <thead>
              <tr><th>当前这批货物</th><th>本方案</th><th>逐层行扫描<em>同一垛形，只换顺序</em></th><th>DBLF<em>位置和顺序都由它生成</em></th></tr>
            </thead>
            <tbody>
              <tr><td>过程峰值偏心</td><td v-for="c in cmp" :key="c.name" class="num" :class="{ bad: c.peak > state.cons.cogOffsetRatioMax }">{{ pct(c.peak) }}</td></tr>
              <tr><td>过程平均偏心</td><td v-for="c in cmp" :key="c.name" class="num">{{ pct(c.mean) }}</td></tr>
              <tr><td>超出 ±10% 的步数</td><td v-for="c in cmp" :key="c.name" class="num" :class="{ bad: c.exceed > 0 }">{{ c.exceed }}</td></tr>
              <tr><td>码完后重心偏离</td><td v-for="c in cmp" :key="c.name" class="num" :class="{ bad: c.off > state.cons.cogOffsetRatioMax }">{{ pct(c.off) }}</td></tr>
              <tr><td>重心高度（占总高）</td><td v-for="c in cmp" :key="c.name" class="num" :class="{ bad: c.hr > state.cons.cogHeightRatioMax }">{{ pct(c.hr) }}</td></tr>
              <tr><td>最低层利用率</td><td v-for="c in cmp" :key="c.name" class="num" :class="{ bad: c.util < state.cons.utilizationMin }">{{ pct(c.util, 0) }}</td></tr>
              <tr><td>表 2-2 指标达标</td><td v-for="c in cmp" :key="c.name" class="num">{{ c.pass }}</td></tr>
              <tr><td>未放入件数</td><td v-for="c in cmp" :key="c.name" class="num" :class="{ bad: c.rem > 0 }">{{ c.rem }}</td></tr>
            </tbody>
          </table>
          <div class="note eg">
            <span class="tag">怎么读这张表</span>
            <div>
              DBLF 是为集装箱装载设计的，目标是把空间装满：它从最里面开始，一面一面地往外码，不考虑重心，也不分层。所以用在货盘上，码放过程中重心会明显偏向里侧，层利用率也难达标。
              这说明<b>直接套用经典装箱算法满足不了码盘的要求</b>，而不是说 DBLF 本身不好。
            </div>
          </div>
          <p class="cite">文献：Karabulut K., İnceoğlu M. M. A Hybrid Genetic Algorithm for Packing in 3D with Deepest Bottom Left with Fill Method. ADVIS 2004, LNCS 3261: 441–450.</p>
        </div>
      </div>
    </section>

    <!-- ═══════════ 4 重心与指标 ═══════════ -->
    <section data-ch="metrics">
      <h2><span class="no">4</span>重心与指标：怎么算、怎么判定</h2>
      <p class="lead">界面上所有的重心读数和"达标 / 未达标"都来自同一套公式。重心的计算原理就是<b class="c">杠杆平衡</b>。</p>

      <div class="step">
        <div class="tx">
          <h3><span class="sn">4.1</span>重心怎么算</h3>
          <div class="formula">
            重心位置 = ( 货物₁重量 × 位置₁ + 货物₂重量 × 位置₂ + … + 货盘自重 × 货盘中心 ) ÷ 总重量
            <small>长、宽、高三个方向各算一次；每件货物的重心取它的几何中心</small>
          </div>
          <p>每放上一件货，就在分子上加一项、分母上加上它的重量，重心随之移动。货物越重、离中心越远，把重心"拉"得越多。</p>
          <div class="note eg">
            <span class="tag">举例</span>
            <div>空货盘重 20 kg，重心在正中。在离中心 400 mm 的地方放一件 10 kg 的货：重心偏移 = 10 × 400 ÷ (20 + 10) ≈ 133 mm，相当于货盘边长 1219 mm 的 10.9%——已经超出 ±10%。所以头几件货放在哪里特别关键。</div>
          </div>
          <div class="note">
            <span class="tag">说明</span>
            <div>技术要求规定每件货物自身的重心偏离其中心不超过长宽的 ±2%，因此按几何中心计算是合理的简化；验收时用货盘下方的三点称重装置实测核验。</div>
          </div>
        </div>
        <figure class="fig">
          <svg viewBox="0 0 360 190">
            <path d="M40 120h280" stroke="#aab6c8" stroke-width="4" stroke-linecap="round" />
            <path d="M180 124l-16 30h32z" fill="#64748b" />
            <rect x="70" y="72" width="56" height="46" rx="4" fill="#d8b48a" stroke="#0b1220" stroke-width="1.5" /><text x="98" y="100" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">重</text>
            <rect x="252" y="92" width="40" height="26" rx="4" fill="#8fb3d9" stroke="#0b1220" stroke-width="1.5" /><text x="272" y="110" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">轻</text>
            <path d="M98 132v18M272 132v18M98 150h82M272 150h-92" stroke="#2ee0f0" stroke-width="1.4" fill="none" />
            <text x="139" y="166" text-anchor="middle" font-size="11" fill="#2ee0f0">距离短</text><text x="226" y="166" text-anchor="middle" font-size="11" fill="#2ee0f0">距离长</text>
            <circle cx="180" cy="120" r="6" fill="#ffc24b" stroke="#0b1220" stroke-width="1.5" />
            <text x="180" y="52" text-anchor="middle" font-size="12" fill="#aab6c8">重 × 短 = 轻 × 长 → 平衡</text>
            <text x="180" y="184" text-anchor="middle" font-size="11" fill="#74829a">重心（黄点）就是那个平衡点</text>
          </svg>
          <figcaption>重心 = 让两边"重量 × 距离"相等的那个点</figcaption>
        </figure>
      </div>

      <h3>4.2 各项指标的含义与当前结果</h3>
      <p>
        下表前六行对应技术要求表 2-2 的码盘指标，后三行是保证稳定性的附加检查。
        <template v-if="sum">当前方案表 2-2 指标 <b :class="sum.pass === sum.all ? 'g' : 'b'">{{ sum.pass }} / {{ sum.all }} 达标</b>。</template>
      </p>
      <table class="tb mt">
        <thead>
          <tr><th>指标</th><th>判定条件</th><th>怎么算</th><th>当前结果</th></tr>
        </thead>
        <tbody>
          <tr v-for="m in r?.metrics.items ?? []" :key="m.key">
            <td><b>{{ m.name }}</b><em>{{ m.source }}</em></td>
            <td class="num nw">{{ m.limit }}</td>
            <td>{{ how[m.key] ?? m.note }}</td>
            <td class="num nw">
              {{ m.display }}
              <span class="pill" :class="m.pass === null ? 'ref' : m.pass ? 'ok' : 'bad'">{{ m.pass === null ? '参考' : m.pass ? '达标' : '未达标' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ═══════════ 5 接口与口径 ═══════════ -->
    <section data-ch="io">
      <h2><span class="no">5</span>数据接口与口径</h2>
      <p class="lead">算法与界面是分开的：输入一份货物清单（JSON），输出一份码盘方案（JSON）。界面左下角的按钮可以导入清单、导出方案。</p>
      <div class="cols2">
        <div>
          <h4>输入：货物清单</h4>
          <pre>{{ sampleIn }}</pre>
          <p class="cap">长度单位 mm，重量单位 kg；<code>pallets</code> 可包含多个货盘的货物，导入后选择其中一盘。</p>
        </div>
        <div>
          <h4>输出：码盘方案</h4>
          <pre>{{ sampleOut }}</pre>
          <p class="cap"><code>placements</code> 按码放顺序排列，<code>pickSequence</code> 即仓储系统的出库顺序；位置为货物最小角点，原点在垛形区域左前角的货盘上表面。</p>
        </div>
      </div>
      <div class="note warn">
        <span class="tag">待确认的口径</span>
        <div>
          <ul>
            <li><b>利用率的分母</b>：按技术要求图 2-1 取 1000×1000，逐层计算、顶层不计。若按整个货盘 1219×1219 计算，把 1000×1000 的垛形填满也只有 67%，达不到 80%。</li>
            <li><b>重心偏移的基准长度</b>：默认取货盘边长 1219 mm，可在"参数"中改为垛形边长 1000 mm。</li>
            <li><b>支撑率下限 80%</b>、层间压缝率等稳定性阈值是研发设定，技术要求未给出。</li>
            <li><b>重心高度</b>按"货物 + 货盘"整体计算，已计入货盘自重。</li>
          </ul>
        </div>
      </div>
    </section>
  </DocShell>
</template>

<style scoped>
.flow {
  display: flex;
  align-items: stretch;
  margin: 14px 0 18px;
  overflow-x: auto;
}
.node {
  padding: 9px 10px;
  border-radius: 11px;
  background: rgba(148, 163, 184, 0.07);
  border: 1px solid var(--line);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--text);
  display: flex;
  flex-direction: column;
  gap: 2px;
  justify-content: center;
  white-space: nowrap;
}
.node small {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-3);
}
.node em {
  font-style: normal;
  font-size: 10.5px;
  color: var(--accent);
  font-weight: 600;
}
.node.in,
.node.out {
  background: linear-gradient(160deg, rgba(46, 224, 240, 0.12), rgba(91, 140, 255, 0.05));
  border-color: rgba(46, 224, 240, 0.35);
}
.group {
  display: flex;
  gap: 6px;
  padding: 27px 8px 8px;
  border-radius: 14px;
  border: 1px dashed var(--line-2);
  position: relative;
}
.gt {
  position: absolute;
  top: 6px;
  left: 12px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
}
.arr {
  flex: none;
  width: 14px;
  align-self: center;
  height: 2px;
  background: linear-gradient(90deg, rgba(46, 224, 240, 0.2), rgba(46, 224, 240, 0.8));
  position: relative;
  margin: 0 4px;
}
.arr::after {
  content: '';
  position: absolute;
  right: -2px;
  top: -4px;
  border-left: 7px solid rgba(46, 224, 240, 0.8);
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
}
.gal {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 12px;
  margin-top: 14px;
}
.gi {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.gi svg {
  width: 100%;
  display: block;
}
.gm {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  line-height: 1.4;
}
.gm b {
  color: var(--text);
}
.gs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  line-height: 1.4;
}
.gs em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-3);
}
.figs.two {
  max-width: 560px;
  margin-top: 6px;
}
.live {
  margin: 14px 0;
  padding: 14px 16px 8px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.24);
  border: 1px solid var(--line);
}
.live-h {
  font-size: 13px;
  margin-bottom: 8px;
}
.live-h .o {
  color: var(--accent);
  font-weight: 650;
}
.live-h .bb {
  color: var(--base);
  font-weight: 650;
}
.nw {
  white-space: nowrap;
}
.cards.two {
  grid-template-columns: 1fr 1fr;
}
.cmpt th em {
  display: block;
  font-style: normal;
  font-weight: 400;
  font-size: 11px;
}
.cmpt td.num {
  font-weight: 600;
  color: var(--text);
}
.cmpt td:nth-child(2) {
  color: var(--accent);
}
.cmpt td.bad {
  color: var(--bad);
}
.cite {
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-3);
}
.mt td:first-child {
  white-space: nowrap;
}
.fig.mid {
  width: 100%;
  max-width: 680px;
  justify-self: center;
  margin-top: 4px;
}
.tb .pill {
  margin-left: 6px;
}
.cols2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-bottom: 16px;
}
.cap {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--text-3);
}
code {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--accent);
}
@media (max-width: 1100px) {
  .gal {
    grid-template-columns: repeat(5, 1fr);
  }
  .cols2 {
    grid-template-columns: 1fr;
  }
}
</style>
