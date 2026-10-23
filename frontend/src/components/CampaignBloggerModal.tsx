import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  integrationsApi,
  CONTENT_LABELS,
  CONTRACT_STATUS_LABELS,
  ORD_REPORTING_LABELS,
  ORD_RESPONSIBLE_LABELS,
  ORD_STATUS_LABELS,
  PAYMENT_LABELS,
  STAGES,
} from '../api/integrations'
import type {
  ContentStatus,
  ContractStatus,
  OrdReportingStatus,
  OrdResponsible,
  OrdStatus,
  Payment,
  PaymentStatus,
  Stage,
  Streamer,
} from '../api/integrations'
import { useWorkspace } from '../workspaceContext'
import { DEFAULT_MARGIN_DIVISOR, calcMargin, fmtPercent } from '../utils/margin'
import { AdvertiserCard, BriefFiles, ErridInput, OrdLinkInput, Screenshots } from './DealParts'

const fmtMoney = (n: number, currency: string) => `${Math.round(n).toLocaleString('ru-RU')} ${currency}`
const round2 = (n: number) => Math.round(n * 100) / 100

// общий вид полей, как в модалке сделки на канбане
const field =
  'w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 focus:border-brand-400 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none'
const labelCls = 'text-xs text-slate-500 dark:text-slate-400'

// поля, которые правятся в модалке, в виде строк для инпутов
type Form = {
  amount: string
  blogger_payout: string
  currency: string
  payment_status: PaymentStatus
  stage: Stage
  content_status: string
  integration_date: string
  integration_time: string
  deadline: string
  brief: string
  description: string
  contact: string
  ord_responsible: OrdResponsible
  ord_status: OrdStatus
  ord_reporting_status: OrdReportingStatus
  erid: string
  ord_link: string
  ord_report_link: string
  contract_status: ContractStatus
  contract_sent_date: string
  contract_signed_date: string
  contract_valid_until: string
  contract_notes: string
  contract_url: string
  publication_url: string
  commission_percent: string
  streamer_tax_percent: string
}

// поля, где пустая строка в форме = null на сервере (даты и время)
const NULLABLE_KEYS: (keyof Form)[] = [
  'integration_date',
  'integration_time',
  'deadline',
  'contract_sent_date',
  'contract_signed_date',
  'contract_valid_until',
]
// числовые поля, которые нельзя оставить пустыми
const NUMBER_KEYS: (keyof Form)[] = ['commission_percent', 'streamer_tax_percent']

const dateOf = (v: string | null) => (v ? v.slice(0, 10) : '')

const toForm = (s: Streamer): Form => ({
  amount: s.amount != null ? String(s.amount) : '',
  blogger_payout: s.blogger_payout != null ? String(s.blogger_payout) : '',
  currency: s.currency,
  payment_status: s.payment_status,
  stage: s.stage,
  content_status: s.content_status ?? '',
  integration_date: dateOf(s.integration_date),
  integration_time: s.integration_time ? s.integration_time.slice(0, 5) : '',
  deadline: dateOf(s.deadline),
  brief: s.brief ?? '',
  description: s.description ?? '',
  contact: s.contact ?? '',
  ord_responsible: s.ord_responsible,
  ord_status: s.ord_status,
  ord_reporting_status: s.ord_reporting_status,
  erid: s.erid ?? '',
  ord_link: s.ord_link ?? '',
  ord_report_link: s.ord_report_link ?? '',
  contract_status: s.contract_status,
  contract_sent_date: dateOf(s.contract_sent_date),
  contract_signed_date: dateOf(s.contract_signed_date),
  contract_valid_until: dateOf(s.contract_valid_until),
  contract_notes: s.contract_notes ?? '',
  contract_url: s.contract_url ?? '',
  publication_url: s.publication_url ?? '',
  commission_percent: String(s.commission_percent),
  streamer_tax_percent: String(s.streamer_tax_percent),
})

