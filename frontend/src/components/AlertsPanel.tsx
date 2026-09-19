import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { integrationsApi } from '../api/integrations'
import type { ContractStatus, Streamer } from '../api/integrations'

interface AlertItem {
  id: number
  brand: string
  streamer: string
  detail: string
}

interface AlertGroup {
  key: string
  title: string
  items: AlertItem[]
}

// активные стадии - те, где дедлайн/договор/оплата ещё имеют значение
const ACTIVE_STAGES = ['negotiation', 'agreed', 'awaiting_contract', 'awaiting_payment']
const CONTRACT_PENDING: ContractStatus[] = ['sent_to_streamer', 'sent_to_brand']

type Row = Streamer & { brand: string }

// значение ["queryKey": ['integrations']] то же, что и на канбане/в документах -
// алерты всегда синхронны с остальными разделами без дополнительных запросов
export default function AlertsPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const rows: Row[] = useMemo(
    () => integrations.flatMap(it => it.streamers.map(s => ({ ...s, brand: it.brand }))),
    [integrations]
  )

  const groups: AlertGroup[] = useMemo(() => {
    const now = dayjs()
    const toItems = (list: Row[], detail: (r: Row) => string): AlertItem[] =>
      list.map(r => ({ id: r.id, brand: r.brand, streamer: r.streamer_name, detail: detail(r) }))

    const drafts = rows.filter(r => r.stage === 'negotiation' && (r.amount == null || !r.deadline))

    const deadlineSoon = rows.filter(r => {
      if (!r.deadline || !ACTIVE_STAGES.includes(r.stage)) return false
      const diff = dayjs(r.deadline).startOf('day').diff(now.startOf('day'), 'day')
      return diff >= 0 && diff <= 3
    })

    const deadlineOverdue = rows.filter(
      r => !!r.deadline && ACTIVE_STAGES.includes(r.stage) && dayjs(r.deadline).startOf('day').isBefore(now.startOf('day'))
    )

    const contractOverdue = rows.filter(
      r =>
        CONTRACT_PENDING.includes(r.contract_status) &&
        !!r.contract_sent_date &&
        now.diff(dayjs(r.contract_sent_date), 'day') > 5
    )

    const paymentOverdue = rows.filter(
      r =>
        r.payment_status !== 'paid' &&
        r.payment_status !== 'not_invoiced' &&
        !!r.deadline &&
        r.stage !== 'cancelled' &&
        dayjs(r.deadline).startOf('day').isBefore(now.startOf('day'))
    )

    const caseMissing = rows.filter(r => r.stage === 'done' && !r.has_case)

    return [
      { key: 'drafts', title: 'Черновики без суммы/даты', items: toItems(drafts, () => 'заполните карточку') },
      { key: 'deadlineSoon', title: 'Дедлайн через 1-3 дня', items: toItems(deadlineSoon, r => dayjs(r.deadline).format('DD.MM')) },
      { key: 'deadlineOverdue', title: 'Дедлайн просрочен', items: toItems(deadlineOverdue, r => dayjs(r.deadline).format('DD.MM')) },
      {
        key: 'contractOverdue',
        title: 'Договор > 5 дней без ответа',
        items: toItems(contractOverdue, r => `отправлен ${dayjs(r.contract_sent_date).format('DD.MM')}`),
      },
      { key: 'paymentOverdue', title: 'Оплата просрочена', items: toItems(paymentOverdue, r => `дедлайн ${dayjs(r.deadline).format('DD.MM')}`) },
      { key: 'caseMissing', title: 'Завершено, нет кейса для сайта', items: toItems(caseMissing, () => 'добавьте кейс') },
    ].filter(g => g.items.length > 0)
  }, [rows])

  const total = groups.reduce((sum, g) => sum + g.items.length, 0)
  const hot = total > 0

  const close = () => {
    setOpen(false)
    onNavigate?.()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
          hot
            ? 'alert-glow text-red-700 dark:text-red-300 font-medium'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-brand-900'
        }`}
      >
        <span className={`relative text-base ${hot ? 'animate-pulse' : ''}`}>🔥</span>
        <span className="flex-1 text-left">Горячие задачи</span>
        {hot && (
          <span className="relative flex items-center justify-center shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
            <span className="relative min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
              {total > 99 ? '99+' : total}
            </span>
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 bottom-full mb-2 max-h-[60vh] overflow-y-auto bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl shadow-lg">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-brand-900 font-semibold text-slate-900 dark:text-slate-100">
            🔥 Горячие задачи{hot && <span className="text-slate-400 font-normal"> ({total})</span>}
          </div>
          {groups.length === 0 && (
            <div className="px-4 py-6 text-sm text-slate-400 text-center">Всё спокойно, ничего горящего нет.</div>
          )}
          {groups.map(g => (
            <div key={g.key} className="px-2 py-2 border-b border-slate-50 dark:border-brand-900/60 last:border-0">
              <div className="px-2 py-1 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                {g.title} · {g.items.length}
              </div>
              {g.items.slice(0, 6).map(item => (
                <Link
                  key={item.id}
                  to={`/integrations?open=${item.id}`}
                  onClick={close}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-900"
                >
                  <span className="truncate">
                    <span className="font-medium">{item.brand}</span>
                    <span className="text-slate-400"> × {item.streamer}</span>
                  </span>
                  <span className="text-xs text-slate-400 shrink-0">{item.detail}</span>
                </Link>
              ))}
              {g.items.length > 6 && <div className="px-2 py-1 text-xs text-slate-400">и ещё {g.items.length - 6}…</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
