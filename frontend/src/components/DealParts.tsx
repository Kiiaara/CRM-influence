import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { integrationsApi } from '../api/integrations'

// Общие куски карточки сделки: используются и в модалке канбана, и в модалке блогера кампании.
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

// файлы ТЗ: перетаскивание в зону или выбор через проводник, несколько файлов
export function BriefFiles({ streamerId }: { streamerId: number }) {
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

// поле erid: сам идентификатор рекламы, рядом кнопка "копировать" (erid вставляют в текст поста)
export function ErridInput({
  value,
  onChange,
  onBlur,
  inputClassName = 'bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100',
}: {
  value: string
  onChange: (v: string) => void
  // сохранение по уходу из поля (модалка блогера кампании сохраняет текст на blur)
  onBlur?: (v: string) => void
  inputClassName?: string
}) {
  const [copied, setCopied] = useState(false)
  const text = (value ?? '').trim()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // буфер недоступен (http без разрешения): ничего не ломаем, текст можно выделить руками
    }
  }

  return (
    <div>
      <label className="text-xs text-slate-500 dark:text-slate-400">erid</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value ?? ''}
          placeholder="Вставьте erid"
          onChange={e => onChange(e.target.value)}
          onBlur={e => onBlur?.(e.target.value)}
          className={`flex-1 min-w-0 ${inputClassName}`}
        />
        <button
          type="button"
          onClick={copy}
          disabled={!text}
          className="shrink-0 px-3 py-2 rounded-lg border border-slate-200 dark:border-brand-800 text-sm text-slate-500 dark:text-slate-300 hover:border-brand-400 disabled:opacity-40 disabled:hover:border-slate-200"
        >
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
    </div>
  )
}

// поле ссылки на ОРД: рядом с инпутом кнопка "открыть", чтобы не копировать руками
export function OrdLinkInput({
  label,
  placeholder,
  value,
  onChange,
  onBlur,
  inputClassName = 'bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100',
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  // сохранение по уходу из поля (модалка блогера кампании сохраняет текст на blur)
  onBlur?: (v: string) => void
  // свой вид инпута, если нужно подогнать под соседние поля
  inputClassName?: string
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
          onBlur={e => onBlur?.(e.target.value)}
          className={`flex-1 min-w-0 ${inputClassName}`}
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