// Секция модалки с заголовком. Свернутая не рендерит содержимое (редкие блоки не грузят запросы зря).
function Section({
  title,
  defaultOpen = false,
  nested = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  nested?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section
      className={`rounded-xl border ${
        nested
          ? 'border-slate-100 dark:border-brand-900/60'
          : 'border-slate-200 dark:border-brand-900'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left ${
          nested ? 'text-xs text-slate-500 dark:text-slate-400' : 'text-sm font-semibold text-slate-900 dark:text-slate-100'
        }`}
      >
        <span>{title}</span>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </section>
  )
}

// История оплат: список, добавление, удаление. Живёт отдельно от формы, поэтому правит сервер сразу.
function PaymentsBlock({
  streamerId,
  currency,
  onChanged,
  onPendingChange,
  onError,
}: {
  streamerId: number
  currency: string
  // сервер сам пересчитывает статус оплаты при добавлении платежа - отдаём свежую сделку наверх
  onChanged: (fresh: Streamer) => void
  // есть ли введённая, но не добавленная оплата (для защиты от закрытия)
  onPendingChange: (pending: boolean) => void
  onError: (msg: string) => void
}) {
  const qc = useQueryClient()
  const key = ['streamers', streamerId, 'payments']
  const { data: payments = [] } = useQuery({ queryKey: key, queryFn: () => integrationsApi.payments(streamerId) })
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')

  // поле суммы не пустое = оплата набрана, но не добавлена; при размонтировании сбрасываем признак
  useEffect(() => {
    onPendingChange(amount.trim() !== '')
    return () => onPendingChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount])

  const add = useMutation({
    mutationFn: async (p: { amount: number; currency: string; comment: string }) => {
      await integrationsApi.addPayment(streamerId, p)
      return integrationsApi.getStreamer(streamerId)
    },
    onSuccess: fresh => {
      qc.invalidateQueries({ queryKey: key })
      onChanged(fresh)
      setAmount('')
      setComment('')
    },
    onError: (e: any) => onError(e?.response?.data?.detail ?? 'Не удалось добавить оплату'),
  })

  const remove = useMutation({
    mutationFn: (paymentId: number) => integrationsApi.removePayment(streamerId, paymentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
    onError: (e: any) => onError(e?.response?.data?.detail ?? 'Не удалось удалить оплату'),
  })

  const submit = () => {
    const value = Number(amount)
    if (!value) return
    add.mutate({ amount: value, currency, comment })
  }

  return (
    <>
      <div className="space-y-1">
        {payments.map((p: Payment) => (
          <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-slate-700 dark:text-slate-300">
              {p.amount.toLocaleString('ru-RU')} {p.currency} - {new Date(p.paid_at).toLocaleDateString('ru-RU')}
              {p.comment && <span className="text-slate-400"> ({p.comment})</span>}
            </span>
            <button
              onClick={() => confirm('Удалить оплату?') && remove.mutate(p.id)}
              title="Удалить оплату"
              className="shrink-0 text-slate-300 hover:text-red-500 text-xs"
            >
              ✕
            </button>
          </div>
        ))}
        {payments.length === 0 && <div className="text-xs text-slate-400">Оплат ещё не было</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder={`Сумма, ${currency}`}
          className={`${field} !w-32`}
        />
        <input
          value={comment}
          onChange={e => setComment(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Комментарий"
          className={`${field} !w-auto flex-1 min-w-[8rem]`}
        />
        <button
          onClick={submit}
          disabled={add.isPending}
          className="text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white px-3 py-2 rounded-lg"
        >
          + Оплата
        </button>
      </div>
    </>
  )
}

// Модалка блогера внутри кампании: полная карточка сделки, как на канбане, без захода туда.
// Каждое поле сохраняется само (select - сразу, остальные - на blur),
// поэтому закрытие модалки данные не теряет.
export default function CampaignBloggerModal({
  streamerId,
  campaignId,
  nick = '',
  marginDivisor,
  onClose,
}: {
  streamerId: number
  campaignId: number
  // коэффициент наценки кампании; null/не передан - берём коэффициент пространства
  marginDivisor?: number | null
  // ник из ссылки блогера (считает список кампании); пусто - показываем только имя
  nick?: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['streamer', streamerId],
    queryFn: () => integrationsApi.getStreamer(streamerId),
  })
  const [form, setForm] = useState<Form | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState(false)
  // оплата набрана в поле, но кнопку "+ Оплата" не нажали
  const [pendingPayment, setPendingPayment] = useState(false)
  const pressedOnBackdrop = useRef(false)

  // форму заполняем один раз при загрузке; дальше источник правды - то, что вводит человек
  useEffect(() => {
    if (data && form === null) setForm(toForm(data))
  }, [data, form])

  // после операций сделки обновляем списки кампании и канбана
  const refreshLists = () => {
    qc.invalidateQueries({ queryKey: ['campaign-bloggers', campaignId] })
    qc.invalidateQueries({ queryKey: ['campaigns'] })
    qc.invalidateQueries({ queryKey: ['integrations'] })
  }

  const save = useMutation({
    mutationFn: (p: Partial<Streamer>) => integrationsApi.updateStreamer(streamerId, p),
    onSuccess: s => {
      qc.setQueryData(['streamer', streamerId], s)
      refreshLists()
      setErr(null)
      setSavedAt(true)
    },
    onError: (e: any) => setErr(e?.response?.data?.detail ?? 'Не удалось сохранить'),
  })

  // файл договора: загрузка и удаление идут отдельными запросами, форму не трогают
  const uploadContract = useMutation({
    mutationFn: (file: File) => integrationsApi.uploadContract(streamerId, file),
    onSuccess: s => {
      qc.setQueryData(['streamer', streamerId], s)
      refreshLists()
      setErr(null)
    },
    onError: (e: any) => setErr(e?.response?.data?.detail ?? 'Не удалось загрузить договор'),
  })
  const removeContract = useMutation({
    mutationFn: () => integrationsApi.removeContract(streamerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['streamer', streamerId] })
      refreshLists()
      setErr(null)
    },
    onError: (e: any) => setErr(e?.response?.data?.detail ?? 'Не удалось удалить договор'),
  })

  // есть ли правки, которых ещё нет на сервере (поле в фокусе, blur не случился, оплата не добавлена)
  const dirty = (!!(data && form) && JSON.stringify(toForm(data)) !== JSON.stringify(form)) || pendingPayment

  const tryClose = () => {
    if (dirty && !save.isPending && !confirm('Есть несохранённые изменения. Закрыть без сохранения?')) return
    onClose()
  }

  // Esc закрывает с той же защитой от потери данных
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') tryClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // коэффициент кампании; у кампании пусто - пространства; и его нет - дефолт 1.375
  const { current } = useWorkspace()
  const divisor = marginDivisor ?? current?.margin_divisor ?? DEFAULT_MARGIN_DIVISOR
  // вписанная вручную выплата идёт третьим аргументом; пустое поле = считаем по коэффициенту
  const calc = form
    ? calcMargin(
        form.amount.trim() === '' ? null : Number(form.amount),
        divisor,
        form.blogger_payout.trim() === '' ? null : Number(form.blogger_payout),
      )
    : null

  const patch = (p: Partial<Form>) => { setForm(f => (f ? { ...f, ...p } : f)); setSavedAt(false) }

  // сохранение одного поля: сравниваем с сервером, чтобы не слать пустые запросы
  const commit = (key: keyof Form, value: string) => {
    if (!data) return
    let payload: Partial<Streamer>
    if (key === 'amount') {
      const next = value.trim() === '' ? null : Number(value)
      if (next !== null && !Number.isFinite(next)) { patch({ amount: toForm(data).amount }); return }
      if (next === data.amount) return
      payload = { amount: next }
    } else if (key === 'blogger_payout') {
      // как сумма: пустое поле = null (считаем по коэффициенту), кривое значение откатываем к серверному
      const next = value.trim() === '' ? null : Number(value)
      if (next !== null && !Number.isFinite(next)) { patch({ blogger_payout: toForm(data).blogger_payout }); return }
      if (next === data.blogger_payout) return
      payload = { blogger_payout: next }
    } else if (NUMBER_KEYS.includes(key)) {
      // комиссия и налог: пустое или кривое значение откатываем к серверному
      const next = Number(value)
      if (value.trim() === '' || !Number.isFinite(next)) { patch({ [key]: toForm(data)[key] } as Partial<Form>); return }
      if (next === (data as any)[key]) return
      payload = { [key]: next }
    } else if (NULLABLE_KEYS.includes(key)) {
      if (value === toForm(data)[key]) return
      payload = { [key]: value || null }
    } else if (key === 'content_status') {
      if (value === (data.content_status ?? '')) return
      payload = { content_status: (value || null) as ContentStatus | null }
    } else {
      if (value === (data as any)[key]) return
      payload = { [key]: value }
    }
    save.mutate(payload)
  }

  // ссылки: пробелы по краям (часто копируются вместе со ссылкой) срезаем и в поле, и на сервере,
  // чтобы форма не расходилась с сохранённым и не горел индикатор "несохранённые изменения"
  const trimCommit = (key: keyof Form, value: string) => {
    const v = value.trim()
    if (v !== value) patch({ [key]: v } as Partial<Form>)
    commit(key, v)
  }

  // select и date меняют значение разом, поэтому сохраняем сразу, без ожидания blur
  const pick = (key: keyof Form, value: string) => { patch({ [key]: value } as Partial<Form>); commit(key, value) }

  // после добавления оплаты сервер мог сам сменить статус оплаты: подтягиваем только его, чужие правки не трогаем
  const onPaymentAdded = (fresh: Streamer) => {
    qc.setQueryData(['streamer', streamerId], fresh)
    setForm(f => (f ? { ...f, payment_status: fresh.payment_status } : f))
    refreshLists()
    setErr(null)
  }

  // обычный текстовый инпут/дата/время: правка в форму, сохранение на blur
  const textInput = (key: keyof Form, type = 'text', extra = '') => (
    <input
      type={type}
      value={form ? (form[key] as string) : ''}
      onChange={e => patch({ [key]: e.target.value } as Partial<Form>)}
      onBlur={e => commit(key, e.target.value)}
      className={`${field} ${extra}`}
    />
  )

  const selectBox = (key: keyof Form, options: [string, string][], first?: string) => (
    <select value={form ? (form[key] as string) : ''} onChange={e => pick(key, e.target.value)} className={field}>
      {first && <option value="">{first}</option>}
      {options.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  )

  // уходя в чат, не теряем несохранённое
  const onChatClick = (e: MouseEvent) => {
    if (dirty && !confirm('Есть несохранённые изменения. Перейти без сохранения?')) e.preventDefault()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3 sm:p-4"
      // закрываем только если и нажатие, и отпускание были на подложке: выделение текста мышью не схлопывает окно
      onMouseDown={e => { pressedOnBackdrop.current = e.target === e.currentTarget }}
      onClick={e => { if (e.target === e.currentTarget && pressedOnBackdrop.current) tryClose() }}
    >
      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-4xl w-full p-4 sm:p-6 max-h-[92vh] overflow-y-auto scroll-pb-20">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="text-xs text-slate-400">Блогер кампании</div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100 truncate">
              {nick ? nick : (data?.streamer_name ?? '...')}
              {/* ник основным, имя из базы приглушённо рядом */}
              {nick && data?.streamer_name && (
                <span className="ml-2 text-sm font-normal text-slate-400 dark:text-slate-500">({data.streamer_name})</span>
              )}
            </h2>
          </div>
          <button
            onClick={tryClose}
            title="Закрыть"
            className="shrink-0 w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-brand-900"
          >
            ✕
          </button>
        </div>

        {isLoading && <div className="text-sm text-slate-400 py-6 text-center">Загрузка...</div>}
        {isError && <div className="text-sm text-red-500 py-6 text-center">Не удалось загрузить сделку</div>}

        {form && data && (
          // на десктопе две колонки, на мобилке одна (порядок: деньги, оплаты, ОРД, ТЗ, прочее, договор)
          // pb-16: запас под высоту липкого подвала, чтобы последнее поле не пряталось под ним
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start pb-16">
            <div className="flex flex-col gap-4 min-w-0">
              <Section title="Деньги и сроки" defaultOpen>
                <div className="grid grid-cols-[1fr_1fr_110px] gap-3">
                  <div>
                    <label className={labelCls}>Клиентская сумма</label>
                    {textInput('amount', 'number')}
                  </div>
                  <div>
                    <label className={labelCls}>Блогеру на руки</label>
                    <input
                      type="number"
                      min={0}
                      value={form.blogger_payout}
                      onChange={e => patch({ blogger_payout: e.target.value })}
                      onBlur={e => commit('blogger_payout', e.target.value)}
                      placeholder="по формуле"
                      className={field}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Валюта</label>
                    {selectBox('currency', [['RUB', '₽ RUB'], ['USD', '$ USD'], ['EUR', '€ EUR']])}
                  </div>
                </div>

                {/* живой расчёт: пересчитывается на каждый символ в поле суммы; пустая сумма или кривой коэффициент - блока нет */}
                {calc && (
                  <div className="rounded-lg bg-slate-50 dark:bg-brand-900/40 border border-slate-100 dark:border-brand-900 px-3 py-2 text-sm space-y-0.5">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500 dark:text-slate-400">Блогеру на руки</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{fmtMoney(calc.toBlogger, form.currency)}</span>
                    </div>
                    {/* подпись режима: по формуле или вписано руками (со сбросом к формуле) */}
                    <div className="flex justify-end items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                      {calc.manual ? (
                        <>
                          <span>вписано вручную</span>
                          <button
                            type="button"
                            onClick={() => pick('blogger_payout', '')}
                            title="Сбросить к расчёту по коэффициенту"
                            className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-brand-800 text-slate-500 dark:text-slate-400 hover:text-red-500 hover:border-red-300"
                          >
                            сбросить
                          </button>
                        </>
                      ) : (
                        <span>по коэффициенту {divisor.toLocaleString('ru-RU')}</span>
                      )}
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500 dark:text-slate-400">Наш доход</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        {fmtMoney(calc.margin, form.currency)} ({fmtPercent(calc.marginPercent)}%)
                      </span>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Стадия работы по блогеру</label>
                    {selectBox('stage', STAGES.map(s => [s.key, s.label]))}
                  </div>
                  <div>
                    <label className={labelCls}>Оплата</label>
                    {selectBox('payment_status', Object.entries(PAYMENT_LABELS))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Дата выхода</label>
                    {textInput('integration_date', 'date')}
                  </div>
                  <div>
                    <label className={labelCls}>Время запуска</label>
                    {textInput('integration_time', 'time')}
                  </div>
                  <div>
                    <label className={labelCls}>Дедлайн</label>
                    {textInput('deadline', 'date')}
                  </div>
                </div>
              </Section>

              <Section title="Оплаты" defaultOpen>
                <PaymentsBlock
                  streamerId={streamerId}
                  currency={form.currency}
                  onChanged={onPaymentAdded}
                  onPendingChange={setPendingPayment}
                  onError={setErr}
                />
              </Section>

              <Section title="Маркировка ОРД">
                <div className={`grid grid-cols-1 ${form.ord_responsible === 'not_required' ? '' : 'sm:grid-cols-3'} gap-3`}>
                  <div>
                    <label className={labelCls}>Ответственный</label>
                    {selectBox('ord_responsible', Object.entries(ORD_RESPONSIBLE_LABELS))}
                  </div>
                  {form.ord_responsible !== 'not_required' && (
                    <>
                      <div>
                        <label className={labelCls}>Маркировка</label>
                        {selectBox('ord_status', Object.entries(ORD_STATUS_LABELS))}
                      </div>
                      <div>
                        <label className={labelCls}>Отчётность</label>
                        {selectBox('ord_reporting_status', Object.entries(ORD_REPORTING_LABELS))}
                      </div>
                    </>
                  )}
                </div>
                {form.ord_responsible !== 'not_required' && (
                  <div className="grid grid-cols-1 gap-3">
                    {/* сначала сам erid, потом где его получили */}
                    <ErridInput
                      value={form.erid}
                      onChange={v => patch({ erid: v })}
                      onBlur={v => commit('erid', v.trim())}
                      inputClassName={field}
                    />
                    <OrdLinkInput
                      label="Ссылка на ОРД"
                      placeholder="https://ord.vk.com/..."
                      value={form.ord_link}
                      onChange={v => patch({ ord_link: v })}
                      onBlur={v => commit('ord_link', v)}
                      inputClassName={field}
                    />
                    <OrdLinkInput
                      label="Ссылка на отчётность"
                      placeholder="https://ord.vk.com/..."
                      value={form.ord_report_link}
                      onChange={v => patch({ ord_report_link: v })}
                      onBlur={v => commit('ord_report_link', v)}
                      inputClassName={field}
                    />
                  </div>
                )}
              </Section>
            </div>

            <div className="flex flex-col gap-4 min-w-0">
              {/* контакты рекламодателя только для чтения; нет рекламодателя у сделки - блока нет */}
              {data.advertiser && (
                <Section title={`Рекламодатель: ${data.advertiser.name}`} defaultOpen>
                  <AdvertiserCard advertiser={data.advertiser} />
                </Section>
              )}

              <Section title="Контент и ТЗ" defaultOpen>
                <div>
                  <label className={labelCls}>Статус контента</label>
                  {selectBox('content_status', Object.entries(CONTENT_LABELS), '- не задан -')}
                </div>
                <div>
                  <label className={labelCls}>ТЗ</label>
                  <textarea
                    rows={5}
                    value={form.brief}
                    onChange={e => patch({ brief: e.target.value })}
                    onBlur={e => commit('brief', e.target.value)}
                    placeholder="Что нужно снять и показать"
                    className={`${field} resize-y`}
                  />
                </div>
                {/* сделка в кампании уже существует, поэтому файлы доступны сразу */}
                <div>
                  <label className={labelCls}>Файлы ТЗ</label>
                  <BriefFiles streamerId={streamerId} />
                </div>
                {/* результат: ссылка на вышедшую публикацию и скриншоты для будущего кейса */}
                <OrdLinkInput
                  label="Ссылка на вышедшую интеграцию"
                  placeholder="https://t.me/... или https://youtube.com/..."
                  value={form.publication_url}
                  onChange={v => patch({ publication_url: v })}
                  onBlur={v => trimCommit('publication_url', v)}
                  inputClassName={field}
                />
                <div>
                  <label className={labelCls}>Скриншоты интеграции</label>
                  <Screenshots streamerId={streamerId} />
                </div>
              </Section>

              <Section title="Прочее" defaultOpen>
                <div>
                  <label className={labelCls}>Контакт</label>
                  <input
                    value={form.contact}
                    onChange={e => patch({ contact: e.target.value })}
                    onBlur={e => commit('contact', e.target.value)}
                    placeholder="TG / email / телефон"
                    className={field}
                  />
                </div>
                <div>
                  <label className={labelCls}>Комментарий</label>
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={e => patch({ description: e.target.value })}
                    onBlur={e => commit('description', e.target.value)}
                    className={`${field} resize-y`}
                  />
                </div>

                <Link
                  to={`/chat?streamer=${streamerId}`}
                  onClick={onChatClick}
                  className="flex items-center justify-between text-sm border border-slate-200 dark:border-brand-900 rounded-lg px-3 py-2 text-brand-600 dark:text-brand-400 hover:bg-slate-50 dark:hover:bg-brand-900/30"
                >
                  <span>💬 Обсуждение этой сделки</span>
                  <span>→</span>
                </Link>

                {/* старая механика: основной расчёт сверху по коэффициенту пространства, данные в базе остаются */}
                <Section title="Расчёт по старой схеме (комиссия и налог)" nested>
                  <div className="text-xs text-slate-400">
                    Основной расчёт теперь сверху, по коэффициенту пространства. Эти поля нужны только для старых сделок и канбана.
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Моя комиссия, %</label>
                      {textInput('commission_percent', 'number')}
                    </div>
                    <div>
                      <label className={labelCls}>Налог инфлюенсера, %</label>
                      {textInput('streamer_tax_percent', 'number')}
                    </div>
                  </div>
                  {form.amount.trim() !== '' && Number.isFinite(Number(form.amount)) && (() => {
                    const amount = Number(form.amount)
                    const commission = round2(amount * (Number(form.commission_percent) || 0) / 100)
                    const tax = round2(amount * (Number(form.streamer_tax_percent) || 0) / 100)
                    const net = round2(amount - commission - tax)
                    return (
                      <div className="rounded-lg bg-slate-50 dark:bg-brand-900/40 border border-slate-100 dark:border-brand-900 px-3 py-2 text-sm space-y-0.5">
                        <div className="flex justify-between gap-3"><span className="text-slate-500 dark:text-slate-400">Моя комиссия</span><span className="text-brand-600 dark:text-brand-400 font-medium">{commission.toLocaleString('ru-RU')} {form.currency}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-slate-500 dark:text-slate-400">Налог инфлюенсера</span><span className="text-slate-600 dark:text-slate-300">{tax.toLocaleString('ru-RU')} {form.currency}</span></div>
                        <div className="flex justify-between gap-3 border-t border-slate-200 dark:border-brand-800 pt-1"><span className="text-slate-500 dark:text-slate-400">Инфлюенсеру на руки</span><span className="text-emerald-600 dark:text-emerald-400 font-semibold">{net.toLocaleString('ru-RU')} {form.currency}</span></div>
                      </div>
                    )
                  })()}
                </Section>
              </Section>

              <Section title="Договор">
                {data.contract_file_name ? (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <a
                      href={integrationsApi.contractUrl(streamerId)}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      📎 {data.contract_file_name}
                    </a>
                    <button
                      onClick={() => confirm('Удалить файл договора?') && removeContract.mutate()}
                      className="shrink-0 text-xs text-red-500 hover:text-red-700"
                    >
                      Удалить
                    </button>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-sm bg-slate-100 dark:bg-brand-900 hover:bg-slate-200 dark:hover:bg-brand-800 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg w-fit">
                    <span>{uploadContract.isPending ? 'Загружаю...' : '📎 Выберите файл'}</span>
                    <input
                      type="file"
                      className="hidden"
                      onChange={e => {
                        if (e.target.files?.[0]) uploadContract.mutate(e.target.files[0])
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}

                {/* ссылка не исключает файл: можно оба сразу */}
                <OrdLinkInput
                  label="Ссылка на договор"
                  placeholder="https://disk.yandex.ru/... или сервис подписания"
                  value={form.contract_url}
                  onChange={v => patch({ contract_url: v })}
                  onBlur={v => trimCommit('contract_url', v)}
                  inputClassName={field}
                />

                <div>
                  <label className={labelCls}>Статус</label>
                  {selectBox('contract_status', Object.entries(CONTRACT_STATUS_LABELS))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Отправлен</label>
                    {textInput('contract_sent_date', 'date')}
                  </div>
                  <div>
                    <label className={labelCls}>Подписан</label>
                    {textInput('contract_signed_date', 'date')}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Действует до</label>
                  {textInput('contract_valid_until', 'date')}
                </div>
                <div>
                  <label className={labelCls}>Заметка по договору</label>
                  <textarea
                    rows={2}
                    value={form.contract_notes}
                    onChange={e => patch({ contract_notes: e.target.value })}
                    onBlur={e => commit('contract_notes', e.target.value)}
                    className={`${field} resize-y`}
                  />
                </div>
              </Section>
            </div>
          </div>
        )}

        {/* подвал липкий: "Готово" и статус сохранения видны при любой прокрутке */}
        <div className="sticky bottom-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 mt-4 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 min-h-[3.5rem] bg-white dark:bg-brand-950 border-t border-slate-100 dark:border-brand-900 rounded-b-2xl">
          <div className="text-xs">
            {err && <span className="text-red-500">{err}</span>}
            {!err && save.isPending && <span className="text-slate-400">Сохраняем...</span>}
            {!err && !save.isPending && savedAt && !dirty && <span className="text-emerald-600 dark:text-emerald-400">Сохранено</span>}
            {!err && !save.isPending && dirty && <span className="text-amber-600 dark:text-amber-400">Есть несохранённые изменения</span>}
          </div>
          <button
            onClick={tryClose}
            className="px-4 py-2 rounded-lg text-sm bg-brand-600 hover:bg-brand-700 text-white"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  )
}
