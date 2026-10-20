import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { integrationsApi } from '../api/integrations'
import type { AdvertiserContacts, Screenshot } from '../api/integrations'
import { CONTACT_TYPE_LABELS } from '../api/advertisers'

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

// миниатюра скриншота; клик открывает картинку целиком в новой вкладке
function ScreenshotThumb({ shot, onRemove }: { shot: Screenshot; onRemove: () => void }) {
  const { data: blob } = useQuery({
    queryKey: ['screenshot-blob', shot.id],
    queryFn: () => integrationsApi.screenshotBlob(shot.id),
    staleTime: Infinity,
  })
  const [src, setSrc] = useState<string | null>(null)

  // objectURL живёт, пока миниатюра на экране; потом освобождаем память
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])

  return (
    <div className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200 dark:border-brand-800 bg-slate-100 dark:bg-brand-900">
      {src ? (
        <a href={src} target="_blank" rel="noreferrer" title={shot.file_name}>
          <img src={src} alt={shot.file_name} className="w-full h-full object-cover" />
        </a>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">...</div>
      )}
      {/* на мобилке наведения нет, поэтому крестик виден всегда, на десктопе - по наведению */}
      <button
        type="button"
        onClick={onRemove}
        title="Удалить"
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center sm:opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-600"
      >
        ✕
      </button>
    </div>
  )
}

// скриншоты интеграции: как файлы ТЗ (перетащить, выбрать или вставить из буфера), но с миниатюрами.
// Клик по миниатюре открывает картинку целиком в новой вкладке.
export function Screenshots({ streamerId }: { streamerId: number }) {
  const qc = useQueryClient()
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: shots = [] } = useQuery({
    queryKey: ['streamers', streamerId, 'screenshots'],
    queryFn: () => integrationsApi.screenshots(streamerId),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['streamers', streamerId, 'screenshots'] })

  const upload = useMutation({
    mutationFn: (file: File) => integrationsApi.uploadScreenshot(streamerId, file),
    onSuccess: () => {
      invalidate()
      // первый скриншот сам заводит кейс-черновик: обновляем кейсы и флаг has_case в списках
      qc.invalidateQueries({ queryKey: ['streamers', streamerId, 'cases'] })
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['streamer', streamerId] })
      setError(null)
    },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось загрузить скриншот'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => integrationsApi.removeScreenshot(id),
    onSuccess: invalidate,
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось удалить скриншот'),
  })

  // не картинки отсекаем сразу, не гоняя их на сервер (сервер всё равно проверит ещё раз)
  const uploadAll = (list: FileList | File[] | null) => {
    if (!list) return
    const files = Array.from(list)
    const images = files.filter(f => f.type.startsWith('image/'))
    if (images.length < files.length) setError('Нужны картинки: png, jpg, webp или gif')
    for (const f of images) upload.mutate(f)
  }

  // Ctrl+V со скриншотом из буфера обмена
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    uploadAll(files)
  }

  return (
    <div className="mt-2">
      <div
        tabIndex={0}
        onPaste={onPaste}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); uploadAll(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={`rounded-lg border border-dashed px-3 py-4 text-center text-xs cursor-pointer transition outline-none focus:border-brand-400 ${
          dragOver
            ? 'border-brand-400 bg-brand-50/60 dark:bg-brand-900/20 text-brand-600 dark:text-brand-300'
            : 'border-slate-300 dark:border-brand-800 text-slate-400 hover:border-brand-400'
        }`}
      >
        {upload.isPending ? 'Загружаю…' : 'Перетащите скриншоты, вставьте из буфера (Ctrl+V) или нажмите, чтобы выбрать'}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={e => { uploadAll(e.target.files); e.target.value = '' }}
      />
      {error && <div className="text-xs text-red-500 mt-1">{error}</div>}

      {shots.length > 0 && (
        <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
          {shots.map(s => (
            <ScreenshotThumb key={s.id} shot={s} onRemove={() => confirm('Удалить скриншот?') && remove.mutate(s.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

// одна строка контакта с кнопкой "копировать"; пустое значение не показываем
function CopyRow({ label, value, note }: { label: string; value: string; note?: string }) {
  const [copied, setCopied] = useState(false)
  if (!value.trim()) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value.trim())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // буфер недоступен (http без разрешения): текст можно выделить руками
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-16 shrink-0 text-xs text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-200" title={note ? `${value} (${note})` : value}>
        {value}
        {note && <span className="text-xs text-slate-400"> · {note}</span>}
      </span>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 px-2 py-0.5 rounded-md border border-slate-200 dark:border-brand-800 text-xs text-slate-500 dark:text-slate-300 hover:border-brand-400"
      >
        {copied ? 'Скопировано' : 'Копировать'}
      </button>
    </div>
  )
}

// контакты рекламодателя (список BrandContact, основной первым) только для чтения;
// правятся в разделе "Рекламодатели". Нет рекламодателя у сделки - блока нет.
export function AdvertiserCard({ advertiser }: { advertiser: AdvertiserContacts | null }) {
  if (!advertiser) return null
  const contacts = advertiser.contacts.filter(c => c.value.trim())
  return (
    <div className="space-y-1.5">
      <CopyRow label="Название" value={advertiser.name} />
      {contacts.map(c => (
        <CopyRow key={c.id} label={CONTACT_TYPE_LABELS[c.contact_type] ?? 'Контакт'} value={c.value} note={c.label} />
      ))}
      {contacts.length === 0 && <div className="text-xs text-slate-400">Контакты не заполнены</div>}
      <Link
        to={`/advertisers?q=${encodeURIComponent(advertiser.name)}`}
        className="inline-block text-xs text-brand-600 dark:text-brand-400 hover:underline"
      >
        Открыть в разделе «Рекламодатели»
      </Link>
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
