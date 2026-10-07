/** 特种车辆领域的公共规则：品牌型号回填映射、维保周期与到期日计算。 */

// 存量车辆缺品牌型号时的迁移回填策略：按车辆类型给一个该型别常见的默认品牌型号，
// 识别不出型别就回退到通用货车型号，保证台账不留空。
const DEFAULT_MODEL_BY_TYPE: Array<[string, string]> = [
  ['摆渡车', '宇通 ZK6118H'],
  ['客梯车', '威海广达 WGKT60'],
  ['升降平台', '华德 HD-GK32'],
  ['平台车', '华德 HD-GK32'],
  ['传送带', '达能 DN-CB6000'],
  ['牵引车', '重汽豪威 ZZ5311'],
  ['加油车', '程力威 CLW5310'],
  ['清水车', '程力威 CLW5160'],
  ['污水车', '东风 DFL5160'],
  ['除冰车', '航天晨光 CGT5250'],
  ['食品车', '新飞 XKC5160'],
  ['垃圾车', '中联 ZLJ5073'],
  ['拖车', '粤海 YH-PT20'],
]

const FALLBACK_MODEL = '东风 DFL1160B'

/** 迁移回填：缺品牌型号的存量车辆按车辆类型匹配默认值。 */
export function defaultModelForType(vehicleType: string): string {
  const hit = DEFAULT_MODEL_BY_TYPE.find(([keyword]) => vehicleType.includes(keyword))
  return hit ? hit[1] : FALLBACK_MODEL
}

/** 维保周期统一折算成天数，兼容「90天 / 6个月 / 1年 / 180」等存量写法，缺省按 90 天。 */
export function cycleToDays(cycle: unknown): number {
  const text = String(cycle ?? '').trim()
  const matched = text.match(/(\d+)\s*(年|个月|月|天|日)?/)
  if (!matched) {
    return 90
  }
  const amount = Number(matched[1])
  const unit = matched[2] ?? '天'
  if (unit === '年') {
    return amount * 365
  }
  if (unit === '个月' || unit === '月') {
    return amount * 30
  }
  return amount
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayText(): string {
  return formatDate(new Date())
}

export function addDays(value: string, days: number): string {
  const date = parseDate(value)
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

/** b - a 的整天数；a/b 均为 YYYY-MM-DD。 */
export function dayDiff(from: string, to: string = todayText()): number {
  const ms = parseDate(to).getTime() - parseDate(from).getTime()
  return Math.round(ms / 86400000)
}

/** 按「上次维保 + 当时周期」推算下次到期日；历史记录传当时周期快照，不传当前周期。 */
export function dueDate(lastMaintenance: string, cycle: unknown): string {
  return addDays(lastMaintenance, cycleToDays(cycle))
}
