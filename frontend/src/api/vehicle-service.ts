import { listRows, loadMaintenance, saveMaintenance, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, MaintenanceRecord } from '@/data/types'
import { todayText } from '@/data/vehicle-catalog'

// 车辆状态流转在这里集中收口：调度出车 / 安排维保互斥，谁先锁定车辆谁生效；
// 同一车辆并发提交维保只保留第一条——提交是同步落库的，后面的请求看到「维保中」会被直接拒绝。
const VEHICLE_KEY = 'special_vehicle'

// 进行中的提交锁：真实并发（短时间内连续点两次）由这里挡住，提交结束立刻释放。
const submittingVehicleIds = new Set<number>()

function nowStamp(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

function loadVehicles(): EntryRow[] {
  return listRows(VEHICLE_KEY)
}

function saveVehicles(rows: EntryRow[]): void {
  saveRows(VEHICLE_KEY, rows)
}

function findVehicle(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === id)
}

function updateVehicle(id: number, patch: Partial<EntryRow>): EntryRow {
  const rows = loadVehicles()
  const index = rows.findIndex((row) => Number(row.id) === id)
  const next: EntryRow = { ...rows[index], ...patch } as EntryRow
  const copy = [...rows]
  copy[index] = next
  saveVehicles(copy)
  return next
}

function nextMaintenanceId(records: MaintenanceRecord[]): number {
  return records.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function vehicleLabel(row: EntryRow): string {
  return `${String(row['车辆编号'] ?? '')}（${String(row['车辆类型'] ?? '')}）`
}

/** 调度出车：只有待命车能被锁定，维保中/已停用/已出车都拒绝，保证先锁先得。 */
export function dispatchVehicle(id: number): ActionResult {
  const row = findVehicle(loadVehicles(), id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的特种车辆`)
  }
  const status = String(row.status)
  if (status === '出车中') {
    return fail(`${vehicleLabel(row)}已经在出车中，不用重复调度`)
  }
  if (status === '维保中') {
    return fail(`${vehicleLabel(row)}已先锁定维保，维保结束前不能调度出车`)
  }
  if (status === '已停用') {
    return fail(`${vehicleLabel(row)}已停用，不能调度出车`)
  }
  updateVehicle(id, { status: '出车中', pending: true, abnormal: false })
  return { ok: true, message: `${vehicleLabel(row)}已锁定出车，当前状态「出车中」` }
}

/** 车辆归队：出车中的车辆回到待命。 */
export function returnVehicle(id: number): ActionResult {
  const row = findVehicle(loadVehicles(), id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的特种车辆`)
  }
  if (String(row.status) !== '出车中') {
    return fail(`${vehicleLabel(row)}当前不是出车中，不能归队`)
  }
  updateVehicle(id, { status: '待命', pending: true, abnormal: false })
  return { ok: true, message: `${vehicleLabel(row)}已归队，当前状态「待命」` }
}

/**
 * 安排维保：先锁先得。
 * 出车中的车已经先被调度锁定，拒绝；维保中的车（含并发的第二笔提交）拒绝；
 * 同一车辆的并发提交由 submittingVehicleIds 挡住首条提交窗口内的重复请求，
 * 落库后再由「维保中」状态兜底，只保留首个结果。
 */
export function submitMaintenance(id: number): ActionResult {
  if (submittingVehicleIds.has(id)) {
    return fail(`车辆 ${id} 的维保申请正在处理，请勿重复提交`)
  }
  const row = findVehicle(loadVehicles(), id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的特种车辆`)
  }
  const status = String(row.status)
  if (status === '出车中') {
    return fail(`${vehicleLabel(row)}已先锁定出车，回队前不能安排维保`)
  }
  if (status === '维保中') {
    return fail(`${vehicleLabel(row)}已有进行中的维保，只保留首个提交，请勿重复申请`)
  }
  if (status === '已停用') {
    return fail(`${vehicleLabel(row)}已停用，不能安排维保`)
  }
  const records = loadMaintenance()
  if (records.some((item) => item.vehicleId === id && item.status === '维保中')) {
    return fail(`${vehicleLabel(row)}已有进行中的维保，只保留首个提交，请勿重复申请`)
  }

  submittingVehicleIds.add(id)
  try {
    const cycle = String(row['维保周期'] ?? '90天')
    const record: MaintenanceRecord = {
      id: nextMaintenanceId(records),
      vehicleId: id,
      vehicleNo: String(row['车辆编号'] ?? ''),
      vehicleType: String(row['车辆类型'] ?? ''),
      vehicleModel: String(row['品牌型号'] ?? ''),
      cycleSnapshot: cycle,
      submittedAt: nowStamp(),
      startDate: todayText(),
      completedAt: '',
      status: '维保中',
      substituteVehicleId: null,
    }
    saveMaintenance([...records, record])
    updateVehicle(id, { status: '维保中', pending: true, abnormal: false })
    return { ok: true, message: `${vehicleLabel(row)}已锁定维保，周期按${cycle}登记，当前状态「维保中」` }
  } finally {
    submittingVehicleIds.delete(id)
  }
}

/** 完成维保：回到待命并把今天记为上次维保；作为替班被锁定的车辆同步归队。 */
export function completeMaintenance(id: number): ActionResult {
  const row = findVehicle(loadVehicles(), id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的特种车辆`)
  }
  if (String(row.status) !== '维保中') {
    return fail(`${vehicleLabel(row)}当前不在维保中`)
  }
  const records = loadMaintenance()
  const index = records.findIndex((item) => item.vehicleId === id && item.status === '维保中')
  if (index < 0) {
    return fail(`${vehicleLabel(row)}没有进行中的维保记录`)
  }
  const record = records[index]
  const finished = todayText()
  const nextRecords = [...records]
  nextRecords[index] = { ...record, completedAt: finished, status: '已完成' }

  const substituteId = record.substituteVehicleId
  if (substituteId !== null) {
    const substitute = findVehicle(loadVehicles(), substituteId)
    if (substitute && String(substitute.status) === '出车中') {
      updateVehicle(substituteId, { status: '待命', pending: true, abnormal: false })
    }
    nextRecords[index] = { ...nextRecords[index], substituteVehicleId: null }
  }

  saveMaintenance(nextRecords)
  updateVehicle(id, { status: '待命', pending: true, abnormal: false, 上次维保: finished })
  return { ok: true, message: `${vehicleLabel(row)}维保完成，上次维保已更新为 ${finished}` }
}

