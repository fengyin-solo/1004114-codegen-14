import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// ---- 特种车辆：维保视图与锁定规则 ----
const VEHICLE_KEY = 'special_vehicle'
const EQUIP_KEY = 'load_equip'
const MAINT_HISTORY_KEY = 'special_vehicle_maintenance'
const SUBSTITUTE_KEY = 'substitute_shifts'
const VEHICLE_ACTIONS = ['调度出车', '安排维保', '完成维保', '停用车辆']

// 同一车辆的在途提交只放行第一个：并发提交维保只保留首个结果。
const inflightVehicleActions = new Set<number>()

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 维保视图按上次维保时间排列：最久未维保的排前面，没填日期的排最后。
function byMaintenanceTime(a: EntryRow, b: EntryRow): number {
  const ta = String(a['上次维保'] ?? '')
  const tb = String(b['上次维保'] ?? '')
  if (!ta && !tb) return 0
  if (!ta) return 1
  if (!tb) return -1
  return ta.localeCompare(tb)
}

export function listMaintenanceVehicles(status = ''): EntryRow[] {
  const rows = listRows(VEHICLE_KEY).filter(
    (row) => !status || String(row.status) === status,
  )
  return [...rows].sort(byMaintenanceTime)
}

// 历史维保仍按当时周期：每条记录存的是办结那一刻的周期快照，不随车辆档案回改。
export function listMaintenanceHistory(vehicleCode = ''): EntryRow[] {
  const rows = listRows(MAINT_HISTORY_KEY).filter(
    (row) => !vehicleCode || row['车辆编号'] === vehicleCode,
  )
  return [...rows].sort((a, b) => {
    const byDate = String(b['维保日期'] ?? '').localeCompare(String(a['维保日期'] ?? ''))
    return byDate || String(b['登记时间'] ?? '').localeCompare(String(a['登记时间'] ?? ''))
  })
}

// 替班清单：替班中的排前面，其余按开始时间倒序。
export function listSubstitutes(): EntryRow[] {
  return [...listRows(SUBSTITUTE_KEY)].sort((a, b) => {
    const openA = a.status === '替班中' ? 0 : 1
    const openB = b.status === '替班中' ? 0 : 1
    return openA - openB || String(b['开始时间'] ?? '').localeCompare(String(a['开始时间'] ?? ''))
  })
}

// 车辆锁进维保后，从装卸设备台账里挑一台待机且未替班的设备顶替，台账「替班对象」列同步更新。
function assignSubstitute(vehicle: EntryRow): EntryRow {
  const equips = listRows(EQUIP_KEY)
  const index = equips.findIndex(
    (row) => String(row.status) === '待机' && !String(row['替班对象'] ?? '').trim(),
  )
  const record: EntryRow = {
    id: nextId(listRows(SUBSTITUTE_KEY)),
    status: '替班中',
    pending: true,
    abnormal: false,
    车辆编号: vehicle['车辆编号'] ?? '',
    车辆类型: vehicle['车辆类型'] ?? '',
    设备编号: '待指派',
    设备类型: '',
    开始时间: nowText(),
    结束时间: '',
  }
  if (index >= 0) {
    const equip = equips[index]
    const next = [...equips]
    next[index] = { ...equip, 替班对象: vehicle['车辆编号'] }
    saveRows(EQUIP_KEY, next)
    record['设备编号'] = equip['设备编号'] ?? ''
    record['设备类型'] = equip['设备类型'] ?? ''
  } else {
    record.abnormal = true
  }
  saveRows(SUBSTITUTE_KEY, [...listRows(SUBSTITUTE_KEY), record])
  return record
}

// 车辆维保办结或停用时结束替班，台账「替班对象」列同步清空。
function closeSubstitute(vehicleCode: string): void {
  const records = listRows(SUBSTITUTE_KEY)
  const index = records.findIndex(
    (row) => row['车辆编号'] === vehicleCode && row.status === '替班中',
  )
  if (index < 0) {
    return
  }
  const record = records[index]
  const equipCode = String(record['设备编号'] ?? '')
  if (equipCode && equipCode !== '待指派') {
    const equips = listRows(EQUIP_KEY)
    const equipIndex = equips.findIndex(
      (row) => row['设备编号'] === equipCode && row['替班对象'] === vehicleCode,
    )
    if (equipIndex >= 0) {
      const next = [...equips]
      next[equipIndex] = { ...equips[equipIndex], 替班对象: '' }
      saveRows(EQUIP_KEY, next)
    }
  }
  const next = [...records]
  next[index] = { ...record, status: '已结束', pending: false, 结束时间: nowText() }
  saveRows(SUBSTITUTE_KEY, next)
}

