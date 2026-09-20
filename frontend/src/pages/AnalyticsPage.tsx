import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
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
type Tab = 'overview' | 'streamers' | 'brands'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
  { key: 'all', label: 'Всё время' },
]

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Обзор' },
  { key: 'streamers', label: 'Стримеры' },
  { key: 'brands', label: 'Рекламодатели' },
]

interface Row extends Streamer {
  brand: string
}

const STAGE_LABELS: Record<string, string> = Object.fromEntries(STAGES.map(s => [s.key, s.label]))

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

// «сколько денег уже пришло» - считаем по проценту оплаты, он приходит с бэка
function paidAmount(r: Row): number {
  if (r.amount == null) return 0
  if (r.payment_status === 'paid') return r.amount
  if (r.paid_percent != null) return (r.amount * r.paid_percent) / 100
  return 0
}

export default function AnalyticsPage() {
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const { theme } = useTheme()
  const [period, setPeriod] = useState<Period>('month')
  const [tab, setTab] = useState<Tab>('overview')
  const [openStreamer, setOpenStreamer] = useState<string | null>(null)
  const [openBrand, setOpenBrand] = useState<string | null>(null)

  const dark = theme === 'dark'
  const chart = {
    grid: dark ? '#14735f' : '#e2e8f0',
    tick: dark ? '#94a3b8' : '#64748b',
    line: dark ? '#3dd0ae' : '#159075',
    bar: dark ? '#1fb491' : '#159075',
    dark,
  }

  const rows: Row[] = useMemo(
    () => integrations.flatMap(it => it.streamers.map(s => ({ ...s, brand: it.brand }))),
    [integrations]
  )

  const start = periodStart(period)
  const doneInPeriod = useMemo(
    () => rows.filter(r => r.stage === 'done' && (!start || dayjs(r.updated_at).isAfter(start))),
    [rows, start]
  )

  return (
    <div className="p-4 sm:p-10 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Аналитика</h1>
        <div className="flex gap-2 flex-wrap">
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

      <div className="flex gap-2 mb-6 border-b border-slate-200 dark:border-brand-900">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${
              tab === t.key
                ? 'border-brand-600 text-brand-600 dark:text-brand-400 font-medium'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview rows={rows} doneInPeriod={doneInPeriod} chart={chart} />}
      {tab === 'streamers' && (
        <StreamersTab rows={rows} doneInPeriod={doneInPeriod} onOpen={setOpenStreamer} />
      )}
      {tab === 'brands' && <BrandsTab rows={rows} doneInPeriod={doneInPeriod} onOpen={setOpenBrand} />}

      {openStreamer && (
        <StreamerDetail name={openStreamer} rows={rows} chart={chart} onClose={() => setOpenStreamer(null)} />
      )}
      {openBrand && <BrandDetail brand={openBrand} rows={rows} onClose={() => setOpenBrand(null)} />}
    </div>
  )
}

// ---------- обзор ----------

interface ChartColors {
  grid: string
  tick: string
  line: string
  bar: string
  dark: boolean
}

