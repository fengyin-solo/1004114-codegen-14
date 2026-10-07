<template>
  <section class="page" data-module="load_equip">
    <header class="page-head">
      <div>
        <h2>装卸设备管理</h2>
        <p class="page-desc">维护装卸设备，围绕设备编号、设备类型、适用机型、最大载重做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记装卸设备</button>
        <button class="btn" type="button" @click="exportRows">导出装卸设备清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无装卸设备数据，可先登记装卸设备</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">替班清单（同步特种车辆维保）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>车辆编号</th>
          <th>车辆类型</th>
          <th>替班设备</th>
          <th>设备类型</th>
          <th>开始时间</th>
          <th>结束时间</th>
          <th>清单状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="record in substitutes" :key="String(record.id)">
          <td>{{ record['车辆编号'] }}</td>
          <td>{{ record['车辆类型'] || '—' }}</td>
          <td>{{ record['设备编号'] }}</td>
          <td>{{ record['设备类型'] || '—' }}</td>
          <td>{{ record['开始时间'] }}</td>
          <td>{{ record['结束时间'] || '—' }}</td>
          <td>{{ record.status }}</td>
        </tr>
        <tr v-if="!substitutes.length">
          <td colspan="7" class="empty-state">暂无替班记录，特种车辆安排维保后自动同步到这里</td>
        </tr>
      </tbody>
    </table>
    <p class="view-note">特种车辆锁进维保后自动指派待机设备替班，台账「替班对象」列与本清单同步更新。</p>

    <footer class="page-foot">
      <span>共 {{ total }} 条装卸设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listSubstitutes,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('load_equip')
const columns = ["设备编号", "设备类型", "适用机型", "最大载重", "安装位置", "购入日期", "维保记录", "设备状态", "替班对象"]
const actions = ["启用设备", "安排维保", "申请报修"]
const statuses = ["待机", "运行中", "维保中", "已报修"]
const stats = [{"label": "运行中设备", "value": 0}, {"label": "维保中设备", "value": 0}, {"label": "报修设备", "value": 0}]

const rows = ref<EntryRow[]>([])
const substitutes = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '装卸设备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    substitutes.value = listSubstitutes()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '装卸设备列表读取失败'
  }
}

onMounted(reload)
</script>
