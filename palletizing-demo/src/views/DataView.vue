<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  addImportedDataset,
  apiLog,
  cabin,
  clearHistory,
  datasetCargos,
  datasets,
  deleteDataset,
  deleteHistory,
  history,
  loadDataset,
  loading,
  order,
  pallets,
  renameDataset,
  replay,
  resetLocalData,
  saveDataset,
  saveSettings,
  state,
  toast,
  units,
  type DataTab,
} from '../store'
import { flattenImported, loadingPayload, orderPayload, palletUnitsPayload, palletizingPayload, parseCargoJson } from '../algo/io'
import { poolSize } from '../taskPool'
import { download } from '../persist'
import { pct } from '../format'
import Icon from '../components/Icon.vue'

/** 数据中心：数据集管理、算法运行历史、对外接口、可视化配置（表 2-3 第 1、2、7 项） */
const tabs: { k: DataTab; n: string; icon: string; d: string }[] = [
  { k: 'datasets', n: '货物数据集', icon: 'package', d: '模拟生成与外部导入的出库清单' },
  { k: 'history', n: '运行历史', icon: 'history', d: '每次算法调用的结果记录' },
  { k: 'api', n: '接口管理', icon: 'plug', d: '与仓储、舱段子系统的数据交互' },
  { k: 'settings', n: '可视化配置', icon: 'sliders', d: '渲染、播放与联动设置' },
]
const time = (t: number) => new Date(t).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

// ── 数据集 ──
const fileInput = ref<HTMLInputElement | null>(null)
const editing = ref('')
const editName = ref('')
function saveCurrent() {
  const ds = saveDataset()
  if (ds) toast('已保存当前出库清单')
}
function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  f.text().then((t) => {
    try {
      const ds = addImportedDataset(f.name, flattenImported(parseCargoJson(t)))
      if (ds) toast(`已导入 ${ds.count} 件货物`)
    } catch (err) {
      toast('导入失败：' + (err instanceof Error ? err.message : String(err)))
    }
  })
  ;(e.target as HTMLInputElement).value = ''
}
function startEdit(id: string, name: string) {
  editing.value = id
  editName.value = name
}
function commitEdit() {
  if (editing.value && editName.value.trim()) renameDataset(editing.value, editName.value.trim())
  editing.value = ''
}
function exportDataset(id: string) {
  const d = datasets.value.find((x) => x.id === id)
  if (d) download(`${d.name}.json`, orderPayload(d.id, datasetCargos(d)))
}

// ── 历史 ──
const kindCls = { 联合规划: 'joint', 码盘规划: 'pal', 装载规划: 'load' } as const
function exportHistory() {
  download('算法运行历史.json', history.value)
}

