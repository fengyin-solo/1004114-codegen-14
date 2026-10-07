/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 维保单是车辆台账之外的独立流水：历史单保留提交时的维保周期快照，之后改周期不回写历史。
export type MaintenanceRecord = {
  id: number
  vehicleId: number
  vehicleNo: string
  vehicleType: string
  vehicleModel: string
  cycleSnapshot: string
  submittedAt: string
  startDate: string
  completedAt: string
  status: '维保中' | '已完成'
  substituteVehicleId: number | null
}
