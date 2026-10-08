<script setup lang="ts">
import { state } from '../store'
import Icon from './Icon.vue'

/** 使用帮助：流程说明、快捷键、常见问题 */
const steps = [
  { icon: 'split', t: '出库分盘', d: '选择或导入出库清单（每件货物的尺寸、重量、包装类型和承压上限），系统自动把货物分到若干货盘，并给出每盘的码放结果。单击货盘查看，双击进入该盘。' },
  { icon: 'boxes', t: '单盘码放', d: '逐件播放码放过程，观察重心变化；右侧工具栏可打开承压热力图。"方案对比"看本方案与对照基线、经典算法 DBLF 的差别。' },
  { icon: 'robot', t: '人工引导 / 机械臂', d: '同一份方案的两种落地方式："人工引导"是工位工人看的画面，放好一件踩一下脚踏；"机械臂"把方案变成逐件的取放指令并演示执行，可导出 JSON / CSV。' },
  { icon: 'plane', t: '舱内装载', d: '选择机型构型，系统给出每盘放在哪个货位。可回放装载、投放、卸载过程中的重心变化，也可手动换位看影响。' },
  { icon: 'database', t: '数据中心', d: '管理模拟数据集与导入数据、查看每次算法运行的历史、对外接口的报文与导入导出、可视化配置。' },
]
const keys = [
  ['空格', '播放 / 暂停'],
  ['← / →', '上一件 / 下一件（上一步 / 下一步）'],
  ['Home / End', '回到开始 / 直接看结果'],
  ['M', '展开 / 收起技术指标（单盘码放）'],
  ['空格（机械臂）', '自动运行 / 暂停；→ 单步执行'],
  ['鼠标拖动 / 滚轮', '360° 旋转 / 缩放三维场景'],
]
const faqs = [
  ['为什么有些货物"未放入"？', '当货物尺寸过于零散、无法在约束内码成合格垛形时，系统不会硬塞，而是列入人工处理清单。'],
  ['指标是怎么判定的？', '方案生成后由独立的评估器按技术要求表 2-2 和货物承压要求逐项核算，与生成方案的算法不共用代码。'],
  ['货物承压是怎么算的？', '每件货物把"自重 + 顶上的压重"按接触面积传给正下方托住它的货物，从上往下累加，得到每件实际承受的压重，再与它的承压上限比较。压不住时，系统把最顶上的货物转到别的货盘，不会硬压。'],
  ['机械臂换一个型号要改算法吗？', '不用。作业指令只描述"取哪件、放到货盘坐标系的哪个位置、转多少度、从多高平移"，与设备无关；现场标定货盘和取料点两个坐标系即可。界面里的机械臂只是演示模型。'],
  ['"起步阶段"是什么？', '货盘上的货物还不到整盘重量的 20% 时，放下一件较重的货物就会让重心明显偏移，这在物理上无法避免，而此时偏载力矩很小。这几步不计入过程峰值，但曲线和三维里照常显示（容差区变为琥珀色）。'],
  ['数据保存在哪里？', '演示版保存在本机浏览器中；正式版对应服务端数据库，并通过 RESTful 接口与仓储、舱段系统交换。'],
]
</script>

<template>
  <aside class="help glass">
    <header>
      <div class="ph"><Icon name="help" :size="17" />使用帮助</div>
      <button class="btn icon ghost" @click="state.helpOpen = false"><Icon name="x" :size="17" /></button>
    </header>
    <div class="body scroll">
      <h4>作业流程</h4>
      <ol class="steps">
        <li v-for="(s, i) in steps" :key="s.t">
          <span class="si"><Icon :name="s.icon" :size="16" /></span>
          <div><b>{{ i + 1 }}. {{ s.t }}</b><p>{{ s.d }}</p></div>
        </li>
      </ol>
      <h4>快捷操作</h4>
      <div class="keys">
        <div v-for="k in keys" :key="k[0]"><kbd>{{ k[0] }}</kbd><span>{{ k[1] }}</span></div>
      </div>
      <h4>常见问题</h4>
      <div class="faq">
        <details v-for="f in faqs" :key="f[0]">
          <summary>{{ f[0] }}</summary>
          <p>{{ f[1] }}</p>
        </details>
      </div>
      <button class="btn explain" @click="((state.explainOpen = true), (state.helpOpen = false))"><Icon name="book" :size="16" />查看算法原理</button>
      <div class="about num">码盘与装载方案规划系统 V0.3（演示版）<br />适用：智能物资储运模拟验证平台 · 码盘与装载方案规划模块</div>
    </div>
  </aside>
</template>

<style scoped>
.help {
  position: absolute;
  top: var(--top);
  right: var(--gap);
  bottom: var(--gap);
  width: 400px;
  max-width: calc(100vw - 32px);
  z-index: 40;
  display: flex;
  flex-direction: column;
  padding: 16px 8px 16px 18px;
  background: var(--glass-solid);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 8px;
}
.body {
  flex: 1;
  min-height: 0;
  padding-right: 10px;
  margin-top: 6px;
}
h4 {
  margin: 18px 0 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--text-3);
}
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.steps li {
  display: flex;
  gap: 12px;
}
.si {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex: none;
  color: var(--accent);
  background: var(--accent-soft);
}
.steps b {
  font-size: 13.5px;
}
.steps p {
  margin: 2px 0 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-2);
}
.keys {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-2);
}
.keys div {
  display: flex;
  align-items: center;
  gap: 12px;
}
.keys kbd {
  min-width: 96px;
  text-align: center;
}
.faq {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
details {
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  padding: 0 12px;
}
summary {
  padding: 10px 0;
  font-size: 13px;
  cursor: pointer;
}
details p {
  margin: 0 0 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-2);
}
.explain {
  width: 100%;
  margin-top: 18px;
  height: 38px;
}
.about {
  margin: 16px 0 4px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-3);
}
</style>