// ── 接口 ──
interface Endpoint {
  id: string
  sys: 'wms' | 'cabin'
  dir: 'in' | 'out'
  method: string
  path: string
  name: string
  build: () => unknown
}
const oid = computed(() => order.value?.id ?? 'DEMO')
const endpoints = computed<Endpoint[]>(() => [
  { id: 'w1', sys: 'wms', dir: 'in', method: 'POST', path: '/ext/v1/wms/palletizing-requests', name: '出库清单与散货数据', build: () => orderPayload(oid.value, order.value?.cargos ?? []) },
  { id: 'w2', sys: 'wms', dir: 'out', method: 'POST', path: '{wms}/palletizing-plans', name: '码盘方案与散货出库顺序', build: () => palletizingPayload(oid.value, pallets.value, state.pallet, state.cons) },
  { id: 'w3', sys: 'wms', dir: 'in', method: 'POST', path: '/ext/v1/wms/pallet-measurements', name: '整托货物数据（重量、重心）', build: () => palletUnitsPayload(units.value) },
  {
    id: 'w4',
    sys: 'wms',
    dir: 'out',
    method: 'POST',
    path: '{wms}/loading-sequences',
    name: '整托出库顺序',
    build: () => ({ schemaVersion: '0.2', planId: 'LP-' + oid.value, version: 1, palletOutboundSequence: loading.value?.tracks.load.order.map((id) => units.value.find((u) => u.id === id)?.rfid) ?? [] }),
  },
  { id: 'c1', sys: 'cabin', dir: 'out', method: 'GET', path: `{cabin}/configs/${cabin.value.id}`, name: '货运系统构型参数与约束', build: () => cabin.value },
  { id: 'c2', sys: 'cabin', dir: 'out', method: 'POST', path: '{cabin}/loading-plans', name: '装载方案与装载 / 投放顺序', build: () => (loading.value ? loadingPayload(oid.value, cabin.value, units.value, loading.value) : {}) },
  {
    id: 'c3',
    sys: 'cabin',
    dir: 'in',
    method: 'POST',
    path: '/ext/v1/cabin/execution-events',
    name: '执行事件（到位 / 投放 / 卸载）',
    build: () => {
      const op = loading.value?.tracks.load.ops[0]
      return { messageId: 'EV-0001', planId: 'LP-' + oid.value, version: 1, eventType: 'PALLET_IN_SLOT', palletId: op?.palletId, slotId: op?.slotId, occurredAt: new Date().toISOString() }
    },
  },
])
const systems = [
  { k: 'wms' as const, n: '智能仓储子系统', d: '出库清单、散货数据、整托实测；接收码盘方案与出库顺序', icon: 'warehouse' },
  { k: 'cabin' as const, n: '航空货运模拟舱段子系统', d: '构型参数与约束；接收装载方案与装载 / 投放顺序', icon: 'plane' },
]
const picked = ref('w2')
const cur = computed(() => endpoints.value.find((e) => e.id === picked.value) ?? endpoints.value[0])
const payload = computed(() => {
  const text = JSON.stringify(cur.value.build(), null, 2)
  const lines = text.split('\n')
  const shown = lines.length > 220 ? lines.slice(0, 220).join('\n') + `\n  … 其余 ${lines.length - 220} 行已省略，可下载查看完整报文` : text
  return { text, shown, lines: lines.length, kb: (new Blob([text]).size / 1024).toFixed(1) }
})
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const highlighted = computed(() =>
  esc(payload.value.shown)
    .replace(/("(?:[^"\\]|\\.)*")(\s*:)?/g, (_m, str: string, colon?: string) => (colon ? `<i class="k">${str}</i>${colon}` : `<i class="s">${str}</i>`))
    .replace(/\b(-?\d+(?:\.\d+)?)\b(?![^<]*<\/i>)/g, '<i class="n">$1</i>')
    .replace(/\b(true|false|null)\b(?![^<]*<\/i>)/g, '<i class="b">$1</i>'),
)
function copyPayload() {
  navigator.clipboard?.writeText(payload.value.text).then(
    () => toast('报文已复制'),
    () => toast('复制失败，请使用下载'),
  )
}

// ── 配置 ──
const qualities = [
  { v: 'auto', n: '跟随屏幕', d: '按显示器像素比渲染' },
  { v: 'hd', n: '不低于 1080p', d: '保证 1920×1080 以上输出' },
  { v: 'uhd', n: '超清', d: '2 倍超采样，适合 55 寸大屏' },
] as const
const usage = computed(() => {
  try {
    let n = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (k.startsWith('pld.')) n += k.length + (localStorage.getItem(k)?.length ?? 0)
    }
    return (n / 1024).toFixed(1)
  } catch {
    return '0'
  }
})
function reset() {
  if (!confirm('将清除本机保存的数据集、运行历史和配置，确定继续？')) return
  resetLocalData()
  toast('本地数据已清除')
}
</script>

