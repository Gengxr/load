<script setup lang="ts">
import { computed } from 'vue'
import { current, generateOrder, replanPallet, runPipeline, state } from '../store'
import { ENVELOPES, type EnvelopeKey } from '../algo/defaults'
import Icon from './Icon.vue'

/** 货盘可用空间的口径：本项目 1.2×1.2×1.5 m，或技术要求表 2-2 / 图 2-1 的 1.0×1.0×1.2 m */
const envKey = computed<EnvelopeKey>(() => (state.cons.footprintX === ENVELOPES.spec.footprintX && state.cons.maxStackHeight === ENVELOPES.spec.maxStackHeight ? 'spec' : 'project'))
function setEnvelope(k: EnvelopeKey) {
  Object.assign(state.cons, ENVELOPES[k])
  state.gen.fx = ENVELOPES[k].footprintX
  state.gen.fy = ENVELOPES[k].footprintY
  state.gen.targetHeight = k === 'project' ? 1350 : 1100
}

const leadOptions = [
  { v: 0, n: '严格逐层' },
  { v: 1, n: '可超前 1 层' },
  { v: 2, n: '可超前 2 层' },
]

/** all = true：按新参数重新生成出库单并全部重排；否则只重排当前货盘 */
async function apply(all: boolean) {
  state.paramsOpen = false
  if (all) {
    if (state.preset !== 'import') generateOrder()
    await runPipeline()
  } else await replanPallet()
}
</script>

<template>
  <aside class="pd glass">
    <header class="hd">
      <div class="hd-t"><Icon name="sliders" :size="17" />参数设置</div>
      <button class="btn icon ghost" title="关闭" @click="state.paramsOpen = false"><Icon name="x" :size="16" /></button>
    </header>

    <div class="body scroll">
      <section v-if="state.preset !== 'import' && state.gen.mode !== 'single'">
        <h4><Icon name="package" :size="14" />出库单生成</h4>
        <div class="row">
          <label>目标盘数</label>
          <input v-model.number="state.gen.pallets" type="number" min="1" max="12" />
        </div>
        <div v-if="state.gen.mode !== 'random'" class="row">
          <label>规格数</label>
          <input v-model.number="state.gen.skuCount" type="number" min="1" max="11" />
        </div>
        <div class="row col">
          <label>单盘目标体积<b class="num">{{ ((state.gen.fillRatio * state.gen.fx * state.gen.fy * state.gen.targetHeight) / 1e9).toFixed(2) }} m³</b></label>
          <input v-model.number="state.gen.fillRatio" type="range" min="0.5" max="0.95" step="0.01" />
        </div>
        <div v-if="state.gen.mode === 'random'" class="row">
          <label>高度取整</label>
          <select v-model.number="state.gen.heightStep">
            <option :value="50">50 mm 档位</option>
            <option :value="10">10 mm（完全随机）</option>
          </select>
        </div>
        <div class="row">
          <label>货物密度 kg/m³</label>
          <div class="pair">
            <input v-model.number="state.gen.densityMin" type="number" min="20" max="900" step="10" />
            <span>–</span>
            <input v-model.number="state.gen.densityMax" type="number" min="20" max="900" step="10" />
          </div>
        </div>
        <div class="row">
          <label>随机种子</label>
          <input v-model.number="state.gen.seed" type="number" class="seed" />
        </div>
      </section>

      <section>
        <h4><Icon name="split" :size="14" />多盘分配</h4>
        <div class="row col">
          <label>分配目标</label>
          <div class="seg full">
            <button :class="{ on: state.alloc.mode === 'balanced' }" @click="state.alloc.mode = 'balanced'">各盘均衡</button>
            <button :class="{ on: state.alloc.mode === 'compact' }" @click="state.alloc.mode = 'compact'">尽量码满</button>
          </div>
        </div>
        <div class="row">
          <label>盘数</label>
          <select v-model.number="state.alloc.fixedPallets">
            <option :value="0">自动（最少盘数）</option>
            <option v-for="k in 12" :key="k" :value="k">固定 {{ k }} 盘</option>
          </select>
        </div>
        <label class="check"><input v-model="state.alloc.keepSkuTogether" type="checkbox" />同规格尽量集中在少数货盘</label>
      </section>

      <section>
        <h4><Icon name="layers" :size="14" />码放布局</h4>
        <label class="check"><input v-model="state.cons.heavyBottom" type="checkbox" />重件置底：重的层优先放在下面</label>
        <label class="check"><input v-model="state.cons.bigBottom" type="checkbox" />大件置底：单件体积大的层优先放在下面</label>
        <label class="check"><input v-model="state.cons.bearing" type="checkbox" />承压约束：货物上方的压重不超过它的承压上限</label>
      </section>

      <section>
        <h4><Icon name="order" :size="14" />顺序规划<em>核心算法</em></h4>
        <div class="row col">
          <label>跨层码放</label>
          <div class="seg full">
            <button v-for="o in leadOptions" :key="o.v" :class="{ on: state.seq.layerLead === o.v }" @click="state.seq.layerLead = o.v">{{ o.n }}</button>
          </div>
        </div>
        <div class="row col">
          <label>
            目标权衡
            <b>{{ state.seq.wTravel <= 0.005 ? '平衡优先' : state.seq.wTravel >= 0.06 ? '作业连贯优先' : '兼顾' }}</b>
          </label>
          <input v-model.number="state.seq.wTravel" type="range" min="0" max="0.08" step="0.005" />
          <div class="ends"><span>全程平衡</span><span>少走动</span></div>
        </div>
        <div class="row">
          <label>束搜索宽度</label>
          <select v-model.number="state.seq.beamWidth">
            <option v-for="b in [8, 32, 96, 160]" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>
      </section>

      <section>
        <h4><Icon name="ruler" :size="14" />约束条件<em>表 2-2 与项目要求</em></h4>
        <div class="row col">
          <label>货盘可用空间</label>
          <div class="seg full">
            <button :class="{ on: envKey === 'project' }" title="本项目：单码盘可用空间 1.2 m × 1.2 m × 1.5 m" @click="setEnvelope('project')">1.2×1.2×1.5 m</button>
            <button :class="{ on: envKey === 'spec' }" title="技术要求表 2-2 / 图 2-1 的口径：垛形 1000×1000×(1000–1200)" @click="setEnvelope('spec')">1.0×1.0×1.2 m</button>
          </div>
        </div>
        <div class="kv"><span>货盘</span><b class="num">{{ state.pallet.length }}×{{ state.pallet.width }}×{{ state.pallet.height }}</b></div>
        <div class="kv"><span>垛高</span><b class="num">{{ state.cons.minStackHeight ? state.cons.minStackHeight + '–' : '≤ ' }}{{ state.cons.maxStackHeight }} mm</b></div>
        <div class="kv"><span>重心高度</span><b class="num">≤ {{ (state.cons.cogHeightRatioMax * 100).toFixed(0) }}% 总高</b></div>
        <div class="kv"><span>重心偏移</span><b class="num">≤ ±{{ (state.cons.cogOffsetRatioMax * 100).toFixed(0) }}%</b></div>
        <div class="kv"><span>层利用率</span><b class="num">≥ {{ (state.cons.utilizationMin * 100).toFixed(0) }}%（逐层）</b></div>
        <div class="kv"><span>上层外扩</span><b class="num">≤ {{ (state.cons.overhangRatioMax * 100).toFixed(0) }}%</b></div>
        <div class="row gap">
          <label>偏移基准</label>
          <div class="seg">
            <button :class="{ on: state.cons.cogOffsetBase === 'pallet' }" @click="state.cons.cogOffsetBase = 'pallet'">货盘 {{ state.pallet.length }}</button>
            <button :class="{ on: state.cons.cogOffsetBase === 'footprint' }" @click="state.cons.cogOffsetBase = 'footprint'">可用区 {{ state.cons.footprintX }}</button>
          </div>
        </div>
        <div class="row col">
          <label>底面支撑率下限<b class="num">{{ (state.cons.supportRatioMin * 100).toFixed(0) }}%</b></label>
          <input v-model.number="state.cons.supportRatioMin" type="range" min="0.6" max="1" step="0.05" />
        </div>
        <div class="row">
          <label>货盘自重 kg</label>
          <input v-model.number="state.pallet.tareWeight" type="number" min="0" max="200" />
        </div>
        <label class="check"><input v-model="state.cons.allowTipping" type="checkbox" />允许侧放（改变竖直方向）</label>
      </section>
    </div>

    <footer class="ft">
      <button class="btn" :disabled="state.planning || !current" data-tip="货物不变，按新参数重排当前货盘" @click="apply(false)">重排本盘</button>
      <button class="btn primary grow" :disabled="state.planning" @click="apply(true)"><Icon name="spark" :size="16" />应用并全部重排</button>
    </footer>
  </aside>
