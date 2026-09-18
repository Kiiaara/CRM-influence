import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  integrationsApi,
  ORD_RESPONSIBLE_LABELS,
  ORD_STATUS_LABELS,
  ORD_REPORTING_LABELS,
} from '../api/integrations'
import type { OrdReportingStatus, OrdResponsible, OrdStatus, Streamer } from '../api/integrations'

interface Row extends Streamer {
  brand: string
}

type Filter = 'all' | 'todo' | 'overdue'

const selectCls = "bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-slate-100"

const REPORTING_COLORS: Record<OrdReportingStatus, string> = {
  not_submitted: 'bg-slate-100 text-slate-600 dark:bg-brand-900 dark:text-slate-300',
  submitted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

const STATUS_COLORS: Record<OrdStatus, string> = {
  todo: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}

export default function MarkingPage() {
  const qc = useQueryClient()
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const rows: Row[] = useMemo(
    () =>
      integrations
        .flatMap(it => it.streamers.map(s => ({ ...s, brand: it.brand })))
        .filter(r => r.stage !== 'cancelled')
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [integrations]
  )

  const update = useMutation({
    mutationFn: ({ id, p }: { id: number; p: Partial<Streamer> }) => integrationsApi.updateStreamer(id, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  })

  const filtered = rows.filter(r => {
    if (filter === 'todo' && r.ord_status !== 'todo') return false
    if (filter === 'overdue' && r.ord_reporting_status !== 'overdue') return false
    if (q.trim() && !r.brand.toLowerCase().includes(q.toLowerCase()) && !r.streamer_name.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })

  const todoCount = rows.filter(r => r.ord_status === 'todo').length
  const overdueCount = rows.filter(r => r.ord_reporting_status === 'overdue').length

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Маркировка (ОРД)</h1>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Поиск по бренду или стримеру"
          className="w-full sm:w-64 bg-slate-100 dark:bg-brand-900 border border-transparent focus:border-brand-500 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none"
        />
      </div>
      <p className="text-slate-500 dark:text-slate-400 mb-4 text-sm">
        Кто маркирует рекламу и сдал ли отчётность в ОРД по каждому размещению. Всего: {rows.length}
      </p>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-full text-sm border ${filter === 'all' ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300'}`}
        >
          Все ({rows.length})
        </button>
        <button
          onClick={() => setFilter('todo')}
          className={`px-3 py-1.5 rounded-full text-sm border ${filter === 'todo' ? 'bg-amber-600 border-amber-600 text-white' : 'border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300'}`}
        >
          Не размечено ({todoCount})
        </button>
        <button
          onClick={() => setFilter('overdue')}
          className={`px-3 py-1.5 rounded-full text-sm border ${filter === 'overdue' ? 'bg-red-600 border-red-600 text-white' : 'border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300'}`}
        >
          Просрочена отчётность ({overdueCount})
        </button>
      </div>

      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-brand-900/50">
            <tr>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Бренд</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Стример</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Ответственный</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Маркировка</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Отчётность в ОРД</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-brand-900">
                <td className="px-3 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap">{r.brand}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{r.streamer_name}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <select
                    value={r.ord_responsible}
                    onChange={e => update.mutate({ id: r.id, p: { ord_responsible: e.target.value as OrdResponsible } })}
                    className={selectCls}
                  >
                    {Object.entries(ORD_RESPONSIBLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <select
                    value={r.ord_status}
                    onChange={e => update.mutate({ id: r.id, p: { ord_status: e.target.value as OrdStatus } })}
                    className={`${selectCls} ${STATUS_COLORS[r.ord_status]}`}
                  >
                    {Object.entries(ORD_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <select
                    value={r.ord_reporting_status}
                    onChange={e => update.mutate({ id: r.id, p: { ord_reporting_status: e.target.value as OrdReportingStatus } })}
                    className={`${selectCls} ${REPORTING_COLORS[r.ord_reporting_status]}`}
                  >
                    {Object.entries(ORD_REPORTING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Ничего не найдено</div>}
      </div>
    </div>
  )
}
