import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
  campaignsApi,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_COLORS,
} from '../api/campaigns'
import type { CampaignPayload, CampaignStatus } from '../api/campaigns'
import { advertisersApi } from '../api/advertisers'
import { tasksApi } from '../api/tasks'

const cellInput =
  'w-full bg-transparent border border-transparent hover:border-slate-200 dark:hover:border-brand-800 focus:border-brand-400 rounded px-1.5 py-1 text-sm text-slate-900 dark:text-slate-100 outline-none'

export default function CampaignsPage() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [hideClosed, setHideClosed] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: campaigns = [] } = useQuery({ queryKey: ['campaigns'], queryFn: campaignsApi.list })
  const { data: advertisers = [] } = useQuery({ queryKey: ['advertisers'], queryFn: advertisersApi.list })
  const { data: assignees = [] } = useQuery({ queryKey: ['task-assignees'], queryFn: tasksApi.assignees })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['campaigns'] })

  const create = useMutation({
    mutationFn: (name: string) => campaignsApi.create({ name }),
    onSuccess: () => { invalidate(); setNewName(''); setAdding(false); setError(null) },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось создать'),
  })
  const update = useMutation({
    mutationFn: ({ id, p }: { id: number; p: CampaignPayload }) => campaignsApi.update(id, p),
    onSuccess: () => { invalidate(); setError(null) },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось сохранить'),
  })
  const remove = useMutation({
    mutationFn: (id: number) => campaignsApi.remove(id),
    onSuccess: invalidate,
  })

  const rows = useMemo(() => {
    let list = campaigns
    if (hideClosed) list = list.filter(c => c.status !== 'cancelled' && c.status !== 'running')
    if (q.trim()) {
      const needle = q.toLowerCase()
      list = list.filter(
        c =>
          c.name.toLowerCase().includes(needle) ||
          (c.advertiser_name ?? '').toLowerCase().includes(needle)
      )
    }
    return list
  }, [campaigns, hideClosed, q])

  const closedCount = campaigns.filter(c => c.status === 'cancelled' || c.status === 'running').length

  const set = (id: number, p: CampaignPayload) => update.mutate({ id, p })

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Рекламные кампании</h1>
        <button
          onClick={() => setAdding(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium w-full sm:w-auto"
        >
          + Новая РК
        </button>
      </div>
      <p className="text-slate-500 dark:text-slate-400 mb-4 text-sm">
        Запросы от брендов: от поступления до запуска. Правится прямо в таблице.
      </p>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Поиск по названию или бренду"
          className="w-full sm:w-64 bg-slate-100 dark:bg-brand-900 border border-transparent focus:border-brand-500 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none"
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 cursor-pointer">
          <input type="checkbox" checked={hideClosed} onChange={e => setHideClosed(e.target.checked)} />
          Скрыть запущенные и отменённые ({closedCount})
        </label>
      </div>

      {error && <div className="text-sm text-red-500 mb-3">{error}</div>}

      {adding && (
        <div className="bg-white dark:bg-brand-950 border border-brand-300 dark:border-brand-700 rounded-xl p-4 mb-4 flex gap-2">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newName.trim()) create.mutate(newName.trim())
              if (e.key === 'Escape') { setAdding(false); setNewName('') }
            }}
            placeholder="Название кампании"
            className="flex-1 bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
          <button
            onClick={() => newName.trim() && create.mutate(newName.trim())}
            disabled={!newName.trim() || create.isPending}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm shrink-0"
          >
            Создать
          </button>
          <button
            onClick={() => { setAdding(false); setNewName('') }}
            className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-brand-900 shrink-0"
          >
            Отмена
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-brand-900/50">
            <tr>
              <Th>Название РК</Th>
              <Th>Рекламодатель</Th>
              <Th>Запрос от</Th>
              <Th>ДЛ подборки</Th>
              <Th>ДЛ РК</Th>
              <Th>Статус</Th>
              <Th>Бюджет</Th>
              <Th>Ответственный</Th>
              <Th>Комментарий</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id} className="border-t border-slate-100 dark:border-brand-900 align-top">
                <td className="px-2 py-1.5 min-w-[160px]">
                  <TextCell value={c.name} onSave={v => v.trim() && set(c.id, { name: v })} />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={c.advertiser_id ?? ''}
                    onChange={e => set(c.id, { advertiser_id: e.target.value ? Number(e.target.value) : null })}
                    className={`${cellInput} min-w-[120px]`}
                  >
                    <option value="">—</option>
                    {advertisers.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <DateCell value={c.requested_at} onSave={v => set(c.id, { requested_at: v })} />
                </td>
                <td className="px-2 py-1.5">
                  <DateCell value={c.selection_due_at} onSave={v => set(c.id, { selection_due_at: v })} highlight />
                </td>
                <td className="px-2 py-1.5">
                  <DateCell value={c.campaign_due_at} onSave={v => set(c.id, { campaign_due_at: v })} highlight />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={c.status}
                    onChange={e => set(c.id, { status: e.target.value as CampaignStatus })}
                    className={`rounded-full px-2 py-1 text-xs outline-none border-0 ${CAMPAIGN_STATUS_COLORS[c.status]}`}
                  >
                    {CAMPAIGN_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <NumberCell
                    value={c.budget}
                    currency={c.currency}
                    onSave={v => set(c.id, { budget: v })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={c.owner_tg_id ?? ''}
                    onChange={e => set(c.id, { owner_tg_id: e.target.value ? Number(e.target.value) : null })}
                    className={`${cellInput} min-w-[110px]`}
                  >
                    <option value="">—</option>
                    {assignees.map(a => <option key={a.tg_id} value={a.tg_id}>{a.label}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5 min-w-[160px]">
                  <TextCell value={c.notes} placeholder="—" onSave={v => set(c.id, { notes: v })} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={() => confirm(`Удалить «${c.name}»?`) && remove.mutate(c.id)}
                    className="text-slate-300 hover:text-red-500 text-xs"
                    title="Удалить"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="text-sm text-slate-400 text-center py-10">
            {campaigns.length === 0
              ? 'Кампаний пока нет. Нажмите «Новая РК», чтобы завести первую.'
              : 'Ничего не найдено'}
          </div>
        )}
      </div>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-2 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap font-medium text-xs">{children}</th>
}

// правка по месту: коммитим на blur, чтобы не дёргать сеть на каждую букву
function TextCell({
  value,
  placeholder,
  onSave,
}: {
  value: string
  placeholder?: string
  onSave: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft) }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur() }
      }}
      className={cellInput}
    />
  )
}

