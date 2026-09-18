import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { integrationsApi, PAYMENT_LABELS, describeAuditEntry } from '../api/integrations'
import type { AuditLogEntry, Streamer } from '../api/integrations'
import { StreamerModal } from './IntegrationsBoard'

interface Row extends Streamer {
  brand: string
}

type Tab = 'done' | 'audit'

const TABS: { key: Tab; label: string }[] = [
  { key: 'done', label: 'Завершённые' },
  { key: 'audit', label: 'Журнал изменений' },
]

export default function HistoryPage() {
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const [tab, setTab] = useState<Tab>('done')
  const [editing, setEditing] = useState<Row | null>(null)
  const [q, setQ] = useState('')

  const rows: Row[] = useMemo(() => {
    const done = integrations.flatMap(it => it.streamers.map(s => ({ ...s, brand: it.brand })).filter(s => s.stage === 'done'))
    return done.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }, [integrations])

  const filtered = rows.filter(r =>
    !q.trim() ||
    r.brand.toLowerCase().includes(q.toLowerCase()) ||
    r.streamer_name.toLowerCase().includes(q.toLowerCase())
  )

  const totalAmount = filtered.reduce((sum, r) => sum + (r.amount ?? 0), 0)
  const totalCommission = filtered.reduce((sum, r) => sum + (r.commission_amount ?? 0), 0)

  const { data: auditEntries = [] } = useQuery({
    queryKey: ['audit-log-feed'],
    queryFn: () => integrationsApi.auditLogFeed(150),
    enabled: tab === 'audit',
  })
  const filteredAudit = auditEntries.filter((e: AuditLogEntry) =>
    !q.trim() ||
    e.brand.toLowerCase().includes(q.toLowerCase()) ||
    e.streamer_name.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">История</h1>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Поиск по бренду или стримеру"
          className="w-full sm:w-64 bg-slate-100 dark:bg-brand-900 border border-transparent focus:border-brand-500 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none"
        />
      </div>

      <div className="flex gap-2 mb-4">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              tab === t.key ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'done' && (
        <>
          <p className="text-slate-500 dark:text-slate-400 mb-4 text-sm">
            Завершённые интеграции (стадия «Завершено»). Всего: {filtered.length}
            {totalAmount > 0 && <> · Σ {Math.round(totalAmount).toLocaleString('ru-RU')} ₽</>}
            {totalCommission > 0 && <> · комиссия {Math.round(totalCommission).toLocaleString('ru-RU')} ₽</>}
          </p>

          <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-brand-900/50">
                <tr>
                  <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Бренд</th>
                  <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Стример</th>
                  <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Сумма</th>
                  <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Комиссия</th>
                  <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Оплата</th>
                  <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Завершено</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => setEditing(r)}
                    className="border-t border-slate-100 dark:border-brand-900 hover:bg-slate-50 dark:hover:bg-brand-900/30 cursor-pointer"
                  >
                    <td className="px-3 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap">{r.brand}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{r.streamer_name}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {r.amount != null ? `${r.amount.toLocaleString('ru-RU')} ${r.currency}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-brand-600 dark:text-brand-400 whitespace-nowrap">
                      {r.commission_amount != null ? `${r.commission_amount.toLocaleString('ru-RU')} ${r.currency}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{PAYMENT_LABELS[r.payment_status]}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {new Date(r.updated_at).toLocaleDateString('ru-RU')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Завершённых интеграций пока нет</div>}
          </div>
        </>
      )}

      {tab === 'audit' && (
        <>
          <p className="text-slate-500 dark:text-slate-400 mb-4 text-sm">
            Кто и когда менял сделки: стадии, суммы, статусы договора и оплаты. Последние {filteredAudit.length} записей.
          </p>
          <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl divide-y divide-slate-100 dark:divide-brand-900">
            {filteredAudit.map(e => (
              <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="text-slate-700 dark:text-slate-300">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{e.brand}</span>
                  <span className="text-slate-400"> × {e.streamer_name}</span>
                  <span className="text-slate-400"> — </span>
                  {describeAuditEntry(e)}
                  <span className="text-slate-400"> · {e.author_label ?? 'кто-то'}</span>
                </span>
                <span className="text-xs text-slate-400 shrink-0 whitespace-nowrap">
                  {new Date(e.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
            {filteredAudit.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Изменений пока нет</div>}
          </div>
        </>
      )}

      {editing && (
        <StreamerModal streamer={editing} brand={editing.brand} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