function Overview({ rows, doneInPeriod, chart }: { rows: Row[]; doneInPeriod: Row[]; chart: ChartColors }) {
  const turnover = doneInPeriod.reduce((sum, r) => sum + (r.amount ?? 0), 0)
  const revenue = doneInPeriod.reduce((sum, r) => sum + (r.commission_amount ?? 0), 0)
  const avgCheck = doneInPeriod.length ? turnover / doneInPeriod.length : 0
  const avgCycleDays = useMemo(() => {
    const withDates = doneInPeriod.filter(r => r.created_at && r.updated_at)
    if (withDates.length === 0) return null
    const total = withDates.reduce((sum, r) => sum + dayjs(r.updated_at).diff(dayjs(r.created_at), 'day'), 0)
    return total / withDates.length
  }, [doneInPeriod])

  // сколько денег ещё не пришло по незакрытым сделкам - это «дебиторка»
  const outstanding = useMemo(
    () =>
      rows
        .filter(r => r.stage !== 'cancelled' && r.payment_status !== 'paid')
        .reduce((sum, r) => sum + ((r.amount ?? 0) - paidAmount(r)), 0),
    [rows]
  )

  const monthly = useMemo(() => {
    const months = Array.from({ length: 6 }).map((_, i) => dayjs().subtract(5 - i, 'month').startOf('month'))
    return months.map(m => ({
      month: m.format('MMM YY'),
      revenue: Math.round(
        rows.filter(r => r.stage === 'done' && dayjs(r.updated_at).isSame(m, 'month')).reduce((s, r) => s + (r.commission_amount ?? 0), 0)
      ),
    }))
  }, [rows])

  const funnel = useMemo(
    () => STAGES.filter(s => s.key !== 'cancelled').map(s => ({ stage: s.label, count: rows.filter(r => r.stage === s.key).length })),
    [rows]
  )

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCard icon="💰" label="Оборот" value={money(turnover)} />
        <StatCard icon="🎁" label="Доход (комиссия)" value={money(revenue)} />
        <StatCard icon="💵" label="Средний чек" value={doneInPeriod.length ? money(avgCheck) : '—'} />
        <StatCard icon="⏱️" label="Цикл сделки" value={avgCycleDays != null ? `${avgCycleDays.toFixed(1)} дн.` : '—'} />
        <StatCard icon="⏳" label="Ждём оплаты" value={outstanding > 0 ? money(outstanding) : '—'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Доход по месяцам" hint="Комиссия по завершённым сделкам, последние 6 месяцев">
          {monthly.every(m => m.revenue === 0) ? (
            <EmptyState text="Пока нет завершённых сделок с суммой" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: chart.tick }} axisLine={{ stroke: chart.grid }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 12, fill: chart.tick }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={v => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                />
                <Tooltip content={<MoneyTooltip dark={chart.dark} />} />
                <Line type="monotone" dataKey="revenue" name="Доход" stroke={chart.line} strokeWidth={2} dot={{ r: 3, fill: chart.line }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Воронка по стадиям" hint="Сколько стримеров сейчас на каждом этапе">
          {funnel.every(f => f.count === 0) ? (
            <EmptyState text="Сделок пока нет" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={funnel} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: chart.tick }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="stage" tick={{ fontSize: 12, fill: chart.tick }} axisLine={false} tickLine={false} width={110} />
                <Tooltip content={<CountTooltip dark={chart.dark} />} cursor={{ fill: chart.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }} />
                <Bar dataKey="count" name="Стримеров" radius={[0, 4, 4, 0]} barSize={20}>
                  {funnel.map((_, i) => (
                    <Cell key={i} fill={chart.bar} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>
    </>
  )
}

// ---------- стримеры ----------

interface StreamerAgg {
  name: string
  deals: number
  done: number
  cancelled: number
  turnover: number
  revenue: number
  avgCheck: number
  missedDeadlines: number
  reliability: number | null
}

function aggregateStreamers(rows: Row[], doneInPeriod: Row[]): StreamerAgg[] {
  const map = new Map<string, StreamerAgg>()

  // база - все сделки за всё время: надёжность по одному периоду считать бессмысленно
  for (const r of rows) {
    const e = map.get(r.streamer_name) ?? {
      name: r.streamer_name, deals: 0, done: 0, cancelled: 0,
      turnover: 0, revenue: 0, avgCheck: 0, missedDeadlines: 0, reliability: null,
    }
    e.deals += 1
    if (r.stage === 'done') e.done += 1
    if (r.stage === 'cancelled') e.cancelled += 1
    // срыв дедлайна: сделка ещё не закрыта, а срок уже прошёл
    if (r.deadline && r.stage !== 'done' && r.stage !== 'cancelled' && dayjs(r.deadline).isBefore(dayjs(), 'day')) {
      e.missedDeadlines += 1
    }
    map.set(r.streamer_name, e)
  }

  // деньги - только за выбранный период, по завершённым
  for (const r of doneInPeriod) {
    const e = map.get(r.streamer_name)
    if (!e) continue
    e.turnover += r.amount ?? 0
    e.revenue += r.commission_amount ?? 0
  }

  for (const e of map.values()) {
    const finished = e.done + e.cancelled
    e.reliability = finished > 0 ? Math.round((e.done / finished) * 100) : null
    const doneWithMoney = doneInPeriod.filter(r => r.streamer_name === e.name && r.amount != null)
    e.avgCheck = doneWithMoney.length ? e.turnover / doneWithMoney.length : 0
  }

  return [...map.values()].sort((a, b) => b.revenue - a.revenue || b.deals - a.deals)
}

function StreamersTab({ rows, doneInPeriod, onOpen }: { rows: Row[]; doneInPeriod: Row[]; onOpen: (n: string) => void }) {
  const [q, setQ] = useState('')
  const aggs = useMemo(() => aggregateStreamers(rows, doneInPeriod), [rows, doneInPeriod])
  const filtered = aggs.filter(a => !q.trim() || a.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Деньги — за выбранный период, надёжность — за всё время. Нажмите на стримера, чтобы раскрыть карточку.
        </p>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Поиск"
          className="w-40 sm:w-56 shrink-0 bg-slate-100 dark:bg-brand-900 border border-transparent focus:border-brand-500 rounded-lg px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none"
        />
      </div>

      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-brand-900/50">
            <tr>
              <Th>Стример</Th>
              <Th>Сделок</Th>
              <Th>Оборот</Th>
              <Th>Доход</Th>
              <Th>Средний чек</Th>
              <Th>Надёжность</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => (
              <tr
                key={a.name}
                onClick={() => onOpen(a.name)}
                className="border-t border-slate-100 dark:border-brand-900 cursor-pointer hover:bg-slate-50 dark:hover:bg-brand-900/40"
              >
                <td className="px-4 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap font-medium">{a.name}</td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                  {a.deals}
                  {a.cancelled > 0 && <span className="text-red-400 text-xs"> ({a.cancelled} отм.)</span>}
                </td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{a.turnover > 0 ? money(a.turnover) : '—'}</td>
                <td className="px-4 py-2 text-brand-600 dark:text-brand-400 whitespace-nowrap">{a.revenue > 0 ? money(a.revenue) : '—'}</td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{a.avgCheck > 0 ? money(a.avgCheck) : '—'}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <ReliabilityBadge value={a.reliability} missed={a.missedDeadlines} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Стримеров пока нет</div>}
      </div>
    </div>
  )
}

function ReliabilityBadge({ value, missed }: { value: number | null; missed: number }) {
  if (value == null) {
    return <span className="text-slate-400 text-xs">{missed > 0 ? `${missed} просроч.` : 'нет данных'}</span>
  }
  const color =
    value >= 90
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
      : value >= 60
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
  return (
    <span className="flex items-center gap-1.5">
      <span className={`text-xs px-2 py-0.5 rounded-full ${color}`}>{value}%</span>
      {missed > 0 && <span className="text-xs text-red-400">{missed} просроч.</span>}
    </span>
  )
}

function StreamerDetail({ name, rows, chart, onClose }: { name: string; rows: Row[]; chart: ChartColors; onClose: () => void }) {
  const mine = useMemo(
    () => rows.filter(r => r.streamer_name === name).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [rows, name]
  )
  const done = mine.filter(r => r.stage === 'done')

  const totalEarned = done.reduce((s, r) => s + (r.amount ?? 0), 0)
  const myRevenue = done.reduce((s, r) => s + (r.commission_amount ?? 0), 0)
  const streamerNet = done.reduce((s, r) => s + (r.streamer_net_amount ?? 0), 0)
  const awaiting = mine
    .filter(r => r.stage !== 'cancelled' && r.payment_status !== 'paid')
    .reduce((s, r) => s + ((r.amount ?? 0) - paidAmount(r)), 0)

  // бренды, с которыми этот стример уже работал - видно, кто берёт повторно
  const brands = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of mine) m.set(r.brand, (m.get(r.brand) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [mine])

  const monthly = useMemo(() => {
    const months = Array.from({ length: 6 }).map((_, i) => dayjs().subtract(5 - i, 'month').startOf('month'))
    return months.map(m => ({
      month: m.format('MMM YY'),
      revenue: Math.round(done.filter(r => dayjs(r.updated_at).isSame(m, 'month')).reduce((s, r) => s + (r.amount ?? 0), 0)),
    }))
  }, [done])

  return (
    <Modal title={name} subtitle={`${mine.length} сделок за всё время`} onClose={onClose}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard icon="💰" label="Заработал всего" value={money(totalEarned)} compact />
        <StatCard icon="🎁" label="Наша комиссия" value={money(myRevenue)} compact />
        <StatCard icon="🪙" label="На руки стримеру" value={money(streamerNet)} compact />
        <StatCard icon="⏳" label="Ждём оплаты" value={awaiting > 0 ? money(awaiting) : '—'} compact />
      </div>

      {brands.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Бренды</div>
          <div className="flex flex-wrap gap-1.5">
            {brands.map(([b, n]) => (
              <span key={b} className="text-xs bg-slate-100 dark:bg-brand-900 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-full">
                {b}{n > 1 && <span className="text-brand-500"> ×{n}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {monthly.some(m => m.revenue > 0) && (
        <Panel title="Суммы по месяцам" hint="Сумма завершённых сделок, последние 6 месяцев" className="mb-4">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: chart.tick }} axisLine={{ stroke: chart.grid }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: chart.tick }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={v => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
              />
              <Tooltip content={<MoneyTooltip dark={chart.dark} />} />
              <Line type="monotone" dataKey="revenue" stroke={chart.line} strokeWidth={2} dot={{ r: 3, fill: chart.line }} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      )}

      <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">История сделок</div>
      <DealsTable deals={mine} showBrand />
    </Modal>
  )
}

// ---------- бренды ----------

interface BrandAgg {
  brand: string
  deals: number
  streamers: number
  turnover: number
  revenue: number
  lastDeal: string | null
}

function BrandsTab({ rows, doneInPeriod, onOpen }: { rows: Row[]; doneInPeriod: Row[]; onOpen: (b: string) => void }) {
  const aggs = useMemo(() => {
    const map = new Map<string, BrandAgg & { names: Set<string> }>()
    for (const r of rows) {
      const e = map.get(r.brand) ?? { brand: r.brand, deals: 0, streamers: 0, turnover: 0, revenue: 0, lastDeal: null, names: new Set<string>() }
      e.deals += 1
      e.names.add(r.streamer_name)
      if (!e.lastDeal || new Date(r.updated_at) > new Date(e.lastDeal)) e.lastDeal = r.updated_at
      map.set(r.brand, e)
    }
    for (const r of doneInPeriod) {
      const e = map.get(r.brand)
      if (!e) continue
      e.turnover += r.amount ?? 0
      e.revenue += r.commission_amount ?? 0
    }
    return [...map.values()]
      .map(e => ({ ...e, streamers: e.names.size }))
      .sort((a, b) => b.revenue - a.revenue || b.deals - a.deals)
  }, [rows, doneInPeriod])

  return (
    <div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
        Кто приносит деньги и кто давно не возвращался. Нажмите на бренд, чтобы раскрыть историю.
      </p>
      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-brand-900/50">
            <tr>
              <Th>Рекламодатель</Th>
              <Th>Сделок</Th>
              <Th>Стримеров</Th>
              <Th>Оборот</Th>
              <Th>Доход</Th>
              <Th>Последняя сделка</Th>
            </tr>
          </thead>
          <tbody>
            {aggs.map(a => {
              const daysSince = a.lastDeal ? dayjs().diff(dayjs(a.lastDeal), 'day') : null
              return (
                <tr
                  key={a.brand}
                  onClick={() => onOpen(a.brand)}
                  className="border-t border-slate-100 dark:border-brand-900 cursor-pointer hover:bg-slate-50 dark:hover:bg-brand-900/40"
                >
                  <td className="px-4 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap font-medium">{a.brand}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{a.deals}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{a.streamers}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{a.turnover > 0 ? money(a.turnover) : '—'}</td>
                  <td className="px-4 py-2 text-brand-600 dark:text-brand-400 whitespace-nowrap">{a.revenue > 0 ? money(a.revenue) : '—'}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {a.lastDeal ? (
                      <span className={daysSince != null && daysSince > 90 ? 'text-amber-500' : 'text-slate-500 dark:text-slate-400'}>
                        {dayjs(a.lastDeal).format('DD.MM.YY')}
                        {daysSince != null && daysSince > 90 && <span className="text-xs"> · {daysSince} дн. назад</span>}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {aggs.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Рекламодателей пока нет</div>}
      </div>
    </div>
  )
}

function BrandDetail({ brand, rows, onClose }: { brand: string; rows: Row[]; onClose: () => void }) {
  const mine = useMemo(
    () => rows.filter(r => r.brand === brand).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [rows, brand]
  )
  const done = mine.filter(r => r.stage === 'done')
  const turnover = done.reduce((s, r) => s + (r.amount ?? 0), 0)
  const revenue = done.reduce((s, r) => s + (r.commission_amount ?? 0), 0)
  const awaiting = mine
    .filter(r => r.stage !== 'cancelled' && r.payment_status !== 'paid')
    .reduce((s, r) => s + ((r.amount ?? 0) - paidAmount(r)), 0)

  const topStreamers = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of mine) m.set(r.streamer_name, (m.get(r.streamer_name) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [mine])

  return (
    <Modal title={brand} subtitle={`${mine.length} сделок за всё время`} onClose={onClose}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard icon="💰" label="Оборот" value={money(turnover)} compact />
        <StatCard icon="🎁" label="Наш доход" value={money(revenue)} compact />
        <StatCard icon="🎮" label="Стримеров" value={String(topStreamers.length)} compact />
        <StatCard icon="⏳" label="Ждём оплаты" value={awaiting > 0 ? money(awaiting) : '—'} compact />
      </div>

      {topStreamers.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Работали с брендом</div>
          <div className="flex flex-wrap gap-1.5">
            {topStreamers.map(([n, c]) => (
              <span key={n} className="text-xs bg-slate-100 dark:bg-brand-900 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-full">
                {n}{c > 1 && <span className="text-brand-500"> ×{c}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">История сделок</div>
      <DealsTable deals={mine} />
    </Modal>
  )
}

// ---------- общее ----------

function DealsTable({ deals, showBrand }: { deals: Row[]; showBrand?: boolean }) {
  return (
    <div className="border border-slate-200 dark:border-brand-900 rounded-lg overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 dark:bg-brand-900/50">
          <tr>
            <Th>{showBrand ? 'Бренд' : 'Стример'}</Th>
            <Th>Статус</Th>
            <Th>Сумма</Th>
            <Th>Оплата</Th>
            <Th>Дата</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {deals.map(d => (
            <tr key={d.id} className="border-t border-slate-100 dark:border-brand-900">
              <td className="px-3 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap">{showBrand ? d.brand : d.streamer_name}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  d.stage === 'done'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : d.stage === 'cancelled'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                      : 'bg-slate-100 text-slate-600 dark:bg-brand-900 dark:text-slate-300'
                }`}>
                  {STAGE_LABELS[d.stage] ?? d.stage}
                </span>
              </td>
              <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                {d.amount != null ? `${d.amount.toLocaleString('ru-RU')} ${d.currency}` : '—'}
              </td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap text-xs">
                {d.payment_status === 'paid' ? '100%' : d.paid_percent != null ? `${d.paid_percent}%` : '—'}
              </td>
              <td className="px-3 py-2 text-slate-400 whitespace-nowrap text-xs">
                {dayjs(d.integration_date ?? d.updated_at).format('DD.MM.YY')}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Link to={`/integrations?open=${d.id}`} className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
                  открыть
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {deals.length === 0 && <div className="text-sm text-slate-400 text-center py-6">Сделок нет</div>}
    </div>
  )
}

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none shrink-0">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Panel({ title, hint, children, className = '' }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4 ${className}`}>
      <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">{title}</div>
      {hint && <div className="text-xs text-slate-400 mb-3">{hint}</div>}
      {children}
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap font-medium">{children}</th>
}

function StatCard({ icon, label, value, compact }: { icon: string; label: string; value: string; compact?: boolean }) {
  return (
    <div className={`bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl ${compact ? 'p-3' : 'p-4'}`}>
      <div className={`${compact ? 'text-base' : 'text-xl'} mb-1`}>{icon}</div>
      <div className={`${compact ? 'text-base' : 'text-xl'} font-bold text-slate-900 dark:text-slate-100 truncate`}>{value}</div>
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
