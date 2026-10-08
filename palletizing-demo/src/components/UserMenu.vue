<script setup lang="ts">
import { reactive, ref } from 'vue'
import { logout, saveProfile, state, toast } from '../store'
import Icon from './Icon.vue'

/** 个人信息管理：查看 / 修改姓名与部门，退出登录 */
const editing = ref(false)
const form = reactive({ name: state.user?.name ?? '', dept: state.user?.dept ?? '' })
function save() {
  if (!form.name.trim()) return
  saveProfile({ name: form.name.trim(), dept: form.dept.trim() })
  editing.value = false
  toast('个人信息已保存')
}
const since = () => (state.user ? new Date(state.user.loginAt).toLocaleString('zh-CN', { hour12: false }) : '')
</script>

<template>
  <section v-if="state.user" class="um glass">
    <div class="who">
      <div class="av">{{ state.user.name.slice(0, 1) }}</div>
      <div class="w">
        <b>{{ state.user.name }}</b>
        <span>{{ state.user.role }} · {{ state.user.dept }}</span>
      </div>
    </div>
    <div v-if="!editing" class="info">
      <div><span>账号</span><b class="num">{{ state.user.account }}</b></div>
      <div><span>角色</span><b>{{ state.user.role }}</b></div>
      <div><span>本次登录</span><b class="num">{{ since() }}</b></div>
    </div>
    <form v-else class="edit" @submit.prevent="save">
      <label>姓名<input v-model="form.name" type="text" maxlength="12" /></label>
      <label>部门<input v-model="form.dept" type="text" maxlength="20" /></label>
      <div class="row">
        <button type="button" class="btn sm" @click="editing = false">取消</button>
        <button type="submit" class="btn sm primary">保存</button>
      </div>
    </form>
    <div class="acts">
      <button v-if="!editing" class="item" @click="editing = true"><Icon name="pencil" :size="15" />修改个人信息</button>
      <button class="item" @click="((state.helpOpen = true), (state.userOpen = false))"><Icon name="help" :size="15" />使用帮助</button>
      <button class="item out" @click="logout"><Icon name="logout" :size="15" />退出登录</button>
    </div>
  </section>
</template>

<style scoped>
.um {
  width: 280px;
  padding: 16px;
  background: var(--glass-solid);
}
.who {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
.av {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 17px;
  font-weight: 700;
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
}
.w {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.w b {
  font-size: 15px;
}
.w span {
  font-size: 12px;
  color: var(--text-3);
}
.info {
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12.5px;
}
.info div {
  display: flex;
  justify-content: space-between;
}
.info span {
  color: var(--text-3);
}
.info b {
  font-weight: 550;
}
.edit {
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.edit label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-3);
}
.row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.acts {
  border-top: 1px solid var(--line);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  margin: 0 -4px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  text-align: left;
}
.item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}
.item.out:hover {
  color: var(--bad);
  background: var(--bad-soft);
}
</style>
