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
          <td :colspan="columns.length + 2" class="empty-state">暂无装卸设备数据，可先登记装卸设备</td>
        </tr>
      </tbody>
    </table>

    <section class="standby-block">
      <h3 class="block-title">
        特种车辆替班清单
        <span class="block-sub">与特种车辆维保视图同源同步：维保中车辆需要同型别待命车顶班，先锁定车辆为准</span>
      </h3>

      <div v-if="!standbyRows.length" class="standby-empty">
        当前没有维保中的特种车辆，暂不需要安排替班
      </div>

      <table v-else class="data-table standby-table">
        <thead>
          <tr>
            <th>维保车辆编号</th>
            <th>车辆类型</th>
            <th>品牌型号</th>
            <th>进厂维保时间</th>
            <th>替班车辆</th>
            <th>替班操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in standbyRows" :key="item.record.id">
            <td>{{ item.record.vehicleNo }}</td>
            <td>{{ item.record.vehicleType }}</td>
            <td>{{ item.record.vehicleModel || '—' }}</td>
            <td>{{ item.record.startDate }}</td>
            <td>
              <template v-if="item.substitute">
                <span class="state-pill 出车中">{{ item.substitute['车辆编号'] }}</span>
                <span class="cell-sub">已锁定为出车中，维保完成自动归队</span>
              </template>
              <span v-else class="cell-sub">待安排</span>
            </td>
            <td class="row-actions">
              <template v-if="!item.substitute">
                <select
                  :value="''"
                  class="standby-select"
                  :disabled="!item.candidates.length || busyKey === item.record.vehicleId"
                  @change="onPickSubstitute(item.record.vehicleId, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="" disabled>{{ item.candidates.length ? '选择待命车顶班' : '无同型别待命车' }}</option>
                  <option v-for="candidate in item.candidates" :key="candidate.id" :value="candidate.id">
                    {{ candidate['车辆编号'] }} · {{ candidate['品牌型号'] }}
                  </option>
                </select>
              </template>
              <button
                v-else
                class="link"
                :disabled="busyKey === item.record.vehicleId"
                type="button"
                @click="onRecallSubstitute(item.record.vehicleId)"
              >
                召回替班
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条装卸设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { assignSubstitute, recallSubstitute } from '@/api/vehicle-service'
import { listRows, loadMaintenance } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('load_equip')
const columns = ["设备编号", "设备类型", "适用机型", "最大载重", "安装位置", "购入日期", "维保记录", "设备状态"]
const actions = ["启用设备", "安排维保", "申请报修"]
const statuses = ["待机", "运行中", "维保中", "已报修"]
const stats = [{"label": "运行中设备", "value": 0}, {"label": "维保中设备", "value": 0}, {"label": "报修设备", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const busyKey = ref<number | null>(null)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 替班清单：特种车辆里「维保中」且有进行中维保单的车；候选替班为同型别、当前待命、未被别的维保占用。
const vehicles = ref<EntryRow[]>([])

const standbyRows = computed(() => {
  const openRecords = loadMaintenance().filter((item) => item.status === '维保中')
  const occupiedIds = new Set(
    openRecords.map((item) => item.substituteVehicleId).filter((id): id is number => id !== null),
  )
  return openRecords.map((record) => {
    const substitute =
      record.substituteVehicleId !== null
        ? vehicles.value.find((row) => Number(row.id) === record.substituteVehicleId)
        : undefined
    const candidates = vehicles.value.filter(
      (row) =>
        String(row.status) === '待命' &&
        String(row['车辆类型']) === record.vehicleType &&
        !occupiedIds.has(Number(row.id)),
    )
    return { record, substitute, candidates }
  })
})

function refreshRelations() {
  vehicles.value = listRows('special_vehicle')
}

function onPickSubstitute(vehicleId: number, rawId: string) {
  const substituteId = Number(rawId)
  if (!substituteId) {
    return
  }
  errorMessage.value = ''
  busyKey.value = vehicleId
  try {
    const result = assignSubstitute(vehicleId, substituteId)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
  } finally {
    busyKey.value = null
  }
}

function onRecallSubstitute(vehicleId: number) {
  errorMessage.value = ''
  busyKey.value = vehicleId
  try {
    const result = recallSubstitute(vehicleId)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
  } finally {
    busyKey.value = null
  }
}

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
    refreshRelations()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '装卸设备列表读取失败'
  }
}

// 替班清单与特种车辆页共用同一份本地数据，其它标签页锁定/召回后这里即时刷新。
function onStorage(event: StorageEvent) {
  if (event.key && event.key.startsWith('airport-ground-handling:')) {
    reload()
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', onStorage)
})

onUnmounted(() => {
  window.removeEventListener('storage', onStorage)
})
</script>
