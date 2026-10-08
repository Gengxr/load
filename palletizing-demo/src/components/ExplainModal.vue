<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bestPattern } from '../algo/pattern'
import { FIG21_PATTERNS } from '../algo/generator'
import { allocation, cabin, cargoById, loading, loadingBest, result, runInfo, skuColors, state, summary } from '../store'
import { pct, signedPct } from '../format'
import { SKU_COLORS } from '../viz/palette'
import Icon from './Icon.vue'
import BalanceChart from './BalanceChart.vue'

const tab = ref(0)
const tabs = ['整体流程', '多盘分配', '单盘布局与承压', '码放顺序', '舱内装载', '指标与接口']

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

// 多盘分配：每盘由哪些"层单元"搭成
const stacks = computed(() => {
  const a = allocation.value
  if (!a) return []
  return a.groups.map((g) => ({
    no: g.no,
    h: g.estHeight,
    kg: g.weight,
    units: g.units.map((u) => ({
      kind: u.kind,
      h: u.height,
      n: u.cargoIds.length,
      color: u.kind === 'full' ? (skuColors.value.get(cargoById.value.get(u.cargoIds[0])?.sku ?? '') ?? '#94a3b8') : '#7c8aa0',
      label: u.kind === 'full' ? u.skus[0] : u.kind === 'mixed' ? '混合层' : '零头',
    })),
  }))
})
const lp = computed(() => loadingBest.value ?? loading.value)
const passPallets = computed(() => summary.value)

