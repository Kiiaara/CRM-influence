import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  integrationsApi,
  STAGES,
  PAYMENT_LABELS,
  CONTENT_LABELS,
  ORD_RESPONSIBLE_LABELS,
  ORD_STATUS_LABELS,
  ORD_REPORTING_LABELS,
  CONTRACT_STATUS_LABELS,
} from '../api/integrations'
import type {
  CaseStudy,
  ContentStatus,
  ContractStatus,
  DiscussionMessage,
  Integration,
  OrdReportingStatus,
  OrdResponsible,
  OrdStatus,
  Payment,
  PaymentStatus,
  Stage,
  Streamer,
} from '../api/integrations'
import { advertisersApi } from '../api/advertisers'
import { streamerProfilesApi } from '../api/streamerProfiles'
import { workspacesApi } from '../api/workspaces'
import type { WorkspaceMember } from '../api/workspaces'
import { useWorkspace } from '../workspaceContext'

const PAYMENT_COLORS: Record<PaymentStatus, string> = {
  not_invoiced: 'bg-slate-100 text-slate-600 dark:bg-brand-900 dark:text-slate-300',
  invoiced: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  partial: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// плоская карточка стримера + бренд сделки, для рендера на канбане
interface Card extends Streamer {
  brand: string
}

export default function IntegrationsBoard() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<{ streamer: Streamer; brand: string } | null>(null)
  const [pickingBrand, setPickingBrand] = useState(false)
  const [bulkFor, setBulkFor] = useState<number | null>(null)
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null)
  const [mobileStage, setMobileStage] = useState<Stage>('negotiation')
  const [searchParams, setSearchParams] = useSearchParams()
  const [summaryFor, setSummaryFor] = useState<Integration | null>(null)
  const dragData = useRef<{ id: number; stage: Stage } | null>(null)

  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const { data: unreadCounts = {} } = useQuery({
    queryKey: ['discussion-unread'],
    queryFn: integrationsApi.unreadDiscussionCounts,
    refetchInterval: 15000,
  })

  const cards: Card[] = useMemo(
    () => integrations.flatMap(it => it.streamers.map(s => ({ ...s, brand: it.brand }))),
    [integrations]
  )

  // открытие карточки стримера по ?open=<streamer_id>, например из поиска
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || cards.length === 0) return
    const found = cards.find(c => c.id === Number(openId))
    if (found) {
      setEditing({ streamer: found, brand: found.brand })
      searchParams.delete('open')
      setSearchParams(searchParams, { replace: true })
    }
  }, [cards, searchParams, setSearchParams])

  // открытие сводки по всей сделке по ?deal=<integration_id> - персональная ссылка на сделку,
  // можно кинуть коллеге в чат
  useEffect(() => {
    const dealId = searchParams.get('deal')
    if (!dealId || integrations.length === 0) return
    const found = integrations.find(i => i.id === Number(dealId))
    if (found) {
      setSummaryFor(found)
      searchParams.delete('deal')
      setSearchParams(searchParams, { replace: true })
    }
  }, [integrations, searchParams, setSearchParams])

  const updateStreamer = useMutation({
    mutationFn: ({ id, p }: { id: number; p: Partial<Streamer> }) => integrationsApi.updateStreamer(id, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  })

  const byStage = (stage: Stage) => cards.filter(c => c.stage === stage)
  const totalAmount = (stage: Stage) => byStage(stage).reduce((sum, c) => sum + (c.amount ?? 0), 0)

  const onDrop = (stage: Stage) => {
    setDragOverStage(null)
    const raw = dragData.current
    if (!raw || raw.stage === stage) return
    updateStreamer.mutate({ id: raw.id, p: { stage } })
  }

  const renderCard = (c: Card) => (
    <div
      key={c.id}
      draggable
      onDragStart={() => { dragData.current = { id: c.id, stage: c.stage } }}
      onClick={() => setEditing({ streamer: c, brand: c.brand })}
      className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-lg p-3 cursor-pointer hover:border-brand-400 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-slate-400 flex items-center gap-1.5 min-w-0">
          <span className="truncate">{c.brand}</span>
          <button
            onClick={e => {
              e.stopPropagation()
              const it = integrations.find(i => i.id === c.integration_id)
              if (it) setSummaryFor(it)
            }}
            title="Открыть сделку целиком / ссылка"
            className="shrink-0 text-slate-300 hover:text-brand-500"
          >
            🔗
          </button>
        </div>
        {!!unreadCounts[c.id] && (
          <span className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-white bg-brand-600 rounded-full px-1.5 py-0.5">
            💬 {unreadCounts[c.id]}
          </span>
        )}
      </div>
      <div className="font-medium text-sm text-slate-900 dark:text-slate-100">{c.streamer_name}</div>
      <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
        <span className={`text-[11px] px-1.5 py-0.5 rounded ${PAYMENT_COLORS[c.payment_status]}`}>
          {PAYMENT_LABELS[c.payment_status]}
        </span>
        {c.content_status && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            {CONTENT_LABELS[c.content_status]}
          </span>
        )}
        {c.amount != null && (
          <span className="text-xs text-slate-500 dark:text-slate-400">{c.amount.toLocaleString('ru-RU')} {c.currency}</span>
        )}
      </div>
      {c.integration_date && (
        <div className="text-[11px] text-violet-500 mt-1">
          🎬 {new Date(c.integration_date).toLocaleDateString('ru-RU')}{c.integration_time && ` в ${c.integration_time}`}
        </div>
      )}
    </div>
  )

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Интеграции</h1>
        <button
          onClick={() => setPickingBrand(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium w-full sm:w-auto"
        >
          + Стримеры на бренд
        </button>
      </div>

      {/* Мобилка: табы по стадиям + список карточек одной колонки */}
      <div className="sm:hidden">
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4">
          {STAGES.map(s => (
            <button
              key={s.key}
              onClick={() => setMobileStage(s.key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm border ${
                mobileStage === s.key
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {s.label} ({byStage(s.key).length})
            </button>
          ))}
        </div>
        {totalAmount(mobileStage) > 0 && (
          <div className="text-xs text-slate-400 mb-2">Σ {totalAmount(mobileStage).toLocaleString('ru-RU')} ₽</div>
        )}
        <div className="space-y-2">
          {byStage(mobileStage).map(renderCard)}
          {byStage(mobileStage).length === 0 && (
            <div className="text-sm text-slate-400 text-center py-8">Пусто</div>
          )}
        </div>
      </div>

      {/* Десктоп: полноценный канбан с drag&drop */}
      <div className="hidden sm:flex gap-4 overflow-x-auto pb-4">
        {STAGES.map(s => (
          <div
            key={s.key}
            onDragOver={e => { e.preventDefault(); setDragOverStage(s.key) }}
            onDragLeave={() => setDragOverStage(null)}
            onDrop={() => onDrop(s.key)}
            className={`w-72 shrink-0 rounded-xl border ${dragOverStage === s.key ? 'border-brand-400 bg-brand-50/50 dark:bg-brand-900/10' : 'border-slate-200 dark:border-brand-900'} bg-slate-50 dark:bg-brand-950/40`}
          >
            <div className="px-3 py-2 flex items-center justify-between border-b border-slate-200 dark:border-brand-900">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{s.label}</div>
              <div className="text-xs text-slate-400">{byStage(s.key).length}</div>
            </div>
            {totalAmount(s.key) > 0 && (
              <div className="px-3 pt-2 text-xs text-slate-400">
                Σ {totalAmount(s.key).toLocaleString('ru-RU')} ₽
              </div>
            )}
            <div className="p-2 space-y-2 min-h-[80px]">
              {byStage(s.key).map(renderCard)}
            </div>
          </div>
        ))}
      </div>

      {pickingBrand && (
        <BrandPickerModal
          integrations={integrations}
          onClose={() => setPickingBrand(false)}
          onPicked={(integrationId) => {
            setPickingBrand(false)
            setBulkFor(integrationId)
          }}
        />
      )}

      {bulkFor != null && (
        <BulkStreamersModal
          integrationId={bulkFor}
          brand={integrations.find(i => i.id === bulkFor)?.brand ?? ''}
          onClose={() => {
            setBulkFor(null)
            qc.invalidateQueries({ queryKey: ['integrations'] })
          }}
        />
      )}

      {editing && (
        <StreamerModal
          streamer={editing.streamer}
          brand={editing.brand}
          onClose={() => setEditing(null)}
        />
      )}

      {summaryFor && (
        <IntegrationSummaryModal
          integration={summaryFor}
          onClose={() => setSummaryFor(null)}
          onOpenStreamer={s => {
            setSummaryFor(null)
            setEditing({ streamer: s, brand: summaryFor.brand })
          }}
        />
      )}
    </div>
  )
}

// сводка по сделке целиком (бренд + все стримеры в пуле) - открывается по клику на 🔗
// с карточки канбана или по прямой ссылке /integrations?deal=<id>, чтобы можно было её кинуть коллеге
function IntegrationSummaryModal({
  integration,
  onClose,
  onOpenStreamer,
}: {
  integration: Integration
  onClose: () => void
  onOpenStreamer: (s: Streamer) => void
}) {
  const [copied, setCopied] = useState(false)

  const copyLink = () => {
    const url = `${window.location.origin}/integrations?deal=${integration.id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const totalAmount = integration.streamers.reduce((s, x) => s + (x.amount ?? 0), 0)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{integration.brand}</h2>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={integrationsApi.exportUrl(integration.id)}
              className="text-xs border border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300 hover:border-brand-400 px-3 py-1.5 rounded-lg"
              title="Скачать сделку в Excel"
            >
              ⬇ Excel
            </a>
            <button
              onClick={copyLink}
              className="text-xs border border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300 hover:border-brand-400 px-3 py-1.5 rounded-lg"
            >
              {copied ? '✓ Скопировано' : '🔗 Ссылка'}
            </button>
          </div>
        </div>
        {integration.description && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{integration.description}</p>
        )}
        <div className="text-xs text-slate-400 mb-4">
          {integration.streamers.length} стример(ов){totalAmount > 0 && ` · Σ ${totalAmount.toLocaleString('ru-RU')} ₽`}
        </div>

        <div className="space-y-2">
          {integration.streamers.map(s => (
            <div
              key={s.id}
              onClick={() => onOpenStreamer(s)}
              className="flex items-center justify-between gap-2 border border-slate-200 dark:border-brand-900 rounded-lg px-3 py-2 cursor-pointer hover:border-brand-400"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{s.streamer_name}</div>
                <div className="text-xs text-slate-400">{STAGES.find(st => st.key === s.stage)?.label ?? s.stage}</div>
              </div>
              {s.amount != null && (
                <div className="text-xs text-slate-500 dark:text-slate-400 shrink-0">{s.amount.toLocaleString('ru-RU')} {s.currency}</div>
              )}
            </div>
          ))}
          {integration.streamers.length === 0 && <div className="text-xs text-slate-400">Стримеров в сделке ещё нет</div>}
        </div>

        <div className="flex justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-900 rounded-lg">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}

function BrandPickerModal({
  integrations,
  onClose,
  onPicked,
}: {
  integrations: Integration[]
  onClose: () => void
  onPicked: (integrationId: number) => void
}) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'existing' | 'new'>(integrations.length ? 'existing' : 'new')
  const [selectedId, setSelectedId] = useState<number | ''>('')
  const [advMode, setAdvMode] = useState<'pick' | 'create'>('pick')
  const [selectedAdvId, setSelectedAdvId] = useState<number | ''>('')
  const [newAdvName, setNewAdvName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: advertisers = [] } = useQuery({ queryKey: ['advertisers'], queryFn: advertisersApi.list })

  const createIntegration = useMutation({
    mutationFn: (advertiserId: number) => integrationsApi.create({ advertiser_id: advertiserId }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      onPicked(data.id)
    },
  })

  const createAdvertiserAndIntegration = useMutation({
    mutationFn: async (name: string) => {
      const adv = await advertisersApi.create({ name })
      qc.invalidateQueries({ queryKey: ['advertisers'] })
      return integrationsApi.create({ advertiser_id: adv.id })
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      onPicked(data.id)
    },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось создать рекламодателя'),
  })

  const handleNext = () => {
    setError(null)
    if (mode === 'existing') {
      if (!selectedId) return
      onPicked(Number(selectedId))
      return
    }
    if (advMode === 'pick') {
      if (!selectedAdvId) return
      createIntegration.mutate(Number(selectedAdvId))
    } else {
      if (!newAdvName.trim()) return
      createAdvertiserAndIntegration.mutate(newAdvName.trim())
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Какой бренд?</h2>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('existing')}
            disabled={integrations.length === 0}
            className={`flex-1 text-sm px-3 py-2 rounded-lg border ${mode === 'existing' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300'} disabled:opacity-40`}
          >
            Существующая сделка
          </button>
          <button
            onClick={() => setMode('new')}
            className={`flex-1 text-sm px-3 py-2 rounded-lg border ${mode === 'new' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300'}`}
          >
            Новая сделка
          </button>
        </div>

        {mode === 'existing' ? (
          <select
            value={selectedId}
            onChange={e => setSelectedId(Number(e.target.value))}
            className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
          >
            <option value="">— выбери бренд —</option>
            {integrations.map(it => (
              <option key={it.id} value={it.id}>{it.brand} ({it.streamers.length})</option>
            ))}
          </select>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2 text-xs">
              <button
                onClick={() => setAdvMode('pick')}
                className={`px-2 py-1 rounded-md border ${advMode === 'pick' ? 'border-brand-500 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-brand-800 text-slate-500'}`}
              >
                Рекламодатель из базы
              </button>
              <button
                onClick={() => setAdvMode('create')}
                className={`px-2 py-1 rounded-md border ${advMode === 'create' ? 'border-brand-500 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-brand-800 text-slate-500'}`}
              >
                + Новый рекламодатель
              </button>
            </div>
            {advMode === 'pick' ? (
              <select
                value={selectedAdvId}
                onChange={e => setSelectedAdvId(Number(e.target.value))}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              >
                <option value="">— выбери рекламодателя —</option>
                {advertisers.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            ) : (
              <input
                value={newAdvName}
                onChange={e => setNewAdvName(e.target.value)}
                placeholder="Название рекламодателя"
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            )}
          </div>
        )}
        {error && <div className="text-xs text-red-500 mt-2">{error}</div>}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-900 rounded-lg">Отмена</button>
          <button
            onClick={handleNext}
            className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Далее
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkStreamersModal({
  integrationId,
  brand,
  onClose,
}: {
  integrationId: number
  brand: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { data: profiles = [] } = useQuery({ queryKey: ['streamer-profiles'], queryFn: streamerProfilesApi.list })
  const { data: legacyNames = [] } = useQuery({ queryKey: ['streamer-names'], queryFn: integrationsApi.streamerNames })

  const [selectedProfiles, setSelectedProfiles] = useState<Set<number>>(new Set())
  const [manualNames, setManualNames] = useState('')
  const [search, setSearch] = useState('')

  const [commonDeadline, setCommonDeadline] = useState('')
  const [commonCommission, setCommonCommission] = useState(15)
  const [commonTax, setCommonTax] = useState(6)

  const filteredProfiles = profiles.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))

  const toggleProfile = (id: number) => {
    setSelectedProfiles(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addBulk = useMutation({
    mutationFn: async () => {
      const names = [
        ...profiles.filter(p => selectedProfiles.has(p.id)).map(p => p.name),
        ...manualNames.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
      ]
      const uniqueNames = [...new Set(names)]
      for (const name of uniqueNames) {
        const profile = profiles.find(p => p.name === name)
        await integrationsApi.addStreamer(integrationId, {
          streamer_name: name,
          contact: profile?.social_links ?? '',
          amount: profile?.post_price ?? null,
          commission_percent: commonCommission,
          streamer_tax_percent: commonTax,
          deadline: commonDeadline || null,
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      onClose()
    },
  })

  const totalSelected = selectedProfiles.size + manualNames.split(/[,\n]/).map(s => s.trim()).filter(Boolean).length

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="text-xs text-slate-400 mb-1">{brand}</div>
        <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Добавить стримеров</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Общий дедлайн</label>
            <input type="date" value={commonDeadline} onChange={e => setCommonDeadline(e.target.value)} className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100" />
          </div>
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Комиссия, %</label>
            <input type="number" value={commonCommission} onChange={e => setCommonCommission(Number(e.target.value))} className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100" />
          </div>
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Налог стримера, %</label>
            <input type="number" value={commonTax} onChange={e => setCommonTax(Number(e.target.value))} className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100" />
          </div>
        </div>
        <p className="text-xs text-slate-400 mb-4">Сумму, стадию и статус контента каждому стримеру выставишь отдельно в его карточке — они у всех разные.</p>

        {profiles.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Выбери из базы стримеров</div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по имени…"
              className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 mb-2"
            />
            <div className="border border-slate-200 dark:border-brand-900 rounded-lg max-h-48 overflow-y-auto">
              {filteredProfiles.map(p => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-brand-900/50 border-b border-slate-100 dark:border-brand-900 last:border-0 cursor-pointer">
                  <input type="checkbox" checked={selectedProfiles.has(p.id)} onChange={() => toggleProfile(p.id)} className="w-4 h-4" />
                  <span className="text-slate-700 dark:text-slate-300">{p.name}</span>
                  {p.category && <span className="text-xs text-slate-400">· {p.category}</span>}
                  {p.post_price != null && <span className="text-xs text-slate-400 ml-auto">{p.post_price.toLocaleString('ru-RU')} ₽</span>}
                </label>
              ))}
              {filteredProfiles.length === 0 && <div className="px-3 py-4 text-sm text-slate-400 text-center">Ничего не найдено</div>}
            </div>
          </div>
        )}

        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            Или впиши новых стримеров (через запятую или с новой строки){legacyNames.length > 0 && ' — уже вводили: ' + legacyNames.slice(0, 5).join(', ')}
          </label>
          <textarea
            value={manualNames}
            onChange={e => setManualNames(e.target.value)}
            rows={3}
            placeholder="Стример1, Стример2, ..."
            className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="flex justify-between items-center mt-6">
          <div className="text-xs text-slate-400">Выбрано: {totalSelected}</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-900 rounded-lg">Отмена</button>
            <button
              onClick={() => addBulk.mutate()}
              disabled={totalSelected === 0 || addBulk.isPending}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              {addBulk.isPending ? 'Добавляю…' : `Добавить (${totalSelected})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function StreamerModal({
  streamer,
  brand,
  onClose,
}: {
  streamer: Streamer
  brand: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Streamer>(streamer)
  const isNew = streamer.id === 0
  const [nameOpen, setNameOpen] = useState(false)

  const { data: allNames = [] } = useQuery({ queryKey: ['streamer-names'], queryFn: integrationsApi.streamerNames })
  const nameSuggestions = allNames.filter(n =>
    n.toLowerCase().includes(form.streamer_name.toLowerCase()) && n !== form.streamer_name
  ).slice(0, 8)

  const { data: payments = [] } = useQuery({
    queryKey: ['streamers', streamer.id, 'payments'],
    queryFn: () => integrationsApi.payments(streamer.id),
    enabled: !isNew,
  })

  const update = useMutation({
    mutationFn: (p: Partial<Streamer>) => integrationsApi.updateStreamer(streamer.id, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      onClose()
    },
  })

  const remove = useMutation({
    mutationFn: () => integrationsApi.removeStreamer(streamer.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      onClose()
    },
  })

  const uploadContract = useMutation({
    mutationFn: (file: File) => integrationsApi.uploadContract(streamer.id, file),
    onSuccess: (data) => {
      setForm(f => ({ ...f, contract_file_name: data.contract_file_name }))
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
  })

  const removeContract = useMutation({
    mutationFn: () => integrationsApi.removeContract(streamer.id),
    onSuccess: () => {
      setForm(f => ({ ...f, contract_file_name: null }))
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
  })

  const addPayment = useMutation({
    mutationFn: (p: { amount: number; currency: string; comment: string }) => integrationsApi.addPayment(streamer.id, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['streamers', streamer.id, 'payments'] })
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
  })

  const removePayment = useMutation({
    mutationFn: (paymentId: number) => integrationsApi.removePayment(streamer.id, paymentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['streamers', streamer.id, 'payments'] }),
  })

  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentComment, setPaymentComment] = useState('')

  const save = () => {
    if (!form.streamer_name.trim()) return
    const payload: Partial<Streamer> = {
      streamer_name: form.streamer_name,
      contact: form.contact,
      stage: form.stage,
      payment_status: form.payment_status,
      content_status: form.content_status,
      amount: form.amount,
      currency: form.currency,
      commission_percent: form.commission_percent,
      streamer_tax_percent: form.streamer_tax_percent,
      deadline: form.deadline,
      integration_date: form.integration_date,
      integration_time: form.integration_time,
      description: form.description,
      contract_valid_until: form.contract_valid_until,
      contract_status: form.contract_status,
      contract_sent_date: form.contract_sent_date,
      contract_signed_date: form.contract_signed_date,
      contract_notes: form.contract_notes,
      brief: form.brief,
      ord_responsible: form.ord_responsible,
      ord_status: form.ord_status,
      ord_reporting_status: form.ord_reporting_status,
      ord_link: form.ord_link,
      ord_report_link: form.ord_report_link,
    }
    update.mutate(payload)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-4 px-4 py-6 overflow-y-auto"
      onClick={onClose}
    >
      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-xl w-full p-6 sm:max-h-[90vh] sm:overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="text-xs text-slate-400 mb-1">{brand}</div>
        <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">
          {isNew ? 'Новый стример' : form.streamer_name}
        </h2>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <label className="text-xs text-slate-500 dark:text-slate-400">Стример</label>
              <input
                value={form.streamer_name}
                onChange={e => { setForm({ ...form, streamer_name: e.target.value }); setNameOpen(true) }}
                onFocus={() => setNameOpen(true)}
                onBlur={() => setTimeout(() => setNameOpen(false), 150)}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
              {nameOpen && nameSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-lg shadow-xl max-h-40 overflow-auto z-10">
                  {nameSuggestions.map(n => (
                    <button
                      key={n}
                      onMouseDown={() => setForm({ ...form, streamer_name: n })}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-brand-50 dark:hover:bg-brand-900/30 text-slate-700 dark:text-slate-300"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Контакт</label>
              <input
                value={form.contact}
                onChange={e => setForm({ ...form, contact: e.target.value })}
                placeholder="TG / email / телефон"
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Стадия</label>
              <select
                value={form.stage}
                onChange={e => setForm({ ...form, stage: e.target.value as Stage })}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              >
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Оплата</label>
              <select
                value={form.payment_status}
                onChange={e => setForm({ ...form, payment_status: e.target.value as PaymentStatus })}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              >
                {Object.entries(PAYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Дедлайн</label>
              <input
                type="date"
                value={form.deadline ? form.deadline.slice(0, 10) : ''}
                onChange={e => setForm({ ...form, deadline: e.target.value || null })}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Дата интеграции (день выхода)</label>
              <input
                type="date"
                value={form.integration_date ? form.integration_date.slice(0, 10) : ''}
                onChange={e => setForm({ ...form, integration_date: e.target.value || null })}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Время старта стрима (если есть)</label>
              <input
                type="time"
                value={form.integration_time ?? ''}
                onChange={e => setForm({ ...form, integration_time: e.target.value || null })}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Статус контента</label>
            <select
              value={form.content_status ?? ''}
              onChange={e => setForm({ ...form, content_status: (e.target.value || null) as ContentStatus | null })}
              className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
            >
              <option value="">— не задан —</option>
              {Object.entries(CONTENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div className="border border-slate-200 dark:border-brand-900 rounded-lg p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Маркировка (ОРД)</div>
            <div className={`grid grid-cols-1 ${form.ord_responsible === 'not_required' ? '' : 'sm:grid-cols-3'} gap-3`}>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400">Ответственный</label>
                <select
                  value={form.ord_responsible}
                  onChange={e => setForm({ ...form, ord_responsible: e.target.value as OrdResponsible })}
                  className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
                >
                  {Object.entries(ORD_RESPONSIBLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {form.ord_responsible !== 'not_required' && (
                <>
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400">Маркировка</label>
                    <select
                      value={form.ord_status}
                      onChange={e => setForm({ ...form, ord_status: e.target.value as OrdStatus })}
                      className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
                    >
                      {Object.entries(ORD_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400">Отчётность</label>
                    <select
                      value={form.ord_reporting_status}
                      onChange={e => setForm({ ...form, ord_reporting_status: e.target.value as OrdReportingStatus })}
                      className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
                    >
                      {Object.entries(ORD_REPORTING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>
            {form.ord_responsible !== 'not_required' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <OrdLinkInput
                  label="Ссылка на ОРД"
                  placeholder="https://ord.vk.com/..."
                  value={form.ord_link}
                  onChange={v => setForm({ ...form, ord_link: v })}
                />
                <OrdLinkInput
                  label="Ссылка на отчётность"
                  placeholder="https://ord.vk.com/..."
                  value={form.ord_report_link}
                  onChange={v => setForm({ ...form, ord_report_link: v })}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Сумма</label>
              <input
                type="number"
                value={form.amount ?? ''}
                onChange={e => setForm({ ...form, amount: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Валюта</label>
              <select
                value={form.currency}
                onChange={e => setForm({ ...form, currency: e.target.value })}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              >
                <option value="RUB">₽ RUB</option>
                <option value="USD">$ USD</option>
                <option value="EUR">€ EUR</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Моя комиссия, %</label>
              <input
                type="number"
                value={form.commission_percent}
                onChange={e => setForm({ ...form, commission_percent: Number(e.target.value) })}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Налог стримера, %</label>
              <input
                type="number"
                value={form.streamer_tax_percent}
                onChange={e => setForm({ ...form, streamer_tax_percent: Number(e.target.value) })}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {form.amount != null && (
            <div className="bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg p-3 text-sm space-y-1">
              {(() => {
                const commission = round2(form.amount! * form.commission_percent / 100)
                const tax = round2(form.amount! * form.streamer_tax_percent / 100)
                const net = round2(form.amount! - commission - tax)
                return (
                  <>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Цена для клиента</span><span className="text-slate-900 dark:text-slate-100">{form.amount!.toLocaleString('ru-RU')} {form.currency}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Моя комиссия (трясти со стримера)</span><span className="text-brand-600 dark:text-brand-400 font-medium">{commission.toLocaleString('ru-RU')} {form.currency}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Налог стримера ({form.streamer_tax_percent}%)</span><span className="text-slate-600 dark:text-slate-300">{tax.toLocaleString('ru-RU')} {form.currency}</span></div>
                    <div className="flex justify-between border-t border-slate-200 dark:border-brand-800 pt-1"><span className="text-slate-500 dark:text-slate-400">Стримеру на руки</span><span className="text-emerald-600 dark:text-emerald-400 font-semibold">{net.toLocaleString('ru-RU')} {form.currency}</span></div>
                  </>
                )
              })()}
            </div>
          )}

          <div className="border border-slate-200 dark:border-brand-900 rounded-lg p-3 space-y-2">
            <div className="text-xs text-slate-500 dark:text-slate-400">Договор</div>
            {form.contract_file_name ? (
              <div className="flex items-center justify-between text-sm">
                <a href={integrationsApi.contractUrl(streamer.id)} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                  📎 {form.contract_file_name}
                </a>
                <button onClick={() => removeContract.mutate()} className="text-xs text-red-500 hover:text-red-700">Удалить</button>
              </div>
            ) : (
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-sm bg-slate-100 dark:bg-brand-900 hover:bg-slate-200 dark:hover:bg-brand-800 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg w-fit">
                <span>📎 Выберите файл</span>
                <input
                  type="file"
                  onChange={e => e.target.files?.[0] && uploadContract.mutate(e.target.files[0])}
                  className="hidden"
                />
              </label>
            )}

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Статус</label>
              <select
                value={form.contract_status}
                onChange={e => setForm({ ...form, contract_status: e.target.value as ContractStatus })}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              >
                {Object.entries(CONTRACT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400">Отправлен</label>
                <input
                  type="date"
                  value={form.contract_sent_date ? form.contract_sent_date.slice(0, 10) : ''}
                  onChange={e => setForm({ ...form, contract_sent_date: e.target.value || null })}
                  className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400">Подписан</label>
                <input
                  type="date"
                  value={form.contract_signed_date ? form.contract_signed_date.slice(0, 10) : ''}
                  onChange={e => setForm({ ...form, contract_signed_date: e.target.value || null })}
                  className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Действует до</label>
              <input
                type="date"
                value={form.contract_valid_until ? form.contract_valid_until.slice(0, 10) : ''}
                onChange={e => setForm({ ...form, contract_valid_until: e.target.value || null })}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Заметка по договору</label>
              <textarea
                value={form.contract_notes}
                onChange={e => setForm({ ...form, contract_notes: e.target.value })}
                rows={2}
                className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="border border-slate-200 dark:border-brand-900 rounded-lg p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">ТЗ</div>
            <textarea
              value={form.brief}
              onChange={e => setForm({ ...form, brief: e.target.value })}
              rows={3}
              placeholder="Что нужно снять/сказать, тайминг, требования бренда…"
              className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
            />
            {isNew ? (
              <div className="text-xs text-slate-400 mt-2">Файлы можно будет приложить после сохранения карточки</div>
            ) : (
              <BriefFiles streamerId={streamer.id} />
            )}
          </div>

          <Link
            to={`/advertisers?q=${encodeURIComponent(brand)}`}
            className="flex items-center justify-between text-sm border border-slate-200 dark:border-brand-900 rounded-lg px-3 py-2 text-brand-600 dark:text-brand-400 hover:bg-slate-50 dark:hover:bg-brand-900/30"
          >
            <span>🏢 Контакты и история сделок с «{brand}»</span>
            <span>→</span>
          </Link>

          <div className="border border-slate-200 dark:border-brand-900 rounded-lg p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">История оплат</div>
            <div className="space-y-1 mb-2">
              {payments.map((p: Payment) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 dark:text-slate-300">
                    {p.amount.toLocaleString('ru-RU')} {p.currency} — {new Date(p.paid_at).toLocaleDateString('ru-RU')}
                    {p.comment && <span className="text-slate-400"> ({p.comment})</span>}
                  </span>
                  <button onClick={() => removePayment.mutate(p.id)} className="text-slate-300 hover:text-red-500 text-xs">×</button>
                </div>
              ))}
              {payments.length === 0 && <div className="text-xs text-slate-400">Оплат ещё не было</div>}
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                value={paymentAmount}
                onChange={e => setPaymentAmount(e.target.value)}
                placeholder="Сумма"
                className="w-24 bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
              />
              <input
                value={paymentComment}
                onChange={e => setPaymentComment(e.target.value)}
                placeholder="Комментарий"
                className="flex-1 bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
              />
              <button
                onClick={() => {
                  const amount = Number(paymentAmount)
                  if (!amount) return
                  addPayment.mutate({ amount, currency: form.currency, comment: paymentComment })
                  setPaymentAmount('')
                  setPaymentComment('')
                }}
                className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1 rounded-lg"
              >
                + Оплата
              </button>
            </div>
          </div>

        </div>

        <div className="flex justify-between mt-6">
          <div>
            <button onClick={() => confirm('Удалить стримера из интеграции?') && remove.mutate()} className="text-red-500 hover:text-red-700 text-sm">Удалить</button>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-900 rounded-lg">Отмена</button>
            <button onClick={save} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Сохранить</button>
          </div>
        </div>
      </div>

      {!isNew && <DiscussionPanel streamerId={streamer.id} />}
    </div>
  )
}

// чатик по обсуждению сделки со стримером - раньше жил внутри модалки,
// теперь отдельная панель справа, чтобы можно было переписываться не теряя форму
function memberDisplayName(m: WorkspaceMember): string {
  return m.label || m.tg_username || `#${m.user_tg_id}`
}

// подсвечивает "@Имя" в тексте сообщения для тех, кто реально был упомянут (mentioned_tg_ids) -
// намеренно не парсим текст как попало, чтобы не подсвечивать случайные "@слово"
function renderMessageText(text: string, mentionedTgIds: number[], members: WorkspaceMember[]) {
  const names = (mentionedTgIds ?? [])
    .map(id => members.find(m => m.user_tg_id === id))
    .filter((m): m is WorkspaceMember => !!m)
    .map(memberDisplayName)
    .sort((a, b) => b.length - a.length)
  if (names.length === 0) return text

  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'g')
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(
      <span key={match.index} className="text-brand-600 dark:text-brand-400 font-medium bg-brand-50 dark:bg-brand-900/30 rounded px-0.5">
        {match[0]}
      </span>
    )
    lastIndex = match.index + match[0].length
  }
  parts.push(text.slice(lastIndex))
  return parts
}

function DiscussionPanel({ streamerId }: { streamerId: number }) {
  const qc = useQueryClient()
  const { current: workspace } = useWorkspace()
  const [text, setText] = useState('')
  const [mentionedIds, setMentionedIds] = useState<number[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: discussion = [] } = useQuery({
    queryKey: ['streamers', streamerId, 'discussion'],
    queryFn: () => integrationsApi.discussion(streamerId),
    refetchInterval: 5000,
  })
  const { data: members = [] } = useQuery({
    queryKey: ['workspace-members', workspace?.id],
    queryFn: () => workspacesApi.members(workspace!.id),
    enabled: !!workspace,
  })

  const addMessage = useMutation({
    mutationFn: (p: { text: string; mentionedTgIds: number[] }) =>
      integrationsApi.addDiscussionMessage(streamerId, p.text, p.mentionedTgIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['streamers', streamerId, 'discussion'] })
      setText('')
      setMentionedIds([])
    },
  })
  const removeMessage = useMutation({
    mutationFn: (id: number) => integrationsApi.removeDiscussionMessage(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['streamers', streamerId, 'discussion'] }),
  })
  const markRead = useMutation({
    mutationFn: () => integrationsApi.markDiscussionRead(streamerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discussion-unread'] }),
  })

  // отмечаем прочитанным при открытии и при каждом новом сообщении, пока панель открыта
  useEffect(() => {
    markRead.mutate()
    bottomRef.current?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discussion.length])

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery == null) return []
    const q = mentionQuery.toLowerCase()
    return members.filter(m => memberDisplayName(m).toLowerCase().includes(q)).slice(0, 6)
  }, [mentionQuery, members])

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setText(value)
    const pos = e.target.selectionStart ?? value.length
    const uptoCursor = value.slice(0, pos)
    const at = uptoCursor.lastIndexOf('@')
    if (at === -1 || /\s/.test(uptoCursor.slice(at + 1))) {
      setMentionQuery(null)
      setMentionStart(null)
      return
    }
    setMentionStart(at)
    setMentionQuery(uptoCursor.slice(at + 1))
  }

  const selectMention = (m: WorkspaceMember) => {
    if (mentionStart == null) return
    const name = memberDisplayName(m)
    const before = text.slice(0, mentionStart)
    const after = text.slice(mentionStart + 1 + (mentionQuery?.length ?? 0))
    const newText = `${before}@${name} ${after}`
    setText(newText)
    setMentionedIds(ids => (ids.includes(m.user_tg_id) ? ids : [...ids, m.user_tg_id]))
    setMentionQuery(null)
    setMentionStart(null)
    requestAnimationFrame(() => {
      const cursor = before.length + name.length + 2
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(cursor, cursor)
    })
  }

  const send = () => {
    const t = text.trim()
    if (!t) return
    // шлём пуш только тем, чьё "@Имя" реально осталось в тексте - если стёрли упоминание руками, не спамим
    const finalIds = mentionedIds.filter(id => {
      const m = members.find(mm => mm.user_tg_id === id)
      return m ? t.includes(`@${memberDisplayName(m)}`) : false
    })
    addMessage.mutate({ text: t, mentionedTgIds: finalIds })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && mentionQuery != null && mentionSuggestions.length > 0) {
      e.preventDefault()
      selectMention(mentionSuggestions[0])
      return
    }
    if (e.key === 'Escape' && mentionQuery != null) {
      setMentionQuery(null)
      setMentionStart(null)
      return
    }
    if (e.key === 'Enter') send()
  }

  return (
    <div
      onClick={e => e.stopPropagation()}
      className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl w-full sm:w-80 shrink-0 flex flex-col max-h-[50vh] sm:max-h-[90vh]"
    >
      <div className="px-4 py-3 border-b border-slate-200 dark:border-brand-900 text-sm font-medium text-slate-700 dark:text-slate-300">
        💬 Обсуждение
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {discussion.map((m: DiscussionMessage) => (
          <div key={m.id} className="bg-slate-50 dark:bg-brand-950/60 rounded-lg px-2 py-1.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-700 dark:text-slate-300 text-xs">{m.author_label ?? 'кто-то'}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-slate-400">{new Date(m.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <button onClick={() => removeMessage.mutate(m.id)} className="text-slate-300 hover:text-red-500 text-xs">×</button>
              </div>
            </div>
            <div className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
              {renderMessageText(m.text, m.mentioned_tg_ids, members)}
            </div>
          </div>
        ))}
        {discussion.length === 0 && <div className="text-xs text-slate-400">Обсуждения ещё нет</div>}
        <div ref={bottomRef} />
      </div>
      <div className="relative p-3 border-t border-slate-200 dark:border-brand-900 flex gap-2">
        {mentionQuery != null && mentionSuggestions.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-800 rounded-lg shadow-lg overflow-hidden">
            {mentionSuggestions.map(m => (
              <button
                key={m.user_tg_id}
                onClick={() => selectMention(m)}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-900"
              >
                @{memberDisplayName(m)}
              </button>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={onKeyDown}
          placeholder="Написать сообщение… (@ - упомянуть)"
          className="flex-1 min-w-0 bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
        />
        <button onClick={send} className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1 rounded-lg shrink-0">
          Отправить
        </button>
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

// файлы ТЗ: перетаскивание в зону или выбор через проводник, несколько файлов
function BriefFiles({ streamerId }: { streamerId: number }) {
  const qc = useQueryClient()
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: files = [] } = useQuery({
    queryKey: ['streamers', streamerId, 'brief-files'],
    queryFn: () => integrationsApi.briefFiles(streamerId),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['streamers', streamerId, 'brief-files'] })

  const upload = useMutation({
    mutationFn: (file: File) => integrationsApi.uploadBriefFile(streamerId, file),
    onSuccess: () => { invalidate(); setError(null) },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось загрузить файл'),
  })

  const remove = useMutation({
    mutationFn: (fileId: number) => integrationsApi.removeBriefFile(fileId),
    onSuccess: invalidate,
  })

  // грузим по одному: так частичный успех не теряется и ошибка видна по конкретному файлу
  const uploadAll = (list: FileList | null) => {
    if (!list) return
    for (const f of Array.from(list)) upload.mutate(f)
  }

  return (
    <div className="mt-2">
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); uploadAll(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={`rounded-lg border border-dashed px-3 py-4 text-center text-xs cursor-pointer transition ${
          dragOver
            ? 'border-brand-400 bg-brand-50/60 dark:bg-brand-900/20 text-brand-600 dark:text-brand-300'
            : 'border-slate-300 dark:border-brand-800 text-slate-400 hover:border-brand-400'
        }`}
      >
        {upload.isPending ? 'Загружаю…' : 'Перетащите файлы ТЗ сюда или нажмите, чтобы выбрать'}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => { uploadAll(e.target.files); e.target.value = '' }}
      />
      {error && <div className="text-xs text-red-500 mt-1">{error}</div>}

      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-2 text-xs">
              <a
                href={integrationsApi.briefFileUrl(f.id)}
                target="_blank"
                rel="noreferrer"
                className="flex-1 truncate text-brand-600 dark:text-brand-400 hover:underline"
              >
                📎 {f.file_name}
              </a>
              <span className="text-slate-400 shrink-0">{formatSize(f.size_bytes)}</span>
              <button
                onClick={() => remove.mutate(f.id)}
                className="text-slate-400 hover:text-red-500 shrink-0"
                title="Удалить"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// поле ссылки на ОРД: рядом с инпутом кнопка "открыть", чтобы не копировать руками
function OrdLinkInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  const href = value.trim()
  const valid = /^https?:\/\//i.test(href)
  return (
    <div>
      <label className="text-xs text-slate-500 dark:text-slate-400">{label}</label>
      <div className="flex gap-2">
        <input
          type="url"
          value={value ?? ''}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className="flex-1 min-w-0 bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
        />
        {valid && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            title="Открыть"
            className="shrink-0 px-3 py-2 rounded-lg border border-slate-200 dark:border-brand-800 text-slate-500 dark:text-slate-300 hover:border-brand-400"
          >
            ↗
          </a>
        )}
      </div>
    </div>
  )
}

export function CaseStudyCard({
  caseStudy,
  onSave,
  onRemove,
  onUploadPhoto,
  onRemovePhoto,
}: {
  caseStudy: CaseStudy
  onSave: (payload: { title: string; description: string; what_was_done: string; result: string }) => void
  onRemove: () => void
  onUploadPhoto: (file: File) => void
  onRemovePhoto: () => void
}) {
  const [title, setTitle] = useState(caseStudy.title)
  const [description, setDescription] = useState(caseStudy.description)
  const [whatWasDone, setWhatWasDone] = useState(caseStudy.what_was_done)
  const [result, setResult] = useState(caseStudy.result)
  const [dirty, setDirty] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const fieldCls = "w-full bg-white dark:bg-brand-900/30 border border-slate-200 dark:border-brand-800 rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
  const labelCls = "text-[11px] text-slate-500 dark:text-slate-400"

  const handleFile = (f: File | undefined | null) => {
    if (f && f.type.startsWith('image/')) onUploadPhoto(f)
  }

  return (
    <div className="border border-slate-200 dark:border-brand-800 rounded-lg p-3 bg-slate-50 dark:bg-brand-950/40 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <label className={labelCls}>Название (игра/бренд)</label>
          <input
            value={title}
            onChange={e => { setTitle(e.target.value); setDirty(true) }}
            className={`${fieldCls} font-medium`}
          />
        </div>
        <button onClick={onRemove} className="text-red-500 hover:text-red-700 text-xs shrink-0 mt-5">удалить</button>
      </div>

      <div>
        <label className={labelCls}>Описание</label>
        <textarea
          value={description}
          onChange={e => { setDescription(e.target.value); setDirty(true) }}
          rows={2}
          className={fieldCls}
        />
      </div>
      <div>
        <label className={labelCls}>Что сделано</label>
        <textarea
          value={whatWasDone}
          onChange={e => { setWhatWasDone(e.target.value); setDirty(true) }}
          rows={2}
          className={fieldCls}
        />
      </div>
      <div>
        <label className={labelCls}>Результат</label>
        <textarea
          value={result}
          onChange={e => { setResult(e.target.value); setDirty(true) }}
          rows={2}
          className={fieldCls}
        />
      </div>

      {dirty && (
        <button
          onClick={() => { onSave({ title, description, what_was_done: whatWasDone, result }); setDirty(false) }}
          className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1 rounded-lg"
        >
          Сохранить кейс
        </button>
      )}

      <div className="pt-1">
        <label className={labelCls}>Фото</label>
        {caseStudy.photo_name ? (
          <div className="flex items-center gap-2 mt-1">
            <img src={integrationsApi.casePhotoUrl(caseStudy.id)} alt="" className="w-20 h-20 object-cover rounded-lg border border-slate-200 dark:border-brand-800" />
            <button onClick={onRemovePhoto} className="text-xs text-red-500 hover:text-red-700">Удалить фото</button>
          </div>
        ) : (
          <label
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
            className={`mt-1 flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded-lg py-4 cursor-pointer text-xs transition ${
              dragOver
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30 text-brand-600'
                : 'border-slate-300 dark:border-brand-800 text-slate-400 hover:border-brand-400'
            }`}
          >
            <span>Перетащи фото сюда или нажми, чтобы выбрать</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => handleFile(e.target.files?.[0])}
            />
          </label>
        )}
      </div>
    </div>
  )
}
