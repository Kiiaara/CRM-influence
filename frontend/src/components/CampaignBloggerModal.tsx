import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { integrationsApi, CONTENT_LABELS, PAYMENT_LABELS, STAGES } from '../api/integrations'
import type { ContentStatus, PaymentStatus, Stage, Streamer } from '../api/integrations'

// общий вид полей, как в модалке сделки на канбане
const field =
  'w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 focus:border-brand-400 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none'
const labelCls = 'text-xs text-slate-500 dark:text-slate-400'

// поля, которые правятся в модалке, в виде строк для инпутов
type Form = {
  amount: string
  currency: string
  payment_status: PaymentStatus
  stage: Stage
  content_status: string
  integration_date: string
  deadline: string
  brief: string
  description: string
  contact: string
}

const toForm = (s: Streamer): Form => ({
  amount: s.amount != null ? String(s.amount) : '',
  currency: s.currency,
  payment_status: s.payment_status,
  stage: s.stage,
  content_status: s.content_status ?? '',
  integration_date: s.integration_date ? s.integration_date.slice(0, 10) : '',
  deadline: s.deadline ? s.deadline.slice(0, 10) : '',
  brief: s.brief ?? '',
  description: s.description ?? '',
  contact: s.contact ?? '',
})

// Модалка блогера внутри кампании: правка сделки без захода на канбан.
// Каждое поле сохраняется само (select - сразу, остальные - на blur),
// поэтому закрытие модалки данные не теряет.
export default function CampaignBloggerModal({
  streamerId,
  campaignId,
  onClose,
}: {
  streamerId: number
  campaignId: number
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
  const pressedOnBackdrop = useRef(false)

  // форму заполняем один раз при загрузке; дальше источник правды - то, что вводит человек
  useEffect(() => {
    if (data && form === null) setForm(toForm(data))
  }, [data, form])

  const save = useMutation({
    mutationFn: (p: Partial<Streamer>) => integrationsApi.updateStreamer(streamerId, p),
    onSuccess: s => {
      qc.setQueryData(['streamer', streamerId], s)
      qc.invalidateQueries({ queryKey: ['campaign-bloggers', campaignId] })
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      qc.invalidateQueries({ queryKey: ['integrations'] })
      setErr(null)
      setSavedAt(true)
    },
    onError: (e: any) => setErr(e?.response?.data?.detail ?? 'Не удалось сохранить'),
  })

  // есть ли правки, которых ещё нет на сервере (поле в фокусе, blur не случился)
  const dirty = !!(data && form) && JSON.stringify(toForm(data)) !== JSON.stringify(form)

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

  const patch = (p: Partial<Form>) => { setForm(f => (f ? { ...f, ...p } : f)); setSavedAt(false) }

  // сохранение одного поля: сравниваем с сервером, чтобы не слать пустые запросы
  const commit = (key: keyof Form, value: string) => {
    if (!data) return
    let payload: Partial<Streamer>
    switch (key) {
      case 'amount': {
        const next = value.trim() === '' ? null : Number(value)
        if (next !== null && !Number.isFinite(next)) { patch({ amount: toForm(data).amount }); return }
        if (next === data.amount) return
        payload = { amount: next }
        break
      }
      case 'integration_date':
      case 'deadline': {
        if (value === toForm(data)[key]) return
        payload = { [key]: value || null }
        break
      }
      case 'content_status': {
        if (value === (data.content_status ?? '')) return
        payload = { content_status: (value || null) as ContentStatus | null }
        break
      }
      default: {
        if (value === (data as any)[key]) return
        payload = { [key]: value }
      }
    }
    save.mutate(payload)
  }

  // select и date меняют значение разом, поэтому сохраняем сразу, без ожидания blur
  const pick = (key: keyof Form, value: string) => { patch({ [key]: value } as Partial<Form>); commit(key, value) }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3 sm:p-4"
      // закрываем только если и нажатие, и отпускание были на подложке: выделение текста мышью не схлопывает окно
      onMouseDown={e => { pressedOnBackdrop.current = e.target === e.currentTarget }}
      onClick={e => { if (e.target === e.currentTarget && pressedOnBackdrop.current) tryClose() }}
    >
      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-xl w-full p-4 sm:p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="text-xs text-slate-400">Блогер кампании</div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100 truncate">
              {data?.streamer_name ?? '...'}
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

        {form && (
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div>
                <label className={labelCls}>Сумма</label>
                <input
                  type="number"
                  value={form.amount}
                  onChange={e => patch({ amount: e.target.value })}
                  onBlur={e => commit('amount', e.target.value)}
                  className={field}
                />
              </div>
              <div>
                <label className={labelCls}>Валюта</label>
                <select value={form.currency} onChange={e => pick('currency', e.target.value)} className={field}>
                  <option value="RUB">₽ RUB</option>
                  <option value="USD">$ USD</option>
                  <option value="EUR">€ EUR</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Оплата</label>
                <select value={form.payment_status} onChange={e => pick('payment_status', e.target.value)} className={field}>
                  {Object.entries(PAYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Стадия</label>
                <select value={form.stage} onChange={e => pick('stage', e.target.value)} className={field}>
                  {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Статус контента</label>
              <select value={form.content_status} onChange={e => pick('content_status', e.target.value)} className={field}>
                <option value="">- не задан -</option>
                {Object.entries(CONTENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Дата выхода</label>
                <input
                  type="date"
                  value={form.integration_date}
                  onChange={e => patch({ integration_date: e.target.value })}
                  onBlur={e => commit('integration_date', e.target.value)}
                  className={field}
                />
              </div>
              <div>
                <label className={labelCls}>Дедлайн</label>
                <input
                  type="date"
                  value={form.deadline}
                  onChange={e => patch({ deadline: e.target.value })}
                  onBlur={e => commit('deadline', e.target.value)}
                  className={field}
                />
              </div>
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
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mt-4 min-h-[2rem]">
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
