import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { integrationsApi, STAGES, PAYMENT_LABELS } from '../api/integrations'
import type { Integration, Payment, PaymentStatus, Stage, Streamer } from '../api/integrations'

const PAYMENT_COLORS: Record<PaymentStatus, string> = {
  not_invoiced: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
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

function emptyStreamer(integrationId: number): Streamer {
  return {
    id: 0,
    integration_id: integrationId,
    streamer_name: '',
    contact: '',
    stage: 'negotiation',
    payment_status: 'not_invoiced',
    amount: null,
    currency: 'RUB',
    commission_percent: 15,
    streamer_tax_percent: 6,
    commission_amount: null,
    streamer_net_amount: null,
    deadline: null,
    description: '',
    contract_file_name: null,
    position: 0,
    created_at: '',
    updated_at: '',
  }
}

export default function IntegrationsBoard() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<{ streamer: Streamer; brand: string } | null>(null)
  const [pickingBrand, setPickingBrand] = useState(false)
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const dragData = useRef<{ id: number; stage: Stage } | null>(null)

  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })

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

  return (
    <div className="p-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">Интеграции</h1>
        <button
          onClick={() => setPickingBrand(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Новый стример
        </button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGES.map(s => (
          <div
            key={s.key}
            onDragOver={e => { e.preventDefault(); setDragOverStage(s.key) }}
            onDragLeave={() => setDragOverStage(null)}
            onDrop={() => onDrop(s.key)}
            className={`w-72 shrink-0 rounded-xl border ${dragOverStage === s.key ? 'border-brand-400 bg-brand-50/50 dark:bg-brand-900/10' : 'border-slate-200 dark:border-slate-800'} bg-slate-50 dark:bg-slate-900/40`}
          >
            <div className="px-3 py-2 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{s.label}</div>
              <div className="text-xs text-slate-400">{byStage(s.key).length}</div>
            </div>
            {totalAmount(s.key) > 0 && (
              <div className="px-3 pt-2 text-xs text-slate-400">
                Σ {totalAmount(s.key).toLocaleString('ru-RU')} ₽
              </div>
            )}
            <div className="p-2 space-y-2 min-h-[80px]">
              {byStage(s.key).map(c => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={() => { dragData.current = { id: c.id, stage: c.stage } }}
                  onClick={() => setEditing({ streamer: c, brand: c.brand })}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 cursor-pointer hover:border-brand-400 shadow-sm"
                >
                  <div className="text-xs text-slate-400">{c.brand}</div>
                  <div className="font-medium text-sm text-slate-900 dark:text-slate-100">{c.streamer_name}</div>
                  <div className="flex items-center justify-between mt-2">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded ${PAYMENT_COLORS[c.payment_status]}`}>
                      {PAYMENT_LABELS[c.payment_status]}
                    </span>
                    {c.amount != null && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">{c.amount.toLocaleString('ru-RU')} {c.currency}</span>
                    )}
                  </div>
                  {c.commission_amount != null && (
                    <div className="text-[11px] text-brand-600 dark:text-brand-400 mt-1">
                      трясти со стримера: {c.commission_amount.toLocaleString('ru-RU')} {c.currency}
                    </div>
                  )}
                  {c.deadline && (
                    <div className="text-[11px] text-slate-400 mt-1">до {new Date(c.deadline).toLocaleDateString('ru-RU')}</div>
                  )}
                  {c.contract_file_name && (
                    <div className="text-[11px] text-brand-500 mt-1">📎 договор</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {pickingBrand && (
        <BrandPickerModal
          integrations={integrations}
          onClose={() => setPickingBrand(false)}
          onPicked={(integrationId, brand) => {
            setPickingBrand(false)
            setEditing({ streamer: emptyStreamer(integrationId), brand })
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
  onPicked: (integrationId: number, brand: string) => void
}) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'existing' | 'new'>(integrations.length ? 'existing' : 'new')
  const [selectedId, setSelectedId] = useState<number | ''>('')
  const [newBrand, setNewBrand] = useState('')

  const createIntegration = useMutation({
    mutationFn: (brand: string) => integrationsApi.create({ brand }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      onPicked(data.id, data.brand)
    },
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Какой бренд?</h2>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('existing')}
            disabled={integrations.length === 0}
            className={`flex-1 text-sm px-3 py-2 rounded-lg border ${mode === 'existing' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'} disabled:opacity-40`}
          >
            Существующий
          </button>
          <button
            onClick={() => setMode('new')}
            className={`flex-1 text-sm px-3 py-2 rounded-lg border ${mode === 'new' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}
          >
            Новый бренд
          </button>
        </div>

        {mode === 'existing' ? (
          <select
            value={selectedId}
            onChange={e => setSelectedId(Number(e.target.value))}
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
          >
            <option value="">— выбери бренд —</option>
            {integrations.map(it => (
              <option key={it.id} value={it.id}>{it.brand} ({it.streamers.length})</option>
            ))}
          </select>
        ) : (
          <input
            value={newBrand}
            onChange={e => setNewBrand(e.target.value)}
            placeholder="Название бренда"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
          />
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Отмена</button>
          <button
            onClick={() => {
              if (mode === 'existing') {
                if (!selectedId) return
                const it = integrations.find(i => i.id === selectedId)
                if (it) onPicked(it.id, it.brand)
              } else {
                if (!newBrand.trim()) return
                createIntegration.mutate(newBrand.trim())
              }
            }}
            className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Далее
          </button>
        </div>
      </div>
    </div>
  )
}

function StreamerModal({
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

  const create = useMutation({
    mutationFn: (p: Partial<Streamer>) => integrationsApi.addStreamer(streamer.integration_id, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      onClose()
    },
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
    mutationFn: (p: { amount: number; comment: string }) => integrationsApi.addPayment(streamer.id, p),
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
      amount: form.amount,
      currency: form.currency,
      commission_percent: form.commission_percent,
      streamer_tax_percent: form.streamer_tax_percent,
      deadline: form.deadline,
      description: form.description,
    }
    if (isNew) create.mutate(payload)
    else update.mutate(payload)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
              {nameOpen && nameSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl max-h-40 overflow-auto z-10">
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
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Стадия</label>
              <select
                value={form.stage}
                onChange={e => setForm({ ...form, stage: e.target.value as Stage })}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              >
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Оплата</label>
              <select
                value={form.payment_status}
                onChange={e => setForm({ ...form, payment_status: e.target.value as PaymentStatus })}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
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
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Сумма</label>
              <input
                type="number"
                value={form.amount ?? ''}
                onChange={e => setForm({ ...form, amount: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Валюта</label>
              <input
                value={form.currency}
                onChange={e => setForm({ ...form, currency: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Моя комиссия, %</label>
              <input
                type="number"
                value={form.commission_percent}
                onChange={e => setForm({ ...form, commission_percent: Number(e.target.value) })}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Налог стримера, %</label>
              <input
                type="number"
                value={form.streamer_tax_percent}
                onChange={e => setForm({ ...form, streamer_tax_percent: Number(e.target.value) })}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {form.amount != null && (
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm space-y-1">
              {(() => {
                const commission = round2(form.amount! * form.commission_percent / 100)
                const tax = round2(form.amount! * form.streamer_tax_percent / 100)
                const net = round2(form.amount! - commission - tax)
                return (
                  <>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Цена для клиента</span><span className="text-slate-900 dark:text-slate-100">{form.amount!.toLocaleString('ru-RU')} {form.currency}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Моя комиссия (трясти со стримера)</span><span className="text-brand-600 dark:text-brand-400 font-medium">{commission.toLocaleString('ru-RU')} {form.currency}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Налог стримера ({form.streamer_tax_percent}%)</span><span className="text-slate-600 dark:text-slate-300">{tax.toLocaleString('ru-RU')} {form.currency}</span></div>
                    <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1"><span className="text-slate-500 dark:text-slate-400">Стримеру на руки</span><span className="text-emerald-600 dark:text-emerald-400 font-semibold">{net.toLocaleString('ru-RU')} {form.currency}</span></div>
                  </>
                )
              })()}
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Описание</label>
            <textarea
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
            />
          </div>

          {!isNew && (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Договор</div>
              {form.contract_file_name ? (
                <div className="flex items-center justify-between text-sm">
                  <a href={integrationsApi.contractUrl(streamer.id)} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                    📎 {form.contract_file_name}
                  </a>
                  <button onClick={() => removeContract.mutate()} className="text-xs text-red-500 hover:text-red-700">Удалить</button>
                </div>
              ) : (
                <input
                  type="file"
                  onChange={e => e.target.files?.[0] && uploadContract.mutate(e.target.files[0])}
                  className="text-sm text-slate-600 dark:text-slate-300"
                />
              )}
            </div>
          )}

          {!isNew && (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3">
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
                  className="w-24 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
                />
                <input
                  value={paymentComment}
                  onChange={e => setPaymentComment(e.target.value)}
                  placeholder="Комментарий"
                  className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
                />
                <button
                  onClick={() => {
                    const amount = Number(paymentAmount)
                    if (!amount) return
                    addPayment.mutate({ amount, comment: paymentComment })
                    setPaymentAmount('')
                    setPaymentComment('')
                  }}
                  className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1 rounded-lg"
                >
                  + Оплата
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between mt-6">
          <div>
            {!isNew && (
              <button onClick={() => confirm('Удалить стримера из интеграции?') && remove.mutate()} className="text-red-500 hover:text-red-700 text-sm">Удалить</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Отмена</button>
            <button onClick={save} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  )
}
