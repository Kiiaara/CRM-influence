import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bloggerProfilesApi } from '../api/bloggerProfiles'
import type { BloggerProfile, SheetCell, SheetInfo, SheetSyncResult } from '../api/bloggerProfiles'
import { authApi } from '../api/auth'

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
  // сами блогеры в CRM только для чтения - источник правды гугл-таблица.
  // Ссылку на таблицу и ручное обновление меняют только свои (база общая на все пространства)
  const canEdit = me?.role === 'admin' || me?.role === 'editor'
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

  const btnGhost = 'bg-slate-100 dark:bg-brand-900 hover:bg-slate-200 dark:hover:bg-brand-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium'
  const lastSync = sheet?.last_sync
  const emptyText = bloggers.length > 0
    ? 'Ничего не найдено'
    : sheetUrl ? 'Блогеров пока нет — нажми «Обновить сейчас» или проверь таблицу' : 'Блогеров нет — вставь ссылку на гугл-таблицу выше'
  const th = 'text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap'
  const td = 'px-3 py-2 text-slate-600 dark:text-slate-300'

  const actions = (b: BloggerProfile) => (
    <td className="px-3 py-2 text-right whitespace-nowrap">
      <button onClick={() => setEditing(b)} className="text-brand-600 hover:text-brand-700 text-xs">открыть</button>
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
                Блогеры подтягиваются только из таблицы: добавлять, править и удалять их — в самой таблице. Листы = вкладки ниже.
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
        {filtered.length === 0 && <div className="text-sm text-slate-400 text-center py-8">{emptyText}</div>}
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
        {filtered.length === 0 && <div className="text-sm text-slate-400 text-center py-8">{emptyText}</div>}
      </div>

      {editing && <BloggerModal blogger={editing} sheetUrl={sheetUrl} onClose={() => setEditing(null)} />}
    </div>
  )
}

function BloggerModal({ blogger, sheetUrl, onClose }: { blogger: BloggerProfile; sheetUrl: string; onClose: () => void }) {
  const tg = telegramHref(blogger.telegram)
  // старые записи без строки листа - показываем основные поля
  const rows: SheetCell[] = blogger.sheet_row.length > 0 ? blogger.sheet_row : [
    { h: 'Ссылка', v: blogger.url },
    { h: 'Telegram', v: blogger.telegram, u: tg ?? undefined },
    { h: 'Подписчики', v: blogger.subscribers != null ? blogger.subscribers.toLocaleString('ru-RU') : '' },
    { h: 'Цена', v: blogger.price != null ? `${blogger.price.toLocaleString('ru-RU')} ₽` : '' },
  ].filter(c => c.v)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold mb-1 text-slate-900 dark:text-slate-100">{blogger.name}</h2>
        <p className="text-xs text-slate-400 mb-4">
          {blogger.platform && `Лист «${blogger.platform}». `}Изменить данные можно только в гугл-таблице — CRM подтянет их сама.
        </p>

        <dl className="grid grid-cols-1 sm:grid-cols-[minmax(0,180px)_1fr] gap-x-3 gap-y-1.5 text-sm">
          {rows.map(c => (
            <div key={c.h} className="contents">
              <dt className="text-slate-400 truncate">{c.h}</dt>
              <dd className="text-slate-700 dark:text-slate-200 break-words"><SheetCellView cell={c} /></dd>
            </div>
          ))}
        </dl>

        <div className="flex justify-end gap-2 mt-6">
          {sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noreferrer" className="px-4 py-2 text-sm text-brand-600 hover:bg-slate-100 dark:hover:bg-brand-900 rounded-lg">
              Открыть таблицу ↗
            </a>
          )}
          <button onClick={onClose} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Закрыть</button>
        </div>
      </div>
    </div>
  )
}
