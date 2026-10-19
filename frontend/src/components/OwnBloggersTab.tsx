import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ownBloggersApi } from '../api/ownBloggers'
import type { OwnBlogger, OwnBloggerPayload } from '../api/ownBloggers'
import { useWorkspace } from '../workspaceContext'

const inputCls =
  'w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 focus:border-brand-400 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none'
const th = 'text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap'
const td = 'px-3 py-2 text-slate-600 dark:text-slate-300'

// популярные площадки для подсказки в поле; писать можно любую
const PLATFORM_HINTS = ['YouTube', 'Instagram', 'TikTok', 'Telegram', 'VK', 'Twitch']

function errorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

// ссылка на контакт: @nick -> t.me, как есть для http, иначе просто текст
function contactHref(v: string): string | null {
  const s = v.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (/^@[A-Za-z0-9_]{3,}$/.test(s)) return `https://t.me/${s.slice(1)}`
  return null
}

// вкладка «Наши блогеры»: свои блогеры пространства, добавление, правка и удаление
export default function OwnBloggersTab() {
  const { current } = useWorkspace()
  // наблюдатель только смотрит, как и на бэке
  const canWrite = current?.my_role !== 'viewer'
  const { data: bloggers = [] } = useQuery({ queryKey: ['own-bloggers'], queryFn: ownBloggersApi.list })
  const [search, setSearch] = useState('')
  // null - модалка закрыта, 'new' - новая запись, иначе правим существующую
  const [editing, setEditing] = useState<OwnBlogger | 'new' | null>(null)

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return bloggers
    return bloggers.filter(b =>
      [b.name, b.url, b.platform, b.contact, b.category, b.notes].some(v => v.toLowerCase().includes(s))
    )
  }, [bloggers, search])

  const emptyText = bloggers.length > 0
    ? 'Ничего не найдено'
    : 'Своих блогеров пока нет. Нажмите «Добавить блогера», чтобы завести первого.'

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени, площадке, контакту, тематике…"
          className="flex-1 bg-white dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
        />
        {canWrite && (
          <button
            onClick={() => setEditing('new')}
            className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium shrink-0"
          >
            + Добавить блогера
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Блогеры, которых вы нашли сами. Они видны только в этом пространстве и не затираются обновлением базы агентства.
      </p>

      {/* мобилка: карточки */}
      <div className="space-y-3 sm:hidden">
        {filtered.map(b => (
          <div
            key={b.id}
            onClick={() => setEditing(b)}
            className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4"
          >
            <div className="font-medium text-slate-900 dark:text-slate-100">{b.name}</div>
            <div className="text-xs text-slate-400">{[b.platform, b.category].filter(Boolean).join(' · ')}</div>
            {b.url && <div className="text-xs text-brand-600 truncate mt-1">{b.url}</div>}
            {b.contact && <div className="text-xs text-slate-500 dark:text-slate-400 truncate">Контакт: {b.contact}</div>}
          </div>
        ))}
        {filtered.length === 0 && <div className="text-sm text-slate-400 text-center py-8">{emptyText}</div>}
      </div>

      {/* десктоп: таблица */}
      <div className="hidden sm:block bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-brand-900/50">
            <tr>
              {['Имя', 'Площадка', 'Ссылка', 'Контакт', 'Тематика'].map(h => <th key={h} className={th}>{h}</th>)}
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => {
              const href = contactHref(b.contact)
              return (
                <tr key={b.id} className="border-t border-slate-100 dark:border-brand-900 hover:bg-slate-50 dark:hover:bg-brand-900/30">
                  <td className="px-3 py-2 text-slate-900 dark:text-slate-100 cursor-pointer whitespace-nowrap" onClick={() => setEditing(b)}>{b.name}</td>
                  <td className={`${td} whitespace-nowrap`}>{b.platform || '-'}</td>
                  <td className="px-3 py-2 max-w-[220px] truncate">
                    {b.url ? <a href={b.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{b.url}</a> : '-'}
                  </td>
                  <td className={`${td} max-w-[200px] truncate`}>
                    {href ? <a href={href} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{b.contact}</a> : (b.contact || '-')}
                  </td>
                  <td className={`${td} max-w-[200px] truncate`}>{b.category || '-'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(b)} className="text-brand-600 hover:text-brand-700 text-xs">
                      {canWrite ? 'править' : 'открыть'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-sm text-slate-400 text-center py-8">{emptyText}</div>}
      </div>

      {editing && (
        <OwnBloggerModal
          blogger={editing === 'new' ? null : editing}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function OwnBloggerModal({ blogger, canWrite, onClose }: { blogger: OwnBlogger | null; canWrite: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: blogger?.name ?? '',
    url: blogger?.url ?? '',
    platform: blogger?.platform ?? '',
    contact: blogger?.contact ?? '',
    category: blogger?.category ?? '',
    notes: blogger?.notes ?? '',
  })
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))

  // свои блогеры попадают в подсказки кампании, поэтому после правки обновляем их ключ
  const done = () => { qc.invalidateQueries({ queryKey: ['own-bloggers'] }); onClose() }

  const save = useMutation({
    mutationFn: (p: OwnBloggerPayload & { name: string }) => (blogger ? ownBloggersApi.update(blogger.id, p) : ownBloggersApi.create(p)),
    onSuccess: done,
    onError: e => setErr(errorText(e, 'Не удалось сохранить')),
  })
  const remove = useMutation({
    mutationFn: () => ownBloggersApi.remove(blogger!.id),
    onSuccess: done,
    onError: e => setErr(errorText(e, 'Не удалось удалить')),
  })

  const name = form.name.trim()
  const busy = save.isPending || remove.isPending

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">
          {blogger ? blogger.name : 'Новый блогер'}
        </h2>

        <div className="space-y-3">
          <Field label="Имя или ник">
            <input autoFocus value={form.name} onChange={e => set('name', e.target.value)} disabled={!canWrite} className={inputCls} />
          </Field>
          <Field label="Площадка">
            <input
              list="own-blogger-platforms"
              value={form.platform}
              onChange={e => set('platform', e.target.value)}
              disabled={!canWrite}
              maxLength={64}
              className={inputCls}
            />
            <datalist id="own-blogger-platforms">
              {PLATFORM_HINTS.map(p => <option key={p} value={p} />)}
            </datalist>
          </Field>
          <Field label="Ссылка на блогера">
            <input value={form.url} onChange={e => set('url', e.target.value)} disabled={!canWrite} placeholder="https://" className={inputCls} />
          </Field>
          <Field label="Контакт">
            <input value={form.contact} onChange={e => set('contact', e.target.value)} disabled={!canWrite} placeholder="@ник в ТГ, почта, телефон или менеджер" className={inputCls} />
          </Field>
          <Field label="Тематика">
            <input value={form.category} onChange={e => set('category', e.target.value)} disabled={!canWrite} className={inputCls} />
          </Field>
          <Field label="Заметки">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} disabled={!canWrite} rows={3} className={inputCls} />
          </Field>
        </div>

        {err && <div className="text-xs text-red-500 mt-3">{err}</div>}

        <div className="flex justify-between gap-2 mt-6">
          <div>
            {blogger && canWrite && (
              <button
                onClick={() => confirm(`Удалить «${blogger.name}» из ваших блогеров?`) && remove.mutate()}
                disabled={busy}
                className="px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50"
              >
                Удалить
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-brand-900 rounded-lg">
              {canWrite ? 'Отмена' : 'Закрыть'}
            </button>
            {canWrite && (
              <button
                onClick={() => name && save.mutate({ ...form, name })}
                disabled={!name || busy}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Сохранить
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
