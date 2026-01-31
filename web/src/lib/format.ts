import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

export function fmtDateTime(iso?: string | null) {
  if (!iso) return '—'
  return dayjs(iso).format('YYYY-MM-DD HH:mm')
}

export function fmtFromNow(iso?: string | null) {
  if (!iso) return '—'
  return dayjs(iso).fromNow()
}

export function fmtHoursDays(hours?: number | null, days?: number | null) {
  if (hours == null && days == null) return '—'
  const h = hours ?? (days ?? 0) * 24
  const d = days ?? h / 24
  if (d >= 1) return `${d.toFixed(1)} d`
  return `${h.toFixed(1)} h`
}

export function priorityLabel(p: number) {
  if (p <= 1) return 'Low'
  if (p === 2) return 'Medium'
  if (p === 3) return 'High'
  return 'Critical'
}
