import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-handling:entries'

// 存量数据迁移：缺品牌型号的特种车辆回填「未登记型号」，装卸设备补齐「替班对象」列。
// 迁移是幂等的，每次读取都过一遍，老 localStorage 数据打开即完成回填。
function migrate(rows: Record<string, EntryRow[]>): boolean {
  let changed = false
  for (const row of rows['special_vehicle'] ?? []) {
    if (!String(row['品牌型号'] ?? '').trim()) {
      row['品牌型号'] = '未登记型号'
      changed = true
    }
  }
  for (const row of rows['load_equip'] ?? []) {
    if (row['替班对象'] === undefined) {
      row['替班对象'] = ''
      changed = true
    }
  }
  return changed
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  let rows: Record<string, EntryRow[]>
  if (!raw) {
    rows = fallback
  } else {
    try {
      rows = { ...fallback, ...(JSON.parse(raw) as Record<string, EntryRow[]>) }
    } catch {
      rows = fallback
    }
  }
  // 迁移必须每次读取都执行，不能放进 || 右侧被短路掉。
  const changed = migrate(rows)
  if (!raw || changed) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
  return rows
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