</template>

<style scoped>
.pd {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 10px;
  background: linear-gradient(180deg, rgba(20, 29, 47, 0.94), rgba(11, 16, 28, 0.94));
}
.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hd-t {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 650;
}
.hd-t .ic {
  color: var(--accent);
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin: 0 -6px;
  padding: 4px 6px;
}
h4 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 10px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
h4 em {
  margin-left: auto;
  font-style: normal;
  font-weight: 500;
  font-size: 11px;
  color: var(--text-3);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.row.col {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.row.gap {
  margin-top: 10px;
}
.row label {
  font-size: 12.5px;
  color: var(--text-2);
  display: flex;
  justify-content: space-between;
}
.row label b {
  color: var(--text);
  font-weight: 650;
}
.row input[type='number'] {
  width: 84px;
}
.row input.seed {
  width: 130px;
}
.pair {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-3);
}
.row .pair input[type='number'] {
  width: 70px;
}
.ends {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-3);
  margin-top: -2px;
}
.seg.full {
  display: flex;
}
.seg.full button {
  flex: 1;
  padding: 0 4px;
}
.kv {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  padding: 5px 0;
  color: var(--text-3);
  border-bottom: 1px solid var(--line);
}
.kv b {
  color: var(--text);
  font-weight: 500;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-2);
}
.ft {
  display: flex;
  gap: 8px;
}
.ft .btn {
  height: 40px;
}
.grow {
  flex: 1;
}
</style>
