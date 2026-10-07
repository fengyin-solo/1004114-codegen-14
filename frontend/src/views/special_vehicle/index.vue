<template>
  <section class="page" data-module="special_vehicle">
    <header class="page-head">
      <div>
        <h2>特种车辆管理</h2>
        <p class="page-desc">维护特种车辆，围绕车辆编号、车辆类型、品牌型号、载重吨位做登记、筛选与状态流转，维保视图按时间排列维保信息。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记特种车辆</button>
        <button class="btn" type="button" @click="exportRows">导出特种车辆清单</button>
      </div>
    </header>

    <div class="view-switch">
      <button
        :class="['switch-item', { active: view === 'maintenance' }]"
        type="button"
        @click="view = 'maintenance'"
      >
        维保视图
      </button>
      <button
        :class="['switch-item', { active: view === 'ledger' }]"
        type="button"
        @click="view = 'ledger'"
      >
        车辆台账
      </button>
    </div>

    <template v-if="view === 'maintenance'">
      <div class="tab-row">
        <button
          v-for="tab in maintenanceTabs"
          :key="tab.status"
          :class="['tab-item', { active: activeTab === tab.status }]"
          type="button"
          @click="activeTab = tab.status"
        >
          {{ tab.label }}（{{ tabCount(tab.status) }}）
        </button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in maintenanceColumns" :key="column">{{ column }}</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in maintenanceRows" :key="String(row.id)">
            <td v-for="column in maintenanceColumns" :key="column">{{ row[column] ?? '—' }}</td>
            <td class="row-actions">
              <template v-if="row.status === '待命'">
                <button class="link" type="button" @click="runAction('安排维保', row)">提交维保</button>
                <button class="link" type="button" @click="runAction('调度出车', row)">调度出车</button>
              </template>
              <button
                v-else-if="row.status === '维保中'"
                class="link"
                type="button"
                @click="runAction('完成维保', row)"
              >
                完成维保
              </button>
              <span v-else-if="row.status === '出车中'" class="muted">出车锁定中</span>
            </td>
          </tr>
          <tr v-if="!maintenanceRows.length">
            <td :colspan="maintenanceColumns.length + 1" class="empty-state">
              当前状态下暂无特种车辆
            </td>
          </tr>
        </tbody>
      </table>
      <p class="view-note">
        按上次维保时间排列，最久未维保的排在前面；维保与出车冲突时以先锁定车辆为准，同一车辆并发提交维保只保留首个结果。
      </p>

      <h3 class="section-title">历史维保记录</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>车辆编号</th>
            <th>维保日期</th>
            <th>当时周期</th>
            <th>登记时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in historyRows" :key="String(record.id)">
            <td>{{ record['车辆编号'] }}</td>
            <td>{{ record['维保日期'] }}</td>
            <td>{{ record['当时周期'] }}</td>
            <td>{{ record['登记时间'] }}</td>
          </tr>
          <tr v-if="!historyRows.length">
            <td colspan="4" class="empty-state">暂无历史维保记录</td>
          </tr>
        </tbody>
      </table>
      <p class="view-note">历史维保仍按当时周期归档，车辆当前维保周期调整不回改历史记录。</p>

      <footer class="page-foot">
        <span>共 {{ maintenanceAll.length }} 辆特种车辆纳入维保视图</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <template v-else>
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
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
            <td :colspan="columns.length + 2" class="empty-state">暂无特种车辆数据，可先登记特种车辆</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条特种车辆记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listMaintenanceHistory,
  listMaintenanceVehicles,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('special_vehicle')
const columns = ["车辆编号", "车辆类型", "品牌型号", "载重吨位", "购入日期", "维保周期", "上次维保", "车辆状态"]
const actions = ["调度出车", "安排维保", "完成维保", "停用车辆"]
const statuses = ["待命", "出车中", "维保中", "已停用"]
const stats = [{"label": "待命车辆", "value": 0}, {"label": "出车中车辆", "value": 0}, {"label": "维保中车辆", "value": 0}]

// 维保视图：维修中、待命、出车中分别呈现并可切换，「维修中」对应车辆状态「维保中」。
const maintenanceColumns = ["车辆编号", "车辆类型", "品牌型号", "载重吨位", "维保周期", "上次维保", "车辆状态"]
const maintenanceTabs = [
  { label: '维修中', status: '维保中' },
  { label: '待命', status: '待命' },
  { label: '出车中', status: '出车中' },
]

const view = ref<'maintenance' | 'ledger'>('maintenance')
const activeTab = ref('维保中')
const maintenanceAll = ref<EntryRow[]>([])
const historyRows = ref<EntryRow[]>([])

const rows = ref<EntryRow[]>([])
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

const maintenanceRows = computed(() =>
  maintenanceAll.value.filter((row) => String(row.status) === activeTab.value),
)

function tabCount(status: string): number {
  return maintenanceAll.value.filter((row) => String(row.status) === status).length
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '特种车辆登记入口尚未接入审批流'
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
    maintenanceAll.value = listMaintenanceVehicles()
    historyRows.value = listMaintenanceHistory()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '特种车辆列表读取失败'
  }
}

onMounted(reload)
</script>