const sampleIn = `{
  "schemaVersion": "0.1",
  "pallets": [
    { "palletNo": 1,
      "cargos": [
        { "id": "C0001", "rfid": "E2000017221101441890",
          "sku": "S01", "name": "药品", "kind": "carton",
          "length": 400, "width": 300, "height": 200,
          "weight": 8.5, "maxLoad": 41, "fragile": false }
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
const sampleRobot = `{
  "schema": "palletizing-robot-job/1.0",
  "palletId": "P01",
  "frames": { "pallet": "原点 = 货盘可用区域左前角…",
              "pick": "原点 = 输送线末端定位挡块…" },
  "tasks": [
    { "seq": 1, "rfid": "E2000017221101441890",
      "kind": "carton", "size": [400, 300, 200], "weight": 8.5,
      "pick":  { "x": -200, "y": 0, "z": 200, "rz": 0 },
      "place": { "x": 200, "y": 150, "z": 200, "rz": 0 },
      "transferZ": 320, "approachZ": 320,
      "gripper": { "type": "vacuum", "value": 2 },
      "speed": 1, "after": [] }
  ]
}`
</script>

<template>
  <div class="mask" @click.self="close">
    <div class="modal panel">
      <header>
        <div class="title"><Icon name="book" :size="18" />算法原理</div>
        <nav class="seg">
          <button v-for="(t, i) in tabs" :key="t" :class="{ on: tab === i }" @click="tab = i">{{ t }}</button>
        </nav>
        <button class="btn icon" title="关闭 (Esc)" @click="close"><Icon name="x" /></button>
      </header>

      <section v-if="tab === 0" class="body scroll">
        <p class="lead">
          从一张<b>出库清单</b>（每件货物的尺寸、重量和属性）出发，系统自动回答三个问题：这些货物<b class="c">分成几盘、每盘放哪些</b>；每一盘上<b class="c">每件放在哪、按什么顺序放</b>；
          码好的整托<b class="c">放进货舱的哪个货位、按什么顺序装载和投放</b>。结果同时兼顾空间利用率、码放平衡、货物承压和飞机重心包线，
          并且既能给人工码放做指引，也能直接交给机械臂执行。
        </p>
        <div class="flow">
          <div class="node in"><em>输入</em>出库清单<small>仓储系统 / 模拟生成</small></div>
          <div class="arr" />
          <div class="group">
            <div class="gt">① 多盘分配</div>
            <div class="node">层单元分解<small>同规格凑整层，零头拼混合层</small></div>
            <div class="node">多路划分<small>高度、重量均衡 + 局部搜索</small></div>
          </div>
          <div class="arr" />
          <div class="group">
            <div class="gt">② 单盘码放（各盘并行）</div>
            <div class="node">空间布局<small>大件重件在下，层间压缝</small></div>
            <div class="node">码放顺序<small>全过程重心平衡</small></div>
          </div>
          <div class="arr" />
          <div class="group">
            <div class="gt">③ 舱内装载</div>
            <div class="node">货位配平<small>枚举 / 启发式求最优</small></div>
            <div class="node">过程校验<small>装载、投放、卸载</small></div>
          </div>
          <div class="arr" />
          <div class="group out2">
            <div class="gt">④ 同一份方案，两种落地方式</div>
            <div class="node">人工引导<small>动画提示 + 脚踏确认</small></div>
            <div class="node">机械臂<small>取放指令直接执行</small></div>
          </div>
        </div>
        <div class="cols">
          <div class="col">
            <h4>三步怎样联动</h4>
            <p>
              分配给出每盘的货物后，各盘在多个线程里同时求解真实的码放方案；放不下的件自动回流到还有余量的货盘，必要时加开一盘重新分配。
              码放结果给出每个整托的重量和重心，直接作为装载规划的输入；整托称重实测回传后，再用实测值复核装载方案。
            </p>
          </div>
          <div class="col">
            <h4>为什么过程也要算</h4>
            <p>
              只看最终结果是不够的：码放途中重心长时间偏向一侧不利于操作和称重，装载或投放途中重心越出包线会影响飞行安全。
              因此单盘按"每放一件"、舱内按"每移动一个整托"逐步校核重心。
              <template v-if="r">当前货盘上，按"逐层行扫描"码放的过程峰值偏心为 <b class="b">{{ pct(r.sequences.baseline.summary.peakRatio) }}</b>，本方案为 <b class="c">{{ pct(r.sequences.balance.summary.peakRatio) }}</b>。</template>
            </p>
          </div>
          <div class="col">
            <h4>算法选型</h4>
            <p>
              三个问题都是带约束的组合优化问题。我们采用可解释、可控时限的经典方法：动态规划、启发式装箱、束搜索、局部搜索、枚举与模拟退火，
              不依赖黑箱模型，每一步都能说清"为什么这样放"。方案生成后再由独立的评估器按技术要求逐项核验。
            </p>
          </div>
        </div>
        <div v-if="r" class="band">
          <div class="bi"><b class="num">{{ gallery.filter((g) => g.got >= g.n).length }}/14</b><span>复现技术要求图 2-1 的堆码件数</span></div>
          <div class="bi"><b class="num">{{ passPallets ? `${passPallets.pass}/${passPallets.pallets}` : '—' }}</b><span>货盘通过全部必达指标（表 2-2 与承压）</span></div>
          <div class="bi"><b class="num g">↓{{ (reduce * 100).toFixed(0) }}%</b><span>码放过程峰值偏心（对比逐层行扫描）</span></div>
          <div class="bi"><b class="num">{{ lp ? signedPct(lp.metrics.errX, 2) : '—' }}</b><span>舱内货物重心长向误差（要求 ≤ ±10%）</span></div>
        </div>
      </section>

      <section v-else-if="tab === 1" class="body scroll">
        <p class="lead">
          多盘分配要决定<b>哪些货物放在同一个货盘</b>。难点在于：分得好不好，要等真正码出来才知道。我们的做法是先把货物凑成<b class="c">"层单元"</b>，
          再像搭积木一样把层单元分给各盘，最后让单盘算法逐盘验证。
        </p>
        <div v-if="stacks.length" class="stacks">
          <div v-for="g in stacks" :key="g.no" class="stk">
            <div class="col2" :style="{ height: (g.h / state.cons.maxStackHeight) * 168 + 'px' }">
              <i v-for="(u, k) in g.units" :key="k" :class="u.kind" :style="{ flex: u.h, background: u.kind === 'full' ? u.color : undefined }" :title="`${u.label} · ${u.n} 件 · 高 ${Math.round(u.h)} mm`" />
            </div>
            <b class="num">P{{ String(g.no).padStart(2, '0') }}</b>
            <span class="num">{{ g.h }} mm</span>
            <span class="num">{{ g.kg.toFixed(0) }} kg</span>
          </div>
          <div class="lim"><span>垛高上限 {{ state.cons.maxStackHeight }}</span></div>
          <div class="leg">
            <span><i class="full" />整层（同规格最优图案）</span>
            <span><i class="mixed" />混合层（同高零头拼成）</span>
            <span><i class="loose" />零头（放在顶层）</span>
          </div>
        </div>
        <div class="cols">
          <div class="col">
            <h4>① 层单元分解</h4>
            <p>
              每种规格按单层最优图案的件数凑成<b>整层</b>；凑不满一层的零头按高度归档，同高的用矩形装填拼成<b>混合层</b>（利用率 ≥ 80% 才成层）；
              最后剩下的少量零头留作某一盘的顶层。
              <template v-if="allocation">本次得到 <b class="c">{{ allocation.stats.fullLayers }}</b> 个整层、<b class="c">{{ allocation.stats.mixedLayers }}</b> 个混合层、<b class="c">{{ allocation.stats.looseCount }}</b> 件零头。</template>
            </p>
          </div>
          <div class="col">
            <h4>② 多路划分 + 局部搜索</h4>
            <p>
              把层单元分给各盘：每盘高度不超过上限，各盘高度、重量尽量均衡，同一规格尽量集中。先贪心构造，再反复尝试"移动一个单元""交换两个单元"，只要更好就接受。
              <template v-if="allocation">本次改进 <b class="c">{{ allocation.stats.moves }}</b> 次，各盘重量极差从 {{ allocation.stats.weightSpread[0].toFixed(0) }} kg 降到 <b class="g">{{ allocation.stats.weightSpread[1].toFixed(0) }} kg</b>。</template>
            </p>
          </div>
          <div class="col">
            <h4>③ 真实码放验证与回流</h4>
            <p>
              每盘交给单盘算法求出真实方案（多线程并行）。放不下的件回流到实际垛高最低、还有余量的货盘；仍放不下就加开一盘重新分配。
              <template v-if="runInfo">本次共 {{ runInfo.rounds }} 轮，回流 <b class="c">{{ runInfo.rerouted }}</b> 件，最终未放入 <b :class="runInfo.unplaced ? 'b' : 'g'">{{ runInfo.unplaced }}</b> 件，联动总用时 {{ (runInfo.elapsedMs / 1000).toFixed(1) }} s。</template>
            </p>
          </div>
        </div>
        <p class="note">盘数下界按体积估算为 {{ allocation?.stats.lowerBound ?? '—' }} 盘；实际盘数还要满足垛高不超过 {{ state.cons.maxStackHeight }} mm、每层利用率 ≥ 80%、货位限重等约束，因此可能多 1 盘。分配目标可在"参数"中切换为"尽量码满"。</p>
      </section>

      <section v-else-if="tab === 2" class="body scroll">
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
        <p class="note">
          上图按技术要求图 2-1 的口径计算：相对 1000×1000 承载面。本项目的货盘可用空间是 {{ state.cons.footprintX }}×{{ state.cons.footprintY }}×{{ state.cons.maxStackHeight }} mm，
          算法相同，只是把边界换成这个尺寸。混合规格的层采用 MaxRects 装填并与同规格图案竞争，择优选用。
        </p>
        <div class="cols two">
          <div class="col">
            <h4>货物承压：下面的不能被压坏</h4>
            <p>
              每件货物都带一个<b>承压上限</b>（顶面最多能压多重）。一件货物把"自重 + 它顶上的压重"按接触面积分给正下方托住它的各件，
              从上往下逐件累加，就得到每件实际承受的压重。算法分三步保证不超限：选层时让<b class="c">耐压的层排在下面</b>；
              排好之后若还有超限，把不耐压的层往上换；仍然压不住时，把最顶上的货物卸下、转到别的货盘，不会硬压。
              <template v-if="r">
                当前货盘最大承压比 <b :class="r.metrics.overloaded ? 'b' : 'g'">{{ pct(r.metrics.maxLoadRatio, 0) }}</b>，超限 <b :class="r.metrics.overloaded ? 'b' : 'g'">{{ r.metrics.overloaded }}</b> 件。
              </template>
              在三维视图右侧工具栏点"承压热力图"，可以看到每件货物被压到了上限的百分之几。
            </p>
          </div>
          <div class="col">
            <h4>三类包装，属性不同</h4>
            <p>
              货物都是规则的直方体，包装分<b>纸箱</b>、<b>木箱</b>和<b>军用特种箱</b>。类型决定三件事：承压能力（木箱和特种箱耐压，纸箱较弱，标了"怕压"的只能放在最上面）；
              三维里的外观；机械臂的抓取方式（纸箱用吸盘，木箱和特种箱用夹抱）和搬运速度。
              导入出库清单时，每件货物可以带 kind、maxLoad、fragile 三个属性；不给承压上限的货物按不限处理。
            </p>
          </div>
        </div>
      </section>

      <section v-else-if="tab === 3" class="body scroll">
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
              <li><b>中心向外生长</b>：优化结果自然呈现"先中间、后四周、左右交替"的规律，与现场码放的经验一致。</li>
            </ul>
          </div>
        </div>
        <div v-if="r" class="live">
          <div class="live-h">
            <b>当前这批货物</b>：
            <span class="o">本方案</span> 过程峰值 {{ pct(r.sequences.balance.summary.peakRatio) }} ·
            <span class="bb">逐层行扫描</span> 过程峰值 {{ pct(r.sequences.baseline.summary.peakRatio) }} ·
            超出 ±10% 的步数 {{ r.sequences.balance.summary.exceedSteps }} vs {{ r.sequences.baseline.summary.exceedSteps }}
          </div>
          <BalanceChart :ours="r.sequences.balance.steps.ratio" :base="r.sequences.baseline.steps.ratio" :warmup="r.sequences.balance.summary.warmupSteps" :k="r.sequences.balance.steps.ratio.length - 1" :tol="state.cons.cogOffsetRatioMax" :height="150" />
        </div>
        <p class="note">
          <b>起步阶段</b>（图中浅黄色区域）：货盘上的货物还不到整盘重量的 20% 时，放下一件较重的货物就会让重心明显偏移，这在物理上无法避免，而此时偏载力矩很小，
          所以这几步不计入"过程峰值"和"超限步数"，但曲线照常画出。
          <b>和谁比</b>："逐层行扫描"是自定义的对照基线（同一个垛形，只换顺序），不是某项标准；在"方案对比"里还可以和文献中常用的经典装箱算法
          DBLF（Karabulut 与 İnceoğlu，2004）做整体对比，它的位置和顺序都由它自己生成。
        </p>
      </section>

      <section v-else-if="tab === 4" class="body scroll">
        <p class="lead">
          舱内装载要决定<b>每个整托放在哪个货位、朝向如何、按什么顺序装和投</b>，目标是让<b class="c">货物合成重心贴近理论重心</b>，
          并且装载、投放、卸载的<b class="c">每一步</b>整机重心都不越出包络。
        </p>
        <div class="cols">
          <div class="col">
            <h4>三种重心，各有用途</h4>
            <p>
              <b>货物合成重心</b>只算整托货物，是验收量：相对数模理论重心，长、宽方向误差 ≤ ±10%。<b>各舱货物重心</b>用于多舱构型的分舱限重与配平。
              <b>含空机的整机重心</b>用于过程校验——空机很重，会"稀释"货物偏差，所以不能拿它代替验收量。
            </p>
            <div class="formula">货物重心 x = Σ mᵢ·xᵢ ÷ Σ mᵢ<br />误差 = ( x − x<sub>理论</sub> ) ÷ L<sub>货舱</sub> ≤ ±10%</div>
          </div>
          <div class="col">
            <h4>怎样求最优</h4>
            <p>
              货位只有几个到十几个。规模小时把所有摆法<b>全部枚举</b>一遍，所以结果是可证明的最优；规模大时用模拟退火加两两交换。
              <template v-if="lp">
                当前构型「{{ cabin.name }}」：{{ lp.solver.method === 'enumeration' ? `枚举了 ${lp.solver.evaluated.toLocaleString()} 种摆法` : `评估了 ${lp.solver.evaluated.toLocaleString()} 个候选` }}，用时
                <b class="c">{{ lp.solver.elapsedMs < 10 ? lp.solver.elapsedMs.toFixed(2) : lp.solver.elapsedMs.toFixed(0) }} ms</b>
                （要求 4 货盘/秒，即 {{ lp.assignments.length }} 盘不超过 {{ ((lp.assignments.length / 4) * 1000).toFixed(0) }} ms）。
              </template>
            </p>
          </div>
          <div class="col">
            <h4>过程重心怎么算</h4>
            <p>
              按作业路径做准静态分析：整托从舱门到货位（或反向）沿直线移动，这一段里系统质量不变、重心随位置线性变化，所以只需校核每段的端点。
              进舱、离机的瞬间质量突变，前后两个状态都要查。装载离门远的先进，投放离门近的先出；多列时自动选择使偏差最小的先后顺序。
            </p>
          </div>
        </div>
        <div v-if="lp" class="band">
          <div class="bi"><b class="num">{{ signedPct(lp.metrics.errX, 2) }}</b><span>长向重心误差（按出库顺序依次装入：{{ lp.baseline ? signedPct(lp.baseline.metrics.errX) : '—' }}）</span></div>
          <div class="bi"><b class="num">{{ signedPct(lp.metrics.errY, 2) }}</b><span>宽向重心误差</span></div>
          <div class="bi"><b class="num" :class="{ g: Object.values(lp.tracks).every((t) => t.ok) }">{{ pct(Math.max(...Object.values(lp.tracks).map((t) => t.peak)), 0) }}</b><span>全过程重心峰值占包络的比例</span></div>
          <div class="bi"><b class="num">{{ Math.round(lp.assignments.length / Math.max(1e-4, lp.solver.elapsedMs / 1000)).toLocaleString() }}</b><span>折合每秒可规划的货盘数（要求 ≥ 4）</span></div>
        </div>
        <p class="note">
          内置的 4 种构型是参数化示例：货位、舱门、限重、空机质量属性、理论重心和各阶段包络都由配置驱动，正式数据通过接口从航空货运模拟舱段子系统获取。
          人工调整货位或朝向后，系统即时重算三种重心和各阶段校验结果。
        </p>
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
        <div class="cols two">
          <div class="col">
            <h4>输出：机械臂作业指令（与设备无关）</h4>
            <pre>{{ sampleRobot }}</pre>
          </div>
          <div class="col">
            <h4>一份方案，两种落地方式</h4>
            <p>
              <b>人工引导</b>：工位大屏按顺序逐件提示——RFID 末 6 位、规格、层号、朝向和俯视位置图，工人放好后踩脚踏确认，可回退、可上报异常。
            </p>
            <p>
              <b>机械臂</b>：同一份方案展开成逐件的取放指令。位姿用<b class="c">货盘坐标系 / 取料坐标系下的工具中心点</b>表示，
              只需在现场标定这两个坐标系，机械臂控制器就能按顺序直接执行；每件都是"抬到安全高度 → 平移 → 竖直放下"，途中不会碰到已码好的货物，
              指令里还给出抓取方式、速度档和所需的工作空间与负载，用来核对机械臂选型。可导出 JSON 或 CSV 路径点表。
            </p>
          </div>
        </div>
        <p class="note">
          待与甲方确认的口径：① 利用率分母（按货盘可用区域 {{ state.cons.footprintX }}×{{ state.cons.footprintY }} 逐层计算、顶层不计）；② 重心偏移基准长度（货盘边长或可用区域边长，可切换）；
          ③ 支撑率下限等稳定性阈值（研发假设 80%）；④ 重心高度是否含货盘自重（本 Demo 含）；⑤ 各类货物的承压上限（本 Demo 为示例值，正式数据由出库清单给出）；
          ⑥ 机械臂的型号、取料点位置与通信协议（指令本身与设备无关，现场只需标定坐标系）。
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
.group.out2 {
  border-style: solid;
  border-color: rgba(34, 211, 238, 0.35);
  background: linear-gradient(160deg, rgba(34, 211, 238, 0.1), rgba(59, 130, 246, 0.04));
}
.flow .node {
  white-space: nowrap;
}
.flow .node small {
  white-space: normal;
}
.node.in,
.node.out {
  min-width: 112px;
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
.stacks {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 18px;
  padding: 26px 18px 14px;
  margin-bottom: 22px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--line);
  min-height: 250px;
}
.stk {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  width: 92px;
  font-size: 11px;
  color: var(--text-3);
}
.stk b {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text);
}
.col2 {
  width: 100%;
  display: flex;
  flex-direction: column-reverse;
  gap: 2px;
}
.col2 i {
  min-height: 3px;
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(8, 14, 24, 0.5) inset;
}
.col2 i.mixed,
.leg i.mixed {
  background: repeating-linear-gradient(45deg, #7c8aa0 0 5px, #5d6b80 5px 10px);
}
.col2 i.loose,
.leg i.loose {
  background: transparent;
  border: 1.5px dashed #9fb0c8;
  box-shadow: none;
}
.lim {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(14px + 62px + 168px);
  border-top: 1px dashed rgba(255, 107, 107, 0.6);
}
.lim span {
  position: absolute;
  right: 0;
  top: -18px;
  font-size: 11px;
  color: var(--bad);
}
.leg {
  margin-left: auto;
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: 9px;
  font-size: 12px;
  color: var(--text-2);
}
.leg i {
  display: inline-block;
  width: 26px;
  height: 11px;
  margin-right: 9px;
  border-radius: 3px;
  vertical-align: -1px;
}
.leg i.full {
  background: linear-gradient(90deg, #d8b48a, #8fb3d9, #b5cc8e);
}
</style>
