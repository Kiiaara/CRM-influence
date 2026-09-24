import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bloggerProfilesApi } from '../api/bloggerProfiles'
import type { BloggerProfile, SheetCell, SheetInfo, SheetSyncResult } from '../api/bloggerProfiles'
import { authApi } from '../api/auth'

function emptyBlogger(platform = ''): BloggerProfile {
  return {
    id: 0,
    name: '',
    platform,
    url: '',
    telegram: '',
    category: '',
    geo: '',
    subscribers: null,
    avg_views: null,
    price: null,
    manager: '',
    notes: '',
    source: 'manual',
    sheet_row: [],
    created_at: '',
    updated_at: '',
  }
}

function errorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

function syncMessage(r: SheetSyncResult): string {
  return `Готово: новых ${r.created}, обновлено ${r.updated}${r.deleted ? `, удалено ${r.deleted}` : ''}`
}

// ссылка на TG: @nick -> https://t.me/nick, иначе как есть
function telegramHref(v: string): string | null {
  const s = v.trim()
  if (!s) return null
  if (s.startsWith('http')) return s
  const nick = s.replace(/^@/, '')
  return /^[A-Za-z0-9_]{3,}$/.test(nick) ? `https://t.me/${nick}` : null
}

function formatSyncTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ячейка листа: ссылка, если в таблице была гиперссылка или текст - URL
function SheetCellView({ cell }: { cell?: SheetCell }) {
  if (!cell) return <span className="text-slate-300 dark:text-slate-600">—</span>
  const href = cell.u || (/^https?:\/\//.test(cell.v) ? cell.v : null) || telegramHref(cell.v.startsWith('@') ? cell.v : '')
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-brand-600 hover:underline">
        {cell.v}
      </a>
    )
  }
  return <>{cell.v}</>
}

function matches(b: BloggerProfile, q: string): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  return b.name.toLowerCase().includes(s)
    || b.telegram.toLowerCase().includes(s)
    || b.sheet_row.some(c => c.v.toLowerCase().includes(s))
}

