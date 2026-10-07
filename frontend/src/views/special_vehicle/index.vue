<template>
  <section class="page" data-module="special_vehicle">
    <header class="page-head">
      <div>
        <h2>特种车辆管理</h2>
        <p class="page-desc">维护特种车辆，围绕车辆编号、车辆类型、品牌型号、载重吨位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记特种车辆</button>
        <button class="btn" type="button" @click="exportRows">导出特种车辆清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="view-switch" role="tablist">
      <button
        v-for="item in viewModes"
        :key="item.key"
        class="view-tab"
        :class="{ active: viewMode === item.key }"
        type="button"
        role="tab"
        @click="viewMode = item.key"
      >
        {{ item.name }}
      </button>
    </div>

    <template v-if="viewMode === 'ledger'">
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
            <th v-for="column in ledgerColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in ledgerColumns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actionsFor(row)"
                :key="action.name"
                class="link"
                :disabled="busyId === Number(row.id)"
                type="button"
                @click="runVehicleAction(action.name, row)"
              >
                {{ action.label }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="ledgerColumns.length + 2" class="empty-state">暂无特种车辆数据，可先登记特种车辆</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条特种车辆记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <template v-else>
      <p class="section-hint">按维保时间排列：维保中按进厂时间、待命/出车中按上次维保时间升序；到期日按「上次维保＋当时周期」推算。</p>

      <div class="status-tabs" role="tablist">
        <button
          v-for="tab in maintenanceTabs"
          :key="tab.key"
          class="status-tab"
          :class="[tab.key, { active: activeTab === tab.key }]"
          type="button"
          role="tab"
          @click="activeTab = tab.key"
        >
          <span class="tab-name">{{ tab.name }}</span>
          <span class="tab-count">{{ tabCount(tab.key) }}</span>
        </button>
      </div>

      <form class="filter-bar" @submit.prevent>
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in maintenanceColumns" :key="column">{{ column }}</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in tabRows" :key="String(row.id)">
            <td>{{ row['车辆编号'] }}</td>
            <td>{{ row['车辆类型'] }}</td>
            <td>{{ row['品牌型号'] || '—' }}</td>
            <td>{{ row['载重吨位'] }}</td>
            <td>
              <div class="cell-main">{{ row['维保周期'] }}</div>
              <div class="cell-sub" :class="{ overdue: isOverdue(row), dueSoon: isDueSoon(row) && !isOverdue(row) }">
                应于 {{ dueText(row) }} 前维保
              </div>
            </td>
            <td>
              <div class="cell-main">{{ row['上次维保'] || '—' }}</div>
              <div v-if="openRecord(row)" class="cell-sub">进厂：{{ openRecord(row)?.startDate }}</div>
            </td>
            <td>
              <span class="state-pill" :class="String(row.status)">{{ row.status }}</span>
              <span v-if="isOverdue(row)" class="overdue-tag">已超期 {{ overdueDays(row) }} 天</span>
            </td>
            <td class="row-actions">
              <template v-if="String(row.status) === '维保中'">
                <button
                  class="link"
                  :disabled="busyId === Number(row.id)"
                  type="button"
                  @click="runVehicleAction('完成维保', row)"
                >
                  完成维保
                </button>
              </template>
              <template v-else-if="String(row.status) === '待命'">
                <button
                  class="link"
                  :disabled="busyId === Number(row.id)"
                  type="button"
                  @click="runVehicleAction('安排维保', row)"
                >
                  安排维保
                </button>
                <button
                  class="link"
                  :disabled="busyId === Number(row.id)"
                  type="button"
                  @click="runVehicleAction('调度出车', row)"
                >
                  调度出车
                </button>
              </template>
              <template v-else-if="String(row.status) === '出车中'">
                <button
                  class="link"
                  :disabled="busyId === Number(row.id)"
                  type="button"
                  @click="runVehicleAction('车辆归队', row)"
                >
                  车辆归队
                </button>
              </template>
            </td>
          </tr>
          <tr v-if="!tabRows.length">
            <td :colspan="maintenanceColumns.length + 1" class="empty-state">当前页签暂无车辆</td>
          </tr>
        </tbody>
      </table>

      <section class="history-block">
        <h3 class="block-title">
          历史维保
          <button class="link history-toggle" type="button" @click="showHistory = !showHistory">
            {{ showHistory ? '收起' : `展开（${historyRecords.length} 条）` }}
          </button>
        </h3>
        <table v-if="showHistory" class="data-table history-table">
          <thead>
            <tr>
              <th v-for="column in historyColumns" :key="column">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in historyRows" :key="item.id">
              <td>{{ item.vehicleNo }}</td>
              <td>{{ item.vehicleType }}</td>
              <td>{{ item.vehicleModel || '—' }}</td>
              <td>{{ tonnageOf(item.vehicleId) }}</td>
              <td>
                <span class="cycle-snapshot">{{ item.cycleSnapshot }}</span>
                <span v-if="differsFromCurrent(item)" class="cell-sub">当时周期，现规则 {{ currentCycle(item.vehicleId) }}</span>
              </td>
              <td>{{ item.completedAt }}</td>
              <td>
                <span class="state-pill 已完成">已完成</span>
                <span class="cell-sub">按当时周期 {{ item.cycleSnapshot }} 归档</span>
              </td>
            </tr>
            <tr v-if="!historyRows.length">
              <td :colspan="historyColumns.length" class="empty-state">暂无历史维保记录</td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer class="page-foot">
        <span>共 {{ filteredRows.length }} 台车辆符合条件</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  completeMaintenance,
  disableVehicle,
  dispatchVehicle,
  enableVehicle,
  returnVehicle,
  submitMaintenance,
} from '@/api/vehicle-service'
import { loadMaintenance } from '@/data/local-store'
import type { ActionResult, EntryRow, MaintenanceRecord } from '@/data/types'
import { dayDiff, dueDate } from '@/data/vehicle-catalog'

