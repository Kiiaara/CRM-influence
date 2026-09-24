import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { integrationsApi } from '../api/integrations'
import type { CaseStudyUpdate, Streamer } from '../api/integrations'
import { siteApi } from '../api/site'
import type { PublishResult } from '../api/site'
import { authApi } from '../api/auth'
import { CaseStudyCard } from './IntegrationsBoard'

interface Row extends Streamer {
  brand: string
}

function StreamerCases({ row, autoAdd }: { row: Row; autoAdd?: boolean }) {
  const qc = useQueryClient()
  const { data: cases = [], isLoading } = useQuery({
    queryKey: ['streamers', row.id, 'cases'],
    queryFn: () => integrationsApi.cases(row.id),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['streamers', row.id, 'cases'] })
  const invalidateAll = () => {
    invalidate()
    qc.invalidateQueries({ queryKey: ['integrations'] })
  }

  const addCase = useMutation({
    mutationFn: () => integrationsApi.addCase(row.id, {}),
    onSuccess: invalidateAll,
  })
  const updateCase = useMutation({
    mutationFn: (p: { id: number; payload: CaseStudyUpdate }) =>
      integrationsApi.updateCase(p.id, p.payload),
    onSuccess: () => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['site-status'] })
    },
  })
  const removeCase = useMutation({
    mutationFn: (id: number) => integrationsApi.removeCase(id),
    onSuccess: invalidateAll,
  })
  const uploadPhoto = useMutation({
    mutationFn: (p: { id: number; file: File }) => integrationsApi.uploadCasePhoto(p.id, p.file),
    onSuccess: invalidate,
  })
  const removePhoto = useMutation({
    mutationFn: (id: number) => integrationsApi.removeCasePhoto(id),
    onSuccess: invalidate,
  })

  // сделку выбрали в модалке - сразу заводим пустой кейс, чтобы не жать второй раз.
  // ref, а не isPending: под StrictMode эффект вызывается дважды и создалось бы два кейса
  const autoAddDone = useRef(false)
  useEffect(() => {
    if (autoAdd && !autoAddDone.current && !isLoading && cases.length === 0) {
      autoAddDone.current = true
      addCase.mutate()
    }
  }, [autoAdd, isLoading, cases.length, addCase])

  if (cases.length === 0) return null

  return (
    <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div>
          <div className="text-xs text-slate-400">{row.brand}</div>
          <div className="font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
            {row.streamer_name}
            {row.stage !== 'done' && (
              <span className="text-[11px] font-normal px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                ещё в работе
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => addCase.mutate()}
          className="text-xs text-brand-600 dark:text-brand-400 hover:underline shrink-0"
        >
          + ещё кейс
        </button>
      </div>
      <div className="space-y-3">
        {cases.map(c => (
          <CaseStudyCard
            key={c.id}
            caseStudy={c}
            onSave={payload => updateCase.mutate({ id: c.id, payload })}
            onRemove={() => confirm('Удалить кейс?') && removeCase.mutate(c.id)}
            onUploadPhoto={file => uploadPhoto.mutate({ id: c.id, file })}
            onRemovePhoto={() => removePhoto.mutate(c.id)}
          />
        ))}
      </div>
    </div>
  )
}

