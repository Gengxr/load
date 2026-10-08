<script setup lang="ts">
import { computed, ref } from 'vue'
import { login } from '../store'
import { SKU_COLORS } from '../viz/palette'
import Icon from '../components/Icon.vue'

/** 登录页（演示版在本机校验；正式版对接统一认证与权限） */
const account = ref('admin')
const password = ref('demo2026')
const err = ref('')
const busy = ref(false)

function submit() {
  if (!account.value.trim() || !password.value) {
    err.value = '请输入账号和密码'
    return
  }
  busy.value = true
  setTimeout(() => login(account.value.trim()), 420)
}

// 等轴测货垛插画
const U = 34
const iso = (x: number, y: number, z: number) => [(x - y) * U * 0.866, (x + y) * U * 0.5 - z * U * 0.82]
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(Math.max(0, Math.min(255, v * k))))
  return `rgb(${c.join(',')})`
}
const cubes = computed(() => {
  const out: { top: string; left: string; right: string; c: string; d: number; delay: number }[] = []
  const hgt = [
    [4, 4, 4, 3],
    [4, 4, 3, 3],
    [4, 3, 3, 2],
    [3, 3, 2, 1],
  ]
  for (let x = 0; x < 4; x++)
    for (let y = 0; y < 4; y++)
      for (let z = 0; z < hgt[x][y]; z++) {
        const p = (a: number, b: number, c: number) => iso(x + a, y + b, z + c).map((v) => v.toFixed(1)).join(',')
        out.push({
          top: [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)].join(' '),
          left: [p(0, 1, 1), p(1, 1, 1), p(1, 1, 0), p(0, 1, 0)].join(' '),
          right: [p(1, 0, 1), p(1, 1, 1), p(1, 1, 0), p(1, 0, 0)].join(' '),
          c: SKU_COLORS[(z * 3 + ((x + y) % 2)) % 6],
          d: x + y + z * 0.01,
          delay: z * 0.16 + (x + y) * 0.03,
        })
      }
  return out.sort((a, b) => a.d - b.d)
})
const features = [
  { icon: 'split', t: '多盘分配', d: '出库清单自动分盘，各盘高度、重量均衡' },
  { icon: 'boxes', t: '单盘码放', d: '兼顾空间利用、重心平衡与货物承压' },
  { icon: 'plane', t: '舱内装载', d: '货位配平，全过程不出飞机重心包线' },
  { icon: 'robot', t: '两种落地方式', d: '同一份方案：人工引导，或机械臂直接执行' },
]
</script>

<template>
  <div class="login">
    <div class="bg" />
    <section class="hero">
      <div class="brand">
        <div class="logo">
          <svg viewBox="0 0 32 32" width="26" height="26">
            <defs>
              <linearGradient id="llg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#3ef0ff" />
                <stop offset="1" stop-color="#5b8cff" />
              </linearGradient>
            </defs>
            <path d="M16 3 27 9v13L16 28 5 22V9z" fill="none" stroke="url(#llg)" stroke-width="2.2" stroke-linejoin="round" />
            <path d="M5 9l11 6 11-6M16 15v13" fill="none" stroke="url(#llg)" stroke-width="2.2" stroke-linejoin="round" />
            <circle cx="16" cy="15" r="2.6" fill="#ffc24b" />
          </svg>
        </div>
        <span>智能物资储运模拟验证平台</span>
      </div>
      <h1>码盘与装载<br />方案规划系统</h1>
      <p class="sub">从出库清单到整托装机：自动分盘、逐件码放、舱内配平，全过程三维可视。</p>
      <ul class="feat">
        <li v-for="f in features" :key="f.t">
          <span class="fi"><Icon :name="f.icon" :size="18" /></span>
          <div><b>{{ f.t }}</b><span>{{ f.d }}</span></div>
        </li>
      </ul>
    </section>

    <section class="side">
      <svg class="art" viewBox="-150 -150 300 250" aria-hidden="true">
        <ellipse cx="0" cy="72" rx="150" ry="26" fill="rgba(46,224,240,0.10)" />
        <polygon :points="[iso(-0.3, -0.3, 0), iso(4.3, -0.3, 0), iso(4.3, 4.3, 0), iso(-0.3, 4.3, 0)].map((p) => p.join(',')).join(' ')" fill="#8a94a3" stroke="#aeb7c4" stroke-width="1" />
        <g v-for="(c, i) in cubes" :key="i" class="cube" :style="{ animationDelay: c.delay + 's' }">
          <polygon :points="c.top" :fill="shade(c.c, 1.06)" />
          <polygon :points="c.left" :fill="shade(c.c, 0.78)" />
          <polygon :points="c.right" :fill="shade(c.c, 0.6)" />
          <polygon :points="c.top" fill="none" stroke="rgba(10,16,26,0.45)" stroke-width="0.8" />
          <polygon :points="c.left" fill="none" stroke="rgba(10,16,26,0.45)" stroke-width="0.8" />
          <polygon :points="c.right" fill="none" stroke="rgba(10,16,26,0.45)" stroke-width="0.8" />
        </g>
      </svg>
      <form class="card glass" @submit.prevent="submit">
        <h2>登录</h2>
        <p class="tip">使用平台账号登录后开始规划作业</p>
        <label>
          <span>账号</span>
          <div class="inp"><Icon name="user" :size="16" /><input v-model="account" type="text" autocomplete="username" placeholder="请输入账号" /></div>
        </label>
        <label>
          <span>密码</span>
          <div class="inp"><Icon name="lock" :size="16" /><input v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" /></div>
        </label>
        <div v-if="err" class="err">{{ err }}</div>
        <button class="btn primary go" type="submit" :disabled="busy">
          <template v-if="busy">正在进入…</template>
          <template v-else>登录<Icon name="arrowRight" :size="16" /></template>
        </button>
        <p class="foot">演示环境已预填体验账号，直接点击登录即可</p>
      </form>
      <div class="ver num">V0.3 演示版 · 2026</div>
    </section>
  </div>
