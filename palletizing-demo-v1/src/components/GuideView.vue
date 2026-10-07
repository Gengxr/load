<script setup lang="ts">
import { state } from '../store'
import DocShell from './DocShell.vue'
import Icon from './Icon.vue'
import shotPlan from '../assets/guide/plan.webp'
import shotMetrics from '../assets/guide/metrics.webp'
import shotCompare from '../assets/guide/compare.webp'
import shotDblf from '../assets/guide/compare-dblf.webp'
import shotStation from '../assets/guide/station.webp'

/** 使用手册（引导页）：第一次打开时自动显示，之后可从右上角随时打开 */
const chapters = [
  { id: 'start', title: '欢迎 · 三分钟上手', sub: '这个软件做什么、怎么开始' },
  { id: 'ui', title: '界面总览', sub: '主界面上每一块是什么' },
  { id: 'scene', title: '场景与货物', sub: '选场景、导入、调参数' },
  { id: 'play', title: '播放与观察', sub: '播放条、视角、重心卡片' },
  { id: 'metrics', title: '技术指标报告', sub: '六项指标怎么看' },
  { id: 'compare', title: '方案对比', sub: '与对照基线、经典算法并排看' },
  { id: 'station', title: '工位引导', sub: '现场工人看的画面' },
  { id: 'data', title: '导入与导出', sub: '货物清单、方案、截图' },
  { id: 'keys', title: '快捷键', sub: '键盘与鼠标操作' },
  { id: 'faq', title: '常见问题' },
]

function close() {
  try {
    localStorage.setItem('pd.guideSeen', '1')
  } catch {
    /* 本地存储不可用时忽略 */
  }
  state.guideOpen = false
}
function toExplain() {
  close()
  state.explainOpen = true
}
function open(mode: 'plan' | 'compare' | 'station') {
  state.mode = mode
  close()
}

