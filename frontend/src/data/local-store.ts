import { SEED_MAINTENANCE } from './maintenance-seed'
import { SEED_ROWS } from './seed'
import type { EntryRow, MaintenanceRecord } from './types'
import { defaultModelForType } from './vehicle-catalog'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-handling:entries'
const SCHEMA_KEY = 'airport-ground-handling:schema'
const MAINTENANCE_KEY = 'airport-ground-handling:maintenance'
const CURRENT_SCHEMA = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// v1 的特种车辆种子是三个「特种车辆样例N」占位行，迁移时直接换成拟真种子，
// 用户自己登记的行不受影响，只补齐缺失的品牌型号。
function isPlaceholderVehicle(row: EntryRow): boolean {
  return String(row['车辆类型'] ?? '').startsWith('特种车辆样例')
}

function migrateSpecialVehicles(rows: EntryRow[]): { rows: EntryRow[]; replaced: boolean } {
  if (rows.some((row) => !isPlaceholderVehicle(row))) {
    return { rows, replaced: false }
  }
  return { rows: clone(SEED_ROWS.special_vehicle), replaced: true }
}

// 存量回填：品牌型号为空时按车辆类型映射一个默认值，识别不出型别给通用型号。
function backfillVehicleModel(rows: EntryRow[]): EntryRow[] {
  return rows.map((row) => {
    const model = String(row['品牌型号'] ?? '').trim()
    if (model) {
      return row
    }
    const vehicleType = String(row['车辆类型'] ?? '')
    return { ...row, 品牌型号: defaultModelForType(vehicleType) }
  })
}

function readStorage(): Record<string, EntryRow[]> {
  const buildFallback = () => {
    const seeded = clone(SEED_ROWS)
    return { ...seeded, special_vehicle: backfillVehicleModel(seeded.special_vehicle) }
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    return buildFallback()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const fallback = buildFallback()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SCHEMA_KEY, String(CURRENT_SCHEMA))
    return fallback
  }
  let parsed: Record<string, EntryRow[]>
  try {
    parsed = JSON.parse(raw) as Record<string, EntryRow[]>
  } catch {
    const fallback = buildFallback()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SCHEMA_KEY, String(CURRENT_SCHEMA))
    return fallback
  }

  const schema = Number(window.localStorage.getItem(SCHEMA_KEY) ?? '1')
  if (schema < 2 && parsed.special_vehicle) {
    const migrated = migrateSpecialVehicles(parsed.special_vehicle)
    parsed = { ...parsed, special_vehicle: migrated.rows }
  }
  // 后续新增模块的种子也要并进来，不能把老版本没有的键丢掉；车辆品牌型号缺失统一回填。
  const merged: Record<string, EntryRow[]> = { ...clone(SEED_ROWS), ...parsed }
  if (merged.special_vehicle) {
    merged.special_vehicle = backfillVehicleModel(merged.special_vehicle)
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  window.localStorage.setItem(SCHEMA_KEY, String(CURRENT_SCHEMA))
  return merged
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// —— 维保单流水：独立于模块台账的 JSON 存储，reset 模块台账时不会清掉历史 ——

let maintenanceCache: MaintenanceRecord[] | null = null

function cloneMaintenanceSeed(): MaintenanceRecord[] {
  return clone(SEED_MAINTENANCE)
}

export function loadMaintenance(): MaintenanceRecord[] {
  if (maintenanceCache !== null) {
    return maintenanceCache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    maintenanceCache = cloneMaintenanceSeed()
    return maintenanceCache
  }
  const raw = window.localStorage.getItem(MAINTENANCE_KEY)
  if (!raw) {
    maintenanceCache = cloneMaintenanceSeed()
    window.localStorage.setItem(MAINTENANCE_KEY, JSON.stringify(maintenanceCache))
    return maintenanceCache
  }
  try {
    maintenanceCache = JSON.parse(raw) as MaintenanceRecord[]
  } catch {
    maintenanceCache = cloneMaintenanceSeed()
    window.localStorage.setItem(MAINTENANCE_KEY, JSON.stringify(maintenanceCache))
  }
  return maintenanceCache as MaintenanceRecord[]
}

export function saveMaintenance(records: MaintenanceRecord[]): void {
  maintenanceCache = records
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(MAINTENANCE_KEY, JSON.stringify(records))
  }
}

export function maintenanceStorageKey(): string {
  return MAINTENANCE_KEY
}