export default function BloggerProfilesPage() {
  const qc = useQueryClient()
  const { data: bloggers = [] } = useQuery({ queryKey: ['blogger-profiles'], queryFn: bloggerProfilesApi.list })
  const { data: sheet } = useQuery({ queryKey: ['blogger-sheet'], queryFn: bloggerProfilesApi.sheetInfo })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: authApi.me, retry: false })
  // база общая на все пространства, поэтому менять её могут только свои
  const canEdit = me?.role === 'admin' || me?.role === 'editor'
  const canDelete = me?.role === 'admin'
  const sheetUrl = sheet?.url ?? ''

  const [editing, setEditing] = useState<BloggerProfile | null>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('')
  const [sheetDraft, setSheetDraft] = useState('')
  const [sheetEditing, setSheetEditing] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // вкладки - листы таблицы в её порядке, плюс площадки, заведённые только в CRM
  const tabs = useMemo(() => {
    const fromSheet = sheet?.tabs ?? []
    const extra = [...new Set(bloggers.map(b => b.platform).filter(p => p && !fromSheet.includes(p)))].sort()
    return [...fromSheet, ...extra]
  }, [sheet, bloggers])
  const activeTab = tab && tabs.includes(tab) ? tab : ''

  const inTab = bloggers.filter(b => !activeTab || b.platform === activeTab)
  const filtered = inTab.filter(b => matches(b, search))

  // колонки вкладки - как на листе: объединение заголовков в порядке первого появления
  const sheetColumns: string[] = []
  if (activeTab) for (const b of inTab) for (const c of b.sheet_row) if (!sheetColumns.includes(c.h)) sheetColumns.push(c.h)
  const showSheetColumns = sheetColumns.length > 0

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['blogger-profiles'] })
    qc.invalidateQueries({ queryKey: ['blogger-sheet'] })
  }

  const saveSheet = useMutation({
    mutationFn: (url: string) => bloggerProfilesApi.setSheetUrl(url),
    onSuccess: (info: SheetInfo) => {
      refreshAll()
      setSheetEditing(false)
      const err = info.last_sync?.error
      setMessage(info.url && err ? { ok: false, text: err } : info.url ? { ok: true, text: 'Таблица привязана и подтянута' } : null)
    },
    onError: (e) => setMessage({ ok: false, text: errorText(e, 'Не удалось сохранить ссылку') }),
  })

  const sync = useMutation({
    mutationFn: bloggerProfilesApi.syncFromSheet,
    onSuccess: (r) => { refreshAll(); setMessage({ ok: true, text: syncMessage(r) }) },
    onError: (e) => { refreshAll(); setMessage({ ok: false, text: errorText(e, 'Не удалось подтянуть таблицу') }) },
  })

  const importFile = useMutation({
    mutationFn: (f: File) => bloggerProfilesApi.importFile(f),
    onSuccess: (r) => { refreshAll(); setMessage({ ok: true, text: syncMessage(r) }) },
    onError: (e) => setMessage({ ok: false, text: errorText(e, 'Не удалось импортировать файл') }),
  })

  const remove = useMutation({
    mutationFn: (id: number) => bloggerProfilesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blogger-profiles'] }),
  })

  const btnGhost = 'bg-slate-100 dark:bg-brand-900 hover:bg-slate-200 dark:hover:bg-brand-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium'
  const lastSync = sheet?.last_sync
  const th = 'text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap'
  const td = 'px-3 py-2 text-slate-600 dark:text-slate-300'

  const actions = (b: BloggerProfile) => (
    <td className="px-3 py-2 text-right whitespace-nowrap">
      <button onClick={() => setEditing(b)} className="text-brand-600 hover:text-brand-700 text-xs mr-2">
        {canEdit ? 'править' : 'открыть'}
      </button>
      {canDelete && (
        <button onClick={() => confirm('Удалить блогера из базы?') && remove.mutate(b.id)} className="text-red-500 hover:text-red-700 text-xs">удалить</button>
      )}
    </td>
  )

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">База блогеров</h1>
        <div className="flex flex-wrap gap-2">
          {sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noreferrer" className={btnGhost}>📗 Таблица блогеров</a>
          )}
          {canEdit && sheetUrl && (
            <button onClick={() => sync.mutate()} disabled={sync.isPending} className={`${btnGhost} disabled:opacity-50`}>
              {sync.isPending ? 'Подтягиваю…' : '🔄 Обновить сейчас'}
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setEditing(emptyBlogger(activeTab))}
              className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              + Блогер
            </button>
          )}
        </div>
      </div>

      {(canEdit || lastSync) && (
        <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-3 mb-4 text-sm">
          {canEdit && (sheetEditing || !sheetUrl) ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={sheetDraft}
                onChange={e => setSheetDraft(e.target.value)}
                placeholder="Ссылка на гугл-таблицу с блогерами (docs.google.com/spreadsheets/d/...)"
                className="flex-1 bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              />
              <button
                onClick={() => saveSheet.mutate(sheetDraft)}
                disabled={saveSheet.isPending}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                {saveSheet.isPending ? 'Подтягиваю…' : 'Сохранить'}
              </button>
              {sheetUrl && (
                <button onClick={() => setSheetEditing(false)} className="px-3 py-2 text-slate-500">Отмена</button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-500 dark:text-slate-400">
              <span>
                Листы таблицы = вкладки ниже.
                {sheet && sheet.sync_minutes > 0 && ` Обновляется сама каждые ${sheet.sync_minutes} мин.`}
              </span>
              {lastSync && !lastSync.error && <span>Последнее обновление: {formatSyncTime(lastSync.at)}.</span>}
              {canEdit && (
                <>
                  <button onClick={() => { setSheetDraft(sheetUrl); setSheetEditing(true) }} className="text-brand-600 hover:underline">изменить ссылку</button>
                  <span>·</span>
                  <button onClick={() => fileRef.current?.click()} className="text-brand-600 hover:underline">загрузить xlsx вручную</button>
                </>
              )}
            </div>
          )}
          {canEdit && !sheetUrl && (
            <div className="text-xs text-slate-400 mt-2">
              Таблица должна быть открыта по ссылке («Все, у кого есть ссылка → Читатель»). Либо{' '}
              <button onClick={() => fileRef.current?.click()} className="text-brand-600 hover:underline">загрузи xlsx</button>{' '}
              (Файл → Скачать → Microsoft Excel).
            </div>
          )}
          {lastSync?.error && sheetUrl && (
            <div className="text-xs mt-2 text-red-500">
              Не удалось обновить из таблицы ({formatSyncTime(lastSync.at)}): {lastSync.error}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) importFile.mutate(f)
              e.target.value = ''
            }}
          />
          {message && (
            <div className={`text-xs mt-2 ${message.ok ? 'text-emerald-600' : 'text-red-500'}`}>{message.text}</div>
          )}
        </div>
      )}

      {/* вкладки площадок - как листы в гугл-таблице */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-brand-900 mb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        {['', ...tabs].map(t => {
          const count = t ? bloggers.filter(b => b.platform === t).length : bloggers.length
          const active = activeTab === t
          return (
            <button
              key={t || '__all__'}
              onClick={() => setTab(t)}
              className={`shrink-0 px-4 py-2 text-sm rounded-t-lg border border-b-0 -mb-px ${
                active
                  ? 'bg-white dark:bg-brand-950 border-slate-200 dark:border-brand-900 text-brand-700 dark:text-brand-300 font-medium'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {t || 'Все'} <span className="text-xs text-slate-400">{count}</span>
            </button>
          )
        })}
      </div>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={activeTab ? `Поиск на вкладке «${activeTab}»…` : 'Поиск по имени, TG или любой колонке…'}
        className="w-full bg-white dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 mb-4"
      />

      {/* Мобилка: карточки */}
      <div className="space-y-3 sm:hidden">
        {filtered.map(b => (
          <div key={b.id} onClick={() => setEditing(b)} className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4">
            <div className="font-medium text-slate-900 dark:text-slate-100">{b.name}</div>
            <div className="text-xs text-slate-400">{[activeTab ? '' : b.platform, b.category].filter(Boolean).join(' · ')}</div>
            {b.url && <div className="text-xs text-brand-600 truncate mt-1">{b.url}</div>}
            {b.telegram && <div className="text-xs text-slate-500 dark:text-slate-400 truncate">TG: {b.telegram}</div>}
          </div>
        ))}
        {filtered.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Блогеров нет — подтяни из таблицы или добавь вручную</div>}
      </div>

      {/* Десктоп: на вкладке площадки - колонки как на листе, на «Все» - общие поля */}
      <div className="hidden sm:block bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-brand-900/50">
            <tr>
              {showSheetColumns
                ? sheetColumns.map(h => <th key={h} className={th}>{h}</th>)
                : ['Имя', 'Площадка', 'Ссылка', 'TG', 'Подписчики', 'Цена'].map(h => <th key={h} className={th}>{h}</th>)}
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => {
              if (showSheetColumns) {
                const byHeader = new Map(b.sheet_row.map(c => [c.h, c]))
                return (
                  <tr key={b.id} onClick={() => setEditing(b)} className="border-t border-slate-100 dark:border-brand-900 hover:bg-slate-50 dark:hover:bg-brand-900/30 cursor-pointer">
                    {sheetColumns.map((h, i) => (
                      <td key={h} className={`${td} max-w-[240px] truncate ${i === 0 ? 'text-slate-900 dark:text-slate-100' : ''}`}>
                        {b.source === 'manual' && i === 0 && !byHeader.get(h) ? b.name : <SheetCellView cell={byHeader.get(h)} />}
                      </td>
                    ))}
                    {actions(b)}
                  </tr>
                )
              }
              const tg = telegramHref(b.telegram)
              return (
                <tr key={b.id} className="border-t border-slate-100 dark:border-brand-900 hover:bg-slate-50 dark:hover:bg-brand-900/30">
                  <td className="px-3 py-2 text-slate-900 dark:text-slate-100 cursor-pointer whitespace-nowrap" onClick={() => setEditing(b)}>{b.name}</td>
                  <td className={`${td} whitespace-nowrap`}>{b.platform || '—'}</td>
                  <td className="px-3 py-2 max-w-[220px] truncate">
                    {b.url ? <a href={b.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{b.url}</a> : '—'}
                  </td>
                  <td className={`${td} max-w-[160px] truncate`}>
                    {tg ? <a href={tg} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{b.telegram}</a> : (b.telegram || '—')}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{b.subscribers != null ? b.subscribers.toLocaleString('ru-RU') : '—'}</td>
                  <td className={`${td} whitespace-nowrap`}>{b.price != null ? `${b.price.toLocaleString('ru-RU')} ₽` : '—'}</td>
                  {actions(b)}
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Блогеров нет — подтяни из таблицы или добавь вручную</div>}
      </div>

      {editing && <BloggerModal blogger={editing} platforms={tabs} canEdit={canEdit} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-slate-500 dark:text-slate-400">{label}</label>
      {children}
    </div>
  )
}

const inputCls = "w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"

function BloggerModal({ blogger, platforms, canEdit, onClose }: { blogger: BloggerProfile; platforms: string[]; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<BloggerProfile>(blogger)
  const [error, setError] = useState<string | null>(null)
  const isNew = blogger.id === 0

  const set = <K extends keyof BloggerProfile>(k: K, v: BloggerProfile[K]) => setForm({ ...form, [k]: v })
  const num = (v: string) => v === '' ? null : Number(v)

  const onSaved = () => { qc.invalidateQueries({ queryKey: ['blogger-profiles'] }); onClose() }
  const create = useMutation({
    mutationFn: (p: Partial<BloggerProfile>) => bloggerProfilesApi.create(p),
    onSuccess: onSaved,
    onError: (e) => setError(errorText(e, 'Не удалось сохранить')),
  })
  const update = useMutation({
    mutationFn: (p: Partial<BloggerProfile>) => bloggerProfilesApi.update(blogger.id, p),
    onSuccess: onSaved,
    onError: (e) => setError(errorText(e, 'Не удалось сохранить')),
  })

  const save = () => {
    if (!form.name.trim()) return
    const payload: Partial<BloggerProfile> = { ...form }
    delete payload.id
    delete payload.created_at
    delete payload.updated_at
    delete payload.source
    delete payload.sheet_row
    if (isNew) create.mutate(payload)
    else update.mutate(payload)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold mb-1 text-slate-900 dark:text-slate-100">{isNew ? 'Новый блогер' : form.name}</h2>
        {blogger.source === 'sheet' && (
          <p className="text-xs text-slate-400 mb-4">
            Из таблицы, лист «{blogger.platform}». Поля, которые заполнены в таблице, обновятся из неё при следующей синхронизации — правь их лучше в самой таблице.
          </p>
        )}

        {blogger.sheet_row.length > 0 && (
          <div className="border border-slate-200 dark:border-brand-900 rounded-lg p-3 mb-4">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 font-medium">Строка из таблицы</div>
            <dl className="grid grid-cols-1 sm:grid-cols-[minmax(0,180px)_1fr] gap-x-3 gap-y-1 text-sm">
              {blogger.sheet_row.map(c => (
                <div key={c.h} className="contents">
                  <dt className="text-slate-400 truncate">{c.h}</dt>
                  <dd className="text-slate-700 dark:text-slate-200 break-words"><SheetCellView cell={c} /></dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <fieldset disabled={!canEdit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Имя"><input value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} /></Field>
            <Field label="Площадка (вкладка)">
              <input value={form.platform} onChange={e => set('platform', e.target.value)} list="blogger-platforms" placeholder="YouTube, TikTok, Telegram…" className={inputCls} />
              <datalist id="blogger-platforms">{platforms.map(p => <option key={p} value={p} />)}</datalist>
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Ссылка на блогера"><input value={form.url} onChange={e => set('url', e.target.value)} className={inputCls} /></Field>
            <Field label="Telegram"><input value={form.telegram} onChange={e => set('telegram', e.target.value)} placeholder="@nick" className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Тематика"><input value={form.category} onChange={e => set('category', e.target.value)} className={inputCls} /></Field>
            <Field label="Гео"><input value={form.geo} onChange={e => set('geo', e.target.value)} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Подписчики"><input type="number" value={form.subscribers ?? ''} onChange={e => set('subscribers', num(e.target.value))} className={inputCls} /></Field>
            <Field label="Средние просмотры"><input type="number" value={form.avg_views ?? ''} onChange={e => set('avg_views', num(e.target.value))} className={inputCls} /></Field>
            <Field label="Цена интеграции"><input type="number" value={form.price ?? ''} onChange={e => set('price', num(e.target.value))} className={inputCls} /></Field>
          </div>
          <Field label="Менеджер"><input value={form.manager} onChange={e => set('manager', e.target.value)} className={inputCls} /></Field>
          <Field label="Заметки"><textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className={inputCls} /></Field>
        </fieldset>
        {error && <div className="text-xs text-red-500 mt-2">{error}</div>}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-900 rounded-lg">
            {canEdit ? 'Отмена' : 'Закрыть'}
          </button>
          {canEdit && (
            <button onClick={save} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Сохранить</button>
          )}
        </div>
      </div>
    </div>
  )
}
