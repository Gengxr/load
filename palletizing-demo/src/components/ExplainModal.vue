<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bestPattern } from '../algo/pattern'
import { FIG21_PATTERNS } from '../algo/generator'
import { result, state } from '../store'
import { pct } from '../format'
import { SKU_COLORS } from '../viz/palette'
import Icon from './Icon.vue'
import BalanceChart from './BalanceChart.vue'

const tab = ref(0)
const tabs = ['整体思路', '图 2-1 对照', '码放顺序规划', '指标与接口']

function close() {
  state.explainOpen = false
}
function onKey(e: KeyboardEvent) {
  if (e.code === 'Escape') close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const gallery = computed(() =>
  FIG21_PATTERNS.map((f, i) => {
    const t0 = performance.now()
    const r = bestPattern(f.l, f.w, 1000, 1000)
    return { ...f, got: r.count, rects: r.rects, structure: r.structure, ms: performance.now() - t0, color: SKU_COLORS[i % SKU_COLORS.length] }
  }),
)
const allMatch = computed(() => gallery.value.every((g) => g.got >= g.n))

const r = computed(() => result.value)
const reduce = computed(() => {
  const res = r.value
  if (!res) return 0
  const a = res.sequences.balance.summary.peakRatio
  const b = res.sequences.baseline.summary.peakRatio
  return b > 0 ? 1 - a / b : 0
})

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
  <div class="mask" @click.self="close">
    <div class="modal panel">
      <header>
        <div class="title"><Icon name="book" :size="18" />单盘动态码放规划 · 算法原理</div>
        <nav class="seg">
          <button v-for="(t, i) in tabs" :key="t" :class="{ on: tab === i }" @click="tab = i">{{ t }}</button>
        </nav>
        <button class="btn icon" title="关闭 (Esc)" @click="close"><Icon name="x" /></button>
      </header>

      <section v-if="tab === 0" class="body scroll">
        <p class="lead">
          本模块要解决的问题是：<b>给定一个货盘和分到这个货盘上的一批货物</b>，决定<b class="c">每一件放在哪里</b>，以及<b class="c">按什么顺序一件一件放上去</b>，
          并且保证不仅最终状态、而且<b class="c">每放一件之后的中间状态</b>都平衡、稳定。
        </p>
        <div class="flow">
          <div class="node in"><em>输入</em>货物集合<small>多盘分配结果 / 仓储出库清单</small></div>
          <div class="arr" />
          <div class="group">
            <div class="gt">① 空间布局 · 每件放哪</div>
            <div class="node">层构造<small>同规格最优图案 / 混合装填</small></div>
            <div class="node">层序列<small>体积密度高、重层在下、外扩 ≤5%</small></div>
            <div class="node">重心精修<small>层镜像平移、同规格互换</small></div>
          </div>
          <div class="arr" />
          <div class="group">
            <div class="gt">② 动态顺序 · 先放哪件</div>
            <div class="node">支撑依赖图<small>下方货物必须先就位</small></div>
            <div class="node">平衡优先束搜索<small>全过程偏心最小</small></div>
          </div>
          <div class="arr" />
          <div class="node out"><em>输出</em>码盘方案<small>位置 · 顺序 · 出库顺序 · 指标</small></div>
        </div>
        <div class="cols">
          <div class="col">
            <h4>为什么分成两步</h4>
            <p>
              "放在哪"决定最终垛形的利用率、重心、稳定性，对应技术要求表 2-2 的各项指标；"先放哪件"决定码放过程中的平衡，
              以及散货的出库顺序（仓储系统按这个顺序出库）。两者目标不同，分开求解既快又可解释。
            </p>
          </div>
          <div class="col">
            <h4>为什么不只看最终结果</h4>
            <p>
              传统的"一层码满再码下一层、从一个角扫到另一个角"会让重心在码放途中大幅偏向一侧。
              <template v-if="r">
                在当前这批货物上，传统顺序的过程峰值偏心为 <b class="b">{{ pct(r.sequences.baseline.summary.peakRatio) }}</b>，
                本方案为 <b class="c">{{ pct(r.sequences.balance.summary.peakRatio) }}</b>，降低 <b class="g">{{ (reduce * 100).toFixed(0) }}%</b>。
              </template>
            </p>
          </div>
          <div class="col">
            <h4>算法选型</h4>
            <p>
              这是带约束的组合优化问题。我们采用可解释、可控时限的经典方法：动态规划、启发式装箱、束搜索、局部搜索，
              不依赖黑箱模型，每一步都能说清楚"为什么这样放"。当前方案生成用时
              <b class="c">{{ r ? (r.timings.totalMs / 1000).toFixed(2) + ' s' : '—' }}</b>（技术要求 ≤ 120 s / 垛）。
            </p>
          </div>
        </div>
        <div v-if="r" class="band">
          <div class="bi"><b class="num">{{ gallery.filter((g) => g.got >= g.n).length }}/14</b><span>复现技术要求图 2-1 的堆码件数</span></div>
          <div class="bi"><b class="num">{{ r.metrics.items.filter((m) => m.source.startsWith('表') && m.pass).length }}/{{ r.metrics.items.filter((m) => m.source.startsWith('表')).length }}</b><span>表 2-2 码盘指标自动报告达标</span></div>
          <div class="bi"><b class="num g">↓{{ (reduce * 100).toFixed(0) }}%</b><span>码放过程峰值偏心（对比传统逐层）</span></div>
          <div class="bi"><b class="num">{{ (r.timings.totalMs / 1000).toFixed(2) }} s</b><span>{{ r.layout.placements.length }} 件货物的方案生成用时</span></div>
        </div>
      </section>

      <section v-else-if="tab === 1" class="body scroll">
        <p class="lead">
          技术要求图 2-1 给出了 14 种单规格货物的堆码方式。下面每一张图都由本算法<b class="c">现场实时计算</b>（断头台动态规划 + 五块风车式结构），
          <b :class="allMatch ? 'g' : 'b'">{{ gallery.filter((g) => g.got >= g.n).length }} / 14 达到或超过图中件数</b>，包括中心留空的风车式排布。
        </p>
        <div class="gal">
          <div v-for="g in gallery" :key="g.l + 'x' + g.w" class="gi">
            <svg viewBox="-12 -12 1024 1024">
              <rect x="-12" y="-12" width="1024" height="1024" rx="26" fill="rgba(148,163,184,0.06)" />
              <rect x="0" y="0" width="1000" height="1000" fill="none" stroke="rgba(34,211,238,0.5)" stroke-width="4" stroke-dasharray="16 10" />
              <rect v-for="(q, k) in g.rects" :key="k" :x="q.x + 4" :y="1000 - q.y - q.h + 4" :width="q.w - 8" :height="q.h - 8" rx="8" :fill="g.color" fill-opacity="0.9" />
            </svg>
            <div class="gm">
              <b class="num">{{ g.l }}×{{ g.w }}</b>
              <span class="num">{{ g.got }} 件 · {{ pct((g.got * g.l * g.w) / 1e6, 1) }}</span>
            </div>
            <div class="gs">
              <span class="pill" :class="g.got >= g.n ? 'ok' : 'bad'">图 2-1：{{ g.n }} 件 {{ g.got >= g.n ? '✓' : '' }}</span>
              <em :title="`计算用时 ${g.ms < 1 ? '<1' : g.ms.toFixed(0)} ms`">{{ g.structure === 'pinwheel' ? '风车式' : '分块式' }}</em>
            </div>
          </div>
        </div>
        <p class="note">利用率按图 2-1 的口径计算：相对 1000×1000 承载面。混合规格的层则采用 MaxRects 装填并与同规格图案竞争，择优选用。</p>
      </section>

      <section v-else-if="tab === 2" class="body scroll">
        <div class="cols two">
          <div class="col">
            <h4>第一步：先后约束——哪些件必须先放</h4>
            <svg class="dag" viewBox="0 0 560 200">
              <defs>
                <marker id="ah" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#22d3ee" /></marker>
              </defs>
              <text x="160" y="18" text-anchor="middle" font-size="12" fill="#6d7a8e">侧视</text>
              <rect x="10" y="150" width="300" height="12" rx="3" fill="#64748b" />
              <rect x="20" y="100" width="90" height="50" rx="5" fill="#d8b48a" />
              <rect x="115" y="100" width="90" height="50" rx="5" fill="#d8b48a" />
              <rect x="210" y="100" width="90" height="50" rx="5" fill="#d8b48a" />
              <rect x="62" y="45" width="100" height="55" rx="5" fill="#8fb3d9" />
              <rect x="167" y="45" width="100" height="55" rx="5" fill="#8fb3d9" />
              <g font-size="16" fill="#0f172a" font-weight="700" text-anchor="middle">
                <text x="65" y="131">A</text><text x="160" y="131">B</text><text x="255" y="131">C</text>
                <text x="112" y="78">D</text><text x="217" y="78">E</text>
              </g>
              <text x="440" y="18" text-anchor="middle" font-size="12" fill="#6d7a8e">先后约束图（DAG）</text>
              <g stroke="#22d3ee" stroke-width="2.2" fill="none" marker-end="url(#ah)">
                <path d="M372 150 L398 78" /><path d="M440 150 L412 78" /><path d="M448 150 L476 78" /><path d="M510 150 L488 78" />
              </g>
              <g font-size="14" font-weight="700" text-anchor="middle">
                <circle cx="368" cy="165" r="15" fill="#d8b48a" /><text x="368" y="170" fill="#0f172a">A</text>
                <circle cx="444" cy="165" r="15" fill="#d8b48a" /><text x="444" y="170" fill="#0f172a">B</text>
                <circle cx="514" cy="165" r="15" fill="#d8b48a" /><text x="514" y="170" fill="#0f172a">C</text>
                <circle cx="405" cy="62" r="15" fill="#8fb3d9" /><text x="405" y="67" fill="#0f172a">D</text>
                <circle cx="482" cy="62" r="15" fill="#8fb3d9" /><text x="482" y="67" fill="#0f172a">E</text>
              </g>
              <text x="160" y="190" text-anchor="middle" font-size="12.5" fill="#a3afc0">D 压在 A、B 上；E 压在 B、C 上</text>
              <text x="440" y="198" text-anchor="middle" font-size="12.5" fill="#a3afc0">合法顺序例：B→A→D→C→E</text>
            </svg>
            <p>
              人工或机械手都是<b class="c">从上方竖直放下</b>货物。所以任何一件货物放下时，它正下方投影重叠的货物必须已经就位——
              这既保证了"放得下去"，也保证了<b class="c">每个中间状态里每件货物都被完整托住</b>。这些关系构成一张有向无环图（DAG），
              所有合法的码放顺序就是它的拓扑序。
            </p>
          </div>
          <div class="col">
            <h4>第二步：在所有合法顺序里找"全过程最平衡"的一个</h4>
            <div class="formula">
              <div>
                min J = w<sub>峰</sub>·max<sub>k</sub> e<sub>k</sub> + w<sub>均</sub>·mean<sub>k</sub> e<sub>k</sub> + w<sub>孔</sub>·N<sub>孔</sub> + w<sub>行</sub>·L<sub>行</sub> + w<sub>跨</sub>·N<sub>跨</sub>
              </div>
              <small>e<sub>k</sub>：放完第 k 件后，货物 + 货盘系统重心偏离几何中心的比例 max(|Δx|, |Δy|) / 基准长度</small>
            </div>
            <ul>
              <li><b>束搜索</b>：每一步保留得分最好的 {{ state.seq.beamWidth }} 个"部分方案"继续扩展，比贪心看得更远，又不会组合爆炸。</li>
              <li><b>增量重心</b>：每扩展一件只需 O(1) 更新力矩，几百件货物毫秒级完成。</li>
              <li><b>封闭孔位前瞻</b>：避免把某个空位四面围死，工人还得把箱子"塞"进去。</li>
              <li><b>允许跨层</b>：不必一层码满再码下一层；下层局部完成后，可以先码上层来配平（参数可设为严格逐层）。</li>
              <li><b>中心向外生长</b>：优化结果自然呈现"先中间、后四周、左右交替"的规律，与会上讨论的经验一致。</li>
            </ul>
          </div>
        </div>
        <div v-if="r" class="live">
          <div class="live-h">
            <b>当前这批货物</b>：
            <span class="o">本方案</span> 过程峰值 {{ pct(r.sequences.balance.summary.peakRatio) }} ·
            <span class="bb">传统逐层</span> 过程峰值 {{ pct(r.sequences.baseline.summary.peakRatio) }} ·
            超出 ±10% 的步数 {{ r.sequences.balance.summary.exceedSteps }} vs {{ r.sequences.baseline.summary.exceedSteps }}
          </div>
          <BalanceChart :ours="r.sequences.balance.steps.ratio" :base="r.sequences.baseline.steps.ratio" :k="r.sequences.balance.steps.ratio.length - 1" :tol="state.cons.cogOffsetRatioMax" :height="150" />
        </div>
      </section>

      <section v-else class="body scroll">
        <table class="tbl">
          <thead>
            <tr><th>技术要求</th><th>本 Demo 的实现</th><th>当前结果</th></tr>
          </thead>
          <tbody>
            <tr v-for="m in r?.metrics.items ?? []" :key="m.key">
              <td>{{ m.name }}<em>{{ m.source }}</em></td>
              <td>{{ m.limit }}<em v-if="m.note">{{ m.note }}</em></td>
              <td class="num">
                {{ m.display }}
                <span class="pill" :class="m.pass === null ? 'ref' : m.pass ? 'ok' : 'bad'">{{ m.pass === null ? '参考' : m.pass ? '达标' : '未达标' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="cols two">
          <div class="col">
            <h4>输入接口（与多盘分配 / 仓储系统对接）</h4>
            <pre>{{ sampleIn }}</pre>
          </div>
          <div class="col">
            <h4>输出：码盘方案（位置、顺序、出库顺序、指标）</h4>
            <pre>{{ sampleOut }}</pre>
          </div>
        </div>
        <p class="note">
          待与甲方确认的口径：① 利用率分母（本 Demo 按图 2-1 取 1000×1000，逐层、顶层不计）；② 重心偏移基准长度（1219 或 1000，可切换）；
          ③ 支撑率下限等稳定性阈值（研发假设 80%）；④ 重心高度是否含货盘自重（本 Demo 含）。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(3, 6, 12, 0.6);
  backdrop-filter: blur(5px);
  display: grid;
  place-items: center;
}
.modal {
  width: min(1180px, 94vw);
  height: min(780px, 90vh);
  display: flex;
  flex-direction: column;
  background: rgba(12, 18, 30, 0.97);
}
header {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}
.title {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 16px;
  font-weight: 650;
}
header nav {
  margin-left: auto;
}
.body {
  flex: 1;
  padding: 22px 26px;
  min-height: 0;
}
.lead {
  font-size: 15px;
  line-height: 1.8;
  color: var(--text-2);
  margin: 0 0 20px;
}
b.c,
.lead b.c {
  color: var(--accent);
}
b.b {
  color: var(--base);
}
b.g {
  color: var(--ok);
}
.lead b {
  color: var(--text);
}
.flow {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin-bottom: 24px;
}
.node {
  padding: 11px 13px;
  border-radius: 11px;
  background: rgba(148, 163, 184, 0.07);
  border: 1px solid var(--line);
  font-size: 13.5px;
  font-weight: 600;
  display: flex;
  flex-direction: column;
  gap: 3px;
  justify-content: center;
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
  min-width: 140px;
  background: linear-gradient(160deg, rgba(34, 211, 238, 0.12), rgba(59, 130, 246, 0.05));
  border-color: rgba(34, 211, 238, 0.35);
}
.group {
  display: flex;
  gap: 8px;
  padding: 26px 10px 10px;
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
}
.arr {
  width: 26px;
  align-self: center;
  height: 2px;
  background: linear-gradient(90deg, rgba(34, 211, 238, 0.2), rgba(34, 211, 238, 0.8));
  position: relative;
  margin: 0 4px;
}
.arr::after {
  content: '';
  position: absolute;
  right: -2px;
  top: -4px;
  border-left: 7px solid rgba(34, 211, 238, 0.8);
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
}
.cols {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 22px;
}
.cols.two {
  grid-template-columns: 1fr 1fr;
  margin-top: 18px;
}
.col h4 {
  margin: 0 0 8px;
  font-size: 14px;
}
.col p,
.col li {
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.75;
  margin: 0;
}
.col ul {
  padding-left: 18px;
  margin: 12px 0 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.col li b {
  color: var(--text);
}
.gal {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 12px;
}
.gi {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gi svg {
  width: 100%;
  display: block;
}
.gm {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.gm span {
  color: var(--text-2);
}
.gs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.gs em {
  font-style: normal;
  font-size: 10.5px;
  color: var(--text-3);
}
.band {
  margin-top: 30px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
.bi {
  padding: 18px 18px 16px;
  border-radius: 14px;
  background: linear-gradient(160deg, rgba(34, 211, 238, 0.1), rgba(59, 130, 246, 0.04));
  border: 1px solid rgba(34, 211, 238, 0.22);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bi b {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--text);
}
.bi b.g {
  color: var(--ok);
}
.bi span {
  font-size: 12.5px;
  color: var(--text-2);
}
.live {
  margin-top: 22px;
  padding: 14px 16px 8px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: rgba(148, 163, 184, 0.04);
}
.live-h {
  font-size: 13px;
  color: var(--text-2);
}
.live-h b {
  color: var(--text);
}
.live-h .o {
  color: var(--accent);
  font-weight: 600;
}
.live-h .bb {
  color: var(--base);
  font-weight: 600;
}
.note {
  margin-top: 18px;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.7;
}
.dag {
  width: 100%;
  max-width: 560px;
  display: block;
  margin: 4px 0 10px;
}
.formula {
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(34, 211, 238, 0.07);
  border: 1px solid rgba(34, 211, 238, 0.25);
  font-family: 'Times New Roman', 'Songti SC', serif;
  font-size: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.formula small {
  font-family: var(--font);
  font-size: 12px;
  color: var(--text-3);
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.tbl th {
  text-align: left;
  color: var(--text-3);
  font-weight: 600;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line-2);
}
.tbl td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  color: var(--text);
  vertical-align: top;
}
.tbl td em {
  display: block;
  font-style: normal;
  color: var(--text-3);
  font-size: 11px;
}
.tbl td .pill {
  margin-left: 8px;
}
pre {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(2, 6, 14, 0.55);
  border: 1px solid var(--line);
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: #cbd5e1;
  overflow: auto;
}
</style>
