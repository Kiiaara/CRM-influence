import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { integrationsApi } from '../api/integrations'
import type { CaseStudy, Streamer } from '../api/integrations'
import { CaseStudyCard } from './IntegrationsBoard'

interface Row extends Streamer {
  brand: string
}

function StreamerCases({ row }: { row: Row }) {
  const qc = useQueryClient()
  const { data: cases = [] } = useQuery({
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
    mutationFn: (p: { id: number; payload: Partial<Pick<CaseStudy, 'title' | 'description' | 'what_was_done' | 'result'>> }) =>
      integrationsApi.updateCase(p.id, p.payload),
    onSuccess: invalidate,
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

  return (
    <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
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
          className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1 rounded-lg shrink-0"
        >
          + Кейс
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
        {cases.length === 0 && <div className="text-xs text-slate-400">Кейсов ещё нет</div>}
      </div>
    </div>
  )
}

export default function CasesPage() {
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const [q, setQ] = useState('')
  // по умолчанию только завершённые, но кейс иногда надо завести заранее
  const [onlyDone, setOnlyDone] = useState(true)

  const all: Row[] = useMemo(
    () =>
      integrations
        .flatMap(it => it.streamers.map(s => ({ ...s, brand: it.brand })))
        .filter(s => s.stage !== 'cancelled')
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [integrations]
  )

  const doneCount = all.filter(r => r.stage === 'done').length
  const rows = onlyDone ? all.filter(r => r.stage === 'done') : all

  const filtered = rows.filter(r =>
    !q.trim() ||
    r.brand.toLowerCase().includes(q.toLowerCase()) ||
    r.streamer_name.toLowerCase().includes(q.toLowerCase())
  )

  const withoutCase = filtered.filter(r => !r.has_case).length

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Кейсы для сайта</h1>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Поиск по бренду или стримеру"
          className="w-full sm:w-64 bg-slate-100 dark:bg-brand-900 border border-transparent focus:border-brand-500 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none"
        />
      </div>
      <p className="text-slate-500 dark:text-slate-400 mb-3 text-sm">
        Фото и результаты интеграций - для сборки кейсов на сайт. Показано: {filtered.length}
        {withoutCase > 0 && <> · без кейса пока {withoutCase}</>}
      </p>

      <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-4 cursor-pointer w-fit">
        <input type="checkbox" checked={onlyDone} onChange={e => setOnlyDone(e.target.checked)} />
        Только завершённые ({doneCount})
      </label>

      <div className="space-y-4">
        {filtered.map(row => <StreamerCases key={row.id} row={row} />)}
        {filtered.length === 0 && (
          <div className="text-sm text-slate-400 text-center py-8 bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl">
            {onlyDone && doneCount === 0
              ? 'Завершённых интеграций пока нет. Снимите галочку, чтобы завести кейс заранее.'
              : 'Ничего не найдено'}
          </div>
        )}
      </div>
    </div>
  )
}