type Pin = [number, number, string, string]
const pinsPlan: Pin[] = [
  [37, 7.2, '流程条', '从"货物生成"到"指标验证"的六个环节，已完成的打勾；"动态码放"的圆环显示播放进度。"多盘分配"为虚线，表示由外部提供（可导入）。'],
  [69.4, 6.4, '模式切换', '三种画面：规划演示（本页）、方案对比、工位引导。'],
  [95.7, 7.4, '手册与原理', '问号打开本手册；书本打开"算法原理"，讲解每一步的算法。'],
  [20.9, 9.4, '场景与货物', '选择或导入一批货物；下方列出每种规格的尺寸、件数、单件重量。'],
  [47.3, 14, '当前货物', '正要放下的这一件：第几件、尺寸、放在第几层、重量、摆放朝向、RFID 尾号。'],
  [57, 33, '三维场景', '左侧辊道按出库顺序送来货物，逐件落到货盘上。虚线框是垛形上限 1000×1000×1200；半透明的框是下一件的落点。'],
  [79.8, 14.3, '指标摘要', '几项指标达标、过程峰值偏心与对照基线（逐层行扫描）的对比。点击（或按 M）展开完整的技术指标报告。'],
  [93.7, 28, '视角与显示', '五种视角；下面四个开关：重心显示、码放序号、自动旋转、截图。'],
  [93.7, 70, '分层查看', '只显示到第几层，方便看清内部每一层的排法；"全"恢复全部。'],
  [20.9, 77.5, '系统重心', '俯视的重心"雷达"：绿色虚线框是 ±10% 允许区，黄点是当前重心，细线是走过的轨迹。'],
  [50, 90.6, '播放条', '播放 / 暂停、逐件前进后退、拖动进度；曲线是每一步的重心偏心率。'],
]
const pinsMetrics: Pin[] = [
  [73.6, 11.4, '六项技术指标', '对应技术要求表 2-2。每格：当前值、进度条、判定线（竖线）和要求；右上角绿点表示达标，红点表示未达标。'],
  [73.6, 55.6, '稳定性检查', '最小支撑率、碰撞 / 越界、层间压缝率——保证垛形站得稳的附加检查。'],
  [73.6, 65.2, '码放过程平衡性', '本方案与对照基线（逐层行扫描）的过程峰值对比，以及每放一件后的偏心率曲线；最下面一行是经典算法 DBLF 的结果，点击可进入整体对比。'],
  [73.6, 97, '分层方案', '向下滚动可见：每层的俯视排布图和利用率；点某一层会在三维场景中高亮；右上角按钮导出方案 JSON。'],
]
const pinsCompare: Pin[] = [
  [28.2, 8.4, '对比方式', '左侧对照对象的切换："只比顺序"用对照基线（逐层行扫描）；"整体对比"用经典算法 DBLF。'],
  [16.2, 17.6, '对照基线', '逐层行扫描：一层码满再码下一层，每层从远到近、从左到右。垛形与右侧完全相同。'],
  [68.2, 17.6, '本方案', '平衡优先的动态顺序。'],
  [28.4, 19.6, '实时读数', '当前偏心、过程峰值（到目前为止偏得最厉害的一次）、偏载力矩。超出允许范围时变红。'],
  [14.9, 43.2, '重心雷达', '黄点是当前重心，线是轨迹。左边的轨迹明显跑出很远，右边始终贴着中心。'],
  [9.4, 69.2, '偏心率曲线', '红线是对照、青线是本方案，红色虚线是 ±10% 的允许线。点击曲线可跳到那一步。'],
  [60.3, 66.8, '对比数字', '过程峰值偏心、平均偏心、峰值偏载力矩、超出 ±10% 的步数——箭头左边是对照，右边是本方案。'],
  [23.4, 94.8, '同步播放', '一个播放条同时控制左右两边，保证比较的是同一步。'],
]
const pinsDblf: Pin[] = [
  [28.2, 8.4, '切到整体对比', '左侧换成经典装箱算法 DBLF：货物放在哪、先放哪件都由它自己决定。'],
  [31, 40, 'DBLF 的垛', '它从最里面开始，一面一面地往外码，所以码放途中重心明显偏向里侧，也不形成平整的层。'],
  [54.8, 67.8, '六项对比', '除了过程重心，还列出码完之后的指标：重心偏离、最低层利用率、表 2-2 达标项数和放不下的件数。'],
]
const pinsStation: Pin[] = [
  [33, 60, '落点引导', '从操作者的视角看货盘。发亮的半透明框就是这一件该放的位置，放下后变为实体。'],
  [66.9, 12, '进度', '当前货盘的完成百分比。'],
  [66.9, 21.5, '第几件', '当前是第几件 / 共几件，右侧小图是这件货的外形比例。'],
  [66.9, 31, 'RFID 尾号', '大字显示 RFID 末 6 位，便于和手里的货核对。'],
  [66.9, 46, '货物信息', '规格（长×宽×高）、重量、放在第几层、长边朝哪个方向。'],
  [66.9, 67, '俯视落位图', '白色虚线框是本件位置，数字是码放序号，下方为操作侧。旁边提示它压在几件货上、放下后重心偏多少。'],
  [66.9, 83, '确认与回退', '放好后按"确认放置"（空格、F9 或脚踏开关）进入下一件；放错了按"回退"；货物破损等情况按"异常上报"。'],
  [66.9, 95.3, '作业统计', '本次作业用时、平均每件节拍、已确认件数。'],
]
</script>