<template>
  <main class="dv">
    <nav class="side glass">
      <div class="ph"><Icon name="database" :size="17" />数据中心</div>
      <button v-for="t in tabs" :key="t.k" class="nt" :class="{ on: state.dataTab === t.k }" @click="state.dataTab = t.k">
        <span class="ni"><Icon :name="t.icon" :size="17" /></span>
        <span class="nx"><b>{{ t.n }}</b><span>{{ t.d }}</span></span>
      </button>
      <div class="sum num">
        <div><b>{{ datasets.length }}</b><span>数据集</span></div>
        <div><b>{{ history.length }}</b><span>运行记录</span></div>
        <div><b>{{ apiLog.length }}</b><span>接口报文</span></div>
      </div>
    </nav>

    <!-- 数据集 -->
    <section v-if="state.dataTab === 'datasets'" class="main glass">
      <header>
        <div>
          <h2>货物数据集</h2>
          <p>模拟生成的出库清单只保存生成参数与随机种子，再次载入时结果完全一致；外部导入的清单完整保存。</p>
        </div>
        <div class="acts">
          <button class="btn" @click="fileInput?.click()"><Icon name="upload" :size="15" />导入清单 JSON</button>
          <button class="btn primary" :disabled="!order" @click="saveCurrent"><Icon name="save" :size="15" />保存当前出库清单</button>
          <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onFile" />
        </div>
      </header>
      <div class="tw scroll">
        <table v-if="datasets.length" class="tbl">
          <thead>
            <tr><th>名称</th><th>来源</th><th class="r">件数</th><th class="r">规格</th><th class="r">总重 kg</th><th>创建时间</th><th class="r">操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="d in datasets" :key="d.id">
              <td class="name">
                <input v-if="editing === d.id" v-model="editName" type="text" @keydown.enter="commitEdit" @blur="commitEdit" />
                <template v-else><b>{{ d.name }}</b><button class="mini" data-tip="重命名" @click="startEdit(d.id, d.name)"><Icon name="pencil" :size="13" /></button></template>
              </td>
              <td><span class="pill" :class="d.source === '模拟生成' ? 'ref' : 'imp'">{{ d.source }}</span></td>
              <td class="r num">{{ d.count }}</td>
              <td class="r num">{{ d.skus }}</td>
              <td class="r num">{{ d.weight.toFixed(0) }}</td>
              <td class="num dim">{{ time(d.createdAt) }}</td>
              <td class="r ops">
                <button class="btn sm primary" :disabled="state.planning" @click="loadDataset(d.id)"><Icon name="play" :size="13" />载入并规划</button>
                <button class="btn sm icon" data-tip="导出 JSON" @click="exportDataset(d.id)"><Icon name="download" :size="14" /></button>
                <button class="btn sm icon danger" data-tip="删除" @click="deleteDataset(d.id)"><Icon name="trash" :size="14" /></button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty"><Icon name="folder" :size="34" />还没有保存的数据集<span>可以保存当前出库清单，或导入仓储系统给出的清单 JSON</span></div>
      </div>
    </section>

    <!-- 运行历史 -->
    <section v-else-if="state.dataTab === 'history'" class="main glass">
      <header>
        <div>
          <h2>算法运行历史</h2>
          <p>每次调用码盘或装载算法都会记录输入规模、结果指标与耗时；模拟数据可按原参数一键复现。</p>
        </div>
        <div class="acts">
          <button class="btn" :disabled="!history.length" @click="exportHistory"><Icon name="download" :size="15" />导出记录</button>
          <button class="btn danger" :disabled="!history.length" @click="clearHistory"><Icon name="trash" :size="15" />清空</button>
        </div>
      </header>
      <div class="tw scroll">
        <table v-if="history.length" class="tbl">
          <thead>
            <tr><th>时间</th><th>类型</th><th>对象</th><th class="r">件数</th><th class="r">货盘达标</th><th>构型</th><th class="r">重心误差 X / Y</th><th class="r">耗时</th><th>结果</th><th class="r">操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="h in history" :key="h.id">
              <td class="num dim">{{ time(h.time) }}</td>
              <td><span class="pill kind" :class="kindCls[h.kind]">{{ h.kind }}</span></td>
              <td class="ell obj">{{ h.order }}<span v-if="h.note" class="dim"> · {{ h.note }}</span></td>
              <td class="r num">{{ h.cargoCount || '—' }}</td>
              <td class="r num">{{ h.passPallets }} / {{ h.pallets }}</td>
              <td class="num">{{ h.cabin || '—' }}</td>
              <td class="r num">{{ h.errX === null ? '—' : `${pct(h.errX, 2)} / ${pct(h.errY ?? 0, 2)}` }}</td>
              <td class="r num">{{ h.elapsedMs < 1000 ? h.elapsedMs.toFixed(h.elapsedMs < 10 ? 1 : 0) + ' ms' : (h.elapsedMs / 1000).toFixed(2) + ' s' }}</td>
              <td>
                <span class="pill" :class="h.passPallets === h.pallets && h.loadOk !== false ? 'ok' : 'bad'">{{ h.passPallets === h.pallets && h.loadOk !== false ? '达标' : '有未达标项' }}</span>
              </td>
              <td class="r ops">
                <button v-if="h.gen" class="btn sm" :disabled="state.planning" @click="replay(h)"><Icon name="refresh" :size="13" />复现</button>
                <button class="btn sm icon danger" data-tip="删除" @click="deleteHistory(h.id)"><Icon name="trash" :size="14" /></button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty"><Icon name="history" :size="34" />暂无运行记录</div>
      </div>
    </section>

    <!-- 接口管理 -->
    <section v-else-if="state.dataTab === 'api'" class="main api">
      <div class="col">
        <div v-for="s in systems" :key="s.k" class="sys glass">
          <div class="sh">
            <span class="si"><Icon :name="s.icon" :size="18" /></span>
            <div><b>{{ s.n }}</b><span>{{ s.d }}</span></div>
            <span class="pill ok live"><i />仿真桩已连接</span>
          </div>
          <button v-for="e in endpoints.filter((x) => x.sys === s.k)" :key="e.id" class="ep" :class="{ on: picked === e.id }" @click="picked = e.id">
            <span class="dir" :class="e.dir">{{ e.dir === 'in' ? '接收' : '发送' }}</span>
            <span class="mt num" :class="e.method">{{ e.method }}</span>
            <span class="pa">
              <b>{{ e.name }}</b>
              <code>{{ e.path }}</code>
            </span>
            <Icon name="chevron" :size="14" />
          </button>
        </div>
        <div class="log glass">
          <div class="ph"><Icon name="activity" :size="16" />报文日志<span class="aside">RESTful · JSON · 最近 {{ apiLog.length }} 条</span></div>
          <div class="lg scroll">
            <div v-for="l in apiLog" :key="l.id" class="ll">
              <span class="num dim">{{ time(l.time).slice(-8) }}</span>
              <span class="dir" :class="l.dir">{{ l.dir === 'in' ? '收' : '发' }}</span>
              <code class="ell">{{ l.method }} {{ l.path }}</code>
              <span class="st num">{{ l.status }}</span>
              <span class="nt2 ell">{{ l.note }}</span>
            </div>
            <div v-if="!apiLog.length" class="empty">暂无报文</div>
          </div>
        </div>
      </div>
      <div class="viewer glass">
        <div class="vh">
          <div>
            <b>{{ cur.name }}</b>
            <code><span class="mt num" :class="cur.method">{{ cur.method }}</span>{{ cur.path }}</code>
          </div>
          <div class="acts">
            <span class="badge num">{{ payload.lines }} 行 · {{ payload.kb }} KB</span>
            <button class="btn sm" @click="copyPayload"><Icon name="copy" :size="13" />复制</button>
            <button class="btn sm" @click="download(`${cur.name}.json`, payload.text)"><Icon name="download" :size="13" />下载</button>
          </div>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <pre class="code scroll" v-html="highlighted" />
      </div>
    </section>

    <!-- 配置 -->
    <section v-else class="main glass set">
      <header>
        <div>
          <h2>可视化配置</h2>
          <p>配置保存在本机，对三维场景即时生效。</p>
        </div>
      </header>
      <div class="sets scroll">
        <div class="sg">
          <h4>渲染分辨率</h4>
          <div class="qs">
            <button v-for="q in qualities" :key="q.v" class="q" :class="{ on: state.settings.quality === q.v }" @click="((state.settings.quality = q.v), saveSettings())">
              <b>{{ q.n }}</b><span>{{ q.d }}</span>
            </button>
          </div>
        </div>
        <div class="sg">
          <h4>播放与显示</h4>
          <label class="sw"><span><b>场景自动旋转</b><em>无人操作时缓慢环绕展示</em></span><button class="switch" :class="{ on: state.settings.autoRotate }" @click="((state.settings.autoRotate = !state.settings.autoRotate), saveSettings())" /></label>
          <label class="sw"><span><b>默认显示码放序号</b><em>在每件货物顶面标出第几件放</em></span><button class="switch" :class="{ on: state.settings.labels }" @click="((state.settings.labels = !state.settings.labels), saveSettings())" /></label>
          <label class="sw">
            <span><b>默认播放速度</b><em>码放与装载动画</em></span>
            <div class="seg"><button v-for="s in [0.5, 1, 2, 4]" :key="s" :class="{ on: state.settings.speed === s }" @click="((state.settings.speed = s), saveSettings())">{{ s }}×</button></div>
          </label>
        </div>
        <div class="sg">
          <h4>任务联动</h4>
          <label class="sw"><span><b>码盘完成后自动生成装载方案</b><em>关闭后两类任务各自独立运行</em></span><button class="switch" :class="{ on: state.settings.autoLoading }" @click="((state.settings.autoLoading = !state.settings.autoLoading), saveSettings())" /></label>
          <div class="kv"><span>码盘并行线程数</span><b class="num">{{ poolSize }}</b></div>
        </div>
        <div class="sg">
          <h4>本地数据</h4>
          <div class="kv"><span>已用存储</span><b class="num">{{ usage }} KB</b></div>
          <button class="btn danger" @click="reset"><Icon name="trash" :size="15" />清除本机数据</button>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.dv {
  position: absolute;
  inset: var(--top) var(--gap) var(--gap);
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  gap: 14px;
  max-width: 1680px;
  margin: 0 auto;
}
.side {
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
.side .ph {
  padding: 0 6px 8px;
}
.nt {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-2);
  text-align: left;
  transition: all 0.16s;
}
.nt:hover {
  background: rgba(255, 255, 255, 0.045);
  color: var(--text);
}
.nt.on {
  color: var(--text);
  border-color: rgba(46, 224, 240, 0.45);
  background: linear-gradient(155deg, rgba(46, 224, 240, 0.14), rgba(91, 140, 255, 0.05));
}
.ni {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex: none;
  background: rgba(255, 255, 255, 0.06);
}
.nt.on .ni {
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
}
.nx {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.35;
}
.nx b {
  font-size: 13.5px;
  font-weight: 650;
}
.nx span {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sum {
  margin-top: auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 12px 0 4px;
  border-top: 1px solid var(--line);
  text-align: center;
}
.sum b {
  display: block;
  font-size: 18px;
}
.sum span {
  font-size: 11px;
  color: var(--text-3);
}
.main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 22px 16px;
}
header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 14px;
  flex: none;
}
h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}
header p {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--text-3);
  max-width: 640px;
  line-height: 1.6;
}
.acts {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.tw {
  flex: 1;
  min-height: 0;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.16);
}
.name {
  min-width: 180px;
}
.name b {
  font-weight: 600;
}
.name input {
  height: 30px;
  width: 100%;
}
.mini {
  width: 24px;
  height: 24px;
  margin-left: 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  vertical-align: -5px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  opacity: 0;
}
tr:hover .mini {
  opacity: 1;
}
.mini:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
}
.dim {
  color: var(--text-3);
}
.ops {
  white-space: nowrap;
}
.ops .btn {
  margin-left: 6px;
  vertical-align: middle;
}
.obj {
  max-width: 260px;
}
.pill.imp {
  color: var(--cog);
  background: rgba(255, 194, 75, 0.12);
}
.pill.kind.joint {
  color: var(--accent);
  background: var(--accent-soft);
}
.pill.kind.pal {
  color: #b5cc8e;
  background: rgba(181, 204, 142, 0.12);
}
.pill.kind.load {
  color: #a5b4fc;
  background: rgba(129, 140, 248, 0.14);
}
.empty span {
  font-size: 12px;
}
/* 接口 */
.api {
  padding: 0;
  display: grid;
  grid-template-columns: minmax(360px, 0.9fr) minmax(0, 1.1fr);
  gap: 14px;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}
