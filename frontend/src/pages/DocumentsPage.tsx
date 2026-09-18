import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  integrationsApi,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_COLOR,
  CONTENT_LABELS,
} from '../api/integrations'
import type { ContentStatus, ContractStatus, Streamer } from '../api/integrations'

interface Row extends Streamer {
  brand: string
}

type Tab = 'contracts' | 'briefs'

const TABS: { key: Tab; label: string }[] = [
  { key: 'contracts', label: 'Договоры' },
  { key: 'briefs', label: 'ТЗ' },
]

const selectCls = "bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
const dotColor: Record<'red' | 'yellow' | 'green', string> = { red: '🔴', yellow: '🟡', green: '🟢' }

// значения ["queryKey": ['integrations']] используются и здесь, и в канбане, и в маркировке -
// invalidateQueries после любой мутации обновляет данные везде одновременно
export default function DocumentsPage() {
  const qc = useQueryClient()
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const [tab, setTab] = useState<Tab>('contracts')
  const [q, setQ] = useState('')

  const rows: Row[] = useMemo(
    () =>
      integrations
        .flatMap(it => it.streamers.map(s => ({ ...s, brand: it.brand })))
        .filter(r => r.stage !== 'cancelled')
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [integrations]
  )

  const filtered = rows.filter(
    r => !q.trim() || r.brand.toLowerCase().includes(q.toLowerCase()) || r.streamer_name.toLowerCase().includes(q.toLowerCase())
  )

  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations'] })

  const update = useMutation({
    mutationFn: ({ id, p }: { id: number; p: Partial<Streamer> }) => integrationsApi.updateStreamer(id, p),
    onSuccess: invalidate,
  })
  const uploadContract = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => integrationsApi.uploadContract(id, file),
    onSuccess: invalidate,
  })
  const removeContract = useMutation({
    mutationFn: (id: number) => integrationsApi.removeContract(id),
    onSuccess: invalidate,
  })

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Документы</h1>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Поиск по бренду или стримеру"
          className="w-full sm:w-64 bg-slate-100 dark:bg-brand-900 border border-transparent focus:border-brand-500 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none"
        />
      </div>
      <p className="text-slate-500 dark:text-slate-400 mb-4 text-sm">
        Договоры и ТЗ по всем сделкам. Изменения здесь сразу видны на канбане и наоборот.
      </p>

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

      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        {tab === 'contracts' && (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-brand-900/50">
              <tr>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Бренд</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Стример</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Файл</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Статус</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Отправлен</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Подписан</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Действует до</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-brand-900">
                  <td className="px-3 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap">{r.brand}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{r.streamer_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.contract_file_name ? (
                      <div className="flex items-center gap-2">
                        <a href={integrationsApi.contractUrl(r.id)} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                          📎 {r.contract_file_name}
                        </a>
                        <button onClick={() => removeContract.mutate(r.id)} className="text-xs text-red-500 hover:text-red-700">удалить</button>
                      </div>
                    ) : (
                      <input
                        type="file"
                        onChange={e => e.target.files?.[0] && uploadContract.mutate({ id: r.id, file: e.target.files[0] })}
                        className="text-xs text-slate-600 dark:text-slate-300 w-48"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <select
                      value={r.contract_status}
                      onChange={e => update.mutate({ id: r.id, p: { contract_status: e.target.value as ContractStatus } })}
                      className={selectCls}
                    >
                      {Object.entries(CONTRACT_STATUS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{dotColor[CONTRACT_STATUS_COLOR[k as ContractStatus]]} {v}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <input
                      type="date"
                      value={r.contract_sent_date ? r.contract_sent_date.slice(0, 10) : ''}
                      onChange={e => update.mutate({ id: r.id, p: { contract_sent_date: e.target.value || null } })}
                      className={selectCls}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <input
                      type="date"
                      value={r.contract_signed_date ? r.contract_signed_date.slice(0, 10) : ''}
                      onChange={e => update.mutate({ id: r.id, p: { contract_signed_date: e.target.value || null } })}
                      className={selectCls}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <input
                      type="date"
                      value={r.contract_valid_until ? r.contract_valid_until.slice(0, 10) : ''}
                      onChange={e => update.mutate({ id: r.id, p: { contract_valid_until: e.target.value || null } })}
                      className={selectCls}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'briefs' && (
          <div className="divide-y divide-slate-100 dark:divide-brand-900">
            {filtered.map(r => (
              <BriefRow
                key={r.id}
                row={r}
                onSave={text => update.mutate({ id: r.id, p: { brief: text } })}
                onStatusChange={status => update.mutate({ id: r.id, p: { content_status: status } })}
              />
            ))}
          </div>
        )}

        {filtered.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Ничего не найдено</div>}
      </div>
    </div>
  )
}

function BriefRow({
  row,
  onSave,
  onStatusChange,
}: {
  row: Row
  onSave: (text: string) => void
  onStatusChange: (status: ContentStatus) => void
}) {
  const [text, setText] = useState(row.brief)
  const [dirty, setDirty] = useState(false)

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <span className="text-sm text-slate-900 dark:text-slate-100">{row.brand} <span className="text-slate-400">· {row.streamer_name}</span></span>
        <div className="flex items-center gap-2">
          <select
            value={row.content_status ?? ''}
            onChange={e => onStatusChange(e.target.value as ContentStatus)}
            className={selectCls}
          >
            <option value="">— статус не задан —</option>
            {Object.entries(CONTENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {dirty && (
            <button
              onClick={() => { onSave(text); setDirty(false) }}
              className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-2 py-0.5 rounded-md"
            >
              Сохранить
            </button>
          )}
        </div>
      </div>
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setDirty(true) }}
        rows={2}
        placeholder="ТЗ ещё не заполнено"
        className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
      />
    </div>
  )
}