<template>
  <DocShell title="使用手册" sub="单盘动态码放规划 · 演示系统" icon="help" :chapters="chapters" @close="close">
    <template #actions>
      <button class="btn" @click="toExplain"><Icon name="book" :size="15" />算法原理</button>
    </template>

    <!-- ═══════════ 1 欢迎 ═══════════ -->
    <section data-ch="start">
      <div class="hero">
        <div class="eyebrow">智能物资储运模拟验证平台 · 码盘与装载方案规划模块</div>
        <h1>单盘动态码放规划</h1>
        <p class="lead">
          给定一个货盘和一批尺寸、重量各不相同的货物，系统自动算出<b class="c">每一件放在哪里</b>、<b class="c">按什么顺序放</b>，并用三维动画逐件演示。
          码放的每一步，重心都被控制在货盘中心附近。
        </p>
        <div class="cta">
          <button class="btn primary big" @click="close"><Icon name="play" :size="17" />开始使用</button>
          <button class="btn big" @click="toExplain"><Icon name="book" :size="17" />先看算法原理</button>
        </div>
      </div>

      <h3>三种画面，各有用途</h3>
      <div class="cards modes">
        <button class="card mode" @click="open('plan')">
          <span class="mi"><Icon name="cube" :size="20" /></span>
          <h4>规划演示</h4>
          <p>主画面。逐件播放码放过程，实时看重心和各项技术指标。</p>
          <span class="go">打开<Icon name="arrowRight" :size="14" /></span>
        </button>
        <button class="card mode" @click="open('compare')">
          <span class="mi"><Icon name="compare" :size="20" /></span>
          <h4>方案对比</h4>
          <p>同一批货，本方案与对照基线（逐层行扫描）、经典算法 DBLF 并排比较。</p>
          <span class="go">打开<Icon name="arrowRight" :size="14" /></span>
        </button>
        <button class="card mode" @click="open('station')">
          <span class="mi"><Icon name="station" :size="20" /></span>
          <h4>工位引导</h4>
          <p>现场工人看的画面：这一件放哪、朝哪边，放好后确认。</p>
          <span class="go">打开<Icon name="arrowRight" :size="14" /></span>
        </button>
      </div>

      <h3>三分钟走一遍</h3>
      <ol class="steps">
        <li><span class="n">1</span><div><b>选一批货</b><p>打开后系统已经用"标准规格"场景算好了一个方案。想换场景，点左上角"场景与货物"里的四个按钮之一；想换一批同类型的货，点"换一批货物"。</p></div></li>
        <li><span class="n">2</span><div><b>播放码放过程</b><p>按 <kbd>空格</kbd> 或点底部的圆形播放键。货物从辊道逐件落到货盘上；按 <kbd>→</kbd> 一次只放一件，按 <kbd>End</kbd> 直接看码完的结果。</p></div></li>
        <li><span class="n">3</span><div><b>看重心</b><p>左下角"系统重心"卡片里，黄点是当前重心，绿色虚线框是允许范围。整个过程中黄点都应该在框中心附近。</p></div></li>
        <li><span class="n">4</span><div><b>看指标</b><p>按 <kbd>M</kbd> 或点右上角的指标摘要，展开"技术指标自动报告"：六项指标逐项显示数值和是否达标。</p></div></li>
        <li><span class="n">5</span><div><b>和对照方法比一比</b><p>点顶部"方案对比"，按 <kbd>空格</kbd>。左边按逐层行扫描码放，重心会明显跑偏；右边本方案始终居中。左上角还可以切到与经典算法 DBLF 的整体对比。</p></div></li>
        <li><span class="n">6</span><div><b>看现场引导画面</b><p>点顶部"工位引导"，按 <kbd>空格</kbd> 模拟工人逐件确认。</p></div></li>
      </ol>
      <div class="note">
        <span class="tag">提示</span>
        <div>三维画面可以用鼠标<b>拖动旋转</b>、<b>滚轮缩放</b>。本手册随时可以从右上角的问号按钮再次打开；想了解方案是怎么算出来的，点旁边的书本按钮"算法原理"。</div>
      </div>
    </section>

    <!-- ═══════════ 2 界面总览 ═══════════ -->
    <section data-ch="ui">
      <h2><span class="no">2</span>界面总览</h2>
      <p class="lead">主画面（规划演示）以三维场景为中心，四周是悬浮的面板。下图中的编号与图下的说明一一对应。</p>
      <figure class="shot">
        <img :src="shotPlan" alt="规划演示主界面" />
        <span v-for="(p, i) in pinsPlan" :key="i" class="pin" :style="{ left: p[0] + '%', top: p[1] + '%' }">{{ i + 1 }}</span>
      </figure>
      <ol class="legend">
        <li v-for="(p, i) in pinsPlan" :key="i"><span class="n">{{ i + 1 }}</span><div><b>{{ p[2] }}</b>　{{ p[3] }}</div></li>
      </ol>
      <div class="note">
        <span class="tag">说明</span>
        <div>窗口较矮（例如笔记本屏幕）时，"系统重心"卡片会收进左侧面板内部，向下滚动左侧面板即可看到；顶部右侧的两个按钮只显示图标。</div>
      </div>
    </section>

    <!-- ═══════════ 3 场景与货物 ═══════════ -->
    <section data-ch="scene">
      <h2><span class="no">3</span>场景与货物</h2>
      <p class="lead">左上角的"场景与货物"面板决定<b>码哪一批货</b>。可以用内置场景随机生成，也可以导入真实的货物清单。</p>

      <h3>四个内置场景</h3>
      <table class="tb">
        <thead><tr><th>场景</th><th>货物特点</th><th>适合演示什么</th></tr></thead>
        <tbody>
          <tr><td><b>标准规格</b></td><td>5 种模数化纸箱，共 100 件左右</td><td>最贴近仓储实际的常规情况，默认场景</td></tr>
          <tr><td><b>多规格混装</b></td><td>8–10 种规格</td><td>一层里混放不同规格、层与层规格不同</td></tr>
          <tr><td><b>图 2-1 复现</b></td><td>只有一种规格；可在下拉框中选 14 种规格之一和箱高</td><td>与技术要求图 2-1 的堆码方式逐一对照</td></tr>
          <tr><td><b>随机尺寸</b></td><td>每件尺寸都不同</td><td>压力测试：货物很难凑成整层时系统如何处理</td></tr>
        </tbody>
      </table>
      <ul>
        <li><b>换一批货物</b>：保持场景类型不变，换一个随机种子重新生成并规划。面板右上角的 <code>#数字</code> 就是随机种子——同一个种子永远生成同一批货、同一个方案，便于复现。</li>
        <li><b>货物清单</b>：每行一种规格，依次是颜色、长×宽×高（mm）、件数、单件重量范围（kg）。颜色与三维场景中的箱子一致。</li>
        <li><b>未放入提示</b>：如果有货物在约束内实在放不下，面板底部会出现黄色提示并列出货物编号，这些货物交由人工处理。</li>
      </ul>

      <h3>参数设置</h3>
      <p>点面板底部的"参数"打开设置抽屉。修改后点"仅重新规划"（货物不变）或"应用并生成"（按新参数重新生成货物）。</p>
      <table class="tb">
        <thead><tr><th>分组</th><th>参数</th><th>含义</th></tr></thead>
        <tbody>
          <tr><td rowspan="4"><b>货物生成</b></td><td>规格数</td><td>生成几种不同尺寸的货物</td></tr>
          <tr><td>目标装载体积</td><td>这批货物的总体积，越大垛越高、越满</td></tr>
          <tr><td>货物密度</td><td>每立方米多少公斤的范围，决定货物轻重</td></tr>
          <tr><td>随机种子</td><td>填入同一个数字可复现同一批货</td></tr>
          <tr><td rowspan="3"><b>顺序规划</b></td><td>跨层码放</td><td>严格逐层 / 可超前 1 层 / 可超前 2 层：是否允许下层没码完就先码上层来配平</td></tr>
          <tr><td>目标权衡</td><td>滑块向左更看重全程平衡，向右更看重少走动、作业连贯</td></tr>
          <tr><td>束搜索宽度</td><td>排顺序时同时保留多少条候选方案；越大结果越好、计算越慢，默认 96</td></tr>
          <tr><td rowspan="4"><b>约束条件</b></td><td>偏移基准</td><td>重心偏移按货盘边长 1219 还是垛形边长 1000 折算成百分比</td></tr>
          <tr><td>底面支撑率下限</td><td>每件货物底面至少多大比例要被下方托住，默认 80%</td></tr>
          <tr><td>货盘自重</td><td>计算重心时计入的货盘重量，默认 20 kg</td></tr>
          <tr><td>允许侧放</td><td>勾选后货物可以改变竖直方向（把侧面朝下）</td></tr>
        </tbody>
      </table>
      <div class="note">
        <span class="tag">说明</span>
        <div>垛形上限、重心高度、利用率、外扩 5% 等来自技术要求表 2-2 的约束在抽屉中只读显示，不能在界面上放宽。</div>
      </div>
    </section>

    <!-- ═══════════ 4 播放与观察 ═══════════ -->
    <section data-ch="play">
      <h2><span class="no">4</span>播放与观察</h2>
      <h3>播放条</h3>
      <table class="tb">
        <thead><tr><th>控件</th><th>作用</th></tr></thead>
        <tbody>
          <tr><td><b>⏮ ◀ ▶ ▶| ⏭</b></td><td>回到开始、上一件、播放 / 暂停、下一件、直接看结果</td></tr>
          <tr><td><b>进度曲线</b></td><td>横轴是第几件，曲线是放完这一件后的重心偏心率；红色虚线是 ±10% 的允许线；细竖线标出每一层码完的位置。可以点击或拖动跳到任意一步</td></tr>
          <tr><td><b>本方案 / 逐层行扫描</b></td><td>切换用哪一种码放顺序播放。最终垛形相同，只是先后不同；逐层行扫描是对照基线</td></tr>
          <tr><td><b>0.5× ~ 8×</b></td><td>播放速度</td></tr>
        </tbody>
      </table>

      <h3>视角与显示（右侧工具栏）</h3>
      <ul>
        <li><b>等轴 / 正视 / 侧视 / 俯视 / 工位</b>：五种预设视角。任何时候都可以用鼠标拖动旋转、滚轮缩放。</li>
        <li><b>重心显示</b>：开关三维场景里的重心球、铅垂线和左下角的重心卡片。</li>
        <li><b>码放序号</b>：在每个箱子顶面标出它是第几件放的。</li>
        <li><b>自动旋转</b>：场景缓慢环绕，适合无人操作时展示。</li>
        <li><b>截图</b>：把当前三维画面保存为 PNG 图片。</li>
        <li><b>分层查看</b>：点数字只显示到那一层，可以看清被上层盖住的内部排布。</li>
        <li><b>悬停查看</b>：鼠标停在任意箱子上，会显示它的编号、第几件放、尺寸和重量。</li>
      </ul>

      <h3>读懂"系统重心"卡片</h3>
      <div class="cards">
        <div class="card"><h4>雷达图</h4><p>从正上方看货盘。<b class="g">绿色虚线框</b>是 ±10% 的允许区；<b style="color: var(--cog)">黄点</b>是"货物 + 货盘"此刻的重心；细线是到目前为止的轨迹。上方为远离操作者的一侧，下方为操作侧。</p></div>
        <div class="card"><h4>当前偏心</h4><p>大号数字：重心离货盘中心的距离 ÷ 货盘边长，长、宽两个方向取较大者。绿色表示在允许范围内，红色表示超出。</p></div>
        <div class="card"><h4>X / Y、过程峰值</h4><p>X / Y 是左右、前后两个方向各自的偏移；过程峰值是从第一件到现在偏得最厉害的一次。</p></div>
        <div class="card"><h4>重心高度、当前总重</h4><p>重心高度是重心离货盘底面的高度占当前总高的比例（要求 ≤ 60%）；总重包含货盘自重。</p></div>
      </div>
    </section>

    <!-- ═══════════ 5 技术指标报告 ═══════════ -->
    <section data-ch="metrics">
      <h2><span class="no">5</span>技术指标报告</h2>
      <p class="lead">按 <kbd>M</kbd> 或点右上角的指标摘要展开。报告由系统自动计算，对应技术要求表 2-2 中"软件系统自动报告该数据"的验收方式。</p>
      <figure class="shot">
        <img :src="shotMetrics" alt="技术指标报告" />
        <span v-for="(p, i) in pinsMetrics" :key="i" class="pin" :style="{ left: p[0] + '%', top: p[1] + '%' }">{{ i + 1 }}</span>
      </figure>
      <ol class="legend">
        <li v-for="(p, i) in pinsMetrics" :key="i"><span class="n">{{ i + 1 }}</span><div><b>{{ p[2] }}</b>　{{ p[3] }}</div></li>
      </ol>
      <h3>六项指标的含义</h3>
      <table class="tb">
        <thead><tr><th>指标</th><th>要求</th><th>通俗解释</th></tr></thead>
        <tbody>
          <tr><td><b>整托重心高度</b></td><td class="nw">≤ 总高的 60%</td><td>重心越低越不容易倒。总高 = 货物高度 + 货盘高度 75 mm</td></tr>
          <tr><td><b>重心偏离中心</b></td><td class="nw">≤ ±10%</td><td>码完后重心在水平方向离货盘正中有多远，按货盘边长的百分比计</td></tr>
          <tr><td><b>货盘利用率</b></td><td class="nw">≥ 80%</td><td>每一层货物占垛形承载面（1000×1000）的比例；逐层看，最顶上的零头层不计</td></tr>
          <tr><td><b>垛形外边界</b></td><td class="nw">≤ 1000×1000×1200</td><td>整垛的长、宽、高不超过规定尺寸（高度不含货盘）</td></tr>
          <tr><td><b>码盘垛形误差</b></td><td class="nw">≤ 5%</td><td>上一层的外边缘伸出下一层的比例，保证垛形是规整的立方体</td></tr>
          <tr><td><b>方案生成用时</b></td><td class="nw">≤ 120 秒 / 垛</td><td>从拿到货物清单到算出位置和顺序所花的时间</td></tr>
        </tbody>
      </table>
      <div class="note">
        <span class="tag">想知道怎么算的</span>
        <div>每项指标的计算方法、以及当前方案的具体数值，见<a @click="toExplain">算法原理 → 重心与指标</a>。</div>
      </div>
    </section>

    <!-- ═══════════ 6 方案对比 ═══════════ -->
    <section data-ch="compare">
      <h2><span class="no">6</span>方案对比</h2>
      <p class="lead">点顶部"方案对比"进入。右侧始终是<b class="c">本方案</b>，左侧是对照对象；左上角可以在两种对比方式之间切换。</p>
      <table class="tb">
        <thead><tr><th>对比方式</th><th>左侧是什么</th><th>用来说明什么</th></tr></thead>
        <tbody>
          <tr>
            <td class="nw"><b>只比顺序</b><em>对照基线 · 逐层行扫描</em></td>
            <td>和右侧<b>同一个垛形</b>，但按"一层码满再码下一层，每层由远到近、从左到右"的顺序码放</td>
            <td>垛形相同，差别只来自先后——顺序规划本身带来多大改善</td>
          </tr>
          <tr>
            <td class="nw"><b>整体对比</b><em>经典算法 · DBLF</em></td>
            <td>三维装箱文献中常用的对照算法 DBLF（最深-最低-最左填充），<b>位置和顺序都由它自己生成</b></td>
            <td>和公认的经典算法比——直接套用装箱算法能不能满足码盘要求</td>
          </tr>
        </tbody>
      </table>
      <div class="note">
        <span class="tag">说明</span>
        <div>
          "逐层行扫描"反映常见的人工习惯，是本系统自定义的对照基线，<b>不是某项标准</b>；码放顺序和过程重心目前没有查到公认的行业标准或公开基准。
          DBLF 的出处、放置规则和用于货盘时的约定见<a @click="toExplain">算法原理 → 码放顺序 → 3.5</a>。
        </div>
      </div>

      <h3>只比顺序：对照基线（逐层行扫描）</h3>
      <figure class="shot">
        <img :src="shotCompare" alt="方案对比 · 只比顺序" />
        <span v-for="(p, i) in pinsCompare" :key="i" class="pin" :style="{ left: p[0] + '%', top: p[1] + '%' }">{{ i + 1 }}</span>
      </figure>
      <ol class="legend">
        <li v-for="(p, i) in pinsCompare" :key="i"><span class="n">{{ i + 1 }}</span><div><b>{{ p[2] }}</b>　{{ p[3] }}</div></li>
      </ol>
      <div class="note eg">
        <span class="tag">怎么看</span>
        <div>按 <kbd>空格</kbd> 播放，盯住两个雷达图里的黄点：左边每码一层，重心都会先被拉向先放的那一侧，再慢慢回来；本方案一侧放了重货，很快就在对侧补一件，黄点几乎不动。</div>
      </div>

      <h3>整体对比：经典算法 DBLF</h3>
      <figure class="shot">
        <img :src="shotDblf" alt="方案对比 · 整体对比" />
        <span v-for="(p, i) in pinsDblf" :key="i" class="pin" :style="{ left: p[0] + '%', top: p[1] + '%' }">{{ i + 1 }}</span>
      </figure>
      <ol class="legend">
        <li v-for="(p, i) in pinsDblf" :key="i"><span class="n">{{ i + 1 }}</span><div><b>{{ p[2] }}</b>　{{ p[3] }}</div></li>
      </ol>
      <div class="note eg">
        <span class="tag">怎么看</span>
        <div>DBLF 是为集装箱设计的，目标是把空间装满，不考虑重心和分层。它在货盘上的表现说明：码盘需要专门处理重心、分层和顺序，直接套用经典装箱算法是不够的。两边受同样的垛形和支撑约束，用同一个评估器核算。</div>
      </div>
    </section>

    <!-- ═══════════ 7 工位引导 ═══════════ -->
    <section data-ch="station">
      <h2><span class="no">7</span>工位引导</h2>
      <p class="lead">点顶部"工位引导"进入。这是码盘工位上工人看到的画面：系统按规划好的顺序，一件一件告诉工人<b>拿哪件、放哪里、朝哪边</b>，工人放好后确认，再出下一件。</p>
      <figure class="shot">
        <img :src="shotStation" alt="工位引导" />
        <span v-for="(p, i) in pinsStation" :key="i" class="pin" :style="{ left: p[0] + '%', top: p[1] + '%' }">{{ i + 1 }}</span>
      </figure>
      <ol class="legend">
        <li v-for="(p, i) in pinsStation" :key="i"><span class="n">{{ i + 1 }}</span><div><b>{{ p[2] }}</b>　{{ p[3] }}</div></li>
      </ol>
      <div class="note">
        <span class="tag">说明</span>
        <div>演示中用键盘模拟现场的确认输入设备（脚踏开关或按钮）。货物的出库顺序与这里的码放顺序一致，仓储系统按此顺序出库。</div>
      </div>
    </section>

    <!-- ═══════════ 8 导入与导出 ═══════════ -->
    <section data-ch="data">
      <h2><span class="no">8</span>导入与导出</h2>
      <table class="tb">
        <thead><tr><th>操作</th><th>位置</th><th>说明</th></tr></thead>
        <tbody>
          <tr><td><b>导入货物清单</b></td><td>左侧面板"导入多盘分配结果（JSON）"</td><td>导入仓储系统或多盘分配给出的货物清单。文件里有多个货盘时，会出现下拉框选择其中一盘</td></tr>
          <tr><td><b>导出货物集合</b></td><td>左侧面板底部的下载图标</td><td>把当前这批货物保存为 JSON，可再次导入</td></tr>
          <tr><td><b>导出码盘方案</b></td><td>技术指标面板 →"分层方案"右上角的下载图标</td><td>每件货物的位置、朝向、层号、码放序号、出库顺序和各项指标</td></tr>
          <tr><td><b>截图</b></td><td>右侧工具栏的相机图标</td><td>当前三维画面保存为 PNG</td></tr>
        </tbody>
      </table>
      <h3>货物清单的格式</h3>
      <div class="cols2">
        <pre>{
  "pallets": [
    { "palletNo": 1,
      "cargos": [
        { "id": "C0001",
          "rfid": "E2000017221101441890",
          "length": 400, "width": 300,
          "height": 200, "weight": 8.5 }
      ] }
  ]
}</pre>
        <div>
          <ul>
            <li>长度单位 <b>mm</b>，重量单位 <b>kg</b>。</li>
            <li><code>length / width / height / weight</code> 必填；<code>id</code>、<code>rfid</code>、<code>sku</code> 可省略，系统会自动补全。</li>
            <li>也接受更简单的写法：<code>{ "cargos": [...] }</code>，或直接是货物数组 <code>[...]</code>。</li>
            <li>尺寸应在 120×100×100 ~ 600×400×300 mm 范围内；超出垛形尺寸的货物会被列入人工处理清单。</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- ═══════════ 9 快捷键 ═══════════ -->
    <section data-ch="keys">
      <h2><span class="no">9</span>快捷键</h2>
      <table class="tb keys">
        <thead><tr><th>按键</th><th>规划演示 / 方案对比</th><th>工位引导</th></tr></thead>
        <tbody>
          <tr><td><kbd>空格</kbd></td><td>播放 / 暂停</td><td>确认放置（也可用 <kbd>Enter</kbd>、<kbd>F9</kbd>）</td></tr>
          <tr><td><kbd>→</kbd></td><td>放下一件</td><td>—</td></tr>
          <tr><td><kbd>←</kbd></td><td>退回上一件</td><td>回退一件（也可用 <kbd>Backspace</kbd>、<kbd>F10</kbd>）</td></tr>
          <tr><td><kbd>Home</kbd> / <kbd>End</kbd></td><td>回到开始 / 直接看结果</td><td>—</td></tr>
          <tr><td><kbd>M</kbd></td><td>展开 / 收起技术指标报告（规划演示）</td><td>—</td></tr>
          <tr><td><kbd>E</kbd></td><td>—</td><td>异常上报</td></tr>
          <tr><td><kbd>Esc</kbd></td><td colspan="2">关闭使用手册 / 算法原理</td></tr>
          <tr><td>鼠标拖动 / 滚轮</td><td colspan="2">旋转 / 缩放三维场景</td></tr>
        </tbody>
      </table>
    </section>

    <!-- ═══════════ 10 常见问题 ═══════════ -->
    <section data-ch="faq">
      <h2><span class="no">10</span>常见问题</h2>
      <div class="faq">
        <details open>
          <summary>为什么有些货物显示"未放入"？</summary>
          <p>当货物尺寸过于零散，在垛形尺寸、支撑率等约束内实在放不下时，系统不会硬塞，而是把它们列入人工处理清单。常见于"随机尺寸"场景。</p>
        </details>
        <details>
          <summary>"随机尺寸"场景下利用率显示未达标，是算法有问题吗？</summary>
          <p>不是。每件货物尺寸都不同时，很难凑出占满 80% 面积的平整层，这是货物本身决定的。系统如实报告，不会为了好看而隐藏；重心和稳定性指标不受影响。</p>
        </details>
        <details>
          <summary>对比用的"逐层行扫描"和"DBLF"是什么？是行业标准吗？</summary>
          <p>
            "逐层行扫描"是最常见的人工码垛习惯（一层码满再码下一层，每层从远到近、从左到右），是本系统自定义的对照基线，不是标准。
            "DBLF"是三维装箱文献中常用的经典算法，用作公认的对照。码放顺序和过程重心目前没有查到公认的行业标准，所以这两项对比都明确标注了对照对象。
          </p>
        </details>
        <details>
          <summary>每次打开结果都一样吗？</summary>
          <p>一样。货物由随机种子决定，算法本身不含随机因素，同一批货物永远得到同一个方案。点"换一批货物"才会换种子。</p>
        </details>
        <details>
          <summary>重心是实测的吗？</summary>
          <p>界面上的重心是按每件货物的重量和位置计算出来的（假设每件货物的重心在它的几何中心）。实际验收时用货盘下方的三点称重装置实测核验。</p>
        </details>
        <details>
          <summary>不联网能用吗？</summary>
          <p>可以。整个系统是一个 HTML 文件，双击即可在 Chrome 或 Edge 中打开，不依赖网络和服务器。</p>
        </details>
        <details>
          <summary>画面不流畅怎么办？</summary>
          <p>关闭"自动旋转"和"码放序号"，或把浏览器窗口缩小一些；确认浏览器已开启硬件加速。</p>
        </details>
      </div>
      <div class="end">
        <button class="btn primary big" @click="close"><Icon name="play" :size="17" />开始使用</button>
        <button class="btn big" @click="toExplain"><Icon name="book" :size="17" />查看算法原理</button>
      </div>
    </section>
  </DocShell>
