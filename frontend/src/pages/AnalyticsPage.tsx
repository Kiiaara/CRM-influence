import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { integrationsApi, STAGES } from '../api/integrations'
import type { Streamer } from '../api/integrations'
import { useTheme } from '../theme'

type Period = 'month' | 'quarter' | 'year' | 'all'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
  { key: 'all', label: 'Всё время' },
]

interface Row extends Streamer {
  brand: string
}

function periodStart(period: Period): dayjs.Dayjs | null {
  const now = dayjs()
  if (period === 'month') return now.startOf('month')
  if (period === 'quarter') return now.subtract(3, 'month').startOf('day')
  if (period === 'year') return now.startOf('year')
  return null
}

function money(n: number): string {
  return Math.round(n).toLocaleString('ru-RU') + ' ₽'
}

// значение ["queryKey": ['integrations']] то же, что и на канбане/в документах/в алертах -
// аналитика всегда синхронна с остальными разделами без дополнительных запросов
export default function AnalyticsPage() {
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const { theme } = useTheme()
  const [period, setPeriod] = useState<Period>('month')

  const dark = theme === 'dark'
  const gridColor = dark ? '#14735f' : '#e2e8f0'
  const tickColor = dark ? '#94a3b8' : '#64748b'
  const brandLine = dark ? '#3dd0ae' : '#159075'
  const brandBar = dark ? '#1fb491' : '#159075'

  const rows: Row[] = useMemo(
    () => integrations.flatMap(it => it.streamers.map(s => ({ ...s, brand: it.brand }))),
    [integrations]
  )

  const start = periodStart(period)
  const doneInPeriod = useMemo(
    () => rows.filter(r => r.stage === 'done' && (!start || dayjs(r.updated_at).isAfter(start))),
    [rows, start]
  )

  const turnover = doneInPeriod.reduce((sum, r) => sum + (r.amount ?? 0), 0)
  const revenue = doneInPeriod.reduce((sum, r) => sum + (r.commission_amount ?? 0), 0)
  const avgCheck = doneInPeriod.length ? turnover / doneInPeriod.length : 0
  const avgCycleDays = useMemo(() => {
    const withDates = doneInPeriod.filter(r => r.created_at && r.updated_at)
    if (withDates.length === 0) return null
    const totalDays = withDates.reduce((sum, r) => sum + dayjs(r.updated_at).diff(dayjs(r.created_at), 'day'), 0)
    return totalDays / withDates.length
  }, [doneInPeriod])

  // доход по месяцам - последние 6 месяцев, всегда, независимо от фильтра периода
  const monthly = useMemo(() => {
    const months = Array.from({ length: 6 }).map((_, i) => dayjs().subtract(5 - i, 'month').startOf('month'))
    return months.map(m => ({
      month: m.format('MMM YY'),
      revenue: Math.round(
        rows.filter(r => r.stage === 'done' && dayjs(r.updated_at).isSame(m, 'month')).reduce((s, r) => s + (r.commission_amount ?? 0), 0)
      ),
    }))
  }, [rows])

  // воронка по стадиям - текущий снимок, не зависит от фильтра периода
  const funnel = useMemo(
    () => STAGES.filter(s => s.key !== 'cancelled').map(s => ({ stage: s.label, count: rows.filter(r => r.stage === s.key).length })),
    [rows]
  )

  const topStreamers = useMemo(() => {
    const map = new Map<string, { name: string; deals: number; revenue: number }>()
    for (const r of doneInPeriod) {
      const e = map.get(r.streamer_name) ?? { name: r.streamer_name, deals: 0, revenue: 0 }
      e.deals += 1
      e.revenue += r.commission_amount ?? 0
      map.set(r.streamer_name, e)
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10)
  }, [doneInPeriod])

  return (
    <div className="p-4 sm:p-10 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Аналитика</h1>
        <div className="flex gap-2">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                period === p.key ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">
        KPI по завершённым сделкам за выбранный период. Воронка и график дохода — независимо от фильтра.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon="💰" label="Оборот" value={money(turnover)} />
        <StatCard icon="🎁" label="Доход (комиссия)" value={money(revenue)} />
        <StatCard icon="💵" label="Средний чек" value={doneInPeriod.length ? money(avgCheck) : '—'} />
        <StatCard icon="⏱️" label="Цикл сделки" value={avgCycleDays != null ? `${avgCycleDays.toFixed(1)} дн.` : '—'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4">
          <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">Доход по месяцам</div>
          <div className="text-xs text-slate-400 mb-3">Комиссия по завершённым сделкам, последние 6 месяцев</div>
          {monthly.every(m => m.revenue === 0) ? (
            <EmptyState text="Пока нет завершённых сделок с суммой" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: tickColor }} axisLine={{ stroke: gridColor }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 12, fill: tickColor }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={v => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                />
                <Tooltip content={<MoneyTooltip dark={dark} />} />
                <Line type="monotone" dataKey="revenue" name="Доход" stroke={brandLine} strokeWidth={2} dot={{ r: 3, fill: brandLine }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4">
          <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">Воронка по стадиям</div>
          <div className="text-xs text-slate-400 mb-3">Сколько стримеров сейчас на каждом этапе</div>
          {funnel.every(f => f.count === 0) ? (
            <EmptyState text="Сделок пока нет" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={funnel} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: tickColor }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="stage" tick={{ fontSize: 12, fill: tickColor }} axisLine={false} tickLine={false} width={110} />
                <Tooltip content={<CountTooltip dark={dark} />} cursor={{ fill: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }} />
                <Bar dataKey="count" name="Стримеров" radius={[0, 4, 4, 0]} barSize={20}>
                  {funnel.map((_, i) => (
                    <Cell key={i} fill={brandBar} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-brand-900 font-semibold text-slate-900 dark:text-slate-100">
          Топ-стримеры {period !== 'all' && <span className="text-slate-400 font-normal text-sm">за период</span>}
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-brand-900/50">
            <tr>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">#</th>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Стример</th>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Сделок</th>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Доход</th>
            </tr>
          </thead>
          <tbody>
            {topStreamers.map((s, i) => (
              <tr key={s.name} className="border-t border-slate-100 dark:border-brand-900">
                <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{i + 1}</td>
                <td className="px-4 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap">{s.name}</td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{s.deals}</td>
                <td className="px-4 py-2 text-brand-600 dark:text-brand-400 whitespace-nowrap">{money(s.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {topStreamers.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Завершённых сделок за период пока нет</div>}
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4">
      <div className="flex items-center gap-2 text-xl mb-1">
        <span>{icon}</span>
      </div>
      <div className="text-xl font-bold text-slate-900 dark:text-slate-100 truncate">{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="h-[240px] flex items-center justify-center text-sm text-slate-400">{text}</div>
}

function tooltipBoxClass(dark: boolean) {
  return `rounded-lg border px-3 py-2 text-sm shadow-lg ${
    dark ? 'bg-brand-950 border-brand-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
  }`
}

function MoneyTooltip({ active, payload, label, dark }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className={tooltipBoxClass(dark)}>
      <div className="text-xs text-slate-400 mb-0.5">{label}</div>
      <div className="font-medium">{money(payload[0].value)}</div>
    </div>
  )
}

function CountTooltip({ active, payload, dark }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className={tooltipBoxClass(dark)}>
      <div className="text-xs text-slate-400 mb-0.5">{payload[0].payload.stage}</div>
      <div className="font-medium">{payload[0].value} стримеров</div>
    </div>
  )
}