export default function CasesPage() {
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState(false)
  const [justAdded, setJustAdded] = useState<number | null>(null)

  const all: Row[] = useMemo(
    () =>
      integrations
        .flatMap(it => it.streamers.map(s => ({ ...s, brand: it.brand })))
        .filter(s => s.stage !== 'cancelled')
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [integrations]
  )

  // завершено, но кейса ещё нет - именно это и надо подсветить
  const waiting = all.filter(r => r.stage === 'done' && !r.has_case)
  const withCases = all.filter(r => r.has_case || r.id === justAdded)

  const filtered = withCases.filter(r =>
    !q.trim() ||
    r.brand.toLowerCase().includes(q.toLowerCase()) ||
    r.streamer_name.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Кейсы для сайта</h1>
        <button
          onClick={() => setPicking(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium w-full sm:w-auto"
        >
          + Новый кейс
        </button>
      </div>

      <SitePublishBar />

      {waiting.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="animate-pulse text-lg">🔔</span>
            <span className="font-medium text-amber-800 dark:text-amber-300">
              Ждут кейса: {waiting.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {waiting.map(r => (
              <button
                key={r.id}
                onClick={() => setJustAdded(r.id)}
                className="text-xs bg-white dark:bg-brand-950 border border-amber-300 dark:border-amber-700/60 text-amber-800 dark:text-amber-300 px-2.5 py-1 rounded-full hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                {r.brand} · {r.streamer_name}
              </button>
            ))}
          </div>
          <div className="text-xs text-amber-700/80 dark:text-amber-400/70 mt-2">
            Интеграция завершена, а кейса для сайта ещё нет. Нажмите, чтобы завести.
          </div>
        </div>
      )}

      {withCases.length > 0 && (
        <div className="mb-4">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Поиск по бренду или стримеру"
            className="w-full sm:w-64 bg-slate-100 dark:bg-brand-900 border border-transparent focus:border-brand-500 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none"
          />
        </div>
      )}

      <div className="space-y-4">
        {filtered.map(row => (
          <StreamerCases key={row.id} row={row} autoAdd={row.id === justAdded} />
        ))}
        {filtered.length === 0 && waiting.length === 0 && (
          <div className="text-sm text-slate-400 text-center py-10 bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl">
            Кейсов пока нет. Нажмите «Новый кейс», чтобы завести первый.
          </div>
        )}
        {filtered.length === 0 && waiting.length > 0 && (
          <div className="text-sm text-slate-400 text-center py-8 bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl">
            Заполненных кейсов ещё нет — выберите сделку выше
          </div>
        )}
      </div>

      {picking && (
        <CasePickerModal
          rows={all}
          onClose={() => setPicking(false)}
          onPicked={id => { setPicking(false); setJustAdded(id) }}
        />
      )}
    </div>
  )
}

// выбор сделки, к которой заводим кейс - по образцу выбора бренда на канбане
function CasePickerModal({
  rows,
  onClose,
  onPicked,
}: {
  rows: Row[]
  onClose: () => void
  onPicked: (streamerId: number) => void
}) {
  const [q, setQ] = useState('')
  const [onlyDone, setOnlyDone] = useState(true)

  const list = rows
    .filter(r => (onlyDone ? r.stage === 'done' : true))
    .filter(r =>
      !q.trim() ||
      r.brand.toLowerCase().includes(q.toLowerCase()) ||
      r.streamer_name.toLowerCase().includes(q.toLowerCase())
    )

  const doneCount = rows.filter(r => r.stage === 'done').length

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-1 text-slate-900 dark:text-slate-100">Новый кейс</h2>
        <p className="text-xs text-slate-400 mb-3">Выберите интеграцию, по которой собираем кейс</p>

        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Поиск по бренду или стримеру"
          className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 mb-2"
        />

        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-3 cursor-pointer w-fit">
          <input type="checkbox" checked={onlyDone} onChange={e => setOnlyDone(e.target.checked)} />
          Только завершённые ({doneCount})
        </label>

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {list.map(r => (
            <button
              key={r.id}
              onClick={() => onPicked(r.id)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-brand-900 flex items-center justify-between gap-2"
            >
              <span className="min-w-0">
                <span className="block text-sm text-slate-900 dark:text-slate-100 truncate">{r.streamer_name}</span>
                <span className="block text-xs text-slate-400 truncate">{r.brand}</span>
              </span>
              <span className="shrink-0 flex items-center gap-1.5">
                {r.has_case && <span className="text-[11px] text-slate-400">есть кейс</span>}
                {r.stage !== 'done' && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    в работе
                  </span>
                )}
              </span>
            </button>
          ))}
          {list.length === 0 && (
            <div className="text-sm text-slate-400 text-center py-8">
              {onlyDone && doneCount === 0
                ? 'Завершённых интеграций нет. Снимите галочку, чтобы завести кейс заранее.'
                : 'Ничего не найдено'}
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-3 px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-brand-900 self-end"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}

function SitePublishBar() {
  const qc = useQueryClient()
  const { data: status } = useQuery({ queryKey: ['site-status'], queryFn: siteApi.status })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: authApi.me, retry: false })
  const [result, setResult] = useState<{ ok: boolean; text: string; link?: string } | null>(null)

  const publish = useMutation({
    mutationFn: siteApi.publish,
    onSuccess: (r: PublishResult) => {
      qc.invalidateQueries({ queryKey: ['site-status'] })
      qc.invalidateQueries({ queryKey: ['streamers'] })
      setResult(r.changed
        ? { ok: true, text: `Опубликовано кейсов: ${r.count}. Сайт обновится, как только сервер заберёт изменения с GitHub.`, link: r.commit_url ?? undefined }
        : { ok: true, text: 'На сайте и так всё актуально.' })
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setResult({ ok: false, text: typeof detail === 'string' ? detail : 'Не удалось опубликовать' })
    },
  })

  if (!status) return null
  const isAdmin = me?.role === 'admin'

  return (
    <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-3 mb-6 text-sm">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 text-slate-600 dark:text-slate-300">
          🌐 На сайте{' '}
          <a href={status.site_url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
            {status.site_url.replace(/^https?:\/\//, '')}
          </a>
          : {status.count ? `кейсов из CRM — ${status.count}` : 'пока ни одного кейса из CRM — поставь галочку «Показывать на сайте»'}
          {status.unpublished > 0 && <span className="text-amber-600"> · ждут публикации: {status.unpublished}</span>}
          {status.last_published_at && (
            <span className="text-slate-400"> · обновлено {new Date(status.last_published_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => publish.mutate()}
            disabled={publish.isPending || !status.configured}
            title={status.configured ? '' : 'Нужен SITE_GITHUB_TOKEN в backend/.env'}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium shrink-0"
          >
            {publish.isPending ? 'Публикую…' : '🚀 Опубликовать на сайт'}
          </button>
        )}
      </div>
      {isAdmin && !status.configured && (
        <div className="text-xs text-slate-400 mt-2">Публикация не настроена: нужен токен GitHub (SITE_GITHUB_TOKEN в backend/.env).</div>
      )}
      {result && (
        <div className={`text-xs mt-2 ${result.ok ? 'text-emerald-600' : 'text-red-500'}`}>
          {result.text}{' '}
          {result.link && <a href={result.link} target="_blank" rel="noreferrer" className="underline">коммит ↗</a>}
        </div>
      )}
    </div>
  )
}