</template>

<style scoped>
.hero {
  padding: 14px 0 6px;
}
.hero h1 {
  margin: 12px 0 0;
  font-size: 40px;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: 0.02em;
  background: linear-gradient(120deg, #f4fbff 20%, #8fe9ff 60%, #8aa8ff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero .lead {
  max-width: 780px;
  margin-top: 14px;
  font-size: 16px;
}
.cta,
.end {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
.end {
  margin-top: 26px;
}
.btn.big {
  height: 44px;
  padding: 0 22px;
  border-radius: 13px;
  font-size: 14.5px;
}
.modes {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.mode {
  position: relative;
  text-align: left;
  color: inherit;
  transition:
    border-color 0.18s,
    background 0.18s,
    transform 0.12s;
}
.mode:hover {
  border-color: rgba(46, 224, 240, 0.5);
  background: rgba(46, 224, 240, 0.06);
}
.mi {
  width: 40px;
  height: 40px;
  margin-bottom: 10px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
}
.mode .go {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
}
.steps {
  list-style: none;
  margin: 12px 0 16px;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 26px;
}
.steps li {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 12px;
  margin: 0;
}
.steps .n {
  width: 28px;
  height: 28px;
  margin-top: 1px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 13.5px;
  font-weight: 750;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid rgba(46, 224, 240, 0.3);
}
.steps b {
  font-size: 14.5px;
}
.steps p {
  margin: 2px 0 0;
  font-size: 13.5px;
  line-height: 1.75;
}
.nw {
  white-space: nowrap;
}
.keys td:first-child {
  white-space: nowrap;
}
.cols2 {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 20px;
  align-items: start;
}
code {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--accent);
}
a {
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.faq {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}
details {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  padding: 0 16px;
}
summary {
  padding: 12px 0;
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}
details p {
  margin: 0 0 14px;
}
@media (max-width: 1100px) {
  .steps,
  .cols2,
  .modes {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
