import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { integrationsApi } from '../api/integrations'
import { campaignsApi } from '../api/campaigns'
import { useWorkspace } from '../workspaceContext'
import { buildDealGroups } from '../utils/alerts'
import type { AlertGroup, AlertItem, AlertRow } from '../utils/alerts'

// значение ["queryKey": ['integrations']] то же, что и в документах/маркировке -
// алерты всегда синхронны с остальными разделами без дополнительных запросов
export default function AlertsPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const { data: campaigns = [] } = useQuery({ queryKey: ['campaigns'], queryFn: () => campaignsApi.list() })
  // настройки пространства: выключен раздел Кейсы или напоминания про черновики - эти группы не показываем
  const { current } = useWorkspace()
  const casesEnabled = current?.cases_enabled !== false
  const draftAlertsEnabled = current?.draft_alerts_enabled !== false
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // кампания сделки нужна, чтобы открыть модалку блогера; сделки вне кампании отсеет buildDealGroups
  const rows: AlertRow[] = useMemo(
    () => integrations.flatMap(it => it.streamers.map(s => ({ ...s, brand: it.brand, campaign_id: it.campaign_id }))),
    [integrations]
  )

  const groups: AlertGroup[] = useMemo(() => {
    const now = dayjs()

    // кампании: подборку надо отдать вовремя, иначе клиент уходит
    // завершённые (archived_at) в алерты не попадают, даже если список вдруг пришёл с ними
    const liveCampaigns = campaigns.filter(c => c.status !== 'cancelled' && c.status !== 'running' && !c.archived_at)
    const campaignItems = (
      list: typeof liveCampaigns,
      detail: (c: (typeof liveCampaigns)[number]) => string
    ): AlertItem[] =>
      list.map(c => ({
        id: c.id,
        brand: c.advertiser_name ?? 'без бренда',
        streamer: c.name,
        detail: detail(c),
        to: '/campaigns',
      }))

    // подборку напоминаем только пока её делают: со статуса "отдали подборку" и дальше
    // она уже у клиента, и срок сдачи не горит
    const pickingCampaigns = liveCampaigns.filter(c => c.status === 'picking')

    const selectionOverdue = pickingCampaigns.filter(
      c => !!c.selection_due_at && dayjs(c.selection_due_at).startOf('day').isBefore(now.startOf('day'))
    )
    const selectionSoon = pickingCampaigns.filter(c => {
      if (!c.selection_due_at) return false
      const diff = dayjs(c.selection_due_at).startOf('day').diff(now.startOf('day'), 'day')
      return diff >= 0 && diff <= 2
    })
    const campaignDueSoon = liveCampaigns.filter(c => {
      if (!c.campaign_due_at) return false
      const diff = dayjs(c.campaign_due_at).startOf('day').diff(now.startOf('day'), 'day')
      return diff >= 0 && diff <= 3
    })

    const campaignGroups: AlertGroup[] = [
      {
        key: 'selectionOverdue',
        title: 'Подборка просрочена',
        items: campaignItems(selectionOverdue, c => dayjs(c.selection_due_at).format('DD.MM')),
      },
      {
        key: 'selectionSoon',
        title: 'Подборку сдавать через 1-2 дня',
        items: campaignItems(selectionSoon, c => dayjs(c.selection_due_at).format('DD.MM')),
      },
      {
        key: 'campaignDueSoon',
        title: 'Дедлайн РК на подходе',
        items: campaignItems(campaignDueSoon, c => dayjs(c.campaign_due_at).format('DD.MM')),
      },
    ]

    // группы по сделкам блогеров (фильтры и условия - в utils/alerts.ts)
    const dealGroups = buildDealGroups(rows, { now: now.toDate(), casesEnabled, draftAlertsEnabled })

    return [...campaignGroups, ...dealGroups].filter(g => g.items.length > 0)
  }, [rows, campaigns, casesEnabled, draftAlertsEnabled])

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
                  key={`${g.key}-${item.id}`}
                  to={item.to}
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