const meta = moduleMeta('special_vehicle')
const ledgerColumns = ["车辆编号", "车辆类型", "品牌型号", "载重吨位", "购入日期", "维保周期", "上次维保", "车辆状态"]
const maintenanceColumns = ["车辆编号", "车辆类型", "品牌型号", "载重吨位", "维保周期", "上次维保", "车辆状态"]
const historyColumns = ["车辆编号", "车辆类型", "品牌型号", "载重吨位", "维保周期", "上次维保", "车辆状态"]

const viewModes = [
  { key: 'ledger', name: '台账视图' },
  { key: 'maintenance', name: '维保视图' },
] as const
type ViewMode = (typeof viewModes)[number]['key']
const viewMode = ref<ViewMode>('maintenance')

const maintenanceTabs = [
  { key: '维保中', name: '维保中' },
  { key: '待命', name: '待命' },
  { key: '出车中', name: '出车中' },
] as const
const activeTab = ref<string>('维保中')

const rows = ref<EntryRow[]>([])
const records = ref<MaintenanceRecord[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["车辆编号", "车辆类型", "品牌型号"]
const busyId = ref<number | null>(null)
const showHistory = ref(true)

const stats = computed(() => [
  { label: '待命车辆', value: countByStatus('待命') },
  { label: '出车中车辆', value: countByStatus('出车中') },
  { label: '维保中车辆', value: countByStatus('维保中') },
])

const statusSummary = computed(() =>
  ['待命', '出车中', '维保中', '已停用'].map((status) => ({
    status,
    count: countByStatus(status),
  })),
)

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function matchesFilters(row: EntryRow): boolean {
  return Object.entries(filters.value)
    .filter(([, value]) => value.trim() !== '')
    .every(([field, value]) => String(row[field] ?? '').includes(value.trim()))
}

const filteredRows = computed(() => rows.value.filter(matchesFilters))

function startDateOf(row: EntryRow): string {
  const open = openRecord(row)
  return open?.startDate ?? String(row['上次维保'] ?? '')
}

// 维保中按进厂时间排；待命/出车中按上次维保时间排，越早越靠前，超期车自然顶到前面。
const tabRows = computed(() => {
  const inTab = filteredRows.value.filter((row) => String(row.status) === activeTab.value)
  return [...inTab].sort((a, b) => startDateOf(a).localeCompare(startDateOf(b)))
})

function tabCount(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

const historyRecords = computed(() =>
  records.value.filter((item) => item.status === '已完成'),
)

const historyRows = computed(() =>
  historyRecords.value
    .filter((item) =>
      Object.entries(filters.value)
        .filter(([, value]) => value.trim() !== '')
        .every(([field, value]) => {
          if (field === '车辆编号') {
            return item.vehicleNo.includes(value.trim())
          }
          if (field === '车辆类型') {
            return item.vehicleType.includes(value.trim())
          }
          if (field === '品牌型号') {
            return item.vehicleModel.includes(value.trim())
          }
          return true
        }),
    )
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
)

function openRecord(row: EntryRow): MaintenanceRecord | undefined {
  const id = Number(row.id)
  return records.value.find((item) => item.vehicleId === id && item.status === '维保中')
}

function dueText(row: EntryRow): string {
  const open = openRecord(row)
  // 维保中的车：本次进厂前的周期已经走到头，用上次维保＋当时周期看它是否按期进厂；
  // 其余车用当前台账周期推算下一次到期日。
  const cycle = open ? open.cycleSnapshot : String(row['维保周期'] ?? '90天')
  return dueDate(String(row['上次维保'] ?? ''), cycle)
}

function isOverdue(row: EntryRow): boolean {
  if (!String(row['上次维保'])) {
    return false
  }
  return dayDiff(dueText(row)) > 0
}

function isDueSoon(row: EntryRow): boolean {
  if (!String(row['上次维保'])) {
    return false
  }
  const diff = dayDiff(dueText(row))
  return diff <= 0 && diff >= -15
}

function overdueDays(row: EntryRow): number {
  return Math.max(dayDiff(dueText(row)), 0)
}

function vehicleById(id: number): EntryRow | undefined {
  return rows.value.find((row) => Number(row.id) === id)
}

function tonnageOf(id: number): string {
  return String(vehicleById(id)?.['载重吨位'] ?? '—')
}

function currentCycle(id: number): string {
  return String(vehicleById(id)?.['维保周期'] ?? '—')
}

function differsFromCurrent(item: MaintenanceRecord): boolean {
  return currentCycle(item.vehicleId) !== item.cycleSnapshot
}

function actionsFor(row: EntryRow): { name: string; label: string }[] {
  switch (String(row.status)) {
    case '待命':
      return [
        { name: '调度出车', label: '调度出车' },
        { name: '安排维保', label: '安排维保' },
        { name: '停用车辆', label: '停用车辆' },
      ]
    case '出车中':
      return [{ name: '车辆归队', label: '车辆归队' }]
    case '维保中':
      return [{ name: '完成维保', label: '完成维保' }]
    case '已停用':
      return [{ name: '重新启用', label: '重新启用' }]
    default:
      return []
  }
}

const VEHICLE_HANDLERS: Record<string, (id: number) => ActionResult> = {
  调度出车: dispatchVehicle,
  车辆归队: returnVehicle,
  安排维保: submitMaintenance,
  完成维保: completeMaintenance,
  停用车辆: disableVehicle,
  重新启用: enableVehicle,
}

function runVehicleAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const handler = VEHICLE_HANDLERS[action]
  if (!handler) {
    errorMessage.value = `未登记「${action}」这个动作`
    return
  }
  busyId.value = Number(row.id)
  try {
    const result = handler(Number(row.id))
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
  } finally {
    busyId.value = null
  }
}

function resetFilters() {
  filters.value = {}
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '特种车辆登记入口尚未接入审批流'
}

// 装卸设备台账安排/召回替班后，切回本页也能立刻看到车辆最新状态；多标签页之间同样同步。
function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, {})
    rows.value = payload.items
    total.value = payload.total
    records.value = loadMaintenance()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '特种车辆列表读取失败'
  }
}

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