.sys {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: none;
}
.sh {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 10px;
}
.si {
  width: 36px;
  height: 36px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  flex: none;
  color: var(--accent);
  background: var(--accent-soft);
}
.sh div {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}
.sh b {
  font-size: 14px;
}
.sh span {
  font-size: 11.5px;
  color: var(--text-3);
}
.live {
  flex: none;
}
.live i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 8px var(--ok);
  margin-right: 2px;
}
.ep {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 11px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.025);
  color: var(--text-2);
  text-align: left;
  transition: all 0.15s;
}
.ep:hover {
  background: rgba(255, 255, 255, 0.055);
}
.ep.on {
  border-color: rgba(46, 224, 240, 0.5);
  background: var(--accent-soft);
  color: var(--text);
}
.dir {
  flex: none;
  height: 20px;
  padding: 0 7px;
  border-radius: 6px;
  display: inline-grid;
  place-items: center;
  font-size: 11px;
  font-weight: 650;
}
.dir.in {
  color: var(--cog);
  background: rgba(255, 194, 75, 0.12);
}
.dir.out {
  color: var(--accent);
  background: var(--accent-soft);
}
.mt {
  flex: none;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #b5cc8e;
  width: 34px;
}
.mt.GET {
  color: #8fb3d9;
}
.pa {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}
.pa b {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
code {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.log {
  flex: 1;
  min-height: 120px;
  padding: 14px;
  display: flex;
  flex-direction: column;
}
.lg {
  flex: 1;
  min-height: 0;
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ll {
  display: grid;
  grid-template-columns: 58px 26px minmax(0, 1.1fr) 30px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 5px 4px;
  font-size: 11.5px;
  border-radius: 7px;
}
.ll:hover {
  background: rgba(255, 255, 255, 0.035);
}
.ll .dir {
  height: 18px;
  padding: 0;
}
.st {
  color: var(--ok);
  font-weight: 600;
}
.nt2 {
  color: var(--text-3);
}
.viewer {
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 16px 6px 10px 18px;
}
.vh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px 12px 0;
  flex: none;
}
.vh > div:first-child {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.5;
}
.vh b {
  font-size: 15px;
}
.vh code .mt {
  display: inline-block;
  margin-right: 4px;
}
.code {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-2);
  white-space: pre;
  tab-size: 2;
}
.code :deep(i) {
  font-style: normal;
}
.code :deep(.k) {
  color: #8fd3ff;
}
.code :deep(.s) {
  color: #c8d69a;
}
.code :deep(.n) {
  color: #ffc24b;
}
.code :deep(.b) {
  color: #d59ab4;
}
/* 配置 */
.sets {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 14px;
  align-content: start;
}
.sg {
  padding: 16px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--text-3);
}
.qs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.q {
  padding: 10px;
  border-radius: 11px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.q b {
  font-size: 13px;
}
.q span {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.4;
}
.q.on {
  border-color: rgba(46, 224, 240, 0.55);
  background: var(--accent-soft);
}
.sw {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.sw > span {
  display: flex;
  flex-direction: column;
  line-height: 1.45;
}
.sw b {
  font-size: 13.5px;
  font-weight: 550;
}
.sw em {
  font-style: normal;
  font-size: 11.5px;
  color: var(--text-3);
}
.kv {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.kv span {
  color: var(--text-3);
}
.sg .btn {
  align-self: flex-start;
}
@media (max-width: 1180px) {
  .dv {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .side {
    flex-direction: row;
    align-items: center;
    padding: 8px;
    overflow-x: auto;
  }
  .side .ph,
  .sum,
  .nx span {
    display: none;
  }
  .nt {
    padding: 6px 12px 6px 6px;
    flex: none;
  }
  .api {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .viewer {
    min-height: 420px;
  }
}
</style>