/** 停用车辆：只允许从待命停用。 */
export function disableVehicle(id: number): ActionResult {
  const row = findVehicle(loadVehicles(), id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的特种车辆`)
  }
  const status = String(row.status)
  if (status === '已停用') {
    return fail(`${vehicleLabel(row)}已经是停用状态`)
  }
  if (status !== '待命') {
    return fail(`${vehicleLabel(row)}当前「${status}」，先归队/完工才能停用`)
  }
  updateVehicle(id, { status: '已停用', pending: false, abnormal: true })
  return { ok: true, message: `${vehicleLabel(row)}已停用` }
}

/** 重新启用停用车辆。 */
export function enableVehicle(id: number): ActionResult {
  const row = findVehicle(loadVehicles(), id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的特种车辆`)
  }
  if (String(row.status) !== '已停用') {
    return fail(`${vehicleLabel(row)}不是停用状态`)
  }
  updateVehicle(id, { status: '待命', pending: true, abnormal: false })
  return { ok: true, message: `${vehicleLabel(row)}已重新启用，当前状态「待命」` }
}

/**
 * 装卸设备台账的替班清单：给维保中车辆锁定一辆同型别的待命车作为替班。
 * 替班车锁定为「出车中」，其他页面就调度不动它（先锁先得）。
 */
export function assignSubstitute(maintenanceVehicleId: number, substituteId: number): ActionResult {
  const records = loadMaintenance()
  const recordIndex = records.findIndex(
    (item) => item.vehicleId === maintenanceVehicleId && item.status === '维保中',
  )
  if (recordIndex < 0) {
    return fail(`车辆 ${maintenanceVehicleId} 没有进行中的维保，不能安排替班`)
  }
  if (records[recordIndex].substituteVehicleId !== null) {
    return fail(`${records[recordIndex].vehicleNo} 已有替班车辆，请先召回`)
  }
  if (substituteId === maintenanceVehicleId) {
    return fail('不能选择维保车辆自身作为替班')
  }
  const rows = loadVehicles()
  const target = findVehicle(rows, substituteId)
  if (!target) {
    return fail(`没有找到编号为 ${substituteId} 的特种车辆`)
  }
  if (String(target['车辆类型'] ?? '') !== String(records[recordIndex].vehicleType)) {
    return fail(`替班车型别不一致，需要「${records[recordIndex].vehicleType}」`)
  }
  const targetStatus = String(target.status)
  if (targetStatus !== '待命') {
    return fail(`${vehicleLabel(target)}当前「${targetStatus}」，只有待命车能锁定为替班`)
  }
  updateVehicle(substituteId, { status: '出车中', pending: true, abnormal: false })
  const nextRecords = [...records]
  nextRecords[recordIndex] = { ...records[recordIndex], substituteVehicleId: substituteId }
  saveMaintenance(nextRecords)
  return { ok: true, message: `${target['车辆编号']} 已锁定为 ${records[recordIndex].vehicleNo} 的替班` }
}

/** 召回替班：替班车还在出车中就放回待命。 */
export function recallSubstitute(maintenanceVehicleId: number): ActionResult {
  const records = loadMaintenance()
  const recordIndex = records.findIndex(
    (item) => item.vehicleId === maintenanceVehicleId && item.status === '维保中',
  )
  if (recordIndex < 0) {
    return fail(`车辆 ${maintenanceVehicleId} 没有进行中的维保`)
  }
  const substituteId = records[recordIndex].substituteVehicleId
  if (substituteId === null) {
    return fail(`${records[recordIndex].vehicleNo} 还没有安排替班`)
  }
  const substitute = findVehicle(loadVehicles(), substituteId)
  if (substitute && String(substitute.status) === '出车中') {
    updateVehicle(substituteId, { status: '待命', pending: true, abnormal: false })
  }
  const nextRecords = [...records]
  nextRecords[recordIndex] = { ...records[recordIndex], substituteVehicleId: null }
  saveMaintenance(nextRecords)
  return { ok: true, message: `已召回 ${records[recordIndex].vehicleNo} 的替班车辆` }
}