function saveVehicle(rows: EntryRow[], index: number, updated: EntryRow): void {
  const next = [...rows]
  next[index] = updated
  saveRows(VEHICLE_KEY, next)
}

// 特种车辆的动作流转：维保与出车互斥，先锁定车辆为准；并发提交只保留首个结果。
function runVehicleAction(id: number, action: string): ActionResult {
  if (inflightVehicleActions.has(id)) {
    return { ok: false, message: '该车辆有在途提交，并发提交只保留首个结果' }
  }
  inflightVehicleActions.add(id)
  try {
    const rows = listRows(VEHICLE_KEY)
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的特种车辆` }
    }
    const row = rows[index]
    const status = String(row.status)
    const code = String(row['车辆编号'] ?? id)

    if (action === '安排维保') {
      if (status === '维保中') {
        return { ok: false, message: `${code} 的维保申请已受理，同一车辆并发提交维保只保留首个结果` }
      }
      if (status === '出车中') {
        return { ok: false, message: `${code} 已锁定出车，维保与出车冲突时以先锁定车辆为准` }
      }
      if (status === '已停用') {
        return { ok: false, message: `${code} 已停用，不能安排维保` }
      }
      const updated: EntryRow = {
        ...row, status: '维保中', 车辆状态: '维保中', pending: true, abnormal: false, 锁定时间: nowText(),
      }
      saveVehicle(rows, index, updated)
      const substitute = assignSubstitute(updated)
      const syncNote = substitute['设备编号'] === '待指派'
        ? '替班清单已登记，暂无可替班的待机装卸设备，待指派'
        : `替班清单已同步：${substitute['设备编号']}（${substitute['设备类型']}）替班`
      return { ok: true, message: `特种车辆已安排维保，当前状态「维保中」；${syncNote}` }
    }

    if (action === '调度出车') {
      if (status === '维保中') {
        return { ok: false, message: `${code} 已锁定维保，维保与出车冲突时以先锁定车辆为准` }
      }
      if (status === '出车中') {
        return { ok: false, message: `${code} 已在出车中，不用重复调度` }
      }
      if (status === '已停用') {
        return { ok: false, message: `${code} 已停用，不能调度出车` }
      }
      saveVehicle(rows, index, {
        ...row, status: '出车中', 车辆状态: '出车中', pending: true, abnormal: false, 锁定时间: nowText(),
      })
      return { ok: true, message: '特种车辆已调度出车，当前状态「出车中」' }
    }

    if (action === '完成维保') {
      if (status !== '维保中') {
        return { ok: false, message: `${code} 当前不是维保中，不能办结维保` }
      }
      const today = nowText().slice(0, 10)
      const cycle = String(row['维保周期'] ?? '')
      saveVehicle(rows, index, {
        ...row, status: '待命', 车辆状态: '待命', pending: true, abnormal: false, 上次维保: today, 锁定时间: '',
      })
      // 历史维保按当时周期归档：快照取办结这一刻车辆档案里的维保周期。
      saveRows(MAINT_HISTORY_KEY, [
        ...listRows(MAINT_HISTORY_KEY),
        {
          id: nextId(listRows(MAINT_HISTORY_KEY)),
          status: '已归档',
          pending: false,
          abnormal: false,
          车辆编号: code,
          维保日期: today,
          当时周期: cycle,
          登记时间: nowText(),
        },
      ])
      closeSubstitute(code)
      return { ok: true, message: `特种车辆已办结维保，上次维保更新为 ${today}，历史记录按当时周期「${cycle}」归档，替班清单已同步` }
    }

    if (action === '停用车辆') {
      if (status === '已停用') {
        return { ok: false, message: `${code} 已经是「已停用」，不用重复操作` }
      }
      if (status === '出车中') {
        return { ok: false, message: `${code} 出车中，收车后才能停用` }
      }
      if (status === '维保中') {
        closeSubstitute(code)
      }
      saveVehicle(rows, index, {
        ...row, status: '已停用', 车辆状态: '已停用', pending: false, abnormal: true, 锁定时间: '',
      })
      return { ok: true, message: '特种车辆已停用车辆，当前状态「已停用」' }
    }

    return { ok: false, message: `特种车辆没有登记「${action}」这个动作` }
  } finally {
    inflightVehicleActions.delete(id)
  }
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  // 特种车辆的四个动作走专属流转：维保与出车互斥、先锁定为准、并发只保留首个。
  if (key === VEHICLE_KEY && VEHICLE_ACTIONS.includes(action)) {
    return runVehicleAction(id, action)
  }
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