function DateCell({
  value,
  onSave,
  highlight,
}: {
  value: string | null
  onSave: (v: string | null) => void
  highlight?: boolean
}) {
  const serverValue = value ? value.slice(0, 10) : ''
  const [draft, setDraft] = useState(serverValue)
  useEffect(() => { setDraft(serverValue) }, [serverValue])

  // дедлайн горит, если он сегодня или уже прошёл
  const overdue =
    highlight && serverValue ? dayjs(serverValue).isBefore(dayjs(), 'day') : false
  const today = highlight && serverValue ? dayjs(serverValue).isSame(dayjs(), 'day') : false

  return (
    <input
      type="date"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== serverValue) onSave(draft || null) }}
      className={`${cellInput} ${
        overdue ? 'text-red-600 dark:text-red-400 font-medium' : today ? 'text-amber-600 dark:text-amber-400 font-medium' : ''
      }`}
    />
  )
}

function NumberCell({
  value,
  currency,
  onSave,
}: {
  value: number | null
  currency: string
  onSave: (v: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  useEffect(() => { setDraft(value != null ? String(value) : '') }, [value])

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    const next = trimmed ? Number(trimmed) : null
    if (trimmed && !Number.isFinite(next)) { setDraft(value != null ? String(value) : ''); return }
    if (next !== value) onSave(next)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value != null ? String(value) : ''); setEditing(false) }
        }}
        className={`${cellInput} min-w-[90px]`}
      />
    )
  }

  return (
    <button onClick={() => setEditing(true)} className={`${cellInput} text-left whitespace-nowrap`}>
      {value != null ? `${value.toLocaleString('ru-RU')} ${currency}` : <span className="text-slate-300 dark:text-slate-600">—</span>}
    </button>
  )
}