</template>

<style scoped>
.login {
  position: fixed;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(380px, 0.85fr);
  align-items: center;
  gap: 40px;
  padding: 0 clamp(32px, 7vw, 120px);
  overflow: hidden;
}
.bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(900px 600px at 18% 30%, rgba(46, 224, 240, 0.13), transparent 60%),
    radial-gradient(900px 700px at 85% 80%, rgba(91, 140, 255, 0.14), transparent 60%),
    linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px) 0 0 / 56px 56px,
    linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px) 0 0 / 56px 56px;
  mask-image: radial-gradient(ellipse at center, #000 40%, transparent 92%);
}
.hero,
.side {
  position: relative;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: var(--text-2);
  letter-spacing: 0.06em;
}
.logo {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, rgba(46, 224, 240, 0.16), rgba(91, 140, 255, 0.08));
  border: 1px solid rgba(46, 224, 240, 0.3);
  box-shadow: 0 0 30px rgba(46, 224, 240, 0.2);
}
h1 {
  margin: 30px 0 18px;
  font-size: clamp(38px, 4.6vw, 64px);
  line-height: 1.14;
  font-weight: 800;
  letter-spacing: 0.02em;
  background: linear-gradient(120deg, #f4fbff 20%, #8fe9ff 60%, #8aa8ff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.sub {
  max-width: 520px;
  margin: 0;
  font-size: 16px;
  line-height: 1.8;
  color: var(--text-2);
}
.feat {
  list-style: none;
  padding: 0;
  margin: 36px 0 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.feat li {
  display: flex;
  align-items: center;
  gap: 14px;
}
.fi {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid rgba(46, 224, 240, 0.2);
  flex: none;
}
.feat b {
  display: block;
  font-size: 14.5px;
}
.feat span {
  font-size: 13px;
  color: var(--text-3);
}
.side {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.art {
  width: min(300px, 30vh);
  margin-bottom: 6px;
  filter: drop-shadow(0 20px 30px rgba(0, 0, 0, 0.45));
}
.cube {
  animation: drop 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes drop {
  from {
    opacity: 0;
    transform: translateY(-26px);
  }
}
.card {
  width: 100%;
  max-width: 400px;
  padding: 28px 28px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: relative;
}
h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}
.tip {
  margin: -8px 0 4px;
  font-size: 13px;
  color: var(--text-3);
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-2);
}
.inp {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--line-2);
  background: rgba(0, 0, 0, 0.25);
  color: var(--text-3);
  transition: border-color 0.15s;
}
.inp:focus-within {
  border-color: var(--accent);
  color: var(--accent);
}
.inp input {
  flex: 1;
  height: 100%;
  border: none;
  background: transparent;
  padding: 0;
  font-size: 14.5px;
}
.go {
  height: 46px;
  margin-top: 6px;
  border-radius: 12px;
  font-size: 15px;
}
.err {
  font-size: 12.5px;
  color: var(--bad);
}
.foot {
  margin: 2px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}
.ver {
  margin-top: 18px;
  font-size: 11.5px;
  color: var(--text-3);
  letter-spacing: 0.05em;
}
@media (max-width: 980px) {
  .login {
    grid-template-columns: 1fr;
  }
  .hero {
    display: none;
  }
}
@media (max-height: 720px) {
  .art {
    display: none;
  }
  .feat {
    margin-top: 22px;
    gap: 10px;
  }
  h1 {
    margin: 18px 0 12px;
  }
}
</style>
